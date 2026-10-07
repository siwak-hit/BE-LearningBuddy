const lmsRouteModel = require('../../models/lmsRoute.model');
const moodleContentSync = require('./moodle-content-sync.service');
const moodleService = require('./moodle.service');
const progressModel = require('../../models/studentContentProgress.model');

// [v0.9.85] Gerbang sinkronisasi DUA JALUR yang bisa dipicu SIAPA SAJA saat klik widget
// (bukan cuma guru dari dashboard). Sinkron admin lama tetap ada sebagai cadangan.
//
//  • Track 1 (global): konten course/materi/struktur — shared. TTL nempel di DB per course
//    (lms_course_routes.last_synced_at), BUKAN localStorage device.
//  • Track 2 (personal): kemajuan belajar per siswa. TTL nempel di baris siswa itu sendiri
//    (student_content_progress.last_synced_at).
//
// [v0.9.86] LIVE-FIRST, CACHE-FALLBACK:
//  • Selama web service Moodle aktif → data basi ditarik ulang & DITULIS ke DB (cache durable).
//  • Kalau web service mati (lewat tanggal cutoff / dimatikan manual / health check gagal) →
//    TIDAK memanggil Moodle sama sekali, langsung pakai isi DB apa adanya.
//  • Kegagalan sync TIDAK BOLEH menimpa cache dengan data kosong atau memajukan last_synced_at.
const TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

// Env (opsional):
//   MOODLE_WS_ACTIVE_UNTIL = 2026-10-27T23:59:59+07:00   (setelah ini otomatis mode cache)
//   MOODLE_WS_FORCE_OFFLINE = true                        (saklar manual: paksa mode cache)
const WS_ACTIVE_UNTIL = String(process.env.MOODLE_WS_ACTIVE_UNTIL || '').trim();
const WS_FORCE_OFFLINE = String(process.env.MOODLE_WS_FORCE_OFFLINE || '').toLowerCase() === 'true';

const syncingCourses = new Set();

function isStale(ts) {
  if (!ts) return true;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) > TTL_MS;
}

// Apakah jendela web service masih terbuka (murni berdasarkan config, tanpa hit Moodle)?
function isWsWindowOpen() {
  if (WS_FORCE_OFFLINE) return false;
  if (!WS_ACTIVE_UNTIL) return true;
  const until = Date.parse(WS_ACTIVE_UNTIL);
  if (Number.isNaN(until)) return true; // format salah → jangan mematikan sync diam-diam
  return Date.now() <= until;
}

// Boleh mencoba Moodle? Cek cutoff dulu (gratis), baru health check ringan (cache 5 menit).
async function canReachMoodle(projectId) {
  if (!isWsWindowOpen()) return { ok: false, reason: 'ws_window_closed' };
  const health = await moodleService.isMoodleDegraded(projectId)
    .catch(() => ({ degraded: true, reason: 'connection' }));
  if (health.degraded) return { ok: false, reason: `moodle_degraded_${health.reason || 'unknown'}` };
  return { ok: true };
}

// TRACK 1 — pastikan konten global course masih segar; kalau Moodle tak bisa dijangkau → pakai DB.
async function ensureCourseContentFresh(projectId, classCode, courseId) {
  if (!projectId || !classCode || !courseId) return { ran: false, reason: 'missing_params' };

  const route = await lmsRouteModel.findCourseRouteAny(projectId, classCode).catch(() => null);
  // [v0.9.86] "Segar" hanya kalau snapshot struktur course (untuk daftar @materi saat offline)
  // juga sudah ada. Tanpa ini, course yang sudah ber-stempel waktu tapi belum punya snapshot
  // tidak akan pernah terisi.
  if (!isStale(route?.last_synced_at) && route?.contents_snapshot_at) {
    return { ran: false, reason: 'fresh', last_synced_at: route.last_synced_at };
  }

  // Basi, tapi Moodle tak bisa dijangkau → jangan buang waktu (timeout 18 dtk x beberapa call).
  const reach = await canReachMoodle(projectId);
  if (!reach.ok) {
    return { ran: false, reason: 'offline_cache', offline: true, detail: reach.reason, last_synced_at: route?.last_synced_at || null };
  }

  const key = `${projectId}:${courseId}`;
  if (syncingCourses.has(key)) return { ran: false, reason: 'in_progress' };
  syncingCourses.add(key);
  try {
    const directory = await moodleContentSync.syncCourseStudentDirectory(projectId, classCode, Number(courseId))
      .catch((e) => ({ students: 0, error: e.message }));

    const summary = await moodleContentSync.syncCourseContent(
      projectId, classCode, Number(courseId), { materialOnly: true }
    );

    if (summary?.errors?.length) {
      // Sync gagal sebagian/seluruhnya → cache lama tetap dipakai (syncCourseContent hanya upsert).
      return { ran: true, reason: 'sync_failed_using_cache', offline: true, directory, summary, last_synced_at: route?.last_synced_at || null };
    }
    return { ran: true, reason: 'synced', directory, summary };
  } finally {
    syncingCourses.delete(key);
  }
}

// TRACK 2 — kemajuan belajar siswa: live kalau bisa, kalau tidak pakai baris terakhir di DB.
async function ensureStudentProgressFresh(projectId, moodleUserId, courseId) {
  if (!projectId || !moodleUserId || !courseId) return { ran: false, reason: 'missing_params' };

  const existing = await progressModel.find(projectId, moodleUserId, courseId).catch(() => null);
  const cachedCmids = Array.isArray(existing?.completed_cmids) ? existing.completed_cmids : [];

  if (!isStale(existing?.last_synced_at)) {
    return { ran: false, reason: 'fresh', last_synced_at: existing.last_synced_at, cmids: cachedCmids };
  }

  const reach = await canReachMoodle(projectId);
  if (!reach.ok) {
    return { ran: false, reason: 'offline_cache', offline: true, detail: reach.reason, last_synced_at: existing?.last_synced_at || null, cmids: cachedCmids };
  }

  let compRes;
  try {
    compRes = await moodleService.getActivitiesCompletionStatus(projectId, courseId, moodleUserId);
  } catch (e) {
    // PENTING: jangan upsert apa pun saat gagal (dulu → completed_cmids kosong + timestamp baru).
    console.warn('[SyncGate] completion gagal, pakai cache:', e.message);
    return { ran: false, reason: 'sync_failed_using_cache', offline: true, last_synced_at: existing?.last_synced_at || null, cmids: cachedCmids };
  }

  const statuses = Array.isArray(compRes?.statuses) ? compRes.statuses : [];

  // Respons kosong padahal cache sebelumnya berisi → curigai, jangan timpa.
  if (!statuses.length && cachedCmids.length) {
    return { ran: false, reason: 'empty_response_kept_cache', last_synced_at: existing?.last_synced_at || null, cmids: cachedCmids };
  }

  const completedCmids = statuses
    .filter((s) => s && (s.isoverallcomplete === true || [1, 2, 3].includes(Number(s.state))))
    .map((s) => Number(s.cmid))
    .filter(Boolean);

  const saved = await progressModel.upsert({
    project_id: projectId,
    moodle_user_id: Number(moodleUserId),
    course_id: Number(courseId),
    completed_cmids: completedCmids,
    completion_total: statuses.length,
    last_synced_at: new Date().toISOString()
  });

  return { ran: true, reason: 'synced', cmids: completedCmids, total: statuses.length, saved: Boolean(saved) };
}

module.exports = {
  ensureCourseContentFresh,
  ensureStudentProgressFresh,
  isStale,
  isWsWindowOpen,
  canReachMoodle,
  TTL_MS
};
