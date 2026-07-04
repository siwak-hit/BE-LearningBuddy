const studentSessionRegistryModel = require('../models/studentSessionRegistry.model');
const chatModel = require('../models/chat.model');
const response = require('../utils/response');

// Reuse hanya untuk sesi pada hari kalender yang sama (Asia/Jakarta) — "sebelum jam 12 malam".
function isSameJakartaDay(ts) {
  if (!ts) return false;
  try {
    const fmt = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    return fmt(ts) === fmt(new Date());
  } catch (_) {
    return false;
  }
}

async function resolveProjectId({ projectId, projectKey }) {
  if (projectId) return projectId;
  if (projectKey && chatModel.getProjectIdByKey) return chatModel.getProjectIdByKey(projectKey);
  return null;
}

const studentSessionController = {
  async reuse(req, res) {
    try {
      const projectId = await resolveProjectId(req.query);
      const { email, classCode, class_code } = req.query;
      if (!projectId) return response.error(res, 'projectId/projectKey diperlukan', null, 400);
      if (!email || !(classCode || class_code)) return response.error(res, 'email dan classCode diperlukan', null, 400);
      const data = await studentSessionRegistryModel.findActive(projectId, email, classCode || class_code);
      let valid = data && isSameJakartaDay(data.updated_at);

      // [FIX] Verifikasi sesi yang ditunjuk registry BENAR kelas yang diminta. Registry bisa
      // korup (kelas 9A menunjuk ke sesi yang meta-nya 8E) → dulu reuse membuka kelas yang salah.
      if (valid) {
        try {
          const sess = await chatModel.getSessionById(data.session_id);
          const actualClass = String(sess?.page_context?.session_meta?.class_code || '').toUpperCase();
          const wantClass = String(classCode || class_code || '').toUpperCase();
          if (!sess || (actualClass && wantClass && actualClass !== wantClass)) valid = false;
        } catch (_) { /* biarkan valid apa adanya kalau gagal cek */ }
      }

      return response.success(res, valid ? 'Session lama ditemukan' : 'Session lama tidak ditemukan', { found: Boolean(valid), session: valid ? data : null });
    } catch (error) {
      return response.error(res, 'Gagal mencari session siswa', error.message, 500);
    }
  },

  async register(req, res) {
    try {
      const projectId = await resolveProjectId(req.body);
      if (!projectId) return response.error(res, 'projectId/projectKey diperlukan', null, 400);
      if (!req.body.sessionId && !req.body.session_id) return response.error(res, 'sessionId diperlukan', null, 400);
      if (!req.body.email && !req.body.student_email) return response.error(res, 'email siswa diperlukan', null, 400);
      if (!req.body.classCode && !req.body.class_code) return response.error(res, 'classCode diperlukan', null, 400);

      const data = await studentSessionRegistryModel.upsert({
        project_id: projectId,
        session_id: req.body.sessionId || req.body.session_id,
        student_email: req.body.email || req.body.student_email,
        class_code: req.body.classCode || req.body.class_code,
        student_name: req.body.student_name || req.body.fullname || req.body.name,
        moodle_user_id: req.body.moodle_user_id,
        course_id: req.body.course_id || req.body.courseId,
        course_title: req.body.course_title
      });
      return response.success(res, 'Session siswa berhasil disimpan', data);
    } catch (error) {
      return response.error(res, 'Gagal menyimpan session siswa', error.message, 500);
    }
  },

  async remove(req, res) {
    try {
      const data = await studentSessionRegistryModel.softDeleteBySession(req.params.sessionId);
      return response.success(res, 'Session siswa berhasil dihapus', data);
    } catch (error) {
      return response.error(res, 'Gagal menghapus session siswa', error.message, 500);
    }
  }
};

module.exports = studentSessionController;
