const moodleConfigModel = require('../../models/moodleConfig.model');

const MOODLE_REQUEST_TIMEOUT_MS = parseInt(process.env.MOODLE_REQUEST_TIMEOUT_MS || '18000', 10);
const MOODLE_RESOLVE_CACHE_TTL_MS = parseInt(process.env.MOODLE_RESOLVE_CACHE_TTL_MS || '600000', 10);
const MOODLE_RESOLVE_CONCURRENCY = Math.max(1, parseInt(process.env.MOODLE_RESOLVE_CONCURRENCY || '3', 10));
const studentResolveCache = new Map();

function readStudentResolveCache(key) {
  const hit = studentResolveCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > MOODLE_RESOLVE_CACHE_TTL_MS) {
    studentResolveCache.delete(key);
    return null;
  }
  return JSON.parse(JSON.stringify(hit.value));
}

function writeStudentResolveCache(key, value) {
  if (!key || !value) return;
  // JANGAN cache hasil NEGATIF (found:false). Dulu negatif ke-cache 10 menit → setiap
  // perbaikan logika/data Moodle tak terlihat (selalu balik "tidak ditemukan" dari cache),
  // dan diagnosa jadi mustahil. Hanya hasil positif yang aman & layak di-cache.
  if (value.found === false) return;
  studentResolveCache.set(key, { createdAt: Date.now(), value: JSON.parse(JSON.stringify(value)) });
}

