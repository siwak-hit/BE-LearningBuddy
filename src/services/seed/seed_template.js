const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// KONFIGURASI SUPABASE & PROJECT
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const PROJECT_ID = 'c4ec8eba-e342-4c31-b5de-2d4218dcfd86';

const HTML_FOLDER = path.join(__dirname, 'html-samples');

// ==========================================
// MAPPING FILE HTML
// ==========================================
// match_url_contains   : substring yang dicek di URL halaman user (case-insensitive)
// match_title_contains  : substring yang dicek di <title> halaman user
// match_heading_contains: substring yang dicek di <h1> pertama halaman user
//
// Kolom ini digunakan oleh route /api/page-templates/match di backend.
// Semakin spesifik nilainya, semakin kecil kemungkinan salah deteksi
// ketika widget dipasang di web lain (bukan VClass) yang URL-nya kebetulan mirip.
const templatesConfig = [
  {
    file: 'LANDING PAGE.html',
    type: 'landing',
    name: 'Halaman Utama VClass',
    match_url: null,                        // landing biasanya path root "/"
    match_title: 'vclass',                  // title halaman biasanya mengandung nama platform
    match_heading: null
  },
  {
    file: 'LOGIN PAGE.html',
    type: 'login',
    name: 'Halaman Login',
    match_url: 'login',
    match_title: 'log in',                  // Moodle login title: "Log in to the site | ..."
    match_heading: 'log in'                 // heading H1 Moodle: "Log in"
  },
  {
    file: 'DASHBOARD.html',
    type: 'dashboard',
    name: 'Dashboard Siswa',
    match_url: 'my',                        // Moodle dashboard URL: /my/ atau /my/courses
    match_title: 'kursusku',
    match_heading: null
  },
  {
    file: 'COURSE DETAIL.html',
    type: 'course',
    name: 'Detail Kursus',
    match_url: 'course/view',
    match_title: null,
    match_heading: null
  },
  {
    file: 'MATERI 1.html',
    type: 'materi',
    name: 'Materi 1',
    match_url: 'mod/page',
    match_title: null,
    match_heading: null
  },
  {
    file: 'MATERI 2.html',
    type: 'materi',
    name: 'Materi 2',
    match_url: 'mod/page',
    match_title: null,
    match_heading: null
  },
  {
    file: 'MATERI 3.html',
    type: 'materi',
    name: 'Materi 3',
    match_url: 'mod/page',
    match_title: null,
    match_heading: null
  },
  {
    file: 'MATERI 4.html',
    type: 'materi',
    name: 'Materi 4',
    match_url: 'mod/page',
    match_title: null,
    match_heading: null
  },
  {
    file: 'QUIZ.html',
    type: 'quiz',
    name: 'Halaman Kuis',
    match_url: 'mod/quiz',
    match_title: null,
    match_heading: null
  },
  {
    file: 'RANGKUMAN MATERI.html',
    type: 'summary',
    name: 'Rangkuman Materi',
    match_url: 'rangkuman',
    match_title: null,
    match_heading: null
  }
];

