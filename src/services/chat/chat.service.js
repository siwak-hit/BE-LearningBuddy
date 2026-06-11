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
const activityModel = require('../../models/activity.model');
const lmsRouteModel = require('../../models/lmsRoute.model');

function safeParseObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  'bantuan_forum',
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

function normalizeClassCode(value = '') {
  const raw = String(value || '').toUpperCase().trim();

  const match = raw.match(/\b(8\s*[A-H])\b/i);
  if (!match) return '';

  return match[1].replace(/\s+/g, '');
}

function getClassCodeFromSession(session = {}) {
  const courseContext = safeParseObject(session.course_context, {});
  const pageContext = safeParseObject(session.page_context, {});

  return (
    normalizeClassCode(courseContext.class_code) ||
    normalizeClassCode(courseContext.classCode) ||
    normalizeClassCode(courseContext.kelas) ||
    normalizeClassCode(pageContext.session_meta?.class_code) ||
    normalizeClassCode(pageContext.session_meta?.kelas) ||
    normalizeClassCode(pageContext.session_meta?.display_name) ||
    normalizeClassCode(session.student_alias)
  );
}

function getCourseIdFromUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''), 'https://lms.smpn167jakarta.sch.id');
    const id = parsed.searchParams.get('id');
    return id ? Number(id) : null;
  } catch (_) {
    return null;
  }
}

function buildCourseUrl(courseId = 2) {
  return `https://lms.smpn167jakarta.sch.id/course/view.php?id=${encodeURIComponent(courseId)}`;
}

async function getCourseRoute(projectId, classCode, fallbackCourseId = 2) {
  if (classCode) {
    try {
      const route = await lmsRouteModel.findCourseRoute(projectId, classCode);
      if (route) return route;
    } catch (error) {
      console.warn('[chat.service] Gagal mengambil lms_course_routes:', error.message);
    }
  }

  return {
    class_code: classCode || '',
    course_id: fallbackCourseId || 2,
    course_url: buildCourseUrl(fallbackCourseId || 2),
    course_title: classCode ? `Informatika Kelas ${classCode}` : 'Kursus Informatika'
  };
}

async function getActivityRoute(projectId, classCode, activityTitle, courseId) {
  if (!classCode || !activityTitle || !courseId) return null;

  try {
    return await lmsRouteModel.findActivityRoute(
      projectId,
      classCode,
      courseId,
      activityTitle
    );
  } catch (error) {
    console.warn('[chat.service] Gagal mengambil lms_activity_routes:', error.message);
    return null;
  }
}

async function buildActivityActionButton({ projectId, session, activity }) {
  const classCode = getClassCodeFromSession(session);

  const fallbackCourseId =
    getCourseIdFromUrl(session.source_url) ||
    getCourseIdFromUrl(safeParseObject(session.page_context, {}).sourceUrl) ||
    null;

  const courseRoute = await getCourseRoute(projectId, classCode, fallbackCourseId || 2);

  const activityRoute = await getActivityRoute(
    projectId,
    classCode,
    activity.title,
    courseRoute.course_id
  );

  if (activityRoute?.activity_url) {
    return `
      <button
        type="button"
        class="btn-return-source bg-primary text-white px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
        data-url="${escapeHtml(activityRoute.activity_url)}"
        data-page-type="activity"
        data-course-id="${escapeHtml(activityRoute.course_id)}">
        Lihat Tugas
      </button>
    `;
  }

  if (courseRoute?.course_url) {
    return `
      <button
        type="button"
        class="btn-return-source bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
        data-url="${escapeHtml(courseRoute.course_url)}"
        data-page-type="course"
        data-course-id="${escapeHtml(courseRoute.course_id)}">
        Lihat Tugas
      </button>
    `;
  }

  return `
    <span class="text-[11px] text-slate-400 whitespace-nowrap">
      Link belum tersedia
    </span>
  `;
}

function getClassDisplayNameFromSession(session = {}) {
  const classCode = getClassCodeFromSession(session);
  return classCode || 'kelas saat ini';
}

function getActivityTypeOrder(activityType = '') {
  const normalized = normalizeText(activityType);

  if (
    normalized.includes('assigment') ||
    normalized.includes('assignment') ||
    normalized.includes('tugas') ||
    normalized.includes('assign')
  ) {
    return 1;
  }

  if (
    normalized.includes('forum') ||
    normalized.includes('diskusi')
  ) {
    return 2;
  }

  if (
    normalized.includes('quiz') ||
    normalized.includes('kuis') ||
    normalized.includes('pilihan ganda')
  ) {
    return 3;
  }

  return 99;
}

