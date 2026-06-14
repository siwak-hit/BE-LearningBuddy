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
    return supabaseService.findMany('chat_messages', { session_id: sessionId });
  },

  async getSessionById(sessionId) {
    return supabaseService.findById('chat_sessions', sessionId);
  },

  async updateSession(sessionId, updateData) {
    return supabaseService.update('chat_sessions', { id: sessionId }, updateData);
  },

  async logModeration(payload) {
    return supabaseService.create('moderation_logs', payload);
  }
};

module.exports = chatModel;
