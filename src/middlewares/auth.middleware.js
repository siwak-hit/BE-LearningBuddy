const { supabaseAdmin } = require('../config/supabase.config');
const response = require('../utils/response');

// [SECURITY] Verifikasi JWT admin (Supabase Auth) untuk endpoint khusus admin.
// FE menyimpan access_token hasil login di localStorage ('alb_token') dan
// mengirimnya sebagai header `Authorization: Bearer <token>` di setiap request.
// Endpoint siswa (chat/widget/student-*) TIDAK memakai middleware ini.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    const token = match ? match[1].trim() : '';

    if (!token) {
      return response.error(res, 'Akses ditolak. Silakan login sebagai admin.', null, 401);
    }

    // Verifikasi token ke Supabase (stateless, aman untuk serverless).
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user?.id) {
      return response.error(res, 'Sesi tidak valid atau sudah berakhir. Silakan login ulang.', null, 401);
    }

    req.user = { id: data.user.id, email: data.user.email };
    return next();
  } catch (err) {
    console.error('[AUTH MIDDLEWARE ERROR]', err?.message || err);
    return response.error(res, 'Gagal memverifikasi sesi admin.', null, 401);
  }
}

module.exports = { requireAuth };
