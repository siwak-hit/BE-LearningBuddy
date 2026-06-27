// Self-check parser kuis: `node src/services/chat/quiz-parse.selfcheck.js`
const assert = require('assert');
const { _parseQuizJSON: parse, _parseQuizCount: count } = require('./chat.service');

// JSON dibungkus fence + teks → tetap keluar 2 soal valid.
const out = parse('Ini kuisnya:\n```json\n{"questions":[' +
  '{"q":"1+1?","options":["1","2","3","4"],"answer":1,"explanation":"dua"},' +
  '{"q":"warna langit?","options":["biru","hijau"],"answer":0}' +
  ']}\n```', 10);
assert(out && out.length === 2, 'harus 2 soal');
assert(out[0].answer === 1 && out[0].explanation === 'dua');

// answer di luar range / opsi kurang → soal dibuang.
const bad = parse('{"questions":[{"q":"x","options":["a"],"answer":0},{"q":"y","options":["a","b"],"answer":5}]}', 10);
assert(bad === null, 'semua invalid → null');

// clamp count.
assert(count('buat 10 soal') === 10);
assert(count('buat 99 soal') === 10);
assert(count('materi tanpa angka') === null);

console.log('quiz-parse self-check OK');
