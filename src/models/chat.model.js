const supabaseService = require('../services/supabase/supabase.service');

const chatModel = {
  // Mengambil project_id asli berdasarkan project_key dari widget_configs.
  // Catatan: project_key BUKAN project_id UUID.
  async getProjectIdByKey(projectKey) {
    if (!projectKey) return null;
    const widgetConfig = await supabaseService.findOne('widget_configs', { project_key: projectKey });
    return widgetConfig?.project_id || null;
  },

  async createSession(sessionData) {
    return supabaseService.create('chat_sessions', sessionData);
  },

  async createMessage(messageData) {
    return supabaseService.create('chat_messages', messageData);
  },

  async getHistory(sessionId) {
    // Ambil hanya kolom yang dipakai UI riwayat chat, urut kronologis.
    return supabaseService.findMany('chat_messages', { session_id: sessionId }, {
      select: 'id, role, message, intent, context_used, created_at',
      orderBy: 'created_at',
      ascending: true
    });
  },

  async getSessionById(sessionId) {
    // Kolom yang benar-benar dipakai oleh chat service & controller.
    // Catatan: tabel chat_sessions memakai started_at/ended_at (BUKAN created_at).
    return supabaseService.findById(
      'chat_sessions',
      sessionId,
      'id, project_id, session_key, source_url, page_context, course_context, student_alias, started_at, ended_at'
    );
  },

  async updateSession(sessionId, updateData) {
    return supabaseService.update('chat_sessions', { id: sessionId }, updateData);
  },

  async logModeration(payload) {
    return supabaseService.create('moderation_logs', payload);
  }
};

module.exports = chatModel;
