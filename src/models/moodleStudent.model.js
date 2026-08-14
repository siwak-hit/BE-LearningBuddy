const { supabaseAdmin } = require('../config/supabase.config');

const TABLE = 'moodle_students';

// Buang karakter yang bisa merusak/menginjeksi sintaks filter PostgREST .or().
function sanitizeOrValue(value = '') {
  return String(value || '').replace(/[,()*]/g, '').trim();
}

const moodleStudentModel = {
  // Ganti seluruh isi direktori siswa project ini (delete-all lalu insert batch).
  async replaceForProject(projectId, rows = []) {
    if (!projectId) return 0;
    const del = await supabaseAdmin.from(TABLE).delete().eq('project_id', projectId);
    if (del.error) throw del.error;
    if (!rows.length) return 0;

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await supabaseAdmin.from(TABLE).insert(slice);
      if (error) throw error;
      inserted += slice.length;
    }
    return inserted;
  },

  // [v0.9.85] Ganti isi direktori HANYA untuk SATU course (delete course itu lalu insert).
  // Dipakai saat sinkron dipicu siswa (klik widget) — cuma menyegarkan kelas siswa itu tanpa
  // menghapus baris course lain (beda dgn replaceForProject yang wipe seluruh project).
  async replaceForCourse(projectId, courseId, rows = []) {
    if (!projectId || !courseId) return 0;
    const del = await supabaseAdmin
      .from(TABLE).delete().eq('project_id', projectId).eq('course_id', Number(courseId));
    if (del.error) throw del.error;
    if (!rows.length) return 0;

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await supabaseAdmin.from(TABLE).insert(slice);
      if (error) throw error;
      inserted += slice.length;
    }
    return inserted;
  },

  // Apakah direktori project ini sudah terisi (sudah pernah sinkron)?
  async existsForProject(projectId) {
    if (!projectId) return false;
    const { data, error } = await supabaseAdmin
      .from(TABLE).select('id').eq('project_id', projectId).limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  },

  // Cari siswa via email / username / idnumber / local-part email (email kadang
  // disembunyikan Moodle → username yang dipakai). Query terindeks, balikin semua baris
  // (satu siswa bisa di >1 course).
  async findByIdentifier(projectId, identifier) {
    if (!projectId || !identifier) return [];
    const id = String(identifier).trim().toLowerCase();
    const local = id.split('@')[0];
    const vId = sanitizeOrValue(id);
    const vLocal = sanitizeOrValue(local);
    const orParts = [
      `email.eq.${vId}`,
      `username.eq.${vId}`,
      `idnumber.eq.${vId}`,
      `username.eq.${vLocal}`,
      `idnumber.eq.${vLocal}`
    ];
    const { data, error } = await supabaseAdmin
      .from(TABLE).select('*').eq('project_id', projectId).or(orParts.join(','));
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  },

  async findByUserId(projectId, userId) {
    if (!projectId || userId == null || userId === '') return [];
    const { data, error } = await supabaseAdmin
      .from(TABLE).select('*').eq('project_id', projectId).eq('moodle_user_id', userId);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  },

  // SEMUA course milik satu siswa. Identifikasi via email/username/idnumber, lalu EXPAND via
  // moodle_user_id — karena email kadang cuma terisi di sebagian baris course (privasi Moodle
  // tak konsisten per-course), siswa bisa salah terdeteksi hanya enroll di 1 kelas.
  async findRowsForStudent(projectId, { email = '', userId = null } = {}) {
    if (!projectId) return [];
    let seed = [];
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail) seed = await this.findByIdentifier(projectId, cleanEmail);
    if (!seed.length && userId != null && userId !== '') seed = await this.findByUserId(projectId, userId);
    if (!seed.length) return [];
    const uid = (seed.find((r) => r.email === cleanEmail) || seed[0]).moodle_user_id;
    return this.findByUserId(projectId, uid);
  }
};

module.exports = moodleStudentModel;
