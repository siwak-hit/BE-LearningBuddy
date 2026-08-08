const express = require('express');
const studentSessionController = require('../controllers/studentSession.controller');

const router = express.Router();

router.get('/reuse', studentSessionController.reuse);
router.post('/register', studentSessionController.register);
router.post('/sus', studentSessionController.submitSus);
router.delete('/session/:sessionId', studentSessionController.remove);

module.exports = router;