function chunkArray(items = [], size = 3) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}


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
  async getConfig(projectId) {
    const config = await moodleConfigModel.findByProjectId(projectId);
    if (!config || !config.token || !config.rest_endpoint) {
      throw new Error('Konfigurasi Moodle belum diatur atau token tidak ditemukan');
    }
    return config;
  },

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

  async callDirect(endpoint, token, wsfunction, params = {}) {
    const url = moodleService.buildRestUrl(endpoint, token, wsfunction, params);
    const timeoutMs = Number(process.env.MOODLE_REQUEST_TIMEOUT_MS || MOODLE_REQUEST_TIMEOUT_MS || 18000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, { method: 'POST', signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Moodle timeout setelah ${Math.round(timeoutMs / 1000)} detik (${wsfunction}).`);
      }
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

  async callByProjectId(projectId, wsfunction, params = {}) {
    const config = await moodleService.getConfig(projectId);
    return moodleService.callDirect(config.rest_endpoint, config.token, wsfunction, params);
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

  // [v0.9.13] Daftar course yang diikuti seorang siswa (untuk fitur ganti course konteks).
  async getUserCourses(projectId, userId) {
    return moodleService.callByProjectId(projectId, 'core_enrol_get_users_courses', { userid: userId });
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

  // [v0.9.14] Review lembar jawaban satu attempt (per-soal: status, html soal+jawaban).
  // CATATAN: butuh WS function `mod_quiz_get_attempt_review` diaktifkan admin Moodle.
  async getQuizAttemptReview(projectId, attemptId) {
    return moodleService.callByProjectId(projectId, 'mod_quiz_get_attempt_review', {
      attemptid: attemptId
    });
  },

  async resolveStudentByEmail(projectId, email, options = {}) {
    const targetEmail = String(email || '').trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) {
      throw new Error('Email siswa tidak valid.');
    }

    const requestedClassCode = normalizeClassCode(options.classCode || options.class_code || '');
    const requestedCourseId = Number(options.courseId || options.course_id || 0) || null;
    const cacheKey = [projectId, targetEmail, requestedClassCode || '-', requestedCourseId || '-'].join(':');
    const cached = readStudentResolveCache(cacheKey);
    if (cached) return { ...cached, cache_hit: true };

    const config = await moodleService.getConfig(projectId);
    const courseMap = config.course_map || {};

    // SEMUA course yang termapping (label kelas pakai key course_map apa adanya bila tak
    // bisa dinormalisasi, mis. "9A").
    const allEntries = Object.entries(courseMap)
      .map(([classCode, courseId]) => ({ classCode: normalizeClassCode(classCode) || String(classCode).toUpperCase(), courseId: Number(courseId) }))
      .filter((item) => item.courseId);

    if (!allEntries.length) {
      throw new Error('course_map Moodle masih kosong. Klik Sinkronisasi Course dari dashboard terlebih dahulu.');
    }

    // Course yang DIPILIH user (dari course_id otoritatif, atau dari kode kelas). Dicek DULU
    // (cepat). Kalau email tak ketemu di situ, fallback cek course lain — supaya email yang
    // salah-pilih kelas tetap ditemukan & kelas aslinya terdeteksi otomatis.
    let pickedEntry = null;
    if (requestedCourseId) {
      pickedEntry = allEntries.find((e) => e.courseId === requestedCourseId)
        || { classCode: requestedClassCode || `COURSE-${requestedCourseId}`, courseId: requestedCourseId };
    } else if (requestedClassCode) {
      pickedEntry = allEntries.find((e) => e.classCode === requestedClassCode) || null;
    }

    function buildMatchedCoursesFromUser(found, fallbackEntry) {
      const enrolledCourses = Array.isArray(found.enrolledcourses) ? found.enrolledcourses : [];
      const mapEntries = Object.entries(courseMap)
        .map(([classCode, courseId]) => ({ classCode: normalizeClassCode(classCode), courseId: Number(courseId) }))
        .filter((item) => item.classCode && item.courseId);
      const byCourseId = new Map(mapEntries.map((item) => [String(item.courseId), item.classCode]));
      const result = [];
      const seen = new Set();

      enrolledCourses.forEach((course) => {
        const courseId = Number(course.id || course.courseid || 0);
        if (!courseId || !byCourseId.has(String(courseId)) || seen.has(String(courseId))) return;
        seen.add(String(courseId));
        result.push({
          class_code: byCourseId.get(String(courseId)),
          course_id: courseId,
          course_title: course.fullname || course.displayname || course.shortname || `Course ${courseId}`,
          course_url: `${getMoodleBaseUrl(config.rest_endpoint)}/course/view.php?id=${courseId}`,
          roles: (found.roles || []).map((role) => role.shortname || role.name).filter(Boolean)
        });
      });

      if (!result.length && fallbackEntry) {
        const enrolledCourse = enrolledCourses.find((course) => String(course.id) === String(fallbackEntry.courseId));
        result.push({
          class_code: fallbackEntry.classCode,
          course_id: fallbackEntry.courseId,
          course_title: enrolledCourse?.fullname || enrolledCourse?.displayname || enrolledCourse?.shortname || `Course ${fallbackEntry.courseId}`,
          course_url: `${getMoodleBaseUrl(config.rest_endpoint)}/course/view.php?id=${fallbackEntry.courseId}`,
          roles: (found.roles || []).map((role) => role.shortname || role.name).filter(Boolean)
        });
      }

      // JANGAN buang course lain — kembalikan semua course siswa yang termapping, tapi
      // prioritaskan course yang dipilih sebagai primary (kalau siswa memang enrolled di situ).
      if (requestedCourseId) {
        result.sort((a, b) =>
          (String(b.course_id) === String(requestedCourseId) ? 1 : 0) -
          (String(a.course_id) === String(requestedCourseId) ? 1 : 0));
      }
      return result;
    }

    // Email kadang DISEMBUNYIKAN oleh web service Moodle (privasi/showuseridentity), jadi
    // matching JANGAN hanya andalkan user.email. Cocokkan juga username, idnumber, dan
    // LOCAL-PART email (sebelum @). Banyak sekolah pakai username = email atau local-part.
    const norm = (s) => String(s || '').trim().toLowerCase();
    const targetLocal = targetEmail.split('@')[0];
    const userMatchesTarget = (user) => {
      const email = norm(user.email);
      const username = norm(user.username);
      const idnumber = norm(user.idnumber);
      if (email && email === targetEmail) return true;
      if (username && (username === targetEmail || username === targetLocal)) return true;
      if (idnumber && (idnumber === targetEmail || idnumber === targetLocal)) return true;
      if (email && email.split('@')[0] === targetLocal) return true; // email beda domain, local sama
      return false;
    };

    const diagnostics = [];
    async function checkCourse(courseEntry) {
      const users = await moodleService.getEnrolledUsers(projectId, courseEntry.courseId);
      const list = Array.isArray(users) ? users : [];
      const found = list.find(userMatchesTarget);
      // Diagnostik: bantu lihat KENAPA gagal (mis. semua email kosong → WS sembunyikan email).
      const diag = {
        courseId: courseEntry.courseId,
        classCode: courseEntry.classCode,
        enrolled: list.length,
        withEmail: list.filter((u) => u.email).length,
        withUsername: list.filter((u) => u.username).length,
        sample: list.slice(0, 3).map((u) => ({ id: u.id, hasEmail: Boolean(u.email), username: u.username || null, idnumber: u.idnumber || null }))
      };
      return { user: found || null, courses: found ? buildMatchedCoursesFromUser(found, courseEntry) : [], diag };
    }

    let matchedUser = null;
    let matchedCourses = [];

    // Cek course (paralel per batch) sampai user ketemu.
    async function searchEntries(entries) {
      for (const group of chunkArray(entries, MOODLE_RESOLVE_CONCURRENCY)) {
        const results = await Promise.allSettled(group.map(checkCourse));
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.diag) diagnostics.push(result.value.diag);
          else if (result.status === 'rejected') {
            diagnostics.push({ error: String(result.reason?.message || result.reason) });
            console.warn('[Moodle Service] Gagal cek enrolled user:', result.reason?.message || result.reason);
          }
        });
        const hit = results.find((result) => result.status === 'fulfilled' && result.value?.user)?.value;
        if (hit) return hit;
      }
      return null;
    }

    // 1) Cek course PILIHAN dulu (cepat — biasanya cukup 1 panggilan WS).
    let hit = pickedEntry ? await searchEntries([pickedEntry]) : null;
    // 2) Fallback: kalau belum ketemu, cek course lain (email salah-pilih kelas tetap ketemu).
    if (!hit) {
      const restEntries = allEntries.filter((e) => !pickedEntry || e.courseId !== pickedEntry.courseId);
      if (restEntries.length) hit = await searchEntries(restEntries);
    }
    if (hit) {
      matchedUser = hit.user;
      matchedCourses = hit.courses || [];
    }

    console.log('[ResolveStudent] diag:', JSON.stringify({ email: targetEmail, requestedCourseId, requestedClassCode, found: Boolean(matchedUser), diagnostics }));

    if (!matchedUser) {
      const allEmailsHidden = diagnostics.length > 0 && diagnostics.every((d) => d.enrolled > 0 && d.withEmail === 0);
      const result = {
        found: false,
        email: targetEmail,
        class_code: requestedClassCode || null,
        course_id: requestedCourseId || null,
        // Pesan lebih informatif bila ternyata WS Moodle menyembunyikan email semua peserta.
        message: allEmailsHidden
          ? 'Email peserta tidak diekspos oleh VClass (pengaturan privasi Moodle), jadi tak bisa dicocokkan via email. Minta admin mengizinkan email di "showuseridentity"/kapabilitas token, atau pakai username/idnumber.'
          : (requestedClassCode || requestedCourseId)
            ? `Email ini tidak ditemukan sebagai peserta kelas ${requestedClassCode || ('course ' + requestedCourseId)}. Periksa email atau kelas yang dipilih.`
            : 'Email ini tidak ditemukan pada daftar peserta course Moodle yang terdaftar di project ini.',
        debug: diagnostics
      };
      writeStudentResolveCache(cacheKey, result);
      return result;
    }

    const primaryCourse = matchedCourses[0] || null;

    const result = {
      found: true,
      moodle_user_id: matchedUser.id,
      username: matchedUser.username || null,
      fullname: matchedUser.fullname || [matchedUser.firstname, matchedUser.lastname].filter(Boolean).join(' ').trim() || targetEmail.split('@')[0],
      email: matchedUser.email || targetEmail,
      class_code: primaryCourse?.class_code || requestedClassCode || null,
      course_id: primaryCourse?.course_id || requestedCourseId || null,
      course_title: primaryCourse?.course_title || null,
      enrolled_courses: matchedCourses,
      source: requestedClassCode || requestedCourseId ? 'moodle_enrolled_users_scoped_cached' : 'moodle_enrolled_users_cached'
    };

    writeStudentResolveCache(cacheKey, result);
    return result;
  }
};

module.exports = moodleService;
