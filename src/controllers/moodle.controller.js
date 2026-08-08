const moodleConfigModel = require('../models/moodleConfig.model');
const moodleService = require('../services/moodle/moodle.service');
const moodleContentSyncService = require('../services/moodle/moodle-content-sync.service');
const chunkModel = require('../models/chunk.model'); // <--- INI YANG MEMPERBAIKI ERROR CHUNK
const response = require('../utils/response');
const chatModel = require('../models/chat.model');
const lmsRouteModel = require('../models/lmsRoute.model');
const moodleStudentModel = require('../models/moodleStudent.model');

const maskToken = (token) => {
  if (!token || token.length < 8) return token;
  return `${token.substring(0, 4)}********${token.substring(token.length - 4)}`;
};

const moodleController = {
  // --- KONFIGURASI & KONEKSI ---
  async getConfig(req, res) {
    try {
      const { projectId } = req.query;
      if (!projectId) return response.error(res, 'projectId diperlukan', null, 400);

      const config = await moodleConfigModel.findByProjectId(projectId);
      if (!config) return response.success(res, 'Config tidak ditemukan', null);

      const sanitized = moodleConfigModel.sanitizeConfig
        ? moodleConfigModel.sanitizeConfig(config)
        : { ...config, token: undefined, hasToken: Boolean(config.token) };
      sanitized.token = maskToken(config.token);
      sanitized.hasToken = Boolean(config.token);

      try {
        sanitized.course_routes = await lmsRouteModel.getCoursesByProject(projectId);
      } catch (_) {
        sanitized.course_routes = [];
      }

      return response.success(res, 'Config berhasil diambil', sanitized);
    } catch (error) {
      return response.error(res, 'Gagal mengambil config Moodle', error.message, 500);
    }
  },

  async saveConfig(req, res) {
    try {
      const { projectId, restEndpoint, token, courseMap, autoSyncCourses = true } = req.body;
      if (!projectId || !restEndpoint) return response.error(res, 'Data tidak lengkap', null, 400);

      const existingConfig = await moodleConfigModel.findByProjectId(projectId);
      let finalToken = token;

      if (!token || String(token).includes('****')) {
        if (!existingConfig || !existingConfig.token) {
          return response.error(res, 'Token Moodle wajib diisi', null, 400);
        }
        finalToken = existingConfig.token;
      }

      let siteInfo = null;
      try {
        siteInfo = await moodleService.testConnection(restEndpoint, finalToken);
      } catch (moodleError) {
        await moodleConfigModel.updateTestResult(projectId, 'failed', moodleError.message).catch(() => {});
        return response.error(res, `Konfigurasi tidak disimpan karena koneksi gagal: ${moodleError.message}`, null, 400);
      }

      let finalCourseMap = courseMap || {};
      let discovered = null;

      if (autoSyncCourses !== false) {
        try {
          discovered = await moodleService.discoverCourseMapDirect(restEndpoint, finalToken);
          if (discovered?.course_map && Object.keys(discovered.course_map).length > 0) {
            finalCourseMap = { ...finalCourseMap, ...discovered.course_map };
          }
        } catch (syncError) {
          console.warn('[Moodle Controller] Auto discover course gagal saat save:', syncError.message);
        }
      }

      const payload = {
        rest_endpoint: restEndpoint,
        token: finalToken,
        course_map: finalCourseMap,
        last_test_status: 'success',
        last_test_message: 'Koneksi berhasil',
        last_test_at: new Date().toISOString()
      };

      const saved = await moodleConfigModel.upsertByProjectId(projectId, payload);

      // [v0.9.52] Token baru sudah tervalidasi (testConnection lolos) → reset cache health
      // agar "mode darurat" langsung pulih tanpa menunggu TTL 5 menit.
      moodleService.clearHealthCache(projectId);

      if (discovered?.course_routes?.length) {
        await lmsRouteModel.bulkUpsertCourseRoutes(projectId, discovered.course_routes).catch((err) => {
          console.warn('[Moodle Controller] Gagal upsert course routes:', err.message);
        });
      }

      const sanitized = moodleConfigModel.sanitizeConfig(saved);
      sanitized.token = maskToken(saved.token);
      sanitized.hasToken = Boolean(saved.token);
      sanitized.course_routes = await lmsRouteModel.getCoursesByProject(projectId).catch(() => []);
      sanitized.site = siteInfo ? { sitename: siteInfo.sitename, username: siteInfo.username, userid: siteInfo.userid } : null;
      sanitized.discovered = discovered || null;

      return response.success(res, 'Konfigurasi Moodle berhasil dites dan disimpan', sanitized);
    } catch (error) {
      return response.error(res, 'Gagal menyimpan config Moodle', error.message, 500);
    }
  },

  async testConnection(req, res) {
    try {
      const { projectId, restEndpoint, token } = req.body;

      if (!projectId || !restEndpoint) {
        return response.error(res, 'Endpoint dan Project ID diperlukan', null, 400);
      }

      let testToken = token;

      // Jika token di frontend kosong atau disensor (****), baru cari di database
      if (!token || token.includes('****')) {
        const existingConfig = await moodleConfigModel.findByProjectId(projectId);
        if (!existingConfig || !existingConfig.token) {
          return response.error(res, 'Token Moodle tidak valid atau belum disimpan.', null, 400);
        }
        testToken = existingConfig.token;
      }

      try {
        // Melakukan call API langsung menggunakan kredensial yang sedang dites
        const siteInfo = await moodleService.testConnection(restEndpoint, testToken);

        // Simpan log sukses (abaikan error jika row project_id belum terbuat di tabel)
        await moodleConfigModel.updateTestResult(projectId, 'success', 'Koneksi berhasil').catch(() => {});

        // Mengembalikan data Moodle persis seperti balasan Postman
        return response.success(res, 'Koneksi Moodle berhasil', {
          sitename: siteInfo.sitename,
          username: siteInfo.username,
          userid: siteInfo.userid,
          moodle_version: siteInfo.release
        });

      } catch (moodleError) {
        await moodleConfigModel.updateTestResult(projectId, 'failed', moodleError.message).catch(() => {});
        return response.error(res, `Gagal menghubungi Moodle: ${moodleError.message}`, null, 400);
      }
    } catch (error) {
      return response.error(res, 'Terjadi kesalahan sistem saat mengetes Moodle', error.message, 500);
    }
  },



  async resolveStudent(req, res) {
    try {
      const { projectId, projectKey, sessionId, email, classCode, courseId } = req.body;
      let resolvedProjectId = projectId || null;

      if (!resolvedProjectId && projectKey) {
        resolvedProjectId = await chatModel.getProjectIdByKey(projectKey);
      }

      if (!resolvedProjectId) return response.error(res, 'projectId/projectKey diperlukan', null, 400);
      if (!email) return response.error(res, 'Email siswa diperlukan', null, 400);

      let identity;
      try {
        identity = await moodleService.resolveStudentByEmail(resolvedProjectId, email, { classCode, courseId });
      } catch (e) {
        // [v0.9.75.1] resolveStudentByEmail melempar error (biasanya jalur Moodle live saat
        // token bermasalah). SEBELUM menawarkan mode tamu, cek DB `moodle_students`: kalau
        // direktori TERISI, DB otoritatif → jawab "tidak terdaftar", JANGAN mode tamu.
        const directoryPopulated = await moodleStudentModel.existsForProject(resolvedProjectId).catch(() => false);
        if (directoryPopulated) {
          return response.success(res, 'Email tidak terdaftar di data siswa', {
            found: false, email, class_code: classCode || null,
            directory_populated: true, allow_guest: false, source: 'directory_miss',
            message: 'Email ini tidak terdaftar sebagai siswa di data yang tersinkron dari Moodle. Cek ejaan email, atau minta admin "Perbarui Data Siswa".'
          });
        }
        // [v0.9.52] Direktori belum tersinkron & Moodle live bermasalah → mode tamu (jalan terakhir).
        const health = await moodleService.isMoodleDegraded(resolvedProjectId).catch(() => ({ degraded: true, reason: 'connection' }));
        return response.success(res, 'Data siswa belum tersinkron / Moodle bermasalah', {
          found: false, email, class_code: classCode || null,
          degraded: true, degraded_reason: health.reason || 'connection', allow_guest: true, directory_populated: false,
          message: 'Data siswa belum tersinkron dari Moodle (atau koneksi Moodle bermasalah), jadi email belum bisa dicek. Minta admin menjalankan "Perbarui Data Siswa". Sementara ini kamu bisa masuk sebagai tamu (mode panduan).'
        });
      }

      if (identity.found && sessionId) {
        const session = await chatModel.getSessionById(sessionId);
        if (session) {
          const oldPageContext = session.page_context || {};
          const oldMeta = oldPageContext.session_meta || {};
          const primaryCourse = identity.enrolled_courses?.[0] || {};

          const sessionMeta = {
            ...oldMeta,
            display_name: identity.fullname || oldMeta.display_name || session.student_alias,
            moodle_verified: true,
            moodle_user_id: identity.moodle_user_id,
            username: identity.username,
            email: identity.email,
            class_code: identity.class_code || oldMeta.class_code || primaryCourse.class_code || null,
            course_id: identity.course_id || oldMeta.course_id || primaryCourse.course_id || null,
            course_title: identity.course_title || oldMeta.course_title || primaryCourse.course_title || null,
            enrolled_courses: identity.enrolled_courses || []
          };

          await chatModel.updateSession(sessionId, {
            student_alias: identity.fullname || session.student_alias,
            page_context: {
              ...oldPageContext,
              session_meta: sessionMeta
            },
            course_context: {
              ...(session.course_context || {}),
              class_code: sessionMeta.class_code,
              course_id: sessionMeta.course_id,
              enrolled_courses: sessionMeta.enrolled_courses
            }
          });
        }
      }

      // [v0.9.75] DIREKTORI DB OTORITATIF: kalau data siswa sudah tersinkron (tabel
      // moodle_students) dan email memang TIDAK ADA di situ (source 'directory_miss'),
      // jawab tegas "tidak terdaftar" — JANGAN jatuh ke mode tamu walau token Moodle live
      // sedang bermasalah. Verifikasi cukup dari DB, tak perlu Moodle live.
      if (!identity.found && identity.source === 'directory_miss') {
        return response.success(res, 'Email tidak terdaftar di data siswa', {
          ...identity, allow_guest: false,
          message: identity.message || 'Email ini tidak terdaftar sebagai siswa di data yang tersinkron dari Moodle. Cek ejaan email, atau minta admin melakukan "Perbarui Data Siswa".'
        });
      }

      // [v0.9.52] Email tak ditemukan DAN direktori belum tersinkron (source lain) SERTA
      // Moodle live sedang bermasalah → izinkan tamu sebagai jalan terakhir.
      if (!identity.found) {
        const health = await moodleService.isMoodleDegraded(resolvedProjectId).catch(() => ({ degraded: false }));
        if (health.degraded) {
          return response.success(res, 'Moodle bermasalah — mode tamu', {
            ...identity, degraded: true, degraded_reason: health.reason || 'connection', allow_guest: true,
            message: 'Data siswa belum tersinkron dan koneksi ke Moodle sedang bermasalah. Kamu bisa masuk sebagai tamu (mode panduan). Minta admin menjalankan "Perbarui Data Siswa".'
          });
        }
      }

      return response.success(res, identity.found ? 'Siswa ditemukan di Moodle' : 'Siswa tidak ditemukan di Moodle', identity);
    } catch (error) {
      return response.error(res, 'Gagal memvalidasi siswa Moodle', error.message, 500);
    }
  },


  async previewCourseMap(req, res) {
    try {
      const { projectId, restEndpoint, token } = req.body;
      if (!projectId) return response.error(res, 'projectId diperlukan', null, 400);

      let endpoint = restEndpoint;
      let finalToken = token;
      if (!endpoint || !finalToken || String(finalToken).includes('****')) {
        const existingConfig = await moodleConfigModel.findByProjectId(projectId);
        endpoint = endpoint || existingConfig?.rest_endpoint;
        finalToken = (!finalToken || String(finalToken).includes('****')) ? existingConfig?.token : finalToken;
      }
      if (!endpoint || !finalToken) return response.error(res, 'Endpoint/token belum tersedia', null, 400);

      const discovered = await moodleService.discoverCourseMapDirect(endpoint, finalToken);
      return response.success(res, 'Preview course map berhasil', discovered);
    } catch (error) {
      return response.error(res, 'Gagal membaca daftar course Moodle', error.message, 500);
    }
  },

  async syncCourseMap(req, res) {
    try {
      const { projectId, restEndpoint, token, saveToConfig = true } = req.body;
      if (!projectId) return response.error(res, 'projectId diperlukan', null, 400);

      let endpoint = restEndpoint;
      let finalToken = token;
      const existingConfig = await moodleConfigModel.findByProjectId(projectId);

      endpoint = endpoint || existingConfig?.rest_endpoint;
      if (!finalToken || String(finalToken).includes('****')) finalToken = existingConfig?.token;

      if (!endpoint || !finalToken) return response.error(res, 'Endpoint/token belum tersedia', null, 400);

      await moodleService.testConnection(endpoint, finalToken);
      const discovered = await moodleService.discoverCourseMapDirect(endpoint, finalToken);

      if (!discovered.course_routes.length) {
        return response.error(res, 'Tidak ada course dengan pola kelas seperti 7A/8A/9A yang ditemukan.', discovered, 404);
      }

      const oldMap = existingConfig?.course_map || {};
      const newMap = { ...oldMap, ...discovered.course_map };

      if (saveToConfig !== false) {
        await moodleConfigModel.upsertByProjectId(projectId, {
          rest_endpoint: endpoint,
          token: finalToken,
          course_map: newMap,
          last_test_status: 'success',
          last_test_message: 'Koneksi berhasil dan course map tersinkronisasi',
          last_test_at: new Date().toISOString()
        });
      }

      const routes = await lmsRouteModel.bulkUpsertCourseRoutes(projectId, discovered.course_routes);

      return response.success(res, 'Sinkronisasi course map berhasil', {
        course_map: newMap,
        discovered_course_map: discovered.course_map,
        course_routes: routes,
        total_courses: discovered.total_courses,
        classes_found: Object.keys(discovered.course_map)
      });
    } catch (error) {
      return response.error(res, 'Gagal sinkronisasi course map', error.message, 500);
    }
  },

  // --- RAG PREVIEW & CHUNKS ---
  async previewMaterials(req, res) {
    try {
      const { projectId } = req.query;
      if (!projectId) return response.error(res, 'Missing projectId', null, 400);

      const materials = await moodleContentSyncService.previewAllMaterials(projectId);
      return response.success(res, 'Preview materi berhasil diambil', materials);
    } catch (error) {
      return response.error(res, 'Gagal mengambil preview', error.message, 500);
    }
  },

  async getProjectChunks(req, res) {
    try {
      const { projectId } = req.query;
      if (!projectId) return response.error(res, 'Missing projectId', null, 400);

      const chunks = await chunkModel.findByProjectId(projectId);
      return response.success(res, 'Data chunks berhasil diambil', chunks);
    } catch (error) {
      return response.error(res, 'Gagal mengambil chunks', error.message, 500);
    }
  },

  // --- RAG SYNC PROCESS ---
  async getCourseContents(req, res) {
    try {
      const { projectId, courseId } = req.query;
      if (!projectId || !courseId) return response.error(res, 'Missing parameters', null, 400);

      const data = await moodleService.getCourseContents(projectId, courseId);
      return response.success(res, 'Course contents retrieved', data);
    } catch (error) {
      return response.error(res, 'Gagal mengambil konten', error.message, 500);
    }
  },

  async syncCourse(req, res) {
    try {
      const { projectId, classCode, courseId, resetMoodleChunks, includeResource } = req.body;
      if (!projectId || !classCode || !courseId) return response.error(res, 'Missing parameters', null, 400);

      const summary = await moodleContentSyncService.syncCourseContent(projectId, classCode, courseId, {
        resetMoodleChunks, includeResource: includeResource === true
      });
      return response.success(res, 'Sync Moodle content selesai', summary);
    } catch (error) {
      return response.error(res, 'Gagal sync course', error.message, 500);
    }
  },

  async syncAll(req, res) {
    try {
      const { projectId, resetMoodleChunks, includeResource } = req.body;
      if (!projectId) return response.error(res, 'Missing projectId', null, 400);

      const summary = await moodleContentSyncService.syncAllCourses(projectId, {
        resetMoodleChunks, includeResource: includeResource === true
      });
      // [v0.9.52] Sinkron sukses → Moodle pasti bisa dihubungi; reset cache health.
      moodleService.clearHealthCache(projectId);
      return response.success(res, 'Sync semua course Moodle selesai', summary);
    } catch (error) {
      return response.error(res, 'Gagal sync semua course', error.message, 500);
    }
  },

  // [v0.9.40.1] Bangun INDEKS siswa terpisah dari sync materi (biar tak ikut timeout).
  async syncStudents(req, res) {
    try {
      const { projectId } = req.body;
      if (!projectId) return response.error(res, 'Missing projectId', null, 400);

      const result = await moodleContentSyncService.syncStudentDirectory(projectId);
      // [FIX v0.9.44] Sebagian course gagal → JANGAN klaim sukses (indeks lama dipertahankan,
      // tak di-replace). Kalau tetap 200 "berhasil", admin tak tahu kelas ada yang belum masuk.
      if (result.partial) {
        return response.error(
          res,
          `${result.failed_courses} dari ${result.courses} course gagal diambil dari Moodle. Indeks lama dipertahankan agar data kelas tidak hilang. Coba Sinkron Indeks Siswa lagi.`,
          result,
          503
        );
      }
      return response.success(res, 'Indeks siswa diperbarui', result);
    } catch (error) {
      return response.error(res, 'Gagal membangun indeks siswa', error.message, 500);
    }
  }
};

module.exports = moodleController;
