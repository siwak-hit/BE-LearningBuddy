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
  }
};

module.exports = authModel;
