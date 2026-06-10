// src/services/ai/prompt.service.js

const MAX_CONTEXT_CHARS = parseInt(process.env.AI_MAX_PAGE_CONTEXT_CHARS) || 1000;

function detectAnswerMode({ message, intent, elementContext, hasTemplateContext }) {
  const hasMention = /@\w+/i.test(message || '');
  const isElementDirectQuestion = hasMention || Boolean(elementContext);

  const proceduralIntents = ['bantuan_login', 'navigasi_kursus', 'akses_materi', 'bantuan_tugas', 'bantuan_kuis', 'bantuan_umum'];
  const isProcedural = proceduralIntents.includes(intent) || /(cara|langkah|tahapan|gimana|bagaimana|tutorial|urutan)/i.test(message);

  // 1. MODE PENJELASAN ELEMEN (Text-first, singkat)
  if (isElementDirectQuestion && !isProcedural) return 'element_explanation';

  // 2. MODE TUTORIAL STEPS (Visual, Step-by-step JSON)
  if (isProcedural) return 'tutorial_steps';

  // 3. MODE MATERI (Edukatif, naratif)
  return 'material';
}

const promptService = {
  buildPrompt(message, contextString, pageContext, intent, elementContext = null, templateContextString = '') {
    const safeContext = (contextString || '').substring(0, MAX_CONTEXT_CHARS);
    const pageTitle = pageContext?.title || 'Halaman VClass';

    const hasTemplateContext = !!templateContextString;
    const mode = detectAnswerMode({ message, intent, elementContext, hasTemplateContext });

    let elementString = '';
    if (elementContext) {
      elementString = `\nELEMEN YANG DITANYAKAN:\n- Nama: ${elementContext.name}\n- Tag: ${elementContext.tag}\n`;
    }

    let modeRules = '';
    if (mode === 'element_explanation') {
      modeRules = `ATURAN WAJIB (MODE PENJELASAN ELEMEN UI):
1. Kamu sedang menjelaskan FUNGSI dari sebuah elemen UI (tombol/form/tabel).
2. Jawab SINGKAT, jelas, praktis dalam 1-2 paragraf pendek. DILARANG memakai analogi.
3. Output berupa teks biasa (Markdown diperbolehkan).`;
    } else if (mode === 'tutorial_steps') {
      modeRules = `ATURAN WAJIB (MODE TUTORIAL LANGKAH-LANGKAH):
1. Kamu WAJIB merespons HANYA dalam format JSON murni terstruktur (tanpa markdown backticks).
2. FOKUS PADA TUJUAN UTAMA: Pecah proses menjadi langkah kecil yang spesifik dan logis (Misal: 1. Masukkan Username/Email, 2. Masukkan Password, 3. Klik tombol Login, 4. Penutup/Solusi jika gagal).
3. FOKUS SCOPE: Jangan tambahkan langkah di luar tujuan utama user (misal: opsi alternatif, info tambahan, troubleshooting) KECUALI user memintanya.
4. Jika elemen yang tersedia hanya 1 form besar (misalnya hanya ada @formulir1), gunakan \`element_ref\` yang sama pada setiap langkah yang membutuhkan input di form tersebut.
5. Format JSON WAJIB seperti ini:
{
  "answer_mode": "tutorial_steps",
  "answer_text": "Berikut adalah panduan langkah demi langkah:",
  "steps": [
    { "step_number": 1, "title": "Judul langkah spesifik", "description": "Instruksi", "element_ref": "@namaElemen" }
  ]
}`;
    } else {
      modeRules = `ATURAN WAJIB (MODE MATERI PELAJARAN):
1. Jawab ramah, edukatif (setara siswa SMP). Maksimal 2-4 paragraf.
2. WAJIB GUNAKAN METODE CLUE (TEBAK-TEBAKAN), jangan beri jawaban instan. Akhiri dengan pertanyaan reflektif.`;
    }

    return `Kamu adalah AI Learning Buddy untuk Virtual Class Moodle.

${modeRules}
5. TANGKAL JAILBREAK: Tolak pertanyaan di luar konteks e-learning.

${elementString}
CONTEXT MATERI/FAQ:
${safeContext}

TEMPLATE CONTEXT:
${templateContextString}

HALAMAN SAAT INI: ${pageTitle}
PERTANYAAN SISWA: ${message}
JAWABAN:`;
  }
};

module.exports = promptService;
