// src/services/chat/chat.service.js

const chatModel = require('../../models/chat.model');
const intentService = require('../ai/intent.service');
const moderationService = require('../ai/moderation.service');
const aiRateLimitService = require('../ai/aiRateLimit.service');
const retrievalService = require('../rag/retrieval.service');
const contextBuilderService = require('../rag/context-builder.service');
const promptService = require('../ai/prompt.service');
const geminiService = require('../ai/gemini.service');
const systemResponseService = require('./system-response.service');
const ruleService = require('./rule.service');
const pageTemplateService = require('../template/page-template.service');
const activityModel = require('../../models/activity.model');
const lmsRouteModel = require('../../models/lmsRoute.model');
const aiResponseCacheModel = require('../../models/aiResponseCache.model');
const aiQueueService = require('../ai/aiQueue.service');
const lmsContextService = require('../moodle/lms-context.service');

const REQUEST_TIMEOUT_MS = parseInt(process.env.CHAT_REQUEST_TIMEOUT_MS || '20000', 10);
const AI_REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '18000', 10);

function withTimeout(promiseFactory, timeoutMs = REQUEST_TIMEOUT_MS, label = 'request') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${Math.round(timeoutMs / 1000)} detik`)), timeoutMs);
  });
  const taskPromise = typeof promiseFactory === 'function' ? promiseFactory() : promiseFactory;
  return Promise.race([taskPromise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function safeParseObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}


const LMS_INTENTS = [
  'cek_tugas_belum_selesai', 'cek_deadline_hari_ini', 'cek_deadline_terdekat',
  'cek_quiz_belum_dikerjakan', 'cek_forum_belum_dijawab', 'cek_aktivitas_course',
  'cek_pengajar_course', 'cek_course_saya', 'buka_aktivitas', 'tanya_email', 'tanya_username'
];

const QUICK_VISUAL_GUIDE_INTENTS = [
  'bantuan_login', 'bantuan_dashboard', 'navigasi_kursus', 'akses_materi',
  'bantuan_tugas', 'bantuan_kumpul_tugas', 'bantuan_kuis', 'bantuan_quiz',
  'bantuan_forum', 'bantuan_logout', 'bantuan_lihat_nilai', 'tutorial_steps'
];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanFeedbackPrompt(message = '') {
  let result = String(message || '').trim();
  const prefix = 'Jawaban sistem sebelumnya belum menyelesaikan masalah saya. Tolong jelaskan lebih detail dan lebih pelan untuk pertanyaan ini:';

  for (let i = 0; i < 10; i += 1) {
    if (!result.toLowerCase().startsWith(prefix.toLowerCase())) break;
    result = result.slice(prefix.length).trim();
  }

  return result || message || '';
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/log\s*in/g, 'login')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeRetrievalQuery(message = '') {
  const text = String(message || '').trim();
  const normalized = normalizeText(text);

  if (/\b(sosial media|sosmed|media sosial)\b/i.test(normalized)) {
    if (/\b(dampak|pengaruh|efek|akibat|positif|negatif|manfaat|risiko|bahaya)\b/i.test(normalized)) return 'dampak media sosial';
    if (/\b(contoh|jenis|macam|aplikasi)\b/i.test(normalized)) return 'jenis dan contoh media sosial';
    return 'apa itu media sosial';
  }

  if (/\b(hoax|hoaks)\b/i.test(normalized)) return 'apa itu hoax';
  if (/\b(cyberbullying|perundungan online|bullying online)\b/i.test(normalized)) return 'apa itu cyberbullying';

  return text;
}

function looksLikeMultipleChoiceQuestion(message = '') {
  const raw = String(message || '');
  return /(^|\n|\s)([A-Da-d])[\).]/.test(raw) || /\b(pilihan ganda|jawaban yang benar|pilih jawaban|opsi a|opsi b|opsi c|opsi d)\b/i.test(raw);
}


function extractMaterialSubject(message = '') {
  const raw = String(message || '').trim().replace(/[?!.]+$/g, '');
  const lower = raw.toLowerCase();
  const match = lower.match(/^(?:apa\s+itu|pengertian|definisi|maksud\s+dari|jelaskan(?:\s+tentang)?|fungsi|contoh|cara)\s+(.+)$/i);
  return normalizeText(match?.[1] || lower);
}

function isMaterialQuestion(message = '', detectedIntent = '') {
  const text = normalizeText(message);
  if (['penjelasan_materi', 'general_learning_help'].includes(String(detectedIntent || ''))) return true;
  return /\b(apa itu|pengertian|definisi|maksud|jelaskan|fungsi|contoh|dampak|manfaat|jenis|cara)\b/.test(text);
}

function materialContextLooksReliable(message = '', retrievalResults = []) {
  if (!retrievalResults.length) return false;
  const subject = extractMaterialSubject(message);
  const q = normalizeText(message);
  const top = retrievalResults[0] || {};
  const metadata = top.metadata || {};
  const haystack = normalizeText([
    top.title,
    top.topic,
    top.content,
    metadata.module_name,
    metadata.section_name,
    metadata.highlight_text
  ].filter(Boolean).join(' '));

  const isMediaSocial = /\b(media sosial|sosial media|sosmed|medsos)\b/.test(q) || subject === 'media sosial' || subject === 'sosial media';
  const isCms = /\b(cms|content management system|content manajemen sistem)\b/.test(q) || subject === 'cms';
  const isWordPress = /\b(wordpress|word press|wp)\b/.test(q) || subject === 'wordpress';

  if (isMediaSocial) {
    if (/\b(cms|wordpress|word press|joomla|drupal|wix|plugin)\b/.test(haystack) && !/\b(media sosial|sosial media|medsos|sosmed|jejaring sosial|social network)\b/.test(haystack)) return false;
    return /\b(media sosial|sosial media|medsos|sosmed|jejaring sosial|social network|interaksi sosial)\b/.test(haystack);
  }

  if (isCms) {
    if (/\b(media sosial|sosial media|kisi kisi|asat|pengumuman)\b/.test(haystack) && !/\b(cms|content management system|content manajemen sistem|wordpress|joomla|drupal|wix)\b/.test(haystack)) return false;
    return /\b(cms|content management system|content manajemen sistem|wordpress|joomla|drupal|wix|website)\b/.test(haystack);
  }

  if (isWordPress) {
    if (/\b(media sosial|sosial media|kisi kisi|asat|pengumuman)\b/.test(haystack) && !/\b(cms|wordpress|word press|website)\b/.test(haystack)) return false;
    return /\b(wordpress|word press|cms|website)\b/.test(haystack);
  }

  const importantWords = subject
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['apa','itu','ini','dan','yang','dari','ke','di','untuk','cara'].includes(w));
  if (!importantWords.length) return true;
  return importantWords.some((word) => haystack.includes(word));
}

function buildMaterialNotFoundMessage(message = '') {
  const subject = extractMaterialSubject(message);
  const label = subject ? `tentang **${escapeHtml(subject)}**` : 'yang kamu tanyakan';
  return `Aku belum menemukan materi yang cocok ${label} di sumber kelasmu. Jadi aku tidak mau menebak-nebak jawaban.\n\nCoba cek lagi kata kuncinya, atau minta guru/admin memastikan materi Moodle untuk topik itu sudah disinkronkan.`;
}

function buildSourceActionsFromRetrieval(retrievalResults = [], query = '') {
  const actions = [];
  const pdfActions = [];
  const moodleMaterials = [];
  const seenPdf = new Set();
  const moodleByUrl = new Map();
  const MAX_MOODLE_MATERIALS = 3;

  (retrievalResults || []).slice(0, 10).forEach((item, index) => {
    const metadata = item.metadata || {};
    const fileUrl = item.file_url || item.url || item.source_url || metadata.file_url || metadata.source_url || metadata.url;
    const fileType = item.file_type || metadata.file_type || metadata.content_type || '';
    const title = item.title || metadata.module_name || metadata.title || item.topic || `Materi ${index + 1}`;
    const pageNumber = Number(item.page_number || metadata.page_number || metadata.page || 1) || 1;
    const highlightText = item.highlight_text || metadata.highlight_text || item.chunk_text || item.content || '';
    const sourceOrigin = metadata.source_origin || item.source_origin || '';
    const modname = metadata.modname || item.modname || '';
    const contentSnippet = String(item.content || item.chunk_text || highlightText || '').replace(/\s+/g, ' ').trim();

    if (!fileUrl) return;

    const isPdf = String(fileUrl).toLowerCase().includes('.pdf') || String(fileType).toLowerCase().includes('pdf');
    const isMoodle = sourceOrigin === 'moodle' || /\/mod\/(page|resource|book)\/view\.php/i.test(String(fileUrl)) || String(modname).length > 0;

    if (isMoodle) {
      if (!moodleByUrl.has(fileUrl) && moodleMaterials.length >= MAX_MOODLE_MATERIALS) return;

      if (!moodleByUrl.has(fileUrl)) {
        const material = {
          title,
          topic: metadata.section_name || item.topic || '',
          url: fileUrl,
          source_url: fileUrl,
          file_type: isPdf ? 'pdf' : (fileType || 'html'),
          modname: modname || (isPdf ? 'resource' : 'page'),
          class_code: metadata.class_code || '',
          course_id: metadata.moodle_course_id || null,
          module_id: metadata.module_id || null,
          preview: contentSnippet.slice(0, 260),
          content: contentSnippet,
          score: item.score || 0,
          debug_score: item.debug_score || null,
          snippets: contentSnippet ? [contentSnippet] : []
        };
        moodleByUrl.set(fileUrl, material);
        moodleMaterials.push(material);
      } else if (contentSnippet) {
        const material = moodleByUrl.get(fileUrl);
        const duplicate = (material.snippets || []).some((old) => String(old || '').toLowerCase() === contentSnippet.toLowerCase());
        if (!duplicate && material.snippets.length < 8) material.snippets.push(contentSnippet);
        material.content = material.snippets.join('\n\n');
      }
    }

    if (isPdf && !seenPdf.has(fileUrl)) {
      seenPdf.add(fileUrl);
      pdfActions.push({
        type: 'open_pdf_viewer',
        label: `Buka sumber PDF: ${title}`.slice(0, 80),
        url: fileUrl,
        page_number: pageNumber,
        query,
        highlight_text: highlightText,
        content: item.content || item.chunk_text || ''
      });
    }
  });

  if (moodleMaterials.length > 0) {
    actions.push({
      type: 'open_moodle_materials',
      label: moodleMaterials.length > 1 ? `Lihat ${moodleMaterials.length} materi terkait` : 'Lihat materi',
      materials: moodleMaterials.slice(0, MAX_MOODLE_MATERIALS)
    });
  }

  return [...actions, ...pdfActions];
}


// ============================================================
// STATIC IMAGE TUTORIALS
// Sumber gambar: FE/public/DETAIL/... (tidak bergantung page_templates).
// Backend hanya mengirim metadata langkah + URL gambar. Rendering carousel ada di FE.
// ============================================================
function publicAssetPath(...segments) {
  return '/' + segments
    .filter(Boolean)
    .map((segment) => encodeURIComponent(String(segment)).replace(/%2F/g, '/'))
    .join('/');
}

function detailImage(...segments) {
  return publicAssetPath('DETAIL', ...segments);
}

const STATIC_TUTORIALS = {
  buat_forum: {
    key: 'buat_forum',
    title: 'Cara Membuat Forum Diskusi',
    shortTitle: 'Buat Forum',
    intent: 'tutorial_buat_forum',
    intro: 'Tutorial ini menjelaskan cara membuat topik diskusi/forum baru di VClass.',
    note: 'Catatan: nama forum, topik, tugas, dan isi teks pada gambar hanya contoh. Bentuk tombol dan elemen mengikuti tampilan VClass.',
    steps: [
      {
        title: 'Buka forum dari course',
        text: 'Klik salah satu forum pada course kamu. Contoh pada gambar adalah forum “Diskusi: Keuntungan CMS”.',
        image: detailImage('TUTORIAL BUAT FORUM', '0.png')
      },
      {
        title: 'Klik Tambahkan topik diskusi',
        text: 'Klik tombol “Tambahkan topik diskusi” untuk membuat jawaban/forum baru.',
        image: detailImage('TUTORIAL BUAT FORUM', '1.png')
      },
      {
        title: 'Isi kolom Subjek',
        text: 'Isi kolom subjek sesuai instruksi guru. Jika tidak ada format khusus, kamu bisa memakai format nama_kelas_minggu, contoh: AndiPratama_8A_M1.',
        image: detailImage('TUTORIAL BUAT FORUM', '2.png')
      },
      {
        title: 'Tulis jawaban pada kolom Pesan',
        text: 'Tuliskan jawaban diskusi kamu pada kolom pesan. Pastikan jawabannya sesuai pertanyaan atau instruksi guru.',
        image: detailImage('TUTORIAL BUAT FORUM', '3.png')
      },
      {
        title: 'Kirim ke forum',
        text: 'Kalau jawaban sudah benar, klik tombol “Kirim ke forum”.',
        image: detailImage('TUTORIAL BUAT FORUM', '4.png')
      },
      {
        title: 'Pastikan topik berhasil muncul',
        text: 'Setelah terkirim, cek tabel daftar diskusi. Jika postinganmu belum muncul, kemungkinan ada kolom wajib yang belum diisi atau koneksi belum stabil.',
        image: detailImage('TUTORIAL BUAT FORUM', '5.png'),
        note: 'Perhatikan juga instruksi guru: apakah syaratnya membuat topik baru atau membalas topik teman. Jika disebut minimal 3 forum/diskusi, pastikan jumlah yang diminta sudah terpenuhi.'
      }
    ]
  },

  reply_forum: {
    key: 'reply_forum',
    title: 'Cara Reply/Balas Diskusi Forum',
    shortTitle: 'Reply Forum',
    intent: 'tutorial_reply_forum',
    intro: 'Tutorial ini menjelaskan cara membalas diskusi/forum yang sudah dibuat di VClass.',
    note: 'Catatan: nama diskusi dan isi pesan pada gambar hanya contoh. Ikuti instruksi guru untuk isi jawaban sebenarnya.',
    steps: [
      {
        title: 'Pilih diskusi yang ingin dibalas',
        text: 'Cek daftar diskusi yang ingin kamu balas. Setelah ketemu, klik judul diskusinya.',
        image: detailImage('TUTORIAL REPLY FORUM', '0.png')
      },
      {
        title: 'Klik tombol Balas',
        text: 'Setelah halaman diskusi terbuka, klik tombol “Balas” pada bagian kanan bawah pesan.',
        image: detailImage('TUTORIAL REPLY FORUM', '2.png')
      },
      {
        title: 'Isi subjek dan pesan balasan',
        text: 'Isi subjek dan pesan balasanmu. Gunakan bahasa yang sopan dan sesuai topik diskusi.',
        image: detailImage('TUTORIAL REPLY FORUM', '3.png')
      },
      {
        title: 'Pastikan balasan tampil',
        text: 'Setelah membalas diskusi, pastikan pesanmu tampil sebagai balasan di bawah diskusi tersebut.',
        image: detailImage('TUTORIAL REPLY FORUM', '4.png'),
        note: 'Jika guru memberi syarat minimal balasan atau minimal jumlah siswa yang ikut diskusi, cek instruksinya terlebih dahulu sebelum lanjut ke aktivitas berikutnya.'
      }
    ]
  },

  kumpulin_tugas: {
    key: 'kumpulin_tugas',
    title: 'Cara Mengumpulkan Tugas',
    shortTitle: 'Kumpulkan Tugas',
    intent: 'tutorial_kumpulin_tugas',
    intro: 'Tutorial ini menjelaskan cara membaca instruksi, mengunggah file, dan memastikan tugas sudah terkumpul.',
    note: 'Catatan: judul tugas, format file, dan isi teks pada gambar hanya contoh. Selalu ikuti format file yang diminta guru.',
    steps: [
      {
        title: 'Buka tugas dari course',
        text: 'Pilih aktivitas tugas dari course kamu. Baca judul tugas dan pastikan kamu membuka tugas yang benar.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', '0.png')
      },
      {
        title: 'Baca instruksi tugas',
        text: 'Baca instruksi tugas, format file yang diminta, batas waktu, dan ketentuan pengumpulan. Setelah siap, klik tombol untuk mengirimkan tugas.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', 'TUGAS INSTRUKSI.png')
      },
      {
        title: 'Cek status pengajuan',
        text: 'Perhatikan status tugas. Dari sini kamu bisa tahu apakah tugas belum dikumpulkan, sudah terkirim, atau masih bisa diedit.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', 'TUGAS STATUS.png')
      },
      {
        title: 'Isi catatan jika perlu',
        text: 'Jika guru meminta catatan atau deskripsi tambahan, tuliskan pada kolom pesan/teks yang tersedia.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', 'INPUT TEKS TUGAS.png')
      },
      {
        title: 'Upload file tugas',
        text: 'Unggah file tugas sesuai format yang diminta, misalnya PDF, PNG, JPG, DOCX, atau format lain sesuai instruksi guru. Setelah itu simpan/kirim.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', 'INPUT FILE TUGAS.png')
      },
      {
        title: 'Pastikan status selesai',
        text: 'Setelah mengirim, pastikan status tugas menunjukkan bahwa tugas sudah berhasil dikumpulkan.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', 'STATUS SELESAI.png')
      }
    ]
  },

  lihat_aktivitas: {
    key: 'lihat_aktivitas',
    title: 'Cara Melihat Aktivitas',
    shortTitle: 'Lihat Aktivitas',
    intent: 'tutorial_lihat_aktivitas',
    intro: 'Tutorial ini menjelaskan cara membuka daftar aktivitas seperti tugas, kuis, forum, dan materi.',
    note: 'Catatan: nama aktivitas pada gambar hanya contoh. Daftar aktivitas bisa berbeda sesuai course dan kelas kamu.',
    steps: [
      {
        title: 'Perhatikan halaman course',
        text: 'Tetap di halaman course. Dari sini kamu bisa melihat menu yang tersedia untuk course tersebut.',
        image: detailImage('TUTORIAL LIHAT AKTIVITAS', '0.png')
      },
      {
        title: 'Klik menu Aktivitas',
        text: 'Klik menu “Aktivitas” untuk melihat daftar aktivitas seperti kuis, tugas, forum, dan materi.',
        image: detailImage('TUTORIAL LIHAT AKTIVITAS', '1.png')
      }
    ]
  },

  lihat_nilai: {
    key: 'lihat_nilai',
    title: 'Cara Melihat Nilai',
    shortTitle: 'Lihat Nilai',
    intent: 'tutorial_lihat_nilai',
    intro: 'Tutorial ini menjelaskan cara membuka menu nilai dan membaca daftar nilai aktivitas.',
    note: 'Catatan: angka nilai pada gambar hanya contoh. Nilai asli mengikuti data akun dan course kamu.',
    steps: [
      {
        title: 'Perhatikan halaman course',
        text: 'Tetap di halaman course. Dari sini kamu bisa membuka menu nilai pada course tersebut.',
        image: detailImage('TUTORIAL LIHAT NILAI', '0.png')
      },
      {
        title: 'Klik menu Nilai',
        text: 'Klik menu “Nilai” untuk membuka laporan nilai pada course.',
        image: detailImage('TUTORIAL LIHAT NILAI', '1.png')
      },
      {
        title: 'Lihat daftar nilai',
        text: 'Di halaman nilai, kamu bisa melihat nilai kuis, tugas, dan rata-rata nilai jika tersedia.',
        image: detailImage('TUTORIAL LIHAT NILAI', '2.png')
      }
    ]
  },

  logout: {
    key: 'logout',
    title: 'Cara Logout dari VClass',
    shortTitle: 'Logout',
    intent: 'tutorial_logout',
    intro: 'Tutorial ini menjelaskan cara keluar dari akun VClass di desktop maupun handphone.',
    note: 'Catatan: tampilan desktop dan handphone bisa sedikit berbeda, tetapi tombol keluar biasanya ada pada menu akun/profil.',
    steps: [
      {
        title: 'Mode desktop: cari ikon user',
        text: 'Jika memakai laptop/desktop, cari tombol dengan ikon user atau profil siswa pada bagian atas halaman.',
        image: detailImage('TUTORIAL LOGOUT', '1.png') // Folder logout tidak menggunakan base 0.png karena struktur aslinya langsung memisahkan visual desktop/mobile
      },
      {
        title: 'Mode handphone: cari tombol burger',
        text: 'Jika memakai handphone, cari tombol garis tiga/burger di pojok kanan atas.',
        image: detailImage('TUTORIAL LOGOUT', '1(2).png')
      },
      {
        title: 'Klik ikon user/profil',
        text: 'Setelah menu terbuka, klik ikon user atau bagian profil siswa.',
        image: detailImage('TUTORIAL LOGOUT', '2.png')
      },
      {
        title: 'Klik tombol Keluar',
        text: 'Cek bagian pojok kanan bawah menu. Klik tombol “Keluar” untuk logout dari akun VClass.',
        image: detailImage('TUTORIAL LOGOUT', '3.png')
      }
    ]
  },

  kuis: {
    key: 'kuis',
    title: 'Cara Mengerjakan Kuis',
    shortTitle: 'Mengerjakan Kuis',
    intent: 'tutorial_kuis',
    intro: 'Tutorial ini menjelaskan cara membuka kuis, mengerjakan soal, dan mengirim jawaban kuis.',
    note: 'Catatan: soal, pilihan jawaban, dan nilai pada gambar hanya contoh. Jawab soal sesuai materi yang kamu pelajari.',
    steps: [
      {
        title: 'Pilih link kuis dari course',
        text: 'Klik link kuis yang ingin kamu kerjakan dari halaman course.',
        image: detailImage('TUTORIAL QUIS', '0.png')
      },
      {
        title: 'Baca instruksi kuis',
        text: 'Baca instruksi kuis, jumlah percobaan, waktu pengerjaan, dan aturan penilaian. Setelah siap, klik tombol “Kerjakan kuis”.',
        image: detailImage('TUTORIAL QUIS', '1.png')
      },
      {
        title: 'Perhatikan navigasi kuis',
        text: 'Gunakan navigasi kuis untuk melihat kamu sedang mengerjakan nomor berapa dan soal mana yang belum dijawab.',
        image: detailImage('TUTORIAL QUIS', '2.png')
      },
      {
        title: 'Jawab soal pilihan ganda',
        text: 'Pilih salah satu jawaban yang menurut kamu benar. Pastikan hanya memilih jawaban yang sesuai instruksi soal.',
        image: detailImage('TUTORIAL QUIS', '3.png')
      },
      {
        title: 'Klik Halaman selanjutnya',
        text: 'Klik tombol “Halaman selanjutnya” untuk berpindah ke soal berikutnya.',
        image: detailImage('TUTORIAL QUIS', '4.png')
      },
      {
        title: 'Kirim semua dan selesai',
        text: 'Setelah semua soal selesai dijawab, klik tombol “Kirim semua dan selesai” untuk mengumpulkan kuis.',
        image: detailImage('TUTORIAL QUIS', '5.png')
      },
      {
        title: 'Review hasil pengerjaan',
        text: 'Lihat dan review ringkasan/statistik pengerjaan kuis kamu jika halaman review tersedia.',
        image: detailImage('TUTORIAL QUIS', '6.png')
      },
      {
        title: 'Lanjut ke materi berikutnya',
        text: 'Setelah selesai mereview, klik tombol selanjutnya untuk melanjutkan ke materi atau aktivitas berikutnya.',
        image: detailImage('TUTORIAL QUIS', '7.png')
      }
    ]
  }
};

function isLmsStatusQuestion(message = '', intent = '') {
  const normalizedIntent = String(intent || '').toLowerCase().trim();
  const text = normalizeText(message);

  if (LMS_INTENTS.includes(normalizedIntent)) return true;

  const asksStatus = /\b(belum|blm|nggak|gak|tidak|mana|apa aja|apa saja|daftar|list|cek|kerjain|ngerjain|dikerjain|deadline|tenggat|batas waktu|hari ini|terdekat|kerjain|ngerjain|dikerjain)\b/i.test(text);
  const mentionsActivity = /\b(quiz|kuis|quis|ujian|ulangan|soal|forum|diskusi|tugas|assignment|aktivitas|activity)\b/i.test(text);

  return mentionsActivity && asksStatus;
}

function inferLmsStatusIntentFromMessage(message = '') {
  const text = normalizeText(message);
  const hasStatus = /\b(belum|blm|nggak|gak|tidak|mana|apa aja|apa saja|daftar|list|cek|kerjain|ngerjain|dikerjain)\b/i.test(text);

  if (/\b(deadline|tenggat|batas waktu|jatuh tempo)\b/i.test(text)) {
    if (/\b(hari ini|sekarang|today)\b/i.test(text)) return 'cek_deadline_hari_ini';
    return 'cek_deadline_terdekat';
  }

  if (hasStatus && /\b(quiz|kuis|quis|ujian|ulangan|soal)\b/i.test(text)) {
    return 'cek_quiz_belum_dikerjakan';
  }

  if (hasStatus && /\b(forum|diskusi|topik diskusi|postingan)\b/i.test(text)) {
    return 'cek_forum_belum_dijawab';
  }

  if (hasStatus && /\b(tugas|assignment|pengumpulan)\b/i.test(text)) {
    return 'cek_tugas_belum_selesai';
  }

  return '';
}

function buildAiFollowupPromptForTutorial(tutorial = {}) {
  const title = String(tutorial.title || tutorial.shortTitle || 'panduan VClass')
    .replace(/^Cara\s+/i, '')
    .trim();

  const contextName = title || 'panduan VClass';
  return `Jelaskan cara ${contextName} secara jelas dan singkat.`;
}

function resolveStaticTutorialKey(intent = '', message = '') {
  const normalizedIntent = String(intent || '').toLowerCase().trim();
  const text = normalizeText(message);

  // Jangan trigger tutorial statis untuk pertanyaan status LMS, misalnya:
  // "quiz apa yang belum saya kerjakan?", "forum apa yang belum saya jawab?",
  // atau "deadline apa saja hari ini?". Pertanyaan seperti itu harus masuk jalur data LMS.
  if (isLmsStatusQuestion(text, normalizedIntent)) return '';

  const byIntent = {
    tutorial_buat_forum: 'buat_forum',
    tutorial_reply_forum: 'reply_forum',
    tutorial_kumpulin_tugas: 'kumpulin_tugas',
    tutorial_lihat_aktivitas: 'lihat_aktivitas',
    tutorial_lihat_nilai: 'lihat_nilai',
    tutorial_logout: 'logout',
    tutorial_kuis: 'kuis',
    bantuan_kumpul_tugas: 'kumpulin_tugas',
    bantuan_logout: 'logout',
    bantuan_lihat_nilai: 'lihat_nilai',
    bantuan_kuis: 'kuis',
    bantuan_quiz: 'kuis'
  };

  if (byIntent[normalizedIntent]) return byIntent[normalizedIntent];

  if (normalizedIntent === 'bantuan_forum') {
    if (/\b(reply|balas|membalas|jawab|menjawab)\b/i.test(text)) return 'reply_forum';
    return 'buat_forum';
  }

  if (normalizedIntent === 'bantuan_tugas') {
    if (/\b(lihat|melihat|daftar|aktivitas|activity)\b/i.test(text)) return 'lihat_aktivitas';
    return 'kumpulin_tugas';
  }

  if (/\b(reply|balas|membalas)\b/i.test(text) && /\b(forum|diskusi)\b/i.test(text)) return 'reply_forum';
  if (/\b(buat|membuat|tambah|tambahkan|posting|topik)\b/i.test(text) && /\b(forum|diskusi)\b/i.test(text)) return 'buat_forum';
  if (/\b(kumpul|kumpulin|mengumpulkan|upload|unggah|kirimkan)\b/i.test(text) && /\b(tugas|assignment)\b/i.test(text)) return 'kumpulin_tugas';
  if (/\b(lihat|melihat|cek|daftar)\b/i.test(text) && /\b(aktivitas|activity|tugas)\b/i.test(text)) return 'lihat_aktivitas';
  if (/\b(nilai|grade|grades|rapor|laporan)\b/i.test(text)) return 'lihat_nilai';
  if (/\b(logout|log out|keluar|sign out)\b/i.test(text)) return 'logout';
  if (/\b(kuis|quiz|soal|ujian)\b/i.test(text)) return 'kuis';

  return '';
}

function cloneStaticTutorial(tutorial = {}) {
  return JSON.parse(JSON.stringify(tutorial || {}));
}

function buildStaticTutorialChatResponse({ studentName = '', tutorialKey = '', effectiveMessage = '' }) {
  const tutorial = STATIC_TUTORIALS[tutorialKey];
  if (!tutorial) return null;

  const safeName = String(studentName || 'teman').trim() || 'teman';
  const payload = cloneStaticTutorial(tutorial);
  payload.original_message = effectiveMessage;

  return {
    message:
      `Hai **${safeName}**,\n\n` +
      `Aku sudah siapkan panduan visual **${tutorial.title}**.\n\n` +
      `Silakan klik tombol di bawah ini untuk membuka langkah-langkahnya dalam bentuk carousel. ` +
      `Gambarnya bisa diklik supaya tampil lebih besar.`,
    actions: [
      {
        type: 'static_tutorial_carousel',
        label: `Lihat Tutorial ${tutorial.shortTitle || tutorial.title}`,
        payload
      },
      {
        type: 'ask_ai',
        label: 'Belum jelas, jelaskan dengan AI',
        payload: {
          original_message: effectiveMessage,
          message: buildAiFollowupPromptForTutorial(tutorial),
          source_answer: `Panduan sistem berbasis gambar statis: ${tutorial.title}`,
          intent: tutorial.intent,
          responseMode: 'short',
          forceAI: true,
          expectedSourceType: 'all'
        }
      },
      { type: 'system_feedback_ok', label: 'Sudah jelas' }
    ]
  };
}

function isCacheableAIRequest({ detectedIntent, forceAI, forceFAQ, forceSystem }) {
  if (forceFAQ || forceSystem) return false;

  // Kalau user sengaja minta "jelaskan dengan AI", boleh tetap cache
  // asal bukan pertanyaan elemen/UI spesifik.
  const cacheableIntents = [
    'penjelasan_materi',
    'general_learning_help'
  ];

  return cacheableIntents.includes(detectedIntent);
}

function getCacheTtlMs() {
  const seconds = parseInt(process.env.AI_RESPONSE_CACHE_TTL_SECONDS || '86400', 10);
  return Math.max(60, seconds) * 1000;
}

function getExpiresAt() {
  return new Date(Date.now() + getCacheTtlMs()).toISOString();
}

function buildContextHash(retrievalResults = []) {
  const raw = retrievalResults
    .slice(0, 2)
    .map((item) => [
      item.source_type,
      item.title,
      item.topic,
      item.metadata?.document_id,
      item.metadata?.page_number
    ].filter(Boolean).join('|'))
    .join('\n---\n');

  return aiResponseCacheModel.hashText(raw || 'no_context');
}

const SAFE_SYSTEM_INTENTS = [
  'navigasi_kursus',
  'bantuan_dashboard',
  'bantuan_login',
  'akses_materi',
  'bantuan_tugas',
  'bantuan_kuis',
  'bantuan_forum',
  'penjelasan_materi',
  'general_learning_help',
  'element_question'
];

const HARD_BLOCK_MODERATION_TYPES = ['hate_speech'];

const OBVIOUS_PROFANITY_PATTERNS = [
  /\b(anjing|bangsat|kontol|memek|goblok|tolol|bego|babi)\b/i
];

function hasObviousProfanity(message = '') {
  return OBVIOUS_PROFANITY_PATTERNS.some((pattern) => pattern.test(String(message || '')));
}

function isTemplateProbablyFor(template = {}, targets = []) {
  const haystack = normalizeText([
    template?.page_type,
    template?.template_name,
    template?.match_url_contains,
    template?.match_title_contains,
    template?.match_heading_contains
  ].filter(Boolean).join(' '));
  return targets.some((target) => haystack.includes(normalizeText(target)));
}

async function safeMatchTemplate(projectId, context = {}, sourceUrl = '') {
  try {
    return await pageTemplateService.matchTemplate(projectId, context, sourceUrl);
  } catch (error) {
    console.warn('[chat.service] Gagal match template:', error.message);
    return null;
  }
}

async function safeFindTemplateByType(projectId, pageType = '') {
  if (!pageType) return null;
  try {
    if (typeof pageTemplateService.findTemplateByType === 'function') {
      return await pageTemplateService.findTemplateByType(projectId, pageType);
    }
    return null;
  } catch (error) {
    console.warn('[chat.service] Gagal ambil template type:', pageType, error.message);
    return null;
  }
}

function getTemplateKeysForIntent(intent = '') {
  if (intent === 'bantuan_login') return ['login', 'landing', 'dashboard'];
  if (intent === 'navigasi_kursus' || intent === 'bantuan_dashboard') return ['dashboard'];
  if (intent === 'akses_materi') return ['course', 'materi', 'summary', 'dashboard'];
  if (intent === 'bantuan_kuis' || intent === 'bantuan_quiz') return ['quiz', 'course'];
  if (intent === 'bantuan_tugas' || intent === 'bantuan_kumpul_tugas') return ['tugas', 'tugas_detail', 'tugas_selesai', 'course'];
  if (intent === 'bantuan_forum') return ['forum', 'forum_detail', 'course'];
  if (intent === 'tutorial_steps') return ['login', 'dashboard', 'course'];
  return [];
}

async function buildTemplateMap(projectId, currentPageContext = {}, sourceUrl = '', intent = '') {
  const map = { current: null };

  const candidates = {
    landing: {
      pageType: 'landing', type: 'landing', title: 'VClass', heading: 'Selamat Datang',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/'
    },
    login: {
      pageType: 'login', type: 'login', title: 'Login', heading: 'Login',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/login/index.php'
    },
    dashboard: {
      pageType: 'dashboard', type: 'dashboard', title: 'Kursusku', heading: 'Kursusku',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/my/courses.php'
    },
    course: {
      pageType: 'course', type: 'course', title: 'Informatika', heading: 'Informatika',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/course/view.php?id=2'
    },
    materi: {
      pageType: 'materi', type: 'materi', title: 'Materi', heading: 'Materi',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/page/view.php?id=494'
    },
    summary: {
      pageType: 'summary', type: 'summary', title: 'Rangkuman', heading: 'Rangkuman',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/page/view.php?id=494'
    },
    quiz: {
      pageType: 'quiz', type: 'quiz', title: 'Quiz', heading: 'Quiz',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/quiz/view.php?id=1'
    },
    forum: {
      pageType: 'forum', type: 'forum', title: 'Forum', heading: 'Forum',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/forum/view.php?id=1'
    },
    forum_detail: {
      pageType: 'forum_detail', type: 'forum_detail', title: 'Diskusi Forum', heading: 'Diskusi Forum',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/forum/discuss.php?d=1'
    },
    tugas: {
      pageType: 'tugas', type: 'tugas', title: 'Tugas', heading: 'Tugas',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/assign/view.php?id=1'
    },
    tugas_detail: {
      pageType: 'tugas_detail', type: 'tugas_detail', title: 'Upload Tugas', heading: 'Upload Tugas',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/assign/view.php?id=1&action=editsubmission'
    },
    tugas_selesai: {
      pageType: 'tugas_selesai', type: 'tugas_selesai', title: 'Tugas Selesai', heading: 'Tugas Selesai',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/assign/view.php?id=1'
    }
  };

  const keys = getTemplateKeysForIntent(intent);

  // Untuk request biasa, jangan ambil semua template supaya /send tidak lemot.
  if (!keys.length) return map;

  for (const key of keys) {
    map[key] = await safeFindTemplateByType(projectId, key);

    // Fallback match kalau type belum ketemu.
    if (!map[key] && candidates[key]) {
      map[key] = await safeMatchTemplate(projectId, candidates[key], candidates[key].sourceUrl);
    }

    if (!map.current && map[key]) map.current = map[key];
  }

  // Kalau current page memang cocok dengan salah satu target, pakai itu sebagai current juga.
  const current = await safeMatchTemplate(projectId, currentPageContext, sourceUrl);
  if (current && keys.some((key) => isTemplateProbablyFor(current, [key]))) {
    map.current = current;
    keys.forEach((key) => {
      if (isTemplateProbablyFor(current, [key])) map[key] = current;
    });
  }

  return map;
}

function selectSystemTemplate({ intent, templateMap }) {
  if (!templateMap) return null;

  if (intent === 'bantuan_login') {
    return templateMap.login || templateMap.landing || templateMap.current;
  }

  if (intent === 'navigasi_kursus' || intent === 'bantuan_dashboard') {
    return templateMap.dashboard || templateMap.current;
  }

  if (intent === 'akses_materi') {
    return templateMap.course || templateMap.materi || templateMap.summary || templateMap.current;
  }

  if (intent === 'bantuan_tugas' || intent === 'bantuan_kumpul_tugas') {
    return templateMap.course || templateMap.current;
  }

  if (intent === 'bantuan_kuis' || intent === 'bantuan_quiz') {
    return templateMap.quiz || templateMap.course || templateMap.current;
  }

  if (intent === 'bantuan_forum') {
    return templateMap.course || templateMap.current;
  }

  if (intent === 'penjelasan_materi') {
    return templateMap.summary || templateMap.materi || templateMap.course || templateMap.current;
  }

  return templateMap.current;
}

function normalizeClassCode(value = '') {
  const raw = String(value || '').toUpperCase().trim();

  const match = raw.match(/\b(8\s*[A-H])\b/i);
  if (!match) return '';

  return match[1].replace(/\s+/g, '');
}


function detectClassMention(message = '') {
  const text = String(message || '').toUpperCase();

  // Deteksi kelas spesifik: 7A-7Z, 8A-8Z, 9A-9Z, 10A dst.
  // Contoh yang ditangkap: "kelas 8A", "8 A", "9A", "kelas IX A".
  const numericMatch = text.match(/(?:\bKELAS\s*)?\b(7|8|9|10|11|12)\s*([A-Z])\b/);
  if (numericMatch) return `${numericMatch[1]}${numericMatch[2]}`.toUpperCase();

  const romanMap = {
    VII: '7',
    VIII: '8',
    IX: '9',
    X: '10',
    XI: '11',
    XII: '12'
  };
  const romanMatch = text.match(/(?:\bKELAS\s*)?\b(VII|VIII|IX|X|XI|XII)\s*([A-Z])\b/);
  if (romanMatch) return `${romanMap[romanMatch[1]] || romanMatch[1]}${romanMatch[2]}`.toUpperCase();

  return '';
}

function buildClassIsolationResponse({ studentName = '', classCode = '', mentionedClass = '' } = {}) {
  const name = studentName || 'teman';
  const currentClass = classCode || 'kelas kamu';
  const targetClass = mentionedClass || 'kelas lain';

  return `Hai **${escapeHtml(name)}**,\n\nUntuk menjaga supaya jawabannya sesuai materi kamu, aku hanya bisa membantu berdasarkan konteks **kelas ${escapeHtml(currentClass)}**.\n\nKamu tadi menyebut **kelas ${escapeHtml(targetClass)}**, jadi aku belum bisa menjawab bagian itu. Kalau memang kelasmu berubah, mulai sesi ulang dan pilih kelas yang benar dulu ya.`;
}

function getClassCodeFromSession(session = {}) {
  const courseContext = safeParseObject(session.course_context, {});
  const pageContext = safeParseObject(session.page_context, {});

  return (
    normalizeClassCode(courseContext.class_code) ||
    normalizeClassCode(courseContext.classCode) ||
    normalizeClassCode(courseContext.kelas) ||
    normalizeClassCode(pageContext.session_meta?.class_code) ||
    normalizeClassCode(pageContext.session_meta?.kelas) ||
    normalizeClassCode(pageContext.session_meta?.display_name) ||
    normalizeClassCode(session.student_alias)
  );
}

function getCourseIdFromUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''), 'https://lms.smpn167jakarta.sch.id');
    const id = parsed.searchParams.get('id');
    return id ? Number(id) : null;
  } catch (_) {
    return null;
  }
}

function buildCourseUrl(courseId = 2) {
  return `https://lms.smpn167jakarta.sch.id/course/view.php?id=${encodeURIComponent(courseId)}`;
}

