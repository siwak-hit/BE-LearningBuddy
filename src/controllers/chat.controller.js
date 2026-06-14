const chatModel = require('../models/chat.model');
const asyncHandler = require('../utils/async-handler');
const response = require('../utils/response');
const crypto = require('crypto');
const chatService = require('../services/chat/chat.service');
const aiRateLimitService = require('../services/ai/aiRateLimit.service');
const aiQueueService = require('../services/ai/aiQueue.service');
const ruleService = require('../services/chat/rule.service');

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

    const sessionData = {
      project_id: projectId,
      session_key: sessionKey,
      source_url: sourceUrl || null,
      page_context: finalPageContext,
      course_context: courseContext || null,
      student_alias: displayName
    };

    const newSession = await chatModel.createSession(sessionData);
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
    const { sessionId, message, pageContext, elementContext, expectedSourceType, forceAI, forceFAQ, responseMode, intent } = req.body;

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
      intent: intent || null // Mengatasi error undefined intent
    });

    return response.success(res, 'Pesan berhasil diproses', result, 200);
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
