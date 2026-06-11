const externalLoaderService = {
  generate() {
    return `
(function () {
  var currentScript = document.currentScript;
  var scriptUrl = new URL(currentScript.src);

  var apiBase = currentScript.dataset.apiBase || scriptUrl.origin;
  var appUrl = currentScript.dataset.appUrl || 'http://localhost:4321';
  var projectKey = currentScript.dataset.projectKey || scriptUrl.searchParams.get('projectKey');

  if (!projectKey) {
    console.error('[AI Learning Buddy] projectKey tidak ditemukan pada external loader');
    return;
  }

  if (document.getElementById('alb-external-launcher')) return;


  function getCourseIdFromUrl(url) {
    try {
      var parsed = new URL(url || window.location.href, window.location.href);
      return parsed.searchParams.get('id') || '2';
    } catch (e) {
      return '2';
    }
  }

  function resolveNavigationUrl(targetUrl, pageType, courseId) {
    var LMS_BASE = 'https://lms.smpn167jakarta.sch.id';
    var cleanType = String(pageType || '').toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    var id = courseId || getCourseIdFromUrl(window.location.href);

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
      '  right: 24px;',
      '  bottom: 24px;',
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
      '@media (max-width: 640px) { .alb-ext-launcher-btn { right: 16px; bottom: 16px; padding: 11px 16px; font-size: 14px; } }'
    ].join('\\n');

    document.head.appendChild(style);
  }

  function renderButton(config) {
    createStyle(config);

    var btn = document.createElement('button');
    btn.id = 'alb-external-launcher';
    btn.className = 'alb-ext-launcher-btn';
    btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Tanya AI';

    function showMiniForm() {
      if (document.getElementById('alb-mini-form-overlay')) return;

      var theme = config.theme || {};
      if (typeof theme === 'string') { try { theme = JSON.parse(theme); } catch (e) { theme = {}; } }
      var primaryColor = theme.primaryColor || '#0c0a09';
      var buttonTextColor = theme.buttonTextColor || '#ffffff';

      var overlay = document.createElement('div');
      overlay.id = 'alb-mini-form-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:9999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';

      overlay.innerHTML = [
        '<div style="background:#fff;padding:24px;border-radius:12px;width:90%;max-width:320px;box-shadow:0 10px 25px rgba(0,0,0,0.2);font-family:Inter, system-ui, sans-serif;">',
        '  <h3 style="margin:0 0 6px 0;font-size:18px;color:#1a1a1a;font-weight:700;">Mulai Sesi Belajar</h3>',
        '  <p style="margin:0 0 16px 0;font-size:13px;color:#666;">Beri tahu AI Buddy namamu agar dia bisa mengenalimu.</p>',
        '  <input id="alb-input-nama" type="text" placeholder="Nama Lengkap / Panggilan" style="width:100%;padding:10px 12px;margin-bottom:12px;border:1px solid #e5e5e5;border-radius:8px;box-sizing:border-box;font-size:14px;outline:none;" onfocus="this.style.borderColor=\\''+primaryColor+'\\'" onblur="this.style.borderColor=\\'#e5e5e5\\'">',
        '  <select id="alb-input-kelas" style="width:100%;padding:10px 12px;margin-bottom:20px;border:1px solid #e5e5e5;border-radius:8px;box-sizing:border-box;font-size:14px;outline:none;background:#fff;color:#1a1a1a;" onfocus="this.style.borderColor=\\''+primaryColor+'\\'" onblur="this.style.borderColor=\\'#e5e5e5\\'">',
        '    <option value="">Pilih Kelas</option>',
        '    <option value="8A">8A</option>',
        '    <option value="8B">8B</option>',
        '    <option value="8C">8C</option>',
        '    <option value="8D">8D</option>',
        '    <option value="8E">8E</option>',
        '    <option value="8F">8F</option>',
        '    <option value="8G">8G</option>',
        '    <option value="8H">8H</option>',
        '  </select>',
        '  <div style="display:flex;gap:8px;justify-content:flex-end;">',
        '    <button id="alb-btn-cancel" style="padding:8px 16px;border:none;background:transparent;color:#666;cursor:pointer;font-weight:600;font-size:13px;border-radius:6px;">Batal</button>',
        '    <button id="alb-btn-submit" style="padding:8px 16px;border:none;background:'+primaryColor+';color:'+buttonTextColor+';border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;transition:opacity 0.2s;">Mulai Sesi <i class="fa-solid fa-arrow-right" style="margin-left:4px;"></i></button>',
        '  </div>',
        '</div>'
      ].join('');

      document.body.appendChild(overlay);

      document.getElementById('alb-btn-cancel').onclick = function() {
        document.body.removeChild(overlay);
      };

      document.getElementById('alb-btn-submit').onclick = function() {
        var nama = document.getElementById('alb-input-nama').value.trim();
        var kelas = document.getElementById('alb-input-kelas').value.trim();

        if (!nama) {
          document.getElementById('alb-input-nama').style.borderColor = 'red';
          return;
        }

        if (!kelas) {
          document.getElementById('alb-input-kelas').style.borderColor = 'red';
          return;
        }
        var alias = nama + (kelas ? ' - ' + kelas : '');
        sessionStorage.setItem('alb_student_name', alias);

        var btnSubmit = document.getElementById('alb-btn-submit');
        btnSubmit.innerHTML = 'Menyiapkan...';
        btnSubmit.disabled = true;
        btnSubmit.style.opacity = '0.7';

        // PAYLOAD BARU: Tanpa getPageContext() yang berat
        var cleanKelas = kelas;

        var payload = {
          projectKey: projectKey,
          sourceUrl: window.location.href,
          studentAlias: alias,
          mode: 'external',

          courseContext: {
            class_code: cleanKelas
          },

          pageContext: {
            title: document.title,
            heading: (document.querySelector('h1') || {}).innerText || '',
            summary: (document.querySelector('main p') || {}).innerText || 'Halaman Virtual Class',
            session_meta: {
              display_name: alias,
              class_code: cleanKelas
            }
          }
        };

        fetch(apiBase + '/api/chat/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
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
            alert('Gagal menghubungkan ke AI Buddy.');
            btnSubmit.innerHTML = 'Coba Lagi';
            btnSubmit.disabled = false;
            btnSubmit.style.opacity = '1';
          }
        })
        .catch(function(err) {
          console.error('[AI Buddy] Error:', err);
          alert('Gagal menghubungkan ke AI Buddy.');
          btnSubmit.innerHTML = 'Coba Lagi';
          btnSubmit.disabled = false;
          btnSubmit.style.opacity = '1';
        });
      };
    }

    btn.onclick = function() {
      showMiniForm();
    };

    document.body.appendChild(btn);
  }

  fetch(apiBase + '/api/widget/config/' + encodeURIComponent(projectKey) + '?t=' + Date.now(), { cache: 'no-store' })
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