async function getCourseRoute(projectId, classCode, fallbackCourseId = 2) {
  if (classCode) {
    try {
      const route = await lmsRouteModel.findCourseRoute(projectId, classCode);
      if (route) return route;
    } catch (error) {
      console.warn('[chat.service] Gagal mengambil lms_course_routes:', error.message);
    }
  }

  return {
    class_code: classCode || '',
    course_id: fallbackCourseId || 2,
    course_url: buildCourseUrl(fallbackCourseId || 2),
    course_title: classCode ? `Informatika Kelas ${classCode}` : 'Kursus Informatika'
  };
}

async function getActivityRoute(projectId, classCode, activityTitle, courseId) {
  if (!classCode || !activityTitle || !courseId) return null;

  try {
    return await lmsRouteModel.findActivityRoute(
      projectId,
      classCode,
      courseId,
      activityTitle
    );
  } catch (error) {
    console.warn('[chat.service] Gagal mengambil lms_activity_routes:', error.message);
    return null;
  }
}

async function buildActivityActionButton({ projectId, session, activity }) {
  const classCode = getClassCodeFromSession(session);

  const fallbackCourseId =
    getCourseIdFromUrl(session.source_url) ||
    getCourseIdFromUrl(safeParseObject(session.page_context, {}).sourceUrl) ||
    null;

  const courseRoute = await getCourseRoute(projectId, classCode, fallbackCourseId || 2);

  const activityRoute = await getActivityRoute(
    projectId,
    classCode,
    activity.title,
    courseRoute.course_id
  );

  if (activityRoute?.activity_url) {
    return `
      <button
        type="button"
        class="btn-return-source bg-primary text-white px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
        data-url="${escapeHtml(activityRoute.activity_url)}"
        data-page-type="activity"
        data-course-id="${escapeHtml(activityRoute.course_id)}">
        Lihat Tugas
      </button>
    `;
  }

  if (courseRoute?.course_url) {
    return `
      <button
        type="button"
        class="btn-return-source bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
        data-url="${escapeHtml(courseRoute.course_url)}"
        data-page-type="course"
        data-course-id="${escapeHtml(courseRoute.course_id)}">
        Lihat Tugas
      </button>
    `;
  }

  return `
    <span class="text-[11px] text-slate-400 whitespace-nowrap">
      Link belum tersedia
    </span>
  `;
}

