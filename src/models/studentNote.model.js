const { supabaseAdmin } = require('../config/supabase.config');

const TABLE = 'student_notes';

function getClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error('[studentNote.model] Supabase client tidak ditemukan.');
  }
  return supabaseAdmin;
}

function clean(value = '') {
  return String(value || '').trim();
}

const studentNoteModel = {
  async list({ projectId, sessionId, studentEmail, classCode, q = '', page = 1, limit = 5 }) {
    const safePage = Math.max(1, Number(page || 1));
    const safeLimit = Math.min(20, Math.max(1, Number(limit || 5)));
    const from = (safePage - 1) * safeLimit;
    const to = from + safeLimit - 1;

    let query = getClient()
      .from(TABLE)
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (studentEmail) query = query.eq('student_email', clean(studentEmail).toLowerCase());
    else if (sessionId) query = query.eq('session_id', sessionId);

    if (classCode) query = query.eq('class_code', clean(classCode).toUpperCase());
    if (q) query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`);

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: data || [], total: count || 0, page: safePage, limit: safeLimit };
  },

  async create(payload = {}) {
    const now = new Date().toISOString();
    const row = {
      project_id: payload.project_id,
      session_id: payload.session_id || null,
      student_email: clean(payload.student_email).toLowerCase() || null,
      student_name: clean(payload.student_name) || null,
      class_code: clean(payload.class_code).toUpperCase() || null,
      title: clean(payload.title),
      content: clean(payload.content),
      is_deleted: false,
      created_at: now,
      updated_at: now
    };
    const { data, error } = await getClient().from(TABLE).insert(row).select().maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(id, payload = {}) {
    const row = {
      title: clean(payload.title),
      content: clean(payload.content),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await getClient().from(TABLE).update(row).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data;
  },

  async softDelete(id) {
    const { data, error } = await getClient()
      .from(TABLE)
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
};

module.exports = studentNoteModel;
