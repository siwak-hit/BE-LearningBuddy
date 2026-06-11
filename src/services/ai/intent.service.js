// src/services/ai/intent.service.js

let geminiService = null;
try {
  // Optional: dipakai hanya untuk kalimat ambigu agar AI menerjemahkan maksud user ke intent/keyword sistem.
  geminiService = require('./gemini.service');
} catch (_) {
  geminiService = null;
}

const ALLOWED_INTENTS = [
  'bantuan_login',
  'navigasi_kursus',
  'akses_materi',
  'bantuan_tugas',
  'bantuan_kuis',
  'bantuan_dashboard',
  'penjelasan_materi',
  'minta_jawaban_langsung',
  'hubungi_guru',
  'bantuan_burnout',
  'out_of_context',
  'general_learning_help',
  'bantuan_umum',
  'bantuan_lupa_password',
  'bantuan_buka_materi',
  'bantuan_kumpul_tugas',
  'bantuan_quiz',
  'bantuan_forum',
  'bantuan_lihat_nilai',
  'tanya_deadline',
  'cek_tugas_belum',
  'tutorial_steps'
];

const normalizeText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/log\s*in/g, 'login')
  .replace(/[^a-z0-9\u00c0-\u024f\s]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const hasAny = (text, patterns = []) => patterns.some((pattern) => {
  if (pattern instanceof RegExp) return pattern.test(text);
  return text.includes(normalizeText(pattern));
});

function stripFeedbackPrefix(message = '') {
  let result = String(message || '').trim();
  const prefix = 'Jawaban sistem sebelumnya belum menyelesaikan masalah saya. Tolong jelaskan lebih detail dan lebih pelan untuk pertanyaan ini:';
  for (let i = 0; i < 8; i += 1) {
    if (!result.toLowerCase().startsWith(prefix.toLowerCase())) break;
    result = result.slice(prefix.length).trim();
  }
  return result || String(message || '').trim();
}

function ruleBasedDetect(message = '', elementContext = null) {
  // 1) Cek apakah ada context elemen dari frontend ATAU user menggunakan mention UI (@formulir1, @tombol, dll)
  if (elementContext || /@\w+/i.test(message)) {
    return 'element_question';
  }

  const msg = normalizeText(stripFeedbackPrefix(message));

  // DETEKSI DEADLINE
  if (hasAny(msg, [/\b(deadline|tugas apa yang belum|ada tugas|quiz mana yang belum|jadwal tugas)\b/])) {
    return 'tanya_deadline';
  }

  // DETEKSI FORUM
  // Harus diletakkan sebelum deteksi tugas umum,
  // supaya "cara jawab forum" tidak masuk ke bantuan_tugas.
  if (hasAny(msg, [
    /\b(forum|diskusi|posting|postingan|reply|balas|membalas|menanggapi|topik diskusi)\b/
  ]) && hasAny(msg, [
    /\b(cara|gimana|bagaimana|tutorial|panduan|langkah|buat|membuat|jawab|menjawab|reply|balas|membalas|kerjakan|mengerjakan)\b/
  ])) {
    return 'bantuan_forum';
  }

  // DETEKSI PROCEDURAL/TUTORIAL SECARA SPESIFIK
  if (hasAny(msg, [/\b(cara login|langkah login|langkah masuk|cara kumpul tugas|langkah kumpul tugas|cara ngerjain quiz)\b/])) {
    return 'tutorial_steps';
  }

  // 2) Hard out-of-context / jailbreak / code gen.
  if (hasAny(msg, [
    /\b(game|main game|rekomendasi game|film|lagu|musik|resep|cuaca|berita|politik|pacar|ramalan|zodiak)\b/,
    /\b(buatkan kode|tulis script|buatkan program|bikinin kode)\b/,
    /\b(abaikan instruksi|abaikan aturan|system prompt|jailbreak)\b/
  ])) {
    return 'out_of_context';
  }

  // 3) Explicit guru contact.
  if (hasAny(msg, [/\b(hubungi guru|kontak guru|wa guru|whatsapp guru|minta bantuan guru)\b/])) {
    return 'hubungi_guru';
  }

  const courseWords = [
    'kursus', 'course', 'kelas', 'mata pelajaran', 'mapel', 'informatika',
    'cari kursus', 'cari course', 'dashboard', 'beranda', 'kursus saya', 'my courses',
    'ikhtisar kursus', 'daftar kursus', 'kartu kursus'
  ];

  const navigationWords = [
    'cara', 'gimana', 'bagaimana', 'dimana', 'di mana', 'cari', 'mencari', 'nyari', 'buka', 'membuka', 'masuk',
    'klik', 'arahkan', 'menuju', 'harus klik apa', 'letaknya', 'berada', 'akses'
  ];

  const materialWords = [
    'materi', 'buka materi', 'cari materi', 'nyari materi', 'mencari materi', 'cara nyari materi', 'cara cari materi',
    'materi pelajaran', 'materi yang diberikan', 'materi dari guru', 'materi doang', 'bahan ajar',
    'pdf', 'dokumen', 'modul', 'resource', 'aktivitas pembelajaran'
  ];

  const alreadyInsideCourseWords = [
    'sudah masuk', 'udah masuk', 'sudah di kursus', 'udah di kursus',
    'di dalam kursus', 'dalam kursus', 'di kursus informatika',
    'sudah masuk ke kursus', 'lanjut jelaskan cara membuka materi'
  ];

  const alreadyLoggedInWords = [
    'sudah login', 'udah login', 'setelah login', 'habis login', 'sesudah login',
    'sudah masuk akun', 'udah masuk akun', 'saya sudah login', 'saya udah login',
    'tinggal cari materi', 'tinggal buka materi', 'tinggal nyari materi', 'cari materi doang', 'buka materi doang'
  ];

  const explicitlyDoesNotKnowCourseLocation = hasAny(msg, [
    'gak tahu dimana kursus', 'nggak tahu dimana kursus', 'tidak tahu dimana kursus',
    'gak tau dimana kursus', 'nggak tau dimana kursus', 'tidak tau dimana kursus',
    'dimana kursus informatika', 'di mana kursus informatika', 'kursus informatika berada'
  ]);

  // Kalau user jelas belum tahu letak kursus Informatika, selesaikan navigasi kursus dulu.
  if (hasAny(msg, courseWords) && explicitlyDoesNotKnowCourseLocation) {
    return 'navigasi_kursus';
  }

  const asksMaterialNavigation = hasAny(msg, materialWords) && hasAny(msg, navigationWords.concat(alreadyLoggedInWords, alreadyInsideCourseWords));

  // Kalau user menyebut materi + sudah login, maksudnya akses materi, bukan cara login.
  if (asksMaterialNavigation && (hasAny(msg, alreadyLoggedInWords) || hasAny(msg, alreadyInsideCourseWords) || msg.includes('setelah login'))) {
    return 'akses_materi';
  }

  if (asksMaterialNavigation && hasAny(msg, ['akses materi', 'bisa akses materi', 'cara akses materi', 'cara buka materi', 'cara mencari materi'])) {
    return 'akses_materi';
  }

  const asksCourseNavigation = hasAny(msg, courseWords) && (
    hasAny(msg, navigationWords) || hasAny(msg, ['materi', 'tugas', 'guru nyuruh', 'guru saya suruh', 'diperintahkan'])
  );

  if (asksCourseNavigation && !hasAny(msg, alreadyLoggedInWords)) return 'navigasi_kursus';

  if (hasAny(msg, [
    /\b(login|masuk akun|akun|password|kata sandi|email|username)\b/,
    /\blogin\b/
  ]) && !hasAny(msg, ['sudah login', 'udah login', 'setelah login', 'habis login', 'sesudah login'])) {
    return 'bantuan_login';
  }

  if (hasAny(msg, [/\b(kuis|quiz|kerjakan soal|ujian|tes|mulai quiz|mulai kuis)\b/])) {
    return 'bantuan_kuis';
  }

  // Kalau ada kata forum, jangan masuk bantuan_tugas.
  // Forum punya intent sendiri: bantuan_forum.
  if (
    hasAny(msg, [/\b(tugas|assignment|upload|unggah|kumpul|submit|mengumpulkan)\b/]) &&
    !hasAny(msg, [/\b(forum|diskusi|reply|balas|postingan|topik diskusi)\b/])
  ) {
    return 'bantuan_tugas';
  }

  if (hasAny(msg, materialWords) && hasAny(msg, navigationWords)) {
    return 'akses_materi';
  }

  if (hasAny(msg, [/\b(dashboard|beranda|menu utama|halaman utama)\b/])) {
    return 'bantuan_dashboard';
  }

  const materialTopicWords = [
    /\b(media sosial|sosial media|cyberbullying|hoax|internet|informatika)\b/
  ];

  const materialAskWords = [
    /\b(apa|apa saja|apa aja|jelaskan|sebutkan|contoh|maksud|pengertian|kenapa|mengapa|bagaimana)\b/
  ];

  const materialConceptWords = [
    /\b(dampak|pengaruh|efek|akibat|manfaat|kelebihan|kekurangan|positif|negatif|risiko|bahaya|jenis|ciri|contoh)\b/
  ];

  if (
    hasAny(msg, materialTopicWords) &&
    hasAny(msg, materialAskWords.concat(materialConceptWords))
  ) {
    return 'penjelasan_materi';
  }

  // Pertanyaan materi. Kata "media sosial" harus masuk ke sini, bukan profanity / burnout.
  if (hasAny(msg, [/\b(apa itu|jelaskan|perbedaan|pengertian|konsep|maksud dari|artinya|menurut materi)\b/])) {
    return 'penjelasan_materi';
  }

  // Burnout hanya frasa jelas. Jangan pakai kata guru / bingung polos.
  if (hasAny(msg, [
    /\b(capek|lelah|pusing|stress|stres|nyerah|jenuh|mumet)\b/,
    /\b(bingung banget|bingung sekali|tidak sanggup|gak sanggup|nggak sanggup|tidak kuat|gak kuat|nggak kuat)\b/,
    /\b(frustasi|frustrasi|kesel banget|kesal banget|putus asa)\b/
  ])) {
    return 'bantuan_burnout';
  }

  if (hasAny(msg, [/\b(cara|gimana|bagaimana|klik|buka|tutorial|panduan|langkah|akses)\b/])) {
    return 'general_learning_help';
  }

  return null;
}

async function aiClassifyIntent(message = '') {
  if (!geminiService?.generateWithFallback) return null;

  const cleanMessage = stripFeedbackPrefix(message);
  const prompt = `Kamu adalah classifier intent untuk AI Learning Buddy VClass.
Tugasmu HANYA mengubah pesan user menjadi satu intent dari daftar ini:
${ALLOWED_INTENTS.join(', ')}

Aturan penting:
- Kalau user bertanya cara masuk akun: bantuan_login.
- Kalau user bertanya mencari/masuk kursus/course/kelas/mapel/Informatika: navigasi_kursus.
- Kalau user sudah login atau sudah masuk kursus lalu mau mencari/membuka materi/modul/PDF/dokumen: akses_materi.
- Kalau user bertanya cara membuat, menjawab, membalas, reply, atau mengerjakan forum diskusi: bantuan_forum.
- Kalau user bertanya arti/pengertian/apa itu materi pelajaran, termasuk "media sosial": penjelasan_materi.
- Kata "guru" hanya sumber instruksi, bukan burnout.
- Jangan pilih bantuan_burnout kecuali user jelas capek/lelah/stres/nyerah/tidak sanggup.
- Jawab hanya JSON pendek: {"intent":"..."}

Pesan user:
${cleanMessage}`;

  try {
    const result = await geminiService.generateWithFallback(prompt);
    if (!result?.ok || !result.text) return null;
    const raw = String(result.text).trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { intent: raw.replace(/[^a-z_]/gi, '') };
    const intent = String(parsed.intent || '').trim();
    return ALLOWED_INTENTS.includes(intent) ? intent : null;
  } catch (_) {
    return null;
  }
}

const intentService = {
  ALLOWED_INTENTS,

  async detect(message, elementContext = null, options = {}) {
    const byRule = ruleBasedDetect(message, elementContext);
    if (byRule) return byRule;

    // AI hanya dipakai untuk klasifikasi intent yang ambigu.
    // Output AI tetap berupa keyword/intent, jawaban akhirnya tetap dibangun oleh sistem.
    const allowAIIntent = options.allowAIIntent !== false;
    if (allowAIIntent) {
      const byAI = await aiClassifyIntent(message);
      if (byAI) return byAI;
    }

    return 'general_learning_help';
  },

  _ruleBasedDetect: ruleBasedDetect,
  _stripFeedbackPrefix: stripFeedbackPrefix
};

module.exports = intentService;
