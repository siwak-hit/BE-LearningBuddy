const rateLimit = require('express-rate-limit');

const jsonMessage = (msg) => ({ status: 'error', message: msg, data: null });

// Limiter global: lapisan pertama anti-flood untuk semua endpoint /api.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Terlalu banyak request. Coba lagi sebentar.')
});

// [SECURITY] Limiter ketat untuk login admin → cegah brute-force password.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10,                  // maksimal 10 percobaan login / IP / 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // login sukses tidak dihitung
  message: jsonMessage('Terlalu banyak percobaan login. Coba lagi dalam 15 menit.')
});

// [SECURITY] Limiter untuk endpoint yang memanggil AI (Gemini) → lindungi kuota
// gratis bersama dari penyalahgunaan/spam satu IP. Lebih ketat dari global.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // maksimal 20 pesan AI / IP / menit
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Kamu mengirim pesan terlalu cepat. Tunggu sebentar ya, lalu coba lagi.')
});

module.exports = globalLimiter;
module.exports.globalLimiter = globalLimiter;
module.exports.authLimiter = authLimiter;
module.exports.chatLimiter = chatLimiter;
