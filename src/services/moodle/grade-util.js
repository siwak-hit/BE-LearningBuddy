// [v0.9.69] Util NILAI untuk endpoint Komplain Nilai. Murni (tanpa I/O) supaya bisa
// di-self-check: `node src/services/moodle/grade-util.selfcheck.js`.

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Cocokkan nama item dari daftar aktivitas (mod.name) dgn nama dari mod_assign/mod_quiz.
// Toleran: sama persis, atau salah satu memuat yang lain (mis. "Kuis 1" vs "Kuis 1 (Remedial)").
function nameMatches(candidate, wanted) {
  const a = normName(candidate);
  const b = normName(wanted);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

// Skala nilai MENTAH kuis (attempt.sumgrades, skala jumlah bobot soal) ke skala TAMPIL
// (quiz.grade, nilai maksimum). Contoh: 8 dari 10 poin soal, maks tampil 100 -> 80.
// Tanpa info maks yang valid, kembalikan nilai apa adanya.
function scaleQuizGrade(rawSum, rawMax, dispMax) {
  const s = Number(rawSum);
  const rm = Number(rawMax);
  const dm = Number(dispMax);
  if (!Number.isFinite(s)) return null;
  if (rm > 0 && dm > 0) return (s / rm) * dm;
  return s;
}

// Angka rapi: buang desimal nol, sisakan maksimal 2 desimal.
function fmtNum(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(v) ? String(v) : String(n);
}

module.exports = { normName, nameMatches, scaleQuizGrade, fmtNum };
