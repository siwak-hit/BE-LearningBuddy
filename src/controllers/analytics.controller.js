// src/controllers/analytics.controller.js
// [v0.8.3] Fase 3 — Analitik Pembelajaran untuk dashboard guru/admin.
// Mengagregasi: distribusi tingkat kesulitan, topik tersulit, efektivitas rekomendasi,
// dan efisiensi sistem (sistem/cache vs AI). Dihitung on-demand dari log interaksi.

const { supabaseAdmin } = require('../config/supabase.config');
const asyncHandler = require('../utils/async-handler');
const response = require('../utils/response');
const difficultyService = require('../services/ai/difficulty.service');
const evaluationService = require('../services/ai/evaluation.service');
const susResponseModel = require('../models/susResponse.model');

const INTENT_LABELS = {
  bantuan_tugas: 'Tugas', cek_tugas_belum_selesai: 'Tugas', bantuan_kumpul_tugas: 'Tugas', buka_aktivitas: 'Aktivitas',
  bantuan_forum: 'Forum', cek_forum_belum_dijawab: 'Forum',
  bantuan_kuis: 'Kuis', bantuan_quiz: 'Kuis', cek_quiz_belum_dikerjakan: 'Kuis',
  bantuan_login: 'Login', bantuan_logout: 'Logout',
  penjelasan_materi: 'Materi / Penjelasan', akses_materi: 'Akses Materi',
  bantuan_lihat_nilai: 'Nilai', navigasi_kursus: 'Navigasi Kursus',
  cek_deadline_hari_ini: 'Deadline', cek_deadline_terdekat: 'Deadline',
  general_learning_help: 'Bantuan Umum', bantuan_umum: 'Bantuan Umum',
  out_of_context: 'Di Luar Konteks', bantuan_burnout: 'Kelelahan/Burnout', hubungi_guru: 'Hubungi Guru'
};
const intentLabel = (i) => INTENT_LABELS[i] || (i ? String(i).replace(/_/g, ' ') : 'Lainnya');

function emptyAnalytics() {
  return {
    totals: { sessions: 0, messages: 0, students: 0, resolved_feedback: 0, escalated_sessions: 0 },
    difficulty_distribution: { lancar: 0, mulai_bingung: 0, kesulitan: 0 },
    top_confusing_topics: [], top_topics: [],
    answer_sources: { system: 0, ai: 0, cache: 0, total: 0 },
    efficiency: { system_pct: 0, ai_pct: 0 },
    recommendation: { acceptance_pct: 0 }
  };
}

