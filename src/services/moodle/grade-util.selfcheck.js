// Self-check util nilai: `node src/services/moodle/grade-util.selfcheck.js`
const assert = require('assert');
const { nameMatches, scaleQuizGrade, fmtNum } = require('./grade-util');

// Pencocokan nama toleran (kasus asli yang dulu balik not_found).
assert(nameMatches('Tugas Praktik 1: Instalasi WordPress', 'tugas praktik 1 instalasi wordpress'));
assert(nameMatches('Kuis 2', 'kuis 2 '));
assert(nameMatches('Kuis 1 (Remedial)', 'Kuis 1'));
assert(!nameMatches('Kuis 3', 'Tugas 1'));

// Skala nilai kuis: 8 dari 10 poin, maks 100 -> 80. (Dulu tampil "8 dari 100".)
assert.strictEqual(scaleQuizGrade(8, 10, 100), 80);
assert.strictEqual(scaleQuizGrade(5, 10, 10), 5);
assert.strictEqual(scaleQuizGrade(7, 0, 0), 7); // tak ada info maks -> apa adanya

// Format angka.
assert.strictEqual(fmtNum(80.0), '80');
assert.strictEqual(fmtNum(66.666), '66.67');

console.log('grade-util self-check OK');
