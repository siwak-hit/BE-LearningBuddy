// Self-check [v0.9.90]: FAQ harus MENANG atas panduan bergambar.
// Jalankan: node src/services/chat/test-faq-first.js
const assert = require('assert');
const chatService = require('./chat.service');

const findMatchingFaq = chatService._findMatchingFaq;

const FAQS = [
  { question: 'Virtual Class bisa login kapan saja?', answer: 'Bisa, VClass dapat diakses 24 jam.' },
  { question: 'Apakah nilai kuis langsung muncul?', answer: 'Nilai kuis pilihan ganda muncul otomatis.' },
  { question: 'Kenapa tugas saya tidak bisa diunggah?', answer: 'Cek ukuran dan format file tugasnya.' },
  // FAQ nyata di DB yang paling berisiko "menelan" tombol sidebar Cara Login.
  { question: 'Cara login ke Virtual Class gimana?', answer: 'Buka halaman login lalu isi akunmu.' },
  { question: 'FAQ tanpa jawaban', answer: '' }
];

// 1. Contoh pertanyaan FAQ (persis seperti di tabel "konteks yang bisa ditanya") harus cocok.
assert.strictEqual(findMatchingFaq(FAQS, 'Virtual Class bisa login kapan saja?').answer, 'Bisa, VClass dapat diakses 24 jam.');
assert.strictEqual(findMatchingFaq(FAQS, 'apakah nilai kuis langsung muncul').answer, 'Nilai kuis pilihan ganda muncul otomatis.');

// 2. Pertanyaan "cara" murni TIDAK boleh nyangkut ke FAQ — itu tetap milik panduan bergambar.
// Termasuk pesan tombol sidebar "Cara Login", walau ada FAQ yang bunyinya mirip.
assert.strictEqual(findMatchingFaq(FAQS, 'Cara login ke VClass'), null);
assert.strictEqual(findMatchingFaq(FAQS, 'Cara melihat nilai di VClass'), null);
assert.strictEqual(findMatchingFaq(FAQS, 'Cara mengumpulkan tugas di VClass'), null);

// 3. Satu kata kunci saja tidak cukup untuk mengklaim FAQ.
assert.strictEqual(findMatchingFaq(FAQS, 'login'), null);
assert.strictEqual(findMatchingFaq(FAQS, 'nilai kuis'), null);

// 4. FAQ tanpa jawaban diabaikan (kalau tidak, siswa dapat balasan kosong).
assert.strictEqual(findMatchingFaq(FAQS, 'FAQ tanpa jawaban'), null);

// 5. Input tak wajar tidak boleh melempar error.
assert.strictEqual(findMatchingFaq(null, 'apa pun'), null);
assert.strictEqual(findMatchingFaq(FAQS, ''), null);

// 6. Manifest aset panduan: tiap tutorial punya video + minimal 1 gambar.
const assets = chatService.getTutorialAssets();
assert.ok(assets.length >= 8, 'jumlah panduan berkurang tak terduga');
assets.forEach((tut) => {
  assert.ok(/^\/VIDEOS\/.+\.mp4$/.test(tut.video), `video ${tut.key} tak ikut konvensi nama`);
  assert.ok(tut.images.length > 0, `panduan ${tut.key} tak punya gambar`);
});

console.log('OK — FAQ-first + manifest aset panduan');
