const chatModel = require('../models/chat.model');
const asyncHandler = require('../utils/async-handler');
const response = require('../utils/response');
const crypto = require('crypto');
const chatService = require('../services/chat/chat.service');
const aiRateLimitService = require('../services/ai/aiRateLimit.service');
const aiQueueService = require('../services/ai/aiQueue.service');
const ruleService = require('../services/chat/rule.service');
const studentSessionRegistryModel = require('../models/studentSessionRegistry.model');
const lmsContextService = require('../services/moodle/lms-context.service');
const documentModel = require('../models/document.model');
const moodleService = require('../services/moodle/moodle.service');
const gradeUtil = require('../services/moodle/grade-util');
const lmsRouteModel = require('../models/lmsRoute.model');
const moodleConfigModel = require('../models/moodleConfig.model');
const moodleStudentModel = require('../models/moodleStudent.model');
const difficultyService = require('../services/ai/difficulty.service');
const intentService = require('../services/ai/intent.service');
const recommendationService = require('../services/ai/recommendation.service');

// Apakah dua waktu berada pada hari kalender yang sama (zona Asia/Jakarta)?
// Dipakai untuk aturan "lanjutkan sesi selama masih hari yang sama / sebelum jam 12 malam".
function isSameJakartaDay(ts) {
  if (!ts) return false;
  try {
    const fmt = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    return fmt(ts) === fmt(new Date());
  } catch (_) {
    return false;
  }
}

// [v0.9.22] Cross-check keterbukaan aktivitas (sesuai spec user): sebuah modul TERBUKA bila
//   (a) tak punya syarat (availability/availabilityinfo kosong), ATAU
//   (b) punya syarat TAPI semua aktivitas prasyaratnya sudah selesai (state ∈ [1,2,3]) di
//       data completion SISWA.
// `availability` = JSON string Moodle, mis. {"op":"&","c":[{"type":"completion","cm":699,"e":1}]}.
// cm = -1 artinya "aktivitas tepat sebelumnya" (perlu id modul sebelumnya secara urutan).
function parseRequiredCmids(availabilityRaw, prevModuleId) {
  if (!availabilityRaw) return [];
  let av;
  try { av = typeof availabilityRaw === 'string' ? JSON.parse(availabilityRaw) : availabilityRaw; }
  catch (_) { return []; }
  const cmids = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.c)) node.c.forEach(walk);
    if (node.type === 'completion' && node.cm != null) {
      const cm = Number(node.cm);
      cmids.push(cm === -1 ? Number(prevModuleId) : cm);
    }
  };
  walk(av);
  return cmids.filter((x) => x != null && !Number.isNaN(x) && x > 0);
}

function isCmidComplete(completionByCmid, cmid) {
  const st = completionByCmid.get(Number(cmid));
  if (!st) return false;
  return st.isoverallcomplete === true || [1, 2, 3].includes(Number(st.state));
}

// Hitung locked untuk satu modul. availabilityInfoText = teks (untuk fallback bila JSON tak ada).
function computeModuleLocked(mod, prevModuleId, completionByCmid, availabilityInfoText) {
  const required = parseRequiredCmids(mod.availability, prevModuleId);
  if (required.length) {
    // Terkunci bila ADA prasyarat yang belum selesai.
    return !required.every((cm) => isCmidComplete(completionByCmid, cm));
  }
  // Tak ada availability JSON tapi ada teks syarat → tak bisa diverifikasi → anggap terkunci.
  if (availabilityInfoText) return true;
  // uservisible=false dari token bukan acuan siswa; abaikan bila tak ada syarat.
  return false;
}

// [v0.9.21] Resolusi userId Moodle siswa secara OTORITATIF.
// Masalah ditemukan: `moodle_user_id` hasil scraping DOM widget bisa KELIRU (mis. 773
// padahal yang punya attempt = 772) → semua query per-user (attempt kuis, completion
// materi) balik kosong. Solusi: kalau sesi punya EMAIL, cocokkan ke enrolled users
// Moodle (`resolveStudentByEmail`) → dapat userId yang benar. Fallback ke id DOM.
async function resolveStudentUserId(projectId, meta = {}, courseId = null) {
  let userId = meta.moodle_user_id || null;
  let source = userId ? 'session_meta' : null;
  const email = meta.email || null;

  if (email) {
    try {
      const r = await moodleService.resolveStudentByEmail(projectId, email, courseId ? { courseId } : {});
      if (r?.found && r.moodle_user_id) {
        userId = r.moodle_user_id;
        if (!courseId && r.course_id) courseId = r.course_id;
        source = 'email_resolved';
      }
    } catch (e) { console.warn('[ResolveUserId] resolveStudentByEmail gagal:', e.message); }
  }
  return { userId, courseId, source, email };
}

// [v0.9.19] Resolusi konteks Moodle siswa dari sesi (untuk endpoint Komplain Kuis).
async function resolveQuizSessionContext(session) {
  const projectId = session.project_id;
  const pageCtx = session.page_context || {};
  const meta = pageCtx.session_meta || {};
  const courseCtx = session.course_context || {};
  const classCode = lmsContextService.getClassCodeFromSession
    ? lmsContextService.getClassCodeFromSession(session)
    : null;

  let courseId = meta.course_id || courseCtx.course_id || pageCtx.course_id || null;
  if (!courseId && classCode) {
    try {
      const route = await lmsRouteModel.findCourseRoute(projectId, classCode);
      courseId = route?.course_id || null;
    } catch (_) { /* abaikan */ }
  }

  const resolved = await resolveStudentUserId(projectId, meta, courseId);
  console.log('[QuizCtx] resolved userId:', JSON.stringify({ domUserId: meta.moodle_user_id || null, email: meta.email || null, finalUserId: resolved.userId, source: resolved.source, courseId: resolved.courseId }));

  return {
    projectId,
    courseId: resolved.courseId || courseId,
    userId: resolved.userId,
    userIdSource: resolved.source,
    studentName: meta.display_name || session.student_alias || 'Siswa'
  };
}

