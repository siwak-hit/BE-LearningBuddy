const express = require('express');
const widgetController = require('../controllers/widget.controller');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

// [SECURITY] Membuat/mengubah konfigurasi widget = admin. GET config & loader.js
// dipakai siswa untuk merender widget → tetap publik.
router.post('/config', requireAuth, asyncHandler(widgetController.create));
router.get('/config/:projectKey', asyncHandler(widgetController.getByProjectKey));
router.put('/config/:id', requireAuth, asyncHandler(widgetController.update));
router.get('/loader.js', asyncHandler(widgetController.getLoaderScript));
router.get('/external-loader.js', asyncHandler(widgetController.getExternalLoaderScript));

module.exports = router;
