// src/services/ai/prompt.service.js
//
// [v0.9.2] OPTIMASI TOKEN: prompt dibuat sepadat mungkin agar kuota gratis Gemini awet.
// Prinsip: instruksi tetap (aturan base) ringkas & padat, bagian besar (konteks materi)
// dibatasi, dan blok kosong TIDAK dikirim. Target: overhead BE kecil, sisa untuk konteks.
// Semua batas bisa diatur via .env.
const MAX_CONTEXT_CHARS = parseInt(process.env.AI_MAX_PAGE_CONTEXT_CHARS) || 1200;
const MAX_PROMPT_CHARS = parseInt(process.env.AI_MAX_PROMPT_CHARS) || 3800;
const MAX_ELEMENT_TEXT_CHARS = 200;

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

// Aturan base yang dipakai SEMUA jawaban — sengaja sangat padat (hemat token).
const BASE_RULES = "Kamu AI Learning Buddy (asisten belajar VClass Moodle) untuk siswa SMP. Bahasa Indonesia santai, sapa 'aku/kamu', paragraf pendek, **bold** untuk poin penting. Tugasmu MEMBIMBING memahami, BUKAN memberi contekan: untuk pilihan ganda/jawaban tugas/kuis beri petunjuk konsep & cara menalar, JANGAN beri A/B/C/D. Tolak pertanyaan di luar pendidikan/e-learning. Pakai KONTEKS yang diberikan sebagai dasar; jika kurang, sebut apa adanya & beri arahan singkat, JANGAN mengarang. Jawab hanya pertanyaan TERBARU.";

const FOCUS_RULES = {
  pengertian: 'Beri definisi & arti konsep.',
  dampak: 'Jelaskan dampak positif/negatif atau akibatnya.',
  contoh: 'Beri contoh nyata yang mudah dipahami.',
  alasan: 'Jelaskan "mengapa" hal itu terjadi.',
  tokoh: 'Sebut siapa yang terlibat/penemunya.',
  prosedur: 'Jelaskan cara/tahapannya ringkas.',
  waktu: 'Sebut kapan peristiwa itu terjadi.',
  tempat: 'Sebut di mana lokasinya.',
  umum: 'Jelaskan ringkas tapi mudah dipahami.'
};

