const lmsRouteModel = require('../../models/lmsRoute.model');
const moodleContentSync = require('./moodle-content-sync.service');
const moodleService = require('./moodle.service');
const progressModel = require('../../models/studentContentProgress.model');

// [v0.9.85] Gerbang sinkronisasi DUA JALUR yang bisa dipicu SIAPA SAJA saat klik widget
// (bukan cuma guru dari dashboard). Sinkron admin lama tetap ada sebagai cadangan.
//
//  • Track 1 (global): konten course/materi/struktur — shared. TTL nempel di DB per course
//    (lms_course_routes.last_synced_at), BUKAN localStorage device. Jadi siapa pun yang klik
//    dan datanya sudah basi → dialah yang trigger sync ulang untuk semua siswa.
//  • Track 2 (personal): kemajuan belajar per siswa. TTL nempel di baris siswa itu sendiri
//    (student_content_progress.last_synced_at). Tiap siswa sinkron sendiri, tak numpang.
const TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

// ponytail: lock in-memory per-instance untuk cegah dua request user men-sync course yang
// sama BERSAMAAN. Multi-instance serverless bisa lolos lock → tak masalah (upsert dokumen
// idempotent by source_url + dedup konten), paling boros satu pemanggilan. Kalau nanti butuh
// jaminan lintas-instance: pindah lock ke kolom DB `sync_in_progress` + advisory lock.
const syncingCourses = new Set();

function isStale(ts) {
  if (!ts) return true;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) > TTL_MS;
}

// TRACK 1 — pastikan konten global course masih segar. Kalau basi → sync HANYA course itu
// (bukan 9 course sekaligus) supaya cepat saat siswa klik.
async function ensureCourseContentFresh(projectId, classCode, courseId) {
  if (!projectId || !classCode || !courseId) return { ran: false, reason: 'missing_params' };

  const route = await lmsRouteModel.findCourseRouteAny(projectId, classCode).catch(() => null);
  if (!isStale(route?.last_synced_at)) {
    return { ran: false, reason: 'fresh', last_synced_at: route.last_synced_at };
  }

  const key = `${projectId}:${courseId}`;
  if (syncingCourses.has(key)) return { ran: false, reason: 'in_progress' };
  syncingCourses.add(key);
  try {
    // Segarkan direktori siswa course itu DULU (ringan, 1 panggilan) supaya verifikasi email
    // Fase 2 langsung kena data terbaru; guru tetap punya sinkron direktori penuh sbg cadangan.
    const directory = await moodleContentSync.syncCourseStudentDirectory(projectId, classCode, Number(courseId))
      .catch((e) => ({ students: 0, error: e.message }));

    // materialOnly:true → hanya materi (page) di-chunk ke RAG; upsert by source_url
    // (tidak delete-and-replace penuh — reset total tetap lewat tombol admin cadangan).
    const summary = await moodleContentSync.syncCourseContent(
      projectId, classCode, Number(courseId), { materialOnly: true }
    );
    return { ran: true, reason: 'synced', directory, summary };
  } finally {
    syncingCourses.delete(key);
  }
}

// TRACK 2 — pastikan kemajuan belajar siswa masih segar. Kalau basi → ambil completion siswa
// dari Moodle lalu simpan barisnya sendiri di DB.
async function ensureStudentProgressFresh(projectId, moodleUserId, courseId) {
  if (!projectId || !moodleUserId || !courseId) return { ran: false, reason: 'missing_params' };

  const existing = await progressModel.find(projectId, moodleUserId, courseId).catch(() => null);
  if (!isStale(existing?.last_synced_at)) {
    return { ran: false, reason: 'fresh', last_synced_at: existing.last_synced_at, cmids: existing.completed_cmids };
  }

  const compRes = await moodleService.getActivitiesCompletionStatus(projectId, courseId, moodleUserId).catch(() => null);
  const statuses = Array.isArray(compRes?.statuses) ? compRes.statuses : [];
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

module.exports = { ensureCourseContentFresh, ensureStudentProgressFresh, isStale, TTL_MS };
