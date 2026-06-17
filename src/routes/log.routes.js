const express = require('express');
const router = express.Router();
const LogController = require('../controllers/log.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// [SECURITY] Log percakapan berisi data siswa (PII) → hanya admin.
router.use(requireAuth);

router.get('/summary', LogController.getSummary);
router.get('/sessions', LogController.getSessions);
router.get('/sessions/:sessionId', LogController.getSessionDetail);

// Rute Baru
router.post('/sessions/:sessionId/unlock-key', LogController.generateUnlockKey);

module.exports = router;