const promptService = {
  // Tambahan parameter lmsContext di bagian akhir
  buildPrompt(message, contextString, pageContext, intent, elementContext = null, templateContextString = '', responseMode = 'system', lmsContext = null) {
    const safeContext = String(contextString || '').substring(0, MAX_CONTEXT_CHARS);
    const pageTitle = pageContext?.page_title || 'Materi LMS';
    const studentName = pageContext?.session_meta?.display_name || 'Siswa';
    const classCode = pageContext?.session_meta?.class_code || '-';

    const answerMode = detectAnswerMode({ message, intent, elementContext, hasTemplateContext: Boolean(templateContextString) });
    const materialFocus = detectMaterialFocus(message);

    // Baris MODE — satu kalimat per mode (bukan paragraf bernomor).
    let modeLine = '';
    if (answerMode === 'element_explanation') {
      modeLine = 'MODE: Jelaskan elemen layar yang ditanyakan sesuai fungsinya di e-learning.';
    } else if (answerMode === 'tutorial_steps') {
      modeLine = 'MODE: Beri langkah-langkah ringkas (bullet/numbering), langsung ke inti.';
    } else if (answerMode === 'deadline') {
      modeLine = 'MODE: Ingatkan deadline; pakai DATA LMS bila ada, atau cara cek di Moodle.';
    } else {
      // [penjelasan materi] AI WAJIB MENGOLAH ULANG isi materi jadi penjelasan sendiri yang
      // mudah dipahami — BUKAN menyalin kalimat KONTEKS MATERI mentah-mentah (kalau cuma
      // ingin lihat sumbernya, siswa pakai mode "Jawaban Sistem"). Jawab pertanyaan siswa
      // dulu dengan bahasa sederhana, baru sistem yang menambahkan tombol sumber materi.
      modeLine = `MODE: JELASKAN jawaban pertanyaan siswa dengan BAHASAMU SENDIRI yang sederhana & mudah dipahami siswa SMP, berdasarkan KONTEKS MATERI di bawah. DILARANG menyalin kalimat materi mentah-mentah — olah ulang & beri analogi singkat bila perlu. ${FOCUS_RULES[materialFocus] || FOCUS_RULES.umum}`;
      // [v0.9.17] Jangan menolak keras kalau konsep tak persis ada di materi.
      // Untuk pertanyaan edukatif yang masih relevan (konsep, istilah umum, navigasi/UI,
      // pengetahuan dasar), boleh jawab umum yang aman & benar — cukup tandai dengan jujur
      // bahwa ini di luar materi guru. Tetap DILARANG mengarang fakta/angka/data spesifik
      // (statistik, tanggal, nama) yang tidak ada di materi; untuk itu akui tak tahu &
      // sarankan tanya guru. Bedakan: "menjelaskan konsep" boleh; "mengarang data" tidak.
      modeLine += ' Jika hal yang ditanya tidak ada langsung di KONTEKS MATERI tapi masih edukatif & relevan (konsep/istilah/navigasi/pengetahuan umum), AWALI dengan "Ini belum dibahas langsung di materi gurumu ya, tapi aku bantu jelaskan secara umum." lalu jawab ringkas, benar, dan aman. TAPI untuk fakta/angka/statistik/tanggal spesifik yang tak ada di materi: jangan mengarang — akui belum tahu pastinya & sarankan tanya guru.';
    }

    // Panjang jawaban menyesuaikan mode yang dipilih user (hemat token saat singkat).
    const lengthLine = (responseMode === 'short')
      ? 'Jawab SINGKAT (2–4 kalimat).'
      : (responseMode === 'detail') ? 'Boleh agak lengkap, tapi tetap padat.' : 'Jawab secukupnya & padat.';

    // Susun blok — HANYA blok yang ada isinya yang dikirim (hemat token).
    const blocks = [BASE_RULES, modeLine];

    if (elementContext) {
      const elText = String(elementContext.text || '').slice(0, MAX_ELEMENT_TEXT_CHARS);
      blocks.push(`ELEMEN DILIHAT: "${elText}" <${elementContext.tagName || 'el'}>`);
    }

    blocks.push(`SISWA: ${studentName} | Kelas: ${classCode}`);
    blocks.push(`KONTEKS MATERI/FAQ:\n${safeContext || '(kosong — jangan mengarang)'}`);

    if (templateContextString) blocks.push(`TEMPLATE:\n${templateContextString}`);

    if (lmsContext) {
      blocks.push(`DATA LMS: course=${lmsContext.course?.course_name || '-'}, pengajar=${lmsContext.course?.teacher_name || '-'}, aktivitas=${lmsContext.activities?.length || 0}. (Jika sistem sudah kirim tabel LMS, cukup beri 1 kalimat penyemangat — jangan tulis tabel lagi.)`);
    }

    if (pageTitle) blocks.push(`HALAMAN: ${pageTitle}`);
    blocks.push(`PERTANYAAN: ${message}`);
    blocks.push(`${lengthLine}\nJAWABAN:`);

    let prompt = blocks.join('\n\n');

    // Safety cap: kalau masih kepanjangan, pangkas bagian KONTEKS (paling besar) dulu.
    if (prompt.length > MAX_PROMPT_CHARS && safeContext) {
      const overflow = prompt.length - MAX_PROMPT_CHARS;
      const trimmed = safeContext.slice(0, Math.max(200, safeContext.length - overflow - 20)) + '…';
      prompt = prompt.replace(`KONTEKS MATERI/FAQ:\n${safeContext}`, `KONTEKS MATERI/FAQ:\n${trimmed}`);
    }

    return prompt;
  }
};

module.exports = promptService;
