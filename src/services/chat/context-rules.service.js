// ============================================================
// context-rules.service.js — [v0.9.86] "Kunci konteks" untuk AI Learning Buddy.
//
// Ide: baca SEMUA materi kelas (chunk) + FAQ + instruksi aktivitas dari DB, lalu
// bangun "kosakata konteks" (kumpulan kata kunci). Pertanyaan materi yang kata intinya
// TIDAK ada satu pun di kosakata itu dianggap DI LUAR KONTEKS → AI tidak menjawab,
// melainkan menyarankan pertanyaan lain yang MASIH dalam konteks (mengikuti kata tanya
// user, mis. "apa itu cpns" → "Apa itu CMS?", "Apa itu WordPress?").
//
// Dipakai juga untuk tombol sidebar "Konteks yang Bisa Ditanya" (tabel daftar materi).
// ============================================================
const chunkModel = require('../../models/chunk.model');
const faqModel = require('../../models/faq.model');
const activityModel = require('../../models/activity.model');

// Kata yang TIDAK dianggap kata kunci (kata tanya, kata sambung, kata umum LMS).
const STOPWORDS = new Set([
  'apa', 'itu', 'apakah', 'adalah', 'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'untuk',
  'pada', 'dengan', 'dalam', 'ada', 'nya', 'kah', 'sih', 'dong', 'ya', 'yah', 'gimana',
  'bagaimana', 'kenapa', 'mengapa', 'siapa', 'kapan', 'dimana', 'mana', 'berapa', 'cara',
  'tolong', 'jelaskan', 'sebutkan', 'jelasin', 'kasih', 'tahu', 'tau', 'maksud', 'maksudnya',
  'pengertian', 'definisi', 'arti', 'artinya', 'tentang', 'contoh', 'jenis', 'macam', 'dampak',
  'fungsi', 'manfaat', 'kelebihan', 'kekurangan', 'perbedaan', 'beda', 'ini', 'itu', 'saya',
  'aku', 'kamu', 'kita', 'mereka', 'bisa', 'boleh', 'harus', 'akan', 'sudah', 'belum', 'juga',
  'saja', 'aja', 'lagi', 'kok', 'deh', 'nih', 'tuh', 'vclass', 'moodle', 'lms', 'materi',
  'pelajaran', 'sekolah', 'kelas', 'guru', 'tugas', 'soal', 'jawaban', 'buddy', 'ai', 'the',
  'a', 'an', 'of', 'is', 'are', 'to', 'in', 'on', 'for', 'what', 'how', 'why'
]);

