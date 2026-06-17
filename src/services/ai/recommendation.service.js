// src/services/ai/recommendation.service.js
// [v0.8.2] Komponen AI Skripsi — Rekomendasi Bantuan Adaptif berbasis level kesulitan.
// Output: pesan + tombol aksi (termasuk tombol SCORING feedback_resolved untuk mengukur
// apakah rekomendasi benar-benar membantu).

const WA_TEACHER_URL = 'https://api.whatsapp.com/send/?phone=628989807094&text=Halo%20Instruktur%2C%20saya%20butuh%20bantuan%20menggunakan%20VClass.';

// Saran panduan visual sesuai topik yang sedang dibahas (dari intent).
function guideFromIntent(intent = '') {
  const i = String(intent || '').toLowerCase();
  if (i.includes('forum') || i.includes('diskusi')) return { label: 'Lihat panduan buat forum', prompt: 'cara membuat forum diskusi' };
  if (i.includes('kuis') || i.includes('quiz')) return { label: 'Lihat panduan kerjakan kuis', prompt: 'cara mengerjakan kuis' };
  if (i.includes('tugas') || i.includes('kumpul') || i.includes('assign')) return { label: 'Lihat panduan kumpulkan tugas', prompt: 'cara mengumpulkan tugas' };
  if (i.includes('login') || i.includes('masuk')) return { label: 'Lihat panduan login', prompt: 'cara login ke vclass' };
  if (i.includes('nilai') || i.includes('grade')) return { label: 'Lihat panduan lihat nilai', prompt: 'cara melihat nilai' };
  if (i.includes('logout')) return { label: 'Lihat panduan logout', prompt: 'cara logout' };
  return null;
}

const recommendationService = {
  // level: 'lancar' | 'mulai_bingung' | 'kesulitan'
  build(level, ctx = {}) {
    const guide = guideFromIntent(ctx.intent || '');

    if (level === 'mulai_bingung') {
      const actions = [];
      if (guide) actions.push({ type: 'continue_prompt', label: `📖 ${guide.label}`, prompt: guide.prompt });
      actions.push({ type: 'feedback_resolved', label: '✅ Sudah paham, terima kasih' });
      return {
        level,
        // Pesan eksplisit + arahkan ke tombol di bawah (target: siswa SMP).
        message: 'Sepertinya bagian ini mulai bikin kamu bingung ya 🤔. Tenang, aku bantu.\n\n**Klik salah satu tombol di bawah ini:**\n• Tombol **"📖 Lihat panduan"** → aku tampilkan langkah-langkahnya pakai gambar.\n• Atau ketik lagi pertanyaanmu, sebutkan **bagian mana** yang masih bingung.\n\nKalau ternyata sudah paham, klik tombol hijau **"✅ Sudah paham"** ya.',
        actions
      };
    }

    if (level === 'kesulitan') {
      const actions = [];
      if (guide) actions.push({ type: 'continue_prompt', label: `📖 ${guide.label}`, prompt: guide.prompt });
      actions.push({ type: 'wa_teacher', label: '💬 Tanya Guru lewat WhatsApp', url: WA_TEACHER_URL });
      actions.push({ type: 'feedback_resolved', label: '✅ Aku sudah lebih paham' });
      return {
        level,
        // Jelaskan tiap tombol satu per satu — jangan biarkan siswa menebak maksudnya.
        message: 'Kamu kelihatan lagi kesulitan di bagian ini. Santai aja, ini wajar kok dan bukan salahmu 💙.\n\n**Di bawah ada tombol yang bisa kamu pilih — klik salah satu:**\n• **"📖 Lihat panduan"** → aku tunjukkan langkah-langkahnya dengan gambar.\n• **"💬 Tanya Guru lewat WhatsApp"** → langsung chat gurumu kalau masih buntu.\n• **"✅ Aku sudah lebih paham"** → klik ini kalau sekarang sudah mengerti.\n\nTips: kamu juga boleh istirahat sebentar dulu, lalu baca ulang materinya pelan-pelan. 😊',
        actions
      };
    }

    return null;
  }
};

module.exports = recommendationService;
