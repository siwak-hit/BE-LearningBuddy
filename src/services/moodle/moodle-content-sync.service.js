const crypto = require('crypto');
const moodleService = require('./moodle.service');
const documentModel = require('../../models/document.model');
const chunkModel = require('../../models/chunk.model');
const lmsRouteModel = require('../../models/lmsRoute.model');
const moodleConfigModel = require('../../models/moodleConfig.model');
const chunkingService = require('../rag/chunking.service');
const textCleanerService = require('../document/text-cleaner.service');
const supabaseService = require('../supabase/supabase.service');
const moodleStudentModel = require('../../models/moodleStudent.model');

const SUPPORTED_ACTIVITY_MODS = ['assign', 'quiz', 'forum', 'page', 'resource', 'label', 'book', 'url', 'folder'];
const MATERIAL_MODS = ['page', 'resource', 'label', 'book'];
// [A] Default HANYA modname `page` yang di-chunk ke RAG. `page` = materi HTML yang diketik
// guru & dibaca langsung di layar VClass. `resource` = file unggahan (PDF/PPT/Docx) yang
// harus di-download. Admin bisa memilih ikut meng-chunk `resource` (lihat resolveChunkMods).
const CHUNK_MODS = ['page'];

// [dedup] Hash konten ter-normalisasi → mendeteksi materi yang ISInya identik di banyak
// course (mis. "Kisi-kisi ASAT"/Pengumuman yang sama persis di kelas 8A–8H). Cukup simpan
// SATU; salinan itu dijadikan lintas-course (moodle_course_id null) agar muncul di kelas
// manapun yang isinya sama.
function contentHash(text = '') {
  const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(norm).digest('hex');
}

function toIsoDate(unixTime) {
  const value = Number(unixTime || 0);
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function normalizeArray(value, key = '') {
  if (Array.isArray(value)) return value;
  if (key && Array.isArray(value?.[key])) return value[key];
  return [];
}

function getCourseId(value) {
  return Number(value || 0);
}

function getMoodleBaseUrl(config = {}) {
  try {
    const endpoint = config.rest_endpoint || config.restEndpoint || '';
    const parsed = new URL(endpoint);
    return parsed.origin;
  } catch (_) {
    return 'https://lms.smpn167jakarta.sch.id';
  }
}


function appendMoodleTokenToFileUrl(fileUrl = '', token = '') {
  const rawUrl = String(fileUrl || '').trim();
  const rawToken = String(token || '').trim();
  if (!rawUrl || !rawToken) return rawUrl;

  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('token') && !url.searchParams.has('wstoken')) {
      url.searchParams.set('token', rawToken);
    }
    return url.toString();
  } catch (_) {
    const separator = rawUrl.includes('?') ? '&' : '?';
    if (rawUrl.includes('token=') || rawUrl.includes('wstoken=')) return rawUrl;
    return `${rawUrl}${separator}token=${encodeURIComponent(rawToken)}`;
  }
}

async function fetchMoodleTextFile(fileUrl = '', config = {}) {
  const finalUrl = appendMoodleTokenToFileUrl(fileUrl, config.token);
  if (!finalUrl || typeof fetch !== 'function') return '';

  try {
    const res = await fetch(finalUrl, {
      method: 'GET',
      headers: { Accept: 'text/html,text/plain,*/*' }
    });

    if (!res.ok) {
      console.warn('[Moodle Sync] Gagal fetch file materi:', res.status, finalUrl);
      return '';
    }

    return await res.text();
  } catch (error) {
    console.warn('[Moodle Sync] Gagal fetch file materi:', error.message);
    return '';
  }
}

function isHtmlContentFile(file = {}) {
  const mimetype = String(file.mimetype || '').toLowerCase();
  const filename = String(file.filename || '').toLowerCase();
  return mimetype.includes('text/html') || filename.endsWith('.html') || filename.endsWith('.htm');
}

function normalizeActivityType(modname = '') {
  const type = String(modname || '').toLowerCase();
  if (type === 'assign') return 'assignment';
  if (type === 'quiz') return 'quiz';
  if (type === 'forum') return 'forum';
  if (MATERIAL_MODS.includes(type) || type === 'url' || type === 'folder') return 'materi';
  return 'activity';
}

