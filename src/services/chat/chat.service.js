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
const chunkModel = require('../../models/chunk.model');
const documentModel = require('../../models/document.model');
const aiQueueService = require('../ai/aiQueue.service');
const lmsContextService = require('../moodle/lms-context.service');
const moodleService = require('../moodle/moodle.service');
const moodleConfigModel = require('../../models/moodleConfig.model');

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

// [v0.9.23] Base URL Moodle (untuk membangun link bukti aktivitas pada jawaban komplain).
const MOODLE_BASE_URL = 'https://lms.smpn167jakarta.sch.id';

const QUICK_VISUAL_GUIDE_INTENTS = [
  'bantuan_login', 'bantuan_dashboard', 'navigasi_kursus',
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

function isGenericOpenMaterialRequest(message = '') {
  const text = normalizeText(message);
  return /\b(buka|lihat|cek|tampilkan|cari)\s+(materi|bahan|sumber)\b/.test(text)
    && !/\b(tentang|mengenai|soal|bab|cms|wordpress|word press|media sosial|hoax|cyberbullying|plugin|blog|website)\b/.test(text);
}

function isMaterialLearningQuestion(message = '') {
  const text = normalizeText(message);
  if (!text) return false;

  const uiWords = /\b(login|logout|masuk|keluar|password|dashboard|sidebar|tab|tombol|klik|menu|upload|unggah|kumpul|forum|balas|reply|quiz|kuis|nilai|deadline|tugas belum|belum dikerjakan)\b/;
  const asksHowToUseSystem = /\b(cara|gimana|bagaimana)\b/.test(text) && uiWords.test(text);
  if (asksHowToUseSystem) return false;

  const materialWords = /\b(materi|pelajaran|soal|cms|content management system|wordpress|word press|media sosial|sosial media|hoax|hoaks|cyberbullying|plugin|website|blog|microblog|social network|dampak|definisi|pengertian|contoh|jenis|manfaat|persen|berapa persen|mengapa|kenapa|apa itu|apakah|jelaskan)\b/;
  const asksKnowledge = /\b(apa|apakah|jelaskan|pengertian|definisi|contoh|jenis|dampak|manfaat|berapa|mengapa|kenapa|maksud|singkatan|kepanjangan)\b/.test(text);

  return materialWords.test(text) && (asksKnowledge || /\b(cms|wordpress|word press|media sosial|hoax|cyberbullying|plugin|website|blog)\b/.test(text));
}

function isManualMaterialRequest(message = '') {
  return isMaterialOpenRequest(message) || isMaterialLearningQuestion(message) || isGenericOpenMaterialRequest(message);
}

function inferManualSidebarIntent(message = '') {
  const text = normalizeText(message);
  if (!text) return '';

  const lmsStatus = inferLmsStatusIntentFromMessage(message);
  if (lmsStatus) return lmsStatus;

  if (/\b(login|log in|masuk akun|masuk vclass)\b/.test(text) && /\b(cara|gimana|bagaimana|bantuan|tidak bisa|ga bisa|gak bisa|dimana|mana|tombol)\b/.test(text)) return 'bantuan_login';
  if (/\b(lupa password|lupa sandi|reset password)\b/.test(text)) return 'bantuan_lupa_password';
  if (/\b(logout|log out|keluar akun|sign out)\b/.test(text)) return 'bantuan_logout';
  if (/\b(nilai|grade|rapor|laporan nilai)\b/.test(text) && /\b(cara|lihat|cek|buka|dimana|gimana|bagaimana)\b/.test(text)) return 'bantuan_lihat_nilai';
  if (/\b(reply|balas|membalas|menjawab)\b/.test(text) && /\b(forum|diskusi)\b/.test(text)) return 'bantuan_forum';
  if (/\b(buat|membuat|tambah|tambahkan|posting|topik)\b/.test(text) && /\b(forum|diskusi)\b/.test(text)) return 'bantuan_forum';
  if (/\b(kumpul|kumpulin|mengumpulkan|upload|unggah|kirim|submit)\b/.test(text) && /\b(tugas|assignment)\b/.test(text)) return 'bantuan_kumpul_tugas';
  if (/\b(kuis|quiz|quis|ujian)\b/.test(text) && /\b(cara|mengerjakan|kerjakan|mulai|submit|kirim|gimana|bagaimana)\b/.test(text)) return 'bantuan_kuis';
  if (/\b(aktivitas|activity|daftar aktivitas)\b/.test(text) && /\b(lihat|cek|buka|cara|dimana|mana)\b/.test(text)) return 'bantuan_tugas';

  if (isManualMaterialRequest(message)) return 'penjelasan_materi';
  return '';
}

function getStoredMaterialQuery(pageContextState = {}, sessionMeta = {}) {
  return pageContextState.last_material_query || sessionMeta.last_material_query || '';
}

// [v0.9.59] Sapaan MURNI (semua kata = sapaan/tes): "halo", "hai", "pagi", "tes", "ping".
// "halo apa itu csm" → false (ada kata non-sapaan) supaya tetap diproses normal.
const GREETING_WORDS = new Set(['halo', 'hallo', 'helo', 'hello', 'hi', 'hai', 'hay', 'hei', 'hey', 'hy', 'pagi', 'siang', 'sore', 'malam', 'selamat', 'assalamualaikum', 'assalamualaykum', 'assalamu', 'alaikum', 'test', 'tes', 'testing', 'ping', 'cek', 'check', 'oi', 'woi', 'permisi', 'yo', 'p']);
function detectGreetingOnly(message = '') {
  const t = String(message || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 25) return false;
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every((w) => GREETING_WORDS.has(w));
}
const GREETING_REPLIES = [
  'Halo! 👋 Aku AI Learning Buddy, siap bantu kamu seputar penggunaan VClass. Ada yang bisa kubantu?',
  'Hai! Senang kamu mampir. Mau tanya cara pakai VClass — login, kumpul tugas, forum, atau kuis? Tanya aja ya.',
  'Halo juga! Aku di sini buat bantu kamu soal VClass. Ada yang lagi bikin bingung?',
  'Hai! 😊 Butuh panduan VClass atau mau menanyakan materi? Tinggal ketik pertanyaanmu ya.',
  'Halo! Ada yang bisa kubantu hari ini? Misalnya cara mengumpulkan tugas atau cek deadline.'
];

function canonicalizeRetrievalQuery(message = '', fallbackMaterialQuery = '') {
  const text = String(message || '').trim();
  const normalized = normalizeText(text);

  if (isGenericOpenMaterialRequest(text) && fallbackMaterialQuery) {
    return fallbackMaterialQuery;
  }

  if (/\b(sosial media|sosmed|media sosial)\b/i.test(normalized)) {
    if (/\b(dampak|pengaruh|efek|akibat|positif|negatif|manfaat|risiko|bahaya)\b/i.test(normalized)) return 'dampak media sosial';
    if (/\b(contoh|jenis|macam|aplikasi)\b/i.test(normalized)) return 'jenis dan contoh media sosial';
    return 'apa itu media sosial';
  }

  if (/\b(cms|content management system|content manajemen sistem|kepanjangan cms|singkatan cms)\b/i.test(normalized)) {
    return 'cms content management system wordpress';
  }

  if (/\b(wordpress|word press)\b/i.test(normalized)) {
    if (/\b(persen|berapa|pengguna|orang|dunia|market share|pangsa pasar)\b/i.test(normalized)) return 'wordpress pengguna cms website content management system';
    return 'wordpress cms blog website';
  }

  const materialTopicMatch = normalized.match(/\b(?:buka|lihat|cek|tampilkan|cari)\s+(?:materi|bahan|sumber)(?:\s+(?:tentang|mengenai|soal|bab))?\s+(.+)$/i);
  if (materialTopicMatch && materialTopicMatch[1]) {
    const topic = materialTopicMatch[1]
      .replace(/\b(vclass|virtual class|dong|coba|tolong|deh|ya)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (topic && !/^(materi|bahan|sumber)$/.test(topic)) return topic;
  }

  if (/\b(hoax|hoaks)\b/i.test(normalized)) return 'apa itu hoax';
  if (/\b(cyberbullying|perundungan online|bullying online)\b/i.test(normalized)) return 'apa itu cyberbullying';

  return text;
}

function looksLikeMultipleChoiceQuestion(message = '') {
  const raw = String(message || '');
  return /(^|\n|\s)([A-Da-d])[\).]/.test(raw) || /\b(pilihan ganda|jawaban yang benar|pilih jawaban|opsi a|opsi b|opsi c|opsi d)\b/i.test(raw);
}


function detectAcronymExpansionQuestion(message = '') {
  const raw = String(message || '');
  const normalized = normalizeText(raw);

  // [FIX] HANYA anggap "minta buka kepanjangan singkatan" kalau intent-nya EKSPLISIT
  // (kepanjangan/singkatan/akronim) ATAU ini soal pilihan ganda (anti-suapin jawaban).
  // "apa itu CSS" / "apa yang dimaksud dengan X" = pertanyaan DEFINISI biasa → JANGAN dibajak
  // ke mode "tebak hurufnya sendiri"; biarkan dijawab normal dari materi/AI.
  const explicit = normalized.match(/\b(?:kepanjangan|singkatan|arti singkatan|akronim)\s+(?:dari\s+)?([a-z]{2,8})\b/i)
    || normalized.match(/\b([a-z]{2,8})\s+(?:adalah\s+singkatan|kepanjangannya|singkatan\s+dari)\b/i);

  const uppercase = raw.match(/\b([A-Z]{2,8})\b/);
  const term = (explicit?.[1] || uppercase?.[1] || '').toUpperCase();
  if (!term) return { isAcronym: false, term: '' };

  const asksAcronym = /\b(kepanjangan|singkatan|akronim)\b/i.test(raw)
    || looksLikeMultipleChoiceQuestion(raw);

  return { isAcronym: asksAcronym && /^[A-Z0-9]{2,8}$/.test(term), term };
}

function isMaterialOpenRequest(message = '') {
  const text = normalizeText(message);
  return /\b(buka|lihat|cek|tampilkan|cari)\s+(materi|bahan|sumber)\b/i.test(text)
    || /\b(materi|bahan|sumber)\s+(tentang|mengenai|cms|wordpress|word press|media sosial|hoax|cyberbullying|plugin|website|blog)\b/i.test(text);
}

function shouldBypassVisualGuideForManualMaterial(message = '', detectedIntent = '') {
  const text = normalizeText(message);
  if (!['akses_materi', 'navigasi_kursus', 'tutorial_steps'].includes(detectedIntent)) return false;
  if (!isMaterialOpenRequest(message)) return false;
  const asksUiHowTo = /\b(cara|gimana|bagaimana|klik|tombol|tab|menu|navigasi)\b/.test(text)
    && /\b(login|dashboard|course|kursus|upload|kumpul|forum|quiz|kuis|logout)\b/.test(text);
  return !asksUiHowTo || /\b(tentang|cms|media sosial|hoax|cyberbullying|wordpress|plugin)\b/.test(text);
}

function buildAcronymLearningResponse({ message = '', retrievalResults = [] } = {}) {
  const { term } = detectAcronymExpansionQuestion(message);
  const isMcq = looksLikeMultipleChoiceQuestion(message);
  const lowerTerm = String(term || '').toLowerCase();
  const sourceTitle = retrievalResults?.[0]?.title || retrievalResults?.[0]?.topic || '';
  const hasMaterial = retrievalResults.length > 0;

  if (isMcq) {
    if (lowerTerm === 'cms') {
      return [
        'Ups, sepertinya ini bentuk soal pilihan ganda. Aku tidak akan langsung memilihkan opsi A/B/C, tapi aku bantu cara menentukannya ya.',
        '',
        'Untuk istilah **CMS**, coba pecah jadi 3 kata:',
        '- **C** biasanya mengarah ke kata bahasa Inggris untuk “konten”.',
        '- **M** mengarah ke kata bahasa Inggris untuk “pengelolaan/manajemen”.',
        '- **S** mengarah ke kata bahasa Inggris untuk “sistem”.',
        '',
        'Sekarang cocokkan lagi dengan pilihan yang kamu punya. Perhatikan ejaan bahasa Inggrisnya, terutama kata untuk “management”.',
        '',
        hasMaterial ? 'Kalau masih ragu, klik tombol **Lihat materi** untuk membuka sumber materi yang berkaitan.' : 'Kalau masih ragu, coba cek materi VClass tentang CMS/WordPress atau tanyakan ke guru.'
      ].join('\n');
    }
    return [
      'Ups, sepertinya ini bentuk soal pilihan ganda. Aku tidak akan langsung memilihkan opsi, tapi aku bantu cara berpikirnya ya.',
      '',
      `Untuk singkatan **${escapeHtml(term)}**, coba cari kata inti dari setiap hurufnya satu per satu.`,
      'Setelah itu cocokkan dengan opsi yang ejaannya paling tepat dan paling sesuai materi.',
      '',
      hasMaterial ? 'Kalau masih ragu, klik tombol **Lihat materi** untuk membuka sumber materi terkait.' : 'Kalau masih ragu, cek lagi materi VClass atau tanyakan ke guru.'
    ].join('\n');
  }

  if (lowerTerm === 'cms') {
    return [
      'CMS adalah singkatan yang berkaitan dengan pengelolaan konten di sebuah sistem/website.',
      '',
      'Cara gampangnya: bayangkan ada tempat untuk membuat, mengatur, dan menerbitkan isi website tanpa harus menulis kode dari nol. Nah, konsep itulah yang biasanya dibahas saat menyebut CMS.',
      '',
      hasMaterial ? `Aku juga menemukan materi yang berkaitan${sourceTitle ? `: **${escapeHtml(sourceTitle)}**` : ''}. Klik **Lihat materi** kalau mau membuka sumbernya.` : 'Aku belum menemukan sumber materi yang sangat spesifik di data VClass. Coba cek materi VClass atau tanyakan ke guru jika perlu.'
    ].join('\n');
  }

  return [
    `Istilah **${escapeHtml(term)}** terlihat seperti singkatan.`,
    'Untuk memahaminya, coba pecah hurufnya satu per satu, lalu cari kata bahasa Inggris/Indonesia yang sesuai dengan konteks materi.',
    '',
    hasMaterial ? 'Klik **Lihat materi** kalau ingin membuka sumber materi yang berkaitan.' : 'Aku belum menemukan materi yang sangat spesifik tentang singkatan ini.'
  ].join('\n');
}

// [v0.9.9] Ambil kutipan **tebal** pertama dari jawaban AI (untuk disorot saat buka materi).
function extractBoldQuote(text = '') {
  const s = String(text || '');
  // [v0.9.11] Jawaban "tidak ada di materi" mem-bold nama materi, bukan kutipan asli → skip.
  if (/belum dibahas di materi|maaf, ini sepertinya/i.test(s)) return '';
  const m = s.match(/\*\*(.+?)\*\*/s);
  const q = m ? String(m[1]).replace(/\s+/g, ' ').trim() : '';
  // Abaikan kutipan terlalu pendek (mis. sapaan nama) atau terlalu panjang.
  return q && q.length >= 8 && q.length <= 300 ? q : '';
}

// [v0.9.14] Alur penuh sengketa jawaban kuis (Langkah 1-5).
// Mengembalikan { message } bila berhasil cek, { notAttempted } / { unavailable } untuk
// kondisi lain, atau null kalau data kurang → caller pakai fallback "lapor guru".
async function analyzeQuizDispute({ projectId, courseId, userId, quizNum, qNum, studentName }) {
  if (!courseId || !userId || !quizNum || !qNum) return null;

  const stripHtml = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

  // [1] Cari QUIZ_ID dari "Kuis N" (cocokkan nama mengandung angka, fallback urutan).
  let quizzes = [];
  try {
    const r = await moodleService.getQuizzes(projectId, [courseId]);
    quizzes = Array.isArray(r?.quizzes) ? r.quizzes : (Array.isArray(r) ? r : []);
  } catch (e) { console.warn('[Sengketa] getQuizzes:', e.message); return null; }
  if (!quizzes.length) return null;
  const quiz = quizzes.find((q) => new RegExp(`\\b${quizNum}\\b`).test(String(q.name || ''))) || quizzes[Number(quizNum) - 1];
  if (!quiz?.id) return null;
  const quizName = quiz.name || `Kuis ${quizNum}`;

  // [2] Attempt 'finished'.
  let attempts = [];
  try {
    const r = await moodleService.getUserQuizAttempts(projectId, quiz.id, userId);
    attempts = Array.isArray(r?.attempts) ? r.attempts : (Array.isArray(r) ? r : []);
  } catch (e) { console.warn('[Sengketa] getUserQuizAttempts:', e.message); return { quizName, unavailable: true }; }
  const finished = attempts.filter((a) => String(a.state) === 'finished');
  if (!finished.length) return { quizName, notAttempted: true };
  const attemptId = finished[finished.length - 1].id;

  // [3] Review lembar jawaban → soal slot = qNum. (butuh mod_quiz_get_attempt_review)
  let review = null;
  try {
    review = await moodleService.getQuizAttemptReview(projectId, attemptId);
  } catch (e) { console.warn('[Sengketa] getQuizAttemptReview (mungkin belum diizinkan admin):', e.message); return { quizName, unavailable: true }; }
  const questions = Array.isArray(review?.questions) ? review.questions : [];
  const q = questions.find((x) => Number(x.slot) === Number(qNum) || Number(x.number) === Number(qNum));
  if (!q) return { quizName, unavailable: true };

  const reviewText = stripHtml(q.html).slice(0, 1600);
  const status = String(q.status || q.statusdetails || '').toLowerCase();
  // Bukti visual: HTML review asli dari Moodle (script dibuang; dirender di iframe sandbox).
  const reviewHtml = String(q.html || '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 30000);

  // [4] RAG materi relevan (pakai teks soal sebagai query).
  let materiText = '';
  try {
    const hits = await retrievalService.retrieve(projectId, reviewText.slice(0, 200), {}, 3, { sourceType: 'document_chunk' });
    materiText = (hits || []).map((h) => h.content || h.chunk_text).filter(Boolean).join('\n\n').slice(0, 3000);
  } catch (_) { /* abaikan */ }

  // [5] AI menyimpulkan berdasarkan materi (bukan menebak).
  const prompt = `Kamu AI Learning Buddy untuk siswa SMP. Bahasa Indonesia ramah & sederhana.
Siswa bernama ${studentName} merasa penilaian kuis ini keliru. CEK berdasarkan MATERI, jangan menebak.

SOAL & HASIL PENGERJAAN SISWA (dari Moodle; status penilaian sistem: ${status || 'tidak diketahui'}):
${reviewText}

MATERI TERKAIT (dari basis pengetahuan):
${materiText || '(materi terkait tidak ditemukan)'}

Buat balasan singkat & ramah:
- Sebutkan kamu sudah mengecek "${quizName}" nomor ${qNum} miliknya.
- Bandingkan jawaban siswa dengan materi. Jika jawaban siswa TIDAK sesuai materi → jelaskan jawaban yang benar, KUTIP bagian materi (bungkus **tebal**), simpulkan penilaian sistem sudah tepat, ajak baca ulang materi.
- Jika materi justru MENDUKUNG jawaban siswa (kemungkinan kunci guru keliru) → katakan dugaan siswa mungkin benar, sarankan lapor guru dengan sopan.
- Jika materi tidak cukup → katakan terus terang & sarankan tanya guru. Jangan mengarang.`;

  let aiText = '';
  try {
    const g = await aiQueueService.add(() => geminiService.generateWithFallback(prompt), { intent: 'sengketa_jawaban', responseMode: 'detail' });
    if (g.ok) aiText = g.text;
  } catch (e) { console.warn('[Sengketa] AI compare gagal:', e.message); }
  if (!aiText) return { quizName, unavailable: true, reviewHtml };

  return { quizName, qNum, message: aiText, status, reviewHtml };
}

// [v0.9.19] Helper bersama: resolve kuis (by id/nama) + attempt 'finished' siswa.
function _stripHtmlQuiz(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

// [v0.9.20] Parse HTML review soal Moodle → struktur bersih (teks soal, opsi, jawaban
// siswa, jawaban benar). Lebih ringan & akurat daripada melempar HTML mentah (yang
// berisi script requirejs + 14KB/soal). Cocok dgn format mod_quiz_get_attempt_review.
function parseQuizQuestionHtml(html = '') {
  const s = String(html || '');
  const clean = (t) => _stripHtmlQuiz(t);

  // Teks soal: di dalam <div class="qtext">…</div>
  const qtextM = s.match(/<div class="qtext">([\s\S]*?)<\/div>\s*<\/div>/);
  const questionText = clean(qtextM ? qtextM[1] : '');

  // Jawaban benar (Moodle sudah memberi tahu): "Jawaban yang benar adalah: X"
  const rightM = s.match(/<div class="rightanswer">([\s\S]*?)<\/div>/);
  const correctAnswer = clean(rightM ? rightM[1] : '').replace(/^Jawaban yang benar adalah:\s*/i, '').trim();

  // Opsi: tiap <input type=radio …[checked]> diikuti label (answernumber + <p>teks</p>).
  const options = [];
  let studentAnswer = '';
  const optRe = /(<input[^>]*type="radio"[^>]*>)\s*<div[^>]*data-region="answer-label"[^>]*>\s*<span class="answernumber">([^<]*)<\/span>\s*<div[^>]*>\s*<p>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = optRe.exec(s)) !== null) {
    const inputTag = m[1];
    const label = clean(m[2]).replace(/\.$/, '');
    const text = clean(m[3]);
    const selected = /\bchecked\b/.test(inputTag);
    const isCorrect = Boolean(correctAnswer) && text.toLowerCase() === correctAnswer.toLowerCase();
    options.push({ label, text, selected, isCorrect });
    if (selected) studentAnswer = text;
  }

  return { questionText, studentAnswer, correctAnswer, options };
}
async function resolveQuizAndAttempt({ projectId, courseId, userId, quizName, quizId }) {
  const dbg = { courseId, userId, quizName, quizId, quizzesCount: 0, matchedQuizId: null, matchedQuizName: null, attemptsCount: 0, finishedCount: 0 };
  let quizzes = [];
  try {
    const r = await moodleService.getQuizzes(projectId, [courseId]);
    quizzes = Array.isArray(r?.quizzes) ? r.quizzes : (Array.isArray(r) ? r : []);
  } catch (e) { console.warn('[QuizDispute] getQuizzes:', e.message); return { ok: false, reason: 'quiz_unavailable', debug: dbg }; }
  dbg.quizzesCount = quizzes.length;
  dbg.quizNames = quizzes.map((q) => q.name);
  if (!quizzes.length) return { ok: false, reason: 'quiz_not_found', debug: dbg };

  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let quiz = quizId ? quizzes.find((q) => String(q.id) === String(quizId)) : null;
  if (!quiz && quizName) {
    quiz = quizzes.find((q) => norm(q.name) === norm(quizName))
      || quizzes.find((q) => norm(q.name).includes(norm(quizName)) || norm(quizName).includes(norm(q.name)));
  }
  if (!quiz?.id) return { ok: false, reason: 'quiz_not_found', debug: dbg };
  const resolvedName = quiz.name || quizName || 'Kuis';
  dbg.matchedQuizId = quiz.id; dbg.matchedQuizName = resolvedName;

  let attempts = [];
  try {
    const r = await moodleService.getUserQuizAttempts(projectId, quiz.id, userId);
    attempts = Array.isArray(r?.attempts) ? r.attempts : (Array.isArray(r) ? r : []);
  } catch (e) { console.warn('[QuizDispute] getUserQuizAttempts:', e.message); return { ok: false, reason: 'attempts_unavailable', quizName: resolvedName, debug: dbg }; }
  dbg.attemptsCount = attempts.length;
  dbg.attemptStates = attempts.map((a) => a.state);
  const finished = attempts.filter((a) => String(a.state) === 'finished');
  dbg.finishedCount = finished.length;
  console.log('[QuizDispute] resolve:', JSON.stringify(dbg));
  if (!finished.length) return { ok: false, reason: 'not_attempted', quizName: resolvedName, quizId: quiz.id, debug: dbg };
  return { ok: true, quizId: quiz.id, quizName: resolvedName, attemptId: finished[finished.length - 1].id, debug: dbg };
}

// [v0.9.19] Daftar soal + jawaban siswa untuk satu kuis (preview di form Komplain Kuis).
async function listStudentQuizQuestions({ projectId, courseId, userId, quizName, quizId }) {
  if (!projectId || !courseId || !userId) return { ok: false, reason: 'missing_context' };
  const r = await resolveQuizAndAttempt({ projectId, courseId, userId, quizName, quizId });
  if (!r.ok) return r;

  let review = null;
  try { review = await moodleService.getQuizAttemptReview(projectId, r.attemptId); }
  catch (e) { console.warn('[QuizDispute] getQuizAttemptReview:', e.message); return { ok: false, reason: 'review_unavailable', quizName: r.quizName }; }

  const questions = (Array.isArray(review?.questions) ? review.questions : []).map((q) => {
    const slot = Number(q.slot) || Number(q.number) || null;
    const parsed = parseQuizQuestionHtml(q.html);
    const status = String(q.status || '').toLowerCase();
    return {
      slot,
      number: Number(q.number) || slot,
      status,                                  // mis. "benar" / "salah"
      state: String(q.state || '').toLowerCase(), // gradedright / gradedwrong
      isWrong: String(q.state || '').toLowerCase().includes('wrong'),
      questionText: parsed.questionText,
      studentAnswer: parsed.studentAnswer,
      correctAnswer: parsed.correctAnswer,
      options: parsed.options,
      text: (parsed.questionText || _stripHtmlQuiz(q.html)).slice(0, 320)
    };
  }).filter((q) => q.slot);

  return { ok: true, quizId: r.quizId, quizName: r.quizName, questions, debug: r.debug };
}

// [v0.9.19] Analisis sengketa LANGSUNG via quizId/nama + slot (dari form Komplain Kuis).
// Sama dengan analyzeQuizDispute tapi tanpa tebak nomor dari teks → akurat.
async function analyzeQuizDisputeDirect({ projectId, courseId, userId, quizName, quizId, slot, studentName }) {
  if (!slot) return { ok: false, reason: 'missing_slot' };
  const r = await resolveQuizAndAttempt({ projectId, courseId, userId, quizName, quizId });
  if (!r.ok) return r;

  let review = null;
  try { review = await moodleService.getQuizAttemptReview(projectId, r.attemptId); }
  catch (e) { console.warn('[QuizDispute] getQuizAttemptReview:', e.message); return { ok: false, reason: 'review_unavailable', quizName: r.quizName, debug: r.debug }; }
  const questions = Array.isArray(review?.questions) ? review.questions : [];
  const q = questions.find((x) => Number(x.slot) === Number(slot) || Number(x.number) === Number(slot));
  if (!q) return { ok: false, reason: 'question_not_found', quizName: r.quizName, debug: r.debug };

  const parsed = parseQuizQuestionHtml(q.html);
  const status = String(q.status || '').toLowerCase();
  const state = String(q.state || '').toLowerCase(); // gradedright / gradedwrong
  const reviewHtml = String(q.html || '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 30000);

  // Cari materi relevan pakai teks soal (di-scope ke course siswa).
  let materiText = '';
  try {
    const hits = await retrievalService.retrieve(projectId, parsed.questionText.slice(0, 200), {}, 3, { sourceType: 'document_chunk', courseId });
    materiText = (hits || []).map((h) => h.content || h.chunk_text).filter(Boolean).join('\n\n').slice(0, 3000);
  } catch (_) { /* abaikan */ }

  const sistemNilai = state.includes('wrong') ? 'SALAH' : state.includes('right') ? 'BENAR' : (status || 'tidak diketahui');
  const prompt = `Kamu AI Learning Buddy untuk siswa SMP. Bahasa Indonesia ramah & sederhana.
Siswa bernama ${studentName} komplain penilaian kuis "${r.quizName}" nomor ${slot}. Tugasmu: VERIFIKASI berdasarkan MATERI, bukan menebak.

DATA SOAL (dari Moodle):
- Pertanyaan: ${parsed.questionText || '(tidak terbaca)'}
- Jawaban yang DIPILIH siswa: ${parsed.studentAnswer || '(tidak terbaca)'}
- Kunci jawaban menurut Moodle: ${parsed.correctAnswer || '(tidak terbaca)'}
- Penilaian sistem untuk jawaban siswa: ${sistemNilai}

MATERI TERKAIT (dari basis pengetahuan kelas):
${materiText || '(materi terkait tidak ditemukan)'}

Buat balasan singkat, ramah, dan jujur:
- Awali dengan menyebut sudah mengecek "${r.quizName}" nomor ${slot}.
- Jika jawaban siswa BERBEDA dari kunci & materi MENDUKUNG kunci → jelaskan kenapa kunci benar, KUTIP bagian materi (bungkus **tebal**), simpulkan penilaian sistem sudah tepat, ajak baca ulang materi dengan menyemangati.
- Jika materi justru MENDUKUNG jawaban siswa (mungkin kunci/guru keliru) → katakan dugaan siswa mungkin benar, sarankan melapor ke guru dengan sopan.
- Jika materi tidak cukup untuk memastikan → katakan terus terang & sarankan tanya guru. Jangan mengarang.`;

  let aiText = '';
  try {
    const g = await aiQueueService.add(() => geminiService.generateWithFallback(prompt), { intent: 'sengketa_jawaban', responseMode: 'detail' });
    if (g.ok) aiText = g.text;
  } catch (e) { console.warn('[QuizDispute] AI compare gagal:', e.message); }
  if (!aiText) return { ok: false, reason: 'ai_failed', quizName: r.quizName, reviewHtml, debug: r.debug };

  return { ok: true, quizName: r.quizName, slot, message: aiText, status, state, reviewHtml, parsed, debug: r.debug };
}

// [v0.9.15] Helper umum untuk Kasus 1-3 (status tugas / completion / evaluasi jawaban).
function stripHtmlPlain(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function matchByNameInMessage(list = [], message = '', key = 'name') {
  const text = normalizeText(message);
  if (!Array.isArray(list) || !text) return null;
  let best = null;
  let bestScore = 0;
  list.forEach((item) => {
    const name = normalizeText(item[key] || '');
    if (!name || name.length < 4) return;
    let score = 0;
    if (text.includes(name)) score = 100;
    else {
      const w = name.split(/\s+/).filter((x) => x.length >= 4);
      if (w.length) score = (w.filter((x) => text.includes(x)).length / w.length) * 100;
    }
    if (score > bestScore) { bestScore = score; best = item; }
  });
  return bestScore >= 50 ? best : null;
}

async function getCourseAssignments(projectId, courseId) {
  const r = await moodleService.getAssignments(projectId, [courseId]);
  const out = [];
  (Array.isArray(r?.courses) ? r.courses : []).forEach((c) => (c.assignments || []).forEach((a) => out.push(a)));
  return out;
}

// KASUS 1 & 3: ambil status + teks jawaban tugas yang disebut siswa.
async function getAssignmentSubmissionForMessage({ projectId, courseId, userId, message }) {
  if (!courseId || !userId) return null;
  let assigns = [];
  try { assigns = await getCourseAssignments(projectId, courseId); } catch (e) { console.warn('[Assign] getAssignments:', e.message); return null; }
  const assign = matchByNameInMessage(assigns, message, 'name');
  if (!assign?.id) return null;
  let sub = null;
  try { sub = await moodleService.getAssignmentSubmissionStatus(projectId, assign.id, userId); }
  catch (e) { console.warn('[Assign] submission status:', e.message); return { name: assign.name, unavailable: true }; }
  const submission = sub?.lastattempt?.submission || sub?.lastattempt?.teamsubmission || null;
  const status = submission?.status || 'new';
  let onlineText = '';
  (submission?.plugins || []).forEach((p) => {
    if (p.type === 'onlinetext') (p.editorfields || []).forEach((f) => { if (f.text) onlineText += stripHtmlPlain(f.text) + ' '; });
  });
  // [v0.9.23] URL bukti (halaman tugas di VClass) untuk tombol "Buka di VClass".
  const url = assign.cmid ? `${MOODLE_BASE_URL}/mod/assign/view.php?id=${assign.cmid}` : null;
  return { name: assign.name, status, onlineText: onlineText.trim(), url };
}

// KASUS 2: status completion satu aktivitas yang disebut siswa (+ alasan belum centang).
async function getActivityCompletionForMessage({ projectId, courseId, userId, message }) {
  if (!courseId || !userId) return null;
  let statuses = [];
  try {
    const r = await moodleService.getActivitiesCompletionStatus(projectId, courseId, userId);
    statuses = Array.isArray(r?.statuses) ? r.statuses : [];
  } catch (e) { console.warn('[Completion] status:', e.message); return null; }
  if (!statuses.length) return null;

  const nameByCmid = {};
  const urlByCmid = {};
  try {
    const sections = await moodleService.getCourseContents(projectId, courseId);
    (sections || []).forEach((s) => (s.modules || []).forEach((m) => { nameByCmid[m.id] = m.name; urlByCmid[m.id] = m.url || null; }));
  } catch (_) { /* abaikan: nama fallback ke cmid */ }

  const withName = statuses.map((st) => ({ ...st, name: nameByCmid[st.cmid] || ('Aktivitas ' + st.cmid) }));
  const target = matchByNameInMessage(withName, message, 'name');
  if (!target) return null;

  // Kumpulkan deskripsi aturan yang BELUM terpenuhi.
  const unmet = [];
  (Array.isArray(target.details) ? target.details : []).forEach((d) => {
    const desc = (d.rulevalue && d.rulevalue.description) || d.description || d.rulename || '';
    const ruleStatus = (d.rulevalue && typeof d.rulevalue.status !== 'undefined') ? d.rulevalue.status : null;
    if (desc && (ruleStatus === 0 || ruleStatus === false)) unmet.push(stripHtmlPlain(desc));
    else if (desc && ruleStatus === null) unmet.push(stripHtmlPlain(desc)); // tak tahu status → tampilkan saja
  });
  return { name: target.name, state: Number(target.state || 0), unmet, url: urlByCmid[target.cmid] || null };
}

function buildSourceActionsFromRetrieval(retrievalResults = [], query = '', highlightQuote = '') {
  const actions = [];
  const pdfActions = [];
  const moodleMaterials = [];
  const seenPdf = new Set();
  const seenMaterial = new Set();

  (retrievalResults || []).slice(0, 6).forEach((item, index) => {
    const metadata = item.metadata || {};
    const fileUrl = item.file_url || item.url || item.source_url || metadata.file_url || metadata.source_url || metadata.url;
    const fileType = item.file_type || metadata.file_type || metadata.content_type || '';
    const title = item.title || metadata.module_name || metadata.title || item.topic || `Materi ${index + 1}`;
    const pageNumber = Number(item.page_number || metadata.page_number || metadata.page || 1) || 1;
    const highlightText = item.highlight_text || metadata.highlight_text || item.chunk_text || item.content || '';
    const contentSnippet = String(item.content || item.chunk_text || highlightText || '').replace(/\s+/g, ' ').trim();
    if (!fileUrl) return;
    const isPdf = String(fileUrl).toLowerCase().includes('.pdf') || String(fileType).toLowerCase().includes('pdf');
    const isMoodle = metadata.source_origin === 'moodle'
      || /lms\.smpn167jakarta\.sch\.id/i.test(String(fileUrl))
      || /\/mod\/(page|resource|book|label)\/view\.php/i.test(String(fileUrl));

    if (isPdf && !seenPdf.has(fileUrl)) {
      seenPdf.add(fileUrl);
      pdfActions.push({ type: 'open_pdf_viewer', label: `Buka sumber materi: ${title}`.slice(0, 80), url: fileUrl, page_number: pageNumber, query: highlightQuote || query, highlight_text: highlightQuote || highlightText, content: item.content || item.chunk_text || '' });
      return;
    }

    if (isMoodle && !seenMaterial.has(fileUrl) && moodleMaterials.length < 3) {
      seenMaterial.add(fileUrl);
      moodleMaterials.push({
        title, topic: metadata.section_name || item.topic || '', url: fileUrl, source_url: fileUrl,
        file_type: fileType || 'html', modname: metadata.modname || 'page', class_code: metadata.class_code || '',
        course_id: metadata.moodle_course_id || null, module_id: metadata.module_id || null,
        preview: contentSnippet.slice(0, 260), content: contentSnippet, snippets: contentSnippet ? [contentSnippet] : [],
        highlight: highlightQuote || '', score: item.score || 0
      });
    }
  });

  if (moodleMaterials.length > 0) {
    actions.push({ type: 'open_moodle_materials', label: moodleMaterials.length > 1 ? `Lihat ${moodleMaterials.length} materi terkait` : 'Lihat materi', materials: moodleMaterials });
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

const ENTRY_POINT_IMAGE = detailImage('ENTRY POINT.png');

// [v0.9.13] Tambahkan field `video: 'https://...'` pada entri mana pun untuk
// memunculkan tombol "Tonton Video" (YouTube watch/youtu.be/embed atau file .mp4).
// Tanpa `video`, tombol video tidak muncul (hanya carousel gambar statis).
const STATIC_TUTORIALS = {
  login: {
    key: 'login',
    title: 'Cara Login ke VClass',
    shortTitle: 'Login VClass',
    video: '', // ← isi URL video tutorial login bila ada
    intent: 'bantuan_login',
    intro: 'Tutorial ini menjelaskan langkah dasar untuk masuk ke akun VClass.',
    note: 'Catatan: gambar bisa kamu ganti/update manual sesuai screenshot VClass terbaru.',
    steps: [
      { title: 'Buka halaman Login VClass', text: 'Buka halaman utama Virtual Class/VClass dari browser kamu, lalu cari tombol Login/Masuk.', image: detailImage('TUTORIAL LOGIN', '1.png') },
      { title: 'Isi username/email dan password', text: 'Masukkan username/email dan password yang diberikan oleh guru atau admin sekolah.', image: detailImage('TUTORIAL LOGIN', '2.png') },
      { title: 'Klik Masuk/Login', text: 'Klik tombol Masuk/Login. Jika gagal, cek lagi penulisan username/email dan password kamu.', image: detailImage('TUTORIAL LOGIN', '3.png') }
    ]
  },

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
        image: detailImage('TUTORIAL REPLY FORUM', '1.png')
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
        image: detailImage('TUTORIAL KUMPULIN TUGAS', '1.png')
      },
      {
        title: 'Cek status pengajuan',
        text: 'Perhatikan status tugas. Dari sini kamu bisa tahu apakah tugas belum dikumpulkan, sudah terkirim, atau masih bisa diedit.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', '2.png')
      },
      {
        title: 'Isi catatan jika perlu',
        text: 'Jika guru meminta catatan atau deskripsi tambahan, tuliskan pada kolom pesan/teks yang tersedia.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', '3.png')
      },
      {
        title: 'Upload file tugas',
        text: 'Unggah file tugas sesuai format yang diminta, misalnya PDF, PNG, JPG, DOCX, atau format lain sesuai instruksi guru. Setelah itu simpan/kirim.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', '4.png')
      },
      {
        title: 'Pastikan status selesai',
        text: 'Setelah mengirim, pastikan status tugas menunjukkan bahwa tugas sudah berhasil dikumpulkan.',
        image: detailImage('TUTORIAL KUMPULIN TUGAS', '5.png')
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
        image: detailImage('TUTORIAL LOGOUT', '1.png')
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

// Deteksi pertanyaan yang jelas "cara/langkah" (prosedural) — bukan pengecekan status.
// Tujuannya: "saya udah ngerjain tugas, cara ngumpulinnya gimana?" harus masuk
// tutorial (bantuan_tugas), bukan "cek tugas belum selesai".
function looksProceduralHowTo(message = '') {
  const t = normalizeText(message);
  const isProcedural = /\b(cara|caranya|gimana|gmn|bagaimana|tata cara|langkah|tutorial|panduan|step|stepnya|petunjuk)\b/i.test(t);
  // Sinyal kuat bahwa user MEMANG menanyakan status/daftar, bukan how-to.
  const isExplicitStatusQuery = /\b(mana yang|yang belum|apa aja|apa saja|daftar|list|sisa|berapa yang|sudah berapa|belum selesai|belum dikerjakan|belum dikumpulkan|belum dijawab)\b/i.test(t);
  return isProcedural && !isExplicitStatusQuery;
}

// Pertanyaan umum yang aman dijawab sistem walau di luar materi (waktu, aritmatika sederhana).
// Tetap menolak indikasi jailbreak / minta kode.
function detectGeneralSafeQuestion(message = '') {
  const raw = String(message || '');
  const t = normalizeText(raw);
  if (/\b(abaikan|ignore|system prompt|jailbreak|buatkan kode|tulis script|buatkan program|bikinin kode)\b/i.test(t)) {
    return { type: null };
  }
  if (/\b(tanggal berapa|hari apa|hari ini tanggal|sekarang tanggal|sekarang hari|jam berapa|sekarang jam|pukul berapa|bulan apa|tahun berapa|sekarang bulan|sekarang tahun)\b/i.test(t)) {
    return { type: 'datetime' };
  }
  const m = raw.match(/(-?\d+(?:[.,]\d+)?)\s*([+\-xX×*/:])\s*(-?\d+(?:[.,]\d+)?)/);
  if (m) return { type: 'math', a: m[1], op: m[2], b: m[3] };
  return { type: null };
}

function buildDateTimeAnswer() {
  const now = new Date();
  const tgl = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const jam = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  return `Sekarang **${tgl}**, pukul **${jam} WIB**. 😊\n\nKalau ada yang ingin kamu tanyakan seputar materi, aku siap bantu ya.`;
}

function buildMathAnswer({ a, op, b }) {
  const x = parseFloat(String(a).replace(',', '.'));
  const y = parseFloat(String(b).replace(',', '.'));
  const isDiv = op === '/' || op === ':';
  let r;
  if (op === '+') r = x + y;
  else if (op === '-') r = x - y;
  else if (isDiv) r = y !== 0 ? x / y : null;
  else r = x * y; // x, X, ×, *
  const opLabel = op === '+' ? '+' : op === '-' ? '−' : isDiv ? '÷' : '×';
  if (r === null) {
    return 'Hmm, pembagian dengan nol tidak terdefinisi ya 😅. Lagipula pertanyaan ini di luar materi pelajaran kita.';
  }
  const rounded = Math.round(r * 1000) / 1000;
  return `Aku tahu jawabannya kok: **${x} ${opLabel} ${y} = ${rounded}**. 🙂\n\nTapi sepertinya pertanyaan ini **di luar materi pelajaran** yang sedang kita bahas. Kalau ada yang ingin ditanyakan soal materi, aku bantu lebih detail ya.`;
}

// Bangun HANYA tombol carousel tutorial statis (tanpa tombol "lihat materi"),
// dipakai saat AI menjawab konteks sistem agar tetap ada panduan step-by-step.
function buildStaticTutorialCarouselAction(tutorialKey = '', originalMessage = '') {
  const tutorial = STATIC_TUTORIALS[tutorialKey];
  if (!tutorial) return null;
  const payload = cloneStaticTutorial(tutorial);
  payload.original_message = originalMessage;
  return {
    type: 'static_tutorial_carousel',
    label: `Lihat Tutorial ${tutorial.shortTitle || tutorial.title}`,
    payload
  };
}

function isLmsStatusQuestion(message = '', intent = '') {
  const normalizedIntent = String(intent || '').toLowerCase().trim();
  const text = normalizeText(message);

  if (LMS_INTENTS.includes(normalizedIntent)) return true;

  // Pertanyaan "cara/langkah" tidak boleh dianggap pengecekan status.
  if (looksProceduralHowTo(message)) return false;

  const asksStatus = /\b(belum|blm|nggak|gak|tidak|mana|apa aja|apa saja|daftar|list|cek|kerjain|ngerjain|dikerjain|deadline|tenggat|batas waktu|hari ini|terdekat|kerjain|ngerjain|dikerjain)\b/i.test(text);
  const mentionsActivity = /\b(quiz|kuis|quis|ujian|ulangan|soal|forum|diskusi|tugas|assignment|aktivitas|activity)\b/i.test(text);

  return mentionsActivity && asksStatus;
}

function inferLmsStatusIntentFromMessage(message = '') {
  const text = normalizeText(message);

  // Prioritas: jika ini pertanyaan "cara/langkah", JANGAN dipetakan ke status LMS.
  if (looksProceduralHowTo(message)) return '';

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

function buildAiFollowupPromptForTutorial(tutorial = {}, originalMessage = '') {
  // Utamakan pertanyaan ASLI user supaya AI tahu konteks persis yang ditanyakan,
  // bukan kalimat generik "jelaskan fitur ini".
  const orig = String(originalMessage || '').trim();
  if (orig) {
    return `Tolong jelaskan secara singkat, jelas, dan langkah demi langkah untuk pertanyaan ini: "${orig}"`;
  }

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
    bantuan_login: 'login',
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

// [v0.9.9] Cari instruksi aktivitas (KB) yang namanya disebut user di pesannya.
// Dipakai agar pertanyaan "cara kumpul tugas <NAMA>" menjawab info tugas spesifik dulu.
function findMatchingActivity(activities = [], message = '') {
  const text = normalizeText(message);
  if (!Array.isArray(activities) || !text) return null;
  let best = null;
  let bestScore = 0;
  activities.forEach((a) => {
    const title = normalizeText(a.title || '');
    if (!title || title.length < 4) return;
    let score = 0;
    if (text.includes(title)) {
      score = 100;
    } else {
      const titleWords = title.split(/\s+/).filter((w) => w.length >= 4);
      if (titleWords.length) {
        const hit = titleWords.filter((w) => text.includes(w)).length;
        score = (hit / titleWords.length) * 100;
      }
    }
    if (score > bestScore) { bestScore = score; best = a; }
  });
  return bestScore >= 60 ? best : null;
}

function buildActivityInfoText(activity = {}) {
  const parts = [`📌 **${String(activity.title || 'Tugas ini').trim()}**`];
  if (activity.instruction) parts.push(String(activity.instruction).trim());
  if (activity.deadline) parts.push(`⏰ **Tenggat:** ${String(activity.deadline).trim()}`);
  if (activity.completion_criteria) parts.push(`✅ **Syarat selesai:** ${String(activity.completion_criteria).trim()}`);
  return parts.join('\n\n');
}

function buildStaticTutorialChatResponse({ studentName = '', tutorialKey = '', effectiveMessage = '', activityInfo = '' }) {
  const tutorial = STATIC_TUTORIALS[tutorialKey];
  if (!tutorial) return null;

  const safeName = String(studentName || 'teman').trim() || 'teman';
  const payload = cloneStaticTutorial(tutorial);
  payload.original_message = effectiveMessage;

  // [v0.9.9] Kalau user menyebut tugas spesifik & ada instruksinya → info tugas DULU,
  // baru tutorial visual sebagai pelengkap.
  const message = activityInfo
    ? `Hai **${safeName}**,\n\n${activityInfo}\n\n———\n\n` +
      `Supaya makin jelas, aku siapkan juga panduan visual **${tutorial.title}**. ` +
      `Klik tombol di bawah untuk membuka langkah-langkahnya.`
    : `Hai **${safeName}**,\n\n` +
      `Aku sudah siapkan panduan visual **${tutorial.title}**.\n\n` +
      `Silakan klik tombol di bawah ini untuk membuka langkah-langkahnya dalam bentuk carousel. ` +
      `Gambarnya bisa diklik supaya tampil lebih besar.`;

  // [v0.9.13] Opsi video tutorial — hanya muncul jika tutorial punya `video` (URL).
  const videoAction = tutorial.video
    ? [{ type: 'video_tutorial', label: `Tonton Video: ${tutorial.shortTitle || tutorial.title}`, url: tutorial.video, title: tutorial.title }]
    : [];

  return {
    message,
    actions: [
      {
        type: 'static_tutorial_carousel',
        label: `Lihat Tutorial ${tutorial.shortTitle || tutorial.title}`,
        payload
      },
      ...videoAction,
      {
        type: 'ask_ai',
        label: 'Tanya AI',
        payload: {
          original_message: effectiveMessage,
          message: buildAiFollowupPromptForTutorial(tutorial, effectiveMessage),
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

// ===== [v0.7.0] Mention @materi-N: pencarian tertarget di satu dokumen ===========
function stripMentionTokens(message = '') {
  return String(message || '').replace(/@[\w-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Ambil kata kunci penting (>=4 huruf) dari query untuk highlight & cek relevansi.
function extractQueryKeywords(query = '') {
  const stop = new Set(['apa', 'itu', 'yang', 'dan', 'atau', 'dengan', 'untuk', 'pada', 'dari', 'adalah', 'kenapa', 'kenapa', 'gimana', 'bagaimana', 'sih', 'dong', 'tentang', 'jelaskan', 'maksud']);
  return Array.from(new Set(
    String(query || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 3 && !stop.has(w))
  ));
}

// Potong cuplikan di sekitar kemunculan keyword pertama (biar relevan).
function buildMentionSnippet(content = '', keywords = [], maxLen = 280) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Materi terkait ditemukan di dokumen sumber.';
  const lower = text.toLowerCase();
  let pos = -1;
  for (const kw of keywords) {
    const i = lower.indexOf(kw);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '');
  const start = Math.max(0, pos - 80);
  const end = Math.min(text.length, start + maxLen);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

// [v0.9.3] Bedakan "intent" saran lanjutan @materi → tiap jenis punya prompt sendiri,
// dan masing-masing di-cache terpisah (rangkum/poin/jelaskan/soal).
// [v0.9.36] Deteksi materi yang isinya HANYA TABEL kisi-kisi / rencana soal ujian (bukan
// materi penjelasan). Ciri: judul "kisi-kisi", atau konten penuh kolom blueprint
// (Capaian Pembelajaran / Indikator Soal / Level Kognitif / Nomor Soal), banyak "Peserta
// didik dapat...", banyak penanda level kognitif C1–C6. Untuk materi seperti ini, AI tak
// boleh "merangkum konsep" (seolah materi mengajarkannya) — harus menjelaskan MAKSUD TABEL.
function detectBlueprintTable(text = '', title = '') {
  const t = String(text || '').toLowerCase();
  const ti = String(title || '').toLowerCase();
  if (/kisi\s*-?\s*kisi|blueprint/.test(ti)) return true;
  let signals = 0;
  if (/capaian pembelajaran/.test(t)) signals += 1;
  if (/indikator soal/.test(t)) signals += 1;
  if (/level kognitif/.test(t)) signals += 1;
  if (/nomor soal/.test(t)) signals += 1;
  if ((t.match(/peserta didik dapat/g) || []).length >= 3) signals += 1;
  if ((t.match(/\bc[1-6]\b/g) || []).length >= 3) signals += 1;
  return signals >= 3;
}

// Prompt khusus tabel kisi-kisi: jelaskan MAKSUD tabel (panduan belajar/ujian), JANGAN
// merangkum topik-topiknya seolah materi ini mengajarkan konsep tersebut.
function buildBlueprintTablePrompt(label, materiContent, cleanQ) {
  return `Kamu AI Learning Buddy untuk siswa SMP. Bahasa Indonesia sederhana, ramah, **bold** untuk poin penting.

PENTING: Materi "${label}" ini BUKAN bab materi pelajaran — ini adalah **TABEL KISI-KISI / rencana soal ujian** (daftar topik yang akan diujikan beserta indikator, level kognitif C1–C6, dan nomor soal). JANGAN menjelaskan konsep-konsepnya seolah materi ini yang mengajarkannya. Tugasmu MENJELASKAN MAKSUD TABEL ini.

Lakukan:
1) Awali dengan jelas: ini **kisi-kisi ujian** (panduan belajar), bukan materi pelajaran biasa.
2) Jelaskan singkat arti kolomnya: Capaian Pembelajaran, Materi yang diuji, Indikator Soal (apa yang harus bisa), Level Kognitif (C1–C6 = dari mengingat sampai mencipta), Nomor Soal.
3) Sebutkan **daftar topik yang akan diujikan** (ambil dari kolom "Materi") sebagai poin-poin yang perlu dipelajari siswa — JANGAN dijelaskan konsepnya, cukup didaftar.
4) Bila ada, sebut total jumlah soal / cakupan ujian.
5) Tutup: ajak siswa mempelajari topik-topik itu dari materi terkait sebelum ujian.

Pakai HANYA isi tabel di bawah, jangan mengarang.

Pertanyaan siswa: ${cleanQ}

=== ISI TABEL "${label}" ===
${materiContent}`;
}

function detectMentionTask(message = '') {
  const t = String(message || '').toLowerCase();
  if (/\b(rangkum|ringkas|ringkasan|rangkuman|resume|kesimpulan|simpulkan|garis besar)\b/.test(t)) return 'summary';
  // [#4] "ini tuh tentang apa sih materinya?" / "isinya apa" / "bahas apa" / "materinya apa"
  // = minta GAMBARAN UMUM materi → perlakukan sebagai rangkuman (overview), bukan tanya-jawab
  // keyword spesifik yang sering berakhir "tidak ditemukan".
  if (/(tentang apa|isinya apa|apa isi|bahas apa|membahas apa|materinya apa|apa sih materi|maksud(nya)? apa|menjelaskan apa|berisi apa|ngebahas apa|ini materi apa)/.test(t)) return 'summary';
  if (/(poin penting|poin-poin|poin penting materi|kata kunci|inti dari|intinya|poin utama)/.test(t)) return 'keypoints';
  if (/(buat|bikin|berikan).{0,20}(soal|latihan|kuis|pertanyaan)|soal latihan/.test(t)) return 'quiz';
  if (/(jelaskan|terangkan).{0,30}(sederhana|mudah|gampang)|bahasa sederhana|jelaskan materi ini|jelaskan keseluruhan|jelaskan semua/.test(t)) return 'simplify';
  return null;
}

function buildMentionTaskPrompt(task, label, materiContent, cleanQ) {
  const head = `Kamu AI Learning Buddy untuk siswa SMP. Bahasa Indonesia sederhana. HANYA gunakan isi materi di bawah, JANGAN mengarang di luar materi.`;
  const body = `\n\n=== ISI MATERI "${label}" ===\n${materiContent}`;
  if (task === 'summary') {
    return `${head}\nBuat RANGKUMAN: 1 kalimat inti, lalu 3-6 poin bullet, lalu 1 kalimat penutup.${body}`;
  }
  if (task === 'keypoints') {
    return `${head}\nTuliskan POIN-POIN PENTING materi ini sebagai bullet singkat (5-8 poin), tiap poin 1 baris.${body}`;
  }
  if (task === 'simplify') {
    return `${head}\nJELASKAN materi ini dengan bahasa SANGAT sederhana untuk siswa SMP, boleh pakai analogi sehari-hari agar mudah dipahami.${body}`;
  }
  if (task === 'quiz') {
    return `${head}\nBuat 3 SOAL LATIHAN dari materi ini (boleh pilihan ganda/isian). Untuk tiap soal beri petunjuk cara menjawab. Taruh kunci jawaban singkat di bagian paling bawah dengan judul "Kunci".${body}`;
  }
  // Tanya-jawab bebas (mode AI) atas materi.
  // [v0.9.11] Dua cabang TEGAS: ada di materi → jawab + kutipan **tebal**.
  // TIDAK ada → JUJUR bilang belum ada di materi + beri kata kunci bantuan, JANGAN
  // dipaksakan seolah dari materi ("Berdasarkan materi..." padahal tidak ada).
  const qaHead = `Kamu AI Learning Buddy untuk siswa SMP. Jawab dengan bahasa Indonesia yang sederhana dan ramah.`;
  return `${qaHead}
Tugasmu menjawab pertanyaan siswa tentang materi "${label}". Ikuti aturan ini dengan TEGAS:

1) Jika jawaban BENAR-BENAR ADA di dalam isi materi di bawah:
   - JANGAN menyalin kalimat materi mentah-mentah/persis. OLAH ULANG dengan bahasamu sendiri yang lebih sederhana & enak dibaca siswa SMP (boleh pakai analogi singkat).
   - Jika pertanyaannya soal CARA/LANGKAH (mis. "cara", "gimana", "bagaimana", "langkah", "menginstall", "membuat"), susun jawabannya sebagai **LANGKAH BERURUTAN bernomor** (Langkah 1, Langkah 2, …), tiap langkah singkat & jelas.
   - Jika di materi ada TAUTAN/LINK (mis. link download/unduh), SERTAKAN link itu apa adanya supaya bisa diklik siswa.
   - Tetap SETIA pada isi materi — jangan menambah fakta/angka yang tidak ada di materi.

2) Jika jawaban TIDAK ADA / tidak dibahas di materi:
   - JANGAN mengarang dan JANGAN menulis "Berdasarkan materi ...".
   - JANGAN menyuruh siswa "cari sendiri di internet / Google".
   - Awali dengan kalimat jujur & sopan yang mengakui keterbatasan, contoh gaya: "Maaf, untuk **<inti yang ditanya, mis. cara install XAMPP>** sepertinya belum tersedia/dibahas di materi **${label}** ini."
   - Lalu jelaskan SINGKAT (1 kalimat, berdasarkan isi materi di bawah) materi ini sebenarnya membahas tentang apa, supaya siswa paham cakupannya.
   - Tutup dengan sopan: sarankan menanyakan langsung ke gurunya kalau memang membutuhkan hal itu. Nada membantu, bukan menyuruh siswa repot sendiri.

Pertanyaan siswa: ${cleanQ}${body}`;
}

// [v0.9.42] Kuis interaktif @materi: jumlah soal (maks 10) diambil dari pesan; null = belum
// ditentukan (perlu konfirmasi). Pakai cleanQ (token @materi-N sudah dibuang) supaya angka
// pada "materi-1" tidak ikut terbaca.
function parseQuizCount(cleanQ = '') {
  const m = String(cleanQ || '').match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n ? Math.min(10, Math.max(1, n)) : null;
}

// Parse JSON kuis dari output AI (toleran terhadap fence ```json dan teks pembungkus).
// Kembalikan array soal tervalidasi atau null.
function parseQuizJSON(text = '', count = 10) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
  const arr = Array.isArray(obj?.questions) ? obj.questions : [];
  const out = [];
  for (const q of arr) {
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
    const answer = Number(q.answer);
    if (!q.q || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    out.push({ q: String(q.q).trim(), options, answer, explanation: q.explanation ? String(q.explanation).trim() : '' });
    if (out.length >= count) break;
  }
  return out.length ? out : null;
}

async function generateQuizJSON(count, label, materiContent, sessionId, responseMode) {
  const basePrompt = `Kamu guru SMP. Buat TEPAT ${count} soal PILIHAN GANDA (4 opsi) untuk siswa SMP, HANYA dari isi materi di bawah (jangan mengarang di luar materi). Bahasa Indonesia.
Output HANYA JSON valid, tanpa teks/markdown lain:
{"questions":[{"q":"pertanyaan","options":["opsi A","opsi B","opsi C","opsi D"],"answer":0,"explanation":"pembahasan singkat 1 kalimat"}]}
"answer" = indeks opsi yang BENAR (0-3).

=== MATERI "${label}" ===
${materiContent}`;

  // [FIX] Gemini KADANG mengabaikan "HANYA JSON" dan membalas prosa (sapaan + soal teks) →
  // parseQuizJSON null → dulu jatuh ke kuis teks (bukan modal interaktif). Coba lagi 1x dengan
  // instruksi lebih tegas sebelum menyerah.
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}\n\nPENTING: Balas HANYA objek JSON mentah. DILARANG ada sapaan, kalimat pembuka/penutup, atau markdown. Mulai langsung dengan karakter { dan akhiri dengan }.`;
    try {
      const r = await aiQueueService.add(() => geminiService.generateWithFallback(prompt), { sessionId, intent: 'penjelasan_materi', responseMode });
      if (!r.ok) { if (r.quotaFallback) aiRateLimitService.markGlobalExhausted(); return null; }
      const parsed = parseQuizJSON(r.text, count);
      if (parsed && parsed.length) return parsed;
    } catch (e) { console.error('[Quiz] generate gagal (attempt ' + attempt + '):', e.message); }
  }
  return null;
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

// [v0.9.58] Saat mode sistem TIDAK punya jawaban: jangan diam-diam pakai AI. Kalau kuota AI
// bersama penuh → minta maaf + tombol Hubungi Guru; kalau masih ada → kartu konfirmasi
// (needs_ai_confirm) supaya siswa memilih dialihkan ke AI atau tidak.
async function buildAiConfirmOrExhausted({ sessionId, effectiveMessage, detectedIntent, responseMode, studentName, aiUsage, safetyState }) {
  const g = aiRateLimitService.getGlobalUsage();
  if (g.exhausted) {
    const mins = Math.max(1, Math.ceil((g.resets_in_seconds || 0) / 60));
    const text = addStudentGreeting(`Maaf, jawaban untuk pertanyaan ini belum tersedia di sistem, dan **kuota AI bersama sedang penuh** (coba lagi sekitar ${mins} menit lagi). Kalau mendesak, kamu bisa menghubungi guru.`, studentName);
    const actions = [{ type: 'wa_teacher', label: 'Hubungi Guru (WhatsApp)' }];
    await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: detectedIntent });
    await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: detectedIntent, context_used: { response_source: 'system', actions, used_model: 'ai_exhausted' } });
    return { intent: detectedIntent, response_source: 'system', ai_usage: aiUsage, is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: text, actions } };
  }
  const confirmText = addStudentGreeting('Aku belum punya **jawaban dari sistem** yang pas untuk pertanyaan ini.\n\nMau aku alihkan ke **Jawaban AI**?', studentName);
  const confirmActions = [
    { type: 'confirm_ai', label: 'Ya, alihkan ke AI', payload: { message: effectiveMessage, intent: detectedIntent, responseMode: responseMode === 'system' ? 'short' : (responseMode || 'short') } },
    { type: 'decline_ai', label: 'Tidak' }
  ];
  return {
    intent: detectedIntent, response_source: 'system', needs_ai_confirm: true,
    ai_usage: aiUsage, is_locked: safetyState.locked, warnings: safetyState.warnings,
    botMessage: { message: confirmText, actions: confirmActions }
  };
}

// [v0.9.59 #4] DETAIL tugas/kuis: pertanyaan atribut item (tenggat, format, durasi, dll) →
// konfirmasi item mana (list) lalu jawab dari SISTEM pakai data Moodle. Atribut yang tak
// tersedia via WS (mis. jumlah soal) diarahkan "cek di VClass". Materi/forum tetap via AI.
const _ITEM_ATTR_RE = /(deadline|tenggat|berapa soal|jumlah soal|durasi|berapa menit|format|individu|kelompok|instruksi|dinilai|penilaian|kriteria|wajib|ukuran|pdf|word|percobaan|diulang|dibuka|ditutup|tujuan|syarat|unggah|upload|isi tugas|isi kuis|isi quiz|maksimal|nilai maks|dikumpul)/i;
function detectTugasKuisDetailQuestion(message = '') {
  const t = String(message || '').toLowerCase();
  if (/\bcara\b/.test(t)) return null; // "cara mengumpulkan…" → tutorial, bukan detail
  const isAssign = /\b(tugas|assignment|assign)\b/.test(t);
  const isQuiz = /\b(kuis|quiz|quis|ujian)\b/.test(t);
  if (!isAssign && !isQuiz) return null;
  if (!_ITEM_ATTR_RE.test(t)) return null;
  return isQuiz ? 'quiz' : 'assignment';
}

function fmtMoodleDate(ts) {
  const n = Number(ts);
  if (!n) return 'tidak diatur';
  try {
    return new Date(n * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';
  } catch (_) { return 'tidak diatur'; }
}
function stripHtmlText(s = '') {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
async function fetchTugasKuisItems(projectId, courseId, itemType) {
  if (itemType === 'quiz') {
    const data = await moodleService.getQuizzes(projectId, [courseId]);
    return (data?.quizzes || []).filter((q) => String(q.course) === String(courseId));
  }
  const data = await moodleService.getAssignments(projectId, [courseId]);
  const list = [];
  (data?.courses || []).forEach((c) => { if (String(c.id) === String(courseId)) (c.assignments || []).forEach((a) => list.push(a)); });
  return list;
}
function findItemByText(items, text) {
  const t = String(text || '').toLowerCase();
  let best = null;
  for (const it of items) {
    const name = String(it.name || '').toLowerCase().trim();
    if (name && t.includes(name) && (!best || name.length > String(best.name || '').length)) best = it;
  }
  return best;
}
function buildAssignmentInfoText(a, studentName) {
  const lines = [`Hai **${studentName}**, ini info tugas **${escapeHtml(a.name || 'Tugas')}**:`, ''];
  const intro = stripHtmlText(a.intro);
  if (intro) lines.push(`📝 ${intro.slice(0, 400)}`, '');
  lines.push(`• **Tenggat:** ${fmtMoodleDate(a.duedate || a.cutoffdate)}`);
  lines.push(`• **Pengerjaan:** ${Number(a.teamsubmission) ? 'kelompok' : 'individu'}`);
  if (a.grade != null && Number(a.grade)) lines.push(`• **Dinilai:** ya (nilai maksimal ${a.grade})`);
  lines.push('', '_Detail lain yang tak tercantum (mis. jumlah/isi soal, format & ukuran file) bisa kamu cek langsung di VClass ya._');
  return lines.join('\n');
}
function buildQuizInfoText(q, studentName) {
  const lines = [`Hai **${studentName}**, ini info kuis **${escapeHtml(q.name || 'Kuis')}**:`, ''];
  const intro = stripHtmlText(q.intro);
  if (intro) lines.push(`📝 ${intro.slice(0, 400)}`, '');
  if (q.timeopen) lines.push(`• **Dibuka:** ${fmtMoodleDate(q.timeopen)}`);
  if (q.timeclose) lines.push(`• **Ditutup:** ${fmtMoodleDate(q.timeclose)}`);
  lines.push(`• **Durasi:** ${Number(q.timelimit) ? Math.round(Number(q.timelimit) / 60) + ' menit' : 'tanpa batas waktu'}`);
  lines.push(`• **Percobaan diizinkan:** ${Number(q.attempts) ? q.attempts + ' kali' : 'tak terbatas'}`);
  if (q.grade != null) lines.push(`• **Nilai maksimal:** ${q.grade}`);
  lines.push('', '_Jumlah/isi soal dan detail lain yang tak tercantum bisa kamu cek langsung di VClass._');
  return lines.join('\n');
}
async function respondTugasKuisDetail({ sessionId, projectId, courseId, itemType, questionText, studentName, safetyState }) {
  const isQuiz = itemType === 'quiz';
  const detailIntent = isQuiz ? 'detail_kuis' : 'detail_tugas';
  const label = isQuiz ? 'kuis' : 'tugas';
  const wrap = (text, actions = []) => ({
    intent: detailIntent, response_source: 'system',
    ai_usage: aiRateLimitService.getStatus(sessionId),
    is_locked: safetyState.locked, warnings: safetyState.warnings,
    botMessage: { message: text, actions }
  });

  if (!courseId) {
    return wrap(`Aku belum tahu ${label} di kelas mana yang kamu maksud. Buka halaman course/kelasmu di VClass dulu ya, lalu tanya lagi.`);
  }

  let items = [];
  try { items = await fetchTugasKuisItems(projectId, courseId, itemType); }
  catch (e) {
    console.warn('[TugasKuisDetail] gagal ambil dari Moodle:', e.message);
    return wrap(`Maaf, aku sedang tidak bisa mengambil daftar ${label} dari VClass. Coba lagi nanti atau buka langsung di VClass ya.`);
  }
  if (!items.length) return wrap(`Belum ada ${label} yang terdaftar di kelas ini menurut data VClass.`);

  const matched = findItemByText(items, questionText);

  // 1 item ATAU nama cocok jelas → jawab langsung dari sistem.
  if (matched || items.length === 1) {
    const item = matched || items[0];
    const text = isQuiz ? buildQuizInfoText(item, studentName) : buildAssignmentInfoText(item, studentName);
    let baseUrl = '';
    try { const cfg = await moodleConfigModel.findByProjectId(projectId); baseUrl = String(cfg?.rest_endpoint || '').replace(/\/webservice\/.*$/, ''); } catch (_) {}
    const cmid = isQuiz ? item.coursemodule : item.cmid;
    const actions = [];
    if (baseUrl && cmid) actions.push({ type: 'open_url', label: 'Lihat di VClass', url: `${baseUrl}/mod/${isQuiz ? 'quiz' : 'assign'}/view.php?id=${cmid}` });
    actions.push({
      type: 'pick_intent',
      label: isQuiz ? 'Cek kuis ini sudah dikerjakan?' : 'Cek tugas ini sudah dikumpulkan?',
      intent: isQuiz ? 'cek_quiz_belum_dikerjakan' : 'cek_tugas_belum_selesai',
      prompt: isQuiz ? 'Kuis apa yang belum saya kerjakan?' : 'Tugas apa yang belum saya selesaikan?'
    });
    await chatModel.createMessage({ session_id: sessionId, role: 'user', message: questionText, intent: detailIntent });
    await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: detailIntent, context_used: { response_source: 'system', actions, used_model: 'lms_item_detail' } });
    return wrap(text, actions);
  }

  // Ambigu → tampilkan LIST untuk dipilih (tombol pick_intent → kirim ulang nama item).
  const actions = items.slice(0, 8).map((it) => ({ type: 'pick_intent', label: it.name || `(${label})`, intent: detailIntent, prompt: it.name || '' }));
  const text = `${isQuiz ? 'Kuis' : 'Tugas'} yang mana yang kamu maksud? Pilih salah satu di bawah ini ya:`;
  await chatModel.createMessage({ session_id: sessionId, role: 'user', message: questionText, intent: detailIntent });
  await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: detailIntent, context_used: { response_source: 'system', actions, used_model: 'lms_item_disambiguation' } });
  return wrap(text, actions);
}

// FUNGSI UTAMA

const chatService = {
  // [v0.9.19] Dipakai endpoint Komplain Kuis (preview soal + analisis sengketa langsung).
  listStudentQuizQuestions,
  analyzeQuizDisputeDirect,

  async processMessage({ sessionId, projectId, message, pageContext, elementContext, expectedSourceType, forceAI = false, forceFAQ = false, responseMode = 'default', intent = null, mention = null, freshMention = false }) {
    const session = await chatModel.getSessionById(sessionId);
    let pageContextState = safeParseObject(session.page_context, {});

    const sessionPageContext = safeParseObject(session.page_context, {});
    const sessionCourseContext = safeParseObject(session.course_context, {});
    const sessionMeta = sessionPageContext.session_meta || {};

    const classCode = lmsContextService.getClassCodeFromSession
      ? lmsContextService.getClassCodeFromSession(session)
      : getClassCodeFromSession(session);

    // [FIX] Nama sapaan utamakan identitas TERSIMPAN di sesi (terverifikasi) daripada
    // display_name dari pageContext request — pageContext bisa stale/berisi nama akun VClass
    // (mis. "Siswa Dummy 1") padahal sesi sudah terverifikasi sebagai siswa lain (Kanaya).
    // Placeholder "Pengunjung #XXX" tetap boleh ditimpa nama dari request (kasus anonim→verifikasi).
    const storedStudentName = String(sessionMeta.display_name || session.student_alias || '').trim();
    const isPlaceholderName = /^pengunjung\s*#/i.test(storedStudentName);
    const studentName =
      (storedStudentName && !isPlaceholderName ? storedStudentName : '') ||
      pageContext?.session_meta?.display_name ||
      storedStudentName ||
      'teman';

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

    const studentEmail =
      sessionMeta.email ||
      pageContext?.session_meta?.email ||
      null;

    const moodleUserIdDom =
      sessionMeta.moodle_user_id ||
      pageContext?.session_meta?.moodle_user_id ||
      null;

    // [v0.9.22] userId Moodle OTORITATIF. id hasil scraping DOM widget bisa KELIRU
    // (mis. 773 padahal 772) → cek status tugas/forum/kuis ikut salah. Kalau ada email,
    // resolve userId dari enrolled users Moodle (cached). Fallback ke id DOM.
    let moodleUserId = moodleUserIdDom;
    if (studentEmail) {
      try {
        const rs = await moodleService.resolveStudentByEmail(projectId, studentEmail, fallbackCourseId ? { courseId: fallbackCourseId } : {});
        if (rs?.found && rs.moodle_user_id) moodleUserId = rs.moodle_user_id;
      } catch (e) { console.warn('[Chat] resolveStudentByEmail gagal:', e.message); }
    }
    if (String(moodleUserId) !== String(moodleUserIdDom)) {
      console.log('[Chat] userId override via email:', JSON.stringify({ dom: moodleUserIdDom, resolved: moodleUserId, email: studentEmail }));
    }

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

    // [v0.9.59] Sapaan murni ("halo"/"hai"/"tes") → jawab SISTEM, sapa balik (variatif),
    // jangan sampai jatuh ke kartu konfirmasi AI.
    if (!mention && !elementContext && detectGreetingOnly(effectiveMessage)) {
      const text = GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)];
      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'greeting' });
      await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: 'greeting', context_used: { response_source: 'system', actions: [], used_model: 'greeting' } });
      return {
        intent: 'greeting', response_source: 'system',
        ai_usage: aiRateLimitService.getStatus(sessionId),
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: { message: text, actions: [] }
      };
    }

    // [v0.9.59 #4] Pertanyaan DETAIL tugas/kuis → konfirmasi item (list) lalu jawab dari SISTEM.
    // Pick eksplisit datang sebagai intent detail_tugas/detail_kuis (dari tombol pilihan).
    if (!mention && !elementContext) {
      if (intent === 'detail_tugas' || intent === 'detail_kuis') {
        return await respondTugasKuisDetail({ sessionId, projectId, courseId: fallbackCourseId, itemType: intent === 'detail_kuis' ? 'quiz' : 'assignment', questionText: effectiveMessage, studentName, safetyState });
      }
      if (!forceAI) {
        const itemType = detectTugasKuisDetailQuestion(effectiveMessage);
        if (itemType) {
          return await respondTugasKuisDetail({ sessionId, projectId, courseId: fallbackCourseId, itemType, questionText: effectiveMessage, studentName, safetyState });
        }
      }
    }

    // [v0.9.24] DISAMBIGUASI: kalau pertanyaan AMBIGU (mis. "hari senin ngerjain apa aja"),
    // jangan paksa tebak intent — tawarkan maks 4 pilihan dulu. Saat siswa klik salah satu,
    // FE kirim ulang dengan INTENT EKSPLISIT → langsung ke handler yang benar.
    // Tidak dijalankan saat: user memaksa AI, intent sudah eksplisit (mis. dari tombol pilihan),
    // ada mention @, atau sedang memilih elemen.
    if (!forceAI && !intent && !mention && !elementContext) {
      const ambig = intentService.detectAmbiguousIntent(effectiveMessage);
      if (ambig) {
        const actions = (ambig.candidates || []).slice(0, 4).map((c) => ({
          type: 'pick_intent', label: c.label, intent: c.intent, prompt: c.prompt
        }));
        const msgText = `Hai **${studentName}**,\n\n${ambig.question}`;
        await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'disambiguasi' });
        await chatModel.createMessage({
          session_id: sessionId, role: 'assistant', message: msgText, intent: 'disambiguasi',
          context_used: { response_source: 'system', used_model: 'disambiguasi', actions }
        });
        return {
          intent: 'disambiguasi', response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          is_locked: safetyState.locked, warnings: safetyState.warnings,
          botMessage: { message: msgText, actions }
        };
      }
    }

    let detectedIntent = intent || await intentService.detect(effectiveMessage, elementContext, { allowAIIntent: !forceAI });

    const manualMappedIntent = !intent ? inferManualSidebarIntent(effectiveMessage) : '';
    if (!forceAI && manualMappedIntent) {
      detectedIntent = manualMappedIntent;
    }

    // Guard tambahan: jangan biarkan pertanyaan status LMS seperti
    // "Quiz apa yang belum saya kerjakan?" salah masuk ke tutorial "Cara mengerjakan kuis".
    // [v0.9.23] HORMATI intent eksplisit (mis. dari form Komplain) — jangan ditimpa.
    // Sebelumnya ini menimpa intent yang dikirim FE → komplain tugas malah jadi tabel kuis.
    const lmsStatusIntent = !intent ? inferLmsStatusIntentFromMessage(effectiveMessage) : '';
    if (!forceAI && lmsStatusIntent) {
      detectedIntent = lmsStatusIntent;
    }

    // [PATCH] Deteksi pembatasan kelas (Cross-Class Isolation).
    // Diletakkan setelah effectiveMessage, safetyState, dan detectedIntent siap
    // agar tidak terkena Temporal Dead Zone (ReferenceError).
    const userClassCode = classCode ? classCode.toUpperCase() : '';
    const requestedClassMatch = effectiveMessage.match(/\bkelas\s+([0-9]+[a-z]?)\b/i);

    if (requestedClassMatch && userClassCode) {
      const requestedClass = requestedClassMatch[1].toUpperCase();
      if (requestedClass !== userClassCode && !userClassCode.includes(requestedClass)) {
        return {
          intent: 'out_of_context',
          response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          is_locked: safetyState.locked,
          warnings: safetyState.warnings,
          botMessage: {
            message: `Maaf, kamu hanya dapat mengakses materi yang tersedia untuk kelasmu (Kelas ${userClassCode}).`,
            actions: []
          }
        };
      }
    }

    const textMaterialCheck = normalizeText(effectiveMessage);
    const isExplicitMaterialRequest = /\b(buka|lihat|cari|tampilkan)\s+(materi|modul|sumber)\b/i.test(textMaterialCheck);

    const manualMaterialRequest = isManualMaterialRequest(effectiveMessage) || isExplicitMaterialRequest;

    // [v0.9.9] Jangan override intent daftar_materi (list materi) jadi penjelasan_materi.
    // [v0.9.23] Juga HORMATI intent eksplisit (form Komplain kirim cek_status_tugas dll;
    // pesannya bisa memuat kata "materi" → jangan ditarik ke penjelasan_materi).
    if (!intent && detectedIntent !== 'daftar_materi' && (manualMaterialRequest || shouldBypassVisualGuideForManualMaterial(effectiveMessage, detectedIntent))) {
      detectedIntent = 'penjelasan_materi';
      expectedSourceType = 'document_chunk';
    }

    if (LMS_INTENTS.includes(detectedIntent)) {
      try {
        lmsContext = await lmsContextService.buildChatLmsContext({
          projectId, sessionId, classCode, studentName, moodleUserId, studentEmail,
          courseId: fallbackCourseId, enrolledCourses, pageActivities, intent: detectedIntent
        });
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
    // [v0.9.9] "Ada materi apa aja di kursus ini?" → tampilkan DAFTAR materi yang tersedia
    // (dari dokumen yang sudah disinkron admin), bukan jalur penjelasan konsep yang sering gagal.
    // [v0.9.17] Komplain samar lewat chat ("aku mau komplain / ini gak adil"): JANGAN
    // dijawab bebas (mudah salah rute), tapi arahkan ke TEMPLATE komplain terpandu.
    // Tombol open_complaint akan membuka modal komplain di FE → submit di sana langsung
    // memicu algoritma yang tepat (sengketa kuis / status tugas / status forum).
    if (detectedIntent === 'komplain') {
      const komplainMsg = `Hai **${studentName}**,\n\nKamu mau menyampaikan komplain ya? Biar lebih jelas dan langsung diproses dengan benar, yuk pakai **form komplain terpandu** — kamu tinggal pilih jenisnya (Tugas/Kuis/Materi/Forum), nama bagiannya, lalu alasannya.\n\nKlik tombol di bawah ini ya 👇`;
      const komplainActions = [{ type: 'open_complaint', label: '📝 Buka Form Komplain' }];

      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'komplain' });
      await chatModel.createMessage({
        session_id: sessionId, role: 'assistant', message: komplainMsg, intent: 'komplain',
        context_used: { response_source: 'system', used_model: 'komplain', actions: komplainActions }
      });

      return {
        intent: 'komplain', response_source: 'system', ai_usage: aiRateLimitService.getStatus(sessionId),
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: { message: komplainMsg, actions: komplainActions }
      };
    }

    if (detectedIntent === 'daftar_materi') {
      let materiList = [];
      try {
        const docs = await documentModel.findByProjectId(projectId);
        materiList = (docs || []).filter((d) => d && (d.title || d.topic));
      } catch (e) { console.warn('[Chat] Gagal ambil daftar materi:', e.message); }

      let daftarMsg;
      if (!materiList.length) {
        daftarMsg = `Hai **${studentName}**,\n\nSepertinya belum ada materi yang tersedia untuk kursus ini. Coba tanyakan ke gurumu ya. 🙏`;
      } else {
        const lines = materiList.slice(0, 30).map((d, i) => {
          const title = String(d.title || d.topic || `Materi ${i + 1}`).trim();
          const topic = (d.topic && String(d.topic).trim() && String(d.topic).trim() !== title) ? ` — _${String(d.topic).trim()}_` : '';
          return `${i + 1}. **${title}**${topic}`;
        }).join('\n');
        daftarMsg = `Hai **${studentName}**,\n\nIni daftar materi yang ada di kursus ini:\n\n${lines}\n\nKamu bisa ketik **@** di kolom chat lalu pilih materinya untuk minta rangkuman, poin penting, atau soal latihan. 😊`;
      }

      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'daftar_materi' });
      await chatModel.createMessage({
        session_id: sessionId, role: 'assistant', message: daftarMsg, intent: 'daftar_materi',
        context_used: { response_source: 'system', used_model: 'daftar_materi', actions: [] }
      });

      return {
        intent: 'daftar_materi', response_source: 'system', ai_usage: aiRateLimitService.getStatus(sessionId),
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: { message: daftarMsg, actions: [] }
      };
    }

    // [v0.9.14] Sengketa jawaban kuis: siswa merasa kunci/jawaban kuis salah padahal
    // menurut materi benar. Catatan: WS yang diizinkan TIDAK mengekspos kunci jawaban
    // per-soal (perlu mod_quiz_get_attempt_review), jadi sistem TIDAK mengklaim benar/salah.
    // Yang dilakukan: identifikasi kuis (best-effort via Moodle), arahkan cek materi,
    // lalu siapkan pelaporan ke guru dengan template.
    if (detectedIntent === 'sengketa_jawaban') {
      const quizNumMatch = effectiveMessage.match(/\b(?:kuis|quis|quiz)\s*(\d{1,2})\b/i);
      const qNumMatch = effectiveMessage.match(/\b(?:no(?:mor|mer)?|soal)\s*(\d{1,2})\b/i);
      const quizNum = quizNumMatch ? quizNumMatch[1] : '';
      const qNum = qNumMatch ? qNumMatch[1] : '';
      const sm = pageContextState?.session_meta || {};
      const courseId = fallbackCourseId || sm.course_id || session?.course_context?.course_id || null;
      const userId = moodleUserId || sm.moodle_user_id || null;

      // Coba alur PENUH: ambil soal+jawaban siswa dari Moodle → bandingkan materi → AI simpulkan.
      let dispute = null;
      try {
        dispute = await analyzeQuizDispute({ projectId, courseId, userId, quizNum, qNum, studentName });
      } catch (e) { console.warn('[Sengketa] analyze gagal:', e.message); }

      let msgText;
      let disputeActions = [];

      if (dispute?.message) {
        // Sukses cek otomatis (butuh mod_quiz_get_attempt_review aktif).
        msgText = addStudentGreeting(dispute.message, studentName);
        const waText = encodeURIComponent(`Halo Pak/Bu, saya ${studentName}. Saya ingin menanyakan penilaian "${dispute.quizName}" nomor ${qNum}. [tulis keberatanmu di sini]. Terima kasih.`);
        if (dispute.reviewHtml) {
          // [v0.9.16] Bukti visual: tombol untuk membuka review jawaban asli dari Moodle.
          disputeActions.push({ type: 'open_html_view', label: 'Lihat Review Jawaban', html: dispute.reviewHtml, title: `Review ${dispute.quizName} nomor ${qNum}` });
        }
        disputeActions.push({ type: 'wa_teacher', label: 'Masih ragu? Tanya Guru', url: `https://api.whatsapp.com/send/?phone=628989807094&text=${waText}` });
      } else if (dispute?.notAttempted) {
        msgText = `Hai **${studentName}**,\n\nAku cek di sistem, sepertinya kamu **belum menyelesaikan ${dispute.quizName}** ini. Jadi belum ada lembar jawaban yang bisa aku periksa. Kalau sudah mengerjakan tapi ini muncul, coba refresh atau tanyakan ke gurumu ya. 🙏`;
      } else {
        // Fallback: tak bisa cek otomatis (data user/course kurang, WS review belum diizinkan,
        // atau AI tak tersedia) → akui jujur + arahkan materi + lapor guru bertemplate.
        const quizLabel = dispute?.quizName || (quizNum ? `Kuis ${quizNum}` : 'kuis tersebut');
        const waText = encodeURIComponent(
          `Halo Pak/Bu, saya ${studentName}. Saya merasa jawaban pada "${quizLabel}"${qNum ? ` nomor ${qNum}` : ''} kurang tepat. ` +
          `Menurut materi yang saya pelajari, jawaban yang benar seharusnya: [tulis jawabanmu di sini]. Mohon dicek kembali ya. Terima kasih.`
        );
        disputeActions = [{ type: 'wa_teacher', label: 'Laporkan ke Guru (via WA)', url: `https://api.whatsapp.com/send/?phone=628989807094&text=${waText}` }];
        msgText =
          `Hai **${studentName}**,\n\n` +
          `Untuk **${quizLabel}${qNum ? ` nomor ${qNum}` : ''}** ini, aku **belum bisa membuka lembar jawabanmu secara otomatis** (akses ke detail kuis belum tersedia). Jadi aku belum bisa memastikan benar/salahnya.\n\n` +
          `Yang bisa kamu lakukan:\n` +
          `1. **Cek ulang materinya** — ketik **@** lalu pilih materi terkait, tanyakan bagian yang kamu maksud. Aku bantu carikan kutipannya.\n` +
          `2. Kalau kamu **tetap yakin** jawabanmu benar, **laporkan ke guru** lewat tombol di bawah (pesannya sudah aku siapkan).`;
      }

      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'sengketa_jawaban' });
      await chatModel.createMessage({
        session_id: sessionId, role: 'assistant', message: msgText, intent: 'sengketa_jawaban',
        context_used: { response_source: dispute?.message ? 'ai' : 'system', used_model: 'sengketa_jawaban', actions: disputeActions }
      });
      return {
        intent: 'sengketa_jawaban', response_source: dispute?.message ? 'ai' : 'system', ai_usage: aiRateLimitService.getStatus(sessionId),
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: { message: msgText, actions: disputeActions }
      };
    }

    // [v0.9.15] KASUS 1: "udah upload tugas tapi masih dibilang belum ngumpul" → cek status.
    if (detectedIntent === 'cek_status_tugas') {
      const sm = pageContextState?.session_meta || {};
      const courseId = fallbackCourseId || sm.course_id || session?.course_context?.course_id || null;
      const userId = moodleUserId || sm.moodle_user_id || null;
      let r = null;
      try { r = await getAssignmentSubmissionForMessage({ projectId, courseId, userId, message: effectiveMessage }); } catch (e) { console.warn('[Kasus1]', e.message); }

      let msgText;
      if (r && r.status && !r.unavailable) {
        const nm = r.name || 'tugas itu';
        if (r.status === 'submitted') {
          msgText = `Hai **${studentName}**,\n\nKabar baik — tugas **${nm}** kamu **sudah berhasil terkirim** (status: *Submitted*) 🎉. Tinggal tunggu dinilai gurumu ya.`;
        } else if (r.status === 'draft') {
          msgText = `Hai **${studentName}**,\n\nAku cek tugas **${nm}**: file kamu **sudah ter-upload**, TAPI statusnya masih **Draft**. Artinya kamu belum menekan tombol **"Kirim Pengajuan / Submit"** di halaman akhirnya.\n\n👉 Yuk buka lagi tugasnya, lalu klik **Kirim** supaya bisa dinilai gurumu.`;
        } else {
          msgText = `Hai **${studentName}**,\n\nAku cek tugas **${nm}**, sepertinya **belum ada file yang terunggah** (status: belum mengumpulkan). Coba upload dulu filenya lalu klik **Kirim** ya.`;
        }
      } else {
        msgText = `Hai **${studentName}**,\n\nAku belum bisa membaca status tugas itu otomatis (mungkin nama tugasnya kurang cocok, atau datanya belum tersedia). Coba sebutkan **nama tugasnya lebih persis**, atau buka langsung tugas itu di VClass untuk cek statusnya ya. 🙏`;
      }

      const tugasActions = (r && r.url) ? [{ type: 'open_url', label: '🔗 Buka tugas di VClass', url: r.url, pageType: 'tugas' }] : [];
      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'cek_status_tugas' });
      await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: msgText, intent: 'cek_status_tugas', context_used: { response_source: 'system', used_model: 'cek_status_tugas', actions: tugasActions } });
      return { intent: 'cek_status_tugas', response_source: 'system', ai_usage: aiRateLimitService.getStatus(sessionId), is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: msgText, actions: tugasActions } };
    }

    // [v0.9.15] KASUS 2: "udah komen forum kok belum centang hijau" → cek aturan completion.
    if (detectedIntent === 'cek_status_completion') {
      const sm = pageContextState?.session_meta || {};
      const courseId = fallbackCourseId || sm.course_id || session?.course_context?.course_id || null;
      const userId = moodleUserId || sm.moodle_user_id || null;
      let r = null;
      try { r = await getActivityCompletionForMessage({ projectId, courseId, userId, message: effectiveMessage }); } catch (e) { console.warn('[Kasus2]', e.message); }

      let msgText;
      if (r) {
        const nm = r.name || 'aktivitas itu';
        if (r.state >= 1) {
          msgText = `Hai **${studentName}**,\n\nAku cek, **${nm}** sebenarnya **sudah tercatat selesai** ✅ di sistem. Kalau centangnya belum kelihatan, coba **refresh halamannya** ya.`;
        } else if (r.unmet && r.unmet.length) {
          const list = r.unmet.map((u) => `• ${u}`).join('\n');
          msgText = `Hai **${studentName}**,\n\nAku sudah cek log aktivitasmu untuk **${nm}**. Centang hijaunya belum muncul karena **syarat penyelesaian belum terpenuhi**:\n\n${list}\n\nYuk lengkapi syarat di atas dulu, nanti centangnya muncul otomatis. 💪`;
        } else {
          msgText = `Hai **${studentName}**,\n\nAku cek, **${nm}** **belum tercatat selesai** di sistem. Pastikan kamu sudah memenuhi semua syaratnya (mis. jumlah balasan/komentar minimal), lalu cek lagi ya.`;
        }
      } else {
        msgText = `Hai **${studentName}**,\n\nAku belum bisa membaca status penyelesaian aktivitas itu otomatis. Coba sebutkan **nama aktivitas/forumnya lebih persis**, atau buka aktivitas itu di VClass untuk lihat syaratnya ya. 🙏`;
      }

      const forumActions = (r && r.url) ? [{ type: 'open_url', label: '🔗 Buka aktivitas di VClass', url: r.url, pageType: 'forum' }] : [];
      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'cek_status_completion' });
      await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: msgText, intent: 'cek_status_completion', context_used: { response_source: 'system', used_model: 'cek_status_completion', actions: forumActions } });
      return { intent: 'cek_status_completion', response_source: 'system', ai_usage: aiRateLimitService.getStatus(sessionId), is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: msgText, actions: forumActions } };
    }

    // [v0.9.15] KASUS 3: "jawaban tugas X dibilang OOT, salahnya di mana" → ambil teks jawaban + bandingkan materi (AI).
    if (detectedIntent === 'evaluasi_jawaban_tugas') {
      const sm = pageContextState?.session_meta || {};
      const courseId = fallbackCourseId || sm.course_id || session?.course_context?.course_id || null;
      const userId = moodleUserId || sm.moodle_user_id || null;
      let r = null;
      try { r = await getAssignmentSubmissionForMessage({ projectId, courseId, userId, message: effectiveMessage }); } catch (e) { console.warn('[Kasus3]', e.message); }

      let msgText;
      let evalSource = 'system';
      const aiAvail = !(aiUsage.cooldown_active || aiUsage.limit_reached || aiUsage.canUseAI === false);

      if (r && r.onlineText && aiAvail) {
        let materiText = '';
        try {
          const hits = await retrievalService.retrieve(projectId, r.onlineText.slice(0, 200), {}, 3, { sourceType: 'document_chunk' });
          materiText = (hits || []).map((h) => h.content || h.chunk_text).filter(Boolean).join('\n\n').slice(0, 3000);
        } catch (_) {}
        const prompt = `Kamu AI Learning Buddy untuk siswa SMP, bahasa Indonesia ramah & membangun.
Tugas siswa "${r.name}" dinilai kurang tepat/OOT. EVALUASI berdasarkan MATERI, jangan menebak.

JAWABAN SISWA:
${r.onlineText.slice(0, 1500)}

MATERI TERKAIT (basis pengetahuan):
${materiText || '(materi terkait tidak ditemukan)'}

Buat balasan singkat: ajak evaluasi bareng, tunjukkan letak konsep yang melenceng dgn membandingkan jawaban siswa vs materi (KUTIP materi, bungkus **tebal**), lalu beri arahan perbaikan yang ramah. Kalau ternyata jawaban siswa sebenarnya sudah sesuai materi, katakan begitu & sarankan konfirmasi ke guru.`;
        try {
          const g = await aiQueueService.add(() => geminiService.generateWithFallback(prompt), { intent: 'evaluasi_jawaban_tugas', responseMode: 'detail' });
          if (g.ok) { msgText = addStudentGreeting(g.text, studentName); evalSource = 'ai'; aiUsage = aiRateLimitService.consume(sessionId); }
        } catch (e) { console.warn('[Kasus3] AI:', e.message); }
      }

      if (!msgText) {
        const nm = r?.name || 'tugas itu';
        msgText = `Hai **${studentName}**,\n\nUntuk **${nm}**, aku belum bisa membaca teks jawabanmu otomatis (atau AI sedang sibuk). Tapi kamu bisa **cek sendiri**: ketik **@** lalu pilih materi terkait, lalu bandingkan apakah konsep di jawabanmu sudah sesuai materi. Kalau masih bingung, tanyakan ke gurumu ya. 🙏`;
      }

      const evalActions = (r && r.url) ? [{ type: 'open_url', label: '🔗 Buka tugas di VClass', url: r.url, pageType: 'tugas' }] : [];
      await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: 'evaluasi_jawaban_tugas' });
      await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: msgText, intent: 'evaluasi_jawaban_tugas', context_used: { response_source: evalSource, used_model: 'evaluasi_jawaban_tugas', actions: evalActions } });
      return { intent: 'evaluasi_jawaban_tugas', response_source: evalSource, ai_usage: aiUsage, is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: msgText, actions: evalActions } };
    }

    // [v0.9.8] Jika ada mention @materi, JANGAN ambil jalur tutorial statis —
    // walau intent terdeteksi "kuis/tugas" (mis. "buat 3 soal"), permintaan @materi
    // harus diproses oleh handler mention (cache-first → AI dari isi materi).
    const hasMateriMention = mention?.type === 'materi' && (mention.documentId || mention.title || mention.sourceUrl || mention.url || mention.label);
    const staticTutorialKey = resolveStaticTutorialKey(detectedIntent, effectiveMessage);
    if (staticTutorialKey && !hasMateriMention) {
      // [v0.9.9] Kalau user menyebut tugas/aktivitas spesifik & ada instruksinya di KB,
      // sisipkan info tugas itu (instruksi+tenggat) SEBELUM tutorial visual.
      let activityInfo = '';
      if (['bantuan_tugas', 'bantuan_kumpul_tugas', 'bantuan_kuis', 'bantuan_quiz', 'bantuan_forum'].includes(detectedIntent)) {
        try {
          const acts = await activityModel.findByProjectId(projectId);
          const matched = findMatchingActivity(acts, effectiveMessage);
          if (matched) activityInfo = buildActivityInfoText(matched);
        } catch (e) { console.warn('[Chat] Gagal cek instruksi aktivitas spesifik:', e.message); }
      }

      // [v0.9.52] MODE AI untuk intent panduan (mis. "cara login" saat siswa pilih AI):
      // beri langkah-langkah dalam TEKS dulu, lalu tombol "Lihat Panduan Bergambar".
      // Grounding pakai pertanyaan asli; kalau kuota AI habis → fallback teks FAQ deterministik.
      // (Mode Sistem tetap: tampilkan carousel panduan langsung — lihat di bawah.)
      if (forceAI) {
        const tut = STATIC_TUTORIALS[staticTutorialKey];
        if (tut) {
          const guideUsage = aiRateLimitService.consume(sessionId);
          const prompt = buildAiFollowupPromptForTutorial(tut, effectiveMessage);
          let stepsText = '';
          let usedModel = 'guidance_ai';
          let source = 'ai';
          try {
            const g = await aiQueueService.add(
              () => geminiService.generateWithFallback(prompt),
              { sessionId, intent: detectedIntent, responseMode }
            );
            if (g?.ok && g.text) { stepsText = g.text; usedModel = g.model || 'guidance_ai'; }
          } catch (e) { console.warn('[Guidance AI] gagal:', e.message); }

          if (!stepsText) {
            const faq = QUICK_GUIDE_FAQ_MAP[detectedIntent];
            stepsText = (faq && faq.fallbackMessage) || tut.intro || 'Berikut langkah-langkah singkatnya.';
            usedModel = 'guidance_faq_fallback';
            source = 'system';
          }

          const bodyText = activityInfo ? `${activityInfo}\n\n———\n\n${stepsText}` : stepsText;
          const finalMsg = addStudentGreeting(bodyText, studentName);
          const guideActions = [
            {
              type: 'static_tutorial_carousel',
              label: `Lihat Panduan Bergambar: ${tut.shortTitle || tut.title}`,
              payload: cloneStaticTutorial(tut)
            },
            ...(tut.video ? [{ type: 'video_tutorial', label: `Tonton Video: ${tut.shortTitle || tut.title}`, url: tut.video, title: tut.title }] : []),
            { type: 'system_feedback_ok', label: 'Sudah jelas' }
          ];

          await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: detectedIntent });
          await chatModel.createMessage({
            session_id: sessionId, role: 'assistant', message: finalMsg, intent: detectedIntent,
            context_used: { response_source: source, actions: guideActions, used_model: usedModel, static_tutorial_key: staticTutorialKey }
          });

          return {
            intent: detectedIntent, response_source: source, ai_usage: guideUsage,
            is_locked: safetyState.locked, warnings: safetyState.warnings,
            botMessage: { message: finalMsg, actions: guideActions }
          };
        }
      }

      const staticGuide = buildStaticTutorialChatResponse({
        studentName,
        tutorialKey: staticTutorialKey,
        effectiveMessage,
        activityInfo
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
      return { intent: detectedIntent, response_source: 'system', botMessage: { message: 'Bahasa tidak pantas terdeteksi.', actions: [] }, is_locked: safetyState.locked, warnings: safetyState.warnings, ai_usage: aiRateLimitService.getStatus(sessionId) };
    }

    await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: detectedIntent });
    let aiUsage = aiRateLimitService.getStatus(sessionId);

    // ==========================================
    // [v0.7.0] MENTION @materi-N: pencarian TERTARGET di satu dokumen materi.
    // Prioritas tinggi — diletakkan sebelum acronym/visual guide.
    // ==========================================
    if (mention?.type === 'materi' && (mention.documentId || mention.title || mention.sourceUrl || mention.url || mention.label)) {
      const cleanQ = stripMentionTokens(effectiveMessage) || effectiveMessage;
      const keywords = extractQueryKeywords(cleanQ);
      const label = mention.label || mention.title || 'materi yang dipilih';

      // [v0.9.0] Deteksi maksud "rangkum/ringkas" — ini jalur yang dulu selalu gagal
      // karena retrieval berbasis skor keyword (skor "rangkum materi ini" = 0).
      const wantsSummary = /\b(rangkum|ringkas|ringkasan|rangkuman|resume|kesimpulan|simpulkan|inti|poin penting|garis besar|jelaskan keseluruhan|jelaskan semua)\b/i.test(effectiveMessage);

      // 1) Ambil isi dokumen target LANGSUNG via document_id (tidak bergantung skor).
      //    Inilah sumber kebenaran untuk rangkuman & jawaban AI atas materi tsb.
      let resolvedDocumentId = mention.documentId || null;
      let targetChunks = [];
      if (resolvedDocumentId) {
        try { targetChunks = await chunkModel.findByDocumentId(resolvedDocumentId); }
        catch (e) { console.error('[Mention] ambil chunk dokumen gagal:', e.message); }
      }

      // [#4] Fallback: @materi kadang tak membawa document_id (pencocokan url/judul gagal
      // saat daftar dibangun). Coba resolusi dokumen via url/judul lalu ambil chunk-nya,
      // supaya pertanyaan "tentang apa materi ini" tetap bisa dijawab, bukan "tidak ditemukan".
      if (!targetChunks.length) {
        try {
          const mUrl = String(mention.sourceUrl || mention.url || '').trim();
          const mTitle = String(mention.title || mention.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (mUrl || mTitle) {
            const allDocs = (await documentModel.findByProjectId(projectId)) || [];
            const docMatch = allDocs.find((d) => {
              if (mUrl && String(d.source_url || '').trim() === mUrl) return true;
              const dt = String(d.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
              return mTitle && dt && (dt === mTitle || dt.includes(mTitle) || mTitle.includes(dt));
            });
            if (docMatch?.id) {
              resolvedDocumentId = docMatch.id;
              targetChunks = await chunkModel.findByDocumentId(docMatch.id);
            }
          }
        } catch (e) { console.warn('[Mention] fallback resolusi dokumen gagal:', e.message); }
      }

      // 2) Retrieval tetap dipakai untuk jalur tanya-jawab spesifik (snippet + highlight).
      //    Sertakan label agar dokumen target lebih mudah naik peringkat.
      let mentionResults = [];
      try {
        mentionResults = await retrievalService.retrieve(projectId, `${label} ${cleanQ}`.trim(), pageContext, 12, { sourceType: 'document_chunk', courseId: fallbackCourseId });
      } catch (e) { console.error('[Mention] retrieve gagal:', e.message); }

      // Cocokkan dokumen target via document_id (paling akurat) ATAU source_url / judul.
      const targetId = resolvedDocumentId ? String(resolvedDocumentId) : '';
      const targetUrl = String(mention.sourceUrl || mention.url || '').trim();
      const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const targetTitle = normTitle(mention.title || mention.label);
      const matchesTarget = (r) => {
        const m = r.metadata || {};
        if (targetId && String(m.document_id) === targetId) return true;
        if (targetUrl && (m.source_url === targetUrl || m.url === targetUrl || m.file_url === targetUrl)) return true;
        if (targetTitle) {
          const t = normTitle([m.title, m.module_name, r.title].filter(Boolean).join(' '));
          if (t && (t.includes(targetTitle) || targetTitle.includes(t))) return true;
        }
        return false;
      };
      const inTarget = mentionResults.filter(matchesTarget);
      const elsewhere = mentionResults.filter((r) => !matchesTarget(r));

      const targetHit = inTarget.find((r) => Number(r.score || 0) >= 10) || null;
      const elsewhereHits = elsewhere.filter((r) => Number(r.score || 0) >= 12).slice(0, 3);

      // Gabungan isi materi untuk diberikan ke AI (utamakan chunk target langsung).
      const materiContent = (targetChunks.length
        ? targetChunks.slice().sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0)).map((c) => c.chunk_text)
        : inTarget.map((r) => r.content || r.chunk_text)
      ).filter(Boolean).join('\n\n').slice(0, 8000);

      const aiAvailable = !(aiUsage.cooldown_active || aiUsage.limit_reached || aiUsage.canUseAI === false);
      // [v0.9.3] Tiap saran lanjutan @materi punya "task" sendiri (rangkum/poin/jelaskan/soal).
      const mentionTask = detectMentionTask(effectiveMessage);
      // [v0.9.9] Inti @materi: kalau ada PERTANYAAN nyata (mis. "@materi-1 apa itu cms"),
      // selalu jawab via AI dari isi materi — walau mode default. Cache-first jaga kuota.
      const hasRealQuestion = String(cleanQ || '').replace(/\s+/g, '').length >= 4;
      const wantsAiKind = Boolean(mentionTask) || forceAI || hasRealQuestion;

      // ====== [v0.9.42] KUIS INTERAKTIF ======
      // Minta jumlah dulu (maks 10) → generate JSON terstruktur → FE render kartu "Mulai
      // Latihan" + modal interaktif. Quiz TIDAK disimpan ke DB (action quiz tak dipersist).
      if (mentionTask === 'quiz' && materiContent) {
        const count = parseQuizCount(cleanQ);
        if (!count) {
          const actions = [3, 5, 10].map((n) => ({ type: 'quiz_setup', label: `${n} soal`, token: mention.token, count: n }));
          const text = `Mau berapa soal latihan dari **${label}**? (maksimal 10) Pilih di bawah ya 👇`;
          await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: 'penjelasan_materi', context_used: { response_source: 'system', actions, used_model: 'quiz_setup' } });
          return { intent: 'penjelasan_materi', response_source: 'system', ai_usage: aiUsage, is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: text, actions } };
        }
        const aiUp = !(aiUsage.cooldown_active || aiUsage.limit_reached || aiUsage.canUseAI === false);
        if (aiUp) {
          const questions = await generateQuizJSON(count, label, materiContent, sessionId, responseMode);
          if (questions && questions.length) {
            aiUsage = aiRateLimitService.consume(sessionId);
            const startAction = { type: 'start_quiz', label: 'Mulai Latihan', quiz: { title: label, token: mention.token, count: questions.length, questions } };
            const text = `Latihan kuis dari **${label}** sudah siap 📘 (${questions.length} soal).`;
            // ponytail: simpan PESAN tanpa action quiz (kuis ephemeral, tak masuk DB) — kartu
            // hidup hanya di sesi ini; reload = hilang (sesuai permintaan).
            await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: 'penjelasan_materi', context_used: { response_source: 'ai', actions: [], used_model: 'quiz_ai' } });
            return { intent: 'penjelasan_materi', response_source: 'ai', ai_usage: aiUsage, is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: text, actions: [startAction] } };
          }
        }
        // gagal generate / kuota habis → lanjut ke alur teks lama (fallback di bawah).
      }

      // ====== JALUR AI dengan CACHE-FIRST (rangkum/poin/jelaskan/soal/tanya) ======
      // Cache dulu: kalau sudah pernah dijawab → kembalikan tanpa kuota AI (berlaku walau habis).
      // Kalau belum → hit AI lalu SIMPAN ke cache.
      if (wantsAiKind && materiContent) {
        const docKey = String(resolvedDocumentId || targetUrl || label || '').toLowerCase().slice(0, 120);
        // [v0.9.36] Materi yang isinya tabel kisi-kisi → AI jelaskan MAKSUD tabel, bukan
        // merangkum topiknya jadi konsep. Cache di-pisah (':blueprint') agar tak memakai
        // jawaban lama yang salah (mis. rangkuman "Media Sosial" untuk tabel kisi-kisi).
        const isBlueprint = detectBlueprintTable(materiContent, label);
        const cacheCtxHash = `mention:${docKey}${isBlueprint ? ':blueprint' : ''}`;
        const normalizedQ = mentionTask ? `${mentionTask} materi ${docKey}` : aiResponseCacheModel.normalizeQuestion(cleanQ);
        const mentionCacheKey = aiResponseCacheModel.buildCacheKey(projectId, normalizedQ, cacheCtxHash);
        // [v0.9.8] Tombol "buat yang baru" per task — minta hasil berbeda dgn konteks sama.
        const REGEN = {
          summary: { label: 'Rangkum versi lain', prompt: 'Rangkum lagi materi ini dengan ringkasan yang berbeda' },
          keypoints: { label: 'Poin penting lainnya', prompt: 'Sebutkan poin penting lain dari materi ini' },
          simplify: { label: 'Jelaskan dengan cara lain', prompt: 'Jelaskan lagi materi ini dengan analogi/cara yang berbeda' },
          quiz: { label: 'Buat soal lain', prompt: 'Buat 3 soal latihan baru yang berbeda dari materi ini' }
        };
        const mentionActions = (highlightQuote = '') => {
          const base = buildSourceActionsFromRetrieval(targetHit ? [targetHit] : inTarget.slice(0, 1), cleanQ, highlightQuote);
          if (mentionTask && REGEN[mentionTask] && mention.token) {
            base.push({ type: 'mention_regenerate', label: REGEN[mentionTask].label, token: mention.token, prompt: REGEN[mentionTask].prompt });
          }
          return base;
        };

        // 1) CACHE-FIRST (dilewati saat user minta hasil baru / freshMention).
        try {
          const cached = freshMention ? null : await aiResponseCacheModel.findByKey(projectId, mentionCacheKey);
          if (cached?.answer) {
            aiResponseCacheModel.incrementHit(cached.id).catch(() => {});
            const cachedActions = mentionActions(extractBoldQuote(cached.answer));
            const cachedText = addStudentGreeting(cached.answer, studentName) + '\n\n📚 Diambil dari basis pengetahuan sistem (hemat kuota AI).';
            await chatModel.createMessage({
              session_id: sessionId, role: 'assistant', message: cachedText, intent: 'penjelasan_materi',
              context_used: { response_source: 'system', actions: cachedActions, used_model: 'cache', cache_hit: true, cache_id: cached.id, mention_task: mentionTask || 'qa' }
            });
            return {
              intent: 'penjelasan_materi', response_source: 'system', ai_usage: aiUsage, used_model: 'cache',
              is_locked: safetyState.locked, warnings: safetyState.warnings,
              botMessage: { message: cachedText, actions: cachedActions }
            };
          }
        } catch (e) { console.warn('[Mention Cache] baca gagal:', e.message); }

        // 2) Tidak ada di cache → hit AI bila tersedia, lalu SIMPAN.
        if (aiAvailable) {
          const aiPrompt = isBlueprint
            ? buildBlueprintTablePrompt(label, materiContent, cleanQ)
            : buildMentionTaskPrompt(mentionTask, label, materiContent, cleanQ);
          try {
            const geminiResult = await aiQueueService.add(() => geminiService.generateWithFallback(aiPrompt), { sessionId, intent: 'penjelasan_materi', responseMode });
            if (geminiResult.ok) {
              aiUsage = aiRateLimitService.consume(sessionId);
              aiResponseCacheModel.upsertCache({
                project_id: projectId, cache_key: mentionCacheKey,
                question: mentionTask ? `${mentionTask} ${label}` : cleanQ, normalized_question: normalizedQ,
                answer: geminiResult.text, response_source: 'ai', intent: 'penjelasan_materi',
                source_type: 'document_chunk', context_hash: cacheCtxHash, model: geminiResult.model, expires_at: getExpiresAt()
              }).catch((e) => console.warn('[Mention Cache] simpan gagal:', e.message));

              const finalText = addStudentGreeting(geminiResult.text, studentName);
              const aiActions = mentionActions(extractBoldQuote(geminiResult.text));
              await chatModel.createMessage({
                session_id: sessionId, role: 'assistant', message: finalText, intent: 'penjelasan_materi',
                context_used: { response_source: 'ai', actions: aiActions, used_model: geminiResult.model || 'mention_materi_ai', mention_task: mentionTask || 'qa' }
              });
              return {
                intent: 'penjelasan_materi', response_source: 'ai', ai_usage: aiUsage, used_model: geminiResult.model,
                is_locked: safetyState.locked, warnings: safetyState.warnings,
                botMessage: { message: finalText, actions: aiActions }
              };
            } else if (geminiResult.quotaFallback) {
              aiRateLimitService.markGlobalExhausted();
            }
          } catch (e) {
            console.error('[Mention AI] gagal, fallback ke sistem:', e.message);
          }
        }
      }

      // ====== JALUR SISTEM (deterministik) ======
      let mText = '';
      let mActions = [];

      if (wantsAiKind && materiContent) {
        // Minta jawaban AI tapi tak tersedia (cooldown/kuota) → beri cuplikan + arahkan.
        const preview = buildMentionSnippet(materiContent, keywords, 360);
        mText = `Ini cuplikan dari **${label}**:\n\n[ACCORDION=${label}]\n${preview}\n[/ACCORDION]\n\nUntuk jawaban AI penuh (rangkuman/penjelasan), kuota AI bersama sedang penuh — coba lagi nanti ya, atau baca cuplikan di atas dulu.`;
        mActions = buildSourceActionsFromRetrieval(targetHit ? [targetHit] : inTarget.slice(0, 1), cleanQ);
      } else if (targetHit) {
        const snippet = buildMentionSnippet(targetHit.content || targetHit.chunk_text, keywords);
        mText = `Aku menemukan bagian yang relevan di **${label}**:\n\n[ACCORDION=${targetHit.title || targetHit.topic || label}]\n${snippet}\n[/ACCORDION]\n\nKlik tombol di bawah untuk membuka materinya — bagian yang cocok akan disorot.`;
        mActions = buildSourceActionsFromRetrieval([targetHit], cleanQ);
      } else if (elsewhereHits.length) {
        const listText = elsewhereHits
          .map((h) => `[ACCORDION=${h.title || h.topic || 'Materi lain'}]\n${buildMentionSnippet(h.content || h.chunk_text, keywords)}\n[/ACCORDION]`)
          .join('\n');
        mText = `Di **${label}** aku belum menemukan jawaban yang pas. Tapi sepertinya pembahasannya ada di materi lain berikut — mau dibuka?\n\n${listText}`;
        mActions = buildSourceActionsFromRetrieval(elsewhereHits, cleanQ);
      } else if (materiContent) {
        // Ada isi materi tapi tak ada keyword cocok & bukan mode AI → tawarkan cuplikan + rangkuman.
        const preview = buildMentionSnippet(materiContent, keywords, 360);
        mText = `Ini cuplikan dari **${label}**:\n\n[ACCORDION=${label}]\n${preview}\n[/ACCORDION]\n\nMau aku **rangkum** materi ini? Ketik "rangkum materi ini", atau buka materinya lewat tombol di bawah.`;
        mActions = buildSourceActionsFromRetrieval(targetHit ? [targetHit] : inTarget.slice(0, 1), cleanQ);
      } else {
        mText = `Maaf, pertanyaan itu belum aku temukan di **${label}** maupun di materi lainnya. Coba pakai kata kunci yang lebih spesifik, atau tanyakan langsung tanpa mention ya. 🙏`;
      }

      await chatModel.createMessage({
        session_id: sessionId, role: 'assistant', message: addStudentGreeting(mText, studentName), intent: 'penjelasan_materi',
        context_used: { response_source: 'system', actions: mActions, used_model: 'mention_materi' }
      });
      return {
        intent: 'penjelasan_materi', response_source: 'system', ai_usage: aiUsage,
        is_locked: safetyState.locked, warnings: safetyState.warnings,
        botMessage: { message: addStudentGreeting(mText, studentName), actions: mActions }
      };
    }

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
            label: 'Tanya AI',
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

    const acronymInfo = detectAcronymExpansionQuestion(effectiveMessage);
    if (acronymInfo.isAcronym) {
      const retrievalQuery = canonicalizeRetrievalQuery(effectiveMessage);
      const acronymRetrievalResults = await retrievalService.retrieve(projectId, retrievalQuery, pageContext, 3, { sourceType: expectedSourceType || 'document_chunk' });
      const sourceActions = buildSourceActionsFromRetrieval(acronymRetrievalResults, retrievalQuery);
      const acronymText = buildAcronymLearningResponse({ message: effectiveMessage, retrievalResults: acronymRetrievalResults });
      const responseSourceForAcronym = forceAI ? 'ai' : 'system';

      await chatModel.createMessage({
        session_id: sessionId,
        role: 'assistant',
        message: addStudentGreeting(acronymText, studentName),
        intent: detectedIntent || 'penjelasan_materi',
        context_used: { response_source: responseSourceForAcronym, actions: sourceActions, used_model: 'system_acronym_learning_guard' }
      });

      return {
        intent: detectedIntent || 'penjelasan_materi',
        response_source: responseSourceForAcronym,
        ai_usage: aiUsage,
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        botMessage: { message: addStudentGreeting(acronymText, studentName), actions: sourceActions }
      };
    }

    // ==========================================
    // PERTANYAAN UMUM AMAN (waktu / aritmatika) — dijawab SISTEM, bukan AI.
    // Mencegah "1 + 1" salah dideteksi sebagai pertanyaan materi informatika.
    // ==========================================
    const generalSafe = detectGeneralSafeQuestion(effectiveMessage);
    if (!forceAI && generalSafe.type && !LMS_INTENTS.includes(detectedIntent) && !manualMaterialRequest) {
      const generalText = generalSafe.type === 'datetime' ? buildDateTimeAnswer() : buildMathAnswer(generalSafe);
      const generalIntent = generalSafe.type === 'datetime' ? detectedIntent : 'out_of_context';

      await chatModel.createMessage({
        session_id: sessionId,
        role: 'assistant',
        message: addStudentGreeting(generalText, studentName),
        intent: generalIntent,
        context_used: { response_source: 'system', actions: [], used_model: 'system_general_safe' }
      });

      return {
        intent: generalIntent,
        response_source: 'system',
        ai_usage: aiUsage,
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        botMessage: { message: addStudentGreeting(generalText, studentName), actions: [] }
      };
    }

    let retrievalResults = [];
    let contextString = '';
    const skipRetrievalIntents = ['bantuan_burnout', 'out_of_context', 'greeting', 'hubungi_guru'];
    const storedMaterialQuery = getStoredMaterialQuery(pageContextState, sessionMeta);
    const retrievalQuery = canonicalizeRetrievalQuery(effectiveMessage, storedMaterialQuery);
    const shouldForceMaterialRetrieval = detectedIntent === 'penjelasan_materi' || manualMaterialRequest;
    const shouldSkipRetrieval =
      skipRetrievalIntents.includes(detectedIntent) ||
      LMS_INTENTS.includes(detectedIntent) ||
      (isQuickVisualGuideIntent(detectedIntent) && !shouldForceMaterialRetrieval);

    if (!shouldSkipRetrieval) {
      const retrievalSourceType = shouldForceMaterialRetrieval ? 'document_chunk' : (expectedSourceType || 'all');
      retrievalResults = await retrievalService.retrieve(projectId, retrievalQuery, pageContext, 4, { sourceType: retrievalSourceType, courseId: fallbackCourseId });
      contextString = contextBuilderService.build(retrievalResults);
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
    // Tampilkan ringkasan referensi + tombol Lihat materi. Kalau tidak ada, beri arahan yang jelas.
    if (responseMode === 'system' && !forceAI && shouldForceMaterialRetrieval && !LMS_INTENTS.includes(detectedIntent)) {
      // Tak ada materi cocok → jangan diam-diam pakai AI: minta konfirmasi dulu.
      if (retrievalResults.length === 0) {
        return await buildAiConfirmOrExhausted({ sessionId, effectiveMessage, detectedIntent, responseMode, studentName, aiUsage, safetyState });
      }

      const sourceActions = buildSourceActionsFromRetrieval(retrievalResults, retrievalQuery);
      let systemText = '';

      if (retrievalResults.length > 0) {
        const first = retrievalResults[0] || {};
        const previewText = String(first.content || first.chunk_text || '').replace(/\s+/g, ' ').trim();
        const guardedText = looksLikeMultipleChoiceQuestion(effectiveMessage)
          ? 'Aku tidak akan langsung memilihkan jawaban A/B/C/D. Aku bantu kamu memahami konsepnya dulu dari sumber materi berikut.'
          : 'Pertanyaan kamu lebih mengarah ke **materi/pelajaran**. Aku menemukan sumber materi yang berkaitan. Baca ringkasannya, lalu klik tombol **Lihat materi** untuk membuka sumbernya.';

        systemText = `${guardedText}

[ACCORDION=${first.title || first.topic || 'Materi terkait'}]
${previewText || 'Materi terkait ditemukan di dokumen sumber.'}
[/ACCORDION]`;

        await chatModel.updateSession(sessionId, {
          page_context: {
            ...pageContextState,
            last_material_query: retrievalQuery,
            last_material_title: first.title || first.topic || ''
          }
        }).catch(() => {});
      }

      // sys#6: tawarkan penjelasan AI dengan membawa pertanyaan ASLI user.
      sourceActions.push({
        type: 'ask_ai',
        label: 'Belum paham? Minta AI menjelaskan',
        payload: {
          original_message: effectiveMessage,
          message: effectiveMessage,
          source_answer: String(systemText).replace(/\[\/?ACCORDION[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
          intent: detectedIntent,
          responseMode: 'short',
          forceAI: true,
          expectedSourceType: 'document_chunk'
        }
      });

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
    // CACHE-FIRST (v0.5.0): pertanyaan AI yang berulang dijawab dari basis pengetahuan
    // dan dilabeli "Jawaban Sistem" agar hemat kuota AI. Tetap berlaku saat AI cooldown.
    // forceAI ("jelaskan dengan AI") tetap minta jawaban segar dari AI.
    // ==========================================
    const cacheable = isCacheableAIRequest({ detectedIntent, forceAI, forceFAQ, forceSystem: responseMode === 'system' });
    const cacheContextHash = cacheable ? buildContextHash(retrievalResults) : '';
    const cacheKey = cacheable
      ? aiResponseCacheModel.buildCacheKey(projectId, aiResponseCacheModel.normalizeQuestion(effectiveMessage), cacheContextHash)
      : '';

    if (cacheable && !forceAI) {
      try {
        let cached = await aiResponseCacheModel.findByKey(projectId, cacheKey);
        if (!cached) {
          cached = await aiResponseCacheModel.findBestSimilar(projectId, effectiveMessage, { intent: detectedIntent, threshold: 0.8 });
        }
        if (cached?.answer) {
          aiResponseCacheModel.incrementHit(cached.id).catch(() => {});
          const cachedActions = [
            ...(sysRes.actions || []),
            ...buildSourceActionsFromRetrieval(retrievalResults, retrievalQuery)
          ];
          const cachedText = addStudentGreeting(cached.answer, studentName)
            + '\n\n📚 Jawaban ini diambil dari basis pengetahuan sistem (hemat kuota AI).';
          await chatModel.createMessage({
            session_id: sessionId, role: 'assistant', message: cachedText, intent: detectedIntent,
            context_used: { response_source: 'system', actions: cachedActions, used_model: 'cache', cache_hit: true, cache_id: cached.id }
          });
          return {
            intent: detectedIntent, response_source: 'system', ai_usage: aiUsage, used_model: 'cache',
            is_locked: safetyState.locked, warnings: safetyState.warnings,
            botMessage: { message: cachedText, actions: cachedActions }
          };
        }
      } catch (e) {
        console.warn('[Cache] gagal membaca cache:', e.message);
      }
    }

    // [v0.9.58] Mode SISTEM tanpa jawaban deterministik/cache → jangan diam-diam pakai AI:
    // tampilkan kartu konfirmasi (atau maaf+Hubungi Guru bila kuota AI penuh).
    if (!forceAI) {
      return await buildAiConfirmOrExhausted({ sessionId, effectiveMessage, detectedIntent, responseMode, studentName, aiUsage, safetyState });
    }
    // forceAI tapi kuota AI bersama penuh → tolak dengan pesan + info reset.
    {
      const g = aiRateLimitService.getGlobalUsage();
      if (g.exhausted) {
        const mins = Math.max(1, Math.ceil((g.resets_in_seconds || 0) / 60));
        const text = addStudentGreeting(`Maaf, **kuota AI bersama sedang penuh**. Coba lagi sekitar ${mins} menit lagi, atau pakai Jawaban Sistem dulu ya.`, studentName);
        await chatModel.createMessage({ session_id: sessionId, role: 'user', message: effectiveMessage, intent: detectedIntent });
        await chatModel.createMessage({ session_id: sessionId, role: 'assistant', message: text, intent: detectedIntent, context_used: { response_source: 'system', actions: [], used_model: 'ai_exhausted' } });
        return { intent: detectedIntent, response_source: 'system', ai_usage: aiUsage, is_locked: safetyState.locked, warnings: safetyState.warnings, botMessage: { message: text, actions: [] } };
      }
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
      // [v0.9.36] Materi yang isinya tabel kisi-kisi → jelaskan MAKSUD tabel, jangan
      // merangkum topiknya seolah diajarkan (sama seperti jalur @materi).
      const firstMat = retrievalResults[0] || {};
      const isBlueprintMaterial = shouldForceMaterialRetrieval
        && detectBlueprintTable(firstMat.content || firstMat.chunk_text || contextString, firstMat.title || firstMat.topic);
      const prompt = isBlueprintMaterial
        ? buildBlueprintTablePrompt(firstMat.title || firstMat.topic || 'Materi ini', contextString, effectiveMessage)
        : promptService.buildPrompt(effectiveMessage, contextString, pageContext, detectedIntent, elementContext, '', responseMode, lmsContext);
      const geminiResult = await aiQueueService.add(() => geminiService.generateWithFallback(prompt), { sessionId, intent: detectedIntent, responseMode });

      if (geminiResult.ok) {
        usedModel = geminiResult.model;
        aiUsage = aiRateLimitService.consume(sessionId);
        botMessageText = geminiResult.text;
        responseSource = 'ai';
        // AI#1: kalau ini konteks sistem (punya tutorial statis), tampilkan tombol
        // step-by-step tutorial — BUKAN tombol "lihat materi terkait".
        const aiTutorialAction = buildStaticTutorialCarouselAction(
          resolveStaticTutorialKey(detectedIntent, effectiveMessage),
          effectiveMessage
        );
        actions = aiTutorialAction
          ? [...(sysRes.actions || []), aiTutorialAction]
          : [...(sysRes.actions || []), ...buildSourceActionsFromRetrieval(retrievalResults, retrievalQuery)];
        if (shouldForceMaterialRetrieval && retrievalResults.length > 0) {
          const firstMaterial = retrievalResults[0] || {};
          // Jawaban AI = penjelasan hasil olahan + REFERENSI materi sumbernya (jelaskan
          // dulu, baru tunjuk sumbernya). Tombol "Lihat materi" tetap ada di actions.
          const srcTitle = firstMaterial.title || firstMaterial.topic || firstMaterial.metadata?.module_name;
          if (srcTitle && !aiTutorialAction) {
            botMessageText += `\n\n📚 **Sumber materi:** ${srcTitle} — klik tombol di bawah untuk membuka materinya.`;
          }
          await chatModel.updateSession(sessionId, {
            page_context: {
              ...pageContextState,
              last_material_query: retrievalQuery,
              last_material_title: firstMaterial.title || firstMaterial.topic || ''
            }
          }).catch(() => {});
        }
        // [v0.5.0] Simpan jawaban AI ke cache agar pertanyaan serupa berikutnya
        // bisa dijawab sistem tanpa memakai kuota AI.
        if (cacheable && cacheKey && geminiResult.text) {
          aiResponseCacheModel.upsertCache({
            project_id: projectId,
            cache_key: cacheKey,
            question: effectiveMessage,
            answer: geminiResult.text,
            response_source: 'ai',
            intent: detectedIntent,
            source_type: expectedSourceType || 'document_chunk',
            context_hash: cacheContextHash,
            model: geminiResult.model,
            expires_at: getExpiresAt()
          }).catch((e) => console.warn('[Cache] gagal menyimpan cache:', e.message));
        }
      } else if (geminiResult.quotaFallback) {
        aiErrorFallback = true;
        quotaFallback = true;
        // [v0.9.2] Tandai kuota AI BERSAMA habis agar bar di FE langsung 100% (bukan 0%).
        aiRateLimitService.markGlobalExhausted();
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
        ...buildSourceActionsFromRetrieval(retrievalResults, retrievalQuery)
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

chatService._parseQuizJSON = parseQuizJSON; // ponytail: diekspos untuk self-check parser
chatService._parseQuizCount = parseQuizCount;
module.exports = chatService;