// ==========================================
// FUNGSI PARSER & CHUNKER
// ==========================================
function parseHtml(filePath, config) {
  const rawHtml = fs.readFileSync(filePath, 'utf-8');

  const $ = cheerio.load(rawHtml, {
    decodeEntities: false
  });

  // ==========================================
  // 0. Kumpulkan stylesheet dari <head> SEBELUM apapun dihapus
  //    Dipakai untuk inject ke html_preview agar visual style kebawa.
  // ==========================================
  const stylesheetTags = [];

  $('head link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href) {
      stylesheetTags.push(`<link rel="stylesheet" type="text/css" href="${href}">`);
    }
  });

  $('head style').each((_, el) => {
    const css = $(el).html() || '';
    if (css.trim()) {
      stylesheetTags.push(`<style>${css}</style>`);
    }
  });

  const stylesheetInjectHtml = stylesheetTags.join('\n');

  // ==========================================
  // 1. Fokus parsing dari area utama saja
  // ==========================================
  const $root = pickRoot($);

  function pickRoot($) {
    const candidates = [
      'main',
      '[role="main"]',
      '#region-main',
      '.region-main',
      '#page-content',
      '.page-content',
      '#page',
      'body'
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

    return $('body').first();
  }

  // ==========================================
  // 2. Pisahkan aksesibilitas sebelum dibersihkan
  // ==========================================
  const accessibility_json = extractAccessibility($, $root);

  // ==========================================
  // 3. Bersihkan noise
  // ==========================================
  removeNoise($, $root);

  // HTML preview sisa body/main setelah dibersihkan.
  // Wrap dengan style tag agar visual halaman asli ikut terbawa di iframe.
  const rawPreview = $root.html() || '';
  const html_preview = stylesheetTags.length > 0
    ? `<!-- styles:start -->\n${stylesheetInjectHtml}\n<!-- styles:end -->\n${rawPreview}`
    : rawPreview;

  const elements_json = [];
  const usedSelectors = new Set();
  const usedSignatures = new Set();
  const usedTextSignatures = new Set(); // untuk dedup berbasis kesamaan teks

  let elementCounter = 1;

  // ==========================================
  // 4. Target komponen sedang
  // Bukan button/input kecil, bukan wrapper super luar
  // ==========================================
  const targetSelectors = [
    // form dan modal
    'form',
    '.modal',
    '[class*="modal"]',

    // card / box
    '.card',
    '[class*="card"]',
    '.box',
    '.generalbox',

    // moodle / LMS activity
    '.coursebox',
    '.activity',
    '.activity-item',
    '.activityinstance',
    '.modtype_page',
    '.modtype_quiz',

    // quiz / soal
    '.quizattempt',
    '.que',
    '.question',
    '[class*="quiz"]',
    '[class*="question"]',

    // search / filter
    '.searchform',
    '[class*="search"]',
    '[class*="filter"]',

    // blok konten
    '.summary',
    '.description',
    '.activity-description',
    '.no-overflow',

    // semantic block
    'section',
    'article'
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

    if (usedSelectors.has(selector)) return;
    if (usedSignatures.has(signature)) return;

    // BUG FIX: Skip jika elemen ini adalah CHILD dari elemen yang sudah masuk.
    // Cek apakah ada ancestor dengan selector yang sudah terdaftar.
    let isNestedDuplicate = false;
    let $ancestor = $component.parent();
    for (let depth = 0; depth < 6; depth++) {
      if (!$ancestor.length) break;
      if ($ancestor.is('body, html')) break;
      const ancestorSel = buildSelector($, $ancestor);
      if (ancestorSel && usedSelectors.has(ancestorSel)) {
        isNestedDuplicate = true;
        break;
      }
      $ancestor = $ancestor.parent();
    }
    if (isNestedDuplicate) return;

    // BUG FIX: Skip jika teks elemen ini sudah 90%+ sama dengan elemen yang sudah masuk.
    const rawText = cleanText($component.text());
    const normalizedText = rawText.substring(0, 200).toLowerCase().replace(/\s+/g, ' ').trim();
    let isTextDuplicate = false;
    for (const existingText of usedTextSignatures) {
      const shorter = normalizedText.length < existingText.length ? normalizedText : existingText;
      const longer  = normalizedText.length < existingText.length ? existingText : normalizedText;
      if (shorter.length > 40 && longer.includes(shorter)) {
        isTextDuplicate = true;
        break;
      }
    }
    if (isTextDuplicate) return;

    if (rawText.length < 8) return;

    const type = detectComponentType($, $component);
    const title = buildTitle($, $component, type, elementCounter);

    elements_json.push({
      key: `${config.type}_el_${elementCounter}`,
      name: `@${slugify(type)}${elementCounter}`,
      title,
      type,
      text: rawText.substring(0, 700),
      selector,
      html: $.html($component)
    });

    usedSelectors.add(selector);
    usedSignatures.add(signature);
    const normalizedForTracking = rawText.substring(0, 200).toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalizedForTracking.length > 40) usedTextSignatures.add(normalizedForTracking);

    elementCounter++;
  });

  return {
    project_id: PROJECT_ID,
    page_type: config.type,
    template_name: config.name,
    match_url_contains: config.match_url || null,
    match_title_contains: config.match_title || null,
    match_heading_contains: config.match_heading || null,

    // Untuk preview iframe/frontend
    html_preview,

    // Ini yang dipakai AI untuk konteks komponen
    elements_json,

    // Ini dipisah, jangan dianggap komponen halaman
    accessibility_json,

    tutorial_steps_json: [],
    question_suggestions_json: [],
    is_active: true
  };
}

