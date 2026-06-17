const express = require('express');
const router = express.Router();
const moodleController = require('../controllers/moodle.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// [SECURITY] /student/resolve dipakai siswa (cek email saat masuk workspace) → PUBLIK.
// Sisanya (config token Moodle, sinkronisasi, preview) hanya untuk admin.
router.post('/student/resolve', moodleController.resolveStudent);

router.get('/config', requireAuth, moodleController.getConfig);
router.post('/config', requireAuth, moodleController.saveConfig);
router.post('/test', requireAuth, moodleController.testConnection);
router.post('/courses/preview-map', requireAuth, moodleController.previewCourseMap);
router.post('/courses/sync-map', requireAuth, moodleController.syncCourseMap);

// Tambahan Routes Sync
router.get('/course-contents', requireAuth, moodleController.getCourseContents);
router.post('/sync/course', requireAuth, moodleController.syncCourse);
router.post('/sync/all', requireAuth, moodleController.syncAll);

router.get('/preview-materials', requireAuth, moodleController.previewMaterials);
router.get('/chunks', requireAuth, moodleController.getProjectChunks);


module.exports = router;
