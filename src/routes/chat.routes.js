const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { chatLimiter } = require('../middlewares/rate-limit.middleware');

router.post('/session', chatController.createSession);
// [SECURITY] /send memanggil Gemini → limiter per-IP lindungi kuota bersama.
router.post('/send', chatLimiter, chatController.sendMessage);
router.post('/feedback', chatController.recordFeedback);
router.get('/ai-queue/status', chatController.getAiQueueStatus);
router.get('/ai-usage-global', chatController.getGlobalAiUsage); // [v0.9.1] pemakaian AI bersama

router.get('/session/:sessionId', chatController.getSessionById);
router.get('/history/:sessionId', chatController.getHistory);
router.get('/session-materials/:sessionId', chatController.getSessionMaterials);
router.get('/session-activities/:sessionId', chatController.getSessionActivities); // [v0.9.17] dropdown form Komplain
router.get('/quiz-questions/:sessionId', chatController.getQuizQuestions); // [v0.9.19] preview soal Komplain Kuis
router.post('/quiz-dispute', chatController.submitQuizDispute); // [v0.9.19] analisis sengketa Komplain Kuis
router.get('/course-students/:sessionId', chatController.getCourseStudents); // [v0.9.26] fallback dropdown nama
router.post('/session/:sessionId/identify', chatController.identifyStudent); // [v0.9.26] set identitas siswa
router.get('/student-courses/:sessionId', chatController.getStudentCourses); // [v0.9.13] ganti course konteks
router.get('/ai-usage/:sessionId', chatController.getAiUsage);
router.post('/unlock', chatController.unlockChat);
router.get('/state/:sessionId', chatController.getSessionState);
router.get('/suggestions', chatController.getSuggestions);
router.patch('/session/:sessionId/profile', chatController.updateProfile);
router.patch('/session/:sessionId/context', chatController.updateSessionContext);

module.exports = router;
