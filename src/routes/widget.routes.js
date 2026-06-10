const express = require('express');
const widgetController = require('../controllers/widget.controller');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

router.post('/config', asyncHandler(widgetController.create));
router.get('/config/:projectKey', asyncHandler(widgetController.getByProjectKey));
router.put('/config/:id', asyncHandler(widgetController.update));
router.get('/loader.js', asyncHandler(widgetController.getLoaderScript));
router.get('/external-loader.js', asyncHandler(widgetController.getExternalLoaderScript));

module.exports = router;