function extractTeacherName(courseTitle = '') {
  const parts = String(courseTitle || '').split(' - ');
  return parts[1]?.trim() || null;
}

function buildCourseIdsParams(courseIds = []) {
  const params = {};
  courseIds.forEach((id, index) => {
    params[`courseids[${index}]`] = id;
  });
  return params;
}

async function callMoodle(projectId, methodName, wsfunction, params = {}) {
  if (typeof moodleService[methodName] === 'function') {
    if (methodName === 'getCourseContents') return moodleService[methodName](projectId, params.courseid);
    if (methodName === 'getCourses') return moodleService[methodName](projectId);
    return moodleService[methodName](projectId, params.__courseIds || []);
  }

  const cleanParams = { ...params };
  delete cleanParams.__courseIds;
  return moodleService.callByProjectId(projectId, wsfunction, cleanParams);
}

function buildSectionMap(contents = []) {
  const map = new Map();

  contents.forEach((section) => {
    const sectionName = section.name || `Section ${section.section ?? section.id ?? '-'}`;

    (section.modules || []).forEach((module) => {
      map.set(Number(module.id), {
        section_name: sectionName,
        section_number: section.section,
        url: module.url || '',
        modname: module.modname,
        instance: module.instance,
        visible: module.visible === 1 || module.visible === true,
        uservisible: module.uservisible !== false,
        visibleoncoursepage: module.visibleoncoursepage !== 0,
        completion: module.completion,
        dates: module.dates || []
      });
    });
  });

  return map;
}

function indexByModuleId(items = [], getCmid) {
  const map = new Map();
  items.forEach((item) => {
    const cmid = Number(getCmid(item));
    if (cmid) map.set(cmid, item);
  });
  return map;
}

function buildActivityRow({
  projectId,
  classCode,
  courseId,
  moodleBaseUrl,
  teacherName,
  sourcePageUrl,
  module,
  sectionName,
  detail = null,
  deadline = null
}) {
  const modname = String(module.modname || '').toLowerCase();
  const cmid = Number(module.id || detail?.cmid || detail?.coursemodule || 0);

  if (!cmid || !SUPPORTED_ACTIVITY_MODS.includes(modname)) return null;

  const activityUrl = module.url || `${moodleBaseUrl}/mod/${modname}/view.php?id=${cmid}`;
  const visible = module.visible !== 0 && module.uservisible !== false && module.visibleoncoursepage !== 0;

  return {
    project_id: projectId,
    class_code: classCode,
    course_id: Number(courseId),
    activity_type: normalizeActivityType(modname),
    activity_title: module.name || detail?.name || `Aktivitas ${cmid}`,
    moodle_activity_type: modname,
    moodle_module_id: cmid,
    activity_url: activityUrl,
    source_page_url: sourcePageUrl,
    section_name: sectionName || 'Umum',
    deadline: deadline || null,
    teacher_name: teacherName,
    is_active: true,
    is_visible: visible,
    completion_status: 'Belum diketahui',
    updated_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString()
  };
}