function normalize(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ambil token bermakna (bukan stopword, panjang >= 3).
function tokenize(value = '') {
  return normalize(value)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function getChunkCourseId(chunk = {}) {
  const m = chunk.metadata || {};
  const raw = m.moodle_course_id ?? m.course_id ?? null;
  return raw === null || raw === undefined ? null : String(raw);
}

// Nama topik yang manusiawi (hindari "Dokumen Materi" yang generik).
function chunkTopicName(chunk = {}) {
  const m = chunk.metadata || {};
  const candidates = [m.module_name, m.title, chunk.topic, m.section_name];
  for (const c of candidates) {
    const t = String(c || '').trim();
    if (t && !/^dokumen materi$/i.test(t)) return t;
  }
  return String(chunk.topic || '').trim() || 'Materi';
}

// Cache 5 menit per (projectId, courseId) supaya tak query DB tiap pesan.
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

async function getProjectContext(projectId, courseId = null) {
  const key = `${projectId}:${courseId || 'all'}`;
  const cached = _cache.get(key);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.data;

  const [chunksRaw, faqs, activities] = await Promise.all([
    chunkModel.findByProjectId(projectId).catch(() => []),
    faqModel.findByProjectId(projectId).catch(() => []),
    activityModel.findByProjectId(projectId).catch(() => [])
  ]);

  // Chunk di-scope ke course siswa (chunk tanpa course tetap disertakan = materi manual lama).
  let chunks = Array.isArray(chunksRaw) ? chunksRaw : [];
  if (courseId) {
    const cid = String(courseId);
    chunks = chunks.filter((c) => {
      const ccid = getChunkCourseId(c);
      return ccid === null || ccid === cid;
    });
  }

  const keywords = new Set();
  const topicsMap = new Map(); // name(lower) → { name, type, keywords:Set }

  const addTopic = (name, type) => {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const k = clean.toLowerCase();
    if (!topicsMap.has(k)) topicsMap.set(k, { name: clean, type, keywords: new Set() });
    return topicsMap.get(k);
  };

  const feed = (text, topic) => {
    tokenize(text).forEach((w) => {
      keywords.add(w);
      if (topic) topic.keywords.add(w);
    });
  };

  chunks.forEach((chunk) => {
    const topic = addTopic(chunkTopicName(chunk), 'Materi');
    feed(chunkTopicName(chunk), topic);
    feed(chunk.topic, topic);
    // Isi materi ikut jadi kosakata konteks (jadi "html", "plugin", dst. dikenali).
    feed(chunk.chunk_text, topic);
  });

  (Array.isArray(faqs) ? faqs : []).forEach((faq) => {
    const topic = addTopic(faq.question || faq.category || 'FAQ', 'FAQ');
    if (topic) topic.exampleOverride = String(faq.question || '').trim();
    feed(faq.question, topic);
    feed(faq.answer, topic);
  });

  (Array.isArray(activities) ? activities : []).forEach((act) => {
    const topic = addTopic(act.title, 'Aktivitas');
    feed(act.title, topic);
    feed(act.topic, topic);
    feed(act.instruction, topic);
  });

  const topics = Array.from(topicsMap.values())
    .map((t) => ({ name: t.name, type: t.type, keywords: Array.from(t.keywords), exampleOverride: t.exampleOverride }))
    // Materi diutamakan tampil lebih dulu daripada FAQ/Aktivitas.
    .sort((a, b) => {
      const order = { Materi: 0, FAQ: 1, Aktivitas: 2 };
      return (order[a.type] ?? 3) - (order[b.type] ?? 3);
    });

  const data = { keywords, topics, hasContext: keywords.size > 0 };
  _cache.set(key, { at: Date.now(), data });
  return data;
}

// Kata tanya awal user → prefix saran yang seragam.
function questionPrefix(query = '') {
  const q = normalize(query);
  if (/\b(dampak|pengaruh|efek|akibat|manfaat|risiko|bahaya)\b/.test(q)) return 'Apa dampak';
  if (/\b(jenis|macam|kategori)\b/.test(q)) return 'Apa saja jenis';
  if (/\b(fungsi|kegunaan|guna)\b/.test(q)) return 'Apa fungsi';
  if (/\b(cara|bagaimana|gimana|langkah)\b/.test(q)) return 'Bagaimana cara';
  if (/\b(kenapa|mengapa)\b/.test(q)) return 'Mengapa';
  if (/\b(perbedaan|beda|bandingkan)\b/.test(q)) return 'Apa perbedaan';
  return 'Apa itu';
}

// Cek apakah pertanyaan DI LUAR konteks (tidak ada kata inti yang cocok kosakata materi).
function isOutOfContext(query, ctx) {
  if (!ctx || !ctx.hasContext) return false; // materi kosong → jangan blokir apa pun
  const tokens = tokenize(query);
  if (!tokens.length) return false; // pertanyaan tanpa kata inti (mis. "apa itu?") → biarkan
  return !tokens.some((t) => ctx.keywords.has(t));
}

// Saran pertanyaan yang MASIH dalam konteks, mengikuti kata tanya user.
function buildSuggestions(query, ctx, n = 3) {
  const prefix = questionPrefix(query);
  const materiTopics = (ctx?.topics || []).filter((t) => t.type === 'Materi');
  const pool = (materiTopics.length ? materiTopics : (ctx?.topics || [])).slice(0, Math.max(n, 6));
  const seen = new Set();
  const out = [];
  for (const t of pool) {
    const name = shortTopicName(t.name);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(`${prefix} ${name}?`);
    if (out.length >= n) break;
  }
  return out;
}

// Rapikan nama topik untuk saran/tabel: buang embel-embel "Materi 1 -", potong panjang.
function shortTopicName(name = '') {
  let s = String(name || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^materi\s*\d*\s*[-:]?\s*/i, '').replace(/\.(pdf|docx?|pptx?)$/i, '');
  if (s.length > 48) s = s.slice(0, 45).trim() + '…';
  return s || String(name || '').trim();
}

// Contoh pertanyaan untuk tiap baris tabel konteks.
function exampleQuestionFor(topic) {
  if (topic.exampleOverride) return topic.exampleOverride;
  const name = shortTopicName(topic.name);
  if (topic.type === 'Aktivitas') return `Apa instruksi ${name}?`;
  return `Apa itu ${name}?`;
}

// Baris tabel "Daftar Konteks": No | Topik Materi | Jenis | Contoh Pertanyaan.
function buildContextList(ctx, limit = 30) {
  return (ctx?.topics || []).slice(0, limit).map((t, i) => ({
    no: i + 1,
    name: shortTopicName(t.name),
    type: t.type,
    example: exampleQuestionFor(t)
  }));
}

module.exports = {
  getProjectContext,
  isOutOfContext,
  buildSuggestions,
  buildContextList,
  questionPrefix,
  _clearCache: () => _cache.clear()
};
