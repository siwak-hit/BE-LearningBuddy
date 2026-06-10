// src/routes/template.routes.js
const express = require('express');
const router = express.Router();
const pageTemplateController = require('../controllers/page-template.controller'); // Pastikan controller ini sudah dibuat sesuai panduan sebelumnya

// Rute untuk melakukan matching template dari external workspace
router.get('/match', pageTemplateController.match);
router.get('/list', pageTemplateController.list);
router.get('/proxy-asset', pageTemplateController.proxyAsset)

// Rute untuk import HTML statis menjadi template (Endpoint Admin/Sistem)
// router.post('/import', upload.single('html_file'), pageTemplateController.importTemplate);

module.exports = router;