const moodleContentSyncService = {
  htmlToPlainText(html) {
    if (!html) return '';

    let text = String(html)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<\/div>|<\/p>|<br\s*\/?>|<li[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&[a-z]+;/gi, ' ');

    text = text.replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    return text.replace(/\s+/g, ' ').trim();
  },

  async getResourceHtmlFromDetail(resourceDetail = {}, config = {}) {
    const files = normalizeArray(resourceDetail.contentfiles);
    const htmlFiles = files.filter(isHtmlContentFile);

    if (!htmlFiles.length) return '';

    const htmlParts = [];
    for (const file of htmlFiles) {
      const fileHtml = await fetchMoodleTextFile(file.fileurl, config);
      if (fileHtml) htmlParts.push(fileHtml);
    }

    return htmlParts.join('\n\n');
  },

  async getMoodleDataset(projectId, courseId, options = {}) {
    const courseIds = [Number(courseId)];
    const courseIdsParams = buildCourseIdsParams(courseIds);
    const includeActivities = options.includeActivities === true;

    // Untuk sync Knowledge/RAG, cukup ambil sumber materi saja:
    // - core_course_get_contents
    // - mod_page_get_pages_by_courses
    // - mod_resource_get_resources_by_courses
    // Assignment, quiz, dan forum tidak diambil agar proses sinkron lebih cepat.
    const baseCalls = [
      callMoodle(projectId, 'getCourseContents', 'core_course_get_contents', { courseid: Number(courseId) }),
      callMoodle(projectId, 'getPages', 'mod_page_get_pages_by_courses', { ...courseIdsParams, __courseIds: courseIds }),
      callMoodle(projectId, 'getResources', 'mod_resource_get_resources_by_courses', { ...courseIdsParams, __courseIds: courseIds })
    ];

    const [contents, pagesRes, resourcesRes] = await Promise.all(baseCalls);

    let assignments = [];
    let quizzes = [];
    let forums = [];

    if (includeActivities) {
      const [assignmentsRes, quizzesRes, forumsRes] = await Promise.all([
        callMoodle(projectId, 'getAssignments', 'mod_assign_get_assignments', { ...courseIdsParams, __courseIds: courseIds }),
        callMoodle(projectId, 'getQuizzes', 'mod_quiz_get_quizzes_by_courses', { ...courseIdsParams, __courseIds: courseIds }),
        callMoodle(projectId, 'getForums', 'mod_forum_get_forums_by_courses', { ...courseIdsParams, __courseIds: courseIds })
      ]);

      assignments = (assignmentsRes?.courses || [])
        .find((course) => getCourseId(course.id) === Number(courseId))?.assignments || [];

      quizzes = normalizeArray(quizzesRes, 'quizzes')
        .filter((item) => getCourseId(item.course) === Number(courseId));

      forums = normalizeArray(forumsRes, 'forums')
        .filter((item) => getCourseId(item.course) === Number(courseId));
    }

    const pages = normalizeArray(pagesRes, 'pages')
      .filter((item) => getCourseId(item.course) === Number(courseId));

    const resources = normalizeArray(resourcesRes, 'resources')
      .filter((item) => getCourseId(item.course) === Number(courseId));

    return {
      contents: normalizeArray(contents),
      assignments,
      quizzes,
      forums,
      pages,
      resources
    };
  },

  async deleteMoodleDocuments(projectId) {
    const oldDocs = await supabaseService.findMany('documents', {
      project_id: projectId,
      source_type: 'moodle'
    });

    for (const doc of oldDocs || []) {
      await chunkModel.deleteByDocumentId(doc.id);
      await documentModel.delete(doc.id);
    }

    return oldDocs?.length || 0;
  },

  async syncCourseContent(projectId, classCode, courseId, options = {}) {
    const summary = {
      classCode,
      courseId: Number(courseId),
      courseRouteUpdated: false,
      sectionsFound: 0,
      modulesFound: 0,
      activitiesFound: 0,
      activitiesSynced: 0,
      materialsSynced: 0,
      chunksCreated: 0,
      routesUpdated: 0,
      skippedTooShort: 0,
      skippedHidden: 0,
      skippedDuplicate: 0,
      errors: []
    };

    const materialOnly = options.materialOnly !== false;
    // [setting] modname yang di-chunk: default `page`; admin bisa ikutkan `resource`.
    const chunkMods = options.includeResource === true ? ['page', 'resource'] : CHUNK_MODS;
    // [dedup] Map konten-identik lintas course. Dibagikan dari syncAllCourses; bila dipanggil
    // sendiri, pakai Map lokal.
    const seenContent = options.seenContent instanceof Map ? options.seenContent : new Map();

    try {
      const config = await moodleService.getConfig(projectId);
      const moodleBaseUrl = getMoodleBaseUrl(config);
      const sourcePageUrl = `${moodleBaseUrl}/course/view.php?id=${Number(courseId)}`;

      const courseInfo = options.courseInfo || null;
      const courseTitle = courseInfo?.fullname || courseInfo?.displayname || `Informatika ${classCode}`;
      const teacherName = extractTeacherName(courseTitle) || 'Ilyas Rizal Hilmawan';

      await lmsRouteModel.upsertCourseRoute(projectId, {
        class_code: classCode,
        course_id: Number(courseId),
        course_url: sourcePageUrl,
        course_title: courseTitle,
        teacher_name: teacherName,
        is_active: true,
        last_synced_at: new Date().toISOString()
      });
      summary.courseRouteUpdated = true;

      const dataset = await this.getMoodleDataset(projectId, courseId, { includeActivities: !materialOnly });
      const { contents, assignments, quizzes, forums, pages, resources } = dataset;

      const assignByCmid = indexByModuleId(assignments, (item) => item.cmid);
      const quizByCmid = indexByModuleId(quizzes, (item) => item.coursemodule);
      const forumByCmid = indexByModuleId(forums, (item) => item.cmid);
      const pageByCmid = indexByModuleId(pages, (item) => item.coursemodule);
      const resourceByCmid = indexByModuleId(resources, (item) => item.coursemodule);
      const sectionMap = buildSectionMap(contents);
      const activities = [];

      if (options.resetMoodleChunks) {
        const oldDocs = await supabaseService.findMany('documents', {
          project_id: projectId,
          source_type: 'moodle'
        });

        for (const doc of oldDocs || []) {
          if (doc.source_url && doc.source_url.includes(`/course/view.php?id=${Number(courseId)}`)) {
            await chunkModel.deleteByDocumentId(doc.id);
            await documentModel.delete(doc.id);
          }
        }
      }

      for (const section of contents) {
        summary.sectionsFound += 1;
        const sectionName = section.name || `Section ${section.section ?? section.id ?? '-'}`;
        const modules = section.modules || [];

        for (const module of modules) {
          summary.modulesFound += 1;

          const modname = String(module.modname || '').toLowerCase();
          if (!SUPPORTED_ACTIVITY_MODS.includes(modname)) continue;
          if (materialOnly && !MATERIAL_MODS.includes(modname)) continue;

          // [#2] HANYA index materi yang TAMPIL untuk siswa di VClass.
          // `visible === 0` = guru menyembunyikan aktivitas (ikon mata) → tak terlihat
          // siapa pun; `visibleoncoursepage === 0` = stealth/disembunyikan dari halaman
          // kursus. Materi tersembunyi tak boleh ikut di-chunk / dipakai AI.
          const isHiddenFromStudents =
            Number(module.visible) === 0 || module.visibleoncoursepage === 0;
          if (isHiddenFromStudents) {
            summary.skippedHidden += 1;
            continue;
          }

          const cmid = Number(module.id || 0);
          let detail = null;
          let deadline = null;

          if (modname === 'assign') {
            detail = assignByCmid.get(cmid) || null;
            deadline = toIsoDate(detail?.duedate || detail?.cutoffdate);
          } else if (modname === 'quiz') {
            detail = quizByCmid.get(cmid) || null;
            deadline = toIsoDate(detail?.timeclose);
          } else if (modname === 'forum') {
            detail = forumByCmid.get(cmid) || null;
            deadline = toIsoDate(detail?.duedate || detail?.cutoffdate);
          } else if (modname === 'page') {
            detail = pageByCmid.get(cmid) || null;
          } else if (modname === 'resource') {
            detail = resourceByCmid.get(cmid) || null;
          }

          if (!materialOnly) {
            const row = buildActivityRow({
              projectId,
              classCode,
              courseId,
              moodleBaseUrl,
              teacherName,
              sourcePageUrl,
              module,
              sectionName,
              detail,
              deadline
            });

            if (row) activities.push(row);
          }

          // [A/setting] Default hanya `page`; bila admin pilih ikutkan `resource`, ambil juga
          // teks file (PDF/dll) lewat getResourceHtmlFromDetail.
          let rawHtml = '';
          if (chunkMods.includes(modname)) {
            rawHtml += module.description || '';
            rawHtml += ' ';
            rawHtml += detail?.content || detail?.intro || '';
            if (modname === 'resource') {
              rawHtml += ' ';
              rawHtml += await this.getResourceHtmlFromDetail(detail || {}, config);
            }
          }

          if (!rawHtml.trim()) continue;

          const cleanText = textCleanerService.clean(this.htmlToPlainText(rawHtml));

          if (cleanText.length < 80) {
            summary.skippedTooShort += 1;
            continue;
          }

          // [dedup] Konten identik yang muncul di banyak course (mis. Pengumuman/Kisi-kisi
          // yang sama persis di 8A–8H) cukup disimpan SEKALI. Saat ketemu lagi → lewati buat
          // dokumen baru, lalu tandai salinan pertama sebagai lintas-course (null course tag)
          // supaya tetap muncul untuk kelas manapun yang isinya sama.
          const cHash = contentHash(cleanText);
          const seen = seenContent.get(cHash);
          if (seen) {
            seen.count += 1;
            if (seen.count === 2 && seen.docId) {
              try { await chunkModel.setCourseAgnostic(seen.docId); }
              catch (e) { console.warn('[Dedup] set course-agnostic gagal:', e.message); }
            }
            summary.skippedDuplicate += 1;
            continue;
          }

          const docUrl = module.url || `${sourcePageUrl}#module-${cmid}`;
          const existingDocs = await supabaseService.findMany('documents', {
            project_id: projectId,
            source_url: docUrl,
            source_type: 'moodle'
          });

          let docId;
          if (existingDocs && existingDocs.length > 0) {
            docId = existingDocs[0].id;
            await chunkModel.deleteByDocumentId(docId);
          } else {
            const newDoc = await documentModel.create({
              project_id: projectId,
              title: module.name,
              topic: sectionName,
              file_type: 'html',
              source_type: 'moodle',
              source_url: docUrl,
              status: 'indexed'
            });
            docId = newDoc.id;
          }

          const chunks = chunkingService.chunkText([{ pageNumber: 1, text: cleanText }], {
            maxChars: 1200,
            minChars: 80,
            maxParagraphs: 3
          });

          if (chunks.length > 0) {
            const chunkPayloads = chunks.map((chunk, index) => ({
              document_id: docId,
              project_id: projectId,
              chunk_text: textCleanerService.clean(chunk.text),
              chunk_index: index,
              topic: sectionName || module.name,
              metadata: {
                source_origin: 'moodle',
                content_type: 'html',
                moodle_course_id: Number(courseId),
                class_code: classCode,
                section_name: sectionName,
                module_id: cmid,
                module_name: module.name,
                modname,
                source_url: docUrl,
                highlight_text: textCleanerService.clean(chunk.text)
              }
            }));

            await chunkModel.createMany(chunkPayloads);
            summary.materialsSynced += 1;
            summary.chunksCreated += chunkPayloads.length;
            // [dedup] Catat konten ini sebagai salinan pertama (kalau muncul lagi di course
            // lain → akan di-skip & dijadikan lintas-course).
            seenContent.set(cHash, { docId, count: 1 });
          }
        }
      }

      if (!materialOnly) {
        const savedActivities = await lmsRouteModel.replaceActivitiesForClass(projectId, classCode, activities);
        summary.activitiesFound = activities.length;
        summary.activitiesSynced = savedActivities.length;
        summary.routesUpdated = savedActivities.length;
      } else {
        summary.activitiesFound = 0;
        summary.activitiesSynced = 0;
        summary.routesUpdated = 0;
      }
    } catch (error) {
      summary.errors.push(error.message);
      console.error(`[Moodle Sync Error] Course ${courseId}:`, error.message);
    }

    return summary;
  },

  // [v0.9.40] Bangun INDEKS LOKAL siswa (email→user/kelas) supaya verifikasi siswa cepat
  // (tanpa panggil Moodle live tiap kali). Ambil enrolled users per course SEKALI saat sync.
  async syncStudentDirectory(projectId) {
    const config = await moodleService.getConfig(projectId);
    const courseMap = config.course_map || {};
    const entries = Object.entries(courseMap)
      .map(([classCode, courseId]) => ({ classCode: String(classCode).toUpperCase(), courseId: Number(courseId) }))
      .filter((e) => e.courseId);

    const rows = [];
    let coursesOk = 0;

    // Ambil enrolled users beberapa course PARALEL (batch) supaya tak menunggu 9 course
    // satu-satu (penyebab lama). Concurrency kecil agar tak membebani Moodle.
    const CONCURRENCY = 4;
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map((e) =>
        moodleService.getEnrolledUsers(projectId, e.courseId).then((users) => ({ e, users }))
      ));
      results.forEach((result) => {
        if (result.status !== 'fulfilled') {
          console.warn('[StudentDir] getEnrolledUsers gagal:', result.reason?.message || result.reason);
          return;
        }
        coursesOk += 1;
        const { e, users } = result.value;
        (Array.isArray(users) ? users : []).forEach((u) => {
          const roles = Array.isArray(u.roles) ? u.roles : [];
          const isStudent = !roles.length || roles.some((r) => /student|siswa/i.test(String(r.shortname || r.name || '')));
          if (!isStudent || !u.id) return;
          rows.push({
            project_id: projectId,
            course_id: e.courseId,
            class_code: e.classCode,
            moodle_user_id: u.id,
            email: String(u.email || '').trim().toLowerCase() || null,
            username: String(u.username || '').trim().toLowerCase() || null,
            fullname: u.fullname || [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || null,
            idnumber: String(u.idnumber || '').trim().toLowerCase() || null
          });
        });
      });
    }

    const withEmail = rows.filter((r) => r.email).length;

    // [FIX v0.9.44] JANGAN replace-all kalau ada course yang GAGAL diambil. replaceForProject =
    // delete-all + insert; kalau sebagian course gagal (mis. course besar/timeout), indeks kelas
    // itu terhapus diam-diam → siswa jadi tak terdeteksi enroll di kelas tsb (bug 9A hilang dari
    // indeks). Lebih aman: pertahankan indeks lama, lapor gagal, minta admin ulangi.
    const failedCourses = entries.length - coursesOk;
    if (failedCourses > 0) {
      console.warn(`[StudentDir] ${failedCourses}/${entries.length} course GAGAL diambil — indeks lama DIPERTAHANKAN (tidak di-replace) agar kelas yang gagal tak hilang. Ulangi Sinkron Indeks Siswa.`);
      return { courses: entries.length, coursesOk, students: rows.length, withEmail, partial: true, failed_courses: failedCourses, replaced: false };
    }

    let stored = 0;
    try { stored = await moodleStudentModel.replaceForProject(projectId, rows); }
    catch (err) { console.warn('[StudentDir] simpan direktori gagal:', err.message); }

    console.log('[StudentDir] built:', JSON.stringify({ projectId, courses: entries.length, coursesOk, students: rows.length, withEmail }));
    return { courses: entries.length, coursesOk, students: stored, withEmail, partial: false, replaced: true };
  },

  async syncAllCourses(projectId, options = {}) {
    const config = await moodleService.getConfig(projectId);
    let courseMap = config.course_map || {};

    // Untuk sync Knowledge, auto-discover dimatikan secara default agar tidak menambah hit API.
    // Set options.autoDiscover = true hanya jika memang ingin memperbarui course map saat sync.
    if (options.autoDiscover === true && typeof moodleService.discoverCourseMap === 'function') {
      try {
        const discovered = await moodleService.discoverCourseMap(projectId);
        if (discovered?.course_map && Object.keys(discovered.course_map).length > 0) {
          courseMap = { ...courseMap, ...discovered.course_map };
          await moodleConfigModel.upsertByProjectId(projectId, {
            rest_endpoint: config.rest_endpoint,
            token: config.token,
            course_map: courseMap,
            last_test_status: config.last_test_status || 'success',
            last_test_message: 'Course map tersinkronisasi otomatis saat sync all',
            last_test_at: config.last_test_at || new Date().toISOString()
          });
          await lmsRouteModel.bulkUpsertCourseRoutes(projectId, discovered.course_routes || []);
        }
      } catch (error) {
        console.warn('[Moodle Sync] Auto discover course gagal, lanjut memakai course_map tersimpan:', error.message);
      }
    }

    const entries = Object.entries(courseMap)
      .map(([classCode, courseId]) => [classCode, Number(courseId)])
      .filter(([, courseId]) => Boolean(courseId));

    const deletedMoodleDocs = options.resetMoodleChunks
      ? await this.deleteMoodleDocuments(projectId)
      : 0;

    const totalSummary = {
      coursesProcessed: 0,
      coursesRoutesUpdated: 0,
      sectionsFound: 0,
      modulesFound: 0,
      activitiesFound: 0,
      activitiesSynced: 0,
      materialsSynced: 0,
      chunksCreated: 0,
      routesUpdated: 0,
      skippedTooShort: 0,
      skippedHidden: 0,
      skippedDuplicate: 0,
      deletedMoodleDocs,
      byClass: {},
      errors: []
    };

    // [dedup] Map BERSAMA antar course agar konten identik lintas-kelas hanya disimpan sekali.
    const seenContent = new Map();

    let allCourses = [];
    if (!options.skipCourseInfo) {
      try {
        allCourses = await callMoodle(projectId, 'getCourses', 'core_course_get_courses', {});
      } catch (error) {
        console.warn('[Moodle Sync] Gagal mengambil daftar course, lanjut memakai course_map:', error.message);
      }
    }

    for (const [classCode, courseId] of entries) {
      console.log(`[Moodle Sync] Memproses Kelas ${classCode} (Course ID: ${courseId})...`);
      const courseInfo = (allCourses || []).find((item) => Number(item.id) === Number(courseId));
      const res = await this.syncCourseContent(projectId, classCode, courseId, {
        ...options,
        resetMoodleChunks: false,
        courseInfo,
        seenContent
      });

      totalSummary.coursesProcessed += 1;
      totalSummary.coursesRoutesUpdated += res.courseRouteUpdated ? 1 : 0;
      totalSummary.sectionsFound += res.sectionsFound;
      totalSummary.modulesFound += res.modulesFound;
      totalSummary.activitiesFound += res.activitiesFound;
      totalSummary.activitiesSynced += res.activitiesSynced;
      totalSummary.materialsSynced += res.materialsSynced;
      totalSummary.chunksCreated += res.chunksCreated;
      totalSummary.routesUpdated += res.routesUpdated;
      totalSummary.skippedTooShort += res.skippedTooShort;
      totalSummary.skippedHidden += res.skippedHidden || 0;
      totalSummary.skippedDuplicate += res.skippedDuplicate || 0;
      totalSummary.byClass[classCode] = res;

      if (res.errors.length > 0) totalSummary.errors.push(...res.errors.map((message) => `${classCode}: ${message}`));
    }

    // [v0.9.40.1] Indeks siswa TIDAK lagi dibangun di sini — dipisah ke endpoint sendiri
    // (`/moodle/sync/students`) agar sync materi tak ikut timeout. FE memanggilnya terpisah
    // setelah sync materi selesai.

    return totalSummary;
  },

  async previewAllMaterials(projectId) {
    const config = await moodleService.getConfig(projectId);
    const courseMap = config.course_map || {};
    const materials = [];

    for (const [classCode, courseId] of Object.entries(courseMap)) {
      try {
        const dataset = await this.getMoodleDataset(projectId, courseId, { includeActivities: false });
        const pageByCmid = indexByModuleId(dataset.pages, (item) => item.coursemodule);

        for (const section of dataset.contents) {
          if (!section.modules) continue;

          for (const module of section.modules) {
            const modname = String(module.modname || '').toLowerCase();
            // [A] Preview hanya `page` (selaras dengan yang benar-benar di-chunk).
            if (!CHUNK_MODS.includes(modname)) continue;

            // [#2] Lewati materi yang disembunyikan dari siswa (selaras dengan syncCourseContent).
            if (Number(module.visible) === 0 || module.visibleoncoursepage === 0) continue;

            const pageDetail = pageByCmid.get(Number(module.id));
            const rawHtml = [module.description || '', pageDetail?.content || pageDetail?.intro || ''].join(' ');

            const plainText = this.htmlToPlainText(rawHtml);
            if (plainText.length < 80) continue;

            materials.push({
              classCode,
              courseId: Number(courseId),
              sectionName: section.name,
              moduleId: module.id,
              moduleName: module.name,
              modname,
              url: module.url || '#',
              previewText: `${plainText.substring(0, 300)}...`,
              fullText: plainText
            });
          }
        }
      } catch (error) {
        console.error(`Gagal memuat preview kelas ${classCode}`, error.message);
      }
    }

    return materials;
  }
};

module.exports = moodleContentSyncService;
