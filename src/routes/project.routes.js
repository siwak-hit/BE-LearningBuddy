const express = require('express');
const projectController = require('../controllers/project.controller');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

router.post('/', asyncHandler(projectController.create));
router.get('/', asyncHandler(projectController.findAll));
router.get('/:id', asyncHandler(projectController.findById));
router.put('/:id', asyncHandler(projectController.update));
router.delete('/:id', asyncHandler(projectController.delete));

module.exports = router;
