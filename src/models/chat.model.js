const supabaseService = require('../services/supabase/supabase.service');

const chatModel = {
  // Mengambil project_id berdasarkan project_key
  async getProjectIdByKey(projectKey) {
    const widgetConfig = await supabaseService.findOne('widget_configs', { project_key: projectKey });
    return widgetConfig?.project_id;
  },

  // Membuat session baru
  async createSession(sessionData) {
    return supabaseService.create('chat_sessions', sessionData);
  },

  // Menyimpan pesan
  async createMessage(messageData) {
    return supabaseService.create('chat_messages', messageData);
  },

  // Mengambil riwayat percakapan
  async getHistory(sessionId) {
    return supabaseService.findMany('chat_messages', { session_id: sessionId });
  },

  // Mengambil session berdasarkan ID
  async getSessionById(sessionId) {
    // Menggunakan fungsi findById dari supabaseService
    return supabaseService.findById('chat_sessions', sessionId);
  },

  async updateSession(sessionId, updateData) {
    return supabaseService.update('chat_sessions', { id: sessionId }, updateData);
  },

  // Menyimpan log moderasi
  async logModeration(payload) {
    // Menggunakan fungsi create dari supabaseService
    return supabaseService.create('moderation_logs', payload);
  }
};

module.exports = chatModel;
