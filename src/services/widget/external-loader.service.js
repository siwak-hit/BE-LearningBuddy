function cleanUrl(value = '') {
  const text = String(value || '').trim();

  if (!text || text === 'undefined' || text === 'null' || text === '#') {
    return '';
  }

  return text.replace(/\/$/, '');
}

function cleanApiBase(value = '') {
  return cleanUrl(value).replace(/\/api\/?$/, '');
}

function escapeJsString(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const externalLoaderService = {
  generate() {
    const fallbackApiBase = cleanApiBase(
      process.env.BACKEND_API_BASE_URL ||
      process.env.API_BASE_URL ||
      process.env.APP_URL ||
      'https://be-learning-buddy.vercel.app'
    );

    const fallbackAppUrl = cleanUrl(
      process.env.FRONTEND_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.PUBLIC_FRONTEND_APP_URL ||
      'https://fe-learning-buddy.vercel.app'
    );

    return `
(function () {
  var currentScript = document.currentScript;
  var scriptUrl = new URL(currentScript.src);

  function cleanUrl(value) {
    var text = String(value || '').trim();
    if (!text || text === 'undefined' || text === 'null' || text === '#') return '';
    return text.charAt(text.length - 1) === '/' ? text.slice(0, -1) : text;
  }

  function cleanApiBase(value) {
    var text = cleanUrl(value);
    return text.toLowerCase().slice(-4) === '/api' ? text.slice(0, -4) : text;
  }


  var ALB_REQUEST_TIMEOUT_MS = 20000;

  function fetchWithTimeout(url, options, timeoutMs, label) {
    var ms = Number(timeoutMs || ALB_REQUEST_TIMEOUT_MS || 20000);
    var fetchOptions = options || {};

    if (!window.AbortController) {
      return fetch(url, fetchOptions);
    }

    var controller = new AbortController();
    var timeoutId = setTimeout(function() {
      try { controller.abort(); } catch (e) {}
    }, ms);

    var mergedOptions = {};
    Object.keys(fetchOptions).forEach(function(key) { mergedOptions[key] = fetchOptions[key]; });
    mergedOptions.signal = fetchOptions.signal || controller.signal;

    return fetch(url, mergedOptions).finally(function() {
      clearTimeout(timeoutId);
    }).catch(function(error) {
      if (error && error.name === 'AbortError') {
        error.albTimeout = true;
        error.message = (label || 'Request') + ' terlalu lama. Batas ' + Math.round(ms / 1000) + ' detik.';
      }
      throw error;
    });
  }

  var apiBase = cleanApiBase(currentScript.dataset.apiBase) || cleanApiBase(scriptUrl.origin) || '${escapeJsString(fallbackApiBase)}';
  var appUrl = cleanUrl(currentScript.dataset.appUrl) || '${escapeJsString(fallbackAppUrl)}';
  var projectKey = currentScript.dataset.projectKey || scriptUrl.searchParams.get('projectKey');

  if (!projectKey) {
    console.error('[AI Learning Buddy] projectKey tidak ditemukan pada external loader');
    return;
  }

  if (document.getElementById('alb-external-launcher')) return;

  function getCourseIdFromUrl(url) {
    try {
      var parsed = new URL(url || window.location.href, window.location.href);
      return parsed.searchParams.get('id') || null;
    } catch (e) {
      return null;
    }
  }

  function resolveNavigationUrl(targetUrl, pageType, courseId) {
    var LMS_BASE = 'https://lms.smpn167jakarta.sch.id';
    var cleanType = String(pageType || '').toLowerCase().replace(/\\s+/g, '').replace(/_/g, '');
    var id = courseId || getCourseIdFromUrl(window.location.href) || '2';

    if (targetUrl) {
      try {
        var resolved = new URL(targetUrl, LMS_BASE).href;
        if (resolved.indexOf('/login/logout.php') !== -1) {
          return LMS_BASE + '/login/logout.php';
        }
        return resolved;
      } catch (e) {
        return targetUrl;
      }
    }

    if (cleanType === 'login' || cleanType === 'masuk') return LMS_BASE + '/login/index.php';
    if (cleanType === 'dashboard' || cleanType === 'beranda' || cleanType === 'mycourses' || cleanType === 'kursussaya') return LMS_BASE + '/my/courses.php';
    if (cleanType === 'course' || cleanType === 'kursus' || cleanType === 'detailkursus' || cleanType === 'kelas') return LMS_BASE + '/course/view.php?id=' + encodeURIComponent(id);
    if (cleanType === 'logout' || cleanType === 'keluar') return LMS_BASE + '/login/logout.php';
    if (cleanType === 'grade' || cleanType === 'nilai' || cleanType === 'lihatnilai') return LMS_BASE + '/grade/report/user/index.php?id=' + encodeURIComponent(id);
    if (cleanType === 'activities' || cleanType === 'activity' || cleanType === 'aktivitas' || cleanType === 'listaktivitas') return LMS_BASE + '/course/overview.php?id=' + encodeURIComponent(id);
    if (cleanType === 'participants' || cleanType === 'siswa' || cleanType === 'listsiswa' || cleanType === 'peserta') return LMS_BASE + '/user/index.php?id=' + encodeURIComponent(id);
    if (cleanType === 'materi' || cleanType === 'modul' || cleanType === 'resource') return LMS_BASE + '/course/view.php?id=' + encodeURIComponent(id);

    return window.location.href;
  }

  window.addEventListener('message', function(event) {
    var data = event.data || {};
    if (!data || data.type !== 'ALB_NAVIGATE_SOURCE') return;

    var destination = resolveNavigationUrl(data.url, data.pageType, data.courseId || data.course_id);
    if (!destination) return;

    try { window.focus(); } catch (e) {}
    window.location.href = destination;
  });

  var faLink = document.createElement('link');
  faLink.rel = 'stylesheet';
  faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(faLink);

  function createStyle(config) {
    var theme = config.theme || {};
    if (typeof theme === 'string') {
      try { theme = JSON.parse(theme); } catch (e) { theme = {}; }
    }

    var primaryColor = theme.primaryColor || '#0c0a09';
    var buttonTextColor = theme.buttonTextColor || '#ffffff';

    var style = document.createElement('style');
    style.id = 'alb-external-launcher-style';
    style.innerHTML = [
      '.alb-ext-launcher-btn {',
      '  position: fixed;',
      // [v0.9.9] Digeser ke kiri dari pojok kanan (24px → 96px) agar tidak menimpa
      // widget bawaan LMS yang juga ada di pojok kanan bawah.
      '  right: 96px;',
      // [v0.9.25] Dinaikkan sedikit (24→34px) agar sejajar dengan tombol bundar bawaan
      // LMS (accessibility / back-to-top) di pojok kanan bawah.
      '  bottom: 34px;',
      '  z-index: 999999;',
      '  border: none;',
      '  border-radius: 9999px;',
      '  background: ' + primaryColor + ';',
      '  color: ' + buttonTextColor + ';',
      '  padding: 12px 20px;',
      '  cursor: pointer;',
      '  font-size: 15px;',
      '  font-weight: 600;',
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.14);',
      '  transition: all 0.2s ease;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '}',
      '.alb-ext-launcher-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.18); }',
      '.alb-ext-launcher-btn:disabled { opacity: 0.72; cursor: not-allowed; transform: none; }',
      '@media (max-width: 640px) { .alb-ext-launcher-btn { right: 84px; bottom: 24px; padding: 11px 16px; font-size: 14px; } }'
    ].join('\\n');

    document.head.appendChild(style);
  }

  function renderButton(config) {
    createStyle(config);

    var btn = document.createElement('button');
    btn.id = 'alb-external-launcher';
    btn.className = 'alb-ext-launcher-btn';
    btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Tanya AI';

    function checkMoodleLoginStatus() {
      if (document.body.classList.contains('notloggedin')) return false;
      if (document.querySelector('a[href*="logout.php"]')) return true;
      if (document.querySelector('.userpicture')) return true;
      var userNode = document.querySelector('.usertext, .userbutton .usertext, .usermenu .usertext');
      if (userNode && userNode.innerText.trim() !== '') return true;
      return false;
    }

    function extractMoodleContext() {
      var ctx = {
        source_url: window.location.href,
        page_title: document.title,
        course_id: getCourseIdFromUrl(window.location.href),
        course_title: null,
        student_name: null,
        username: null,
        email: null,
        moodle_user_id: null
      };

      try {
        var h1 = document.querySelector('h1, .page-header-headings h1, .coursename');
        if (h1) ctx.course_title = h1.innerText.trim();

        var userNode = document.querySelector('.usertext, .userbutton .usertext, .usermenu .usertext');
        if (userNode) ctx.student_name = userNode.innerText.trim();

        var mailto = document.querySelector('a[href^="mailto:"]');
        if (mailto) ctx.email = mailto.href.replace('mailto:', '').trim();

        var userMenu = document.querySelector('[data-userid]');
        if (userMenu) ctx.moodle_user_id = userMenu.getAttribute('data-userid');

        // [v0.9.14] Fallback userid dari link profil di menu user (andal di banyak tema Moodle).
        if (!ctx.moodle_user_id) {
          var profileLink = document.querySelector('a[href*="/user/profile.php?id="], a[href*="/user/view.php?id="]');
          if (profileLink) {
            var pm = profileLink.href.match(/[?&]id=(\\d+)/);
            if (pm) ctx.moodle_user_id = pm[1];
          }
        }
        // Nama dari "You are logged in as / Anda login sebagai" bila ada.
        if (!ctx.student_name) {
          var loginInfo = document.querySelector('.logininfo, .usermenu');
          if (loginInfo) {
            var li = loginInfo.innerText.replace(/\\s+/g, ' ').match(/(?:logged in as|login sebagai|masuk sebagai)\\s+([^.(]+)/i);
            if (li) ctx.student_name = li[1].trim();
          }
        }
      } catch (e) {
        console.error('[AI Buddy] Ekstraksi Moodle context gagal:', e);
      }

      delete ctx.password;
      return ctx;
    }



    function normalizeClassCodeFromText(value) {
      var raw = String(value || '').toUpperCase().replace(/[-_\\/]+/g, ' ').replace(/\\s+/g, ' ').trim();
      var m = raw.match(/\\b(7|8|9|10|11|12)\\s*([A-Z])\\b/);
      if (m) return (m[1] + m[2]).toUpperCase();
      var roman = raw.match(/\\b(VII|VIII|IX|X|XI|XII)\\s*([A-Z])\\b/);
      if (roman) {
        var map = { VII:'7', VIII:'8', IX:'9', X:'10', XI:'11', XII:'12' };
        return (map[roman[1]] || '') + roman[2];
      }
      return '';
    }

    function detectModuleType(node, text) {
      var cls = String(node.className || '').toLowerCase();
      var t = String(text || '').toLowerCase();
      if (cls.indexOf('modtype_assign') !== -1 || /\\b(tugas|assignment|submit|pengumpulan)\\b/i.test(t)) return 'assign';
      if (cls.indexOf('modtype_quiz') !== -1 || /\\b(kuis|quiz|ulangan|ujian)\\b/i.test(t)) return 'quiz';
      if (cls.indexOf('modtype_forum') !== -1 || /\\b(forum|diskusi)\\b/i.test(t)) return 'forum';
      if (cls.indexOf('modtype_page') !== -1 || cls.indexOf('modtype_resource') !== -1 || /\\b(materi|cms|wordpress|instalasi|dashboard)\\b/i.test(t)) return 'materi';
      return '';
    }

    function cleanText(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim();
    }

    function extractCoursePageActivities() {
      var courseId = getCourseIdFromUrl(window.location.href);
      if (!courseId) return [];

      var courseTitle = '';
      var heading = document.querySelector('h1, .page-header-headings h1, .coursename');
      if (heading) courseTitle = cleanText(heading.innerText);

      var candidates = Array.prototype.slice.call(document.querySelectorAll([
        'li.activity',
        '.activity-item',
        '[data-for="cmitem"]',
        '[id^="module-"]',
        '.course-content .activity'
      ].join(',')));

      var seen = {};
      var result = [];
      candidates.forEach(function(node, index) {
        var text = cleanText(node.innerText || '');
        if (!text || text.length < 3) return;

        var type = detectModuleType(node, text);
        if (!type) return;

        var titleNode = node.querySelector('.instancename, .activityname, .aalink, a[href*="/mod/"], .activitytitle, [data-activityname]');
        var title = titleNode ? cleanText(titleNode.innerText || titleNode.getAttribute('data-activityname') || '') : '';
        if (!title) {
          title = text.split(/\\n|Tidak tersedia kecuali|Available until|Selesai|Lakukan/i)[0];
          title = cleanText(title).slice(0, 120);
        }
        if (!title) return;

        // Abaikan forum pengumuman untuk fitur forum belajar. Forum diskusi tetap diambil.
        if (type === 'forum' && /^pengumuman$/i.test(title)) return;

        var link = node.querySelector('a[href*="/mod/"]');
        var href = link ? link.href : '';
        var availabilityNode = node.querySelector('.availabilityinfo, .availability_info, .description .availabilityinfo, [class*="availability"]');
        var availabilityInfo = availabilityNode ? cleanText(availabilityNode.innerText) : '';
        if (!availabilityInfo) {
          var lockedMatch = text.match(/(Tidak tersedia kecuali[\\s\\S]{0,180}|Not available unless[\\s\\S]{0,180}|Restricted[\\s\\S]{0,120})/i);
          availabilityInfo = lockedMatch ? cleanText(lockedMatch[1]) : '';
        }

        var completed = /\\b(Selesai|Completed)\\b/i.test(text) && !/Tidak tersedia kecuali/i.test(text);
        var locked = Boolean(availabilityInfo) || /\\b(terkunci|not available|restricted|tidak tersedia kecuali)\\b/i.test(text);
        var actionText = /\\b(Lakukan|Kerjakan|Attempt|Add submission|Reply|Balas)\\b/i.test(text) ? 'Lakukan' : '';
        var status = locked ? 'Terkunci / belum bisa dibuka' : (completed ? 'Selesai' : (actionText ? 'Belum selesai' : 'Belum diketahui'));

        var sectionNode = node.closest('li.section, .course-section, [data-sectionid]');
        var sectionTitle = '';
        if (sectionNode) {
          var sectionHeading = sectionNode.querySelector('.sectionname, .section-title, h3, h4');
          if (sectionHeading) sectionTitle = cleanText(sectionHeading.innerText);
        }

        var moduleId = null;
        var idMatch = String(node.id || '').match(/module-(\\d+)/i) || (href ? href.match(/[?&]id=(\\d+)/) : null);
        if (idMatch) moduleId = Number(idMatch[1]);

        var key = type + ':' + title + ':' + moduleId;
        if (seen[key]) return;
        seen[key] = true;

        result.push({
          title: title,
          type: type,
          moodle_activity_type: type,
          module_id: moduleId,
          url: href,
          course_id: Number(courseId),
          course_title: courseTitle,
          section_name: sectionTitle || 'Course',
          status: status,
          is_available: !locked,
          is_completed: completed,
          availability_info: availabilityInfo,
          action_text: actionText,
          sequence_order: index + 1,
          source: 'browser_dom'
        });
      });

      return result;
    }

    function showNotLoggedInAlert() {
      if (document.getElementById('alb-mini-form-overlay')) return;

      var theme = config.theme || {};
      if (typeof theme === 'string') { try { theme = JSON.parse(theme); } catch (e) { theme = {}; } }
      var primaryColor = theme.primaryColor || '#0c0a09';
      var buttonTextColor = theme.buttonTextColor || '#ffffff';

      var overlay = document.createElement('div');
      overlay.id = 'alb-mini-form-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:9999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
      overlay.innerHTML = [
        '<div style="background:#fff;padding:32px 24px;border-radius:16px;width:90%;max-width:340px;box-shadow:0 10px 25px rgba(0,0,0,0.2);font-family:Inter, system-ui, sans-serif;text-align:center;">',
        '  <div style="font-size:42px;margin-bottom:16px;color:#f59e0b;">🔒</div>',
        '  <h3 style="margin:0 0 8px 0;font-size:18px;color:#1a1a1a;font-weight:700;">Belum Login VClass</h3>',
        '  <p style="margin:0 0 24px 0;font-size:13px;color:#666;line-height:1.5;">Silakan login dulu agar AI bisa membaca konteks course. Kalau belum bisa login, kamu tetap bisa lanjut sebagai guest dengan verifikasi email Moodle.</p>',
        '  <div style="display:flex;flex-direction:column;gap:10px;">',
        '    <button id="alb-btn-login-vclass" style="width:100%;padding:12px 16px;border:none;background:' + primaryColor + ';color:' + buttonTextColor + ';border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;">Login ke VClass</button>',
        '    <button id="alb-btn-chat-guest" style="width:100%;padding:12px 16px;border:1px solid #d6d3d1;background:#fff;color:#444;border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;">Lanjut Chat (Guest)</button>',
        '  </div>',
        '  <button id="alb-btn-cancel-alert" style="margin-top:16px;background:none;border:none;color:#999;font-size:12px;cursor:pointer;text-decoration:underline;">Batal</button>',
        '</div>'
      ].join('');
      document.body.appendChild(overlay);
      document.getElementById('alb-btn-login-vclass').onclick = function() { window.location.href = 'https://lms.smpn167jakarta.sch.id/login/index.php'; };
      document.getElementById('alb-btn-chat-guest').onclick = function() { document.body.removeChild(overlay); showMiniForm(); };
      document.getElementById('alb-btn-cancel-alert').onclick = function() { document.body.removeChild(overlay); };
    }


    function showMiniForm(prefillContext, loggedIn) {
      if (document.getElementById('alb-mini-form-overlay')) return;
      prefillContext = prefillContext || {};
      var noteHtml = loggedIn
        ? '<div style="margin:0 0 14px 0;padding:9px 11px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1e40af;line-height:1.45;"><b>Kamu sudah login di VClass.</b> Tapi data akunmu belum terbaca otomatis — masukkan email Moodle-mu ya.</div>'
        : '<div style="margin:0 0 14px 0;padding:9px 11px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;line-height:1.45;"><b>Kamu belum login di VClass.</b> Login dulu supaya bisa terdeteksi otomatis, atau lanjut dengan memasukkan email Moodle-mu.</div>';
      var prefillEmail = prefillContext.email || '';
      var prefillCourseId = prefillContext.course_id || getCourseIdFromUrl(window.location.href) || null;

      var theme = config.theme || {};
      if (typeof theme === 'string') { try { theme = JSON.parse(theme); } catch (e) { theme = {}; } }
      var primaryColor = theme.primaryColor || '#0c0a09';
      var buttonTextColor = theme.buttonTextColor || '#ffffff';

      var resolvedIdentity = null;
      var selectedCourse = null;
      var emailCheckTimeoutCount = 0;

      function escapeHtmlInline(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function normalizeClassCodeLocal(value) {
        var raw = String(value || '').toUpperCase().trim();
        var match = raw.match(/\\b(7|8|9|10|11|12)\\s*([A-Z])\\b/);
        if (match) return (match[1] + match[2]).toUpperCase();
        return raw;
      }

      function setMiniStatus(message, type) {
        var statusEl = document.getElementById('alb-mini-status');
        if (!statusEl) return;
        statusEl.innerHTML = message || '';
        statusEl.style.display = message ? 'block' : 'none';
        statusEl.style.color = type === 'success' ? '#047857' : (type === 'warning' ? '#92400e' : '#b91c1c');
        statusEl.style.background = type === 'success' ? '#ecfdf5' : (type === 'warning' ? '#fffbeb' : '#fef2f2');
        statusEl.style.borderColor = type === 'success' ? '#a7f3d0' : (type === 'warning' ? '#fde68a' : '#fecaca');
      }

      function setClassEnabled(enabled) {
        var select = document.getElementById('alb-input-kelas');
        var submit = document.getElementById('alb-btn-submit');
        if (select) select.disabled = !enabled;
        if (submit) submit.disabled = !enabled;
        if (submit) submit.style.opacity = enabled ? '1' : '0.55';
      }

      function renderClassOptions(courses) {
        var select = document.getElementById('alb-input-kelas');
        if (!select) return;

        select.innerHTML = '<option value="">Pilih kelas dari akun Moodle</option>';
        selectedCourse = null;

        (courses || []).forEach(function(course, index) {
          var classCode = normalizeClassCodeLocal(course.class_code || course.classCode || '');
          var courseId = course.course_id || course.courseId || '';
          var courseTitle = course.course_title || course.courseTitle || ('Course ' + courseId);
          if (!classCode || !courseId) return;

          var option = document.createElement('option');
          option.value = classCode;
          option.textContent = classCode + ' — ' + courseTitle;
          option.setAttribute('data-index', String(index));
          select.appendChild(option);
        });

        if ((courses || []).length === 1) {
          var only = courses[0];
          select.value = normalizeClassCodeLocal(only.class_code || only.classCode || '');
          selectedCourse = only;
        }

        setClassEnabled((courses || []).length > 0);
      }

      function checkEmailAndLoadCourses(autoRun) {
        var emailInput = document.getElementById('alb-input-email');
        var checkBtn = document.getElementById('alb-btn-check-email');
        var email = emailInput ? emailInput.value.trim() : '';

        if (!email || email.indexOf('@') === -1) {
          if (emailInput) emailInput.style.borderColor = 'red';
          setMiniStatus('Masukkan email Moodle yang valid terlebih dahulu.', 'error');
          return;
        }

        if (emailInput) emailInput.style.borderColor = '#e5e5e5';
        if (checkBtn) {
          checkBtn.disabled = true;
          checkBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i>Mengecek...';
          checkBtn.style.opacity = '0.7';
        }

        setMiniStatus('Sedang mengecek email ke data peserta Moodle...', 'warning');
        setClassEnabled(false);
        renderClassOptions([]);

        fetchWithTimeout(apiBase + '/api/moodle/student/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectKey: projectKey,
            email: email
          })
        }, ALB_REQUEST_TIMEOUT_MS, 'Cek email Moodle')
        .then(function(res) { return res.json(); })
        .then(function(res) {
          if (!res || res.status !== 'success' || !res.data || !res.data.found) {
            resolvedIdentity = null;
            setMiniStatus((res && res.data && res.data.message) || (res && res.message) || 'Email tidak ditemukan di course Moodle yang tersinkron.', 'error');
            return;
          }

          emailCheckTimeoutCount = 0;
          resolvedIdentity = res.data;
          var courses = res.data.enrolled_courses || [];

          if (!courses.length) {
            setMiniStatus('Email ditemukan, tetapi sistem belum menemukan daftar course/kelas dari akun ini. Coba sinkronisasi course di dashboard.', 'error');
            return;
          }

          renderClassOptions(courses);
          var name = res.data.fullname || email.split('@')[0];
          setMiniStatus('Akun ditemukan: <b>' + escapeHtmlInline(name) + '</b>. Silakan pilih kelas yang ingin digunakan.', 'success');
        })
        .catch(function(err) {
          console.error('[AI Buddy] Gagal cek email Moodle:', err);
          resolvedIdentity = null;
          if (err && (err.albTimeout || err.name === 'AbortError')) {
            emailCheckTimeoutCount += 1;
            var retryText = emailCheckTimeoutCount >= 3
              ? 'Sudah 3 kali timeout. Kemungkinan Moodle/server sedang lambat. Coba tanya menu lain dulu atau ulangi beberapa menit lagi.'
              : 'Coba klik tombol Cek Email sekali lagi. Kalau masih lama, tunggu sebentar lalu ulangi.';
            setMiniStatus('Cek email ke Moodle terlalu lama, bukan karena email kamu salah. ' + retryText, 'warning');
          } else {
            setMiniStatus('Gagal mengecek email. Pastikan koneksi Moodle dan API aktif. Coba klik Cek Email lagi.', 'error');
          }
        })
        .finally(function() {
          if (checkBtn) {
            checkBtn.disabled = false;
            checkBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass" style="margin-right:6px;"></i>Cek Email';
            checkBtn.style.opacity = '1';
          }
        });
      }

      var overlay = document.createElement('div');
      overlay.id = 'alb-mini-form-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:9999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';

      overlay.innerHTML = [
        '<div style="background:#fff;padding:24px;border-radius:16px;width:92%;max-width:380px;box-shadow:0 10px 25px rgba(0,0,0,0.2);font-family:Inter, system-ui, sans-serif;">',
        '  <h3 style="margin:0 0 6px 0;font-size:18px;color:#1a1a1a;font-weight:700;">Mulai Sesi Belajar</h3>',
        '  <p style="margin:0 0 12px 0;font-size:13px;color:#666;line-height:1.5;">Masukkan email Moodle dulu. Setelah email terdeteksi, pilihan kelas akan muncul sesuai course yang kamu ikuti.</p>',
        noteHtml,
        '  <label style="display:block;font-size:12px;color:#444;font-weight:700;margin-bottom:6px;">Email Moodle</label>',
        '  <div style="display:flex;gap:8px;margin-bottom:12px;">',
        '    <input id="alb-input-email" type="email" value="' + escapeHtmlInline(prefillEmail) + '" placeholder="Email Moodle kamu" style="flex:1;min-width:0;padding:10px 12px;border:1px solid #e5e5e5;border-radius:8px;box-sizing:border-box;font-size:14px;outline:none;"">',
        '    <button id="alb-btn-check-email" type="button" style="padding:10px 12px;border:none;background:'+primaryColor+';color:'+buttonTextColor+';border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;white-space:nowrap;"><i class="fa-solid fa-magnifying-glass" style="margin-right:6px;"></i>Cek Email</button>',
        '  </div>',
        '  <div id="alb-mini-status" style="display:none;margin-bottom:12px;padding:9px 10px;border:1px solid #fde68a;border-radius:8px;font-size:12px;line-height:1.4;"></div>',
        '  <label style="display:block;font-size:12px;color:#444;font-weight:700;margin-bottom:6px;">Kelas / Course</label>',
        '  <select id="alb-input-kelas" disabled style="width:100%;padding:10px 12px;margin-bottom:18px;border:1px solid #e5e5e5;border-radius:8px;box-sizing:border-box;font-size:14px;outline:none;background:#fff;color:#1a1a1a;"">',
        '    <option value="">Cek email dulu</option>',
        '  </select>',
        '  <div style="display:flex;gap:8px;justify-content:flex-end;">',
        '    <button id="alb-btn-cancel" style="padding:9px 16px;border:none;background:transparent;color:#666;cursor:pointer;font-weight:600;font-size:13px;border-radius:6px;">Batal</button>',
        '    <button id="alb-btn-submit" disabled style="padding:9px 16px;border:none;background:'+primaryColor+';color:'+buttonTextColor+';border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;opacity:0.55;transition:opacity 0.2s;">Mulai Sesi <i class="fa-solid fa-arrow-right" style="margin-left:4px;"></i></button>',
        '  </div>',
        '</div>'
      ].join('');

      document.body.appendChild(overlay);

      var emailInput = document.getElementById('alb-input-email');
      var kelasSelect = document.getElementById('alb-input-kelas');
      [emailInput, kelasSelect].forEach(function(el) {
        if (!el) return;
        el.onfocus = function() { this.style.borderColor = primaryColor; };
        el.onblur = function() { this.style.borderColor = '#e5e5e5'; };
      });

      setClassEnabled(false);

      document.getElementById('alb-btn-cancel').onclick = function() {
        document.body.removeChild(overlay);
      };

      document.getElementById('alb-btn-check-email').onclick = function() {
        checkEmailAndLoadCourses(false);
      };

      var emailInputEl = document.getElementById('alb-input-email');
      if (emailInputEl) {
        emailInputEl.addEventListener('input', function() {
          resolvedIdentity = null;
          selectedCourse = null;
          renderClassOptions([]);
          setClassEnabled(false);
          setMiniStatus('', '');
        });
        emailInputEl.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            checkEmailAndLoadCourses(false);
          }
        });
      }

      document.getElementById('alb-input-kelas').onchange = function() {
        var selectedClass = this.value;
        selectedCourse = null;
        if (resolvedIdentity && Array.isArray(resolvedIdentity.enrolled_courses)) {
          selectedCourse = resolvedIdentity.enrolled_courses.find(function(course) {
            return normalizeClassCodeLocal(course.class_code || course.classCode || '') === selectedClass;
          }) || null;
        }
        setClassEnabled(Boolean(selectedClass && selectedCourse));
      };

      document.getElementById('alb-btn-submit').onclick = function() {
        var email = document.getElementById('alb-input-email').value.trim();
        var kelas = document.getElementById('alb-input-kelas').value.trim();

        if (!resolvedIdentity || !resolvedIdentity.found) {
          setMiniStatus('Cek email dulu sampai akun Moodle ditemukan.', 'error');
          return;
        }

        if (!selectedCourse || !kelas) {
          setMiniStatus('Pilih kelas yang tersedia dari akun Moodle kamu.', 'error');
          return;
        }

        var fullName = resolvedIdentity.fullname || email.split('@')[0];
        var alias = fullName + ' - ' + kelas;
        sessionStorage.setItem('alb_student_name', fullName);

        var btnSubmit = document.getElementById('alb-btn-submit');
        btnSubmit.innerHTML = 'Menyiapkan...';
        btnSubmit.disabled = true;
        btnSubmit.style.opacity = '0.7';

        var courseId = selectedCourse.course_id || selectedCourse.courseId || prefillCourseId || getCourseIdFromUrl(window.location.href);
        var courseTitle = selectedCourse.course_title || selectedCourse.courseTitle || null;
        var courseUrl = selectedCourse.course_url || selectedCourse.courseUrl || null;

        var sessionMeta = {
          display_name: fullName,
          moodle_verified: true,
          moodle_user_id: resolvedIdentity.moodle_user_id || null,
          username: resolvedIdentity.username || null,
          email: resolvedIdentity.email || email,
          class_code: kelas,
          course_id: courseId,
          course_title: courseTitle,
          course_url: courseUrl,
          enrolled_courses: resolvedIdentity.enrolled_courses || [],
          page_activities: prefillContext.page_activities || extractCoursePageActivities()
        };

        var payload = {
          projectKey: projectKey,
          sourceUrl: window.location.href,
          studentAlias: alias,
          mode: 'external',
          courseContext: {
            class_code: kelas,
            course_id: courseId,
            course_title: courseTitle,
            course_url: courseUrl,
            enrolled_courses: resolvedIdentity.enrolled_courses || [],
            page_activities: sessionMeta.page_activities || []
          },
          pageContext: {
            title: document.title,
            heading: (document.querySelector('h1') || {}).innerText || '',
            summary: (document.querySelector('main p') || {}).innerText || 'Halaman Virtual Class',
            session_meta: sessionMeta,
            page_activities: sessionMeta.page_activities || []
          },
          moodleContext: sessionMeta
        };

        fetchWithTimeout(apiBase + '/api/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, ALB_REQUEST_TIMEOUT_MS, 'Mulai sesi AI Buddy')
        .then(function(res) {
          if (!res.ok) throw new Error('Gagal membuat sesi external.');
          return res.json();
        })
        .then(function(res) {
          if (res.status === 'success' && res.data.session) {
            document.body.removeChild(overlay);
            var targetUrl = appUrl + '/buddy?projectKey=' + encodeURIComponent(projectKey) + '&sessionId=' + encodeURIComponent(res.data.session.id) + '&mode=external';
            window.open(targetUrl, 'alb_ai_workspace');
          } else {
            throw new Error('Gagal menghubungkan ke AI Buddy.');
          }
        })
        .catch(function(err) {
          console.error('[AI Buddy] Error:', err);
          setMiniStatus((err && (err.albTimeout || err.name === 'AbortError')) ? 'Membuka sesi terlalu lama. Coba klik Mulai Sesi lagi. Jika masih timeout 3 kali, kemungkinan Moodle/server sedang lambat.' : 'Gagal menghubungkan ke AI Buddy. Coba lagi.', (err && (err.albTimeout || err.name === 'AbortError')) ? 'warning' : 'error');
          btnSubmit.innerHTML = 'Mulai Sesi <i class="fa-solid fa-arrow-right" style="margin-left:4px;"></i>';
          btnSubmit.disabled = false;
          btnSubmit.style.opacity = '1';
        });
      };

      if (prefillEmail) {
        setTimeout(function() { checkEmailAndLoadCourses(true); }, 250);
      }
    }


    btn.onclick = function() {
      btn.innerHTML = '<span style="font-size:18px;display:inline-block;animation:spin 1s linear infinite;">↻</span><style>@keyframes spin { 100% { transform:rotate(360deg); } }</style>';
      btn.disabled = true;

      var ctx = extractMoodleContext();
      ctx.page_activities = extractCoursePageActivities();
      var isLoggedIn = checkMoodleLoginStatus();

      // [v0.9.14] Sudah login + data user & course terbaca → langsung auto ke AIworkspace.
      // Kalau belum login ATAU data belum terbaca → tampilkan form (dengan catatan kontekstual).
      if (isLoggedIn && (ctx.email || ctx.moodle_user_id) && ctx.course_id) {
        fetchWithTimeout(apiBase + '/api/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectKey: projectKey,
            sourceUrl: window.location.href,
            pageContext: { title: document.title, session_meta: ctx, page_activities: ctx.page_activities || [] },
            courseContext: {
              course_id: ctx.course_id || null,
              course_title: ctx.course_title || null,
              page_activities: ctx.page_activities || []
            },
            moodleContext: ctx
          })
        }, ALB_REQUEST_TIMEOUT_MS, 'Auto sesi AI Buddy')
        .then(function(r) { return r.json(); })
        .then(function(res) {
          btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Tanya AI';
          btn.disabled = false;

          if (res.status === 'success' && res.data && res.data.session) {
            var targetUrl = appUrl + '/buddy?projectKey=' + encodeURIComponent(projectKey) + '&sessionId=' + encodeURIComponent(res.data.session.id) + '&mode=external';
            window.open(targetUrl, 'alb_ai_workspace');
          } else {
            showMiniForm(ctx, isLoggedIn);
          }
        })
        .catch(function(err) {
          console.error('[AI Buddy] Auto session gagal (CORS/Network):', err);
          btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Tanya AI';
          btn.disabled = false;
          showMiniForm(ctx, isLoggedIn);
        });
      } else {
        btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Tanya AI';
        btn.disabled = false;
        showMiniForm(ctx, isLoggedIn);
      }
    };

    document.body.appendChild(btn);
  }

  fetchWithTimeout(apiBase + '/api/widget/config/' + encodeURIComponent(projectKey) + '?t=' + Date.now(), { cache: 'no-store' }, ALB_REQUEST_TIMEOUT_MS, 'Load konfigurasi widget')
    .then(function(r) {
      if (!r.ok) throw new Error('Gagal mengambil config widget. HTTP ' + r.status);
      return r.json();
    })
    .then(function(result) {
      if (result && result.status === 'success') renderButton(result.data);
      else console.error('[AI Buddy External] Config error:', result);
    })
    .catch(function(err) {
      console.error('[AI Buddy External] Gagal load config:', err);
    });
})();
    `.trim();
  }
};

module.exports = externalLoaderService;
