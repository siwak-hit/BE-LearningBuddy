const cheerio = require('cheerio');

// ==========================================
// MAPPING MATCH CONFIG & DEFAULT INTERACTIVE DATA
// ==========================================
const MATCH_CONFIGS = {
  'landing': {
    match_url: null, match_title: 'vclass', match_heading: 'selamat datang',
    suggestions: [
      { trigger_word: "tanya", suggestion_text: "Tanya cara daftar akun di VClass", intent: "cara_daftar", priority: 1 },
      { trigger_word: "materi", suggestion_text: "Bagaimana cara mengakses materi di VClass?", intent: "akses_materi", priority: 2 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung cara menggunakan VClass", intent: "panduan_umum", priority: 3 },
      { trigger_word: "login", suggestion_text: "Cara login ke VClass", intent: "cara_login", priority: 4 }
    ],
    tutorials: [
      { step: 1, element_key: "landing_el_1", title: "Mulai dari Hero", description: "Ini adalah halaman utama VClass. Klik tombol Login untuk masuk ke akunmu." },
      { step: 2, element_key: "landing_el_4", title: "Area Login", description: "Klik di sini untuk langsung menuju halaman login dan mengakses materi." }
    ]
  },
  'login': {
    match_url: 'login', match_title: 'log in', match_heading: 'log in',
    suggestions: [
      { trigger_word: "login", suggestion_text: "Bagaimana cara login ke VClass?", intent: "cara_login", priority: 1 },
      { trigger_word: "login", suggestion_text: "Saya lupa username atau password, gimana?", intent: "lupa_password", priority: 2 },
      { trigger_word: "tanya", suggestion_text: "Tanya cara login ke VClass", intent: "cara_login", priority: 3 },
      { trigger_word: "tamu", suggestion_text: "Bisa akses VClass tanpa akun?", intent: "guest_access", priority: 4 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung cara masuk ke VClass", intent: "cara_login", priority: 5 }
    ],
    tutorials: [
      { step: 1, element_key: "login_el_1", title: "Isi Form Login", description: "Masukkan username dan password akunmu di sini. Username biasanya berupa NIS atau email sekolah." },
      { step: 2, element_key: "login_el_2", title: "Login sebagai Tamu", description: "Jika belum punya akun, kamu bisa mencoba masuk sebagai tamu untuk melihat beberapa kursus." },
      { step: 3, element_key: "login_el_3", title: "Aktifkan Cookies", description: "Pastikan browser kamu mengizinkan cookies, karena VClass membutuhkannya untuk sesi login." }
    ]
  },
  'dashboard': {
    match_url: 'my', match_title: 'kursusku', match_heading: 'kursusku',
    suggestions: [
      { trigger_word: "kursus", suggestion_text: "Bagaimana cara masuk ke kursus?", intent: "akses_kursus", priority: 1 },
      { trigger_word: "tanya", suggestion_text: "Tanya cara melihat daftar kursus saya", intent: "lihat_kursus", priority: 2 },
      { trigger_word: "materi", suggestion_text: "Bagaimana cara mengakses materi pelajaran?", intent: "akses_materi", priority: 3 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung cara menggunakan dashboard", intent: "panduan_dashboard", priority: 4 },
      { trigger_word: "tugas", suggestion_text: "Dimana saya bisa lihat tugas yang harus dikumpul?", intent: "lihat_tugas", priority: 5 }
    ],
    tutorials: [
      { step: 1, element_key: "dashboard_el_1", title: "Kartu Kursus", description: "Ini adalah daftar kursus yang kamu ikuti. Klik Enter this course untuk masuk ke materi." }
    ]
  },
  'course': {
    match_url: 'course/view', match_title: null, match_heading: null,
    suggestions: [
      { trigger_word: "materi", suggestion_text: "Materi apa saja yang ada di kursus ini?", intent: "daftar_materi", priority: 1 },
      { trigger_word: "tanya", suggestion_text: "Tanya tentang isi kursus ini", intent: "info_kursus", priority: 2 },
      { trigger_word: "tugas", suggestion_text: "Bagaimana cara mengumpulkan tugas?", intent: "cara_submit_tugas", priority: 3 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung cara mengakses materi di kursus ini", intent: "akses_materi", priority: 4 }
    ],
    tutorials: [
      { step: 1, element_key: "course_el_1", title: "Kisi-kisi Materi", description: "Klik di sini untuk melihat kisi-kisi atau panduan materi yang akan dipelajari." },
      { step: 2, element_key: "course_el_2", title: "File Materi PDF", description: "Unduh file BSE (Buku Sekolah Elektronik) sebagai referensi belajarmu." }
    ]
  },
  'materi': {
    match_url: 'mod/page', match_title: null, match_heading: null,
    suggestions: [
      { trigger_word: "materi", suggestion_text: "Jelaskan poin utama materi ini", intent: "penjelasan_materi", priority: 1 },
      { trigger_word: "tanya", suggestion_text: "Tanya tentang isi materi ini", intent: "penjelasan_materi", priority: 2 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung, tolong jelaskan materi ini", intent: "penjelasan_materi", priority: 3 },
      { trigger_word: "contoh", suggestion_text: "Berikan contoh dari materi ini", intent: "contoh_materi", priority: 4 },
      { trigger_word: "ulangan", suggestion_text: "Apa yang sering keluar di ulangan dari materi ini?", intent: "persiapan_ulangan", priority: 5 }
    ],
    tutorials: [
      { step: 1, element_key: "materi_el_1", title: "Baca Konten Materi", description: "Baca dan pahami isi materi ini. Kamu bisa tanya ke asisten jika ada yang tidak dimengerti." }
    ]
  },
  'quiz': {
    match_url: 'mod/quiz', match_title: null, match_heading: null,
    suggestions: [
      { trigger_word: "soal", suggestion_text: "Bagaimana cara menjawab soal kuis ini?", intent: "cara_kuis", priority: 1 },
      { trigger_word: "tanya", suggestion_text: "Tanya tentang cara mengerjakan kuis", intent: "cara_kuis", priority: 2 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung dengan soal nomor ini", intent: "bantuan_soal", priority: 3 },
      { trigger_word: "materi", suggestion_text: "Materi apa yang diuji di kuis ini?", intent: "info_materi_kuis", priority: 4 },
      { trigger_word: "waktu", suggestion_text: "Berapa lama waktu untuk mengerjakan kuis ini?", intent: "info_waktu_kuis", priority: 5 }
    ],
    tutorials: [
      { step: 1, element_key: "quiz_el_1", title: "Baca Soal", description: "Baca soal dengan teliti sebelum menjawab. Pilih satu jawaban yang paling tepat." }
    ]
  },
  'summary': {
    match_url: 'mod/page', match_title: 'rangkuman', match_heading: 'rangkuman',
    suggestions: [
      { trigger_word: "materi", suggestion_text: "Apa poin penting dari materi ini?", intent: "ringkasan_materi", priority: 1 },
      { trigger_word: "materi", suggestion_text: "Jelaskan konsep utama di rangkuman ini", intent: "penjelasan_konsep", priority: 2 },
      { trigger_word: "tanya", suggestion_text: "Tanya tentang isi rangkuman materi", intent: "ringkasan_materi", priority: 3 },
      { trigger_word: "ulangan", suggestion_text: "Apa yang perlu dipelajari untuk ulangan?", intent: "persiapan_ulangan", priority: 4 },
      { trigger_word: "bingung", suggestion_text: "Saya bingung dengan materi ini, tolong jelaskan", intent: "penjelasan_konsep", priority: 5 }
    ],
    tutorials: [
      { step: 1, element_key: "summary_el_1", title: "Baca Rangkuman", description: "Baca poin-poin penting di sini sebelum mengerjakan kuis atau ulangan." },
      { step: 2, element_key: "summary_el_2", title: "Cek Info Ulangan", description: "Perhatikan informasi ulangan harian seperti jumlah soal dan waktu pengerjaan." }
    ]
  }
};

const templateParserService = {
  parseHtmlContent(rawHtml, config) {
    const $ = cheerio.load(rawHtml, { decodeEntities: false });

    // 0. Ambil Style
    const stylesheetTags = [];
    $('head link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href) stylesheetTags.push(`<link rel="stylesheet" type="text/css" href="${href}">`);
    });
    $('head style').each((_, el) => {
      const css = $(el).html() || '';
      if (css.trim()) stylesheetTags.push(`<style>${css}</style>`);
    });
    const stylesheetInjectHtml = stylesheetTags.join('\n');

    // 1. KEMBALIKAN LOGIKA PICKROOT ASLI DARI SEEDER
    const $root = pickRoot($);

    // 2. Aksesibilitas
    const accessibility_json = extractAccessibility($, $root);

    // 3. KEMBALIKAN LOGIKA REMOVENOISE ASLI (Dengan fitur anti-rusak)
    removeNoise($, $root);

    const rawPreview = $root.html() || '';
    const html_preview = stylesheetTags.length > 0
      ? `\n${stylesheetInjectHtml}\n\n${rawPreview}`
      : rawPreview;

    const elements_json = [];
    const usedSelectors = new Set();
    const usedSignatures = new Set();
    const usedTextSignatures = new Set();
    let elementCounter = 1;

    // 4. Target Komponen
    // Termasuk wrapper login, materi, dan blok konten umum agar tidak terlewat
    const targetSelectors = [
      // Form & input wrappers
      'form', '.login-form-wrap', '.loginleft', '.loginform',
      // Modal & card
      '.modal', '[class*="modal"]', '.card', '[class*="card"]', '.box', '.generalbox',
      // Course activities
      '.coursebox', '.activity', '.activity-item', '.activityinstance',
      '.modtype_page', '.modtype_quiz', '.modtype_resource',
      // Quiz
      '.quizattempt', '.que', '.question', '[class*="quiz"]', '[class*="question"]',
      // Search & filter
      '.searchform', '[class*="search"]', '[class*="filter"]',
      // Content blocks (materi, summary, info)
      '.summary', '.description', '.activity-description', '.no-overflow',
      '.course-description', '.course-info', '.content-block',
      // Generic semantic
      'section', 'article',
      // Guest login & notification blocks
      '.guest-login-form', '.guestlogin-form', '.cookies-notice',
      // Hero & landing sections
      '[class*="hero"]', '[class*="feature"]', '[class*="section"]',
      // Info & alert blocks
      '[class*="alert"]', '[class*="info"]', '[class*="notice"]'
    ].join(', ');

    $root.find(targetSelectors).each((index, el) => {
      const $candidate = $(el);
      if (!isValidCandidate($, $candidate)) return;

      const $component = pickBestComponentParent($, $candidate, $root);
      if (!$component || !$component.length) return;
      if (!isValidComponent($, $component)) return;

      const selector = buildSelector($, $component);
      if (!selector) return;

      const signature = buildSignature($, $component);
      if (usedSelectors.has(selector) || usedSignatures.has(signature)) return;

      // Cek Ancestor
      let isNestedDuplicate = false;
      let $ancestor = $component.parent();
      for (let depth = 0; depth < 6; depth++) {
        if (!$ancestor.length || $ancestor.is('body, html')) break;
        const ancestorSel = buildSelector($, $ancestor);
        if (ancestorSel && usedSelectors.has(ancestorSel)) {
          isNestedDuplicate = true; break;
        }
        $ancestor = $ancestor.parent();
      }
      if (isNestedDuplicate) return;

      // Cek Teks Sama
      const rawText = cleanText($component.text());
      const normalizedText = rawText.substring(0, 200).toLowerCase().replace(/\s+/g, ' ').trim();
      let isTextDuplicate = false;
      for (const existingText of usedTextSignatures) {
        const shorter = normalizedText.length < existingText.length ? normalizedText : existingText;
        const longer  = normalizedText.length < existingText.length ? existingText : normalizedText;
        if (shorter.length > 40 && longer.includes(shorter)) {
          isTextDuplicate = true; break;
        }
      }
      if (isTextDuplicate) return;
      if (rawText.length < 8) return;

      const type = detectComponentType($, $component);
      const title = buildTitle($, $component, type, elementCounter);

      elements_json.push({
        key: `${config.type}_el_${elementCounter}`,
        name: `@${slugify(type)}${elementCounter}`,
        title, type, text: rawText.substring(0, 700), selector, html: $.html($component)
      });

      usedSelectors.add(selector);
      usedSignatures.add(signature);
      if (normalizedText.length > 40) usedTextSignatures.add(normalizedText);
      elementCounter++;
    });

    const matchConfig = MATCH_CONFIGS[config.type] || { match_url: null, match_title: null, match_heading: null, suggestions: [], tutorials: [] };

    return {
      project_id: config.project_id,
      page_type: config.type,
      template_name: config.name,
      match_url_contains: matchConfig.match_url,
      match_title_contains: matchConfig.match_title,
      match_heading_contains: matchConfig.match_heading,
      html_preview,
      elements_json,
      accessibility_json,
      tutorial_steps_json: matchConfig.tutorials,
      question_suggestions_json: matchConfig.suggestions,
      is_active: true
    };
  }
};

// ==========================================
// FUNGSI INTI PERSIS SEPERTI SEEDER MANUAL
// ==========================================
function pickRoot($) {
  const candidates = [
    'main', '[role="main"]', '#region-main', '.region-main',
    '#page-content', '.page-content', '#page', 'body'
  ];

  for (const selector of candidates) {
    const $candidate = $(selector).first();
    if (!$candidate.length) continue;

    const text = cleanText($candidate.text());
    const html = $candidate.html() || '';

    const hasUsefulContent =
      text.length > 50 ||
      $candidate.find('form, .card, [class*="card"], .activity, .que, .question, article, section, .no-overflow').length > 0;

    if (html.length > 100 && hasUsefulContent) {
      return $candidate;
    }
  }
  return $('body').first().length ? $('body').first() : $.root();
}

function removeNoise($, $root) {
  // Hapus tag pasti noise — TIDAK termasuk <style> di body (bisa inline CSS komponen)
  // TIDAK hapus <img> karena bisa bagian dari konten logo / materi
  $root.find([
    'head', 'script', 'noscript', 'iframe',
    // SVG dan ikon dekoratif saja yang dihapus (bukan konten utama)
    'svg', 'i',
    // Navigasi & layout shell — bukan konten form/materi
    'nav', 'header', 'footer', 'aside',
    // YUI noise
    '[id="yui3-css-stamp"]',
    // Aksesibilitas & skip links
    '.visually-hidden-focusable', '.sr-only', '.sr-only-focusable',
    '#acsb-menu', '#acsb-menu_launcher', '.acsb-block', '.acsb-trigger',
    '[id*="acsb"]', '[class*="acsb"]',
    '[class*="skip-link"]', '[id*="skip-link"]'
  ].join(', ')).remove();

  // Hapus <style> hanya yang bukan scoped dan bukan di dalam elemen konten bermakna
  // (biarkan inline <style> yang ada di dalam komponen konten)
  $root.find('style').each((_, el) => {
    const $el = $(el);
    // Jika style ini ada di dalam form, card, section bermakna → biarkan
    const insideMeaningful = $el.closest('form, .card, .loginform, .no-overflow, section, article').length > 0;
    if (!insideMeaningful) $el.remove();
  });

  // Hapus tag kosong secara aman (ditampung dulu di array agar tree cheerio tidak rusak)
  const toRemove = [];
  $root.find('*').each((_, el) => {
    const $el = $(el);
    const text = cleanText($el.text());
    const hasImportantChild = $el.find('form, input, select, textarea, button, a, h1, h2, h3, h4, p, li, table, img').length > 0;

    if (!text && !hasImportantChild) {
      toRemove.push($el);
    }
  });
  toRemove.forEach($el => $el.remove());
}

function pickBestComponentParent($, $candidate, $root) {
  let $current = $candidate; let $best = $candidate;
  const STRONG_KEYS = [
    'card', 'modal', 'form', 'filter', 'search',
    'quiz', 'question', 'que',
    'activity', 'activity-item', 'coursebox',
    'summary', 'description', 'materi',
    // Login-specific wrappers — penting agar form login & guest tidak di-merge
    'login', 'loginleft', 'loginform', 'login-form', 'login-form-wrap',
    'guest', 'guestlogin',
    // Content blocks
    'box', 'generalbox', 'no-overflow', 'content-block',
    // Cookie & notice blocks
    'cookies', 'notice', 'alert'
  ];
  const STOP_KEYS = ['container', 'container-fluid', 'wrapper', 'page', 'main', 'region-main', 'content-wrapper', 'course-content', 'columns', 'row', 'section', 'sectionname', 'section-summary', 'sectionbody'];

  for (let i = 0; i < 3; i++) {
    const $parent = $current.parent();
    if (!$parent.length || $parent.is('body, main, #maincontent, [role="main"]') || ($root.length && $parent[0] === $root[0]) || isAccessibilityElement($parent)) break;

    // FITUR ANTI-SWALLOW: Jangan naik (group) jika parent-nya sudah punya lebih dari 1 form!
    // Ini memastikan Form Login dan Form Guest tetap terpisah.
    const parentForms = $parent.find('form').length;
    const currentForms = $current.find('form').length;
    if (parentForms > currentForms && parentForms > 1) break;

    const currentText = cleanText($current.text()); const parentText = cleanText($parent.text());
    const currentInt = countInteractive($current); const parentInt = countInteractive($parent);
    const parentStrong = hasAnyClassOrId($parent, STRONG_KEYS); const parentOuter = hasAnyClassOrId($parent, STOP_KEYS);

    if (parentOuter || (parentText.length > 1400 && !parentStrong) || (parentText.length > currentText.length * 2.2 && parentText.length > 400 && !parentStrong) || (parentInt > currentInt + 5 && !parentStrong)) break;
    if (parentStrong) { $best = $parent; $current = $parent; continue; }
    if (currentText.length < 80 && currentInt <= 1 && parentText.length <= 800) { $best = $parent; $current = $parent; continue; }
    break;
  }
  return $best;
}

// ==========================================
// HELPER LAINNYA
// ==========================================
function extractAccessibility($, $root) {
  const acc = [];
  const $skipLinks = $root.find('.visually-hidden-focusable, .sr-only, .sr-only-focusable');
  if ($skipLinks.length) acc.push({ key: 'accessibility_skip_links', type: 'Accessibility', title: 'Skip Links', text: cleanText($skipLinks.text()), html: $.html($skipLinks.parent().first()) });
  const $launcher = $root.find('#acsb-menu_launcher, .acsb-trigger').first();
  if ($launcher.length) acc.push({ key: 'accessibility_launcher', type: 'Accessibility', title: 'Accessibility Launcher', text: cleanText($launcher.text() || $launcher.attr('aria-label') || 'Accessibility options'), html: $.html($launcher) });
  const $menu = $root.find('#acsb-menu, .acsb-block').first();
  if ($menu.length) acc.push({ key: 'accessibility_menu', type: 'Accessibility', title: 'Accessibility Menu', text: cleanText($menu.text()).substring(0, 700), html: $.html($menu) });
  return acc;
}

function isValidCandidate($, $el) {
  if (!$el || !$el.length) return false;
  const tag = getTagName($el); const text = cleanText($el.text());
  if (!tag || ['html', 'head', 'body', 'script', 'style', 'noscript', 'iframe', 'svg', 'i', 'img'].includes(tag)) return false;
  if (isAccessibilityElement($el)) return false;
  // Cek konten fungsional — termasuk div wrapper login & blok konten sederhana
  const hasFunctionalChild = $el.find('form, input, select, textarea, button, a, h1, h2, h3, h4, p, li, table, label').length > 0;
  // Wrapper login (loginleft, login-form-wrap, dll) mungkin tidak punya heading
  // tapi tetap valid jika punya form/input di dalamnya
  const isLoginWrapper = hasAnyClassOrId($el, ['login', 'loginleft', 'loginform', 'login-form']);
  if (!hasFunctionalChild && text.length < 20 && !isLoginWrapper) return false;
  return true;
}

function isValidComponent($, $el) {
  if (!$el || !$el.length) return false;
  const tag = getTagName($el); const text = cleanText($el.text()); const html = $.html($el) || '';
  if (!tag || isAccessibilityElement($el)) return false;
  const interactiveCount = countInteractive($el);
  const headingCount = $el.find('h1, h2, h3, h4').length;
  const paragraphCount = $el.find('p, li').length;
  const hasMeaning = text.length >= 8 || interactiveCount > 0 || headingCount > 0 || paragraphCount > 0;
  if (!hasMeaning) return false;
  if (text.length > 2200 && !looksLikeMaterialBlock($el)) return false;
  if (text.length > 3500) return false;
  if (interactiveCount > 14 && !looksLikeFormOrQuiz($el)) return false;
  if (html.length < 40) return false;
  return true;
}

function detectComponentType($, $el) {
  const tag = getTagName($el); const cls = getClass($el); const id = getId($el); const text = cleanText($el.text()).toLowerCase();
  if (tag === 'form' || $el.find('form').length) return 'Formulir';
  if (cls.includes('modal') || id.includes('modal')) return 'Modal';
  if (cls.includes('search') || id.includes('search') || text.includes('cari')) return 'Area Pencarian';
  if (cls.includes('filter') || id.includes('filter') || text.includes('filter')) return 'Area Filter';
  if (cls.includes('card')) return 'Card';
  if (cls.includes('quiz') || id.includes('quiz') || cls.includes('question') || cls.includes('que') || text.includes('kuis') || text.includes('soal')) return 'Blok Kuis';
  if (cls.includes('activity') || cls.includes('coursebox') || cls.includes('modtype_')) return 'Aktivitas Course';
  if (cls.includes('summary') || cls.includes('description') || cls.includes('no-overflow')) return 'Blok Konten';
  if (cls.includes('materi') || id.includes('materi') || text.includes('materi')) return 'Materi';
  if ($el.find('input, select, textarea').length >= 2) return 'Grup Input';
  if ($el.find('button, a.btn, a[class*="btn"]').length >= 1) return 'Area Aksi';
  if (tag === 'section') return 'Section';
  if (tag === 'article') return 'Artikel';
  return 'Blok Konten';
}

function buildTitle($, $el, type, counter) {
  const heading = cleanText($el.find('h1, h2, h3, h4, legend, .title, [class*="title"], .heading, [class*="heading"]').first().text());
  if (heading) return `${type}: ${heading.substring(0, 70)}`;
  const label = cleanText($el.find('label').first().text());
  if (label) return `${type}: ${label.substring(0, 70)}`;
  const buttonText = cleanText($el.find('button, a.btn, a[class*="btn"]').first().text());
  if (buttonText) return `${type}: ${buttonText.substring(0, 70)}`;
  const text = cleanText($el.text());
  if (text) return `${type}: ${text.substring(0, 70)}`;
  return `${type} ${counter}`;
}

function buildSelector($, $el) {
  const tag = getTagName($el); if (!tag) return null;
  const id = $el.attr('id'); if (id) return `${tag}#${cssEscape(id)}`;
  const name = $el.attr('name'); if (name) return `${tag}[name="${name}"]`;
  const classes = ($el.attr('class') || '').split(/\s+/).filter(Boolean).filter(c => !c.includes(':')).filter(c => !c.startsWith('yui_')).filter(c => !c.startsWith('css_')).slice(0, 3).map(cssEscape);
  if (classes.length) return `${tag}.${classes.join('.')}`;
  const parent = $el.parent();
  if (parent && parent.length) { const index = parent.children(tag).index($el) + 1; return `${tag}:nth-of-type(${index})`; }
  return tag;
}

function buildSignature($, $el) {
  const tag = getTagName($el); const id = getId($el); const cls = getClass($el);
  const text = cleanText($el.text()).substring(0, 300);
  const htmlLen = ($.html($el) || '').length;
  return `${tag}|${id}|${cls}|${text}|${htmlLen}`;
}

function countInteractive($el) { return $el.find('input, select, textarea, button, a').length; }
function looksLikeFormOrQuiz($el) { const tag = getTagName($el); const cls = getClass($el); const id = getId($el); return tag === 'form' || cls.includes('form') || id.includes('form') || cls.includes('quiz') || id.includes('quiz') || cls.includes('question') || cls.includes('que'); }
function looksLikeMaterialBlock($el) { const cls = getClass($el); const id = getId($el); return cls.includes('materi') || id.includes('materi') || cls.includes('summary') || cls.includes('description') || cls.includes('no-overflow') || cls.includes('content'); }
function isAccessibilityElement($el) { return $el.is('.visually-hidden-focusable, .sr-only, .sr-only-focusable') || hasAnyClassOrId($el, ['acsb', 'skip', 'accessibility']); }
function hasAnyClassOrId($el, keywords) { const cls = getClass($el); const id = getId($el); return keywords.some(keyword => { const key = String(keyword).toLowerCase(); return cls.includes(key) || id.includes(key); }); }

function getTagName($el) { return (($el && $el[0] && ($el[0].tagName || $el[0].name)) || '').toLowerCase(); }
function getClass($el) { return String($el.attr('class') || '').toLowerCase(); }
function getId($el) { return String($el.attr('id') || '').toLowerCase(); }
function cleanText(text = '') { return String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slugify(text = '') { return String(text).toLowerCase().replace(/[^a-z0-9]+/gi, '').substring(0, 40); }
function cssEscape(value = '') { return String(value).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1'); }

module.exports = templateParserService;
