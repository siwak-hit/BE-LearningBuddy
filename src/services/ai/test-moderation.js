// Self-check [v0.9.91]: moderasi hanya menangkap makian yang benar-benar kasar.
// Jalankan: node src/services/ai/test-moderation.js
const assert = require('assert');
const moderation = require('./moderation.service');

const flagOf = (msg) => {
  const r = moderation.checkMessage(msg);
  return r.isFlagged ? r.type : null;
};

// 1. Kalimat wajar siswa TIDAK boleh diblokir (kasus yang dilaporkan).
const SAFE = [
  'kalo misalkan lagi ngerjain quis di moodle terus batre hp abis dan tiba tiba mati maka quisnya gimana tuh ? kan belum sempet ngumpulin ?',
  'laptop saya tiba tiba mati saat ujian, gimana?',
  'kenapa file tugas saya rusak waktu diupload?',
  'apa itu media sosial?',
  'jelaskan lebih detail tentang CMS',
  'kalau internet putus saat kuis gimana?',
  'apa itu anjing laut?',
  'kenapa babi tidak boleh dimakan dalam agama tertentu?',
  'apa dampak serangan siber pada website sekolah?',
  'bagaimana cara menghancurkan virus di komputer?'
];
SAFE.forEach((msg) => assert.strictEqual(flagOf(msg), null, `harus lolos: ${msg}`));

// 2. Makian bermakna tunggal HARUS ketangkap, termasuk versi angka.
const PROFANE = ['dasar bego', 'lu tolol banget', 'goblok', 'beg0 banget', 't0l0l', 'g0bl0k lu', 'dungu', 'kontol', 'memek', 'bangsat'];
PROFANE.forEach((msg) => assert.strictEqual(flagOf(msg), 'profanity', `harus kena: ${msg}`));

// 3. Nama hewan: kena hanya saat dipakai mengumpat, bukan saat ditanyakan.
assert.strictEqual(flagOf('dasar anjing lu'), 'profanity');
assert.strictEqual(flagOf('babi banget nih'), 'profanity');
assert.strictEqual(flagOf('apa itu anjing?'), null);
assert.strictEqual(flagOf('jenis monyet di Indonesia apa saja?'), null);

// 4. Ancaman ke ORANG tetap diblokir; kata kekerasan tanpa sasaran tidak.
assert.strictEqual(flagOf('gua bunuh lu'), 'hate_speech');
assert.strictEqual(flagOf('mati aja lu'), 'hate_speech');
assert.strictEqual(flagOf('agama sampah'), 'hate_speech');
assert.strictEqual(flagOf('bom itu apa sih dalam sejarah?'), null);
assert.strictEqual(flagOf('serangan DDoS itu apa?'), null);

// 5. Sensor menutup katanya saja, kalimat lain tetap terbaca.
const censored = moderation.checkMessage('kamu bego banget').censoredText;
assert.ok(!/bego/i.test(censored) && /kamu/.test(censored) && /banget/.test(censored), censored);

console.log('OK — moderasi: makian kena, kalimat wajar lolos');