// ==========================================
// ACCESSIBILITY EXTRACTOR
// ==========================================
function extractAccessibility($, $root) {
  const accessibility_json = [];

  const $skipLinks = $root.find(
    '.visually-hidden-focusable, .sr-only, .sr-only-focusable'
  );

  if ($skipLinks.length) {
    accessibility_json.push({
      key: 'accessibility_skip_links',
      type: 'Accessibility',
      title: 'Skip Links',
      text: cleanText($skipLinks.text()),
      html: $.html($skipLinks.parent().first())
    });
  }

  const $accessibilityLauncher = $root
    .find('#acsb-menu_launcher, .acsb-trigger')
    .first();

  if ($accessibilityLauncher.length) {
    accessibility_json.push({
      key: 'accessibility_launcher',
      type: 'Accessibility',
      title: 'Accessibility Launcher',
      text: cleanText(
        $accessibilityLauncher.text() ||
          $accessibilityLauncher.attr('aria-label') ||
          'Accessibility options'
      ),
      html: $.html($accessibilityLauncher)
    });
  }

  const $accessibilityMenu = $root.find('#acsb-menu, .acsb-block').first();

  if ($accessibilityMenu.length) {
    accessibility_json.push({
      key: 'accessibility_menu',
      type: 'Accessibility',
      title: 'Accessibility Menu',
      text: cleanText($accessibilityMenu.text()).substring(0, 700),
      html: $.html($accessibilityMenu)
    });
  }

  return accessibility_json;
}

// ==========================================
// CLEANER
// ==========================================
function removeNoise($, $root) {
  $root.find(`
    head,
    script,
    style:not([scoped]),
    noscript,
    iframe,
    svg,
    i,
    img,
    nav,
    header,
    footer,
    aside,
    [id="yui3-css-stamp"],
    .visually-hidden-focusable,
    .sr-only,
    .sr-only-focusable,
    #acsb-menu,
    #acsb-menu_launcher,
    .acsb-block,
    .acsb-trigger,
    [id*="acsb"],
    [class*="acsb"],
    [class*="skip"],
    [id*="skip"]
  `).remove();

  // Hapus elemen kosong setelah noise dibersihkan
  $root.find('*').each((_, el) => {
    const $el = $(el);

    const text = cleanText($el.text());
    const hasImportantChild = $el.find(
      'form, input, select, textarea, button, a, h1, h2, h3, h4, p, li, table'
    ).length > 0;

    if (!text && !hasImportantChild) {
      $el.remove();
    }
  });
}

// ==========================================
// VALIDASI CANDIDATE
// ==========================================
function isValidCandidate($, $el) {
  if (!$el || !$el.length) return false;

  const tag = getTagName($el);
  const text = cleanText($el.text());

  if (!tag) return false;

  if (
    [
      'html',
      'head',
      'body',
      'script',
      'style',
      'noscript',
      'iframe',
      'svg',
      'i',
      'img'
    ].includes(tag)
  ) {
    return false;
  }

  if (isAccessibilityElement($el)) return false;

  const hasFunctionalChild =
    $el.find(
      'form, input, select, textarea, button, a, h1, h2, h3, h4, p, li, table'
    ).length > 0;

  if (!hasFunctionalChild && text.length < 20) return false;

  return true;
}

