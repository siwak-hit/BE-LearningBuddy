const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const corsConfig = require('./config/cors.config');
const rateLimitMiddleware = require('./middlewares/rate-limit.middleware');
const routes = require('./routes/index.routes');
const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

// [SECURITY] Di belakang proxy (Vercel/Render), percayai 1 hop agar IP klien
// terbaca benar untuk rate-limit (bukan IP proxy). Jangan set `true` — itu
// membuat X-Forwarded-For bisa dipalsukan.
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
app.use(corsConfig);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('dev'));
app.use(rateLimitMiddleware);

app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'AI Learning Buddy API aktif',
    available_base_path: '/api'
  });
});

app.get('/api', (req, res) => {
  res.json({
    status: 'success',
    message: 'API base aktif',
    available_routes: [
      '/api/health',
      '/api/projects',
      '/api/chat',
      '/api/moodle'
    ]
  });
});

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint tidak ditemukan',
    data: null
  });
});

app.use(errorMiddleware);

module.exports = app;
