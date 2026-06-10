const authModel = require('../models/auth.model');
const response = require('../utils/response');
const asyncHandler = require('../utils/async-handler');

const authController = {
  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return response.error(res, 'Email dan password wajib diisi', null, 400);
    }

    try {
      const data = await authModel.login(email, password);

      return response.success(res, 'Login berhasil', {
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email
        }
      }, 200);

    } catch (error) {
      // TAMPILKAN ERROR ASLI KE TERMINAL
      console.error('❌ [Supabase Auth Error]:', error.message);

      // KIRIM ERROR ASLI KE POSTMAN SEMENTARA WAKTU
      return response.error(res, `Gagal Login: ${error.message}`, null, 401);
    }
  })
};

module.exports = authController;
