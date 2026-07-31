const express = require('express');

const healthRoutes = require('./health.routes');
const projectRoutes = require('./project.routes');
const widgetRoutes = require('./widget.routes');
const chatRoutes = require('./chat.routes');
const knowledgeRoutes = require('./knowledge.routes');
const documentRoutes = require('./document.routes');
const ragRoutes = require('./rag.routes');
const authController = require('../controllers/auth.controller');
const logRoutes = require('./log.routes');
const templateRoutes = require('./template.routes');
const moodleRoutes = require('./moodle.routes');
const studentNoteRoutes = require('./studentNote.routes');
const studentSessionRoutes = require('./studentSession.routes');
const analyticsRoutes = require('./analytics.routes');
const { authLimiter } = require('../middlewares/rate-limit.middleware');

const router = express.Router();

router.use(healthRoutes);
router.use('/projects', projectRoutes);
router.use('/widget', widgetRoutes);
router.use('/chat', chatRoutes);
router.use('/knowledge', knowledgeRoutes);
router.use('/documents', documentRoutes);
router.use('/rag', ragRoutes);
router.post('/auth/login', authLimiter, authController.login);
router.post('/auth/register', authLimiter, authController.register);
router.use('/logs', logRoutes);
router.use('/page-templates', templateRoutes);
router.use('/moodle', moodleRoutes);
router.use('/student-notes', studentNoteRoutes);
router.use('/student-sessions', studentSessionRoutes);
router.use('/analytics', analyticsRoutes);

module.exports = router;
