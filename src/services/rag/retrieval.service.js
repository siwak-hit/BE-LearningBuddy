const faqModel = require('../../models/faq.model');
const activityModel = require('../../models/activity.model');
const chunkModel = require('../../models/chunk.model');
const keywordScoreService = require('./keyword-score.service');

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
        metadata: { activity_id: act.id }
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
          document_id: chunk.document_id,
          chunk_id: chunk.id,
          chunk_index: chunk.chunk_index,
          // Ekstraksi untuk fitur "Lihat Sumber Referensi"
          page_number: metadata.page_number || metadata.page || null,
          file_url: metadata.file_url || metadata.source_url || null,
          highlight_text: chunk.chunk_text
        }
      });
    });

    // 5. Hitung skor untuk setiap baris data
    results = results.map(item => {
      const score = keywordScoreService.calculateScore(item, query, pageContext);
      return { ...item, score };
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
