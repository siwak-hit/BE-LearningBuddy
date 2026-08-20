// Self-check disambiguasi intent + gate identitas. Jalankan: node BE/tests/intent-ambiguity.test.js
// [v0.9.93] Yang dijaga: pertanyaan AMBIGU ditawari pilihan, pertanyaan JELAS tetap dijawab
// langsung (jangan sampai setiap pesan berubah jadi menu pilihan).
const assert = require('assert');
const intentService = require('../src/services/ai/intent.service');

const ambiguous = (msg) => intentService.detectAmbiguousIntent(msg);

// --- AMBIGU: satu kata yang menunjuk >1 intent ---
const guru = ambiguous('guru');
assert.ok(guru, '"guru" harus ambigu');
const guruIntents = guru.candidates.map((c) => c.intent);
assert.ok(guruIntents.includes('hubungi_guru'), 'kandidat: hubungi_guru');
assert.ok(guruIntents.includes('cek_pengajar_course'), 'kandidat: cek_pengajar_course');
assert.ok(guru.candidates.length <= 3, 'maks 3 kandidat');
assert.strictEqual(guru.candidates[0].prompt, 'guru', 'prompt = pesan asli siswa');

// --- JELAS: aturan sudah yakin → jangan tanya balik ---
for (const msg of [
  'siapa guru course ini?',
  'hubungi guru dong',
  'gimana cara ngumpulin tugas',
  'apa itu media sosial',
  'tugas apa aja yang belum aku kerjakan'
]) {
  assert.strictEqual(ambiguous(msg), null, `"${msg}" harus dijawab langsung, bukan ditanya balik`);
}

// --- Pola AMBIGUITY_GROUPS lama tetap jalan ---
const todo = ambiguous('besok ngapain aja');
assert.ok(todo && todo.candidates.length >= 2, 'AMBIGUITY_GROUPS lama tidak boleh rusak');

// --- Intent yang tidak layak jadi tombol tidak ikut ditawarkan ---
const halo = ambiguous('halo guru');
if (halo) {
  assert.ok(!halo.candidates.some((c) => c.intent === 'small_talk'), 'small_talk bukan pilihan');
}

console.log('OK — disambiguasi intent aman');
