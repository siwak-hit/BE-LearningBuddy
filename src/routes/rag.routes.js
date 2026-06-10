const express = require('express');
const router = express.Router();
const ragController = require('../controllers/rag.controller');

router.get('/chunks/document/:documentId', ragController.getChunksByDocument);
router.get('/chunks/project/:projectId', ragController.getChunksByProject);
router.delete('/chunks/document/:documentId', ragController.deleteChunksByDocument);

router.post('/query', ragController.queryRag);
router.post('/context', ragController.buildContext);

module.exports = router;
