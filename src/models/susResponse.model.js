const { supabaseAdmin } = require('../config/supabase.config');

const TABLE = 'sus_responses';
function getClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') throw new Error('[susResponse.model] Supabase client tidak ditemukan.');
  return supabaseAdmin;
}

// Skor SUS resmi: item ganjil (positif) = jawaban-1; item genap (negatif) = 5-jawaban.
// Total kontribusi (0..40) × 2.5 → 0..100. Butuh tepat 10 jawaban skala 1..5.
function computeSusScore(answers = []) {
  if (!Array.isArray(answers) || answers.length !== 10) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = Number(answers[i]);
    if (!Number.isFinite(v) || v < 1 || v > 5) return null;
    sum += (i % 2 === 0) ? (v - 1) : (5 - v);
  }
  return Math.round(sum * 2.5 * 100) / 100;
}

const susResponseModel = {
  computeSusScore,

  async insert(payload = {}) {
    const row = {
      project_id: payload.project_id,
      session_id: payload.session_id || null,
      student_email: payload.student_email ? String(payload.student_email).trim().toLowerCase() : null,
      class_code: payload.class_code ? String(payload.class_code).trim().toUpperCase() : null,
      student_name: payload.student_name || null,
      answers: Array.isArray(payload.answers) ? payload.answers : [],
      score: Number(payload.score) || 0,
      created_at: new Date().toISOString()
    };
    const { data, error } = await getClient().from(TABLE).insert(row).select().maybeSingle();
    if (error) throw error;
    return data;
  },

  async listByProject(projectId) {
    if (!projectId) return [];
    const { data, error } = await getClient()
      .from(TABLE)
      .select('id, session_id, student_email, class_code, student_name, answers, score, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return data || [];
  }
};

module.exports = susResponseModel;
