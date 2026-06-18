const express = require('express');
const router = express.Router();
const knowledgeController = require('../controllers/knowledge.controller');
const { uploadExcel } = require('../middlewares/upload.middleware');
const { requireAuth } = require('../middlewares/auth.middleware');

// [SECURITY] Basis pengetahuan (FAQ/aktivitas/template) hanya untuk admin.
router.use(requireAuth);

// FAQ Routes
router.post('/faqs', knowledgeController.createFaq);
router.get('/faqs', knowledgeController.getFaqs);
router.get('/faqs/project/:projectId', knowledgeController.getFaqsByProject);
router.put('/faqs/:id', knowledgeController.updateFaq);
router.delete('/faqs/:id', knowledgeController.deleteFaq);

// Activity Instructions Routes
router.post('/activities', knowledgeController.createActivity);
router.get('/activities', knowledgeController.getActivities);
router.get('/activities/project/:projectId', knowledgeController.getActivitiesByProject);
router.put('/activities/:id', knowledgeController.updateActivity);
router.delete('/activities/:id', knowledgeController.deleteActivity);

router.post('/faqs/import', uploadExcel.single('file'), knowledgeController.importFaqs);
router.post('/activities/import', uploadExcel.single('file'), knowledgeController.importActivities);

module.exports = router;
