const chunkModel = require('../models/chunk.model');
const retrievalService = require('../services/rag/retrieval.service');
const contextBuilderService = require('../services/rag/context-builder.service');
const asyncHandler = require('../utils/async-handler');
const response = require('../utils/response');

const ragController = {
  getChunksByDocument: asyncHandler(async (req, res) => {
    const data = await chunkModel.findByDocumentId(req.params.documentId);
    return response.success(res, 'Chunks dokumen berhasil diambil', data, 200);
  }),

  getChunksByProject: asyncHandler(async (req, res) => {
    const data = await chunkModel.findByProjectId(req.params.projectId);
    return response.success(res, 'Chunks project berhasil diambil', data, 200);
  }),

  deleteChunksByDocument: asyncHandler(async (req, res) => {
    await chunkModel.deleteByDocumentId(req.params.documentId);
    return response.success(res, 'Chunks dokumen berhasil dihapus', null, 200);
  }),

  // TAHAP 5: Query Retrieval
  queryRag: asyncHandler(async (req, res) => {
    const { projectId, query, pageContext, limit, sourceType } = req.body;

    if (!projectId || !query) {
      return response.error(res, 'projectId dan query wajib diisi', null, 400);
    }

    const finalSourceType = sourceType || 'all';

    const results = await retrievalService.retrieve(
      projectId,
      query,
      pageContext,
      limit,
      { sourceType: finalSourceType }
    );

    return response.success(res, results.length > 0 ? 'Konteks berhasil ditemukan' : 'Konteks belum ditemukan', {
      query,
      sourceType: finalSourceType,
      results
    }, 200);
  }),

  // TAHAP 5: Opsional - Preview Context String
  buildContext: asyncHandler(async (req, res) => {
    const { projectId, query, pageContext, limit, sourceType } = req.body;

    if (!projectId || !query) {
      return response.error(res, 'projectId dan query wajib diisi', null, 400);
    }

    const results = await retrievalService.retrieve(projectId, query, pageContext, limit, { sourceType: sourceType || 'all' });
    const contextString = contextBuilderService.build(results);

    return response.success(res, 'Context berhasil dibuat', {
      query,
      context: contextString
    }, 200);
  })
};

module.exports = ragController;
