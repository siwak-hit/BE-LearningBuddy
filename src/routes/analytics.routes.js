const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// [SECURITY] Analitik pembelajaran berisi agregat data siswa → hanya admin.
router.use(requireAuth);

router.get('/learning', analyticsController.getLearningAnalytics);
router.get('/evaluation/export', analyticsController.exportEvaluationDataset);
router.post('/evaluation/compute', analyticsController.computeEvaluation);

module.exports = router;