function sortActivitiesByTypeAsc(activities = []) {
  return [...activities].sort((a, b) => {
    const orderA = getActivityTypeOrder(a.activity_type);
    const orderB = getActivityTypeOrder(b.activity_type);

    if (orderA !== orderB) return orderA - orderB;

    return String(a.title || '').localeCompare(String(b.title || ''), 'id');
  });
}

const chatService = {
  async processMessage({ sessionId, projectId, message, pageContext, elementContext, expectedSourceType, forceAI = false, forceFAQ = false, responseMode = 'default', intent = null }) {
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

    // Gunakan intent bawaan tombol jika tersedia, jika tidak jalankan deteksi otomatis
    const detectedIntent = intent || await intentService.detect(effectiveMessage, elementContext, { allowAIIntent: !forceAI });

// =======================================================
    // FITUR BARU: LOGIKA BYPASS FAQ UNTUK PANDUAN CEPAT
    // =======================================================
    if (forceFAQ) {
      // 1. HARD BYPASS: HUBUNGI GURU (Tanpa ke FAQ)
      if (detectedIntent === 'hubungi_guru') {
        return {
          intent: detectedIntent,
          response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          is_locked: safetyState.locked,
          warnings: safetyState.warnings,
          botMessage: {
            message: 'Silakan hubungi **Bapak Ilyas** (Guru/Admin VClass) dengan menekan tombol di bawah ini untuk menceritakan kendala yang kamu alami.',
            actions: [{ type: 'wa_teacher', label: 'Hubungi Pak Ilyas via WA' }]
          }
        };
      }

      // 2. HARD BYPASS: CEK TUGAS & DEADLINE (Ambil Semua dari tabel Activity tanpa filter skor)
      if (detectedIntent === 'tanya_deadline') {
        let activities = [];

        try {
          activities = await activityModel.findByProjectId(projectId);
        } catch (err) {
          console.error('Gagal meload tabel aktivitas:', err);
        }

        const classDisplayName = getClassDisplayNameFromSession(session);

        if (activities && activities.length > 0) {
          const sortedActivities = sortActivitiesByTypeAsc(activities);

          let tableHtml = `
            <details class="alb-task-accordion group border border-hairline rounded-2xl mt-4 mb-3 bg-white overflow-hidden shadow-sm" open>
              <summary class="cursor-pointer select-none list-none bg-surface-strong hover:bg-hairline-strong px-4 py-3 border-b border-hairline flex items-center justify-between gap-3">
                <span class="font-bold text-[14px] text-ink">
                  List tugas - kelas ${escapeHtml(classDisplayName)}
                </span>
                <i class="fa-solid fa-chevron-down text-[12px] text-muted-soft group-open:rotate-180 transition-transform duration-300"></i>
              </summary>

              <div class="overflow-x-auto">
                <table class="w-full text-left text-[13px] m-0">
                  <thead class="bg-surface-card border-b border-hairline">
                    <tr>
                      <th class="p-3 font-semibold text-ink whitespace-nowrap">Nama Tugas</th>
                      <th class="p-3 font-semibold text-ink whitespace-nowrap">Jenis</th>
                      <th class="p-3 font-semibold text-ink whitespace-nowrap text-center">Deadline</th>
                      <th class="p-3 font-semibold text-ink whitespace-nowrap text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-hairline bg-white">
          `;

          for (const act of sortedActivities.slice(0, 10)) {
            const title = escapeHtml(act.title || 'Tugas');
            const type = escapeHtml(act.activity_type || '-');

            let deadlineText = act.deadline
              ? new Date(act.deadline).toLocaleString('id-ID')
              : '';

            if (!deadlineText) {
              deadlineText = `
                <button
                  type="button"
                  class="btn-wa-specific-task w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-colors shadow-sm whitespace-nowrap"
                  data-task="${title}">
                  <i class="fa-brands fa-whatsapp mr-1"></i> Tanya Guru
                </button>
              `;
            } else {
              deadlineText = `<span class="text-semantic-error font-medium whitespace-nowrap">${escapeHtml(deadlineText)}</span>`;
            }

            const actionButton = await buildActivityActionButton({
              projectId,
              session,
              activity: act
            });

            tableHtml += `
              <tr class="hover:bg-slate-50">
                <td class="p-3 font-medium text-primary align-top leading-snug">${title}</td>
                <td class="p-3 align-top">
                  <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border border-slate-200">
                    ${type}
                  </span>
                </td>
                <td class="p-3 align-top text-center align-middle">${deadlineText}</td>
                <td class="p-3 align-top text-center align-middle">${actionButton}</td>
              </tr>
            `;
          }

          tableHtml += `
                  </tbody>
                </table>
              </div>
            </details>
          `;

          return {
            intent: detectedIntent,
            response_source: 'system',
            ai_usage: aiRateLimitService.getStatus(sessionId),
            is_locked: safetyState.locked,
            warnings: safetyState.warnings,
            botMessage: {
              message: `Berikut adalah rincian aktivitas pembelajaran kelas ${escapeHtml(classDisplayName)} yang terdaftar di sistem:\n${tableHtml}`,
              actions: []
            }
          };
        }

        return {
          intent: detectedIntent,
          response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          botMessage: {
            message: `Saat ini belum ada informasi deadline atau tugas spesifik untuk kelas ${escapeHtml(classDisplayName)} yang tercatat di tabel aktivitas.\n\n[ACCORDION=Mau menanyakan jadwal tugas?]Silakan klik tombol WA di bawah ini untuk bertanya langsung ke Pak Ilyas terkait jadwal aktivitas.[/ACCORDION]`,
            actions: [{ type: 'wa_teacher', label: 'Hubungi Pak Ilyas via WA' }]
          }
        };
      }

      // 3. NORMAL FAQ FLOW (Lupa Password, Kumpul Tugas, dll)
      const faqResults = await retrievalService.retrieve(projectId, effectiveMessage, pageContext, 1, { sourceType: 'faq' });

      if (faqResults.length > 0 && faqResults[0].score >= 5) {
        let faqMessage = faqResults[0].content;

        // Label Diperpendek agar rapi di HP
        let actions = [{ type: 'ask_ai', label: '✨ Tanya AI', payload: { forceAI: true, forceFAQ: false, intent: detectedIntent } }];

        if (detectedIntent === 'bantuan_lupa_password') {
          faqMessage += '\n\n[ACCORDION=Mau menghubungi guru?]Jika langkah di atas tidak berhasil atau emailmu tidak aktif, silakan klik tombol WA di bawah ini untuk meminta reset password ke Pak Ilyas.[/ACCORDION]';
          actions.push({ type: 'wa_teacher', label: 'Hubungi Pak Ilyas via WA' });
        }

        return {
          intent: detectedIntent,
          response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          is_locked: safetyState.locked,
          warnings: safetyState.warnings,
          botMessage: { message: faqMessage, actions: actions }
        };
      } else {
        return {
          intent: detectedIntent,
          response_source: 'system',
          ai_usage: aiRateLimitService.getStatus(sessionId),
          is_locked: safetyState.locked,
          warnings: safetyState.warnings,
          botMessage: {
            message: 'Panduan tertulis belum tersedia di data FAQ.',
            actions: [
              { type: 'ask_ai', label: '✨ Tanya AI', payload: { forceAI: true, forceFAQ: false, intent: detectedIntent } },
              { type: 'wa_teacher', label: 'Hubungi Pak Ilyas via WA' }
            ]
          }
        };
      }
    }
    // =======================================================

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
      let finalSourceType = expectedSourceType || pageContext?.expectedSourceType || 'all';

      // Pertanyaan materi harus fokus ke dokumen materi,
      // supaya tidak ketarik FAQ/activity/tugas.
      if (detectedIntent === 'penjelasan_materi' || detectedIntent === 'general_learning_help') {
        finalSourceType = 'document_chunk';
      }

      // Pertanyaan teknis sistem tetap boleh FAQ.
      if (forceFAQ) {
        finalSourceType = 'faq';
      }

      retrievalResults = await retrievalService.retrieve(
        projectId,
        effectiveMessage,
        pageContext,
        3,
        { sourceType: finalSourceType }
      );
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
            templateContextString,
            responseMode // Teruskan preferensi panjang jawaban ke AI
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
