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

function extractQuerySubject(query = '') {
  const raw = String(query || '').trim().replace(/[?!.]+$/g, '');
  const lower = raw.toLowerCase();
  const match = lower.match(/^(?:apa\s+itu|pengertian|jelaskan\s+pengertian|maksud\s+dari|definisi(?:\s+dari)?|jelaskan|sebutkan|contoh|fungsi|cara)\s+(.+)$/i);
  if (match && match[1]) return match[1].trim();
  return lower.trim();
}

function getQueryProfile(query = '') {
  const q = normalizeText(query);
  const subject = extractQuerySubject(query);
  const subjectNorm = normalizeText(subject);
  const subjectCompact = compactText(subject);
  const isDefinition = /\b(apa itu|pengertian|definisi|maksud|jelaskan)\b/i.test(String(query || ''));

  const aliases = [];
  const addAlias = (value) => {
    const n = normalizeText(value);
    if (n && !aliases.includes(n)) aliases.push(n);
  };

  addAlias(subjectNorm);

  if (/\b(wordpress|word\s*press|wp)\b/.test(q) || subjectCompact === 'wordpress') {
    addAlias('wordpress');
    addAlias('word press');
    addAlias('wp');
    addAlias('cms');
    addAlias('content management system');
    addAlias('website');
  }

  if (/\b(cms|content\s+management\s+system|content\s+manajemen\s+sistem)\b/.test(q) || subjectCompact === 'cms') {
    addAlias('cms');
    addAlias('content management system');
    addAlias('content manajemen sistem');
    addAlias('wordpress');
    addAlias('word press');
  }

  return {
    q,
    subject: subjectNorm,
    subjectCompact,
    aliases,
    aliasCompacts: aliases.map(compactText).filter(Boolean),
    isDefinition,
    isWordPress: /\b(wordpress|word\s*press|wp)\b/.test(q) || subjectCompact === 'wordpress',
    isCms: /\b(cms|content\s+management\s+system|content\s+manajemen\s+sistem)\b/.test(q) || subjectCompact === 'cms'
  };
}

function hasAnyCompact(haystackCompact = '', values = []) {
  return values.some((value) => value && haystackCompact.includes(value));
}

