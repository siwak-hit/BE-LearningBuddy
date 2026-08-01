// src/services/ai/intent.service.js

let geminiService = null;
try {
  // Optional: dipakai hanya untuk kalimat ambigu agar AI menerjemahkan maksud user ke intent/keyword sistem.
  geminiService = require('./gemini.service');
} catch (_) {
  geminiService = null;
}

const ALLOWED_INTENTS = [
  'bantuan_login', 'navigasi_kursus', 'akses_materi', 'bantuan_tugas', 'bantuan_kuis', 'bantuan_dashboard',
  'penjelasan_materi', 'minta_jawaban_langsung', 'hubungi_guru', 'bantuan_burnout', 'out_of_context',
  'general_learning_help', 'bantuan_umum', 'bantuan_lupa_password', 'bantuan_buka_materi',
  'bantuan_kumpul_tugas', 'bantuan_quiz', 'bantuan_forum', 'bantuan_logout', 'bantuan_lihat_nilai', 'tutorial_steps',
  // --- LMS INTENTS BARU ---
  'cek_tugas_belum_selesai', 'cek_deadline_hari_ini', 'cek_deadline_terdekat',
  'cek_quiz_belum_dikerjakan', 'cek_forum_belum_dijawab', 'cek_aktivitas_course',
  'cek_pengajar_course', 'cek_course_saya', 'buka_aktivitas', 'tanya_password',
  'daftar_materi', 'sengketa_jawaban',
  'cek_status_tugas', 'cek_status_completion', 'evaluasi_jawaban_tugas', 'komplain',
  // [v0.9.62] Intent baru dari pemetaan ruang lingkup
  'small_talk', 'fitur_tidak_didukung', 'greeting', 'soal_pilihan_ganda', 'detail_tugas', 'detail_kuis',
  'rekomendasi_materi', 'klarifikasi'
];

// [v0.9.15] Kata pengisi di AKHIR kalimat yang TIDAK mengubah maksud. Distrip agar
// "...benar" dan "...benar gimana tuh?" terdeteksi SAMA (intent lebih stabil).
const TRAILING_FILLER = /\s+(?:gimana tuh|gimana dong|gimana sih|gimana ya|bagaimana tuh|gimana|bagaimana|tuh|dong|sih|nih|deh|ya|yaa|kak|min|bang|kok|ya kan|kan)$/;

