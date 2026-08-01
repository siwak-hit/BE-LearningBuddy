// Self-check routing intent komplain: `node src/services/ai/intent-komplain.selfcheck.js`
const assert = require('assert');
const { _ruleBasedDetect: detect } = require('./intent.service');

// Komplain TUGAS "jawaban dianggap salah" — dulu tertangkap sengketa_jawaban (jalur kuis).
assert.strictEqual(
  detect('Aku mau komplain soal Tugas Praktik 1: Instalasi WordPress. Jawaban tugasku dianggap salah, sebenarnya salahnya di mana ya menurut materi?'),
  'evaluasi_jawaban_tugas'
);

// Komplain KUIS tetap ke sengketa_jawaban (ada kata kuis/soal/nomor).
assert.strictEqual(
  detect('Aku mau komplain soal Kuis 2. Menurut materi, jawaban aku sudah benar, tapi kok dikoreksi salah ya? Tolong cek nomor mana yang keliru.'),
  'sengketa_jawaban'
);

// Tugas + nomor soal → masih sengketa (siswa memang menunjuk nomor soal).
assert.strictEqual(
  detect('Jawaban soal nomor 3 di tugas ini salah padahal menurut materi sudah benar'),
  'sengketa_jawaban'
);

// Status upload tugas tidak ikut tergeser.
assert.strictEqual(
  detect('Tugas ini sudah aku upload/kumpulkan, tapi kok statusnya masih belum masuk ya?'),
  'cek_status_tugas'
);

console.log('intent-komplain self-check OK');