function applyMaterialRelevanceBoost(item, query) {
  const profile = getQueryProfile(query);
  if (!profile.subject && !profile.aliases.length) return 0;

  const metadata = item.metadata || {};
  const title = normalizeText(item.title || metadata.module_name || metadata.title || '');
  const topic = normalizeText(item.topic || metadata.section_name || '');
  const content = normalizeText(item.content || item.chunk_text || metadata.highlight_text || '');
  const titleTopic = `${title} ${topic}`.trim();
  const haystack = `${titleTopic} ${content}`.trim();
  const titleTopicCompact = compactText(titleTopic);
  const contentCompact = compactText(content);
  const haystackCompact = compactText(haystack);

  let boost = 0;
  const subjectHitInTitleTopic = profile.subjectCompact && titleTopicCompact.includes(profile.subjectCompact);
  const subjectHitInContent = profile.subjectCompact && contentCompact.includes(profile.subjectCompact);
  const aliasHitInTitleTopic = hasAnyCompact(titleTopicCompact, profile.aliasCompacts);
  const aliasHitInContent = hasAnyCompact(contentCompact, profile.aliasCompacts);

  // Judul/topik harus lebih dipercaya daripada sekadar muncul 1 kata di isi chunk.
  if (subjectHitInTitleTopic) boost += 90;
  if (aliasHitInTitleTopic) boost += 45;
  if (subjectHitInContent) boost += 32;
  if (aliasHitInContent) boost += 16;

  // Query definisi: cari materi yang memang mengandung pola definisi, bukan hanya contoh singkat.
  if (profile.isDefinition) {
    const definitionWords = ['definisi', 'adalah', 'merupakan', 'yaitu', 'pengertian'];
    const hasDefinitionSignal = definitionWords.some((word) => content.includes(word));
    if (hasDefinitionSignal && (subjectHitInContent || aliasHitInContent || aliasHitInTitleTopic)) boost += 42;
    if (/\b(apa itu|pengertian|definisi)\b/.test(title)) boost += 38;
    if (/\b(instalasi|cara install|langkah instalasi|keamanan|dashboard|plugin wajib)\b/.test(title) && !/\b(apa itu|pengertian|definisi)\b/.test(title)) boost -= 18;
  }

  // Aturan khusus WordPress/CMS: jangan jatuh ke materi media sosial hanya karena ada contoh "Word Press" di tabel tipe media sosial.
  if (profile.isWordPress || profile.isCms) {
    const isCmsTopic = /\b(cms|wordpress|word press|website|instalasi wordpress)\b/.test(titleTopic) || /\b(content management system|content manajemen sistem)\b/.test(content);
    const isSocialMediaTopic = /\b(media sosial|sosial media|medsos|dampak sosial informatika)\b/.test(titleTopic);
    const isExamBlueprint = /\b(kisi kisi|asat|pengumuman|nomor soal|indikator soal)\b/.test(titleTopic) || /\b(nomor soal|level kognitif|capaian pembelajaran)\b/.test(content);
    const justExampleInTable = /\b(blog web blog\b|tipe contoh fungsi utama|social network|video sharing|photo sharing)\b/.test(content) && /\b(word\s*press|wordpress)\b/.test(content);

    if (isCmsTopic) boost += 75;
    if (profile.isWordPress && /\b(wordpress|word press)\b/.test(titleTopic)) boost += 80;
    if (profile.isCms && /\b(cms|content management system|content manajemen sistem)\b/.test(titleTopic + ' ' + content)) boost += 80;
    if (profile.isWordPress && /\bcms\b/.test(titleTopic + ' ' + content) && /\b(wordpress|word press)\b/.test(titleTopic + ' ' + content)) boost += 60;

    if (isSocialMediaTopic) boost -= 150;
    if (isExamBlueprint) boost -= 220;
    if (justExampleInTable) boost -= 150;
  }

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

    // 4. Format Document Chunks (Siapkan metadata untuk PDF/HTML Moodle Viewer)
    chunks.forEach(chunk => {
      const metadata = chunk.metadata || {};
      const sourceUrl = metadata.file_url || metadata.source_url || metadata.url || null;
      const contentType = metadata.content_type || metadata.file_type || '';
      results.push({
        source_type: 'document_chunk',
        title: metadata.title || metadata.module_name || 'Dokumen Materi',
        topic: chunk.topic || metadata.section_name || '',
        content: chunk.chunk_text,
        file_url: sourceUrl,
        source_url: sourceUrl,
        file_type: contentType,
        metadata: {
          ...metadata,
          document_id: chunk.document_id,
          chunk_id: chunk.id,
          chunk_index: chunk.chunk_index,
          page_number: metadata.page_number || metadata.page || null,
          file_url: sourceUrl,
          source_url: sourceUrl,
          file_type: contentType,
          highlight_text: metadata.highlight_text || chunk.chunk_text
        }
      });
    });

    // 5. Hitung skor untuk setiap baris data
    results = results.map(item => {
      const baseScore = keywordScoreService.calculateScore(item, query, pageContext);
      const focusBoost = applyFocusBoost(item, query);
      const materialBoost = applyMaterialRelevanceBoost(item, query);
      const score = baseScore + focusBoost + materialBoost;

      return {
        ...item,
        score,
        debug_score: {
          baseScore,
          focusBoost,
          materialBoost
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
,
  async listMoodleMaterials(projectId, options = {}) {
    const classCode = String(options.classCode || options.class_code || '').toUpperCase().trim();
    const courseId = Number(options.courseId || options.course_id || 0);
    const limit = Math.max(1, Number(options.limit || 24));

    const chunks = await chunkModel.findByProjectId(projectId);
    const map = new Map();

    (chunks || []).forEach((chunk) => {
      const metadata = chunk.metadata || {};
      if (metadata.source_origin !== 'moodle') return;
      if (classCode && String(metadata.class_code || '').toUpperCase().trim() !== classCode) return;
      if (courseId && Number(metadata.moodle_course_id || 0) !== courseId) return;

      const sourceUrl = metadata.source_url || metadata.file_url || metadata.url || '';
      const key = sourceUrl || chunk.document_id || `${metadata.module_id || ''}-${metadata.module_name || ''}`;
      if (!key) return;

      const existing = map.get(key) || {
        title: metadata.module_name || metadata.title || chunk.topic || 'Materi Moodle',
        topic: metadata.section_name || chunk.topic || '',
        url: sourceUrl,
        source_url: sourceUrl,
        file_type: metadata.content_type || metadata.file_type || 'html',
        modname: metadata.modname || 'page',
        class_code: metadata.class_code || classCode || '',
        course_id: metadata.moodle_course_id || courseId || null,
        module_id: metadata.module_id || null,
        chunks_count: 0,
        preview: ''
      };

      existing.chunks_count += 1;
      if (!existing.preview) {
        existing.preview = String(chunk.chunk_text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      }
      map.set(key, existing);
    });

    return Array.from(map.values()).slice(0, limit);
  }

};

module.exports = retrievalService;