const normalizeText = (value = '') => {
  let s = String(value || '')
    .toLowerCase()
    .replace(/log\s*in/g, 'login')
    .replace(/[^a-z0-9\u00c0-\u024f\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 4; i += 1) {
    const next = s.replace(TRAILING_FILLER, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
};

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

  // =====================================================
  // DETEKSI LMS CHECK — harus sebelum bantuan/tutorial umum.
  // Tujuannya supaya pertanyaan seperti "kuis mana yang belum"
  // tidak salah masuk ke intent deadline umum.
  // =====================================================

  // Forum yang belum dijawab / belum dibalas.
  if (
    hasAny(msg, [/\b(forum|diskusi|topik diskusi|postingan)\b/]) &&
    hasAny(msg, [/\b(belum|blm|nggak|gak|tidak|mana|apa aja|apa saja)\b/]) &&
    hasAny(msg, [/\b(dijawab|jawab|balas|dibalas|reply|selesai|dikerjakan)\b/])
  ) {
    return 'cek_forum_belum_dijawab';
  }

  // Kuis/quiz/ulangan yang belum dikerjakan.
  if (
    hasAny(msg, [/\b(quiz|kuis|ujian|ulangan|soal)\b/]) &&
    hasAny(msg, [/\b(belum|blm|nggak|gak|tidak|mana|apa aja|apa saja)\b/]) &&
    hasAny(msg, [/\b(dikerjakan|kerjakan|selesai|submit|dikumpulkan|kumpul)\b/])
  ) {
    return 'cek_quiz_belum_dikerjakan';
  }

  // [v0.9.15] KASUS 1: siswa MENGAKU sudah mengumpulkan tugas tapi status masih belum.
  // Harus sebelum cek_tugas_belum_selesai (yg untuk "tugas APA yang belum dikerjakan").
  if (
    hasAny(msg, [/\b(tugas|assignment|file|pekerjaan)\b/]) &&
    hasAny(msg, [/\b(sudah|udah|telah|barusan|tadi|kemarin)\b/]) &&
    hasAny(msg, [/\b(upload|unggah|submit|kumpul|kumpulin|kumpulkan|kirim|ngumpulin|mengumpulkan|ngirim)\b/]) &&
    hasAny(msg, [/\b(belum|masih|kok|kenapa|gak|nggak|tidak)\b/])
  ) {
    return 'cek_status_tugas';
  }

  // Tugas/assignment yang belum selesai / belum dikumpulkan.
  if (
    hasAny(msg, [/\b(tugas|assignment|pengumpulan)\b/]) &&
    hasAny(msg, [/\b(belum|blm|nggak|gak|tidak|mana|apa aja|apa saja)\b/]) &&
    hasAny(msg, [/\b(selesai|dikumpulkan|kumpul|dikerjakan|submit|unggah|upload)\b/])
  ) {
    return 'cek_tugas_belum_selesai';
  }

  // Deadline khusus hari ini.
  if (
    hasAny(msg, [/\b(deadline|tenggat|batas waktu|jatuh tempo)\b/]) &&
    hasAny(msg, [/\b(hari ini|sekarang|today)\b/])
  ) {
    return 'cek_deadline_hari_ini';
  }

  // Deadline terdekat / jadwal tugas.
  if (hasAny(msg, [/\b(deadline|tenggat|batas waktu|jatuh tempo|jadwal tugas|tugas terdekat|deadline terdekat)\b/])) {
    return 'cek_deadline_terdekat';
  }

  // [v0.9.62] Recommendation: "materi apa yang harus/sebaiknya dipelajari/prioritaskan".
  if (hasAny(msg, [
    /(materi|belajar) apa (yang )?(harus|sebaiknya|perlu|mesti)/,
    /(saran|rekomendasi|rekomen)(kan|in)?.{0,12}(materi|belajar|dipelajari|pelajari)/,
    /(materi|belajar) apa dulu/,
    /materi prioritas|prioritas materi/,
    /apa (yang )?(harus|sebaiknya|perlu) (saya |aku )?(pelajari|dipelajari|prioritaskan)/
  ])) {
    return 'rekomendasi_materi';
  }

  // [v0.9.62] Clarification: minta penjelasan ulang / versi lebih sederhana.
  if (hasAny(msg, [
    /(jelas(kan|in)?|terang(kan|in)?).{0,15}(lebih )?(sederhana|simpel|mudah|gampang|singkat)/,
    /maksud(nya)?\s*(gimana|apa|nya apa)/,
    /(ulangi|ulang lagi|jelas(kan|in)? (lagi|ulang)|jelasin ulang)/,
    /(masih |belum |kurang |gak |nggak )(paham|ngerti|mudeng|jelas)/,
    /(versi|bikin).{0,10}(lebih )?(sederhana|simpel|mudah)/
  ])) {
    return 'klarifikasi';
  }

  // [v0.9.9] "Ada materi apa aja / daftar materi" → list materi (BUKAN penjelasan konsep).
  // Diletakkan lebih awal agar tak tertangkap navigasi_kursus / penjelasan_materi.
  if (hasAny(msg, [
    /\b(materi apa aja|materi apa saja|ada materi apa|daftar materi|list materi|materi apa yang ada|materi apa di|materi nya apa|materinya apa aja)\b/,
    /materi.{0,25}(apa aja|apa saja|apa yang ada|ada apa)/, // "materi minggu ini ada apa aja"
    /(ada )?(materi|bahan ajar).{0,20}(minggu ini|pekan ini) (apa|ada)/
  ])) {
    return 'daftar_materi';
  }

  // [v0.9.14] Sengketa jawaban kuis: siswa merasa jawaban/kunci kuis salah padahal
  // menurut materi benar. Ditaruh sebelum bantuan_kuis agar "kuis" tak menangkapnya.
  if (
    hasAny(msg, [/\b(soal|kuis|quis|quiz|jawaban|nomor|nomer)\b/]) &&
    hasAny(msg, [/\b(salah|keliru|kurang tepat|tidak sesuai|gak sesuai|nggak sesuai)\b/]) &&
    hasAny(msg, [/\b(padahal|menurut materi|harusnya|seharusnya|sebenarnya|mestinya|sudah benar|udah bener|udah benar)\b/])
  ) {
    return 'sengketa_jawaban';
  }

  // [v0.9.15] KASUS 3: evaluasi jawaban tugas yang dinilai OOT/salah konsep.
  // Paling spesifik → cek sebelum cek_status_tugas & bantuan_tugas.
  if (
    hasAny(msg, [/\b(tugas|jawaban|teks jawaban|essay|esai)\b/]) &&
    hasAny(msg, [/\b(oot|out of topic|salah konsep|melenceng|dibilang salah|dianggap salah|kenapa salah|salahnya di ?mana|salah nya di ?mana|kurang tepat)\b/])
  ) {
    return 'evaluasi_jawaban_tugas';
  }

  // [v0.9.15] KASUS 2: aktivitas/forum sudah dikerjakan tapi belum centang hijau/selesai.
  if (
    hasAny(msg, [/\b(forum|diskusi|komen|komentar|balas|reply|aktivitas|materi|tugas|kuis|quiz)\b/]) &&
    hasAny(msg, [/\b(belum|gak|nggak|tidak|kok|kenapa|ga)\b/]) &&
    hasAny(msg, [/\b(centang|centang hijau|ceklis|ceklist|selesai|komplit|complete|tuntas|kelar|beres)\b/])
  ) {
    return 'cek_status_completion';
  }

  // [v0.9.17] Komplain SAMAR (bukan kasus spesifik di atas). Kasus jelas seperti
  // "jawaban kuis salah padahal benar" / "udah upload tapi belum masuk" sudah ditangani
  // intent spesifik di atas (sengketa_jawaban / cek_status_*). Sisanya yang sekadar
  // "aku mau komplain / ini gak adil / nggak terima" → arahkan ke template komplain.
  // [v0.9.62] Small talk / apresiasi: sapaan lanjutan, tanya identitas, terima kasih, pujian.
  if (hasAny(msg, [
    /\b(apa kabar|gimana kabar|kabarmu|kabar kamu)\b/,
    /\b(siapa kamu|kamu siapa|kamu ini apa|kamu bisa apa|kamu apa sih)\b/,
    /\b(terima kasih|makasih|makasih ya|thanks|thank you|trims|tengkyu|maacih)\b/,
    /\b(keren|hebat|bagus banget|mantap|pinter|pintar|membantu banget|kamu baik)\b/
  ])) {
    return 'small_talk';
  }

  // [v0.9.62] Fitur belum didukung: mengubah kredensial/akun (bukan "lupa password").
  if (hasAny(msg, [
    /\b(ubah|ganti|rubah|update)\s+(password|kata sandi|sandi|email|e-mail|profil|nama|foto|username)\b/,
    /\b(hapus|nonaktifkan|bikin|buat|daftar)\s+(akun|account)\b/
  ])) {
    return 'fitur_tidak_didukung';
  }

  // [v0.9.17 + v0.9.62] Komplain SAMAR / keluhan (termasuk keluhan nilai). Kasus spesifik
  // (sengketa jawaban kuis / status upload) sudah ditangani intent lain di atas.
  if (hasAny(msg, [
    /\b(komplain|komplen|protes|keberatan|mengeluh|keluhan)\b/,
    /\b(tidak|gak|ga|nggak)\s+(adil|terima|setuju|puas)\b/,
    /\bmau\s+lapor(kan)?\b/,
    /\bnilai(ku|nya)?\b(\s+\w+){0,3}\s*(kecil|jelek|rendah|turun|dikit|sedikit|kurang|anjlok|gak sesuai|tidak sesuai)/,
    /\bkok\b(\s+\w+){0,5}\s*(nilai|kecil|jelek|rendah|belum masuk|gak masuk|tidak masuk|gak sesuai|tidak sesuai|salah)/,
    /\b(kecewa|kesel|sebel|nggak puas|gak puas|tidak puas)\b/,
    /padahal\s+(udah|sudah)\s+(ngerjain|kerjain|mengerjakan|kumpul|mengumpulkan|upload|submit|kirim)/
  ])) {
    return 'komplain';
  }

  // Pertanyaan umum "ada tugas?" lebih aman masuk ke pengecekan tugas,
  // bukan deadline, karena siswa biasanya ingin tahu apa yang perlu dikerjakan.
  if (hasAny(msg, [/\b(ada tugas|tugas apa aja|tugas apa saja|aktivitas apa aja|aktivitas apa saja)\b/])) {
    return 'cek_tugas_belum_selesai';
  }

  // DETEKSI LOGOUT / KELUAR AKUN
  if (hasAny(msg, [/\b(logout|log out|keluar akun|keluar dari akun|sign out|signout)\b/]) && hasAny(msg, [/\b(cara|gimana|bagaimana|tutorial|panduan|langkah|klik|buka)\b/])) {
    return 'bantuan_logout';
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

  if (hasAny(msg, [/\b(course|kursus) (saya|aku)( yang mana)?\b/])) return 'cek_course_saya';

  // CEK PENGAJAR
  if (hasAny(msg, [/\b(siapa) (pengajar|guru|dosen)\b/])) return 'cek_pengajar_course';

  // CEK AKTIVITAS UMUM
  if (hasAny(msg, [/\b(aktivitas|kegiatan|isinya) apa aja\b/])) return 'cek_aktivitas_course';

  // BUKA AKTIVITAS (e.g. Buka kuis, Buka tugas minggu 2)
  if (hasAny(msg, [/\b(buka|tampilkan) (tugas|kuis|quiz|forum)\b/])) return 'buka_aktivitas';

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

async function aiClassifyIntent(message) {
  if (!geminiService) return null;
  const cleanMessage = String(message || '').substring(0, 500);

  // PROMPT BARU: FOKUS MAPPING JSON
  const prompt = `Kamu adalah sistem "Intent Classifier" untuk asisten LMS VClass Moodle.
Tugasmu BUKAN menjawab pertanyaan, melainkan mengklasifikasikan pesan siswa ke dalam "intent" (maksud) yang tepat dari daftar berikut.

DAFTAR INTENT LMS (PRIORITAS):
- cek_tugas_belum_selesai : Jika siswa bertanya tentang tugas/assign yang belum selesai.
- cek_deadline_hari_ini : Jika siswa bertanya tenggat waktu KHUSUS hari ini.
- cek_deadline_terdekat : Jika siswa bertanya deadline terdekat/mepet.
- cek_quiz_belum_dikerjakan : Jika bertanya tentang kuis/ujian yang belum dikerjakan.
- cek_forum_belum_dijawab : Jika bertanya tentang forum/diskusi.
- cek_pengajar_course : Jika bertanya nama guru/pengajar.
- cek_aktivitas_course : Jika bertanya isi daftar aktivitas di course.
- buka_aktivitas : Jika siswa meminta "buka", "tampilkan", "lihat" tugas/kuis tertentu.
- tanya_password : Jika siswa menanyakan kata sandinya.

DAFTAR INTENT UMUM:
- penjelasan_materi : Jika siswa bertanya arti/pengertian/konsep pelajaran (misal: "Apa itu media sosial?").
- hubungi_guru : Jika siswa stres/butuh bantuan manusia.
- bantuan_login, bantuan_tugas, bantuan_kuis, bantuan_forum, bantuan_logout : Jika bertanya "Cara" / teknis aplikasi.

ATURAN:
1. Analisa pesan user dengan cermat. "Ada deadline apa aja hari ini?" -> cek_deadline_hari_ini.
2. Keluarkan HANYA format JSON valid tanpa markdown, contoh: {"intent": "cek_deadline_hari_ini", "confidence": 0.95}

Pesan user:
"${cleanMessage}"`;

  try {
    const result = await geminiService.generateWithFallback(prompt);
    if (!result?.ok || !result.text) return null;

    // Parse JSON murni dari Gemini
    const raw = String(result.text).trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = String(parsed.intent || '').trim();
      return ALLOWED_INTENTS.includes(intent) ? intent : null;
    }
    return null;
  } catch (error) {
    console.error('[Intent Service] Gagal mapping JSON:', error.message);
    return null; // Fallback ke rule-based jika AI Limit/Error
  }
}

// [v0.9.63] Skor intent (heuristik keyword) untuk LABEL transparansi di UI. BUKAN probabilitas
// sungguhan — routing tetap rule-based; ini estimasi kepercayaan berbasis kecocokan kata kunci.
const INTENT_LABEL = {
  komplain: 'Komplain', small_talk: 'Obrolan Ringan', greeting: 'Sapaan',
  bantuan_login: 'Cara Login', bantuan_logout: 'Cara Logout',
  bantuan_tugas: 'Bantuan Tugas', bantuan_kumpul_tugas: 'Kumpul Tugas',
  bantuan_kuis: 'Bantuan Kuis', bantuan_quiz: 'Bantuan Kuis', bantuan_forum: 'Bantuan Forum',
  penjelasan_materi: 'Penjelasan Materi', general_learning_help: 'Bantuan Belajar',
  daftar_materi: 'Daftar Materi', rekomendasi_materi: 'Rekomendasi Materi',
  klarifikasi: 'Klarifikasi', detail_tugas: 'Detail Tugas', detail_kuis: 'Detail Kuis',
  cek_tugas_belum_selesai: 'Cek Tugas', cek_quiz_belum_dikerjakan: 'Cek Kuis',
  cek_forum_belum_dijawab: 'Cek Forum', cek_deadline_hari_ini: 'Cek Deadline',
  cek_deadline_terdekat: 'Cek Deadline', bantuan_lihat_nilai: 'Lihat Nilai',
  cek_pengajar_course: 'Info Pengajar', hubungi_guru: 'Hubungi Guru',
  minta_jawaban_langsung: 'Minta Jawaban', soal_pilihan_ganda: 'Soal Pilihan Ganda',
  fitur_tidak_didukung: 'Fitur Tak Didukung', tanya_password: 'Tanya Password',
  out_of_context: 'Di Luar Topik', bantuan_burnout: 'Butuh Dukungan',
  bantuan_lupa_password: 'Lupa Password'
};
const INTENT_KEYWORDS = {
  komplain: ['komplain', 'protes', 'keberatan', 'kecewa', 'tidak adil', 'gak adil', 'nilai kecil', 'nilai jelek', 'nilai rendah', 'gak puas', 'tidak puas', 'mengeluh', 'padahal udah', 'kesel'],
  small_talk: ['halo', 'hai', 'apa kabar', 'siapa kamu', 'kamu siapa', 'makasih', 'terima kasih', 'thanks', 'keren', 'hebat', 'mantap', 'pinter'],
  bantuan_login: ['login', 'masuk akun', 'cara masuk'],
  bantuan_tugas: ['tugas', 'assignment', 'kumpul', 'submit', 'unggah tugas'],
  bantuan_kuis: ['kuis', 'quiz', 'ujian', 'soal', 'attempt'],
  bantuan_forum: ['forum', 'diskusi', 'balas', 'reply', 'topik'],
  penjelasan_materi: ['jelaskan', 'apa itu', 'pengertian', 'maksud', 'pembahasan', 'konsep', 'arti'],
  daftar_materi: ['materi apa aja', 'daftar materi', 'list materi', 'ada materi apa'],
  rekomendasi_materi: ['harus dipelajari', 'saran materi', 'prioritas', 'sebaiknya pelajari', 'belajar apa dulu'],
  klarifikasi: ['lebih sederhana', 'maksudnya', 'belum paham', 'ulangi', 'simpel', 'gak ngerti'],
  hubungi_guru: ['hubungi guru', 'tanya guru', 'kontak guru', 'bantuan guru', 'chat guru'],
  minta_jawaban_langsung: ['jawabannya', 'kunci jawaban', 'jawab langsung', 'kasih jawaban'],
  fitur_tidak_didukung: ['ubah password', 'ganti password', 'ganti email', 'hapus akun', 'ganti nama', 'ubah profil'],
  cek_tugas_belum_selesai: ['tugas belum', 'belum selesai', 'tugas apa aja', 'belum dikerjakan'],
  cek_deadline_hari_ini: ['deadline', 'tenggat', 'batas waktu'],
  bantuan_lihat_nilai: ['lihat nilai', 'cek nilai', 'nilai saya', 'berapa nilai'],
  bantuan_burnout: ['capek', 'stres', 'pusing', 'nyerah', 'lelah', 'burnout']
};

function scoreIntents(message = '', primaryIntent = '') {
  const t = normalizeText(message);
  const raw = {};
  for (const [intent, kws] of Object.entries(INTENT_KEYWORDS)) {
    let s = 0;
    for (const kw of kws) if (t.includes(kw)) s += Math.max(1, Math.round(String(kw).length / 4));
    if (s > 0) raw[intent] = s;
  }
  // Intent yang BENAR-BENAR dipakai routing wajib jadi yang dominan.
  if (primaryIntent) raw[primaryIntent] = (raw[primaryIntent] || 0) + 4;
  const entries = Object.entries(raw).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!entries.length) return [];
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  const scored = entries.map(([intent, v]) => ({ intent, label: INTENT_LABEL[intent] || String(intent).replace(/_/g, ' '), percent: Math.round((v / total) * 100) }));
  const sum = scored.reduce((s, x) => s + x.percent, 0);
  if (scored[0]) scored[0].percent += (100 - sum); // rapikan agar total 100
  return scored;
}

const intentService = {
  ALLOWED_INTENTS,
  scoreIntents,

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
  _stripFeedbackPrefix: stripFeedbackPrefix,
  detectAmbiguousIntent
};

// [v0.9.24] DISAMBIGUASI INTENT. Daripada memaksa tebak intent saat pertanyaan ambigu,
// tawarkan ke siswa maks 4 pilihan. Saat diklik, FE kirim ulang dgn INTENT EKSPLISIT
// (didukung sejak v0.9.22) → langsung ke handler yang benar. Trigger SENGAJA konservatif:
// hanya pola yang memang kabur, supaya pertanyaan jelas tetap diproses otomatis.
const AMBIGUITY_GROUPS = [
  {
    // "hari senin harus ngerjain apa", "apa aja yang harus aku kerjakan", "to-do ku apa",
    // "besok ngapain aja" — kabur antara deadline / tugas / kuis / aktivitas.
    test: (m) =>
      hasAny(m, [
        /\b(apa aja|apa saja|ngapain|apa yang harus|yang harus (di)?kerja|harus (ku|aku|saya)?\s?(kerjakan|ngerjain|dikerjakan)|to ?do|to-?do|ada apa aja)\b/
      ]) &&
      // bukan pertanyaan "cara/jelaskan"
      !hasAny(m, [/\b(cara|gimana|bagaimana|jelaskan|apa itu|pengertian|maksud)\b/]) &&
      // jangan picu kalau SUDAH menyebut SATU jenis aktivitas spesifik (sudah tak ambigu)
      !hasAny(m, [/\b(tugas|kuis|quiz|forum|diskusi|materi)\b/]),
    question: 'Hmm, pertanyaanmu bisa beberapa maksud nih 🤔. Yang mana yang kamu maksud? Pilih salah satu ya:',
    candidates: [
      { intent: 'cek_deadline_terdekat', label: '🗓️ Cek deadline terdekat', prompt: 'deadline terdekat aku apa aja?' },
      { intent: 'cek_tugas_belum_selesai', label: '📝 Tugas yang belum selesai', prompt: 'tugas apa aja yang belum aku kerjakan?' },
      { intent: 'cek_quiz_belum_dikerjakan', label: '🧪 Kuis yang belum dikerjakan', prompt: 'kuis apa aja yang belum aku kerjakan?' },
      { intent: 'cek_aktivitas_course', label: '📚 Semua aktivitas di course', prompt: 'aktivitas apa aja di course ini?' }
    ]
  },
  {
    // "aku mau belajar", "bantu aku dong", "mulai dari mana" — kabur antara lihat daftar
    // materi / minta dijelaskan / panduan umum.
    test: (m) =>
      hasAny(m, [/\b(mau belajar|pengen belajar|mulai (dari mana|belajar)|bantu (aku|saya) belajar|aku bingung mau ngapain)\b/]) &&
      !hasAny(m, [/\b(tugas|kuis|quiz|forum|deadline|login|logout|nilai)\b/]),
    question: 'Siap membantu! 😊 Kamu mau mulai dari mana? Pilih salah satu ya:',
    candidates: [
      { intent: 'daftar_materi', label: '📋 Lihat daftar materi', prompt: 'ada materi apa aja di course ini?' },
      { intent: 'cek_aktivitas_course', label: '📚 Lihat aktivitas course', prompt: 'aktivitas apa aja di course ini?' },
      { intent: 'cek_deadline_terdekat', label: '🗓️ Cek tugas/deadline terdekat', prompt: 'deadline terdekat aku apa aja?' }
    ]
  },
  {
    // [v0.9.28 #5] "kuis 3 kok nilainya jelek" — kabur antara mau KOMPLAIN nilai/jawaban,
    // atau cuma mau cek kuis lain / belajar lagi.
    test: (m) =>
      hasAny(m, [/\b(kuis|quis|quiz|ujian|ulangan)\b/]) &&
      hasAny(m, [/\b(nilai|nilainya|skor|hasil|hasilnya|poin|nilaiku)\b/]) &&
      hasAny(m, [/\b(jelek|jelekk|rendah|buruk|kecil|turun|anjlok|parah|kok)\b/]),
    question: 'Aku turut prihatin soal nilainya 😟. Kamu mau aku bantu yang mana?',
    candidates: [
      { intent: 'komplain', label: '📣 Komplain nilai/jawaban kuis', prompt: 'aku mau komplain soal nilai kuisku' },
      { intent: 'cek_quiz_belum_dikerjakan', label: '🧪 Lihat kuis yang belum dikerjakan', prompt: 'kuis apa aja yang belum aku kerjakan?' },
      { intent: 'daftar_materi', label: '📚 Pelajari ulang materinya', prompt: 'ada materi apa aja di course ini?' }
    ]
  }
];

function detectAmbiguousIntent(message = '') {
  const m = normalizeText(stripFeedbackPrefix(message));
  if (!m || m.length < 3) return null;
  for (const group of AMBIGUITY_GROUPS) {
    try { if (group.test(m)) return { question: group.question, candidates: group.candidates.slice(0, 4) }; }
    catch (_) { /* abaikan group error */ }
  }
  return null;
}

module.exports = intentService;