// Helper: ambil sesi + pesan-pesannya (dipakai analitik & ekspor evaluasi).
async function fetchSessionsAndMessages(projectId) {
  let sQuery = supabaseAdmin
    .from('chat_sessions')
    .select('id, project_id, student_alias, page_context, started_at')
    .order('started_at', { ascending: false })
    .limit(300);
  if (projectId && projectId !== 'all') sQuery = sQuery.eq('project_id', projectId);

  const { data: sessions, error: sErr } = await sQuery;
  if (sErr) throw sErr;
  const sessionIds = (sessions || []).map((s) => s.id);
  if (!sessionIds.length) return { sessions: [], bySession: new Map() };

  const { data: messages, error: mErr } = await supabaseAdmin
    .from('chat_messages')
    .select('session_id, role, message, intent, context_used, created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: true })
    .limit(8000);
  if (mErr) throw mErr;

  const bySession = new Map();
  (messages || []).forEach((m) => {
    if (!bySession.has(m.session_id)) bySession.set(m.session_id, []);
    bySession.get(m.session_id).push(m);
  });
  return { sessions, bySession };
}

const analyticsController = {
  getLearningAnalytics: asyncHandler(async (req, res) => {
    const { projectId } = req.query;

    // 1) Ambil sesi (terbaru) untuk project terkait.
    let sQuery = supabaseAdmin
      .from('chat_sessions')
      .select('id, project_id, student_alias, page_context, started_at')
      .order('started_at', { ascending: false })
      .limit(300);
    if (projectId && projectId !== 'all') sQuery = sQuery.eq('project_id', projectId);

    const { data: sessions, error: sErr } = await sQuery;
    if (sErr) throw sErr;
    const sessionIds = (sessions || []).map((s) => s.id);
    if (!sessionIds.length) return response.success(res, 'Belum ada data', emptyAnalytics(), 200);

    // 2) Ambil semua pesan untuk sesi-sesi itu (1 query).
    const { data: messages, error: mErr } = await supabaseAdmin
      .from('chat_messages')
      .select('session_id, role, message, intent, context_used, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: true })
      .limit(8000);
    if (mErr) throw mErr;

    const bySession = new Map();
    (messages || []).forEach((m) => {
      if (!bySession.has(m.session_id)) bySession.set(m.session_id, []);
      bySession.get(m.session_id).push(m);
    });

    // 3) Agregasi.
    const levelDist = { lancar: 0, mulai_bingung: 0, kesulitan: 0 };
    const intentStruggle = {};
    const intentAll = {};
    let sourceSystem = 0; let sourceAI = 0; let sourceCache = 0;
    let resolvedFeedback = 0; let escalatedSessions = 0;
    const students = new Set();

    (sessions || []).forEach((s) => {
      students.add(s.student_alias || s.id);
      const msgs = bySession.get(s.id) || [];
      const burnoutCount = s.page_context?.safety_state?.burnout_count || 0;
      const lastResolvedAt = s.page_context?.last_resolved_at || null;
      const diff = difficultyService.analyze(msgs, { burnoutCount, lastResolvedAt });

      levelDist[diff.level] = (levelDist[diff.level] || 0) + 1;
      const struggled = diff.level !== 'lancar' || diff.signals.frustration > 0 || diff.signals.repeated > 0;
      if (diff.level !== 'lancar') escalatedSessions += 1;

      const fb = Array.isArray(s.page_context?.scoring_feedback) ? s.page_context.scoring_feedback : [];
      resolvedFeedback += fb.filter((f) => f && f.type === 'resolved').length;

      msgs.forEach((m) => {
        if (m.role === 'user' && m.intent) {
          intentAll[m.intent] = (intentAll[m.intent] || 0) + 1;
          if (struggled) intentStruggle[m.intent] = (intentStruggle[m.intent] || 0) + 1;
        }
        if (m.role === 'assistant') {
          const usedModel = m.context_used?.used_model;
          const src = m.context_used?.response_source;
          if (usedModel === 'cache') sourceCache += 1;
          else if (src === 'ai') sourceAI += 1;
          else sourceSystem += 1;
        }
      });
    });

    const topList = (obj, n = 6) => Object.entries(obj)
      .sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => ({ intent: k, label: intentLabel(k), count: v }));

    const totalAnswers = sourceSystem + sourceAI + sourceCache;

    return response.success(res, 'Analitik pembelajaran berhasil diambil', {
      totals: {
        sessions: (sessions || []).length,
        messages: (messages || []).length,
        students: students.size,
        resolved_feedback: resolvedFeedback,
        escalated_sessions: escalatedSessions
      },
      difficulty_distribution: levelDist,
      top_confusing_topics: topList(intentStruggle),
      top_topics: topList(intentAll),
      answer_sources: { system: sourceSystem, ai: sourceAI, cache: sourceCache, total: totalAnswers },
      efficiency: {
        system_pct: totalAnswers ? Math.round(((sourceSystem + sourceCache) / totalAnswers) * 100) : 0,
        ai_pct: totalAnswers ? Math.round((sourceAI / totalAnswers) * 100) : 0
      },
      recommendation: {
        acceptance_pct: escalatedSessions ? Math.round((Math.min(resolvedFeedback, escalatedSessions) / escalatedSessions) * 100) : 0
      }
    }, 200);
  }),

  // [v0.8.4] Ekspor dataset prediksi per sesi untuk diberi label asli oleh peneliti.
  exportEvaluationDataset: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const { sessions, bySession } = await fetchSessionsAndMessages(projectId);

    const rows = (sessions || []).map((s) => {
      const msgs = bySession.get(s.id) || [];
      const burnoutCount = s.page_context?.safety_state?.burnout_count || 0;
      const lastResolvedAt = s.page_context?.last_resolved_at || null;
      const diff = difficultyService.analyze(msgs, { burnoutCount, lastResolvedAt });
      const firstQ = String(msgs.find((m) => m.role === 'user')?.message || '').replace(/\s+/g, ' ').slice(0, 140);
      return {
        session_id: s.id,
        student: s.student_alias || '',
        messages: msgs.filter((m) => m.role === 'user').length,
        score: diff.score,
        predicted: diff.level,
        repeated: diff.signals.repeated,
        frustration: diff.signals.frustration,
        same_intent_streak: diff.signals.same_intent_streak,
        burnout: diff.signals.burnout,
        sample_question: firstQ,
        actual: '' // <- diisi peneliti (lancar / mulai_bingung / kesulitan)
      };
    });

    return response.success(res, 'Dataset evaluasi', { rows, count: rows.length }, 200);
  }),

  // [v0.8.4] Hitung metrik dari pasangan (prediksi, label asli) yang dikirim FE.
  computeEvaluation: asyncHandler(async (req, res) => {
    const { pairs } = req.body;
    if (!Array.isArray(pairs) || !pairs.length) {
      return response.error(res, 'pairs (array of {predicted, actual}) diperlukan', null, 400);
    }
    const metrics = evaluationService.computeMetrics(pairs);
    if (!metrics.n) {
      return response.error(res, 'Tidak ada pasangan label valid. Pastikan kolom prediksi & label asli berisi: lancar / mulai_bingung / kesulitan.', null, 400);
    }
    return response.success(res, 'Metrik evaluasi berhasil dihitung', metrics, 200);
  }),

  // [v0.9.73] Rekap jawaban SUS uji coba: daftar respons + rata-rata skor (untuk dashboard
  // guru + unduh CSV). Skor SUS 0..100; >68 = di atas rata-rata, >80 = sangat baik.
  listSus: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId || projectId === 'all') {
      return response.error(res, 'projectId diperlukan', null, 400);
    }
    const rows = await susResponseModel.listByProject(projectId);
    const scores = rows.map((r) => Number(r.score)).filter((n) => Number.isFinite(n));
    const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;
    return response.success(res, 'Rekap SUS', {
      rows,
      count: rows.length,
      average,
      min: scores.length ? Math.min(...scores) : 0,
      max: scores.length ? Math.max(...scores) : 0
    }, 200);
  })
};

module.exports = analyticsController;