function isValidComponent($, $el) {
  if (!$el || !$el.length) return false;

  const tag = getTagName($el);
  const text = cleanText($el.text());
  const html = $.html($el) || '';

  if (!tag) return false;
  if (isAccessibilityElement($el)) return false;

  const interactiveCount = countInteractive($el);
  const headingCount = $el.find('h1, h2, h3, h4').length;
  const paragraphCount = $el.find('p, li').length;

  const hasMeaning =
    text.length >= 8 ||
    interactiveCount > 0 ||
    headingCount > 0 ||
    paragraphCount > 0;

  if (!hasMeaning) return false;

  // Batas biar tidak terlalu outer
  if (text.length > 2200 && !looksLikeMaterialBlock($el)) {
    return false;
  }

  // Kalau lebih dari ini biasanya sudah hampir satu halaman penuh
  if (text.length > 3500) {
    return false;
  }

  // Kalau terlalu banyak tombol/link, biasanya wrapper besar
  if (interactiveCount > 14 && !looksLikeFormOrQuiz($el)) {
    return false;
  }

  if (html.length < 40) return false;

  return true;
}

// ==========================================
// PILIH PARENT TERBAIK
// ==========================================
function pickBestComponentParent($, $candidate, $root) {
  let $current = $candidate;
  let $best = $candidate;

  const STRONG_COMPONENT_KEYS = [
    'card',
    'modal',
    'form',
    'filter',
    'search',
    'quiz',
    'question',
    'que',
    'activity',
    'activity-item',
    'coursebox',
    'summary',
    'description',
    'materi',
    'login',
    'box',
    'generalbox',
    'no-overflow'
  ];

  const STOP_OUTER_KEYS = [
    'container',
    'container-fluid',
    'wrapper',
    'page',
    'main',
    'region-main',
    'content-wrapper',
    'course-content',
    'columns',
    'row',
    'section',
    'sectionname',
    'section-summary',
    'sectionbody'
  ];

  for (let i = 0; i < 3; i++) {
    const $parent = $current.parent();

    if (!$parent.length) break;
    if ($parent.is('body, main, #maincontent, [role="main"]')) break;
    if ($root.length && $parent[0] === $root[0]) break;

    if (isAccessibilityElement($parent)) break;

    const currentText = cleanText($current.text());
    const parentText = cleanText($parent.text());

    const currentInteractiveCount = countInteractive($current);
    const parentInteractiveCount = countInteractive($parent);

    const parentHasStrongKey = hasAnyClassOrId($parent, STRONG_COMPONENT_KEYS);
    const parentLooksOuter = hasAnyClassOrId($parent, STOP_OUTER_KEYS);

    const parentTooBig = parentText.length > 1400;
    const parentMuchBigger =
      parentText.length > currentText.length * 2.2 && parentText.length > 400;

    const parentAddsTooManyActions =
      parentInteractiveCount > currentInteractiveCount + 5;

    if (parentLooksOuter) break;
    if (parentTooBig && !parentHasStrongKey) break;
    if (parentMuchBigger && !parentHasStrongKey) break;
    if (parentAddsTooManyActions && !parentHasStrongKey) break;

    // Parent punya class komponen kuat, boleh naik
    if (parentHasStrongKey) {
      $best = $parent;
      $current = $parent;
      continue;
    }

    // Kalau candidate masih terlalu kecil, naik sedikit saja
    const currentTooTiny =
      currentText.length < 80 &&
      currentInteractiveCount <= 1 &&
      parentText.length <= 800;

    if (currentTooTiny) {
      $best = $parent;
      $current = $parent;
      continue;
    }

    break;
  }

  return $best;
}

