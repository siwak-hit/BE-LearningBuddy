const moodleConfigModel = require('../../models/moodleConfig.model');

const MOODLE_REQUEST_TIMEOUT_MS = parseInt(process.env.MOODLE_REQUEST_TIMEOUT_MS || '18000', 10);
const MOODLE_CONFIG_CACHE_TTL_MS = parseInt(process.env.MOODLE_CONFIG_CACHE_TTL_MS || '300000', 10);
const moodleConfigCache = new Map();

function readConfigCache(projectId) {
  const hit = moodleConfigCache.get(projectId);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > MOODLE_CONFIG_CACHE_TTL_MS) { moodleConfigCache.delete(projectId); return null; }
  return hit.config;
}
function writeConfigCache(projectId, config) { if (projectId && config) moodleConfigCache.set(projectId, { config, cachedAt: Date.now() }); }
function clearConfigCache(projectId = '') { if (projectId) moodleConfigCache.delete(projectId); else moodleConfigCache.clear(); }


function normalizeText(value = '') {
  return String(value || '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function romanToGrade(value = '') {
  const roman = String(value || '').toUpperCase().trim();
  const map = {
    VII: '7',
    VIII: '8',
    IX: '9',
    X: '10',
    XI: '11',
    XII: '12'
  };
  return map[roman] || '';
}

function normalizeClassCode(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';

  // Format paling umum: 8A, 8 A, KELAS 8A, KELAS 9 A, XII IPA A, dst.
  const numericMatch = raw.match(/(?:^|\b)(7|8|9|10|11|12)\s*([A-Z])(?:\b|$)/i);
  if (numericMatch) return `${numericMatch[1]}${numericMatch[2]}`.toUpperCase();

  // Format roman: VII A, VIII-A, KELAS IX A, KELAS XII B.
  const romanMatch = raw.match(/(?:^|\b)(VII|VIII|IX|X|XI|XII)\s*([A-Z])(?:\b|$)/i);
  if (romanMatch) {
    const grade = romanToGrade(romanMatch[1]);
    if (grade) return `${grade}${romanMatch[2]}`.toUpperCase();
  }

  return '';
}

function getMoodleBaseUrl(endpoint = '') {
  const raw = String(endpoint || '').trim();
  if (!raw) return 'https://lms.smpn167jakarta.sch.id';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return raw.replace(/\/webservice\/rest\/server\.php.*$/i, '').replace(/\/$/, '') || 'https://lms.smpn167jakarta.sch.id';
  }
}

function inferClassCodeFromCourse(course = {}) {
  const fields = [
    course.shortname,
    course.fullname,
    course.displayname,
    course.categoryname,
    course.summary,
    course.idnumber
  ];

  for (const field of fields) {
    const classCode = normalizeClassCode(field);
    if (classCode) return classCode;
  }

  return '';
}

function normalizeCourseForMap(course = {}, endpoint = '') {
  const classCode = inferClassCodeFromCourse(course);
  const courseId = Number(course.id || course.courseid || 0);
  if (!courseId) return null;

  const baseUrl = getMoodleBaseUrl(endpoint);
  const title = course.fullname || course.displayname || course.shortname || `Course ${courseId}`;

  return {
    class_code: classCode || null,
    course_id: courseId,
    course_title: title,
    course_url: `${baseUrl}/course/view.php?id=${courseId}`,
    teacher_name: String(title).split(' - ')[1]?.trim() || null,
    raw_shortname: course.shortname || null,
    raw_fullname: course.fullname || null,
    raw_categoryname: course.categoryname || null,
    visible: course.visible !== 0,
    categoryid: course.categoryid || null
  };
}

function buildDiscoveredCourseMap(courses = [], endpoint = '') {
  const course_map = {};
  const course_routes = [];
  const unmapped_courses = [];
  const seen = new Set();

  (Array.isArray(courses) ? courses : []).forEach((course) => {
    const item = normalizeCourseForMap(course, endpoint);
    if (!item || !item.course_id) return;

    if (!item.class_code) {
      unmapped_courses.push(item);
      return;
    }

    if (seen.has(item.class_code)) {
      unmapped_courses.push({
        ...item,
        unmapped_reason: `Duplikat kelas ${item.class_code}. Course pertama yang dipakai.`
      });
      return;
    }

    seen.add(item.class_code);
    course_map[item.class_code] = item.course_id;
    course_routes.push(item);
  });

  course_routes.sort((a, b) => {
    const gradeA = parseInt(String(a.class_code).match(/^\d+/)?.[0] || '0', 10);
    const gradeB = parseInt(String(b.class_code).match(/^\d+/)?.[0] || '0', 10);
    if (gradeA !== gradeB) return gradeA - gradeB;
    return String(a.class_code).localeCompare(String(b.class_code), 'id-ID', { numeric: true });
  });

  return {
    course_map,
    course_routes,
    unmapped_courses,
    total_courses: Array.isArray(courses) ? courses.length : 0
  };
}