function getClassDisplayNameFromSession(session = {}) {
  const classCode = getClassCodeFromSession(session);
  return classCode || 'kelas saat ini';
}

function getActivityTypeOrder(activityType = '') {
  const normalized = normalizeText(activityType);

  if (
    normalized.includes('assigment') ||
    normalized.includes('assignment') ||
    normalized.includes('tugas') ||
    normalized.includes('assign')
  ) {
    return 1;
  }

  if (
    normalized.includes('forum') ||
    normalized.includes('diskusi')
  ) {
    return 2;
  }

  if (
    normalized.includes('quiz') ||
    normalized.includes('kuis') ||
    normalized.includes('pilihan ganda')
  ) {
    return 3;
  }

  return 99;
}

function sortActivitiesByTypeAsc(activities = []) {
  return [...activities].sort((a, b) => {
    const orderA = getActivityTypeOrder(a.activity_type);
    const orderB = getActivityTypeOrder(b.activity_type);

    if (orderA !== orderB) return orderA - orderB;

    return String(a.title || '').localeCompare(String(b.title || ''), 'id');
  });
}

const QUICK_GUIDE_FAQ_MAP = {
  bantuan_kumpul_tugas: {
    categoryIncludes: ['tugas'],
    query: 'Cara upload tugas gimana?',
    fallbackMessage:
      'Untuk mengumpulkan tugas, buka aktivitas Tugas/Assignment, baca instruksi, klik Add submission/Tambah pengumpulan, unggah file sesuai format, lalu klik Save changes/Simpan. Jika ada tombol Submit assignment/Kirim tugas, klik juga tombol tersebut agar benar-benar terkumpul.'
  },

  bantuan_tugas: {
    categoryIncludes: ['tugas'],
    query: 'Cara upload tugas gimana?',
    fallbackMessage:
      'Untuk mengumpulkan tugas, buka aktivitas Tugas/Assignment, baca instruksi, klik Add submission/Tambah pengumpulan, unggah file sesuai format, lalu klik Save changes/Simpan.'
  },

  bantuan_forum: {
    categoryIncludes: ['forum', 'aktivitas forum'],
    query: 'Bagaimana cara mengerjakan tugas forum di VClass?',
    fallbackMessage:
      'Untuk mengerjakan forum, buka kursus Informatika sesuai kelasmu, cari aktivitas Forum, baca instruksi guru, lalu pilih membuat topik diskusi baru atau membalas postingan dengan tombol Reply/Balas. Tulis jawaban dengan sopan, lalu klik Kirim/Post.'
  },

  bantuan_quiz: {
    categoryIncludes: ['quiz', 'quiz/exam'],
    query: 'Cara mengerjakan soal/quiz gimana?',
    fallbackMessage:
      'Untuk mengerjakan quiz, buka course, cari aktivitas Quiz/Ujian, baca instruksi, lalu klik Attempt quiz/Kerjakan. Jawab soal satu per satu, gunakan Next jika ada, lalu klik Submit all and finish/Kumpulkan setelah yakin selesai.'
  },

  bantuan_kuis: {
    categoryIncludes: ['quiz', 'quiz/exam'],
    query: 'Cara mengerjakan soal/quiz gimana?',
    fallbackMessage:
      'Untuk mengerjakan quiz, buka course, cari aktivitas Quiz/Ujian, baca instruksi, lalu klik Attempt quiz/Kerjakan. Jawab soal satu per satu, lalu klik Submit all and finish/Kumpulkan setelah selesai.'
  },

  bantuan_login: {
    categoryIncludes: ['login'],
    query: 'Cara login ke Virtual Class gimana?',
    fallbackMessage:
      'Untuk login, buka halaman Virtual Class, klik Login, lalu masukkan username/email dan password dari sekolah/guru/admin. Setelah itu klik Masuk/Login.'
  },

  bantuan_lupa_password: {
    categoryIncludes: ['login'],
    query: 'Kalau lupa password gimana?',
    fallbackMessage:
      'Jika lupa password, gunakan fitur Lupa Password jika tersedia. Jika tidak tersedia atau email pemulihan tidak aktif, hubungi guru/admin untuk reset password.'
  },

  bantuan_logout: {
    categoryIncludes: ['logout', 'keluar akun', 'akun'],
    query: 'Cara logout atau keluar akun VClass gimana?',
    fallbackMessage:
      'Untuk keluar akun VClass, cari menu profil atau nama akun di bagian kanan atas, lalu pilih Log out/Keluar. Setelah itu pastikan halaman kembali ke halaman login atau landing.'
  }
};

