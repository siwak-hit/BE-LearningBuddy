const response = {
    success(res, message = 'Berhasil', data = null, statusCode = 200) {
      return res.status(statusCode).json({
        status: 'success',
        message,
        data
      });
    },

    error(res, message = 'Terjadi kesalahan', data = null, statusCode = 500) {
      return res.status(statusCode).json({
        status: 'error',
        message,
        data
      });
    }
  };

  module.exports = response;
