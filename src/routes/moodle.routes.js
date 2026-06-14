const express = require('express');
const router = express.Router();
const moodleController = require('../controllers/moodle.controller');

router.get('/config', moodleController.getConfig);
router.post('/config', moodleController.saveConfig);
router.post('/test', moodleController.testConnection);
router.post('/student/resolve', moodleController.resolveStudent);
router.post('/courses/preview-map', moodleController.previewCourseMap);
router.post('/courses/sync-map', moodleController.syncCourseMap);

// Tambahan Routes Sync
router.get('/course-contents', moodleController.getCourseContents);
router.post('/sync/course', moodleController.syncCourse);
router.post('/sync/all', moodleController.syncAll);

router.get('/preview-materials', moodleController.previewMaterials);
router.get('/chunks', moodleController.getProjectChunks);


module.exports = router;
