// src/services/document/document-indexer.service.js
const axios = require('axios');
const documentModel = require('../../models/document.model');
const chunkModel = require('../../models/chunk.model');
const documentParserService = require('./document-parser.service');
const chunkingService = require('../rag/chunking.service');
const textCleanerService = require('./text-cleaner.service');

const documentIndexerService = {
  async indexDocument(documentId) {
    const doc = await documentModel.findById(documentId);
    if (!doc) throw new Error('Dokumen tidak ditemukan');
    if (!doc.file_url) throw new Error('URL file dokumen tidak tersedia');

    const response = await axios.get(doc.file_url, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data);

    // Menerima array pagesData [{ pageNumber, text }] dari parser
    const parsedPages = await documentParserService.parse(fileBuffer, doc.file_type);

    if (!parsedPages || parsedPages.length === 0) {
      throw new Error('Dokumen kosong atau teks materi terlalu sedikit untuk diindex');
    }

    const chunks = chunkingService.chunkText(parsedPages, {
      maxChars: 1200,
      minChars: 80,
      maxParagraphs: 3
    });

    if (chunks.length === 0) {
      throw new Error('Gagal membuat chunk. Pastikan dokumen mengandung kalimat utuh.');
    }

    const chunksPayload = chunks.map((chunkObj, index) => {
      // Chunk object menjamin parameter text dan page valid
      const rawText = chunkObj.text;
      const pageNum = chunkObj.page;
      const cleanedText = textCleanerService.clean(rawText);

      return {
        document_id: doc.id,
        project_id: doc.project_id,
        chunk_text: cleanedText,
        chunk_index: index,
        topic: doc.topic || '',
        metadata: {
          title: doc.title || '',
          file_url: doc.file_url || null,
          file_type: doc.file_type || 'pdf',
          page_number: pageNum, // Sesuai halaman asli
          highlight_text: cleanedText
        }
      };
    });

    await chunkModel.deleteByDocumentId(doc.id);
    await chunkModel.createMany(chunksPayload);
    const updatedDoc = await documentModel.update(doc.id, { status: 'indexed' });

    return {
      document: {
        id: updatedDoc.id,
        title: updatedDoc.title,
        status: updatedDoc.status
      },
      chunks_count: chunksPayload.length,
      chunks_preview: chunksPayload.slice(0, 2).map(c => ({
        chunk_index: c.chunk_index,
        chunk_text: c.chunk_text.length > 100 ? c.chunk_text.substring(0, 100) + '...' : c.chunk_text
      }))
    };
  }
};

module.exports = documentIndexerService;
