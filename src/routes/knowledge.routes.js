const express = require('express');
const router = express.Router();
const knowledgeController = require('../controllers/knowledge.controller');
const { uploadExcel } = require('../middlewares/upload.middleware');
const multer = require('multer');
const uploadRaw = multer({ storage: multer.memoryStorage() });
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
router.post('/templates/import-html', uploadRaw.single('file'), knowledgeController.importHtmlTemplate);

// Rute untuk Get & Delete Template HTML
router.get('/templates/project/:projectId', knowledgeController.getTemplatesByProject);
router.delete('/templates/:id', knowledgeController.deleteTemplate);

module.exports = router;