function normalizeFaqText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFaqCategoryAllowed(faq = {}, allowedCategories = []) {
  if (!allowedCategories.length) return true;

  const category = normalizeFaqText(faq.category || faq.metadata?.category || '');
  return allowedCategories.some((item) => category.includes(normalizeFaqText(item)));
}

async function getQuickGuideFaqAnswer(projectId, intent) {
  const config = QUICK_GUIDE_FAQ_MAP[intent];
  if (!config) return null;

  try {
    const results = await retrievalService.retrieve(
      projectId,
      config.query,
      {},
      5,
      { sourceType: 'faq' }
    );

    const matched = results.find((item) => {
      return isFaqCategoryAllowed(item, config.categoryIncludes);
    });

    if (matched?.content) {
      return {
        message: matched.content,
        matched
      };
    }

    return {
      message: config.fallbackMessage,
      matched: null
    };
  } catch (error) {
    console.warn('[chat.service] Gagal mengambil quick guide FAQ:', error.message);

    return {
      message: config.fallbackMessage,
      matched: null
    };
  }
}


function safeParseArray(value, fallback = []) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Array.isArray(value) ? value : fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function startsWithGreeting(value = '') {
  const plain = String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return plain.startsWith('hai ') || plain.startsWith('halo ');
}

function addStudentGreeting(message = '', studentName = '') {
  const safeName = String(studentName || 'teman').trim() || 'teman';
  const raw = String(message || '').trim();
  if (!raw) return `Hai **${safeName}**, ada yang bisa aku bantu?`;

  if (raw.includes('"answer_mode"') && raw.includes('tutorial_steps')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.answer_mode === 'tutorial_steps') {
        const answerText = String(parsed.answer_text || '').trim();
        parsed.answer_text = startsWithGreeting(answerText)
          ? answerText
          : `Hai **${safeName}**,\n\n${answerText || 'Berikut panduan penggunaan dari sistem.'}`;
        return JSON.stringify(parsed);
      }
    } catch (_) {}
  }

  if (startsWithGreeting(raw)) return raw;
  return `Hai **${safeName}**,\n\n${raw}`;
}

