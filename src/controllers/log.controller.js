const LogService = require('../services/log/log.service');
const LogModel = require('../models/log.model');
const supabaseService = require('../services/supabase/supabase.service');
const response = require('../utils/response');
const asyncHandler = require('../utils/async-handler');

// Helper untuk menghindari error 22P02 UUID Supabase
function normalizeOptionalUuid(value) {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();

  if (
    !text ||
    text === 'null' ||
    text === 'undefined' ||
    text === 'all' ||
    text === 'semua'
  ) {
    return null;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(text)) {
    return null;
  }

  return text;
}

const LogController = {
  getSummary: asyncHandler(async (req, res) => {
    const projectId = normalizeOptionalUuid(req.query.projectId);

    // DEBUG LOG SEMENTARA
    console.log('[LOG FILTER RAW - SUMMARY]', req.query);
    console.log('[LOG FILTER NORMALIZED - SUMMARY]', { projectId });

    const data = await LogService.getSummary(projectId);
    return response.success(res, 'Summary logs berhasil diambil', data);
  }),

  getSessions: asyncHandler(async (req, res) => {
    const projectId = normalizeOptionalUuid(req.query.projectId);

    // Tangkap param date, buang intent
    const { q, date, moderationType } = req.query;

    const params = { ...req.query, projectId };
    const data = await LogService.getSessions(params);
    return response.success(res, 'Daftar session berhasil diambil', data);
  }),

  getSessionDetail: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const data = await LogService.getSessionDetail(sessionId);
    return response.success(res, 'Detail percakapan berhasil diambil', data);
  }),

  generateUnlockKey: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await supabaseService.findById('chat_sessions', sessionId);
    if (!session) return response.error(res, 'Sesi tidak ditemukan', null, 404);

    const safetyState = session.page_context?.safety_state || {};
    if (!safetyState.locked) return response.error(res, 'Sesi ini tidak dalam status lockdown', null, 400);

    const unlockKey = `GURU-${Math.floor(1000 + Math.random() * 9000)}`;
    const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();

    safetyState.unlock_key = unlockKey;
    safetyState.unlock_key_expires_at = expiresAt;
    safetyState.unlock_key_used = false;

    const updatedContext = { ...session.page_context, safety_state: safetyState };
    await supabaseService.updateById('chat_sessions', sessionId, { page_context: updatedContext });

    return response.success(res, 'Key guru berhasil dibuat', {
      unlock_key: unlockKey,
      expires_at: expiresAt
    });
  })
};

module.exports = LogController;
