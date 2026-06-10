const response = require('../utils/response');

const errorMiddleware = (err, req, res, next) => {
  console.error('[APP_ERROR]', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Terjadi kesalahan pada server';

  return response.error(res, message, null, statusCode);
};

module.exports = errorMiddleware;
