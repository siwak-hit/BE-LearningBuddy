const faqModel = require('../models/faq.model');
const activityModel = require('../models/activity.model');

const asyncHandler = require('../utils/async-handler');
const response = require('../utils/response');

const faqImportService = require('../services/import/faq-import.service');
const activityImportService = require('../services/import/activity-import.service');

const knowledgeController = {
  // --- FAQ LOGIC ---
  createFaq: asyncHandler(async (req, res) => {
    const data = await faqModel.create(req.body);
    return response.success(res, 'FAQ berhasil dibuat', data, 201);
  }),
  getFaqs: asyncHandler(async (req, res) => {
    const data = await faqModel.findAll();
    return response.success(res, 'Daftar FAQ berhasil diambil', data, 200);
  }),
  getFaqsByProject: asyncHandler(async (req, res) => {
    const data = await faqModel.findByProjectId(req.params.projectId);
    return response.success(res, 'FAQ project berhasil diambil', data, 200);
  }),
  updateFaq: asyncHandler(async (req, res) => {
    const data = await faqModel.update(req.params.id, req.body);
    return response.success(res, 'FAQ berhasil diupdate', data, 200);
  }),
  deleteFaq: asyncHandler(async (req, res) => {
    await faqModel.delete(req.params.id);
    return response.success(res, 'FAQ berhasil dihapus', null, 200);
  }),

  // --- ACTIVITY INSTRUCTIONS LOGIC ---
  createActivity: asyncHandler(async (req, res) => {
    const data = await activityModel.create(req.body);
    return response.success(res, 'Instruksi aktivitas berhasil dibuat', data, 201);
  }),
  getActivities: asyncHandler(async (req, res) => {
    const data = await activityModel.findAll();
    return response.success(res, 'Daftar instruksi berhasil diambil', data, 200);
  }),
  getActivitiesByProject: asyncHandler(async (req, res) => {
    const data = await activityModel.findByProjectId(req.params.projectId);
    return response.success(res, 'Instruksi project berhasil diambil', data, 200);
  }),
  updateActivity: asyncHandler(async (req, res) => {
    const data = await activityModel.update(req.params.id, req.body);
    return response.success(res, 'Instruksi berhasil diupdate', data, 200);
  }),
  deleteActivity: asyncHandler(async (req, res) => {
    await activityModel.delete(req.params.id);
    return response.success(res, 'Instruksi berhasil dihapus', null, 200);
  }),

  importFaqs: asyncHandler(async (req, res) => {
    const { project_id } = req.body;
    if (!project_id) return response.error(res, 'project_id wajib diisi', 400);
    if (!req.file) return response.error(res, 'File Excel wajib diunggah', 400);

    const result = await faqImportService.importFaqs(project_id, req.file.buffer);

    if (result.successCount === 0 && result.totalRows > 0) {
      return response.error(res, 'Semua baris gagal diimport', 400, result);
    }

    return response.success(res, 'Import FAQ selesai', result);
  }),

  importActivities: asyncHandler(async (req, res) => {
    const { project_id } = req.body;
    if (!project_id) return response.error(res, 'project_id wajib diisi', 400);
    if (!req.file) return response.error(res, 'File Excel wajib diunggah', 400);

    const result = await activityImportService.importActivities(project_id, req.file.buffer);

    if (result.successCount === 0 && result.totalRows > 0) {
      return response.error(res, 'Semua baris gagal diimport', 400, result);
    }

    return response.success(res, 'Import instruksi selesai', result);
  })
};

module.exports = knowledgeController;
