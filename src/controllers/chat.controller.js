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
const lmsRouteModel = require('../models/lmsRoute.model');
const difficultyService = require('../services/ai/difficulty.service');
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

const chatController = {
  createSession: asyncHandler(async (req, res) => {
    const { projectKey, sourceUrl, courseContext, pageContext, studentAlias, moodleContext } = req.body;
    if (!projectKey) return response.error(res, 'projectKey diperlukan', null, 400);

    const projectId = await chatModel.getProjectIdByKey(projectKey);
    if (!projectId) return response.error(res, 'Project tidak ditemukan', null, 404);

    const sessionKey = `sess_${crypto.randomBytes(8).toString('hex')}`;
    const shortCode = sessionKey.substring(5, 8).toUpperCase();

    // Mapping Moodle Course ID ke Kelas
    const courseMap = { '2': '8A', '3': '8B', '4': '8C', '6': '8D', '7': '8E', '9': '8F', '8': '8G', '5': '8H' };
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

    // Pembuatan Display Name Otomatis (Memprioritaskan nama auto-detect dari Moodle)
    let displayName = `Pengunjung #${shortCode}`;
    if (autoStudentName) {
      displayName = autoStudentName;
    } else if (studentAlias) {
      displayName = studentAlias;
    } else if (pageContext?.heading) {
      displayName += ` - ${pageContext.heading}`;
    } else if (pageContext?.title) {
      displayName += ` - ${pageContext.title}`;
    } else if (sourceUrl) {
      const urlObj = new URL(sourceUrl);
      displayName += ` - ${urlObj.hostname}`;
    }

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

    if (studentEmail && studentClass) {
      try {
        const existing = await studentSessionRegistryModel.findActive(projectId, studentEmail, studentClass);
        if (existing?.session_id && isSameJakartaDay(existing.updated_at)) {
          const reused = await chatModel.getSessionById(existing.session_id);
          if (reused) {
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

    const sessionData = {
      project_id: projectId,
      session_key: sessionKey,
      source_url: sourceUrl || null,
      page_context: finalPageContext,
      course_context: courseContext || null,
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
    const MATERI_MODNAMES = ['page', 'resource', 'book', 'url', 'folder'];

    // [v0.7.3] Status penyelesaian materi OLEH SISWA (core_completion_get_activities_completion_status).
    // Hanya materi yang sudah DISELESAIKAN siswa yang masuk daftar @materi.
    const moodleUserId = meta.moodle_user_id || null;
    const completionByCmid = new Map();
    if (moodleUserId) {
      try {
        const compRes = await moodleService.getActivitiesCompletionStatus(projectId, courseId, moodleUserId);
        const statuses = Array.isArray(compRes?.statuses) ? compRes.statuses : [];
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
    (Array.isArray(sections) ? sections : []).forEach((section) => {
      (section.modules || []).forEach((mod) => {
        if (!MATERI_MODNAMES.includes(String(mod.modname || '').toLowerCase())) return;
        if (mod.visible === 0) return; // disembunyikan instruktur
        const title = decodeEntities(mod.name);
        if (!title) return;
        const availabilityInfo = stripHtml(mod.availabilityinfo);
        // PENTING: uservisible/availabilityinfo dari core_course_get_contents itu
        // perspektif TOKEN (admin), BUKAN siswa. Jadi tidak dipakai sebagai status
        // kunci siswa kalau kita sudah punya data completion siswa.
        const tokenLocked = mod.uservisible === false || Boolean(availabilityInfo);
        const completed = isCompleted(completionByCmid.get(Number(mod.id)));

        // [v0.7.3] Filter: hanya materi yang sudah DISELESAIKAN siswa.
        // Tanpa identitas Moodle siswa → fallback ke materi yang terbuka (perspektif token).
        if (moodleUserId) {
          if (!completed) return;
        } else if (tokenLocked) {
          return;
        }

        // Materi yang sudah diselesaikan PASTI bisa diakses siswa → jangan ditandai terkunci.
        const locked = moodleUserId ? false : tokenLocked;

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

    return response.success(res, 'Materi kelas berhasil diambil', materials, 200);
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
