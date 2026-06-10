// src/services/chat/chat.service.js

const chatModel = require('../../models/chat.model');
const intentService = require('../ai/intent.service');
const moderationService = require('../ai/moderation.service');
const aiRateLimitService = require('../ai/aiRateLimit.service');
const retrievalService = require('../rag/retrieval.service');
const contextBuilderService = require('../rag/context-builder.service');
const promptService = require('../ai/prompt.service');
const geminiService = require('../ai/gemini.service');
const systemResponseService = require('./system-response.service');
const ruleService = require('./rule.service');
const pageTemplateService = require('../template/page-template.service');

function safeParseObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}

function cleanFeedbackPrompt(message = '') {
  let result = String(message || '').trim();
  const prefix = 'Jawaban sistem sebelumnya belum menyelesaikan masalah saya. Tolong jelaskan lebih detail dan lebih pelan untuk pertanyaan ini:';

  for (let i = 0; i < 10; i += 1) {
    if (!result.toLowerCase().startsWith(prefix.toLowerCase())) break;
    result = result.slice(prefix.length).trim();
  }

  return result || message || '';
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/log\s*in/g, 'login')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SAFE_SYSTEM_INTENTS = [
  'navigasi_kursus',
  'bantuan_dashboard',
  'bantuan_login',
  'akses_materi',
  'bantuan_tugas',
  'bantuan_kuis',
  'penjelasan_materi',
  'general_learning_help',
  'element_question'
];

const HARD_BLOCK_MODERATION_TYPES = ['hate_speech'];

const OBVIOUS_PROFANITY_PATTERNS = [
  /\b(anjing|bangsat|kontol|memek|goblok|tolol|bego|babi)\b/i
];

function hasObviousProfanity(message = '') {
  return OBVIOUS_PROFANITY_PATTERNS.some((pattern) => pattern.test(String(message || '')));
}

function isTemplateProbablyFor(template = {}, targets = []) {
  const haystack = normalizeText([
    template?.page_type,
    template?.template_name,
    template?.match_url_contains,
    template?.match_title_contains,
    template?.match_heading_contains
  ].filter(Boolean).join(' '));
  return targets.some((target) => haystack.includes(normalizeText(target)));
}

async function safeMatchTemplate(projectId, context = {}, sourceUrl = '') {
  try {
    return await pageTemplateService.matchTemplate(projectId, context, sourceUrl);
  } catch (error) {
    console.warn('[chat.service] Gagal match template:', error.message);
    return null;
  }
}

async function buildTemplateMap(projectId, currentPageContext = {}, sourceUrl = '') {
  const current = await safeMatchTemplate(projectId, currentPageContext, sourceUrl);
  const map = { current };

  const candidates = {
    landing: {
      pageType: 'landing', type: 'landing', title: 'VClass', heading: 'Selamat Datang',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/'
    },
    login: {
      pageType: 'login', type: 'login', title: 'Login', heading: 'Login',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/login/index.php'
    },
    dashboard: {
      pageType: 'dashboard', type: 'dashboard', title: 'Kursusku', heading: 'Kursusku',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/my/courses.php'
    },
    course: {
      pageType: 'course', type: 'course', title: 'Informatika', heading: 'Informatika',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/course/view.php?id=2'
    },
    materi: {
      pageType: 'materi', type: 'materi', title: 'Materi', heading: 'Materi',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/page/view.php?id=494'
    },
    summary: {
      pageType: 'summary', type: 'summary', title: 'Rangkuman', heading: 'Rangkuman',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/page/view.php?id=494'
    },
    quiz: {
      pageType: 'quiz', type: 'quiz', title: 'Quiz', heading: 'Quiz',
      sourceUrl: 'https://lms.smpn167jakarta.sch.id/mod/quiz/view.php?id=1'
    }
  };

  for (const [key, ctx] of Object.entries(candidates)) {
    if (current && isTemplateProbablyFor(current, [key])) {
      map[key] = current;
      continue;
    }
    map[key] = await safeMatchTemplate(projectId, ctx, ctx.sourceUrl);
  }

  return map;
}

