// Import supabaseAdmin yang sudah kamu konfigurasi dengan benar
const { supabaseAdmin } = require('../config/supabase.config');

const authModel = {
  async login(email, password) {
    // Gunakan fitur auth bawaan dari supabaseAdmin kamu
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    // Lempar error jika gagal agar ditangkap oleh blok catch di Controller
    if (error) throw error;

    return data;
  },

  // [v0.9.55] Buat akun guru baru. Pakai admin.createUser + email_confirm:true supaya
  // akun langsung bisa dipakai login (tanpa langkah konfirmasi email). Gerbang keamanan
  // (kode registrasi) divalidasi di controller sebelum fungsi ini dipanggil.
  async register(email, password) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (error) throw error;

    return data;
  }
};

module.exports = authModel;
