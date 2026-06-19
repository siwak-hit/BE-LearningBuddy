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

// [v0.9.17] Bedakan SUMBER kebingungan: ALUR SISTEM (login/kuis/tugas/forum/navigasi)
// vs MATERI PELAJARAN (konsep). Kalau bingung soal materi, "Lihat panduan pakai gambar"
// itu MENYESATKAN (tak ada tutorial gambar untuk konsep) — yang tepat justru ajak baca
// pelan & tawarkan penjelasan ulang yang lebih sederhana.
const MATERIAL_INTENTS = ['penjelasan_materi', 'daftar_materi', 'general_learning_help', 'rangkuman_materi'];
function isMaterialConfusion(intent = '') {
  const i = String(intent || '').toLowerCase();
  return MATERIAL_INTENTS.some((m) => i.includes(m)) || (!guideFromIntent(i) && i.includes('materi'));
}

const recommendationService = {
  // level: 'lancar' | 'mulai_bingung' | 'kesulitan'
  build(level, ctx = {}) {
    const guide = guideFromIntent(ctx.intent || '');
    const materialConfusion = !guide && isMaterialConfusion(ctx.intent || '');

    if (level === 'mulai_bingung') {
      const actions = [];
      if (guide) {
        // Bingung ALUR SISTEM → panduan visual relevan.
        actions.push({ type: 'continue_prompt', label: `📖 ${guide.label}`, prompt: guide.prompt });
      } else if (materialConfusion) {
        // Bingung MATERI → tawarkan penjelasan ulang yang lebih sederhana.
        actions.push({ type: 'continue_prompt', label: '🧩 Jelaskan lebih sederhana', prompt: 'tolong jelaskan ulang dengan bahasa yang lebih sederhana dan beri contoh' });
      }
      actions.push({ type: 'feedback_resolved', label: '✅ Sudah paham, terima kasih' });

      const message = materialConfusion
        ? 'Sepertinya materinya yang mulai terasa agak berat ya 🤔. Santai aja, ini wajar kok.\n\n**Yang bisa kamu lakukan:**\n• Coba **baca ulang pelan-pelan** bagian yang tadi.\n• Atau klik **"🧩 Jelaskan lebih sederhana"** di bawah, nanti aku uraikan dengan bahasa yang lebih mudah + contoh.\n• Boleh juga ketik lagi, sebutkan **bagian konsep mana** yang belum nyantol.\n\nKalau sudah paham, klik tombol hijau **"✅ Sudah paham"** ya.'
        : 'Sepertinya alur/langkah di bagian ini mulai bikin kamu bingung ya 🤔. Tenang, aku bantu.\n\n**Klik salah satu tombol di bawah ini:**\n• Tombol **"📖 Lihat panduan"** → aku tampilkan langkah-langkahnya pakai gambar.\n• Atau ketik lagi pertanyaanmu, sebutkan **bagian mana** yang masih bingung.\n\nKalau ternyata sudah paham, klik tombol hijau **"✅ Sudah paham"** ya.';

      return { level, message, actions };
    }

    if (level === 'kesulitan') {
      const actions = [];
      if (guide) {
        actions.push({ type: 'continue_prompt', label: `📖 ${guide.label}`, prompt: guide.prompt });
      } else if (materialConfusion) {
        actions.push({ type: 'continue_prompt', label: '🧩 Jelaskan lebih sederhana', prompt: 'tolong jelaskan ulang dengan bahasa yang lebih sederhana dan beri contoh' });
      }
      actions.push({ type: 'wa_teacher', label: '💬 Tanya Guru lewat WhatsApp', url: WA_TEACHER_URL });
      actions.push({ type: 'feedback_resolved', label: '✅ Aku sudah lebih paham' });

      const message = materialConfusion
        ? 'Kamu kelihatan lagi kesulitan memahami materi ini. Santai aja, ini wajar kok dan bukan salahmu 💙.\n\n**Coba langkah ini — tarik napas dulu, lalu pilih salah satu tombol di bawah:**\n• **"🧩 Jelaskan lebih sederhana"** → aku uraikan ulang pakai bahasa lebih mudah + contoh.\n• **"💬 Tanya Guru lewat WhatsApp"** → kalau masih buntu, langsung tanya gurumu, itu nggak apa-apa kok.\n• **"✅ Aku sudah lebih paham"** → klik kalau sekarang sudah mengerti.\n\nTips: baca ulang materinya pelan-pelan, satu kalimat satu kalimat. Nggak usah buru-buru ya 😊.'
        : 'Kamu kelihatan lagi kesulitan di langkah ini. Santai aja, ini wajar kok dan bukan salahmu 💙.\n\n**Di bawah ada tombol yang bisa kamu pilih — klik salah satu:**\n• **"📖 Lihat panduan"** → aku tunjukkan langkah-langkahnya dengan gambar.\n• **"💬 Tanya Guru lewat WhatsApp"** → langsung chat gurumu kalau masih buntu.\n• **"✅ Aku sudah lebih paham"** → klik ini kalau sekarang sudah mengerti.';

      return { level, message, actions };
    }

    return null;
  }
};

module.exports = recommendationService;
