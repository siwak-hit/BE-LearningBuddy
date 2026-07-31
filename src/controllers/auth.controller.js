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
  }),

  // [v0.9.55] Registrasi akun guru, DIGERBANG kode registrasi rahasia (env REGISTER_CODE).
  // Tanpa kode/kode salah → ditolak, supaya tidak sembarang orang bisa jadi admin.
  register: asyncHandler(async (req, res) => {
    const { email, password, registerCode } = req.body;

    if (!email || !password) {
      return response.error(res, 'Email dan password wajib diisi.', null, 400);
    }
    if (String(password).length < 6) {
      return response.error(res, 'Password minimal 6 karakter.', null, 400);
    }

    const requiredCode = process.env.REGISTER_CODE || '';
    if (!requiredCode) {
      return response.error(res, 'Pendaftaran sedang dinonaktifkan. Hubungi admin sistem.', null, 403);
    }
    if (String(registerCode || '') !== requiredCode) {
      return response.error(res, 'Kode registrasi salah.', null, 403);
    }

    try {
      await authModel.register(email, password);
      return response.success(res, 'Akun berhasil dibuat. Silakan login.', null, 201);
    } catch (error) {
      console.error('❌ [Supabase Register Error]:', error?.message || error);
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exist')) {
        return response.error(res, 'Email sudah terdaftar. Silakan login.', null, 409);
      }
      return response.error(res, 'Gagal membuat akun. Coba lagi beberapa saat.', null, 500);
    }
  })
};

module.exports = authController;
