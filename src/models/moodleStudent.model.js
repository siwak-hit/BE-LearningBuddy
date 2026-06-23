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
  }
};

module.exports = moodleStudentModel;