function extractTemplateStyles(html = '') {
  const raw = String(html || '');
  const styles = [];
  const linkRegex = /<link\b(?=[^>]*rel=["']?stylesheet["']?)[^>]*>/gi;
  const styleRegex = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  let match;
  while ((match = linkRegex.exec(raw)) !== null) styles.push(match[0]);
  while ((match = styleRegex.exec(raw)) !== null) styles.push(match[0]);
  return styles.join('\n');
}

function getTemplateElements(template = {}) {
  return safeParseArray(template?.elements_json, []);
}

function getTemplateSteps(template = {}) {
  return safeParseArray(template?.tutorial_steps_json, []);
}

function normalizeStep(step = {}, index = 0) {
  return {
    step_number: step.step_number || step.step || index + 1,
    title: step.title || `Langkah ${index + 1}`,
    description: step.description || step.text || '',
    element_ref: step.element_ref || step.element_key || step.key || step.element || ''
  };
}

function findElementByKey(elements = [], key = '') {
  const target = String(key || '').toLowerCase().trim();
  if (!target) return null;
  return (elements || []).find((el) => {
    return [el.key, el.name, el.title, el.selector]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().trim() === target);
  }) || null;
}

function withTemplateMeta(element = {}, template = {}) {
  if (!element) return null;
  return {
    ...element,
    template_id: template.id,
    template_name: template.template_name,
    template_page_type: template.page_type,
    template_styles: extractTemplateStyles(template.html_preview || '')
  };
}

function makeFaqReference(intent = '') {
  const config = QUICK_GUIDE_FAQ_MAP[intent] || QUICK_GUIDE_FAQ_MAP.bantuan_login;
  if (!config) return null;
  return {
    title: `Referensi FAQ terkait: ${config.query}`,
    content: config.fallbackMessage
  };
}

function resolveGuideTemplate(intent, templateMap = {}, matchedTemplate = null) {
  if (intent === 'bantuan_login') return templateMap.login || templateMap.landing || matchedTemplate || templateMap.current;
  if (intent === 'navigasi_kursus' || intent === 'bantuan_dashboard') return templateMap.dashboard || matchedTemplate || templateMap.current;
  if (intent === 'akses_materi') return templateMap.course || templateMap.materi || templateMap.summary || templateMap.dashboard || matchedTemplate || templateMap.current;
  if (intent === 'bantuan_kuis' || intent === 'bantuan_quiz') return templateMap.quiz || templateMap.course || matchedTemplate || templateMap.current;
  if (intent === 'bantuan_tugas' || intent === 'bantuan_kumpul_tugas' || intent === 'bantuan_forum') return templateMap.course || matchedTemplate || templateMap.current;
  if (intent === 'bantuan_logout') return templateMap.dashboard || templateMap.current || matchedTemplate;
  return matchedTemplate || templateMap.current;
}


function makeTemplateElement({ key, name, title, type, text, html, template }) {
  return withTemplateMeta({ key, name, title, type, text, html }, template || {});
}

function extractFirstMatch(html = '', regexes = []) {
  const raw = String(html || '');
  for (const regex of regexes) {
    const match = raw.match(regex);
    if (match && match[0]) return match[0];
  }
  return '';
}

function extractLoginButtonElement(landingElement = {}, landingTemplate = {}) {
  const html = String(landingElement?.html || '');
  const buttonHtml = extractFirstMatch(html, [
    /<a\b(?=[^>]*href=["'][^"']*login\/index\.php[^"']*["'])(?=[^>]*>[^<]*(?:Login|Masuk)[^<]*<\/a>)[\s\S]*?<\/a>/i,
    /<a\b[^>]*>[\s\S]*?(?:Login Siswa|Login|Masuk)[\s\S]*?<\/a>/i,
    /<button\b[^>]*>[\s\S]*?(?:Login|Masuk)[\s\S]*?<\/button>/i
  ]) || html;

  return makeTemplateElement({
    key: 'visual_login_open_button',
    name: '@tombollogin',
    title: 'Tombol Login',
    type: 'Tombol',
    text: 'Login Siswa / Masuk',
    html: buttonHtml,
    template: landingTemplate
  });
}

function splitLoginFormVisuals(loginElement = {}, loginTemplate = {}) {
  const html = String(loginElement?.html || '');

  const usernameBlock = extractFirstMatch(html, [
    /<div\b[^>]*(?:login-form-username|username)[^>]*>[\s\S]*?<\/div>/i,
    /<label\b[^>]*for=["']username["'][\s\S]*?<input\b[^>]*id=["']username["'][^>]*>/i,
    /<input\b[^>]*(?:name|id)=["']username["'][^>]*>/i
  ]);

  const passwordBlock = extractFirstMatch(html, [
    /<div\b[^>]*(?:login-form-password|password)[^>]*>[\s\S]*?<\/div>/i,
    /<label\b[^>]*for=["']password["'][\s\S]*?<input\b[^>]*id=["']password["'][^>]*>/i,
    /<input\b[^>]*(?:name|id)=["']password["'][^>]*>/i
  ]);

  const submitBlock = extractFirstMatch(html, [
    /<div\b[^>]*(?:login-form-submit|submit)[^>]*>[\s\S]*?<\/div>/i,
    /<button\b[^>]*(?:id=["']loginbtn["']|type=["']submit["'])[^>]*>[\s\S]*?<\/button>/i
  ]);

  const fieldsHtml = `<form class="login-form alb-login-preview-form">${usernameBlock || ''}${passwordBlock || ''}</form>`;
  const submitHtml = submitBlock || extractFirstMatch(html, [/<button\b[^>]*>[\s\S]*?(?:Log in|Login|Masuk)[\s\S]*?<\/button>/i]) || html;

  return {
    fields: makeTemplateElement({
      key: 'visual_login_fields',
      name: '@kolomusernamepassword',
      title: 'Kolom Username dan Password',
      type: 'Kolom Input',
      text: 'Kolom username dan password',
      html: fieldsHtml,
      template: loginTemplate
    }),
    submit: makeTemplateElement({
      key: 'visual_login_submit',
      name: '@tombolmasuk',
      title: 'Tombol Log in / Masuk',
      type: 'Tombol',
      text: 'Tombol Log in / Masuk',
      html: submitHtml,
      template: loginTemplate
    })
  };
}

function makeGenericStepElement(element = {}, template = {}) {
  const html = String(element?.html || '');
  let focusedHtml = html;

  if (/forum|reply|balas|diskusi/i.test([element?.title, element?.text, element?.name].filter(Boolean).join(' '))) {
    focusedHtml = extractFirstMatch(html, [/<button\b[^>]*>[\s\S]*?(?:Reply|Balas|Post|Kirim)[\s\S]*?<\/button>/i, /<a\b[^>]*>[\s\S]*?(?:Reply|Balas|Add discussion|Diskusi)[\s\S]*?<\/a>/i]) || html;
  }

  if (/quiz|kuis|attempt|kerjakan/i.test([element?.title, element?.text, element?.name].filter(Boolean).join(' '))) {
    focusedHtml = extractFirstMatch(html, [/<button\b[^>]*>[\s\S]*?(?:Attempt|Kerjakan|Mulai|Submit)[\s\S]*?<\/button>/i, /<a\b[^>]*>[\s\S]*?(?:Attempt|Kerjakan|Mulai|Quiz|Kuis)[\s\S]*?<\/a>/i]) || html;
  }

  if (/tugas|assign|submission|upload|kumpul/i.test([element?.title, element?.text, element?.name].filter(Boolean).join(' '))) {
    focusedHtml = extractFirstMatch(html, [/<button\b[^>]*>[\s\S]*?(?:Add submission|Submit|Save|Upload|Kumpul|Simpan)[\s\S]*?<\/button>/i, /<a\b[^>]*>[\s\S]*?(?:Add submission|Submit|Assignment|Tugas|Upload)[\s\S]*?<\/a>/i]) || html;
  }

  return withTemplateMeta({ ...element, html: focusedHtml }, template);
}

function buildLoginVisualGuidePayload({ studentName, templateMap = {} }) {
  const currentTemplate = templateMap.current || null;
  const currentIsLogin = currentTemplate && isTemplateProbablyFor(currentTemplate, ['login']);
  const currentIsLandingOrDashboard = currentTemplate && isTemplateProbablyFor(currentTemplate, ['landing', 'dashboard']);

  // Kalau siswa memang sedang berada di halaman login, visual pertama langsung pakai form login.
  // Kalau siswa berada di landing/dashboard, visual pertama pakai tombol Login/Masuk di area header/navbar halaman asal.
  const loginTemplate = currentIsLogin ? currentTemplate : (templateMap.login || null);
  const openTemplate = currentIsLogin
    ? null
    : (currentIsLandingOrDashboard ? currentTemplate : (templateMap.landing || templateMap.dashboard || currentTemplate || null));

  const openElements = getTemplateElements(openTemplate);
  const loginElements = getTemplateElements(loginTemplate);

  const openLoginArea = openElements.find((el) => {
    const haystack = [el.title, el.text, el.name, el.selector, el.type].filter(Boolean).join(' ');
    return /login|log in|masuk|akses|navbar|header|pembelajaran/i.test(haystack);
  }) || openElements[0];

  const loginForm = loginElements.find((el) => {
    const haystack = [el.title, el.text, el.name, el.selector, el.type].filter(Boolean).join(' ');
    return /username|password|login|log in|form|kolom/i.test(haystack);
  }) || loginElements[0];

  const loginButton = !currentIsLogin && openLoginArea
    ? extractLoginButtonElement(openLoginArea, openTemplate)
    : null;

  const splitForm = loginForm
    ? splitLoginFormVisuals(loginForm, loginTemplate)
    : { fields: null, submit: null };

  const templateElements = currentIsLogin
    ? [splitForm.fields, splitForm.submit].filter(Boolean)
    : [loginButton, splitForm.fields, splitForm.submit].filter(Boolean);

  const steps = currentIsLogin
    ? [
        {
          step_number: 1,
          title: 'Isi username dan password',
          description: 'Kamu sudah berada di halaman login. Isi kolom username dan password sesuai akun dari sekolah atau guru.',
          element_ref: splitForm.fields?.key || splitForm.fields?.name || ''
        },
        {
          step_number: 2,
          title: 'Tekan tombol Log in',
          description: 'Setelah username dan password terisi, klik tombol Log in/Masuk dan tunggu sampai dashboard terbuka.',
          element_ref: splitForm.submit?.key || splitForm.submit?.name || ''
        }
      ]
    : [
        {
          step_number: 1,
          title: 'Buka halaman login',
          description: 'Klik tombol Login/Masuk pada area navbar atau header halaman VClass untuk menuju form login.',
          element_ref: loginButton?.key || loginButton?.name || ''
        },
        {
          step_number: 2,
          title: 'Isi username dan password',
          description: 'Setelah halaman login terbuka, isi kolom username dan password sesuai akun dari sekolah atau guru.',
          element_ref: splitForm.fields?.key || splitForm.fields?.name || ''
        },
        {
          step_number: 3,
          title: 'Tekan tombol Log in',
          description: 'Klik tombol Log in/Masuk, lalu tunggu sampai dashboard VClass terbuka.',
          element_ref: splitForm.submit?.key || splitForm.submit?.name || ''
        }
      ];

  if (!templateElements.length) return null;

  return {
    answer_mode: 'tutorial_steps',
    answer_text: `Hai **${studentName || 'teman'}**,

Berikut panduan login VClass sesuai halaman yang sedang kamu buka.`,
    steps,
    template_elements: templateElements,
    faq_reference: makeFaqReference('bantuan_login')
  };
}

function buildTemplateVisualGuidePayload({ studentName, intent, template }) {
  const elements = getTemplateElements(template).map((el) => makeGenericStepElement(el, template));
  const rawSteps = getTemplateSteps(template);

  const steps = rawSteps.length
    ? rawSteps.map(normalizeStep)
    : elements.slice(0, 3).map((el, idx) => ({
        step_number: idx + 1,
        title: el.title || el.name || `Langkah ${idx + 1}`,
        description: el.text || 'Perhatikan elemen ini pada halaman VClass.',
        element_ref: el.key || el.name || ''
      }));

  if (!steps.length && !elements.length) return null;

  return {
    answer_mode: 'tutorial_steps',
    answer_text: `Hai **${studentName || 'teman'}**,\n\nBerikut panduan penggunaan dari sistem.`,
    steps,
    template_elements: elements,
    faq_reference: makeFaqReference(intent)
  };
}

function buildQuickVisualGuideResponse({ studentName, intent, templateMap, matchedTemplate }) {
  if (intent === 'bantuan_login') {
    const payload = buildLoginVisualGuidePayload({ studentName, templateMap });
    return payload ? JSON.stringify(payload) : null;
  }

  const template = resolveGuideTemplate(intent, templateMap, matchedTemplate);
  const payload = buildTemplateVisualGuidePayload({ studentName, intent, template });
  return payload ? JSON.stringify(payload) : null;
}

function isQuickVisualGuideIntent(intent = '') {
  return QUICK_VISUAL_GUIDE_INTENTS.includes(intent);
}

function isAiFollowupPrompt(message = '', forceAI = false) {
  if (!forceAI) return false;
  return /(tolong\s+jelaskan\s+lebih\s+detail\s+dengan\s+ai|jawaban\s+sistem\s+sebelumnya)/i.test(String(message || ''));
}

// FUNGSI UTAMA

const chatService = {
  async processMessage({ sessionId, projectId, message, pageContext, elementContext, expectedSourceType, forceAI = false, forceFAQ = false, responseMode = 'default', intent = null }) {
    const session = await chatModel.getSessionById(sessionId);
    let pageContextState = safeParseObject(session.page_context, {});

    const sessionPageContext = safeParseObject(session.page_context, {});
    const sessionCourseContext = safeParseObject(session.course_context, {});
    const sessionMeta = sessionPageContext.session_meta || {};

    const classCode = lmsContextService.getClassCodeFromSession
      ? lmsContextService.getClassCodeFromSession(session)
      : getClassCodeFromSession(session);

    const studentName =
      pageContext?.session_meta?.display_name ||
      sessionMeta.display_name ||
      session.student_alias;

    // Ekstraksi Course ID dari session/context/source_url.
    // Ini penting supaya chat tetap bisa membaca Moodle API meskipun class_code lama masih "Umum".
    const fallbackCourseId =
      sessionMeta.course_id ||
      sessionCourseContext.course_id ||
      pageContext?.session_meta?.course_id ||
      pageContext?.course_id ||
      getCourseIdFromUrl(session.source_url) ||
      getCourseIdFromUrl(sessionPageContext.sourceUrl) ||
      getCourseIdFromUrl(pageContext?.sourceUrl) ||
      null;

    const moodleUserId =
      sessionMeta.moodle_user_id ||
      pageContext?.session_meta?.moodle_user_id ||
      null;

    const studentEmail =
      sessionMeta.email ||
      pageContext?.session_meta?.email ||
      null;

    const enrolledCourses =
      sessionMeta.enrolled_courses ||
      pageContext?.session_meta?.enrolled_courses ||
      sessionCourseContext.enrolled_courses ||
      [];

    const pageActivities =
      sessionMeta.page_activities ||
      pageContext?.session_meta?.page_activities ||
      pageContext?.page_activities ||
      sessionCourseContext.page_activities ||
      [];

    let lmsContext = null;

    let safetyState = pageContextState.safety_state || { warnings: 0, locked: false, burnout_count: 0 };
    if (typeof safetyState.burnout_count !== 'number') safetyState.burnout_count = 0;
    if (typeof safetyState.warnings !== 'number') safetyState.warnings = 0;

    const pageType = pageContext?.type || pageContext?.pageType || 'guest_home';

    if (safetyState.locked) {
      return {
        response_source: 'system',
        is_locked: true,
        botMessage: { message: 'Chat dikunci. Minta unlock key ke guru.', actions: [] }
      };
    }

    const effectiveMessage = forceAI ? cleanFeedbackPrompt(message) : message;

    const mentionedClass = detectClassMention(effectiveMessage);
    if (classCode && mentionedClass && mentionedClass !== classCode) {
      const blockMessage = buildClassIsolationResponse({ studentName, classCode, mentionedClass });
      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'class_scope_violation' });
      await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: blockMessage, intent: 'class_scope_violation', context_used: { response_source: 'system_class_guard' } });
      return {
        intent: 'class_scope_violation',
        response_source: 'system',
        ai_usage: aiRateLimitService.getStatus(sessionId),
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        botMessage: { message: blockMessage, actions: [] }
      };
    }

    let detectedIntent = intent || await withTimeout(
      () => intentService.detect(effectiveMessage, elementContext, { allowAIIntent: !forceAI }),
      8000,
      'intent detection'
    ).catch(() => 'general_learning_help');

    // Guard tambahan: jangan biarkan pertanyaan status LMS seperti
    // "Quiz apa yang belum saya kerjakan?" salah masuk ke tutorial "Cara mengerjakan kuis".
    const lmsStatusIntent = inferLmsStatusIntentFromMessage(effectiveMessage);
    if (!forceAI && lmsStatusIntent) {
      detectedIntent = lmsStatusIntent;
    }

    if (LMS_INTENTS.includes(detectedIntent)) {
      try {
        lmsContext = await withTimeout(() => lmsContextService.buildChatLmsContext({
          projectId, sessionId, classCode, studentName, moodleUserId, studentEmail,
          courseId: fallbackCourseId, enrolledCourses, pageActivities, intent: detectedIntent
        }), REQUEST_TIMEOUT_MS, 'moodle context');
      } catch (e) {
        console.error('[Chat Service] Error memuat LMS Context:', e.message);
      }
    }

    // ==========================================
    // HARD BLOCK DETEKSI DATA SENSITIF & AKUN
    // ==========================================
    const pwdRegex = /(password|sandi|kata sandi|pw)\b.*(saya|aku|gw|gue|ku|kami|kita)/i;
    if (pwdRegex.test(effectiveMessage)) {
      const studentEmail = sessionMeta.email || pageContext?.session_meta?.email;
      let maskedEmail = studentEmail || 'tidak tersedia';
      if (studentEmail && studentEmail.includes('@')) {
        const [name, domain] = studentEmail.split('@');
        maskedEmail = name.substring(0, Math.max(1, Math.floor(name.length/2))) + '***@' + domain;
      }
      return {
        intent: 'tanya_password', response_source: 'system', ai_usage: aiRateLimitService.getStatus(sessionId),
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: {
          message: `Demi keamanan privasi, sistem AI **tidak memiliki akses dan tidak diperbolehkan melihat password** kamu.\n\nBerdasarkan sesi VClass ini:\n- Username: ${sessionMeta.username || pageContext?.session_meta?.username || 'tidak tersedia'}\n- Email: ${maskedEmail}\n\nJika kamu lupa password, silakan minta *reset password* ke instruktur.`,
          actions: [{ type: 'wa_teacher', label: 'Hubungi Guru via WA', url: 'https://api.whatsapp.com/send/?phone=628989807094&text=Halo%20Instruktur%2C%20saya%20lupa%20password.' }]
        }
      };
    }

    // ==========================================
    // STATIC IMAGE TUTORIALS: bypass page_template/page rule.
    // Panduan ini murni memakai screenshot di FE/public/DETAIL.
    // Kalau user klik "Belum jelas, jelaskan dengan AI", forceAI=true sehingga jalur AI tetap berjalan.
    // ==========================================
    const staticTutorialKey = resolveStaticTutorialKey(detectedIntent, effectiveMessage);
    if (staticTutorialKey && !forceAI) {
      const staticGuide = buildStaticTutorialChatResponse({
        studentName,
        tutorialKey: staticTutorialKey,
        effectiveMessage
      });

      if (staticGuide) {
        await chatModel.createMessage({
          session_id: sessionId,
          role: 'user',
          message: effectiveMessage,
          intent: detectedIntent
        });

        await chatModel.createMessage({
          session_id: sessionId,
          role: 'assistant',
          message: staticGuide.message,
          intent: detectedIntent,
          context_used: {
            response_source: 'system',
            actions: staticGuide.actions,
            used_model: 'static_image_tutorial',
            static_tutorial_key: staticTutorialKey
          }
        });

        return {
          intent: detectedIntent,
          response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          is_locked: safetyState.locked,
          warnings: safetyState.warnings,
          botMessage: { message: staticGuide.message, actions: staticGuide.actions }
        };
      }
    }

    // ==========================================
    // EVALUASI RULES, MODERASI, DAN RETRIEVAL
    // ==========================================
    const pageEvaluation = await ruleService.evaluatePageRule(projectId, pageType, detectedIntent);
    if (pageEvaluation.isBlocked) return { intent: detectedIntent, response_source: 'system', botMessage: { message: pageEvaluation.message, actions: [] } };

    let templateMap = { current: null };
    let matchedTemplate = null;

    if (isQuickVisualGuideIntent(detectedIntent)) {
      templateMap = await buildTemplateMap(projectId, pageContext, session.source_url, detectedIntent);
      matchedTemplate = selectSystemTemplate({ intent: detectedIntent, templateMap });
    }

    const moderationResultRaw = moderationService.checkMessage(effectiveMessage);
    const moderationResult = moderationResultRaw?.isFlagged ? moderationResultRaw : { isFlagged: false };

    if (!isAiFollowupPrompt(effectiveMessage, forceAI) && moderationResult.isFlagged && ['hate_speech', 'profanity'].includes(moderationResult.type)) {
      safetyState.warnings += 1;
      if (safetyState.warnings >= 3) safetyState.locked = true;
      await chatModel.updateSession(sessionId, { page_context: { ...pageContextState, safety_state: safetyState } });

      const warningCount = Math.min(Number(safetyState.warnings || 1), 3);
      const warningText = safetyState.locked
        ? `Aku kunci dulu chat ini karena bahasa kasar sudah mencapai batas **${warningCount}/3**.

Silakan minta **key pembuka** ke guru/instruktur melalui WhatsApp, lalu masukkan key tersebut di form yang muncul.`
        : `Aku mendeteksi bahasa yang kurang pantas. Aku kasih kesempatan dulu ya: **${warningCount}/3**.

Yuk lanjut ngobrol dengan bahasa yang lebih sopan supaya AI Buddy tetap bisa bantu belajar.`;

      return {
        intent: detectedIntent,
        response_source: 'system',
        botMessage: { message: warningText, actions: [] },
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        lock_reason: safetyState.locked ? 'profanity_limit' : null,
        ai_usage: aiRateLimitService.getStatus(sessionId)
      };
    }

    await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: detectedIntent });
    let aiUsage = aiRateLimitService.getStatus(sessionId);

    if (isQuickVisualGuideIntent(detectedIntent)) {
      const visualGuideText = buildQuickVisualGuideResponse({
        studentName,
        intent: detectedIntent,
        templateMap,
        matchedTemplate
      });

      if (visualGuideText) {
        const visualResponseSource = forceAI ? 'ai' : 'system';
        const visualUsedModel = forceAI ? 'system_visual_template_ai_style' : 'system_visual_template';
        if (forceAI) aiUsage = aiRateLimitService.consume(sessionId);
        let finalVisualGuideText = visualGuideText;
        if (forceAI) {
          try {
            const parsedVisual = JSON.parse(visualGuideText);
            parsedVisual.answer_text = String(parsedVisual.answer_text || '').replace('Berikut panduan penggunaan dari sistem.', 'Aku jelaskan lagi dengan lebih pelan. Ikuti langkah-langkah visual berikut ya.');
            finalVisualGuideText = JSON.stringify(parsedVisual);
          } catch (_) {}
        }

        const actions = [
          {
            type: 'ask_ai',
            label: 'Belum jelas, jelaskan dengan AI',
            payload: {
              original_message: effectiveMessage,
              message: effectiveMessage,
              source_answer: 'Panduan sistem berbasis visual template.',
              intent: detectedIntent,
              responseMode: 'short',
              forceAI: true,
              expectedSourceType: 'all'
            }
          },
          { type: 'system_feedback_ok', label: 'Sudah jelas' }
        ];

        const finalActions = forceAI ? actions.filter((act) => act.type !== 'ask_ai') : actions;

        await chatModel.createMessage({
          session_id: sessionId,
          role: 'assistant',
          message: finalVisualGuideText,
          intent: detectedIntent,
          context_used: { response_source: visualResponseSource, actions: finalActions, used_model: visualUsedModel }
        });

        return {
          intent: detectedIntent,
          response_source: visualResponseSource,
          ai_usage: aiUsage,
          is_locked: safetyState.locked,
          warnings: safetyState.warnings,
          botMessage: { message: finalVisualGuideText, actions: finalActions }
        };
      }
    }

    let retrievalResults = [];
    let contextString = '';
    const skipRetrievalIntents = ['bantuan_burnout', 'out_of_context', 'greeting', 'hubungi_guru'];
    const shouldSkipRetrieval =
      skipRetrievalIntents.includes(detectedIntent) ||
      LMS_INTENTS.includes(detectedIntent) ||
      isQuickVisualGuideIntent(detectedIntent);

    if (!shouldSkipRetrieval) {
      const retrievalQuery = canonicalizeRetrievalQuery(effectiveMessage);
      retrievalResults = await withTimeout(
        () => retrievalService.retrieve(projectId, retrievalQuery, pageContext, 8, {
          sourceType: expectedSourceType || 'all',
          classCode,
          courseId: fallbackCourseId,
          strictClassScope: true
        }),
        12000,
        'retrieval'
      );
      contextString = contextBuilderService.build(retrievalResults);
    }

    const materialQuestion = isMaterialQuestion(effectiveMessage, detectedIntent) && !LMS_INTENTS.includes(detectedIntent);
    if (materialQuestion && !shouldSkipRetrieval && !materialContextLooksReliable(effectiveMessage, retrievalResults)) {
      const notFoundText = addStudentGreeting(buildMaterialNotFoundMessage(effectiveMessage), studentName);
      await chatModel.createMessage({
        session_id: sessionId,
        role: 'assistant',
        message: notFoundText,
        intent: detectedIntent,
        context_used: { response_source: 'system_material_not_found', retrieval_count: retrievalResults.length }
      });

      return {
        intent: detectedIntent,
        response_source: 'system',
        ai_usage: aiUsage,
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        botMessage: { message: notFoundText, actions: [] }
      };
    }

    // ========================================================
    // BUILD SYSTEM RESPONSE DAN BYPASS AI (LMS DETERMINISTIC)
    // ========================================================
    const sysRes = systemResponseService.buildSystemResponse({
      message: effectiveMessage, intent: detectedIntent, moderationResult, retrievalResults,
      pageContext, elementContext, aiUsage, matchedTemplate, templateMap,
      burnoutCount: safetyState.burnout_count, lmsContext: lmsContext
    });

    // Mode Jawaban Sistem untuk pertanyaan materi: jangan langsung masuk AI.
    // Tampilkan ringkasan referensi + tombol PDF, lalu user bisa pilih mode AI bila butuh penjelasan bebas.
    if (responseMode === 'system' && !forceAI && retrievalResults.length > 0 && !LMS_INTENTS.includes(detectedIntent)) {
      const sourceActions = buildSourceActionsFromRetrieval(retrievalResults, canonicalizeRetrievalQuery(effectiveMessage));
      const first = retrievalResults[0] || {};
      const previewText = String(first.content || first.chunk_text || '').replace(/\s+/g, ' ').trim();
      const guardedText = looksLikeMultipleChoiceQuestion(effectiveMessage)
        ? 'Aku tidak akan langsung memilihkan jawaban A/B/C/D. Aku bantu kamu memahami konsepnya dulu dari sumber materi berikut.'
        : 'Aku menemukan materi yang berkaitan dari kelasmu. Baca ringkasan singkatnya, lalu buka tombol materi kalau ingin melihat sumbernya.';

      const systemText = `${guardedText}\n\n[ACCORDION=${first.title || first.topic || 'Materi terkait'}]\n${previewText || 'Materi terkait ditemukan di dokumen sumber.'}\n[/ACCORDION]`;

      await chatModel.createMessage({
        session_id: sessionId,
        role: 'assistant',
        message: addStudentGreeting(systemText, studentName),
        intent: detectedIntent,
        context_used: { response_source: 'system', actions: sourceActions, used_model: 'system_material_reference' }
      });

      return {
        intent: detectedIntent,
        response_source: 'system',
        ai_usage: aiUsage,
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        botMessage: { message: addStudentGreeting(systemText, studentName), actions: sourceActions }
      };
    }

    const lmsIntents = LMS_INTENTS;

    // JIKA INI PERTANYAAN TUGAS/DEADLINE (LMS) ATAU SYSTEM MODE STRICT -> LANGSUNG RETURN! BYPASS GEMINI!
    if (lmsIntents.includes(detectedIntent) || (responseMode === 'system' && sysRes.strict)) {
      await chatModel.createMessage({
        session_id: sessionId, role: 'assistant', message: addStudentGreeting(sysRes.text, studentName), intent: detectedIntent,
        context_used: { response_source: 'system', actions: sysRes.actions || [], used_model: 'system_deterministic' }
      });
      return {
        intent: detectedIntent, response_source: 'system', ai_usage: aiUsage,
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: { message: addStudentGreeting(sysRes.text, studentName), actions: sysRes.actions || [] }
      };
    }

    // ==========================================
    // PROSES KE GEMINI (JIKA BUKAN LMS INTENT)
    // ==========================================
    if (forceAI && (aiUsage.cooldown_active || aiUsage.limit_reached || aiUsage.canUseAI === false)) {
      if (!aiUsage.cooldown_active) {
        aiUsage = aiRateLimitService.startCooldown(sessionId);
      }
      const waitSeconds = Number(aiUsage.cooldown_remaining_seconds || 180);
      return {
        intent: detectedIntent,
        response_source: 'system',
        ai_usage: {
          ...aiUsage,
          cooldown_active: true,
          cooldown_remaining_seconds: waitSeconds,
          limit_reached: true,
          canUseAI: false
        },
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        botMessage: { message: `Kuota AI mencapai batas. Tunggu ${waitSeconds} detik.`, actions: [] }
      };
    }

    let botMessageText = '';
    let responseSource = 'system';
    let actions = [];
    let aiErrorFallback = false;
    let quotaFallback = false;
    let usedModel = null;

    try {
      const guardedContextString = materialQuestion
        ? `[ATURAN KHUSUS MATERI]
Jawab hanya berdasarkan konteks materi di bawah. Kalau konteks tidak membahas pertanyaan user, katakan materi belum ditemukan dan jangan mengarang. Jangan mencampur topik CMS/WordPress dengan media sosial kecuali konteks memang menjelaskan hubungannya.
[/ATURAN KHUSUS MATERI]

${contextString}`
        : contextString;
      const prompt = promptService.buildPrompt(effectiveMessage, guardedContextString, pageContext, detectedIntent, elementContext, '', responseMode, lmsContext);
      const geminiResult = await aiQueueService.add(
        () => withTimeout(() => geminiService.generateWithFallback(prompt), AI_REQUEST_TIMEOUT_MS, 'AI'),
        { sessionId, intent: detectedIntent, responseMode, timeoutMs: AI_REQUEST_TIMEOUT_MS }
      );

      if (geminiResult.ok) {
        usedModel = geminiResult.model;
        aiUsage = aiRateLimitService.consume(sessionId);
        botMessageText = geminiResult.text;
        responseSource = 'ai';
        actions = [
          ...(sysRes.actions || []),
          ...buildSourceActionsFromRetrieval(retrievalResults, canonicalizeRetrievalQuery(effectiveMessage))
        ];
      } else if (geminiResult.quotaFallback) {
        aiErrorFallback = true;
        quotaFallback = true;
        botMessageText = 'AI sedang kehabisan kuota atau terlalu sibuk. ' + (sysRes.text || '');
      }
    } catch (error) {
      aiErrorFallback = true;
      botMessageText = 'Terjadi kesalahan sistem AI. ' + (sysRes.text || '');
    }

    if (!botMessageText) {
      botMessageText = sysRes.text;
      actions = [
        ...(sysRes.actions || []),
        ...buildSourceActionsFromRetrieval(retrievalResults, canonicalizeRetrievalQuery(effectiveMessage))
      ];
      responseSource = 'system';
    }

    botMessageText = addStudentGreeting(botMessageText, studentName);

    await chatModel.createMessage({
      session_id: sessionId, role: 'assistant', message: botMessageText, intent: detectedIntent,
      context_used: { response_source: responseSource, actions, ai_error_fallback: aiErrorFallback, quota_fallback: quotaFallback, used_model: usedModel }
    });

    return {
      intent: detectedIntent, response_source: responseSource, ai_usage: aiUsage,
      ai_error_fallback: aiErrorFallback, quota_fallback: quotaFallback, used_model: usedModel,
      is_locked: safetyState.locked, warnings: safetyState.warnings,
      botMessage: { message: botMessageText, actions }
    };
  }
};

module.exports = chatService;
