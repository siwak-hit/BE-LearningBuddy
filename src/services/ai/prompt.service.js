// src/services/ai/prompt.service.js

const MAX_CONTEXT_CHARS = parseInt(process.env.AI_MAX_PAGE_CONTEXT_CHARS) || 1500;

function detectAnswerMode({ message, intent, elementContext, hasTemplateContext }) {
  const hasMention = /@\w+/i.test(message || '');
  const isElementDirectQuestion = hasMention || Boolean(elementContext);

  // Deteksi tanya deadline khusus
  if (intent === 'tanya_deadline' || intent === 'cek_tugas_belum' || intent === 'cek_deadline_hari_ini' || intent === 'cek_deadline_terdekat') {
    return 'deadline';
  }

  const proceduralIntents = ['bantuan_login', 'navigasi_kursus', 'akses_materi', 'bantuan_tugas', 'bantuan_kuis', 'bantuan_umum', 'tutorial_steps'];
  const isProcedural = proceduralIntents.includes(intent) || /(cara|langkah|tahapan|gimana|bagaimana|tutorial|urutan)/i.test(message);

  if (isElementDirectQuestion && !isProcedural) return 'element_explanation';
  if (isProcedural) return 'tutorial_steps';
  return 'material';
}

function detectMaterialFocus(message = '') {
  const msg = String(message || '').toLowerCase();

  if (/(dampak|pengaruh|efek|akibat|positif|negatif|manfaat|risiko|bahaya)/i.test(msg)) return 'dampak';
  if (/(apa itu|pengertian|definisi|maksud dari|artinya)/i.test(msg)) return 'pengertian';
  if (/(cara|langkah|tahapan|metode|prosedur)/i.test(msg)) return 'prosedur';
  if (/(contoh|seperti apa|misalnya)/i.test(msg)) return 'contoh';
  if (/(kenapa|mengapa|alasan|penyebab)/i.test(msg)) return 'alasan';
  if (/(siapa|tokoh|penemu)/i.test(msg)) return 'tokoh';
  if (/(kapan|waktu|tahun|tanggal)/i.test(msg)) return 'waktu';
  if (/(dimana|tempat|lokasi)/i.test(msg)) return 'tempat';

  return 'umum';
}