function selectSystemTemplate({ intent, templateMap }) {
  if (!templateMap) return null;
  if (intent === 'bantuan_login') return templateMap.login || templateMap.landing || templateMap.current;
  if (intent === 'navigasi_kursus' || intent === 'bantuan_dashboard') return templateMap.dashboard || templateMap.current;
  if (intent === 'akses_materi') return templateMap.course || templateMap.materi || templateMap.summary || templateMap.current;
  if (intent === 'penjelasan_materi') return templateMap.summary || templateMap.materi || templateMap.course || templateMap.current;
  return templateMap.current;
}

const chatService = {
  async processMessage({ sessionId, projectId, message, pageContext, elementContext, expectedSourceType, forceAI = false }) {
    const session = await chatModel.getSessionById(sessionId);
    let pageContextState = safeParseObject(session.page_context, {});
    let safetyState = pageContextState.safety_state || { warnings: 0, locked: false, burnout_count: 0 };
    if (typeof safetyState.burnout_count !== 'number') safetyState.burnout_count = 0;
    if (typeof safetyState.warnings !== 'number') safetyState.warnings = 0;

    const pageType = pageContext?.type || pageContext?.pageType || 'guest_home';

    if (safetyState.locked) {
      return {
        response_source: 'system',
        is_locked: true,
        botMessage: { message: 'Chat dikunci. Minta unlock key ke guru.', actions: [] }
      };
    }

    const effectiveMessage = forceAI ? cleanFeedbackPrompt(message) : message;
    const detectedIntent = await intentService.detect(effectiveMessage, elementContext, { allowAIIntent: !forceAI });

    const pageEvaluation = await ruleService.evaluatePageRule(projectId, pageType, detectedIntent);
    if (pageEvaluation.isBlocked) {
      return {
        intent: detectedIntent,
        response_source: 'system',
        botMessage: { message: pageEvaluation.message, actions: [] }
      };
    }

    const templateMap = await buildTemplateMap(projectId, pageContext, session.source_url);
    const matchedTemplate = selectSystemTemplate({ intent: detectedIntent, templateMap });

    if (!forceAI && matchedTemplate && templateMap.current) {
      // Jika ID template yang dituju berbeda dengan ID template halaman saat ini
      if (matchedTemplate.id !== templateMap.current.id) {
        const currentName = templateMap.current.template_name || 'Halaman Saat Ini';
        const targetName = matchedTemplate.template_name || matchedTemplate.page_type || 'Halaman Tujuan';

        return {
          intent: detectedIntent,
          response_source: 'system',
          botMessage: {
            message: `Sepertinya pertanyaanmu berkaitan dengan langkah-langkah di **${targetName}**, tetapi saat ini sistem mendeteksi kamu sedang berada di **${currentName}**.\n\nApakah kamu ingin saya memindahkan fokus konteks ke **${targetName}** agar saya bisa memberikan panduan visualnya?`,
            actions: [
              {
                type: 'switch_context_and_ask',
                label: `Ya, pindah ke ${targetName}`,
                template: matchedTemplate,
                pending_message: effectiveMessage
              }
            ]
          },
          ai_usage: aiRateLimitService.getStatus(sessionId)
        };
      }
    }

    // Moderasi tetap ada, tapi false positive seperti "media sosial" tidak boleh menambah warning/lockdown.
    const moderationResultRaw = moderationService.checkMessage(effectiveMessage);
    const isSafeSystemIntent = SAFE_SYSTEM_INTENTS.includes(detectedIntent);
    const shouldHardBlock = moderationResultRaw?.isFlagged && HARD_BLOCK_MODERATION_TYPES.includes(moderationResultRaw.type);
    const shouldSoftBlock = moderationResultRaw?.isFlagged &&
      moderationResultRaw.type === 'profanity' &&
      !isSafeSystemIntent &&
      hasObviousProfanity(effectiveMessage);

    const moderationResult = (shouldHardBlock || shouldSoftBlock || moderationResultRaw?.type === 'mental_health')
      ? moderationResultRaw
      : { isFlagged: false };

    if (shouldHardBlock || shouldSoftBlock) {
      safetyState.warnings += 1;
      if (safetyState.warnings >= 3) safetyState.locked = true;
      await chatModel.updateSession(sessionId, { page_context: { ...pageContextState, safety_state: safetyState } });
      const sysRes = systemResponseService.buildSystemResponse({ moderationResult });
      return {
        intent: detectedIntent,
        response_source: 'system',
        botMessage: { message: sysRes.text, actions: [] },
        is_locked: safetyState.locked,
        warnings: safetyState.warnings,
        ai_usage: aiRateLimitService.getStatus(sessionId)
      };
    }

    if (detectedIntent === 'bantuan_burnout') {
      safetyState.burnout_count += 1;
      await chatModel.updateSession(sessionId, { page_context: { ...pageContextState, safety_state: safetyState } });
    }

    await chatModel.createMessage({
      session_id: sessionId,
      role: 'user',
      message: forceAI ? `Belum, jelaskan dengan AI: ${effectiveMessage}` : message,
      intent: detectedIntent
    });

    let aiUsage = aiRateLimitService.getStatus(sessionId);
    let retrievalResults = [];
    let contextString = '';

    const skipRetrievalIntents = ['bantuan_burnout', 'out_of_context', 'greeting', 'hubungi_guru'];
    if (!skipRetrievalIntents.includes(detectedIntent)) {
      const finalSourceType = expectedSourceType || pageContext?.expectedSourceType || 'all';
      retrievalResults = await retrievalService.retrieve(projectId, effectiveMessage, pageContext, 3, { sourceType: finalSourceType });
      contextString = contextBuilderService.build(retrievalResults);
    }

    let botMessageText = '';
    let responseSource = 'system';
    let actions = [];
    let aiErrorFallback = false;
    let quotaFallback = false;
    let usedModel = null;

    const sysRes = systemResponseService.buildSystemResponse({
      message: effectiveMessage,
      intent: detectedIntent,
      moderationResult,
      retrievalResults,
      pageContext,
      elementContext,
      aiUsage,
      matchedTemplate,
      templateMap,
      burnoutCount: safetyState.burnout_count
    });

    const hardStrictIntents = ['minta_jawaban_langsung', 'quiz_answer_request', 'out_of_context'];
    const isHardStrict =
      hardStrictIntents.includes(detectedIntent) ||
      (moderationResult?.isFlagged && ['hate_speech', 'profanity'].includes(moderationResult.type));

    const canForceAI = forceAI && aiUsage.canUseAI && !isHardStrict;
    const shouldUseAI = canForceAI || (aiUsage.canUseAI && !sysRes.strict);

    if (!shouldUseAI && sysRes.strict) {
      botMessageText = sysRes.text;
      actions = sysRes.actions || [];
      responseSource = 'system';
    } else {
      const actionRule = await ruleService.findActionRule(projectId, detectedIntent, effectiveMessage, pageType);

      if (!forceAI && !sysRes.strict && matchedTemplate?.tutorial_steps_json) {
        const tutorialSteps = Array.isArray(matchedTemplate.tutorial_steps_json)
          ? matchedTemplate.tutorial_steps_json
          : (() => { try { return JSON.parse(matchedTemplate.tutorial_steps_json); } catch (_) { return []; } })();
        const relevantTutorial = tutorialSteps.filter(step => step.flow_key === detectedIntent || step.intent === detectedIntent);

        if (relevantTutorial.length > 0) {
          botMessageText = 'Mari ikuti panduan berikut ini:';
          actions = [{ type: 'tutorial_flow', label: 'Mulai Tutorial', tutorial_steps: relevantTutorial }];
          responseSource = 'system';
        }
      }

      if (!botMessageText && !forceAI && actionRule && !sysRes.strict) {
        botMessageText = actionRule.response_message;
        actions = [{ type: actionRule.action_type, label: actionRule.action_label, url: actionRule.target_url, selector: actionRule.target_selector }];
        responseSource = 'system';
      }

      if (!botMessageText && shouldUseAI) {
        try {
          const promptPrefix = forceAI
          ? `User menekan tombol "Belum, jelaskan dengan AI" karena jawaban sistem sebelumnya belum menyelesaikan masalah.\nJangan ulangi jawaban sistem yang sama.\nJelaskan lebih detail, pelan, dan praktis sesuai konteks halaman VClass.\nGunakan konteks template/elemen halaman bila tersedia, tapi jangan membuat tombol palsu.\nJangan memberikan jawaban kuis langsung.\n\nPertanyaan asli user:\n${effectiveMessage}\n\n`
          : '';

          let templateContextString = '';
          if (matchedTemplate && (matchedTemplate.tutorial_steps_json || matchedTemplate.elements_json)) {
            templateContextString = JSON.stringify({
              tutorial_steps: typeof matchedTemplate.tutorial_steps_json === 'string' ? safeParseObject(matchedTemplate.tutorial_steps_json, []) : (matchedTemplate.tutorial_steps_json || []),
              elements: typeof matchedTemplate.elements_json === 'string' ? safeParseObject(matchedTemplate.elements_json, []) : (matchedTemplate.elements_json || [])
            });
          }

          // Injeksi parameter `templateContextString` di akhir argumen
          const prompt = promptPrefix + promptService.buildPrompt(
            effectiveMessage,
            contextString,
            pageContext,
            detectedIntent,
            elementContext,
            templateContextString
          );

          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), process.env.AI_GEMINI_TIMEOUT_MS || 15000));
          const geminiResult = await Promise.race([geminiService.generateWithFallback(prompt), timeoutPromise]);

          if (geminiResult.ok) {
            usedModel = geminiResult.model;
            aiUsage = aiRateLimitService.consume(sessionId);

            if (geminiResult.text.includes('[SYSTEM_FLAG_SARA_VIOLATION]')) {
              safetyState.warnings += 1;
              if (safetyState.warnings >= 3) safetyState.locked = true;
              await chatModel.updateSession(sessionId, { page_context: { ...pageContextState, safety_state: safetyState } });

              botMessageText = 'Sistem AI mendeteksi bahasa yang tidak pantas atau tidak sopan. Mari gunakan bahasa yang baik ya.';
              if (safetyState.locked) botMessageText = 'Akses chat dikunci karena pelanggaran berulang.';
              responseSource = 'system';
              actions = [];
            } else {
              botMessageText = geminiResult.text;
              responseSource = 'ai';
              actions = forceAI
                ? (sysRes.actions || []).filter((action) => ['inline_visual', 'open_pdf_viewer'].includes(action.type))
                : (sysRes.actions || []);
            }
          } else if (geminiResult.quotaFallback) {
            aiErrorFallback = true;
            quotaFallback = true;
            responseSource = 'fallback';
            const fallbackRes = systemResponseService.buildSystemResponse({
              message: effectiveMessage,
              intent: detectedIntent,
              moderationResult,
              retrievalResults,
              pageContext,
              elementContext,
              aiUsage,
              matchedTemplate,
              templateMap,
              burnoutCount: safetyState.burnout_count,
              isErrorFallback: true,
              fallbackType: 'quota'
            });
            botMessageText = fallbackRes.text;
            actions = fallbackRes.actions || [];
          }
        } catch (error) {
          aiErrorFallback = true;
          responseSource = 'fallback';
          const fallbackRes = systemResponseService.buildSystemResponse({
            message: effectiveMessage,
            intent: detectedIntent,
            moderationResult,
            retrievalResults,
            pageContext,
            elementContext,
            aiUsage,
            matchedTemplate,
            templateMap,
            burnoutCount: safetyState.burnout_count,
            isErrorFallback: true,
            fallbackType: 'error'
          });
          botMessageText = fallbackRes.text;
          actions = fallbackRes.actions || [];
        }
      }

      if (!botMessageText) {
        botMessageText = sysRes.text;
        actions = sysRes.actions || [];
        responseSource = 'system';
      }
    }

    await chatModel.createMessage({
      session_id: sessionId,
      role: 'assistant',
      message: botMessageText,
      intent: detectedIntent,
      context_used: {
        response_source: responseSource,
        actions,
        ai_error_fallback: aiErrorFallback,
        quota_fallback: quotaFallback,
        used_model: usedModel,
        force_ai: !!forceAI,
        template_page_type: matchedTemplate?.page_type || null
      }
    });

    return {
      intent: detectedIntent,
      response_source: responseSource,
      ai_usage: aiUsage,
      ai_error_fallback: aiErrorFallback,
      quota_fallback: quotaFallback,
      used_model: usedModel,
      is_locked: safetyState.locked,
      warnings: safetyState.warnings,
      botMessage: { message: botMessageText, actions }
    };
  }
};

module.exports = chatService;
