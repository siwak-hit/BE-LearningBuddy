const cors = require('cors');
const env = require('./env');

function normalizeOrigin(origin = '') {
  return String(origin).trim().replace(/\/$/, '');
}

function parseAllowedOrigins(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeOrigin).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGIN);

const corsConfig = cors({
  origin(origin, callback) {
    // Thunder Client / Postman / server-to-server biasanya tidak punya origin
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = normalizeOrigin(origin);

    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    console.warn('[CORS BLOCKED]', {
      origin: cleanOrigin,
      allowedOrigins
    });

    return callback(new Error(`Origin tidak diizinkan: ${cleanOrigin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

module.exports = corsConfig;