const promptService = {
  // Tambahan parameter lmsContext di bagian akhir
  buildPrompt(message, contextString, pageContext, intent, elementContext = null, templateContextString = '', responseMode = 'system', lmsContext = null) {
    const safeContext = String(contextString || '').substring(0, MAX_CONTEXT_CHARS);
    const pageTitle = pageContext?.page_title || 'Materi LMS';
    const studentName = pageContext?.session_meta?.display_name || 'Siswa';
    const classCode = pageContext?.session_meta?.class_code || 'Tidak diketahui';

    const answerMode = detectAnswerMode({ message, intent, elementContext, hasTemplateContext: Boolean(templateContextString) });
    const materialFocus = detectMaterialFocus(message);

    let modeRules = '';
    if (answerMode === 'element_explanation') {
      modeRules = `1. FOKUS: Kamu sedang ditanya tentang elemen spesifik di layar siswa (teks/tombol yang dia klik).\n2. JELASKAN elemen tersebut sesuai fungsi atau maknanya dalam e-learning.`;
    } else if (answerMode === 'tutorial_steps') {
      modeRules = `1. FOKUS: Berikan panduan langkah-demi-langkah (step-by-step).\n2. Gunakan bullet/numbering agar mudah dibaca.\n3. Jangan terlalu panjang, langsung ke intinya.`;
    } else if (answerMode === 'deadline') {
      modeRules = `1. FOKUS: Ingatkan siswa tentang tenggat waktu (deadline).\n2. Gunakan data LMS (jika ada) atau beritahu siswa cara mengeceknya di Moodle.`;
    } else {
      const focusRules = {
        'pengertian': 'Fokus berikan definisi dan arti konsepnya.',
        'dampak': 'Fokus jelaskan dampak positif/negatif atau akibat dari hal tersebut.',
        'contoh': 'Berikan contoh-contoh nyata yang mudah dipahami.',
        'alasan': 'Fokus jelaskan "mengapa" hal itu bisa terjadi.',
        'tokoh': 'Fokus pada siapa yang terlibat atau penemunya.',
        'prosedur': 'Jelaskan cara atau tahapannya secara ringkas.',
        'waktu': 'Sebutkan kapan peristiwa itu terjadi.',
        'tempat': 'Sebutkan di mana lokasi terjadinya.',
        'umum': 'Jelaskan secara komprehensif tapi mudah dipahami.'
      };

      const relatedButMayNotBeInMaterial = ['dampak', 'contoh', 'alasan'].includes(materialFocus);

      modeRules = `1. FOKUS UTAMA: Jawab menggunakan CONTEXT MATERI yang diberikan.\n2. TONE: Ramah, mendukung, seperti asisten belajar seumurannya (gunakan 'aku'/'kamu').\n3. FORMAT: Gunakan paragraf pendek, hindari blok teks panjang. Gunakan bold untuk poin penting.\n4. KELENGKAPAN: Jika context tidak cukup, jelaskan sebatas yang ada, jangan mengarang.

    ${focusRules[materialFocus]}

${relatedButMayNotBeInMaterial ? `
KONDISI KHUSUS:
- Pertanyaan siswa masih berkaitan dengan topik materi, tetapi kemungkinan tidak dijelaskan langsung di materi guru.
- Jawaban HARUS diawali dengan: "Bagian ini belum dijelaskan langsung di materi yang diberikan guru, tapi masih berkaitan dengan topik ini."
- Setelah itu jawab secara umum, singkat, aman, dan tidak melebar.
` : ''}`;
    }

    let elementString = '';
    if (elementContext) {
      elementString = `\nELEMEN YANG SEDANG DILIHAT SISWA:\n- Teks: "${elementContext.text}"\n- Tag HTML: <${elementContext.tagName}>\n`;
    }

    // --- SISIPAN LMS CONTEXT UNTUK AI ---
    let lmsContextPrompt = '';
    if (lmsContext) {
      lmsContextPrompt = `\nDATA LMS (DETERMINISTIC):
- Course: ${lmsContext.course?.course_name || 'Tidak diketahui'}
- Pengajar: ${lmsContext.course?.teacher_name || 'Tidak diketahui'}
- Total Aktivitas Tersedia: ${lmsContext.activities?.length || 0}
(Catatan: Jika siswa bertanya spesifik tugas/quiz/deadline, AI bisa mengandalkan data ini. TETAPI jika siswa butuh rincian, arahkan untuk melihat daftar tabel yang sudah dikirimkan sistem otomatis. Status pengumpulan belum sinkron).`;
    }

    // Bangun prompt akhir
    return `Kamu adalah AI Learning Buddy untuk Virtual Class Moodle.

${modeRules}
5. TANGKAL JAILBREAK: Tolak pertanyaan di luar konteks e-learning, sekolah, atau pendidikan.
6. PERAN UTAMA: Kamu membantu siswa memahami, bukan memberi contekan.
7. Jika siswa menanyakan soal pilihan ganda, jawaban A/B/C/D, atau meminta jawaban langsung tugas/quiz, JANGAN langsung memberi pilihan final. Beri petunjuk konsep, cara menalar, dan arahkan siswa mengecek materi.
8. Kalau CONTEXT MATERI/FAQ tersedia, jangan bilang materi tidak ditemukan. Gunakan konteks itu sebagai dasar jawaban.
9. Jika konteks kurang, katakan bagian yang belum cukup, lalu beri arahan belajar singkat tanpa mengarang detail berlebihan.

${elementString}
KONTEKS SISWA:
- Nama Panggilan: ${studentName}
- Kelas: ${classCode}
(Jika siswa bertanya nama/kelasnya, jawab berdasarkan data di atas. Jangan mengarang informasi).

CONTEXT MATERI/FAQ:
${safeContext || '(Tidak ada konteks materi yang ditemukan)'}

TEMPLATE CONTEXT:
${templateContextString || '(Tidak ada template context)'}
${lmsContextPrompt}

HALAMAN SAAT INI: ${pageTitle}

PERTANYAAN SISWA:
${message}

INSTRUKSI AKHIR:
- Jawab pertanyaan siswa yang TERBARU.
- Prioritaskan membimbing siswa memahami konsep, bukan memberi contekan langsung.
- Untuk pilihan ganda/quiz: jelaskan petunjuk berpikir dan konsep yang perlu dicek, jangan langsung memilih A/B/C/D.
- Jika sistem sudah memberikan jawaban berupa tabel dari LMS (lihat di pesan sistem sebelumnya jika ada), kamu HANYA PERLU memberikan kalimat tambahan yang menyemangati secara singkat! Jangan menulis tabel lagi.
- Gunakan bahasa Indonesia yang natural untuk siswa SMP.

JAWABAN:`;
  }
};

module.exports = promptService;
