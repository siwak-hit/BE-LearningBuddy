const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const { uploadDocument } = require('../middlewares/upload.middleware');


// Routes Dokumen
router.post('/upload', uploadDocument.single('file'), documentController.uploadDocument);
router.post('/:id/index', documentController.indexDocument);
router.get('/', documentController.getDocuments);
router.get('/:id', documentController.getDocumentById);
router.get('/project/:projectId', documentController.getDocumentsByProject);
router.delete('/:id', documentController.deleteDocument);

module.exports = router;
