const documentModel = require('../models/document.model');
const documentUploadService = require('../services/document/document-upload.service');
const documentIndexerService = require('../services/document/document-indexer.service');
const asyncHandler = require('../utils/async-handler');
const response = require('../utils/response');

const documentController = {
  uploadDocument: asyncHandler(async (req, res) => {
    const { project_id, title, topic } = req.body;
    const file = req.file;

    if (!project_id || !title || !file) {
      return response.error(res, 'project_id, title, dan file wajib diisi', null, 400);
    }

    const data = await documentUploadService.processAndUpload(project_id, title, topic, file);
    return response.success(res, 'Dokumen berhasil diupload', data, 201);
  }),

  getDocuments: asyncHandler(async (req, res) => {
    const data = await documentModel.findAll();
    return response.success(res, 'Daftar dokumen berhasil diambil', data, 200);
  }),

  getDocumentById: asyncHandler(async (req, res) => {
    const data = await documentModel.findById(req.params.id);
    if (!data) return response.error(res, 'Dokumen tidak ditemukan', null, 404);
    return response.success(res, 'Dokumen berhasil diambil', data, 200);
  }),

  getDocumentsByProject: asyncHandler(async (req, res) => {
    const data = await documentModel.findByProjectId(req.params.projectId);
    return response.success(res, 'Dokumen project berhasil diambil', data, 200);
  }),

  indexDocument: asyncHandler(async (req, res) => {
    const data = await documentIndexerService.indexDocument(req.params.id);
    return response.success(res, 'Dokumen berhasil diindex', data, 200);
  }),

  deleteDocument: asyncHandler(async (req, res) => {
    await documentUploadService.deleteDocument(req.params.id);
    return response.success(res, 'Dokumen dan file berhasil dihapus', null, 200);
  })
};

module.exports = documentController;
