const authModel = require('../models/auth.model');
const response = require('../utils/response');
const asyncHandler = require('../utils/async-handler');

function normalizeLoginErrorMessage(error) {
  const rawMessage = String(error?.message || '').toLowerCase();

  if (rawMessage.includes('invalid login credentials')) {
    return 'Email atau password salah. Silakan cek kembali akun admin kamu.';
  }

  if (rawMessage.includes('email not confirmed')) {
    return 'Email admin belum dikonfirmasi. Silakan cek email atau aktifkan akun terlebih dahulu.';
  }

  if (rawMessage.includes('too many') || rawMessage.includes('rate limit')) {
    return 'Terlalu banyak percobaan login. Tunggu sebentar, lalu coba lagi.';
  }

  if (rawMessage.includes('fetch failed') || rawMessage.includes('network') || rawMessage.includes('econnrefused')) {
    return 'Server auth sedang tidak bisa dihubungi. Coba lagi beberapa saat.';
  }

  return 'Login gagal. Silakan cek email dan password, lalu coba lagi.';
}

const authController = {
  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return response.error(res, 'Email dan password wajib diisi.', null, 400);
    }

    try {
      const data = await authModel.login(email, password);

      if (!data?.session?.access_token || !data?.user?.id) {
        return response.error(res, 'Login gagal. Data sesi tidak valid.', null, 401);
      }

      return response.success(res, 'Login berhasil', {
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email
        }
      }, 200);

    } catch (error) {
      // Detail asli cukup dicatat di server, jangan dikirim mentah ke client.
      console.error('❌ [Supabase Auth Error]:', error?.message || error);

      return response.error(res, normalizeLoginErrorMessage(error), null, 401);
    }
  })
};

module.exports = authController;
