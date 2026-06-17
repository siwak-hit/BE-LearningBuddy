const express = require('express');
const router = express.Router();
const ragController = require('../controllers/rag.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

// [SECURITY] Operasi RAG (chunk/index/query mentah) hanya untuk admin.
router.use(requireAuth);

router.get('/chunks/document/:documentId', ragController.getChunksByDocument);
router.get('/chunks/project/:projectId', ragController.getChunksByProject);
router.delete('/chunks/document/:documentId', ragController.deleteChunksByDocument);

router.post('/query', ragController.queryRag);
router.post('/context', ragController.buildContext);

module.exports = router;