const chatController = {
  createSession: asyncHandler(async (req, res) => {
    const { projectKey, sourceUrl, courseContext, pageContext, studentAlias, moodleContext } = req.body;
    if (!projectKey) return response.error(res, 'projectKey diperlukan', null, 400);

    const projectId = await chatModel.getProjectIdByKey(projectKey);
    if (!projectId) return response.error(res, 'Project tidak ditemukan', null, 404);

    const sessionKey = `sess_${crypto.randomBytes(8).toString('hex')}`;
    const shortCode = sessionKey.substring(5, 8).toUpperCase();

    // Mapping Moodle Course ID ke Kelas
    const courseMap = { '2': '8A', '3': '8B', '4': '8C', '6': '8D', '7': '8E', '9': '8F', '8': '8G', '5': '8H', '13': '9A' };
    let autoClassCode = null;
    let autoStudentName = null;

    if (moodleContext) {
      if (moodleContext.course_id && courseMap[moodleContext.course_id]) {
        autoClassCode = courseMap[moodleContext.course_id];
      } else if (moodleContext.class_code) {
        autoClassCode = String(moodleContext.class_code).toUpperCase().replace(/\s+/g, '');
      } else if (courseContext?.class_code) {
        autoClassCode = String(courseContext.class_code).toUpperCase().replace(/\s+/g, '');
      }
      if (moodleContext.student_name) {
        autoStudentName = moodleContext.student_name;
      }
    }

    // [v0.9.9] Email siswa (kalau terdeteksi) dipakai untuk menurunkan nama yang manusiawi
    // sebagai fallback — JAUH lebih baik daripada "Pengunjung #XXX - Kursus: ..." yang
    // sebenarnya itu judul course (nama guru), bukan nama siswa.
    const detectedEmail = String(moodleContext?.email || pageContext?.session_meta?.email || '').trim().toLowerCase();
    const nameFromEmail = (email) => {
      const local = String(email || '').split('@')[0] || '';
      const cleaned = local.replace(/[._\-]+/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned) return '';
      return cleaned.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };

    // Pembuatan Display Name Otomatis (Memprioritaskan nama auto-detect dari Moodle)
    // [v0.9.84] Label pengunjung anonim: "Pengunjung 07" (dua digit stabil per sesi),
    // bukan kode heksa "#C6F" yang tak terbaca. ponytail: nomor diturunkan dari sessionKey,
    // jadi stabil tapi tidak dijamin unik lintas sesi — cukup untuk label sapaan.
    const visitorNo = String(
      Array.from(sessionKey).reduce((acc, ch) => (acc + ch.charCodeAt(0)) % 100, 0)
    ).padStart(2, '0');
    let displayName = `Pengunjung ${visitorNo}`;
    if (autoStudentName) {
      displayName = autoStudentName;
    } else if (studentAlias) {
      displayName = studentAlias;
    } else if (detectedEmail && nameFromEmail(detectedEmail)) {
      // Nama dari email, mis. "ilyas.rizal@..." → "Ilyas Rizal".
      displayName = nameFromEmail(detectedEmail);
    }
    // Catatan: tidak lagi menambahkan pageContext.heading/title (itu judul course,
    // bukan identitas siswa) ke nama tampilan.

    const sessionMeta = {
      display_name: displayName,
      class_code: autoClassCode || pageContext?.session_meta?.class_code || 'Umum',
      moodle_user_id: moodleContext?.moodle_user_id || null,
      username: moodleContext?.username || null,
      email: moodleContext?.email || null,
      course_id: moodleContext?.course_id || courseContext?.course_id || null,
      course_title: moodleContext?.course_title || courseContext?.course_title || null,
      enrolled_courses: moodleContext?.enrolled_courses || courseContext?.enrolled_courses || []
    };

    const finalPageContext = {
      ...(pageContext || {}),
      session_meta: sessionMeta
    };

    // [v0.4.0] Lanjutkan sesi yang sama jika user yang sama membuka lagi pada
    // HARI yang sama (sebelum jam 12 malam Asia/Jakarta). Mencegah sesi/percakapan
    // hilang saat tab workspace ditutup lalu mulai lagi dari widget.
    const studentEmail = String(sessionMeta.email || '').trim().toLowerCase();
    const studentClass = String(sessionMeta.class_code || autoClassCode || '').trim().toUpperCase();

    // [#3] Ganti course = PAKSA sesi baru. Tanpa ini, blok reuse harian di bawah akan
    // mengembalikan sesi LAMA (course lama) untuk email+kelas yang sama di hari yang sama
    // → course tak pernah benar-benar berpindah.
    const forceNewSession = req.body.switchCourse === true || req.body.forceNew === true;

    if (!forceNewSession && studentEmail && studentClass) {
      try {
        const existing = await studentSessionRegistryModel.findActive(projectId, studentEmail, studentClass);
        if (existing?.session_id && isSameJakartaDay(existing.updated_at)) {
          const reused = await chatModel.getSessionById(existing.session_id);
          // [FIX] Verifikasi COURSE sesi yang mau di-reuse benar-benar cocok dgn yang diminta.
          // Registry bisa "korup" (kelas 9A menunjuk ke sesi yang meta-nya 8E) → dulu reuse
          // membuka sesi 8E untuk permintaan 9A. Kalau course tak cocok, JANGAN reuse → buat baru.
          const wantCourse = String(sessionMeta.course_id || '');
          const reusedCourse = String(reused?.page_context?.session_meta?.course_id || '');
          const courseMatches = wantCourse ? reusedCourse === wantCourse : true;
          if (reused && courseMatches) {
            // Segarkan registry agar tetap aktif.
            await studentSessionRegistryModel.upsert({
              project_id: projectId, session_id: reused.id,
              student_email: studentEmail, class_code: studentClass,
              student_name: displayName, moodle_user_id: sessionMeta.moodle_user_id,
              course_id: sessionMeta.course_id, course_title: sessionMeta.course_title
            }).catch(() => {});
            return response.success(res, 'Melanjutkan sesi chat sebelumnya', { session: reused, reused: true }, 200);
          }
        }
      } catch (e) {
        console.warn('[Chat] Gagal cek reuse sesi harian:', e.message);
      }
    }

    // [FIX] Kolom course_context NOT NULL. Kalau request tak kirim courseContext (mis. jalur
    // switchSessionForIdentity yang cuma kirim moodleContext), JANGAN insert null → susun dari
    // data yang sudah di-resolve (course_id/kelas/judul) supaya sesi baru bawa course yang benar.
    const finalCourseContext = courseContext || {
      course_id: sessionMeta.course_id || null,
      class_code: sessionMeta.class_code || null,
      course_title: sessionMeta.course_title || null,
      enrolled_courses: sessionMeta.enrolled_courses || []
    };

    const sessionData = {
      project_id: projectId,
      session_key: sessionKey,
      source_url: sourceUrl || null,
      page_context: finalPageContext,
      course_context: finalCourseContext,
      student_alias: displayName
    };

    const newSession = await chatModel.createSession(sessionData);

    // Daftarkan ke registry supaya bisa di-reuse pada kunjungan berikutnya (hari yang sama).
    if (studentEmail && studentClass) {
      await studentSessionRegistryModel.upsert({
        project_id: projectId, session_id: newSession.id,
        student_email: studentEmail, class_code: studentClass,
        student_name: displayName, moodle_user_id: sessionMeta.moodle_user_id,
        course_id: sessionMeta.course_id, course_title: sessionMeta.course_title
      }).catch(() => {});
    }

    return response.success(res, 'Session chat berhasil dibuat', { session: newSession }, 201);
  }),

  getSessionState: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const aiUsage = aiRateLimitService.getStatus(sessionId);
    const safetyState = session.page_context?.safety_state || { warnings: 0, locked: false };

    return response.success(res, 'State berhasil diambil', {
      sessionId,
      display_name: session.page_context?.session_meta?.display_name || 'Sesi Anonim',
      ai_usage: aiUsage,
      safety_state: safetyState
    }, 200);
  }),

  sendMessage: asyncHandler(async (req, res) => {
    // 1. Tangkap seluruh parameter baru dari Frontend payload
    const { sessionId, message, pageContext, elementContext, expectedSourceType, forceAI, forceFAQ, responseMode, intent, mention, freshMention } = req.body;

    if (!sessionId || !message) return response.error(res, 'sessionId dan message wajib diisi', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi chat tidak valid', null, 404);

    // 2. TERUSKAN seluruh parameter baru ke SERVICE LAYER
    const result = await chatService.processMessage({
      sessionId,
      projectId: session.project_id,
      message,
      pageContext,
      elementContext,
      expectedSourceType,
      forceAI: forceAI === true,
      forceFAQ: forceFAQ === true,
      responseMode: responseMode || 'default',
      intent: intent || null, // Mengatasi error undefined intent
      mention: mention || null, // [v0.7.0] mention @materi-N / @elemen
      freshMention: freshMention === true // [v0.9.8] minta hasil @materi baru (bypass cache)
    });

    // [v0.8.0] Komponen AI: deteksi tingkat kesulitan siswa dari pola dialog.
    try {
      const history = await chatModel.getHistory(sessionId);
      const burnoutCount = session.page_context?.safety_state?.burnout_count || 0;
      const lastResolvedAt = session.page_context?.last_resolved_at || null;
      result.difficulty = difficultyService.analyze(history, { burnoutCount, lastResolvedAt });

      // [v0.8.2] Rekomendasi bantuan adaptif berdasarkan level (throttle di FE).
      result.recommendation = recommendationService.build(result.difficulty.level, { intent: result.intent });
    } catch (e) {
      console.warn('[Difficulty] gagal analisa:', e.message);
    }

    // [v0.9.63] Label transparansi intent (estimasi keyword) untuk pesan yang DIKETIK siswa.
    // FE menampilkan hanya untuk pesan ketik-sendiri (bukan @mention / tombol sidebar).
    try {
      result.intent_scores = intentService.scoreIntents(message, result.intent);
    } catch (e) {
      console.warn('[IntentScores] gagal:', e.message);
    }

    // [v0.9.52] Mode darurat: bila koneksi Moodle bermasalah (token kadaluarsa / endpoint
    // mati), tandai respons agar FE menampilkan catatan bahwa jawaban berasal dari PANDUAN
    // penggunaan Moodle — bukan materi/forum terbaru. Non-blocking & di-cache (~5 menit).
    try {
      const health = await moodleService.isMoodleDegraded(session.project_id);
      if (health.degraded) {
        result.degraded = true;
        result.degraded_reason = health.reason;
        result.degraded_note = health.reason === 'token'
          ? 'Koneksi ke Moodle sedang bermasalah (akses kedaluwarsa). Jawaban ini dari panduan penggunaan Moodle, bukan materi atau forum terbaru.'
          : 'Koneksi ke Moodle sedang bermasalah. Jawaban ini dari panduan penggunaan Moodle, bukan materi atau forum terbaru.';
      }
    } catch (e) {
      console.warn('[Degraded] cek kesehatan Moodle gagal:', e.message);
    }

    return response.success(res, 'Pesan berhasil diproses', result, 200);
  }),

  // [v0.8.1] Catat feedback "scoring" (terbantu/teratasi) → checkpoint untuk skor kesulitan.
  recordFeedback: asyncHandler(async (req, res) => {
    const { sessionId, type } = req.body;
    if (!sessionId || !type) return response.error(res, 'sessionId dan type diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const pageCtx = session.page_context || {};
    const now = new Date().toISOString();
    const log = Array.isArray(pageCtx.scoring_feedback) ? pageCtx.scoring_feedback : [];
    log.push({ type, at: now });

    const updated = { ...pageCtx, scoring_feedback: log.slice(-50) };
    if (type === 'resolved') updated.last_resolved_at = now;

    await chatModel.updateSession(sessionId, { page_context: updated });

    // Hitung ulang difficulty setelah resolusi untuk umpan balik langsung ke FE.
    let difficulty = null;
    try {
      const history = await chatModel.getHistory(sessionId);
      const burnoutCount = pageCtx.safety_state?.burnout_count || 0;
      difficulty = difficultyService.analyze(history, { burnoutCount, lastResolvedAt: updated.last_resolved_at });
    } catch (_) { /* abaikan */ }

    return response.success(res, 'Feedback tercatat', { difficulty }, 200);
  }),

  // [v0.9.13] Daftar COURSE yang diikuti siswa (untuk fitur ganti course konteks).
  getStudentCourses: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const meta = session.page_context?.session_meta || {};
    const userId = meta.moodle_user_id;
    const email = meta.email || '';
    const currentCourseId = String(meta.course_id || '');

    // [v0.9.41] UTAMAKAN INDEKS LOKAL (moodle_students) berdasarkan EMAIL siswa — ini course
    // yang BENAR-BENAR di-enroll siswa. Dulu pakai getUserCourses(moodle_user_id) yang sering
    // salah karena userId dari DOM keliru → daftar course salah (mis. 8A padahal 8D).
    try {
      const dirRows = await moodleStudentModel.findRowsForStudent(session.project_id, { email, userId });
      if (dirRows && dirRows.length) {
        let routesById = new Map();
        try {
          const routes = await lmsRouteModel.getCoursesByProject(session.project_id);
          routesById = new Map((routes || []).map((r) => [String(r.course_id), r]));
        } catch (_) {}

        const seen = new Set();
        const list = [];
        dirRows.forEach((r) => {
          const cid = String(r.course_id);
          if (seen.has(cid)) return;
          seen.add(cid);
          const route = routesById.get(cid);
          list.push({
            id: r.course_id,
            fullname: route?.course_title || (r.class_code ? `Informatika ${r.class_code}` : `Course ${r.course_id}`),
            shortname: r.class_code ? `TIK ${r.class_code}` : '',
            is_current: cid === currentCourseId
          });
        });
        return response.success(res, 'Daftar course siswa (indeks)', list, 200);
      }
    } catch (e) {
      console.warn('[StudentCourses] indeks lokal gagal, fallback live:', e.message);
    }

    // Fallback: indeks kosong/belum ada → pakai Moodle live (perilaku lama).
    if (!userId) return response.success(res, 'User Moodle belum terdeteksi', [], 200);
    let courses = [];
    try {
      courses = await moodleService.getUserCourses(session.project_id, userId);
    } catch (e) {
      console.warn('[StudentCourses] getUserCourses gagal:', e.message);
      return response.success(res, 'Gagal memuat course dari Moodle', [], 200);
    }

    const list = (Array.isArray(courses) ? courses : [])
      .map((c) => ({
        id: c.id,
        fullname: c.fullname || c.displayname || c.shortname || `Course ${c.id}`,
        shortname: c.shortname || '',
        is_current: String(c.id) === currentCourseId
      }))
      .filter((c) => c.id);

    return response.success(res, 'Daftar course siswa', list, 200);
  }),

  // [v0.7.1] Daftar MATERI dari VClass untuk kelas siswa (mention @materi-N).
  // Diambil LANGSUNG dari core_course_get_contents course kelas user, lalu disaring:
  //   - hanya modul materi (page/resource/book/url/folder), bukan tugas/kuis/forum
  //   - skip yang disembunyikan instruktur (visible === 0)
  //   - locked = uservisible === false ATAU ada availabilityinfo (prasyarat belum tuntas)
  getSessionMaterials: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const projectId = session.project_id;
    const pageCtx = session.page_context || {};
    const meta = pageCtx.session_meta || {};
    const courseCtx = session.course_context || {};
    const classCode = lmsContextService.getClassCodeFromSession(session);

    // Resolusi course id: utamakan dari session, fallback dari rute kelas.
    let courseId = meta.course_id || courseCtx.course_id || pageCtx.course_id || null;
    if (!courseId && classCode) {
      try {
        const route = await lmsRouteModel.findCourseRoute(projectId, classCode);
        courseId = route?.course_id || null;
      } catch (_) { /* abaikan */ }
    }
    if (!courseId) return response.success(res, 'Course belum terdeteksi', [], 200);

    let sections = [];
    try {
      sections = await moodleService.getCourseContents(projectId, courseId);
    } catch (e) {
      console.warn('[SessionMaterials] getCourseContents gagal:', e.message);
      return response.success(res, 'Gagal memuat materi dari Moodle', [], 200);
    }

    const decodeEntities = (s) => String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();
    const stripHtml = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    // [#2] @materi HANYA modname `page` (materi HTML yang diketik guru & dibaca langsung
    // di VClass). Selaras dengan chunking page-only — resource/file/url/folder tak masuk
    // daftar @ supaya tak ada item tanpa isi yang bisa di-rangkum AI.
    const MATERI_MODNAMES = ['page'];

    // [v0.7.3] Status penyelesaian materi OLEH SISWA (core_completion_get_activities_completion_status).
    // Hanya materi yang sudah DISELESAIKAN siswa yang masuk daftar @materi.
    // [v0.9.21] userId otoritatif (email → enrolled users), bukan id DOM yang bisa keliru.
    const _resolvedUid = await resolveStudentUserId(projectId, meta, courseId);
    const moodleUserId = _resolvedUid.userId || null;
    const completionByCmid = new Map();
    let completionTotal = 0; let completionDone = 0;
    if (moodleUserId) {
      try {
        const compRes = await moodleService.getActivitiesCompletionStatus(projectId, courseId, moodleUserId);
        const statuses = Array.isArray(compRes?.statuses) ? compRes.statuses : [];
        completionTotal = statuses.length;
        statuses.forEach((s) => { if (s && s.cmid != null) completionByCmid.set(Number(s.cmid), s); });
      } catch (e) { console.warn('[SessionMaterials] completion gagal:', e.message); }
    }
    const isCompleted = (st) => Boolean(st) && (st.isoverallcomplete === true || [1, 2, 3].includes(Number(st.state)));

    // Peta dokumen RAG → document_id (untuk pencarian tertarget @materi).
    let docs = [];
    try { docs = (await documentModel.findByProjectId(projectId)) || []; } catch (_) { docs = []; }
    const byUrl = new Map();
    const byTitle = new Map();
    docs.forEach((d) => {
      if (d.source_url) byUrl.set(d.source_url, d.id);
      if (d.title) byTitle.set(norm(d.title), d.id);
    });

    const materials = [];
    let prevModuleId = null; // untuk cm:-1 (aktivitas tepat sebelumnya) — dilacak lintas-modul
    let lockedCount = 0;
    (Array.isArray(sections) ? sections : []).forEach((section) => {
      (section.modules || []).forEach((mod) => {
        const prevForThis = prevModuleId;
        prevModuleId = Number(mod.id); // update untuk modul berikutnya (urutan course)

        if (mod.visible === 0) return; // disembunyikan instruktur
        if (!MATERI_MODNAMES.includes(String(mod.modname || '').toLowerCase())) return;
        const title = decodeEntities(mod.name);
        if (!title) return;
        const availabilityInfo = stripHtml(mod.availabilityinfo);
        const completed = isCompleted(completionByCmid.get(Number(mod.id)));
        if (completed) completionDone += 1;

        // [v0.9.22] TAMPILKAN SEMUA materi (sesuai spec user); jangan disaring berdasarkan
        // gembok. Cross-check: TERBUKA bila tak ada syarat ATAU prasyaratnya sudah selesai
        // di completion siswa. Yang masih terkunci tetap ditampilkan dengan locked=true
        // (FE akan men-disable-nya).
        const locked = computeModuleLocked(mod, prevForThis, completionByCmid, availabilityInfo);
        if (locked) lockedCount += 1;

        const url = mod.url || null;
        const documentId = (url && byUrl.get(url)) || byTitle.get(norm(title)) || null;
        materials.push({
          title,
          url,
          locked,
          completed,
          section: decodeEntities(section.name),
          availability_info: locked ? (availabilityInfo || null) : null,
          document_id: documentId
        });
      });
    });

    console.log('[SessionMaterials] diag:', JSON.stringify({
      courseId, domUserId: meta.moodle_user_id || null, email: meta.email || null,
      finalUserId: moodleUserId, userIdSource: _resolvedUid.source,
      sections: Array.isArray(sections) ? sections.length : 0,
      completionTotal, completionDone, materialsReturned: materials.length, lockedCount
    }));
    return response.success(res, 'Materi kelas berhasil diambil', materials, 200);
  }),

  // [v0.9.17] Daftar AKTIVITAS course (kuis/tugas/forum/materi) untuk dropdown form Komplain.
  // Diambil sekali via core_course_get_contents lalu dikelompokkan per jenis (modname).
  // Dipakai FE complaint-builder agar siswa memilih nama aktivitas asli, bukan mengetik bebas.
  getSessionActivities: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const projectId = session.project_id;
    const pageCtx = session.page_context || {};
    const meta = pageCtx.session_meta || {};
    const courseCtx = session.course_context || {};
    const classCode = lmsContextService.getClassCodeFromSession(session);

    let courseId = meta.course_id || courseCtx.course_id || pageCtx.course_id || null;
    if (!courseId && classCode) {
      try {
        const route = await lmsRouteModel.findCourseRoute(projectId, classCode);
        courseId = route?.course_id || null;
      } catch (_) { /* abaikan */ }
    }
    const empty = { Kuis: [], Tugas: [], Materi: [], Forum: [] };
    if (!courseId) return response.success(res, 'Course belum terdeteksi', empty, 200);

    let sections = [];
    try {
      // [v0.9.68] Di-cache: modal Komplain & Komplain Nilai memanggil endpoint ini tiap dibuka.
      sections = await moodleService.cached(`contents:${projectId}:${courseId}`,
        () => moodleService.getCourseContents(projectId, courseId));
    } catch (e) {
      console.warn('[SessionActivities] getCourseContents gagal:', e.message);
      return response.success(res, 'Gagal memuat aktivitas dari Moodle', empty, 200);
    }

    // [v0.9.22] Completion siswa (userId otoritatif) untuk cross-check gembok per aktivitas.
    const _uid = await resolveStudentUserId(projectId, meta, courseId);
    const completionByCmid = new Map();
    if (_uid.userId) {
      try {
        const compRes = await moodleService.cached(`completion:${projectId}:${courseId}:${_uid.userId}`,
          () => moodleService.getActivitiesCompletionStatus(projectId, courseId, _uid.userId));
        (Array.isArray(compRes?.statuses) ? compRes.statuses : []).forEach((s) => { if (s && s.cmid != null) completionByCmid.set(Number(s.cmid), s); });
      } catch (e) { console.warn('[SessionActivities] completion gagal:', e.message); }
    }

    const decodeEntities = (s) => String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();
    const stripHtml = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

    // modname Moodle → label chip komplain.
    const TYPE_BY_MODNAME = {
      quiz: 'Kuis',
      assign: 'Tugas',
      forum: 'Forum',
      page: 'Materi', resource: 'Materi', book: 'Materi', url: 'Materi', folder: 'Materi'
    };
    const grouped = { Kuis: [], Tugas: [], Materi: [], Forum: [] };
    let prevModuleId = null;
    (Array.isArray(sections) ? sections : []).forEach((section) => {
      (section.modules || []).forEach((mod) => {
        const prevForThis = prevModuleId;
        prevModuleId = Number(mod.id);
        if (mod.visible === 0) return; // disembunyikan instruktur
        const type = TYPE_BY_MODNAME[String(mod.modname || '').toLowerCase()];
        if (!type) return;
        const title = decodeEntities(mod.name);
        if (!title) return;
        const availabilityInfo = stripHtml(mod.availabilityinfo);
        const locked = computeModuleLocked(mod, prevForThis, completionByCmid, availabilityInfo);
        const completed = isCmidComplete(completionByCmid, mod.id);
        grouped[type].push({
          title, url: mod.url || null, section: decodeEntities(section.name),
          locked, completed, availability_info: locked ? (availabilityInfo || null) : null
        });
      });
    });

    return response.success(res, 'Aktivitas kelas berhasil diambil', grouped, 200);
  }),

  // [v0.9.67] Ambil NILAI satu tugas/kuis untuk siswa (dipakai modal Komplain Nilai).
  getItemGrade: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const type = String(req.query.type || '');
    const title = String(req.query.title || '');
    if (!sessionId || !type || !title) return response.error(res, 'sessionId, type, title diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const projectId = session.project_id;
    const meta = (session.page_context || {}).session_meta || {};
    const courseCtx = session.course_context || {};
    const classCode = lmsContextService.getClassCodeFromSession(session);
    let courseId = meta.course_id || courseCtx.course_id || session.page_context?.course_id || null;
    if (!courseId && classCode) { try { const r = await lmsRouteModel.findCourseRoute(projectId, classCode); courseId = r?.course_id || null; } catch (_) {} }
    const { userId } = await resolveStudentUserId(projectId, meta, courseId);
    const fail = (reason) => response.success(res, 'grade', { graded: false, grade: null, title, reason }, 200);
    if (!courseId || !userId) return fail('no_context');

    // [v0.9.69] NILAI diambil per-jenis dari WS yang tersedia di token (gradebook
    // `gradereport_user_get_grade_items` TIDAK aktif di server ini):
    //   Tugas → mod_assign_get_submission_status (feedback.gradefordisplay + komentar guru)
    //   Kuis  → mod_quiz_get_user_quiz_attempts (sumgrades, DISKALA ke nilai maks kuis)
    // Daftar tugas/kuis per course di-cache (modal Komplain Nilai memanggilnya berulang);
    // status/attempt siswa TIDAK di-cache agar nilai terbaru selalu terbaca.
    const clean = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/\.00(?=\D|$)/g, '').trim();
    try {
      if (/kuis|quiz/i.test(type)) {
        const data = await moodleService.cached(`quizzes:${projectId}:${courseId}`,
          () => moodleService.getQuizzes(projectId, [courseId]));
        const quizzes = (data?.quizzes || []).filter((q) => String(q.course) === String(courseId));
        const quiz = quizzes.find((q) => gradeUtil.normName(q.name) === gradeUtil.normName(title))
          || quizzes.find((q) => gradeUtil.nameMatches(q.name, title));
        console.log('[ItemGrade] quiz:', JSON.stringify({ courseId, userId, title, available: quizzes.map((q) => q.name), matched: quiz?.name || null }));
        if (!quiz) return fail('not_found');

        const at = await moodleService.getUserQuizAttempts(projectId, quiz.id, userId);
        const finished = (at?.attempts || []).filter((a) => String(a.state) === 'finished');
        const last = finished[finished.length - 1];
        if (!last || last.sumgrades == null || last.sumgrades === '') {
          return response.success(res, 'grade', { graded: false, grade: null, title: quiz.name, reason: 'not_graded' }, 200);
        }
        const graded = gradeUtil.scaleQuizGrade(last.sumgrades, quiz.sumgrades, quiz.grade);
        const dispMax = Number(quiz.grade) > 0 ? gradeUtil.fmtNum(quiz.grade)
          : (Number(quiz.sumgrades) > 0 ? gradeUtil.fmtNum(quiz.sumgrades) : null);
        return response.success(res, 'grade', {
          graded: true, grade: gradeUtil.fmtNum(graded), maxgrade: dispMax, title: quiz.name
        }, 200);
      }

      const data = await moodleService.cached(`assigns:${projectId}:${courseId}`,
        () => moodleService.getAssignments(projectId, [courseId]));
      let assign = null;
      (data?.courses || []).forEach((c) => { (c.assignments || []).forEach((a) => { if (!assign && gradeUtil.nameMatches(a.name, title)) assign = a; }); });
      const available = (data?.courses || []).flatMap((c) => (c.assignments || []).map((a) => a.name));
      console.log('[ItemGrade] assign:', JSON.stringify({ courseId, userId, title, available, matched: assign?.name || null }));
      if (!assign) return fail('not_found');

      const ss = await moodleService.getAssignmentSubmissionStatus(projectId, assign.id, userId);
      const fb = ss?.feedback || {};
      const la = ss?.lastattempt || {};
      const sub = la.submission || la.teamsubmission || {};
      const subStatus = String(sub.status || '');          // new | draft | submitted | reopened
      const gradingStatus = String(la.gradingstatus || ''); // graded | notgraded | ...
      const shown = clean(fb.gradefordisplay != null ? fb.gradefordisplay : (fb.grade && fb.grade.grade));
      const hasGrade = Boolean(shown) && !/^-+$/.test(shown) && shown.toLowerCase() !== 'null';
      // Komentar/feedback guru (plugin editor) → ditampilkan di modal.
      let fbText = '';
      (fb.plugins || []).forEach((p) => { (p.editorfields || []).forEach((ef) => { if (ef.text) fbText += ' ' + clean(ef.text); }); });
      const dispMax = Number(assign.grade) > 0 ? gradeUtil.fmtNum(assign.grade) : null;
      console.log('[ItemGrade] assign-status:', JSON.stringify({ name: assign.name, subStatus, gradingStatus, hasGrade, shown }));

      if (hasGrade) {
        return response.success(res, 'grade', {
          graded: true,
          grade: shown,
          // gradefordisplay kadang sudah "80 / 100" → jangan tempel maks lagi.
          maxgrade: !/\//.test(shown) ? dispMax : null,
          feedback: clean(fbText) || null,
          title: assign.name
        }, 200);
      }

      // [v0.9.70] Tugas belum bernilai → tampilkan STATUS PENGAJUAN (usulan user): tugas
      // "Belum dinilai" tetap punya info berguna (sudah terkirim / masih draft / belum kumpul).
      const submitted = subStatus === 'submitted' || subStatus === 'reopened';
      return response.success(res, 'grade', {
        graded: false,
        grade: null,
        reason: submitted ? 'not_graded' : 'not_submitted',
        submitted,
        submission_status: subStatus || null,
        grading_status: gradingStatus || null,
        feedback: clean(fbText) || null,
        title: assign.name
      }, 200);
    } catch (e) {
      console.warn('[ItemGrade] gagal:', e.message);
      return fail('error');
    }
  }),

  // [v0.9.19] Komplain Kuis — daftar soal + jawaban siswa (untuk pilih nomor + preview).
  getQuizQuestions: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const quizName = req.query.quiz || req.query.quizName || '';
    const quizId = req.query.quizId || null;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const ctx = await resolveQuizSessionContext(session);
    if (!ctx.userId || !ctx.courseId) {
      return response.success(res, 'Identitas Moodle belum terbaca', { ok: false, reason: 'no_identity' }, 200);
    }
    const result = await chatService.listStudentQuizQuestions({
      projectId: ctx.projectId, courseId: ctx.courseId, userId: ctx.userId, quizName, quizId
    });
    return response.success(res, 'Soal kuis', result, 200);
  }),

  // [v0.9.19] Komplain Kuis — jalankan analisis sengketa (quizId/nama + slot) → balasan AI.
  submitQuizDispute: asyncHandler(async (req, res) => {
    const { sessionId, quiz, quizId, slot } = req.body || {};
    if (!sessionId || !slot) return response.error(res, 'sessionId & slot diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const ctx = await resolveQuizSessionContext(session);
    if (!ctx.userId || !ctx.courseId) {
      const msg = `Hai ${ctx.studentName},\n\nAku belum bisa mengecek karena data Moodle-mu (akun/kelas) belum terbaca. Coba buka ulang AI Buddy dari dalam VClass ya. Kalau tetap, sampaikan langsung ke gurumu.`;
      return response.success(res, 'no_identity', { botMessage: { message: msg, actions: [] } }, 200);
    }

    const r = await chatService.analyzeQuizDisputeDirect({
      projectId: ctx.projectId, courseId: ctx.courseId, userId: ctx.userId,
      quizName: quiz, quizId, slot, studentName: ctx.studentName
    });

    const WA_TEACHER = 'https://api.whatsapp.com/send/?phone=628989807094&text=' +
      encodeURIComponent(`Halo Bu/Pak Guru, saya ${ctx.studentName} mau menanyakan hasil ${quiz || 'kuis'} nomor ${slot}.`);

    let message; let actions = [];
    if (r.ok) {
      message = `Hai ${ctx.studentName},\n\n${r.message}`;
      if (r.reviewHtml) actions.push({ type: 'open_html_view', label: '🔍 Lihat soal & jawabanmu', html: r.reviewHtml, title: `${r.quizName} — No. ${slot}` });
    } else if (r.reason === 'not_attempted') {
      message = `Hai ${ctx.studentName},\n\nSepertinya kamu **belum menyelesaikan** ${r.quizName || 'kuis ini'}, jadi belum ada jawaban yang bisa aku cek. Kalau sudah mengerjakan, pastikan sudah ditekan **Selesai/Submit** ya.`;
    } else if (r.reason === 'review_unavailable' || r.reason === 'attempts_unavailable') {
      message = `Hai ${ctx.studentName},\n\nAku belum bisa membuka lembar jawaban ${r.quizName || 'kuis'} dari VClass (kemungkinan izin sistem). Untuk hal ini, paling tepat **lapor ke gurumu** ya.`;
      actions.push({ type: 'wa_teacher', label: '💬 Hubungi Guru via WhatsApp', url: WA_TEACHER });
    } else if (r.reason === 'quiz_not_found') {
      message = `Hai ${ctx.studentName},\n\nAku tidak menemukan kuis itu di VClass kelasmu. Coba pilih ulang nama kuisnya ya.`;
    } else if (r.reason === 'question_not_found') {
      message = `Hai ${ctx.studentName},\n\nNomor soal itu tidak aku temukan di ${r.quizName || 'kuis'} ini. Coba pilih nomor yang lain.`;
    } else {
      message = `Hai ${ctx.studentName},\n\nMaaf, aku belum bisa menyelesaikan pengecekan otomatis kali ini. Coba ulangi sebentar lagi, atau tanyakan ke gurumu ya.`;
      if (r.reviewHtml) actions.push({ type: 'open_html_view', label: '🔍 Lihat soal & jawabanmu', html: r.reviewHtml, title: `${r.quizName || 'Kuis'} — No. ${slot}` });
      actions.push({ type: 'wa_teacher', label: '💬 Hubungi Guru via WhatsApp', url: WA_TEACHER });
    }

    // Catat ke riwayat agar muncul di transkrip & log.
    try {
      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: `Komplain ${quiz || 'kuis'} nomor ${slot} (jawaban dinilai salah)`, intent: 'sengketa_jawaban' });
      await chatModel.createMessage({
        session_id: sessionId, role: 'assistant', message, intent: 'sengketa_jawaban',
        context_used: { response_source: r.ok ? 'ai' : 'system', used_model: 'sengketa_jawaban_form', actions }
      });
    } catch (e) { console.warn('[QuizDispute] persist gagal:', e.message); }

    console.log('[QuizDispute] submit result:', JSON.stringify({ reason: r.reason || 'ok', ctxUser: ctx.userId, ctxCourse: ctx.courseId, debug: r.debug || null }));
    return response.success(res, 'Hasil sengketa kuis', { ok: r.ok === true, reason: r.reason || null, debug: r.debug || null, botMessage: { message, actions } }, 200);
  }),

  // [v0.9.37] Opsi KELAS untuk dropdown verifikasi siswa. Value = course_id (otoritatif),
  // label = kode kelas. Tujuan: user pilih "9A" → sistem kirim course_id 13 langsung, tak
  // perlu mencocokkan string "9A" (yang dulu gagal & bikin "siswa tidak ditemukan").
  getClassOptions: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    let courseMap = {};
    try {
      const config = await moodleConfigModel.findByProjectId(session.project_id);
      courseMap = (config && config.course_map) || {};
    } catch (e) { console.warn('[ClassOptions] getConfig gagal:', e.message); }

    // Urutkan natural (8A, 8B, …, 9A). Value = course_id.
    const classes = Object.entries(courseMap)
      .map(([classCode, courseId]) => ({ class_code: String(classCode).toUpperCase(), course_id: Number(courseId) }))
      .filter((c) => c.class_code && c.course_id)
      .sort((a, b) => a.class_code.localeCompare(b.class_code, undefined, { numeric: true }));

    return response.success(res, 'Opsi kelas', { classes }, 200);
  }),

  // [v0.9.26 #A] Daftar siswa terdaftar (enrolled) di course sesi — untuk dropdown fallback
  // saat nama tak terbaca dari widget. Siswa memilih dirinya → kita dapat moodle_user_id BENAR.
  getCourseStudents: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const projectId = session.project_id;
    const pageCtx = session.page_context || {};
    const meta = pageCtx.session_meta || {};
    const courseCtx = session.course_context || {};
    const classCode = lmsContextService.getClassCodeFromSession(session);
    let courseId = meta.course_id || courseCtx.course_id || pageCtx.course_id || null;
    if (!courseId && classCode) {
      try { const route = await lmsRouteModel.findCourseRoute(projectId, classCode); courseId = route?.course_id || null; } catch (_) {}
    }
    if (!courseId) return response.success(res, 'Course belum terdeteksi', { course_id: null, students: [] }, 200);

    let users = [];
    try { users = await moodleService.getEnrolledUsers(projectId, courseId); }
    catch (e) { console.warn('[CourseStudents] getEnrolledUsers gagal:', e.message); return response.success(res, 'Gagal memuat peserta', { course_id: courseId, students: [] }, 200); }

    const isStudent = (u) => {
      const roles = Array.isArray(u.roles) ? u.roles : [];
      if (!roles.length) return true; // tak ada info role → ikutkan
      return roles.some((r) => /student|siswa/i.test(String(r.shortname || r.name || '')));
    };
    const students = (Array.isArray(users) ? users : [])
      .filter(isStudent)
      .map((u) => ({
        id: u.id,
        fullname: u.fullname || [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || ('Siswa ' + u.id),
        email: u.email || ''
      }))
      .filter((u) => u.id && u.fullname)
      .sort((a, b) => String(a.fullname).localeCompare(String(b.fullname)));

    return response.success(res, 'Daftar siswa course', { course_id: courseId, students }, 200);
  }),

  // [v0.9.26 #A] Set identitas siswa pada sesi (dipakai form fallback nama).
  identifyStudent: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { moodle_user_id, display_name, email, course_id, class_code } = req.body || {};
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const pageCtx = session.page_context || {};
    const meta = { ...(pageCtx.session_meta || {}) };
    if (moodle_user_id != null && moodle_user_id !== '') meta.moodle_user_id = moodle_user_id;
    if (email) meta.email = email;
    if (display_name) meta.display_name = display_name;
    if (course_id != null && course_id !== '') meta.course_id = course_id;
    if (class_code) meta.class_code = class_code;
    meta.identity_source = 'manual_fallback';

    const newPageCtx = { ...pageCtx, session_meta: meta };
    await chatModel.updateSession(sessionId, {
      page_context: newPageCtx,
      student_alias: display_name || session.student_alias
    });
    return response.success(res, 'Identitas siswa diperbarui', { session_meta: meta }, 200);
  }),

  getHistory: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const history = await chatModel.getHistory(sessionId);
    return response.success(res, 'Riwayat chat berhasil diambil', history, 200);
  }),

  getAiUsage: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const usage = aiRateLimitService.getStatus(sessionId);
    return response.success(res, 'Status penggunaan AI berhasil diambil', usage, 200);
  }),

  getAiQueueStatus: asyncHandler(async (req, res) => {
    return response.success(res, 'Status antrean AI berhasil diambil', {
      queue: aiQueueService.getStatus()
    }, 200);
  }),

  // [v0.9.1] Pemakaian AI GLOBAL (gabungan semua user) hari ini — untuk bar di FE.
  getGlobalAiUsage: asyncHandler(async (req, res) => {
    const usage = aiRateLimitService.getGlobalUsage();
    return response.success(res, 'Pemakaian AI bersama berhasil diambil', usage, 200);
  }),

  getSessionById: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi chat tidak ditemukan', null, 404);

    return response.success(res, 'Session berhasil diambil', { session }, 200);
  }),

  getSuggestions: asyncHandler(async (req, res) => {
    const { projectKey, pageType, trigger } = req.query;
    if (!projectKey || !trigger) return response.error(res, 'projectKey dan trigger diperlukan', null, 400);

    const projectId = await chatModel.getProjectIdByKey(projectKey);
    const suggestions = await ruleService.getSuggestions(projectId, pageType || 'guest_home', trigger.toLowerCase());

    return response.success(res, 'Suggestions retrieved', suggestions, 200);
  }),

  unlockChat: asyncHandler(async (req, res) => {
    const { sessionId, key } = req.body;
    const validEnvKey = process.env.AI_SAFETY_UNLOCK_KEY || 'GURU123';

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Session tidak ditemukan', null, 404);

    const safetyState = session.page_context?.safety_state || {};
    let isValid = false;

    // 1. Validasi Kunci Dinamis
    if (safetyState.unlock_key) {
      if (safetyState.unlock_key === key) {
        if (safetyState.unlock_key_used) return response.error(res, 'Key sudah terpakai.', null, 403);
        if (new Date(safetyState.unlock_key_expires_at) < new Date()) return response.error(res, 'Key sudah kedaluwarsa.', null, 403);
        isValid = true;
      }
    }

    // 2. Fallback Kunci Statik (Environment)
    if (!isValid && key === validEnvKey) {
      isValid = true;
    }

    if (!isValid) return response.error(res, 'Key guru salah.', null, 403);

    // Proses Unlock
    safetyState.locked = false;
    safetyState.warnings = 0;
    safetyState.unlock_key_used = true; // Tandai hangus jika pakai dinamis

    const pageContext = { ...session.page_context, safety_state: safetyState };
    await chatModel.updateSession(sessionId, { page_context: pageContext });

    return response.success(res, 'Akses chat berhasil dibuka', { unlocked: true }, 200);
  }),

  // FUNGSI BARU: Simpan Nama Siswa
  updateProfile: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { student_name } = req.body;

    if (!student_name) return response.error(res, 'Nama tidak boleh kosong', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    await chatModel.updateSession(sessionId, { student_alias: student_name });
    return response.success(res, 'Profil berhasil diperbarui', { student_alias: student_name }, 200);
  }),
  updateSessionContext: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { pageContext, sourceUrl } = req.body;

    if (!sessionId) return response.error(res, 'sessionId diperlukan', null, 400);
    if (!pageContext) return response.error(res, 'pageContext diperlukan', null, 400);

    const session = await chatModel.getSessionById(sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    // Ambil data penting dari konteks lama agar tidak tertimpa
    const existingContext = session.page_context || {};
    const safetyState = existingContext.safety_state || { warnings: 0, locked: false, burnout_count: 0 };
    const sessionMeta = existingContext.session_meta || {};

    // Merge konteks baru dengan state keamanan lama
    const updatedContext = {
      ...pageContext,
      session_meta: sessionMeta,
      safety_state: safetyState
    };

    const updateData = { page_context: updatedContext };
    if (sourceUrl) {
      updateData.source_url = sourceUrl;
    }

    await chatModel.updateSession(sessionId, updateData);

    return response.success(res, 'Konteks sesi berhasil diperbarui', { page_context: updatedContext }, 200);
  })
};

module.exports = chatController;
