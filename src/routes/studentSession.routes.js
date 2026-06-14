const express = require('express');
const studentSessionController = require('../controllers/studentSession.controller');

const router = express.Router();

router.get('/reuse', studentSessionController.reuse);
router.post('/register', studentSessionController.register);
router.delete('/session/:sessionId', studentSessionController.remove);

module.exports = router;