function buildArrayParams(name, values = []) {
  const params = {};
  values.forEach((value, index) => {
    params[`${name}[${index}]`] = value;
  });
  return params;
}

const moodleService = {
  async getConfig(projectId, options = {}) {
    if (!options.forceRefresh) {
      const cached = readConfigCache(projectId);
      if (cached) return cached;
    }
    const config = await moodleConfigModel.findByProjectId(projectId);
    if (!config || !config.token || !config.rest_endpoint) {
      throw new Error('Konfigurasi Moodle belum diatur atau token tidak ditemukan');
    }
    writeConfigCache(projectId, config);
    return config;
  },

  clearConfigCache,

  buildRestUrl(endpoint, token, wsfunction, params = {}) {
    const url = new URL(endpoint);
    url.searchParams.append('wstoken', token);
    url.searchParams.append('wsfunction', wsfunction);
    url.searchParams.append('moodlewsrestformat', 'json');

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.append(key, value);
    });

    return url.toString();
  },

  async callDirect(endpoint, token, wsfunction, params = {}, options = {}) {
    const url = moodleService.buildRestUrl(endpoint, token, wsfunction, params);
    const timeoutMs = Number(options.timeoutMs || MOODLE_REQUEST_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, { method: 'POST', signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Moodle request timeout setelah ${Math.round(timeoutMs / 1000)} detik`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const data = await response.json();
    if (data.exception) throw new Error(data.message || data.exception);
    if (data.errorcode) throw new Error(data.error || data.message || 'Unknown Moodle Error');

    return data;
  },

  async callByProjectId(projectId, wsfunction, params = {}, options = {}) {
    const config = await moodleService.getConfig(projectId);
    return moodleService.callDirect(config.rest_endpoint, config.token, wsfunction, params, options);
  },

  async testConnection(endpoint, token) {
    return moodleService.callDirect(endpoint, token, 'core_webservice_get_site_info');
  },

  async getSiteInfo(projectId) {
    return moodleService.callByProjectId(projectId, 'core_webservice_get_site_info');
  },

  async getCourses(projectId) {
    return moodleService.callByProjectId(projectId, 'core_course_get_courses');
  },

  async getCoursesDirect(endpoint, token) {
    return moodleService.callDirect(endpoint, token, 'core_course_get_courses');
  },

  async discoverCourseMapDirect(endpoint, token) {
    const courses = await moodleService.getCoursesDirect(endpoint, token);
    return buildDiscoveredCourseMap(courses, endpoint);
  },

  async discoverCourseMap(projectId) {
    const config = await moodleService.getConfig(projectId);
    const courses = await moodleService.getCourses(projectId);
    return buildDiscoveredCourseMap(courses, config.rest_endpoint);
  },

  async getCoursesByField(projectId, field, value) {
    return moodleService.callByProjectId(projectId, 'core_course_get_courses_by_field', { field, value });
  },

  async getCourseContents(projectId, courseId) {
    return moodleService.callByProjectId(projectId, 'core_course_get_contents', { courseid: courseId });
  },

  async getAssignments(projectId, courseIds = []) {
    return moodleService.callByProjectId(projectId, 'mod_assign_get_assignments', buildArrayParams('courseids', courseIds));
  },

  async getQuizzes(projectId, courseIds = []) {
    return moodleService.callByProjectId(projectId, 'mod_quiz_get_quizzes_by_courses', buildArrayParams('courseids', courseIds));
  },

  async getForums(projectId, courseIds = []) {
    return moodleService.callByProjectId(projectId, 'mod_forum_get_forums_by_courses', buildArrayParams('courseids', courseIds));
  },

  async getPages(projectId, courseIds = []) {
    return moodleService.callByProjectId(projectId, 'mod_page_get_pages_by_courses', buildArrayParams('courseids', courseIds));
  },

  async getResources(projectId, courseIds = []) {
    return moodleService.callByProjectId(projectId, 'mod_resource_get_resources_by_courses', buildArrayParams('courseids', courseIds));
  },

  async getEnrolledUsers(projectId, courseId) {
    return moodleService.callByProjectId(projectId, 'core_enrol_get_enrolled_users', { courseid: courseId });
  },

  async getActivitiesCompletionStatus(projectId, courseId, userId) {
    return moodleService.callByProjectId(projectId, 'core_completion_get_activities_completion_status', {
      courseid: courseId,
      userid: userId
    });
  },

  async getAssignmentSubmissionStatus(projectId, assignId, userId) {
    return moodleService.callByProjectId(projectId, 'mod_assign_get_submission_status', {
      assignid: assignId,
      userid: userId
    });
  },

  async getUserQuizAttempts(projectId, quizId, userId) {
    return moodleService.callByProjectId(projectId, 'mod_quiz_get_user_quiz_attempts', {
      quizid: quizId,
      userid: userId
    });
  },

  async resolveStudentByEmail(projectId, email, options = {}) {
    const targetEmail = String(email || '').trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      throw new Error('Email siswa tidak valid.');
    }

    const config = await moodleService.getConfig(projectId);
    const courseMap = config.course_map || {};
    const requestedClassCode = normalizeClassCode(options.classCode || options.class_code || '');
    const requestedCourseId = Number(options.courseId || options.course_id || 0) || null;

    let classEntries = Object.entries(courseMap)
      .map(([classCode, courseId]) => ({ classCode: normalizeClassCode(classCode), courseId: Number(courseId) }))
      .filter((item) => item.classCode && item.courseId);

    if (requestedCourseId) {
      const classFromMap = Object.entries(courseMap).find(([, id]) => String(id) === String(requestedCourseId))?.[0] || requestedClassCode;
      classEntries = [{ classCode: normalizeClassCode(classFromMap) || requestedClassCode || `COURSE-${requestedCourseId}`, courseId: requestedCourseId }];
    } else if (requestedClassCode) {
      const mappedCourseId = Number(courseMap[requestedClassCode] || 0);
      if (!mappedCourseId) {
        return {
          found: false,
          email: targetEmail,
          class_code: requestedClassCode,
          message: `Kelas ${requestedClassCode} belum ada di mapping Moodle. Sinkronisasi course dari dashboard terlebih dahulu.`
        };
      }
      classEntries = [{ classCode: requestedClassCode, courseId: mappedCourseId }];
    }

    if (!classEntries.length) {
      throw new Error('course_map Moodle masih kosong. Klik Sinkronisasi Course dari dashboard terlebih dahulu.');
    }

    const matchedCourses = [];
    let matchedUser = null;

    for (const courseEntry of classEntries) {
      try {
        const users = await moodleService.getEnrolledUsers(projectId, courseEntry.courseId);
        const found = (Array.isArray(users) ? users : []).find((user) => {
          const userEmail = String(user.email || '').trim().toLowerCase();
          const username = String(user.username || '').trim().toLowerCase();
          return userEmail === targetEmail || username === targetEmail;
        });

        if (!found) continue;

        matchedUser = found;

        const enrolledCourse = (found.enrolledcourses || []).find((course) => String(course.id) === String(courseEntry.courseId));
        const roles = (found.roles || []).map((role) => role.shortname || role.name).filter(Boolean);
        const courseTitle = enrolledCourse?.fullname || enrolledCourse?.displayname || enrolledCourse?.shortname || `Course ${courseEntry.courseId}`;

        matchedCourses.push({
          class_code: courseEntry.classCode,
          course_id: courseEntry.courseId,
          course_title: courseTitle,
          course_url: `${getMoodleBaseUrl(config.rest_endpoint)}/course/view.php?id=${courseEntry.courseId}`,
          roles
        });

        // Kalau kelas/course sudah spesifik, tidak perlu cek course lain.
        if (requestedClassCode || requestedCourseId) break;
      } catch (error) {
        console.warn('[Moodle Service] Gagal cek enrolled user:', {
          projectId,
          classCode: courseEntry.classCode,
          courseId: courseEntry.courseId,
          message: error.message
        });
      }
    }

    if (!matchedUser) {
      return {
        found: false,
        email: targetEmail,
        class_code: requestedClassCode || null,
        course_id: requestedCourseId || null,
        message: requestedClassCode
          ? `Email ini tidak ditemukan sebagai peserta kelas ${requestedClassCode}. Periksa email atau kelas yang dipilih.`
          : 'Email ini tidak ditemukan pada daftar peserta course Moodle yang terdaftar di project ini.'
      };
    }

    const primaryCourse = matchedCourses[0] || null;

    return {
      found: true,
      moodle_user_id: matchedUser.id,
      username: matchedUser.username || null,
      fullname: matchedUser.fullname || [matchedUser.firstname, matchedUser.lastname].filter(Boolean).join(' ').trim() || targetEmail.split('@')[0],
      email: matchedUser.email || targetEmail,
      class_code: primaryCourse?.class_code || requestedClassCode || null,
      course_id: primaryCourse?.course_id || requestedCourseId || null,
      course_title: primaryCourse?.course_title || null,
      enrolled_courses: matchedCourses,
      source: requestedClassCode || requestedCourseId ? 'moodle_enrolled_users_scoped' : 'moodle_enrolled_users'
    };
  }

};

module.exports = moodleService;
