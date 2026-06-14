// BE/services/moodle/lms-context.service.js
const lmsRouteModel = require('../../models/lmsRoute.model');
const moodleConfigModel = require('../../models/moodleConfig.model');
const moodleService = require('./moodle.service');

const LMS_BASE_URL = 'https://lms.smpn167jakarta.sch.id';
const LMS_CONTEXT_CACHE_TTL_MS = parseInt(process.env.LMS_CONTEXT_CACHE_TTL_MS || '45000', 10);
const lmsContextCache = new Map();

function getLmsCacheKey({ projectId, courseId, classCode, moodleUserId, intent }) {
  return [projectId || '-', courseId || '-', classCode || '-', moodleUserId || 'guest', intent || 'all'].join(':');
}

function readLmsCache(key) {
  const hit = lmsContextCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > LMS_CONTEXT_CACHE_TTL_MS) {
    lmsContextCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeLmsCache(key, value) {
  if (!key || !value) return;
  lmsContextCache.set(key, { createdAt: Date.now(), value });
}

function intentNeedsActivities(intent = '') {
  const value = String(intent || '');
  return !['cek_pengajar_course', 'cek_course_saya'].includes(value);
}

function isLearningModuleType(type = '') {
  return ['assign', 'quiz', 'forum', 'page', 'resource', 'url', 'folder', 'book'].includes(String(type || '').toLowerCase());
}

function intentNeedsType(intent = '', type = '') {
  const value = String(intent || '');
  const modType = String(type || '').toLowerCase();

  // Untuk course yang linear/berurutan, backend harus membaca SEMUA modul dari
  // core_course_get_contents dulu. Penyaringan tugas/kuis/forum dilakukan di
  // system-response.service. Kalau di sini dipersempit, modul target yang masih
  // terkunci sering tidak ikut terbaca.
  if (['cek_tugas_belum_selesai', 'cek_quiz_belum_dikerjakan', 'cek_forum_belum_dijawab', 'cek_aktivitas_course'].includes(value)) {
    return isLearningModuleType(modType);
  }

  if (!value || value.includes('deadline')) return isLearningModuleType(modType);
  if (modType === 'assign') return value.includes('tugas') || value.includes('assignment');
  if (modType === 'quiz') return value.includes('quiz') || value.includes('kuis');
  if (modType === 'forum') return value.includes('forum');
  return false;
}

function normalizeActivityTypeLocal(type = '') {
  const value = String(type || '').toLowerCase();
  if (value === 'assignment') return 'assign';
  if (['page', 'resource', 'url', 'folder', 'book'].includes(value)) return 'materi';
  return value;
}

function getModuleDeadline(module = {}) {
  const dates = Array.isArray(module.dates) ? module.dates : [];
  const deadlineDate = dates.find((date) => {
    const label = String(date.label || date.name || '').toLowerCase();
    return label.includes('due') || label.includes('deadline') || label.includes('close') || label.includes('tenggat') || label.includes('batas');
  });
  const timestamp = Number(deadlineDate?.timestamp || deadlineDate?.time || 0);
  return timestamp ? toIsoDate(timestamp) : null;
}

function getAvailabilityText(module = {}) {
  return stripHtml(module.availabilityinfo || module.availability_info || module.afterlink || '');
}

function normalizeClassCode(value = '') {
  const raw = String(value || '').toUpperCase().trim();
  const match = raw.match(/\b((?:7|8|9|10|11|12)\s*[A-Z])\b/i);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function safeParseObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}

function getClassCodeFromSession(session = {}) {
  const courseContext = safeParseObject(session.course_context, {});
  const pageContext = safeParseObject(session.page_context, {});
  const meta = pageContext.session_meta || {};

  return (
    normalizeClassCode(courseContext.class_code) ||
    normalizeClassCode(courseContext.classCode) ||
    normalizeClassCode(courseContext.kelas) ||
    normalizeClassCode(meta.class_code) ||
    normalizeClassCode(meta.kelas) ||
    normalizeClassCode(meta.display_name) ||
    normalizeClassCode(session.student_alias)
  );
}

function normalizeCourseId(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function getMoodleBaseUrl(config = {}) {
  const endpoint = String(config.rest_endpoint || '').trim();
  if (!endpoint) return LMS_BASE_URL;
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return endpoint.replace(/\/webservice\/rest\/server\.php.*$/i, '').replace(/\/$/, '') || LMS_BASE_URL;
  }
}

function toIsoDate(unixTime) {
  const value = Number(unixTime || 0);
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSectionMap(contents = []) {
  const map = new Map();
  let orderIndex = 0;
  let previousModuleId = null;

  (contents || []).forEach((section) => {
    const sectionName = section.name || `Section ${section.section ?? section.id ?? ''}`.trim();
    (section.modules || []).forEach((module) => {
      orderIndex += 1;
      const availabilityInfo = getAvailabilityText(module);
      const visible = module.visible === true || module.visible === 1;
      const userVisible = module.uservisible !== false;
      const visibleOnCoursePage = module.visibleoncoursepage !== 0;

      // Jangan langsung menganggap availabilityinfo = terkunci permanen.
      // Pada course linear, Moodle tetap mengirim availabilityinfo meski prasyaratnya
      // sudah selesai untuk user tertentu. Status terkunci final dihitung lagi setelah
      // core_completion_get_activities_completion_status digabung berdasarkan cmid.
      map.set(Number(module.id), {
        section_name: sectionName,
        section_number: section.section,
        sequence_order: orderIndex,
        url: module.url || null,
        visible,
        uservisible: userVisible,
        visibleoncoursepage: visibleOnCoursePage,
        available: visible && userVisible && visibleOnCoursePage,
        availability_info: availabilityInfo,
        availability_raw: module.availability || null,
        previous_module_id: previousModuleId,
        completion: module.completion,
        completiondata: module.completiondata || null,
        dates: module.dates || [],
        modname: module.modname,
        instance: module.instance,
        title: module.name
      });

      previousModuleId = Number(module.id) || previousModuleId;
    });
  });
  return map;
}

function safeParseAvailability(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function collectCompletionRequirements(condition, previousModuleId, result = []) {
  if (!condition || typeof condition !== 'object') return result;

  if (condition.type === 'completion') {
    const rawCm = Number(condition.cm || 0);
    const cmid = rawCm === -1 ? Number(previousModuleId || 0) : rawCm;
    if (cmid) result.push({ cmid, expected: condition.e });
    return result;
  }

  if (Array.isArray(condition.c)) {
    condition.c.forEach((child) => collectCompletionRequirements(child, previousModuleId, result));
  }

  return result;
}

function getActivityCompletionRequirements(activity = {}) {
  const availability = safeParseAvailability(activity.availability_raw);
  return collectCompletionRequirements(availability, activity.previous_module_id, []);
}

function isCompletionStatusComplete(status = {}) {
  const state = Number(status.state);
  return status.isoverallcomplete === true || [1, 2, 3].includes(state);
}

function isActivityLockedForStudent(activity = {}, statusMap = new Map()) {
  if (activity.is_visible === false) return true;
  if (activity.base_available === false) return true;

  const requirements = getActivityCompletionRequirements(activity);
  if (!requirements.length) {
    // Kalau Moodle hanya mengirim teks availability tanpa struktur JSON, tetap anggap
    // belum terbuka supaya tidak mengarahkan siswa ke detail modul yang mungkin diblok.
    return Boolean(activity.availability_info);
  }

  return requirements.some((req) => !isCompletionStatusComplete(statusMap.get(Number(req.cmid)) || {}));
}

function normalizeActivity({ config, courseId, classCode, courseName, item, type, moodleType, cmid, instanceId, title, intro, deadline, sectionMap, orderIndex = 0 }) {
  const baseUrl = getMoodleBaseUrl(config);
  const moduleId = Number(cmid || 0);
  const fromSection = sectionMap?.get(moduleId);
  const moduleType = String(moodleType || type || '').toLowerCase();
  const normalizedType = normalizeActivityTypeLocal(moduleType);
  const courseUrl = `${baseUrl}/course/view.php?id=${encodeURIComponent(courseId)}`;
  const url = fromSection?.url || item?.url || `${baseUrl}/mod/${moduleType}/view.php?id=${encodeURIComponent(moduleId)}`;

  const availabilityInfo = fromSection?.availability_info || getAvailabilityText(item);
  const isVisible = fromSection ? Boolean(fromSection.visible && fromSection.visibleoncoursepage) : item?.visible !== false;
  const baseAvailable = fromSection ? Boolean(fromSection.available && fromSection.uservisible) : item?.uservisible !== false;
  const lockedByAvailability = Boolean(availabilityInfo);
  const isAvailable = Boolean(baseAvailable && !lockedByAvailability);

  const completionData = fromSection?.completiondata || item?.completiondata || null;
  const completionState = completionData?.state ?? item?.completionstate ?? null;
  const completionEnabled = Number(fromSection?.completion || item?.completion || 0) > 0 || completionData !== null;
  const completedFromModule = completionData?.isoverallcomplete === true || [1, 2, 3].includes(Number(completionState));
  const derivedDeadline = deadline || getModuleDeadline(item) || getModuleDeadline(fromSection || {});
  const finalOrderIndex = Number(orderIndex || fromSection?.sequence_order || item?.sequence_order || 9999);

  let status = 'Belum diketahui';
  if (lockedByAvailability || !isAvailable) status = 'Belum terbuka';
  else if (completionEnabled) status = completedFromModule ? 'Selesai' : 'Belum selesai';

  return {
    type: normalizedType,
    activity_type: normalizedType,
    moodle_activity_type: moduleType,
    forum_type: item?.type || null,
    title: stripHtml(title || item?.name || 'Aktivitas Moodle'),
    description: stripHtml(intro || item?.intro || item?.description || ''),
    section_name: fromSection?.section_name || `Course ${courseId}`,
    section_number: fromSection?.section_number ?? item?.section ?? null,
    deadline: derivedDeadline || null,
    status,
    url,
    activity_url: url,
    course_url: courseUrl,
    action_url: isAvailable ? url : courseUrl,
    module_id: moduleId || null,
    instance_id: Number(instanceId || item?.id || item?.instance || 0) || null,
    is_visible: isVisible,
    is_available: isAvailable,
    availability_info: availabilityInfo,
    availability_raw: fromSection?.availability_raw || item?.availability || null,
    previous_module_id: fromSection?.previous_module_id || item?.previous_module_id || null,
    base_available: baseAvailable,
    completion_enabled: completionEnabled,
    completion_state: completionState,
    is_completed: completedFromModule,
    completion_rule: Array.isArray(completionData?.details) ? completionData.details.map((d) => d?.rulevalue?.description).filter(Boolean).join(', ') : '',
    sequence_order: finalOrderIndex,
    source: 'moodle_live',
    course_id: Number(courseId),
    class_code: classCode || null,
    course_name: courseName || null
  };
}

function dedupeActivities(activities = []) {
  const byKey = new Map();
  const ordered = activities
    .slice()
    .sort((a, b) => Number(a.sequence_order || 9999) - Number(b.sequence_order || 9999));

  ordered.forEach((activity) => {
    const key = `${activity.course_id || ''}:${activity.module_id || ''}:${activity.title || ''}`;
    if (!byKey.has(key)) {
      byKey.set(key, activity);
      return;
    }

    // Merge detail dari endpoint khusus assign/quiz/forum ke row awal dari course contents.
    const current = byKey.get(key);
    const availabilityInfo = current.availability_info || activity.availability_info || '';
    const isAvailable = Boolean((current.is_available !== false && activity.is_available !== false) && !availabilityInfo);
    const completed = current.is_completed === true || activity.is_completed === true;
    byKey.set(key, {
      ...current,
      type: current.type || activity.type,
      deadline: current.deadline || activity.deadline || null,
      description: current.description || activity.description || '',
      instance_id: current.instance_id || activity.instance_id || null,
      url: current.url || activity.url || activity.activity_url || null,
      activity_url: current.activity_url || activity.activity_url || activity.url || null,
      course_url: current.course_url || activity.course_url || null,
      action_url: isAvailable ? (current.url || activity.url || activity.activity_url || null) : (current.course_url || activity.course_url || null),
      activity_type: current.activity_type || activity.activity_type,
      moodle_activity_type: current.moodle_activity_type || activity.moodle_activity_type,
      forum_type: current.forum_type || activity.forum_type || null,
      completion_enabled: current.completion_enabled || activity.completion_enabled,
      completion_rule: current.completion_rule || activity.completion_rule || '',
      availability_info: availabilityInfo,
      status: isAvailable ? (completed ? 'Selesai' : (current.status && current.status !== 'Belum diketahui' ? current.status : activity.status)) : 'Belum terbuka',
      is_completed: completed,
      is_available: isAvailable,
      sequence_order: Math.min(Number(current.sequence_order || 9999), Number(activity.sequence_order || 9999))
    });
  });

  return Array.from(byKey.values());
}

function getCourseTitleFromMap(courses = [], courseId, classCode) {
  const found = (courses || []).find((course) => String(course.id) === String(courseId));
  return found?.fullname || found?.displayname || found?.shortname || `Informatika ${classCode || courseId}`;
}

function extractTeacherName(courseTitle = '') {
  const parts = String(courseTitle || '').split(' - ');
  return parts[1]?.trim() || null;
}

function normalizeEnrolledCourses(enrolledCourses = [], config = {}) {
  const courseMap = config?.course_map || {};
  const result = [];
  const seen = new Set();

  (Array.isArray(enrolledCourses) ? enrolledCourses : []).forEach((item) => {
    const courseId = normalizeCourseId(item.course_id || item.courseId || item.id);
    if (!courseId) return;

    let classCode = normalizeClassCode(item.class_code || item.classCode || item.shortname || item.course_title || item.fullname);
    if (!classCode) {
      const mapEntry = Object.entries(courseMap).find(([, id]) => String(id) === String(courseId));
      if (mapEntry) classCode = mapEntry[0];
    }

    const key = `${classCode || '-'}:${courseId}`;
    if (seen.has(key)) return;
    seen.add(key);

    result.push({
      classCode,
      courseId,
      courseTitle: item.course_title || item.courseTitle || item.fullname || item.displayname || item.shortname || null,
      courseUrl: item.course_url || item.courseUrl || null
    });
  });

  return result;
}

function attachCourseMetaToActivities(activities = [], course = {}, classCode = null) {
  return (activities || []).map((activity) => ({
    ...activity,
    course_id: activity.course_id || course.course_id || null,
    class_code: activity.class_code || classCode || null,
    course_name: activity.course_name || course.course_name || null,
    course_url: activity.course_url || course.course_url || null
  }));
}

const lmsContextService = {
  normalizeClassCode,
  getClassCodeFromSession,

  async getCourseContext(projectId, classCode) {
    try {
      const normalizedClass = normalizeClassCode(classCode);
      if (!normalizedClass) return null;
      const course = await lmsRouteModel.findCourseRoute(projectId, normalizedClass);
      if (!course) return null;
      return {
        course_id: course.course_id,
        course_name: course.course_title || `Informatika ${normalizedClass}`,
        teacher_name: course.teacher_name || null,
        course_url: course.course_url
      };
    } catch (error) {
      console.error('[LMS Context] Gagal memuat Course Context:', error.message);
      return null;
    }
  },

  async getActivityContext(projectId, classCode) {
    try {
      const normalizedClass = normalizeClassCode(classCode);
      if (!normalizedClass) return [];
      const activities = await lmsRouteModel.getActivitiesByClass(projectId, normalizedClass);
      return (activities || []).map((act) => ({
        type: act.moodle_activity_type || act.activity_type,
        activity_type: act.activity_type,
        moodle_activity_type: act.moodle_activity_type,
        title: act.activity_title,
        description: act.activity_description || '',
        section_name: act.section_name || 'Umum',
        deadline: act.deadline,
        status: act.completion_status || 'Belum diketahui',
        url: act.activity_url,
        module_id: act.moodle_module_id,
        instance_id: act.moodle_instance_id || null,
        course_id: act.course_id,
        class_code: act.class_code || normalizedClass,
        source: 'database'
      }));
    } catch (error) {
      console.error('[LMS Context] Gagal memuat Activity Context:', error.message);
      return [];
    }
  },

  async getDeadlineContext(projectId, classCode) {
    try {
      const normalizedClass = normalizeClassCode(classCode);
      if (!normalizedClass) return [];
      const upcoming = await lmsRouteModel.getUpcomingActivities(projectId, normalizedClass, { limit: 10 });
      return (upcoming || []).map((act) => ({
        title: act.activity_title,
        type: act.moodle_activity_type || act.activity_type,
        deadline: act.deadline,
        status: act.completion_status || 'Belum diketahui',
        url: act.activity_url,
        module_id: act.moodle_module_id,
        course_id: act.course_id,
        class_code: act.class_code || normalizedClass,
        source: 'database'
      }));
    } catch (error) {
      console.error('[LMS Context] Gagal memuat Deadline Context:', error.message);
      return [];
    }
  },

  resolveCourseIdentity({ config, classCode, courseId }) {
    const courseMap = config?.course_map || {};
    let resolvedClassCode = normalizeClassCode(classCode);
    let resolvedCourseId = normalizeCourseId(courseId);

    if (!resolvedClassCode && classCode && String(classCode).toLowerCase() === 'umum') resolvedClassCode = '';

    if (resolvedCourseId) {
      const mapEntry = Object.entries(courseMap).find(([, id]) => String(id) === String(resolvedCourseId));
      if (mapEntry) resolvedClassCode = mapEntry[0];
    }
    if (resolvedClassCode && !resolvedCourseId && courseMap[resolvedClassCode]) {
      resolvedCourseId = normalizeCourseId(courseMap[resolvedClassCode]);
    }
    return { resolvedClassCode, resolvedCourseId };
  },

  async buildLiveMoodleContext(projectId, config, resolvedClassCode, resolvedCourseId, options = {}) {
    const intent = options.intent || '';
    const baseUrl = getMoodleBaseUrl(config);
    const courseUrl = `${baseUrl}/course/view.php?id=${encodeURIComponent(resolvedCourseId)}`;
    const fallbackCourseName = `Informatika ${resolvedClassCode || resolvedCourseId}`;
    const courseName = options.courseTitle || fallbackCourseName;

    let contents = [];
    let sectionMap = new Map();
    let activities = [];

    // Untuk fitur data kelas/tugas, cukup ambil 1 course yang sudah terdeteksi.
    // Jangan melebar ke semua course karena itu lambat dan bisa bikin jawaban 8A-8H muncul semua.
    try {
      contents = await moodleService.getCourseContents(projectId, resolvedCourseId);
      sectionMap = buildSectionMap(contents || []);

      let orderIndex = 0;
      (contents || []).forEach((section) => {
        (section.modules || []).forEach((module) => {
          const modname = String(module.modname || '').toLowerCase();
          if (!isLearningModuleType(modname)) return;
          if (!intentNeedsType(intent, modname)) return;

          orderIndex += 1;
          const activityType = modname === 'assign' ? 'assignment' : (['page', 'resource', 'url', 'folder', 'book'].includes(modname) ? 'materi' : modname);
          activities.push(normalizeActivity({
            config,
            courseId: resolvedCourseId,
            classCode: resolvedClassCode,
            courseName,
            item: module,
            type: activityType,
            moodleType: modname,
            cmid: module.id,
            instanceId: module.instance,
            title: module.name,
            intro: module.description,
            deadline: null,
            sectionMap,
            orderIndex
          }));
        });
      });
    } catch (error) {
      console.warn('[LMS Context] Gagal mengambil course contents Moodle:', error.message);
    }

    const needAssign = intentNeedsType(intent, 'assign');
    const needQuiz = intentNeedsType(intent, 'quiz');
    const needForum = intentNeedsType(intent, 'forum');

    const jobs = await Promise.allSettled([
      needAssign ? moodleService.getAssignments(projectId, [resolvedCourseId]) : Promise.resolve(null),
      needQuiz && typeof moodleService.getQuizzes === 'function' ? moodleService.getQuizzes(projectId, [resolvedCourseId]) : Promise.resolve(null),
      needForum && typeof moodleService.getForums === 'function' ? moodleService.getForums(projectId, [resolvedCourseId]) : Promise.resolve(null)
    ]);

    const assignmentsRes = jobs[0].status === 'fulfilled' ? jobs[0].value : null;
    const quizzesRes = jobs[1].status === 'fulfilled' ? jobs[1].value : null;
    const forumsRes = jobs[2].status === 'fulfilled' ? jobs[2].value : null;

    if (jobs[0].status === 'rejected') console.warn('[LMS Context] Gagal mengambil assignment Moodle:', jobs[0].reason?.message || jobs[0].reason);
    if (jobs[1].status === 'rejected') console.warn('[LMS Context] Gagal mengambil quiz Moodle:', jobs[1].reason?.message || jobs[1].reason);
    if (jobs[2].status === 'rejected') console.warn('[LMS Context] Gagal mengambil forum Moodle:', jobs[2].reason?.message || jobs[2].reason);

    try {
      const courseAssignments = (assignmentsRes?.courses || [])
        .find((course) => String(course.id) === String(resolvedCourseId))?.assignments || [];
      courseAssignments.forEach((item) => {
        activities.push(normalizeActivity({
          config,
          courseId: resolvedCourseId,
          classCode: resolvedClassCode,
          courseName,
          item,
          type: 'assignment',
          moodleType: 'assign',
          cmid: item.cmid,
          instanceId: item.id,
          title: item.name,
          intro: item.intro,
          deadline: toIsoDate(item.duedate || item.cutoffdate),
          sectionMap
        }));
      });
    } catch (error) { console.warn('[LMS Context] Gagal normalisasi assignment Moodle:', error.message); }

    try {
      (quizzesRes?.quizzes || [])
        .filter((item) => String(item.course) === String(resolvedCourseId))
        .forEach((item) => activities.push(normalizeActivity({
          config,
          courseId: resolvedCourseId,
          classCode: resolvedClassCode,
          courseName,
          item,
          type: 'quiz',
          moodleType: 'quiz',
          cmid: item.coursemodule,
          instanceId: item.id,
          title: item.name,
          intro: item.intro,
          deadline: toIsoDate(item.timeclose),
          sectionMap
        })));
    } catch (error) { console.warn('[LMS Context] Gagal normalisasi quiz Moodle:', error.message); }

    try {
      const forumList = Array.isArray(forumsRes) ? forumsRes : (forumsRes?.forums || []);
      forumList
        .filter((item) => String(item.course) === String(resolvedCourseId))
        .forEach((item) => activities.push(normalizeActivity({
          config,
          courseId: resolvedCourseId,
          classCode: resolvedClassCode,
          courseName,
          item,
          type: 'forum',
          moodleType: 'forum',
          cmid: item.cmid,
          instanceId: item.id,
          title: item.name,
          intro: item.intro,
          deadline: toIsoDate(item.duedate || item.cutoffdate),
          sectionMap
        })));
    } catch (error) { console.warn('[LMS Context] Gagal normalisasi forum Moodle:', error.message); }

    const deduped = dedupeActivities(activities);

    return {
      course: {
        course_id: resolvedCourseId,
        course_name: courseName,
        teacher_name: extractTeacherName(courseName),
        course_url: courseUrl
      },
      activities: deduped,
      deadlines: deduped.filter((activity) => activity.deadline)
    };
  },

  async buildSingleCourseContext(projectId, config, classCode, courseId, options = {}) {
    const { resolvedClassCode, resolvedCourseId } = this.resolveCourseIdentity({ config, classCode, courseId });
    if (!resolvedClassCode && !resolvedCourseId) return null;

    let course = resolvedClassCode ? await this.getCourseContext(projectId, resolvedClassCode) : null;
    let activities = resolvedClassCode ? await this.getActivityContext(projectId, resolvedClassCode) : [];
    let deadlines = resolvedClassCode ? await this.getDeadlineContext(projectId, resolvedClassCode) : [];
    let source = 'database';

    const needsActivities = intentNeedsActivities(options.intent);

    if (config && resolvedCourseId && needsActivities) {
      // Untuk fitur Data Kelas & Tugas, selalu ambil live course contents dari Moodle.
      // Data DB hasil sync bisa stale/parsial, khususnya untuk modul yang masih terkunci
      // oleh alur linear. Live context tetap hanya 1 course siswa, jadi scope masih cepat.
      console.log('[LMS Context] Mengambil live Moodle context khusus course terdeteksi agar modul terkunci tetap terbaca...');
      const live = await this.buildLiveMoodleContext(projectId, config, resolvedClassCode, resolvedCourseId, {
        intent: options.intent,
        courseTitle: course?.course_name || course?.course_title
      });

      if (live.course?.course_name) course = course || live.course;
      if (live.activities.length > 0) {
        activities = dedupeActivities([...(activities || []), ...live.activities]);
        deadlines = dedupeActivities([...(deadlines || []), ...live.deadlines]).filter((item) => item.deadline);
        source = source === 'database' ? 'database+moodle_live' : 'moodle_live';
      }
    }

    if (!course && config && resolvedCourseId) {
      const baseUrl = getMoodleBaseUrl(config);
      course = { course_id: resolvedCourseId, course_name: `Informatika ${resolvedClassCode || resolvedCourseId}`, teacher_name: null, course_url: `${baseUrl}/course/view.php?id=${encodeURIComponent(resolvedCourseId)}` };
    }

    const withCourseMeta = attachCourseMetaToActivities(activities || [], course || {}, resolvedClassCode);
    const deadlineMeta = attachCourseMetaToActivities(deadlines || [], course || {}, resolvedClassCode);

    return { classCode: resolvedClassCode, courseId: resolvedCourseId, course, activities: withCourseMeta, deadlines: deadlineMeta, source };
  },

  async applyCompletionStatuses(projectId, courseId, moodleUserId, activities = []) {
    if (!projectId || !courseId || !moodleUserId || !activities.length) {
      return { activities, progressAvailable: false };
    }

    try {
      const data = await moodleService.getActivitiesCompletionStatus(projectId, courseId, moodleUserId);
      const statuses = Array.isArray(data?.statuses) ? data.statuses : [];
      const statusMap = new Map(statuses.map((status) => [Number(status.cmid), status]));

      const mapped = activities.map((activity) => {
        const status = statusMap.get(Number(activity.module_id));
        if (!status) return activity;
        const completed = isCompletionStatusComplete(status);
        const locked = isActivityLockedForStudent(activity, statusMap);
        return {
          ...activity,
          status: locked ? 'Belum terbuka' : (completed ? 'Selesai' : 'Belum selesai'),
          completion_state: status.state,
          completion_details: Array.isArray(status.details) ? status.details : activity.completion_details,
          completion_rule: activity.completion_rule || (Array.isArray(status.details) ? status.details.map((d) => d?.rulevalue?.description).filter(Boolean).join(', ') : ''),
          is_completed: completed,
          is_available: locked ? false : activity.base_available !== false,
          action_url: locked ? (activity.course_url || activity.action_url || activity.url) : (activity.url || activity.activity_url || activity.action_url),
          timecompleted: status.timecompleted || null,
          progress_source: 'moodle_completion'
        };
      });

      return { activities: mapped, progressAvailable: statuses.length > 0 };
    } catch (error) {
      console.warn('[LMS Context] Gagal mengambil completion siswa:', { courseId, moodleUserId, message: error.message });
      return { activities, progressAvailable: false };
    }
  },

  async buildChatLmsContext({ projectId, sessionId, classCode, studentName, moodleUserId = null, studentEmail = null, courseId = null, enrolledCourses = [], intent = null }) {
    console.log(`[LMS Context] Membangun konteks LMS Siswa: ${studentName || 'Anonim'}, Kelas Awal: ${classCode || '-'}, Course ID Awal: ${courseId || '-'}, Intent: ${intent || '-'}`);

    let config = null;
    try { config = await moodleConfigModel.findByProjectId(projectId); }
    catch (error) { console.error('[LMS Context] Gagal membaca moodle config:', error.message); }

    const normalizedEnrolled = normalizeEnrolledCourses(enrolledCourses, config);
    const primaryIdentity = this.resolveCourseIdentity({ config, classCode, courseId });
    let identities = [];

    // Jika siswa sudah diverifikasi pada kelas/course tertentu, jangan melebar ke semua course.
    // Ini mencegah jawaban seperti tugas 8A-8H muncul semua untuk satu siswa.
    if (primaryIdentity.resolvedCourseId || primaryIdentity.resolvedClassCode) {
      identities = [{ classCode: primaryIdentity.resolvedClassCode, courseId: primaryIdentity.resolvedCourseId }];
    } else {
      identities = [...normalizedEnrolled];
    }

    if (!identities.length) {
      return {
        student: { name: studentName || 'Siswa', class_code: null, moodle_user_id: moodleUserId, email: studentEmail || null, enrolled_courses: [] },
        course: {}, courses: [], activities: [], deadlines: [], hasConfig: Boolean(config), progress_available: false,
        notes: ['Kelas atau course siswa tidak terdeteksi.']
      };
    }

    const firstIdentity = identities[0] || {};
    const cacheKey = getLmsCacheKey({
      projectId,
      courseId: firstIdentity.courseId || primaryIdentity.resolvedCourseId,
      classCode: firstIdentity.classCode || primaryIdentity.resolvedClassCode,
      moodleUserId,
      intent
    });
    const cached = readLmsCache(cacheKey);
    if (cached) {
      return { ...cached, cache_hit: true };
    }

    const courseContexts = [];
    let progressAvailable = false;
    const sourceSet = new Set();

    for (const identity of identities) {
      const context = await this.buildSingleCourseContext(projectId, config, identity.classCode, identity.courseId, { intent });
      if (!context) continue;

      const completion = await this.applyCompletionStatuses(projectId, context.course?.course_id || identity.courseId, moodleUserId, context.activities);
      context.activities = completion.activities;
      progressAvailable = progressAvailable || completion.progressAvailable;
      sourceSet.add(context.source);
      courseContexts.push(context);
    }

    const primary = courseContexts[0] || {};
    const allActivities = dedupeActivities(courseContexts.flatMap((item) => item.activities || []));
    const allDeadlines = allActivities.filter((activity) => activity.deadline);
    const allCourses = courseContexts.map((item) => ({
      class_code: item.classCode,
      course_id: item.course?.course_id || item.courseId,
      course_name: item.course?.course_name,
      course_url: item.course?.course_url,
      teacher_name: item.course?.teacher_name
    })).filter((item) => item.course_id || item.course_name);

    console.log('[LMS Context] Hasil konteks LMS:', {
      sessionId, projectId,
      classCode: primary.classCode || null,
      courseId: primary.course?.course_id || primary.courseId || null,
      hasConfig: Boolean(config),
      hasCourse: Boolean(primary.course?.course_name),
      courses: allCourses.length,
      activities: allActivities.length,
      progressAvailable,
      source: [...sourceSet].join('+') || 'none'
    });

    const finalContext = {
      student: {
        name: studentName || 'Siswa',
        class_code: primary.classCode || null,
        moodle_user_id: moodleUserId,
        email: studentEmail || null,
        enrolled_courses: allCourses
      },
      course: primary.course || {},
      courses: allCourses,
      activities: allActivities,
      deadlines: allDeadlines,
      progress_available: progressAvailable,
      hasConfig: Boolean(config),
      source: [...sourceSet].join('+') || 'database',
      notes: [
        progressAvailable
          ? 'Status progress siswa diambil dari Moodle completion API.'
          : 'Status progress siswa belum tersedia. Sistem tetap menampilkan aktivitas yang terbaca di course ini.',
        [...sourceSet].some((source) => String(source).includes('moodle_live'))
          ? 'Sebagian data aktivitas diambil langsung dari Moodle API khusus course terdeteksi.'
          : 'Data aktivitas diambil dari database hasil sync Moodle.'
      ]
    };

    writeLmsCache(cacheKey, finalContext);
    return finalContext;
  }
};

module.exports = lmsContextService;
