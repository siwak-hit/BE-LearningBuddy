const faqModel = require('../../models/faq.model');
const activityModel = require('../../models/activity.model');
const chunkModel = require('../../models/chunk.model');
const keywordScoreService = require('./keyword-score.service');

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value = '') {
  return normalizeText(value).replace(/\s+/g, '');
}

function getCmsBoost(item, query = '') {
  const q = normalizeText(query);
  if (!/\b(cms|content management system|content manajemen sistem|wordpress|word press)\b/.test(q)) return 0;

  const metadata = item.metadata || {};
  const title = normalizeText([item.title, metadata.title, metadata.module_name].filter(Boolean).join(' '));
  const topic = normalizeText(item.topic || metadata.section_name || '');
  const content = normalizeText(item.content || item.chunk_text || '');
  const titleTopic = `${title} ${topic}`.trim();
  const all = `${titleTopic} ${content}`.trim();

  let boost = 0;
  if (/\b(cms|content management system|content manajemen sistem)\b/.test(titleTopic)) boost += 120;
  if (/\b(cms|content management system|content manajemen sistem)\b/.test(content)) boost += 70;
  if (/\b(wordpress|word press|plugin|dashboard admin|website)\b/.test(titleTopic)) boost += 35;
  if (/\b(content management system|content manajemen sistem)\b/.test(all)) boost += 80;

  const isSocialMediaTable = /\b(media sosial|sosial media|tipe contoh fungsi utama|blog web blog|social network|video sharing|photo sharing)\b/.test(all)
    && /\b(wordpress|word press|blogger)\b/.test(all)
    && !/\b(cms|content management system|content manajemen sistem)\b/.test(all);

  const isExamBlueprint = /\b(kisi kisi|asat|pengumuman|nomor soal|indikator soal|level kognitif)\b/.test(all);

  if (isSocialMediaTable) boost -= 180;
  if (isExamBlueprint) boost -= 160;

  return boost;
}

function getQueryFocus(query = '') {
  const q = normalizeText(query);

  if (/\b(dampak|pengaruh|efek|akibat|positif|negatif|manfaat|risiko|bahaya)\b/.test(q)) {
    return {
      type: 'dampak',
      mustHave: ['dampak'],
      shouldHave: ['positif', 'negatif', 'pengaruh', 'efek', 'akibat', 'manfaat', 'risiko', 'bahaya']
    };
  }

  if (/\b(pengertian|apa itu|maksud|definisi)\b/.test(q)) {
    return {
      type: 'pengertian',
      mustHave: ['pengertian'],
      shouldHave: ['adalah', 'merupakan', 'definisi']
    };
  }

  if (/\b(jenis|macam|kategori)\b/.test(q)) {
    return {
      type: 'jenis',
      mustHave: ['jenis'],
      shouldHave: ['contoh', 'kategori', 'macam']
    };
  }

  if (/\b(hoax|hoaks)\b/.test(q)) {
    return {
      type: 'hoax',
      mustHave: ['hoax'],
      shouldHave: ['ciri', 'verifikasi', 'berita palsu']
    };
  }

  if (/\b(cyberbullying|bullying|perundungan)\b/.test(q)) {
    return {
      type: 'cyberbullying',
      mustHave: ['cyberbullying'],
      shouldHave: ['korban', 'pelaku', 'dampak', 'mencegah']
    };
  }

  return null;
}

function applyFocusBoost(item, query) {
  const focus = getQueryFocus(query);
  if (!focus) return 0;

  const haystack = normalizeText([
    item.title,
    item.topic,
    item.content,
    item.metadata?.title
  ].filter(Boolean).join(' '));

  let boost = 0;

  focus.mustHave.forEach((word) => {
    if (haystack.includes(normalizeText(word))) boost += 20;
  });

  focus.shouldHave.forEach((word) => {
    if (haystack.includes(normalizeText(word))) boost += 8;
  });

  // Penalti khusus:
  // Kalau user nanya dampak, tapi chunk cuma pengertian/media sosial umum,
  // turunkan skornya.
  if (focus.type === 'dampak' && !haystack.includes('dampak')) {
    boost -= 25;
  }

  if (focus.type === 'pengertian' && haystack.includes('dampak')) {
    boost -= 10;
  }

  return boost;
}

