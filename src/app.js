const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const corsConfig = require('./config/cors.config');
const rateLimitMiddleware = require('./middlewares/rate-limit.middleware');
const routes = require('./routes/index.routes');
const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
app.use(corsConfig);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(rateLimitMiddleware);

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
