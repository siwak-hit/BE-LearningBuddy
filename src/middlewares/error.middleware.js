const response = require('../utils/response');
const env = require('../config/env');

const errorMiddleware = (err, req, res, next) => {
  // Selalu catat detail lengkap di server untuk debugging.
  console.error('[APP_ERROR]', err);

  const statusCode = err.statusCode || 500;

  // [SECURITY] Error 5xx kemungkinan membawa detail internal (pesan Supabase,
  // stack, dsb). Di produksi jangan kirim mentah ke client — balas generik.
  // Error 4xx adalah pesan yang memang ditujukan ke user → tetap dikirim.
  let message = err.message || 'Terjadi kesalahan pada server';
  if (statusCode >= 500 && env.NODE_ENV === 'production') {
    message = 'Terjadi kesalahan pada server. Coba lagi beberapa saat.';
  }

  return response.error(res, message, null, statusCode);
};

module.exports = errorMiddleware;
