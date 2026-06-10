const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');

router.post('/session', chatController.createSession);
router.post('/send', chatController.sendMessage);
router.get('/session/:sessionId', chatController.getSessionById);
router.get('/history/:sessionId', chatController.getHistory);
router.get('/ai-usage/:sessionId', chatController.getAiUsage);
router.post('/unlock', chatController.unlockChat);
router.get('/state/:sessionId', chatController.getSessionState);
router.get('/suggestions', chatController.getSuggestions);
router.patch('/session/:sessionId/profile', chatController.updateProfile);
router.patch('/session/:sessionId/context', chatController.updateSessionContext);

module.exports = router;
