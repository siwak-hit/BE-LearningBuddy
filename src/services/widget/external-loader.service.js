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

  // [v0.9.90] Posisi tombol dipilih siswa (4 pojok) & disimpan per-browser.
  var ALB_CORNER_KEY = 'alb_launcher_corner';
  var ALB_CORNERS = ['br', 'bl', 'tr', 'tl'];
  var ALB_IDLE_MS = 10000;

  function readCorner() {
    try {
      var saved = localStorage.getItem(ALB_CORNER_KEY);
      return ALB_CORNERS.indexOf(saved) !== -1 ? saved : 'br';
    } catch (e) { return 'br'; }
  }

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
      // Wrapper memegang POSISI (4 pojok) + peredupan idle. Tombol sendiri tinggal
      // urusan tampilan, jadi pindah pojok cukup ganti 1 class di wrapper.
      '.alb-ext-wrap {',
      '  position: fixed;',
      '  z-index: 999999;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 8px;',
      '  opacity: 1;',
      '  transition: opacity 0.45s ease;',
      '  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '}',
      // [v0.9.90] Idle 10 detik → redup 50% supaya tak mengganggu halaman LMS.
      '.alb-ext-wrap.alb-ext-idle { opacity: 0.5; }',
      // [v0.9.9] Pojok kanan bawah digeser ke kiri (24px → 96px) & dinaikkan (24 → 25px)
      // agar tidak menimpa tombol bundar bawaan LMS di pojok yang sama.
      '.alb-ext-wrap.alb-ext-br { right: 96px; bottom: 25px; align-items: flex-end; }',
      '.alb-ext-wrap.alb-ext-bl { left: 24px; bottom: 25px; align-items: flex-start; }',
      // Pojok atas: menu pemilih pojok harus muncul DI BAWAH tombol, bukan keluar layar.
      '.alb-ext-wrap.alb-ext-tr { right: 24px; top: 24px; align-items: flex-end; flex-direction: column-reverse; }',
      '.alb-ext-wrap.alb-ext-tl { left: 24px; top: 24px; align-items: flex-start; flex-direction: column-reverse; }',
      '.alb-ext-launcher-btn {',
      '  position: relative;', // jangkar untuk grip mode ikon-saja
      '  border: none;',
      '  border-radius: 9999px;',
      '  background: ' + primaryColor + ';',
      '  color: ' + buttonTextColor + ';',
      '  padding: 12px 20px;',
      '  cursor: pointer;',
      '  font-size: 15px;',
      '  font-weight: 600;',
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.14);',
      '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  font-family: inherit;',
      '}',
      '.alb-ext-launcher-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.18); }',
      '.alb-ext-launcher-btn:disabled { opacity: 0.72; cursor: not-allowed; transform: none; }',
      // Mode "ikon saja" (switch guru di Widget Config) → tombol jadi bundar.
      '.alb-ext-launcher-btn.alb-ext-icon-only { padding: 0; width: 48px; height: 48px; justify-content: center; }',
      '.alb-ext-launcher-btn.alb-ext-icon-only .alb-ext-label { display: none; }',
      // Pegangan kecil di dalam tombol: klik → menu pilih pojok.
      '.alb-ext-grip {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  width: 20px;',
      '  height: 20px;',
      '  margin-right: 2px;',
      '  border-radius: 6px;',
      '  font-size: 10px;',
      '  opacity: 0.65;',
      '  background: rgba(255,255,255,0.16);',
      '}',
      '.alb-ext-grip:hover { opacity: 1; background: rgba(255,255,255,0.3); }',
      '.alb-ext-launcher-btn.alb-ext-icon-only .alb-ext-grip { position: absolute; margin: 0; transform: translate(18px, -18px); background: ' + primaryColor + '; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }',
      '.alb-ext-corner-menu {',
      '  display: grid;',
      '  grid-template-columns: repeat(2, 1fr);',
      '  gap: 6px;',
      '  padding: 8px;',
      '  background: #ffffff;',
      '  border: 1px solid #e7e5e4;',
      '  border-radius: 12px;',
      '  box-shadow: 0 8px 24px rgba(0,0,0,0.18);',
      '}',
      '.alb-ext-corner-menu.alb-ext-hidden { display: none; }',
      '.alb-ext-corner-menu-title { grid-column: 1 / -1; font-size: 11px; font-weight: 700; color: #78716c; text-align: center; }',
      '.alb-ext-corner-btn {',
      '  width: 34px; height: 34px;',
      '  display: flex; align-items: center; justify-content: center;',
      '  border: 1px solid #e7e5e4;',
      '  border-radius: 8px;',
      '  background: #fafaf9;',
      '  color: #44403c;',
      '  font-size: 13px;',
      '  cursor: pointer;',
      '}',
      '.alb-ext-corner-btn:hover { background: #f0efed; }',
      '.alb-ext-corner-btn.alb-ext-corner-active { background: ' + primaryColor + '; color: ' + buttonTextColor + '; border-color: ' + primaryColor + '; }',
      // ---- [v0.9.91] Panel pilihan cara membuka -------------------------------
      '.alb-ext-choice-menu {',
      '  display: flex; flex-direction: column; gap: 6px;',
      '  width: 268px; max-width: calc(100vw - 32px);',
      '  padding: 10px;',
      '  background: #ffffff; border: 1px solid #e7e5e4; border-radius: 14px;',
      '  box-shadow: 0 12px 32px rgba(0,0,0,0.2);',
      '}',
      '.alb-ext-choice-menu.alb-ext-hidden { display: none; }',
      '.alb-ext-choice-title { font-size: 11px; font-weight: 800; color: #78716c; text-transform: uppercase; letter-spacing: .04em; padding: 2px 4px 4px; }',
      '.alb-ext-choice-btn {',
      '  display: flex; align-items: center; gap: 10px; text-align: left;',
      '  padding: 9px 10px; border: 1px solid #e7e5e4; border-radius: 10px;',
      '  background: #fafaf9; cursor: pointer; font-family: inherit; width: 100%;',
      '}',
      '.alb-ext-choice-btn:hover { background: #f0efed; border-color: ' + primaryColor + '; }',
      '.alb-ext-choice-ico {',
      '  width: 32px; height: 32px; flex: 0 0 32px; border-radius: 8px;',
      '  display: flex; align-items: center; justify-content: center;',
      '  background: ' + primaryColor + '; color: ' + buttonTextColor + '; font-size: 13px;',
      '}',
      '.alb-ext-choice-txt { display: flex; flex-direction: column; min-width: 0; }',
      '.alb-ext-choice-txt b { font-size: 13.5px; color: #0c0a09; line-height: 1.3; }',
      '.alb-ext-choice-txt small { font-size: 11px; color: #78716c; line-height: 1.35; margin-top: 1px; }',

      // ---- Panel chat inline --------------------------------------------------
      '.alb-inline-panel {',
      '  position: fixed; right: 24px; bottom: 88px; z-index: 2147483000;',
      '  width: 340px; max-width: calc(100vw - 24px); height: 460px; max-height: calc(100vh - 120px);',
      '  display: flex; flex-direction: column; overflow: hidden;',
      '  background: #ffffff; border: 1px solid #e7e5e4; border-radius: 16px;',
      '  box-shadow: 0 16px 48px rgba(0,0,0,0.24);',
      '  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '}',
      '.alb-inline-panel.alb-ext-hidden { display: none; }',
      '.alb-inline-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #f0efed; }',
      '.alb-inline-head-txt { display: flex; flex-direction: column; min-width: 0; }',
      '.alb-inline-head-txt b { font-size: 14px; color: #0c0a09; }',
      '.alb-inline-head-txt small { font-size: 11px; color: #78716c; }',
      '.alb-inline-close { width: 30px; height: 30px; flex: 0 0 30px; border: 1px solid #e7e5e4; border-radius: 999px; background: #fafaf9; color: #57534e; cursor: pointer; }',
      '.alb-inline-note { display: flex; gap: 7px; padding: 9px 14px; background: #fffbeb; border-bottom: 1px solid #fde68a; font-size: 11px; line-height: 1.45; color: #92400e; }',
      '.alb-inline-body { flex: 1; overflow-y: auto; padding: 12px 14px; background: #f8fafc; font-size: 13.5px; }',
      // Gelembung polos: TANPA ikon user/robot, sesuai permintaan mode ringkas.
      '.alb-inline-msg { margin-bottom: 9px; padding: 9px 12px; border-radius: 12px; line-height: 1.5; max-width: 88%; word-wrap: break-word; }',
      '.alb-inline-bot { background: #ffffff; border: 1px solid #e7e5e4; color: #1c1917; }',
      '.alb-inline-user { background: ' + primaryColor + '; color: ' + buttonTextColor + '; margin-left: auto; }',
      '.alb-inline-typing { color: #78716c; font-style: italic; }',
      '.alb-inline-tut-btn, .alb-inline-open-tab {',
      '  display: inline-flex; align-items: center; gap: 6px; margin-top: 9px;',
      '  padding: 7px 12px; border-radius: 999px; cursor: pointer; font-family: inherit;',
      '  font-size: 12.5px; font-weight: 700;',
      '  background: ' + primaryColor + '; color: ' + buttonTextColor + '; border: 0;',
      '}',
      '.alb-inline-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f0efed; background: #fff; }',
      '.alb-inline-input { flex: 1; min-width: 0; border: 1px solid #d6d3d1; border-radius: 999px; padding: 9px 14px; font-size: 13.5px; outline: none; font-family: inherit; }',
      '.alb-inline-input:focus { border-color: ' + primaryColor + '; }',
      '.alb-inline-send { width: 38px; height: 38px; flex: 0 0 38px; border: 0; border-radius: 999px; background: ' + primaryColor + '; color: ' + buttonTextColor + '; cursor: pointer; }',
      '@media (max-width: 640px) { .alb-inline-panel { right: 8px; left: 8px; width: auto; bottom: 84px; height: 68vh; } }',

      // ---- Modal panduan bergambar (z-index tertinggi, di atas apa pun milik LMS) ----
      '.alb-tut-overlay {',
      '  position: fixed; inset: 0; z-index: 2147483600;',
      '  display: flex; align-items: center; justify-content: center; padding: 16px;',
      '  background: rgba(2,6,23,0.78);',
      '  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '}',
      '.alb-tut-overlay.alb-ext-hidden { display: none; }',
      '.alb-tut-card { display: flex; flex-direction: column; width: 100%; max-width: 620px; height: min(86vh, 720px); background: #fff; border-radius: 16px; overflow: hidden; }',
      '.alb-tut-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }',
      '.alb-tut-title { font-size: 15px; font-weight: 800; color: #0f172a; }',
      '.alb-tut-close { width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid #e2e8f0; border-radius: 999px; background: #f8fafc; color: #475569; cursor: pointer; }',
      '.alb-tut-imgwrap { flex: 3; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 12px; background: #f1f5f9; }',
      '.alb-tut-img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 10px; }',
      '.alb-tut-txt { flex: 2; min-height: 0; overflow-y: auto; padding: 14px 18px; border-top: 1px solid #f1f5f9; }',
      '.alb-tut-counter { display: inline-block; font-size: 11px; font-weight: 800; color: ' + primaryColor + '; background: #f1f5f9; padding: 3px 9px; border-radius: 999px; }',
      '.alb-tut-step-title { margin: 8px 0 6px; font-size: 16px; font-weight: 800; color: #0f172a; }',
      '.alb-tut-step-text { margin: 0; font-size: 14px; line-height: 1.6; color: #334155; }',
      '.alb-tut-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-top: 1px solid #f1f5f9; }',
      '.alb-tut-foot button { padding: 8px 16px; border-radius: 999px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }',
      '.alb-tut-prev { border: 1px solid #e2e8f0; background: #fff; color: #334155; }',
      '.alb-tut-prev:disabled { opacity: .35; cursor: not-allowed; }',
      '.alb-tut-next { border: 0; background: ' + primaryColor + '; color: ' + buttonTextColor + '; }',

      '@media (max-width: 640px) {',
      '  .alb-ext-wrap.alb-ext-br { right: 84px; bottom: 29px; }',
      '  .alb-ext-launcher-btn { padding: 11px 16px; font-size: 14px; }',
      '}'
    ].join('\\n');

    document.head.appendChild(style);
  }

  function renderButton(config) {
    createStyle(config);

    var btnTheme = config.theme || {};
    if (typeof btnTheme === 'string') { try { btnTheme = JSON.parse(btnTheme); } catch (e) { btnTheme = {}; } }
    var launcherText = (btnTheme.title && String(btnTheme.title).trim()) ? String(btnTheme.title).trim() : 'Tanya AI';
    var safeLauncherText = launcherText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // [v0.9.90] Switch guru: tampilkan teks + ikon, atau cukup ikon saja.
    var iconOnly = btnTheme.iconOnly === true;

    var GRIP_HTML = '<span class="alb-ext-grip" title="Pindahkan tombol"><i class="fa-solid fa-grip-vertical"></i></span>';
    var IDLE_HTML = GRIP_HTML + '<i class="fa-solid fa-sparkles"></i><span class="alb-ext-label">' + safeLauncherText + '</span>';

    var wrap = document.createElement('div');
    wrap.id = 'alb-external-launcher-wrap';
    wrap.className = 'alb-ext-wrap alb-ext-' + readCorner();

    // Menu 4 pojok. Panah diagonal FA6 hanya ada di versi Pro, jadi pakai fa-arrow-up
    // yang diputar — hasil visualnya sama dan tetap jalan di Font Awesome Free.
    var menu = document.createElement('div');
    menu.id = 'alb-ext-corner-menu';
    menu.className = 'alb-ext-corner-menu alb-ext-hidden';
    menu.innerHTML = '<div class="alb-ext-corner-menu-title">Pindah ke pojok</div>' + [
      { c: 'tl', deg: -45, t: 'Kiri atas' },
      { c: 'tr', deg: 45, t: 'Kanan atas' },
      { c: 'bl', deg: -135, t: 'Kiri bawah' },
      { c: 'br', deg: 135, t: 'Kanan bawah' }
    ].map(function (o) {
      return '<button type="button" class="alb-ext-corner-btn" data-corner="' + o.c + '" title="' + o.t + '">'
        + '<i class="fa-solid fa-arrow-up" style="transform:rotate(' + o.deg + 'deg);"></i></button>';
    }).join('');

    // [v0.9.91] Panel pilihan cara membuka: tab baru (lengkap) atau chat di halaman ini
    // (ringkas, panduan saja). Muncul saat tombol utama diklik.
    var choiceMenu = document.createElement('div');
    choiceMenu.id = 'alb-ext-choice-menu';
    choiceMenu.className = 'alb-ext-choice-menu alb-ext-hidden';
    choiceMenu.innerHTML = [
      '<div class="alb-ext-choice-title">Mau dibuka di mana?</div>',
      '<button type="button" class="alb-ext-choice-btn" data-choice="tab">',
      '  <span class="alb-ext-choice-ico"><i class="fa-solid fa-arrow-up-right-from-square"></i></span>',
      '  <span class="alb-ext-choice-txt"><b>Buka di tab baru</b><small>Lengkap: tanya materi, AI, nilai &amp; tugas</small></span>',
      '</button>',
      '<button type="button" class="alb-ext-choice-btn" data-choice="inline">',
      '  <span class="alb-ext-choice-ico"><i class="fa-solid fa-comment-dots"></i></span>',
      '  <span class="alb-ext-choice-txt"><b>Chat di halaman ini</b><small>Ringkas: panduan pakai VClass saja</small></span>',
      '</button>'
    ].join('');

    var btn = document.createElement('button');
    btn.id = 'alb-external-launcher';
    btn.className = 'alb-ext-launcher-btn' + (iconOnly ? ' alb-ext-icon-only' : '');
    btn.innerHTML = IDLE_HTML;

    wrap.appendChild(menu);
    wrap.appendChild(choiceMenu);
    wrap.appendChild(btn);

    // ---- Peredupan idle: 10 detik setelah halaman siap, tombol jadi 50% ----------
    var idleTimer = null;
    function armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { wrap.classList.add('alb-ext-idle'); }, ALB_IDLE_MS);
    }
    function wake() {
      wrap.classList.remove('alb-ext-idle');
      armIdle();
    }
    function isIdle() { return wrap.classList.contains('alb-ext-idle'); }

    function toggleCornerMenu(show) {
      menu.classList.toggle('alb-ext-hidden', !show);
      if (show) clearTimeout(idleTimer); else armIdle();
    }

    function toggleChoiceMenu(show) {
      choiceMenu.classList.toggle('alb-ext-hidden', !show);
      if (show) clearTimeout(idleTimer); else armIdle();
    }

    function applyCorner(corner) {
      ALB_CORNERS.forEach(function (c) { wrap.classList.remove('alb-ext-' + c); });
      wrap.classList.add('alb-ext-' + corner);
      try { localStorage.setItem(ALB_CORNER_KEY, corner); } catch (e) {}
      Array.prototype.forEach.call(menu.querySelectorAll('.alb-ext-corner-btn'), function (b) {
        b.classList.toggle('alb-ext-corner-active', b.getAttribute('data-corner') === corner);
      });
    }
    applyCorner(readCorner());

    menu.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('.alb-ext-corner-btn') : null;
      if (!target) return;
      e.stopPropagation();
      applyCorner(target.getAttribute('data-corner'));
      toggleCornerMenu(false);
      wake();
    });

    // Klik di luar → tutup kedua menu.
    document.addEventListener('click', function (e) {
      if (wrap.contains(e.target)) return;
      toggleCornerMenu(false);
      toggleChoiceMenu(false);
    });

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

        // Beberapa tema Moodle menaruh email sebagai teks biasa di menu user / kartu profil.
        if (!ctx.email) {
          var menuText = (document.querySelector('.usermenu, #usernavigation, .profile_tree, [data-region="user-menu"]') || {}).innerText || '';
          var em = menuText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i);
          if (em) ctx.email = em[0].trim();
        }

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

    // [config] Klik widget = LANGSUNG buka AI Buddy (tab baru / PWA bila sudah terpasang).
    // Tidak ada lagi form email di halaman Moodle. Email siswa diambil otomatis dari
    // halaman/profil Moodle (same-origin, cookie login ikut) supaya fitur "@materi" di
    // dalam app tak perlu minta email lagi. Kalau tak terbaca, siswa tetap masuk dan baru
    // diminta email saat membuka drawer materi.
    // [v0.9.84] Cache email di localStorage DIHAPUS. Cache itu bertahan setelah browser
    // ditutup, jadi siswa berikutnya yang memakai perangkat sama bisa terbawa identitas
    // siswa sebelumnya. Email sekarang selalu dibaca LANGSUNG dari sesi Moodle yang
    // sedang login (DOM → halaman profil), jadi tak pernah basi.

    // Halaman profil Moodle = sumber email paling andal lintas tema. Origin sama dengan
    // halaman ini, jadi cookie sesi ikut terkirim dan tak ada masalah CORS.
    function fetchEmailFromProfile(userId) {
      if (!userId) return Promise.resolve('');
      return fetchWithTimeout('/user/profile.php?id=' + encodeURIComponent(userId), { credentials: 'same-origin' }, 8000, 'Baca profil Moodle')
        .then(function(r) { return r.ok ? r.text() : ''; })
        .then(function(html) {
          var m = String(html || '').match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
          return m ? m[1].trim() : '';
        })
        .catch(function() { return ''; });
    }

    function resolveStudentEmail(ctx) {
      if (ctx.email) return Promise.resolve(ctx.email);
      return fetchEmailFromProfile(ctx.moodle_user_id);
    }

    function openWorkspace(sessionId) {
      var targetUrl = appUrl + '/buddy?projectKey=' + encodeURIComponent(projectKey)
        + (sessionId ? '&sessionId=' + encodeURIComponent(sessionId) + '&mode=external' : '&view=ai');
      window.open(targetUrl, 'alb_ai_workspace');
    }

    // Siapkan sesi chat + konteks halaman Moodle. Dipakai bersama oleh kedua pilihan
    // (tab baru & chat di sini), jadi ekstraksi konteksnya hanya ditulis sekali.
    function prepareSession() {
      var ctx = extractMoodleContext();
      ctx.page_activities = extractCoursePageActivities();

      return resolveStudentEmail(ctx)
        .then(function(email) {
          if (email) ctx.email = email;
          return fetchWithTimeout(apiBase + '/api/chat/session', {
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
          }, ALB_REQUEST_TIMEOUT_MS, 'Menyiapkan AI Buddy');
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          return (res && res.status === 'success' && res.data && res.data.session) ? res.data.session.id : null;
        })
        .catch(function(err) {
          console.error('[AI Buddy] Gagal menyiapkan sesi:', err);
          return null;
        });
    }

    function setBtnLoading(on) {
      if (on) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>' + (iconOnly ? '' : '<span class="alb-ext-label">Membuka…</span>');
        btn.disabled = true;
      } else {
        btn.innerHTML = IDLE_HTML;
        btn.disabled = false;
      }
    }

    // [v0.9.91] Klik tombol tidak lagi langsung membuka tab. Siswa memilih dulu:
    // buka penuh di tab baru (AI + materi) atau chat ringkas di halaman ini (panduan saja).
    choiceMenu.addEventListener('click', function(e) {
      var target = e.target.closest ? e.target.closest('.alb-ext-choice-btn') : null;
      if (!target) return;
      e.stopPropagation();
      var pick = target.getAttribute('data-choice');
      toggleChoiceMenu(false);
      wake();

      setBtnLoading(true);
      prepareSession().then(function(sessionId) {
        setBtnLoading(false);
        if (pick === 'inline') openInlinePanel(sessionId);
        else openWorkspace(sessionId);
      });
    });

    btn.onclick = function(event) {
      // Klik pada pegangan = buka menu pojok, bukan membuka AI Buddy.
      if (event && event.target.closest && event.target.closest('.alb-ext-grip')) {
        event.stopPropagation();
        wake();
        toggleCornerMenu(menu.classList.contains('alb-ext-hidden'));
        return;
      }

      // Klik pertama saat tombol sedang redup hanya "membangunkan" tombol, supaya
      // klik tak sengaja di halaman LMS tidak langsung membuka apa pun.
      if (isIdle()) { wake(); return; }
      wake();

      toggleCornerMenu(false);
      toggleChoiceMenu(choiceMenu.classList.contains('alb-ext-hidden'));
    };

    // ============================================================
    // [v0.9.91] CHAT INLINE — versi ringkas yang hidup di halaman LMS.
    // Batasannya DISENGAJA: hanya panduan pakai VClass, hanya jawaban SISTEM, tanpa AI.
    // Pertanyaan materi/AI tidak dikirim ke server sama sekali; siswa langsung diarahkan
    // membuka tab baru. Ini menjaga kuota AI bersama sekaligus bikin perilakunya jelas.
    // ============================================================
    var inlinePanel = null;
    var inlineSessionId = null;
    var inlineBusy = false;

    // Pertanyaan yang MEMANG bisa dijawab di sini: "cara/langkah/panduan" seputar VClass.
    function isTutorialQuestion(text) {
      var t = String(text || '').toLowerCase();
      // Catatan: file ini adalah TEMPLATE LITERAL Node — semua escape regex wajib ditulis
      // ganda (\\b), kalau tunggal ia jadi karakter backspace dan polanya tak pernah cocok.
      var howTo = /\\b(cara|caranya|gimana|gmn|bagaimana|langkah|tutorial|panduan|petunjuk|tata cara)\\b/.test(t);
      var topic = /\\b(login|masuk|logout|keluar|nilai|rapor|tugas|kumpul|upload|unggah|forum|diskusi|balas|reply|kuis|quiz|ujian|aktivitas|activity|vclass|moodle)\\b/.test(t);
      return howTo && topic;
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // Markdown seadanya: **tebal** + baris baru. Cukup untuk balasan panduan.
    function inlineFormat(text) {
      return escapeHtml(text).replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>').replace(/\\n/g, '<br/>');
    }

    function inlineAppend(role, html) {
      var body = inlinePanel.querySelector('.alb-inline-body');
      var row = document.createElement('div');
      row.className = 'alb-inline-msg alb-inline-' + role;
      row.innerHTML = html;
      body.appendChild(row);
      body.scrollTop = body.scrollHeight;
      return row;
    }

    // Ajakan pindah ke tab baru — dipakai untuk semua pertanyaan di luar cakupan inline.
    function inlineOfferNewTab(reason) {
      var row = inlineAppend('bot',
        '<div>' + escapeHtml(reason) + '</div>'
        + '<button type="button" class="alb-inline-open-tab"><i class="fa-solid fa-arrow-up-right-from-square"></i> Buka di tab baru</button>');
      row.querySelector('.alb-inline-open-tab').addEventListener('click', function() {
        openWorkspace(inlineSessionId);
      });
    }

    function inlineSend(text) {
      if (inlineBusy || !text) return;

      inlineAppend('user', escapeHtml(text));
      inlinePanel.querySelector('.alb-inline-input').value = '';

      // Di luar cakupan panduan → jangan repotkan server, langsung arahkan ke tab baru.
      if (!isTutorialQuestion(text)) {
        inlineOfferNewTab('Pertanyaan ini butuh materi kelas atau bantuan AI, dan itu hanya tersedia di halaman penuh AI Buddy.');
        return;
      }

      inlineBusy = true;
      var typing = inlineAppend('bot', '<span class="alb-inline-typing">Mencari panduan…</span>');

      fetchWithTimeout(apiBase + '/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: inlineSessionId,
          message: text,
          projectKey: projectKey,
          pageContext: { title: document.title },
          // Kunci ke jalur sistem/panduan. forceAI:false + responseMode 'system' membuat
          // backend TIDAK pernah memanggil Gemini dari sini.
          responseMode: 'system',
          forceAI: false,
          forceFAQ: false,
          expectedSourceType: 'template'
        })
      }, ALB_REQUEST_TIMEOUT_MS, 'Mencari panduan')
        .then(function(r) { return r.json(); })
        .then(function(res) {
          typing.remove();
          inlineBusy = false;

          var data = res && res.data ? res.data : null;
          var bot = data && data.botMessage ? data.botMessage : null;

          // Sistem tak punya jawaban pasti (mis. menawarkan dialihkan ke AI) → arahkan keluar.
          if (!bot || !bot.message || (data && data.needs_ai_confirm)) {
            inlineOfferNewTab('Aku belum punya panduan siap pakai untuk ini. Buka di tab baru supaya bisa dibantu lebih lengkap ya.');
            return;
          }

          var tutorialAction = (bot.actions || []).filter(function(a) { return a.type === 'static_tutorial_carousel'; })[0];
          var row = inlineAppend('bot', '<div>' + inlineFormat(bot.message) + '</div>');

          if (tutorialAction && tutorialAction.payload) {
            var openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'alb-inline-tut-btn';
            openBtn.innerHTML = '<i class="fa-solid fa-book-open-reader"></i> ' + escapeHtml(tutorialAction.label || 'Lihat Panduan');
            openBtn.addEventListener('click', function() { openInlineTutorial(tutorialAction.payload); });
            row.appendChild(openBtn);
          } else {
            // Ada teks tapi tanpa panduan bergambar → tetap tawarkan versi lengkapnya.
            inlineOfferNewTab('Butuh penjelasan lebih dalam? Buka di tab baru ya.');
          }
        })
        .catch(function(err) {
          typing.remove();
          inlineBusy = false;
          console.error('[AI Buddy Inline] gagal:', err);
          inlineOfferNewTab('Koneksi ke server sedang bermasalah.');
        });
    }

    function buildInlinePanel() {
      var panel = document.createElement('div');
      panel.id = 'alb-inline-panel';
      panel.className = 'alb-inline-panel';
      panel.innerHTML = [
        '<div class="alb-inline-head">',
        '  <div class="alb-inline-head-txt"><b>' + escapeHtml(launcherText) + '</b><small>Mode ringkas · panduan VClass</small></div>',
        '  <button type="button" class="alb-inline-close" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>',
        '</div>',
        '<div class="alb-inline-note">',
        '  <i class="fa-solid fa-circle-info"></i>',
        '  <span>Di sini aku hanya menjawab <b>cara pakai VClass</b>. Untuk tanya materi atau minta bantuan AI, buka di tab baru ya.</span>',
        '</div>',
        '<div class="alb-inline-body"></div>',
        '<form class="alb-inline-form">',
        '  <input type="text" class="alb-inline-input" placeholder="Contoh: cara mengumpulkan tugas" autocomplete="off" />',
        '  <button type="submit" class="alb-inline-send" aria-label="Kirim"><i class="fa-solid fa-paper-plane"></i></button>',
        '</form>'
      ].join('');

      panel.querySelector('.alb-inline-close').addEventListener('click', function() {
        panel.classList.add('alb-ext-hidden');
      });
      panel.querySelector('.alb-inline-form').addEventListener('submit', function(e) {
        e.preventDefault();
        inlineSend(panel.querySelector('.alb-inline-input').value.trim());
      });

      document.body.appendChild(panel);
      return panel;
    }

    function openInlinePanel(sessionId) {
      inlineSessionId = sessionId;
      if (!inlinePanel) {
        inlinePanel = buildInlinePanel();
        inlineAppend('bot', 'Halo! Tanya aku soal <b>cara memakai VClass</b> ya — misalnya cara mengumpulkan tugas, melihat nilai, atau membalas forum.');
      }
      inlinePanel.classList.remove('alb-ext-hidden');
      inlinePanel.querySelector('.alb-inline-input').focus();
    }

    // ---- Modal panduan bergambar untuk mode inline -------------------------------
    // Gambar panduan disajikan oleh aplikasi FE, sedangkan script ini berjalan di origin
    // LMS — path relatif ('/DETAIL/...') harus diberi awalan appUrl atau pasti 404.
    function absoluteAssetUrl(url) {
      var raw = String(url || '');
      if (!raw) return '';
      return /^https?:\\/\\//i.test(raw) ? raw : appUrl + (raw.charAt(0) === '/' ? '' : '/') + raw;
    }

    var tutorialModal = null;
    var tutorialSteps = [];
    var tutorialIndex = 0;

    function renderTutorialStep() {
      var step = tutorialSteps[tutorialIndex] || {};
      tutorialModal.querySelector('.alb-tut-img').src = absoluteAssetUrl(step.image);
      tutorialModal.querySelector('.alb-tut-step-title').textContent = step.title || ('Langkah ' + (tutorialIndex + 1));
      tutorialModal.querySelector('.alb-tut-step-text').textContent = step.text || '';
      tutorialModal.querySelector('.alb-tut-counter').textContent = 'Langkah ' + (tutorialIndex + 1) + '/' + tutorialSteps.length;
      tutorialModal.querySelector('.alb-tut-prev').disabled = tutorialIndex <= 0;
      tutorialModal.querySelector('.alb-tut-next').textContent = tutorialIndex >= tutorialSteps.length - 1 ? 'Selesai' : 'Lanjut';
    }

    function openInlineTutorial(payload) {
      tutorialSteps = (payload && payload.steps) || [];
      if (!tutorialSteps.length) return;
      tutorialIndex = 0;

      if (!tutorialModal) {
        tutorialModal = document.createElement('div');
        tutorialModal.id = 'alb-inline-tutorial';
        tutorialModal.className = 'alb-tut-overlay';
        tutorialModal.innerHTML = [
          '<div class="alb-tut-card">',
          '  <div class="alb-tut-head">',
          '    <div class="alb-tut-title"></div>',
          '    <button type="button" class="alb-tut-close" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>',
          '  </div>',
          '  <div class="alb-tut-imgwrap"><img class="alb-tut-img" alt="Gambar panduan" /></div>',
          '  <div class="alb-tut-txt">',
          '    <span class="alb-tut-counter"></span>',
          '    <h4 class="alb-tut-step-title"></h4>',
          '    <p class="alb-tut-step-text"></p>',
          '  </div>',
          '  <div class="alb-tut-foot">',
          '    <button type="button" class="alb-tut-prev">Sebelumnya</button>',
          '    <button type="button" class="alb-tut-next">Lanjut</button>',
          '  </div>',
          '</div>'
        ].join('');

        tutorialModal.querySelector('.alb-tut-close').addEventListener('click', function() {
          tutorialModal.classList.add('alb-ext-hidden');
        });
        tutorialModal.querySelector('.alb-tut-prev').addEventListener('click', function() {
          if (tutorialIndex > 0) { tutorialIndex--; renderTutorialStep(); }
        });
        tutorialModal.querySelector('.alb-tut-next').addEventListener('click', function() {
          if (tutorialIndex >= tutorialSteps.length - 1) { tutorialModal.classList.add('alb-ext-hidden'); return; }
          tutorialIndex++;
          renderTutorialStep();
        });
        document.body.appendChild(tutorialModal);
      }

      tutorialModal.querySelector('.alb-tut-title').textContent = (payload && payload.title) || 'Panduan VClass';
      tutorialModal.classList.remove('alb-ext-hidden');
      renderTutorialStep();
    }

    document.body.appendChild(wrap);

    // Hitung mundur peredupan mulai saat DOM halaman LMS siap.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armIdle);
    else armIdle();
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