// ==========================================
// DETEKSI TIPE KOMPONEN
// ==========================================
function detectComponentType($, $el) {
  const tag = getTagName($el);
  const cls = getClass($el);
  const id = getId($el);
  const text = cleanText($el.text()).toLowerCase();

  if (tag === 'form' || $el.find('form').length) {
    return 'Formulir';
  }

  if (cls.includes('modal') || id.includes('modal')) {
    return 'Modal';
  }

  if (cls.includes('search') || id.includes('search') || text.includes('cari')) {
    return 'Area Pencarian';
  }

  if (
    cls.includes('filter') ||
    id.includes('filter') ||
    text.includes('filter')
  ) {
    return 'Area Filter';
  }

  if (cls.includes('card')) {
    return 'Card';
  }

  if (
    cls.includes('quiz') ||
    id.includes('quiz') ||
    cls.includes('question') ||
    cls.includes('que') ||
    text.includes('kuis') ||
    text.includes('soal')
  ) {
    return 'Blok Kuis';
  }

  if (
    cls.includes('activity') ||
    cls.includes('coursebox') ||
    cls.includes('modtype_')
  ) {
    return 'Aktivitas Course';
  }

  if (
    cls.includes('summary') ||
    cls.includes('description') ||
    cls.includes('no-overflow')
  ) {
    return 'Blok Konten';
  }

  if (
    cls.includes('materi') ||
    id.includes('materi') ||
    text.includes('materi')
  ) {
    return 'Materi';
  }

  if ($el.find('input, select, textarea').length >= 2) {
    return 'Grup Input';
  }

  if ($el.find('button, a.btn, a[class*="btn"]').length >= 1) {
    return 'Area Aksi';
  }

  if (tag === 'section') {
    return 'Section';
  }

  if (tag === 'article') {
    return 'Artikel';
  }

  return 'Blok Konten';
}

// ==========================================
// TITLE BUILDER
// ==========================================
function buildTitle($, $el, type, counter) {
  const heading = cleanText(
    $el
      .find(
        'h1, h2, h3, h4, legend, .title, [class*="title"], .heading, [class*="heading"]'
      )
      .first()
      .text()
  );

  if (heading) {
    return `${type}: ${heading.substring(0, 70)}`;
  }

  const label = cleanText($el.find('label').first().text());

  if (label) {
    return `${type}: ${label.substring(0, 70)}`;
  }

  const buttonText = cleanText(
    $el.find('button, a.btn, a[class*="btn"]').first().text()
  );

  if (buttonText) {
    return `${type}: ${buttonText.substring(0, 70)}`;
  }

  const text = cleanText($el.text());

  if (text) {
    return `${type}: ${text.substring(0, 70)}`;
  }

  return `${type} ${counter}`;
}

