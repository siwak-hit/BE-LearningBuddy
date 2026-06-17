// src/services/ai/difficulty.service.js
// [v0.8.0] Komponen AI Skripsi — Deteksi Tingkat Kesulitan Pengguna dari POLA DIALOG
// (Learning Analytics pada asisten, BUKAN dari data performa VClass).
// Model transparan berbasis skor (explainable) → 3 level: Lancar / Mulai Bingung / Kesulitan.

const FRUSTRATION = /\b(masih bingung|tetep bingung|tetap bingung|bingung banget|gak paham|ga paham|nggak paham|tidak paham|gak ngerti|ga ngerti|nggak ngerti|tidak ngerti|gimana sih|kok gini|kok gitu|kok ga bisa|susah banget|ribet|pusing|mumet|nyerah|capek|gabisa|gak bisa|ga bisa|error terus|gimana caranya|masih gak ngerti)\b/i;

function normalize(s = '') {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenSet(s = '') {
  return new Set(normalize(s).split(/\s+/).filter((w) => w.length >= 3));
}
function jaccard(a = '', b = '') {
  const A = tokenSet(a); const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter += 1; });
  return inter / (A.size + B.size - inter);
}

const LEVELS = [
  { key: 'lancar', label: 'Lancar', min: 0 },
  { key: 'mulai_bingung', label: 'Mulai Bingung', min: 34 },
  { key: 'kesulitan', label: 'Kesulitan', min: 67 }
];

function levelFromScore(score = 0) {
  let lv = LEVELS[0];
  for (const l of LEVELS) { if (score >= l.min) lv = l; }
  return lv;
}

const difficultyService = {
  levelFromScore,

  // messages: kronologis [{ role, message, intent, context_used, created_at }]
  // opts.burnoutCount: dari safety_state sesi.
  analyze(messages = [], opts = {}) {
    let pool = Array.isArray(messages) ? messages : [];

    // [v0.8.1] Checkpoint resolusi: kalau user menekan tombol "terbantu/teratasi",
    // kesulitan sebelum titik itu dianggap sudah tertangani → hanya hitung sesudahnya.
    if (opts.lastResolvedAt) {
      const cut = new Date(opts.lastResolvedAt).getTime();
      pool = pool.filter((m) => {
        const t = m.created_at ? new Date(m.created_at).getTime() : Infinity;
        return t > cut;
      });
    }

    const recent = pool.slice(-12); // jendela analisis
    const userMsgs = recent.filter((m) => m.role === 'user');
    const questions = userMsgs.length;

    // 1) Pertanyaan berulang/mirip (sinyal "mentok").
    let repeated = 0;
    for (let i = 1; i < userMsgs.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        if (jaccard(userMsgs[i].message, userMsgs[j].message) >= 0.5) { repeated += 1; break; }
      }
    }

    // 2) Ungkapan frustrasi.
    const frustration = userMsgs.filter((m) => FRUSTRATION.test(String(m.message || ''))).length;

    // 3) Streak intent sama (mentok di satu topik).
    let streak = 0; let maxStreak = 0; let last = null;
    userMsgs.forEach((m) => {
      const it = m.intent || '';
      if (it && it === last) streak += 1; else { streak = 1; last = it; }
      if (streak > maxStreak) maxStreak = streak;
    });
    const sameIntentStreak = Math.max(0, maxStreak - 1);

    // 4) Volume pertanyaan dalam jendela.
    const volume = questions;

    // 5) Jumlah jawaban AI (untuk konteks "sudah dibantu AI tapi masih nanya").
    const aiAnswers = recent.filter((m) => m.role === 'assistant' && (m.context_used?.response_source === 'ai')).length;

    // 6) Burnout yang sudah terdeteksi sistem.
    const burnout = Number(opts.burnoutCount || 0);

    const signals = { questions, repeated, frustration, same_intent_streak: sameIntentStreak, volume, ai_answers: aiAnswers, burnout };

    // Skor berbobot (transparan, cap 0–100).
    let score = 0;
    score += Math.min(repeated, 3) * 18;          // maks 54
    score += Math.min(frustration, 3) * 16;       // maks 48
    score += Math.min(sameIntentStreak, 3) * 10;  // maks 30
    score += Math.min(burnout, 3) * 12;           // maks 36
    score += Math.max(0, volume - 4) * 4;         // tambah saat pertanyaan menumpuk
    score = Math.min(100, Math.round(score));

    const level = levelFromScore(score);
    return { score, level: level.key, level_label: level.label, signals };
  }
};

module.exports = difficultyService;
