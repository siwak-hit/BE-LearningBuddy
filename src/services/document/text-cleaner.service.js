// src/services/document/text-cleaner.service.js

const textCleanerService = {
  clean(text) {
    if (!text) return '';

    let cleaned = text;

    // 1. Hapus bullet, checklist, dan numbering di awal kalimat
    // Menangkap: •, -, *, ✓, ✔, ➢, →, ■, ●, ○, 1., 1), A., a.
    cleaned = cleaned.replace(/^[ \t]*[•\-\*✓✔➢→■●○][ \t]+/gm, '');
    cleaned = cleaned.replace(/^[ \t]*([a-zA-Z]|\d{1,2})[\.\)][ \t]+/gm, '');

    // 2. Hapus Heading Noise pendek tanpa tanda baca
    cleaned = cleaned.split('\n').filter(line => {
      const t = line.trim();
      if (t.length === 0) return false;

      // Jika baris kurang dari 30 karakter, tidak diakhiri tanda baca,
      // dan merupakan kata kunci yang sering jadi header noise
      if (t.length < 30 && !/[.?!:,]$/.test(t)) {
         if (/^(halaman|minggu|bab|materi|tujuan|catatan|poin\s+penting|latihan)\s*\d*/i.test(t)) return false;
      }
      return true;
    }).join(' '); // Gabungkan dengan spasi, bukan newline, agar tidak terputus

    // 3. Normalize Spacing (Hilangkan kata menempel & spasi berlebih)
    // Beri spasi jika ada HurufKecilHurufBesar (InformatikaHalaman -> Informatika Halaman)
    cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }
};

module.exports = textCleanerService;
