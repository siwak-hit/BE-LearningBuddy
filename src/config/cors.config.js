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

const allowedOrigins = parseAllowedOrigins(
  env.ALLOWED_ORIGIN ||
  process.env.ALLOWED_ORIGIN ||
  process.env.CORS_ORIGIN
);

function isAllowedVercelPreview(origin) {
  return /^https:\/\/fe-learning-buddy-[a-z0-9-]+-siwak-hits-projects\.vercel\.app$/.test(origin);
}

function isAllowedProduction(origin) {
  return origin === 'https://fe-learning-buddy.vercel.app';
}

const corsConfig = cors({
  origin(origin, callback) {
    // Thunder Client / Postman / server-to-server biasanya tidak punya origin
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = normalizeOrigin(origin);

    const isAllowed =
      allowedOrigins.includes(cleanOrigin) ||
      isAllowedProduction(cleanOrigin) ||
      isAllowedVercelPreview(cleanOrigin);

    if (isAllowed) {
      return callback(null, true);
    }

    console.warn('[CORS BLOCKED]', {
      origin: cleanOrigin,
      allowedOrigins
    });

    return callback(new Error(`Origin tidak diizinkan: ${cleanOrigin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

module.exports = corsConfig;
