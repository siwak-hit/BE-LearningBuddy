// Self-check gerbang cooldown: `node src/services/ai/aiRateLimit.selfcheck.js`
// Menjaga switch guru `disable_cooldown` — kalau gerbang ini bocor, siswa tetap kena
// cooldown 3× meski guru sudah mematikannya. Tanpa jaringan/DB.
const assert = require('assert');
const svc = require('./aiRateLimit.service');

const AI_MAX = svc._defaultStatus().max;

// --- Perilaku normal: request ke-N mencapai limit, lalu cooldown mengunci. ---
const normal = 'sess_normal';
for (let i = 0; i < AI_MAX; i += 1) svc.consume(normal);
assert.strictEqual(svc.getStatus(normal).limit_reached, true, 'limit harus tercapai setelah AI_MAX request');
svc.startCooldown(normal);
assert.strictEqual(svc.getStatus(normal).cooldown_active, true, 'startCooldown harus mengunci');
assert.strictEqual(svc.getStatus(normal).canUseAI, false, 'saat cooldown AI tidak boleh dipakai');

// --- Cooldown dimatikan guru: berapa pun request, status selalu bersih. ---
const bebas = 'sess_bebas';
svc.setUnlimited(bebas, true);
for (let i = 0; i < AI_MAX * 5; i += 1) svc.consume(bebas);
let s = svc.getStatus(bebas);
assert.strictEqual(s.used, 0, 'used harus tetap 0 (FE menampilkan 0/3, bukan merah)');
assert.strictEqual(s.limit_reached, false, 'limit tidak boleh tercapai');
assert.strictEqual(s.canUseAI, true, 'AI harus selalu bisa dipakai');

// startCooldown pun harus jadi no-op — kalau bocor, overlay cooldown muncul di layar siswa.
svc.startCooldown(bebas);
s = svc.getStatus(bebas);
assert.strictEqual(s.cooldown_active, false, 'startCooldown harus diabaikan saat unlimited');
assert.strictEqual(s.cooldown_remaining_seconds, 0, 'tidak boleh ada sisa detik cooldown');

// --- Guru mematikan switch lagi → pembatas kembali berlaku. ---
svc.setUnlimited(bebas, false);
for (let i = 0; i < AI_MAX; i += 1) svc.consume(bebas);
assert.strictEqual(svc.getStatus(bebas).limit_reached, true, 'pembatas harus hidup lagi setelah switch dimatikan');

// --- Sesi lain tidak boleh ikut bebas. ---
const lain = 'sess_lain';
svc.setUnlimited('sess_bebas_2', true);
for (let i = 0; i < AI_MAX; i += 1) svc.consume(lain);
assert.strictEqual(svc.getStatus(lain).limit_reached, true, 'flag harus per-sesi, bukan global');

console.log('OK: gerbang disable_cooldown aiRateLimit.service aman.');
