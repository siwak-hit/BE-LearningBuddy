const { supabaseAdmin } = require('../config/supabase.config');

// [v0.9.85 Track 2] Cache kemajuan belajar PER SISWA (satu baris per siswa per course).
// last_synced_at = penanda TTL per-user → tiap siswa sinkron sendiri, tak numpang user lain.
const TABLE = 'student_content_progress';

function getClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error('[studentContentProgress.model] Supabase client tidak ditemukan dari config.');
  }
  return supabaseAdmin;
}

const studentContentProgressModel = {
  async find(projectId, moodleUserId, courseId) {
    if (!projectId || !moodleUserId || !courseId) return null;
    const { data, error } = await getClient()
      .from(TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('moodle_user_id', Number(moodleUserId))
      .eq('course_id', Number(courseId))
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async upsert(row) {
    if (!row?.project_id || !row?.moodle_user_id || !row?.course_id) {
      throw new Error('project_id, moodle_user_id, course_id wajib diisi');
    }
    const now = new Date().toISOString();
    const payload = {
      ...row,
      moodle_user_id: Number(row.moodle_user_id),
      course_id: Number(row.course_id),
      updated_at: now,
      last_synced_at: row.last_synced_at || now
    };

    const existing = await this.find(row.project_id, row.moodle_user_id, row.course_id);
    if (existing) {
      const { data, error } = await getClient()
        .from(TABLE)
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await getClient()
      .from(TABLE)
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};

module.exports = studentContentProgressModel;