// ==========================================
// SELECTOR BUILDER
// ==========================================
function buildSelector($, $el) {
  const tag = getTagName($el);

  if (!tag) return null;

  const id = $el.attr('id');

  if (id) {
    return `${tag}#${cssEscape(id)}`;
  }

  const name = $el.attr('name');

  if (name) {
    return `${tag}[name="${name}"]`;
  }

  const classes = ($el.attr('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(c => !c.includes(':'))
    .filter(c => !c.startsWith('yui_'))
    .filter(c => !c.startsWith('css_'))
    .slice(0, 3)
    .map(cssEscape);

  if (classes.length) {
    return `${tag}.${classes.join('.')}`;
  }

  const parent = $el.parent();

  if (parent && parent.length) {
    const index = parent.children(tag).index($el) + 1;
    return `${tag}:nth-of-type(${index})`;
  }

  return tag;
}

// ==========================================
// UTIL
// ==========================================
function buildSignature($, $el) {
  const tag = getTagName($el);
  const id = getId($el);
  const cls = getClass($el);
  // Gunakan 300 karakter pertama untuk deteksi duplikat yang lebih akurat
  const text = cleanText($el.text()).substring(0, 300);
  // Tambahkan panjang HTML sebagai disambiguator tambahan
  const htmlLen = ($.html($el) || '').length;

  return `${tag}|${id}|${cls}|${text}|${htmlLen}`;
}

function countInteractive($el) {
  return $el.find('input, select, textarea, button, a').length;
}

function looksLikeFormOrQuiz($el) {
  const tag = getTagName($el);
  const cls = getClass($el);
  const id = getId($el);

  return (
    tag === 'form' ||
    cls.includes('form') ||
    id.includes('form') ||
    cls.includes('quiz') ||
    id.includes('quiz') ||
    cls.includes('question') ||
    cls.includes('que')
  );
}

function looksLikeMaterialBlock($el) {
  const cls = getClass($el);
  const id = getId($el);

  return (
    cls.includes('materi') ||
    id.includes('materi') ||
    cls.includes('summary') ||
    cls.includes('description') ||
    cls.includes('no-overflow') ||
    cls.includes('content')
  );
}

function isAccessibilityElement($el) {
  return (
    $el.is('.visually-hidden-focusable, .sr-only, .sr-only-focusable') ||
    hasAnyClassOrId($el, ['acsb', 'skip', 'accessibility'])
  );
}

function hasAnyClassOrId($el, keywords) {
  const cls = getClass($el);
  const id = getId($el);

  return keywords.some(keyword => {
    const key = String(keyword).toLowerCase();
    return cls.includes(key) || id.includes(key);
  });
}

function getTagName($el) {
  return (($el && $el[0] && $el[0].tagName) || '').toLowerCase();
}

function getClass($el) {
  return String($el.attr('class') || '').toLowerCase();
}

function getId($el) {
  return String($el.attr('id') || '').toLowerCase();
}

function cleanText(text = '') {
  return String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '')
    .substring(0, 40);
}

function cssEscape(value = '') {
  return String(value).replace(
    /([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g,
    '\\$1'
  );
}

// ==========================================
// EKSEKUSI UTAMA
// ==========================================
async function runSeeder() {
  console.log('🚀 Memulai proses parsing HTML dan import ke Supabase...\n');

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URL atau SUPABASE_KEY belum ada di .env');
    return;
  }

  for (const config of templatesConfig) {
    const filePath = path.join(HTML_FOLDER, config.file);

    if (!fs.existsSync(filePath)) {
      console.log(`❌ File tidak ditemukan: ${config.file} (Melewati...)`);
      continue;
    }

    try {
      console.log(`⏳ Memproses file: ${config.file}...`);

      const templateData = parseHtml(filePath, config);

      console.log(
        `   Menemukan ${templateData.elements_json.length} komponen sedang.`
      );

      if (templateData.accessibility_json.length > 0) {
        console.log(
          `   Menemukan ${templateData.accessibility_json.length} data aksesibilitas terpisah.`
        );
      }

      // Supaya tidak dobel terus tiap seeder dijalankan,
      // hapus dulu template lama berdasarkan project_id + page_type + template_name.
      await supabase
        .from('page_templates')
        .delete()
        .eq('project_id', PROJECT_ID)
        .eq('page_type', config.type)
        .eq('template_name', config.name);

      // Juga hapus duplikat lama yang mungkin masih pakai match_url_contains lama
      if (config.match_url) {
        await supabase
          .from('page_templates')
          .delete()
          .eq('project_id', PROJECT_ID)
          .eq('page_type', config.type)
          .eq('match_url_contains', config.match_url);
      }

      const { data, error } = await supabase
        .from('page_templates')
        .insert([templateData])
        .select();

      if (error) {
        console.error(`   ❌ Gagal insert [${config.file}]:`, error.message);
      } else {
        console.log(
          `   ✅ Berhasil masuk DB: ${config.file} (ID: ${data[0].id})\n`
        );
      }
    } catch (err) {
      console.error(
        `   ❌ Error sistem saat memproses [${config.file}]:`,
        err.message,
        '\n'
      );
    }
  }

  console.log('🎉 Proses seeding template selesai!');
}

runSeeder();