const retrievalService = {
  async retrieve(projectId, query, pageContext, limit = 5, options = {}) {
    const sourceType = options.sourceType || options.source_type || 'all';

    const shouldLoadFaq = sourceType === 'all' || sourceType === 'faq';
    const shouldLoadActivity = sourceType === 'all' || sourceType === 'activity';
    const shouldLoadChunks = sourceType === 'all' || sourceType === 'document_chunk';

    // 1. Tarik data secara kondisional
    const [faqs, activities, chunks] = await Promise.all([
      shouldLoadFaq ? faqModel.findByProjectId(projectId) : Promise.resolve([]),
      shouldLoadActivity ? activityModel.findByProjectId(projectId) : Promise.resolve([]),
      shouldLoadChunks ? chunkModel.findByProjectId(projectId) : Promise.resolve([])
    ]);

    let results = [];

    // 2. Format FAQ
    faqs.forEach(faq => {
      results.push({
        source_type: 'faq',
        title: `FAQ : ${faq.question}`, // Judulnya langsung menampilkan pertanyaan
        topic: faq.category || 'Umum',
        content: `**Jawaban:** ${faq.answer}`, // Kontennya diformat dengan teks Jawaban tebal
        metadata: { faq_id: faq.id }
      });
    });

    // 3. Format Activity Instructions
    activities.forEach(act => {
      results.push({
        source_type: 'activity',
        title: act.title,
        topic: act.topic || '',
        content: `Instruksi: ${act.instruction}\nKriteria Selesai: ${act.completion_criteria || ''}`,
        metadata: {
          activity_id: act.id,
          activity_type: act.activity_type,
          rules: act.rules,
          deadline: act.deadline
        }
      });
    });

    // 4. Format Document Chunks (Siapkan metadata untuk PDF Viewer)
    chunks.forEach(chunk => {
      const metadata = chunk.metadata || {};
      results.push({
        source_type: 'document_chunk',
        title: metadata.title || 'Dokumen Materi',
        topic: chunk.topic || '',
        content: chunk.chunk_text,
        metadata: {
          ...metadata,
          document_id: chunk.document_id,
          chunk_id: chunk.id,
          chunk_index: chunk.chunk_index,
          title: metadata.title || metadata.module_name || null,
          module_name: metadata.module_name || metadata.title || null,
          section_name: metadata.section_name || chunk.topic || null,
          source_origin: metadata.source_origin || (metadata.source_url ? 'moodle' : null),
          source_url: metadata.source_url || metadata.file_url || null,
          url: metadata.source_url || metadata.file_url || null,
          file_url: metadata.file_url || metadata.source_url || null,
          content_type: metadata.content_type || metadata.file_type || null,
          file_type: metadata.file_type || metadata.content_type || null,
          page_number: metadata.page_number || metadata.page || null,
          highlight_text: chunk.chunk_text
        }
      });
    });

    // 5. Hitung skor untuk setiap baris data
    results = results.map(item => {
      const baseScore = keywordScoreService.calculateScore(item, query, pageContext);
      const focusBoost = applyFocusBoost(item, query);
      const cmsBoost = getCmsBoost(item, query);
      const score = baseScore + focusBoost + cmsBoost;

      return {
        ...item,
        score,
        debug_score: {
          baseScore,
          focusBoost,
          cmsBoost
        }
      };
    });

    // 6. Saring (hanya yang punya skor > 0), urutkan, dan potong sesuai limit
      results = results
      .filter(item => item.score >= 5)
      .sort((a, b) => {
        // Aturan 2: Sort descending berdasar score
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        // Aturan 3: Jika tie, fallback berdasar chunk_index (ascending agar membaca sekuensial)
        const indexA = a.metadata?.chunk_index || 0;
        const indexB = b.metadata?.chunk_index || 0;
        return indexA - indexB;
      })
      .slice(0, limit || 5);

    return results;
  }
};

module.exports = retrievalService;
