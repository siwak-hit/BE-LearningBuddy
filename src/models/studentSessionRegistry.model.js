const { supabaseAdmin } = require('../config/supabase.config');

const TABLE = 'student_session_registry';
function getClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') throw new Error('[studentSessionRegistry.model] Supabase client tidak ditemukan.');
  return supabaseAdmin;
}
const cleanEmail = (value = '') => String(value || '').trim().toLowerCase();
const cleanClass = (value = '') => String(value || '').trim().toUpperCase();

const studentSessionRegistryModel = {
  async findActive(projectId, email, classCode) {
    if (!projectId || !email || !classCode) return null;
    const { data, error } = await getClient()
      .from(TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('student_email', cleanEmail(email))
      .eq('class_code', cleanClass(classCode))
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async upsert(payload = {}) {
    const now = new Date().toISOString();
    const row = {
      project_id: payload.project_id,
      session_id: payload.session_id,
      student_email: cleanEmail(payload.student_email),
      class_code: cleanClass(payload.class_code),
      student_name: payload.student_name || null,
      moodle_user_id: payload.moodle_user_id || null,
      course_id: payload.course_id || null,
      course_title: payload.course_title || null,
      is_deleted: false,
      updated_at: now
    };

    const existing = await this.findActive(row.project_id, row.student_email, row.class_code);
    if (existing) {
      const { data, error } = await getClient().from(TABLE).update(row).eq('id', existing.id).select().maybeSingle();
      if (error) throw error;
      return data;
    }

    const { data, error } = await getClient().from(TABLE).insert({ ...row, created_at: now }).select().maybeSingle();
    if (error) throw error;
    return data;
  },

  async softDeleteBySession(sessionId) {
    const { data, error } = await getClient()
      .from(TABLE)
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .select();
    if (error) throw error;
    return data || [];
  }
};

module.exports = studentSessionRegistryModel;
