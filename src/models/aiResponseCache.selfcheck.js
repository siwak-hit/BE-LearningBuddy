// Self-check semantic cache: `node src/models/aiResponseCache.selfcheck.js`
// Menjaga matematika cosine + logika ambang. Tanpa jaringan/DB — pakai vektor buatan.
const assert = require('assert');
const { cosine } = require('./aiResponseCache.model');

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Vektor identik → 1.
assert.ok(approx(cosine([1, 2, 3], [1, 2, 3]), 1), 'identik harus 1');
// Berlawanan arah → -1.
assert.ok(approx(cosine([1, 0], [-1, 0]), -1), 'berlawanan harus -1');
// Ortogonal → 0.
assert.ok(approx(cosine([1, 0], [0, 1]), 0), 'ortogonal harus 0');
// Bentuk tak valid → 0 (tidak melempar).
assert.strictEqual(cosine([1, 2], [1, 2, 3]), 0, 'panjang beda harus 0');
assert.strictEqual(cosine(null, [1]), 0, 'null harus 0');
assert.strictEqual(cosine([0, 0], [0, 0]), 0, 'vektor nol harus 0');

// Simulasi keputusan ambang 0.88: parafrase (arah mirip) HIT, beda topik MISS.
const q = [0.9, 0.1, 0.2];
const paraphrase = [0.88, 0.12, 0.22]; // hampir searah
const beda = [0.1, 0.9, -0.3];         // arah lain
const T = 0.88;
assert.ok(cosine(q, paraphrase) >= T, 'parafrase harus lolos ambang (HIT)');
assert.ok(cosine(q, beda) < T, 'beda topik harus di bawah ambang (MISS)');

console.log('aiResponseCache semantic-cache self-check OK');
