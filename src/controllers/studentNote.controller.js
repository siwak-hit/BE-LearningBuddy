const studentNoteModel = require('../models/studentNote.model');
const chatModel = require('../models/chat.model');
const response = require('../utils/response');

async function resolveProjectId({ projectId, projectKey }) {
  if (projectId) return projectId;
  if (projectKey && chatModel.getProjectIdByKey) return chatModel.getProjectIdByKey(projectKey);
  return null;
}

const studentNoteController = {
  async list(req, res) {
    try {
      const projectId = await resolveProjectId(req.query);
      if (!projectId) return response.error(res, 'projectId/projectKey diperlukan', null, 400);

      const data = await studentNoteModel.list({
        projectId,
        sessionId: req.query.sessionId,
        studentEmail: req.query.student_email || req.query.email,
        classCode: req.query.class_code || req.query.classCode,
        q: req.query.q || '',
        page: req.query.page || 1,
        limit: req.query.limit || 5
      });
      return response.success(res, 'Catatan berhasil diambil', data);
    } catch (error) {
      return response.error(res, 'Gagal mengambil catatan', error.message, 500);
    }
  },

  async create(req, res) {
    try {
      const projectId = await resolveProjectId(req.body);
      if (!projectId) return response.error(res, 'projectId/projectKey diperlukan', null, 400);
      if (!req.body.title || !req.body.content) return response.error(res, 'Judul dan isi catatan wajib diisi', null, 400);

      const data = await studentNoteModel.create({
        project_id: projectId,
        session_id: req.body.sessionId || req.body.session_id,
        student_email: req.body.student_email || req.body.email,
        student_name: req.body.student_name || req.body.name,
        class_code: req.body.class_code || req.body.classCode,
        title: req.body.title,
        content: req.body.content
      });
      return response.success(res, 'Catatan berhasil disimpan', data, 201);
    } catch (error) {
      return response.error(res, 'Gagal menyimpan catatan', error.message, 500);
    }
  },

  async update(req, res) {
    try {
      if (!req.body.title || !req.body.content) return response.error(res, 'Judul dan isi catatan wajib diisi', null, 400);
      const data = await studentNoteModel.update(req.params.id, req.body);
      return response.success(res, 'Catatan berhasil diperbarui', data);
    } catch (error) {
      return response.error(res, 'Gagal memperbarui catatan', error.message, 500);
    }
  },

  async remove(req, res) {
    try {
      const data = await studentNoteModel.softDelete(req.params.id);
      return response.success(res, 'Catatan berhasil dihapus', data);
    } catch (error) {
      return response.error(res, 'Gagal menghapus catatan', error.message, 500);
    }
  }
};

module.exports = studentNoteController;
