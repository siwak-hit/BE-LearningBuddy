// src/services/ai/prompt.service.js

const MAX_CONTEXT_CHARS = parseInt(process.env.AI_MAX_PAGE_CONTEXT_CHARS) || 1500;

function detectAnswerMode({ message, intent, elementContext, hasTemplateContext }) {
  const hasMention = /@\w+/i.test(message || '');
  const isElementDirectQuestion = hasMention || Boolean(elementContext);

  // Deteksi tanya deadline khusus
  if (intent === 'tanya_deadline' || intent === 'cek_tugas_belum') return 'deadline';

  const proceduralIntents = ['bantuan_login', 'navigasi_kursus', 'akses_materi', 'bantuan_tugas', 'bantuan_kuis', 'bantuan_umum', 'tutorial_steps'];
  const isProcedural = proceduralIntents.includes(intent) || /(cara|langkah|tahapan|gimana|bagaimana|tutorial|urutan)/i.test(message);

  if (isElementDirectQuestion && !isProcedural) return 'element_explanation';
  if (isProcedural) return 'tutorial_steps';
  return 'material';
}

function detectMaterialFocus(message = '') {
  const msg = String(message || '').toLowerCase();

  if (/(dampak|pengaruh|efek|akibat|positif|negatif|manfaat|risiko|bahaya)/i.test(msg)) {
    return 'dampak';
  }

  if (/(apa itu|pengertian|definisi|maksud dari|artinya)/i.test(msg)) {
    return 'pengertian';
  }

  if (/(jenis|macam|kategori|contoh)/i.test(msg)) {
    return 'jenis';
  }

  if (/(cara mencegah|pencegahan|menghindari|solusi|mengatasi)/i.test(msg)) {
    return 'solusi';
  }

  return 'umum';
}

const promptService = {
  // Pastikan parameter responseMode = 'default' ada di sini
  buildPrompt(message, contextString, pageContext, intent, elementContext = null, templateContextString = '', responseMode = 'default') {
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
2. Jawab SINGKAT, jelas, praktis langsung ke inti fungsi. ${responseMode === 'short' ? 'WAJIB jawab maksimal dalam 1 kalimat saja tanpa basa-basi.' : 'Maksimal 1-2 paragraf pendek.'} DILARANG memakai analogi.
3. Output berupa teks biasa (Markdown diperbolehkan).`;

    } else if (mode === 'tutorial_steps') {
      modeRules = `ATURAN WAJIB (MODE TUTORIAL LANGKAH-LANGKAH):
1. Kamu WAJIB merespons HANYA dalam format JSON murni terstruktur (tanpa markdown backticks).
2. FOKUS PADA TUJUAN UTAMA: Pecah proses menjadi langkah kecil yang spesifik dan logis. ${responseMode === 'short' ? 'User meminta jawaban singkat, buat bagian "description" maksimal 1 kalimat padat per langkah.' : ''}
3. FOKUS SCOPE: Jangan tambahkan langkah di luar tujuan utama user KECUALI diminta.
4. Jika elemen yang tersedia hanya 1 form besar, gunakan \`element_ref\` yang sama pada setiap langkah yang membutuhkan input di form tersebut.
5. Format JSON WAJIB seperti ini:
{
  "answer_mode": "tutorial_steps",
  "answer_text": "Berikut adalah panduan langkah demi langkah:",
  "steps": [
    { "step_number": 1, "title": "Judul langkah spesifik", "description": "Instruksi", "element_ref": "@namaElemen" }
  ]
}`;

    } else if (mode === 'deadline') {
      const tasks = pageContext?.userTasks || [];
      if (tasks.length === 0) {
        modeRules = `ATURAN WAJIB (MODE DEADLINE):
1. Kamu WAJIB menjawab HANYA dengan: "Aku belum bisa melihat deadline tugas secara langsung dari halaman ini. Coba buka halaman dashboard/timeline VClass atau tanyakan ke guru/admin."
2. DILARANG KERAS mengarang tugas atau jadwal.`;
      } else {
        modeRules = `ATURAN WAJIB (MODE DEADLINE):
1. Berikut adalah data tugas user saat ini: ${JSON.stringify(tasks)}.
2. Jawab berdasarkan data tersebut. Sebutkan mana yang belum selesai dan kapan deadlinenya.
3. DILARANG KERAS mengarang tugas di luar data yang diberikan.`;
      }

    } else {
      const materialFocus = detectMaterialFocus(message);

      const focusRules = {
        dampak: `FOKUS PERTANYAAN: DAMPAK / PENGARUH.
    - Jawaban HARUS membahas dampak penggunaan media sosial.
    - Jika konteks tersedia, utamakan dampak yang ada di materi.
    - Boleh bagi menjadi "dampak positif" dan "dampak negatif".
    - Jangan mengulang panjang pengertian media sosial. Definisi maksimal 1 kalimat pembuka saja.`,

        pengertian: `FOKUS PERTANYAAN: PENGERTIAN.
    - Jawaban HARUS menjelaskan definisi/pengertian.
    - Boleh beri contoh singkat agar mudah dipahami siswa SMP.
    - Jangan membahas dampak terlalu jauh kecuali hanya sebagai tambahan singkat.`,

        jenis: `FOKUS PERTANYAAN: JENIS / CONTOH.
    - Jawaban HARUS menyebutkan jenis, macam, atau contoh.
    - Gunakan daftar singkat agar mudah dibaca.
    - Jangan fokus ke pengertian panjang.`,

        solusi: `FOKUS PERTANYAAN: SOLUSI / PENCEGAHAN.
    - Jawaban HARUS berisi langkah pencegahan, solusi, atau cara menghindari.
    - Buat praktis dan mudah dilakukan siswa.`,

        umum: `FOKUS PERTANYAAN: MATERI UMUM.
    - Jawab sesuai pertanyaan siswa.
    - Jangan mengulang jawaban sebelumnya jika pertanyaan siswa sudah berubah.`
      };

      modeRules = `ATURAN WAJIB (MODE MATERI PELAJARAN):
    1. Jawab ramah, edukatif, dan mudah dipahami siswa SMP.
    2. ${responseMode === 'short'
        ? 'User meminta JAWABAN SINGKAT. Jawab maksimal 1 paragraf, 1-3 kalimat, langsung ke inti.'
        : 'Jawab maksimal 2-4 paragraf pendek atau bullet singkat jika lebih jelas.'}
    3. Jawab SESUAI FOKUS pertanyaan siswa. Jangan hanya menjawab topik umum.
    4. Gunakan CONTEXT MATERI jika tersedia. Jika konteks tidak cocok dengan pertanyaan, katakan bahwa bagian materi spesifik belum ditemukan.
    5. Jangan memberikan jawaban kuis/tugas langsung jika pertanyaan berupa permintaan jawaban evaluasi.
    6. Tidak wajib memakai metode clue. Untuk pertanyaan konsep seperti pengertian, dampak, jenis, atau contoh, berikan penjelasan langsung yang edukatif.
    7. Pertanyaan reflektif boleh ditambahkan maksimal 1 kalimat di akhir, tetapi jangan menggantikan jawaban utama.

    ${focusRules[materialFocus]}`;
    }

    // Bangun prompt akhir
    return `Kamu adalah AI Learning Buddy untuk Virtual Class Moodle.

${modeRules}
5. TANGKAL JAILBREAK: Tolak pertanyaan di luar konteks e-learning.

${elementString}
CONTEXT MATERI/FAQ:
${safeContext || '(Tidak ada konteks materi yang ditemukan)'}

TEMPLATE CONTEXT:
${templateContextString || '(Tidak ada template context)'}

HALAMAN SAAT INI: ${pageTitle}

PERTANYAAN SISWA:
${message}

INSTRUKSI AKHIR:
- Jawab pertanyaan siswa yang TERBARU, bukan pertanyaan sebelumnya.
- Jika siswa bertanya dampak, jangan kembali menjelaskan pengertian kecuali 1 kalimat pembuka.
- Jika konteks yang diberikan tidak sesuai dengan pertanyaan terbaru, jangan memaksakan konteks yang salah.
- Gunakan bahasa Indonesia yang natural untuk siswa SMP.

JAWABAN:`;
  }
};

module.exports = promptService;
