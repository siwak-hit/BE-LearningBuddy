// src/services/seed/seed_template.js
// Seeder page_templates AI Learning Buddy - HTML/CSS only, curated visual elements.
// Jalankan dari: D:\WEB AI SKRIPSI\be\src\services\seed
// Command: node seed_template.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const PROJECT_ID = process.env.SEED_PROJECT_ID || 'c4ec8eba-e342-4c31-b5de-2d4218dcfd86';
const HTML_FOLDER = path.join(__dirname, 'html-samples');

const templatesConfig = [
  {
    type: 'landing',
    name: 'Halaman Utama VClass',
    files: ['LANDING PAGE.html', 'LANDING PAGE(2).html'],
    match_url: null,
    match_title: 'vclass',
    match_heading: null
  },
  {
    type: 'login',
    name: 'Halaman Login',
    files: ['LOGIN PAGE.html', 'LOGIN PAGE(2).html', 'LOGIN PAGE(1).html'],
    match_url: 'login',
    match_title: 'log in',
    match_heading: 'log in'
  },
  {
    type: 'dashboard',
    name: 'Dashboard Siswa',
    files: ['DASHBOARD.html', 'DASHBOARD(1).html'],
    match_url: 'my',
    match_title: 'kursusku',
    match_heading: null
  },
  {
    type: 'course',
    name: 'Detail Kursus',
    files: ['COURSE DETAIL.html', 'COURSE DETAIL(1).html'],
    match_url: 'course/view',
    match_title: 'kursus',
    match_heading: null
  },
  {
    type: 'list_aktivitas',
    name: 'List Aktivitas Kursus',
    files: ['LIST AKTIVITAS.html'],
    match_url: 'course/overview',
    match_title: 'kegiatan kursus',
    match_heading: null
  },
  {
    type: 'nilai',
    name: 'Halaman Nilai',
    files: ['NILAI.html'],
    match_url: 'grade/report',
    match_title: 'laporan pengguna',
    match_heading: null
  },
  {
    type: 'forum',
    name: 'Halaman Forum',
    files: ['FORUM.html'],
    match_url: 'mod/forum/view',
    match_title: 'diskusi',
    match_heading: null
  },
  {
    type: 'forum_detail',
    name: 'Form Tambah Diskusi Forum',
    files: ['FORUM-DETAIL.html', 'FORUM DETAIL.html'],
    match_url: 'mod/forum/discuss',
    match_title: 'forum',
    match_heading: null
  },
  {
    type: 'quiz',
    name: 'Halaman Kuis',
    files: ['QUIZ.html', 'QUIZ(1).html'],
    match_url: 'mod/quiz/view',
    match_title: 'kuis',
    match_heading: null
  },
  {
    type: 'quiz_attempt',
    name: 'Halaman Pengerjaan Kuis',
    files: ['QUIZ ASSIGMENT.html', 'QUIS ASSIGMENT.html'],
    match_url: 'mod/quiz/attempt',
    match_title: 'page',
    match_heading: null
  },
  {
    type: 'quiz_summary',
    name: 'Ringkasan Kuis',
    files: ['QUIS SUMMARY.html', 'QUIZ SUMMARY.html'],
    match_url: 'mod/quiz/summary',
    match_title: 'ringkasan',
    match_heading: null
  },
  {
    type: 'quiz_review',
    name: 'Review Kuis',
    files: ['QUIS REVIEW.html', 'QUIZ REVIEW.html'],
    match_url: 'mod/quiz/review',
    match_title: 'reviu',
    match_heading: null
  },
  {
    type: 'summary',
    name: 'Rangkuman Materi',
    files: ['RANGKUMAN MATERI.html', 'RANGKUMAN MATERI(1).html'],
    match_url: 'mod/page',
    match_title: 'rangkuman',
    match_heading: null
  },
  {
    type: 'tugas',
    name: 'Halaman Tugas',
    files: ['TUGAS.html'],
    match_url: 'mod/assign/view',
    match_title: 'tugas',
    match_heading: null
  },
  {
    type: 'tugas_detail',
    name: 'Halaman Upload Tugas',
    files: ['TUGAS DETAIL.html'],
    match_url: 'mod/assign/view',
    match_title: 'edit pengajuan',
    match_heading: null
  },
  {
    type: 'tugas_selesai',
    name: 'Halaman Tugas Selesai',
    files: ['TUGAS SELESAI.html'],
    match_url: 'mod/assign/view',
    match_title: 'tugas praktik',
    match_heading: null
  }
];

function cleanText(value = '') {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value = '') {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cssEscape(value = '') {
  return String(value || '').replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function safeAttr(value = '') {
  return String(value || '').replace(/"/g, '&quot;');
}

function buildSelector($, $el) {
  if (!$el || !$el.length) return '';
  const tag = (($el[0] && $el[0].tagName) || '').toLowerCase();
  if (!tag) return '';
  const id = $el.attr('id');
  if (id) return `${tag}#${cssEscape(id)}`;
  const name = $el.attr('name');
  if (name) return `${tag}[name="${safeAttr(name)}"]`;
  const classes = String($el.attr('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((cls) => !cls.includes(':') && !cls.startsWith('yui_'))
    .slice(0, 3)
    .map(cssEscape);
  if (classes.length) return `${tag}.${classes.join('.')}`;
  const parent = $el.parent();
  if (parent && parent.length) {
    const index = parent.children(tag).index($el) + 1;
    return `${tag}:nth-of-type(${index})`;
  }
  return tag;
}

function getStylesheetInject($) {
  const tags = [];

  $('head link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href) return;
    // Tetap simpan link asli di DB; FE akan mem-proxy via /page-templates/proxy-asset saat render iframe.
    tags.push(`<link rel="stylesheet" type="text/css" href="${href}">`);
  });

  $('head style').each((_, el) => {
    const css = $(el).html() || '';
    if (css.trim()) tags.push(`<style>${css}</style>`);
  });

  return tags.join('\n');
}

function stripDangerousAttrs($, $root) {
  $root.find('*').addBack().each((_, el) => {
    const $el = $(el);
    const attrs = el.attribs || {};
    Object.keys(attrs).forEach((name) => {
      if (/^on/i.test(name)) $el.removeAttr(name);
      if (name === 'srcdoc') $el.removeAttr(name);
    });
  });
}

function stripNoiseInClone($, $el) {
  const $clone = $el.clone();

  $clone.find('script, noscript, iframe, object, embed, img, svg, link[rel="preload"], link[rel="modulepreload"]').remove();
  $clone.find('input[type="hidden"], [style*="display: none"], [style*="visibility: hidden"]').remove();
  $clone.find('[id="yui3-css-stamp"], #acsb-menu, #acsb-menu_launcher, [id*="acsb"], [class*="acsb"], [class*="skip"], [id*="skip"], .sr-only, .sr-only-focusable, .visually-hidden, .visually-hidden-focusable').remove();

  stripDangerousAttrs($, $clone);

  // Buang list item kosong agar preview tidak terlalu tinggi.
  $clone.find('*').each((_, el) => {
    const $node = $(el);
    const tag = (($node[0] && $node[0].tagName) || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button', 'a', 'img', 'svg'].includes(tag)) return;
    const text = cleanText($node.text());
    const important = $node.find('input, textarea, select, button, a, table, th, td').length > 0;
    if (!text && !important) $node.remove();
  });

  return $.html($clone);
}

function wrapSnippet(html = '', options = {}) {
  const maxWidth = options.maxWidth || '100%';
  const compact = options.compact !== false;
  const padding = compact ? '0' : '0';
  return `
<div class="alb-moodle-visual-snippet" style="max-width:${maxWidth}; padding:${padding}; display:block; overflow:hidden;">
  ${html || ''}
</div>`;
}

function snippetFromElement($, $el, options = {}) {
  if (!$el || !$el.length) return '';
  return wrapSnippet(stripNoiseInClone($, $el), options);
}

function snippetFromHtml(html = '', options = {}) {
  return wrapSnippet(String(html || ''), options);
}

function findByText($, selectors, regex, root = null) {
  const $scope = root && root.length ? root : $.root();
  let found = null;
  $scope.find(selectors).addBack(selectors).each((_, el) => {
    if (found) return;
    const $el = $(el);
    const text = cleanText([
      $el.text(),
      $el.attr('aria-label'),
      $el.attr('title'),
      $el.attr('value'),
      $el.attr('placeholder')
    ].filter(Boolean).join(' '));
    if (regex.test(text)) found = $el;
  });
  return found;
}

function findClosestUseful($, $el, selectorList = []) {
  if (!$el || !$el.length) return $el;
  for (const selector of selectorList) {
    const $closest = $el.closest(selector);
    if ($closest.length) return $closest.first();
  }
  return $el;
}

function makeElement({ $, config, key, name, title, type, text, selector, html, $el, previewHeight = 140, actionUrl = '', metadata = {} }) {
  const finalHtml = html || ($el && $el.length ? snippetFromElement($, $el) : '');
  if (!finalHtml && !text) return null;
  return {
    key: `${config.type}_${key}`,
    name,
    title,
    type,
    text: cleanText(text || ($el ? $el.text() : '')).substring(0, 900),
    selector: selector || ($el && $el.length ? buildSelector($, $el) : ''),
    html: finalHtml,
    preview_height: previewHeight,
    action_url: actionUrl || '',
    metadata
  };
}

function pushElement(elements, element) {
  if (!element) return;
  if (elements.some((item) => item.key === element.key || item.name === element.name)) return;
  elements.push(element);
}

function findFile(config) {
  for (const fileName of config.files || []) {
    const directPath = path.join(HTML_FOLDER, fileName);
    if (fs.existsSync(directPath)) return { fileName, filePath: directPath };
  }
  return null;
}

function pickRoot($) {
  const selectors = ['main', '[role="main"]', '#region-main', '#page-content', '.page-content', '#page', 'body'];
  for (const selector of selectors) {
    const $el = $(selector).first();
    if ($el.length && (($el.html() || '').length > 80 || cleanText($el.text()).length > 40)) return $el;
  }
  return $('body').first();
}

function buildHtmlPreview($, stylesheetInjectHtml, $root) {
  const $clone = $root && $root.length ? $root.clone() : $('body').clone();
  $clone.find('script, noscript, iframe, object, embed, img, svg').remove();
  $clone.find('#acsb-menu, #acsb-menu_launcher, [id*="acsb"], [class*="acsb"]').remove();
  stripDangerousAttrs($, $clone);
  const bodyHtml = $.html($clone) || '';
  return stylesheetInjectHtml
    ? `<!-- styles:start -->\n${stylesheetInjectHtml}\n<!-- styles:end -->\n${bodyHtml}`
    : bodyHtml;
}

function buildManualLogin($, config) {
  const elements = [];
  const $loginArea = $('#themeskipto-login').first().length
    ? $('#themeskipto-login').first()
    : ($('.loginform').first().length ? $('.loginform').first() : $('form#login').first());
  const $usernameBlock = $('.login-form-username').first().length ? $('.login-form-username').first() : $('#username').first();
  const $passwordBlock = $('.login-form-password').first().length ? $('.login-form-password').first() : $('#password').first();
  const $submitBlock = $('.login-form-submit').first().length ? $('.login-form-submit').first() : $('#loginbtn').first();
  const $forgot = $('.login-form-forgotpassword').first();

  pushElement(elements, makeElement({ $, config, key: 'form_login', name: '@formlogin', title: 'Form Login VClass', type: 'Formulir Login', text: 'Isi username dan password, lalu klik tombol Log in.', $el: $loginArea, selector: '#themeskipto-login, .loginform, form#login', previewHeight: 230 }));
  pushElement(elements, makeElement({ $, config, key: 'field_username', name: '@kolomusername', title: 'Kolom Username', type: 'Kolom Input', text: 'Kolom untuk memasukkan username akun siswa.', $el: $usernameBlock, selector: 'input#username', previewHeight: 90 }));
  pushElement(elements, makeElement({ $, config, key: 'field_password', name: '@kolompassword', title: 'Kolom Password', type: 'Kolom Input', text: 'Kolom untuk memasukkan password akun siswa.', $el: $passwordBlock, selector: 'input#password', previewHeight: 90 }));
  pushElement(elements, makeElement({ $, config, key: 'button_login', name: '@tombollogin', title: 'Tombol Log in', type: 'Tombol Aksi', text: 'Tombol untuk masuk ke VClass.', $el: $submitBlock, selector: 'button#loginbtn', previewHeight: 78 }));
  pushElement(elements, makeElement({ $, config, key: 'forgot_password', name: '@linklupapassword', title: 'Link Lupa Username atau Password', type: 'Link Bantuan', text: 'Gunakan link ini jika lupa username atau password.', $el: $forgot, selector: '.login-form-forgotpassword', previewHeight: 70 }));

  return elements;
}

function buildDashboardElements($, config) {
  const elements = [];
  const $burger = $('.menu-toggle').first();
  const $profileHeader = $('.tool-login').first();
  const $profileMenu = $('#menu-logincontainer .form-inner').first().length ? $('#menu-logincontainer .form-inner').first() : $('.theme-loginform .form-inner').first();
  const $logout = $('.logout-link').first();
  const $nilai = findByText($, 'a, button', /^nilai$/i);
  const $courseCard = $('.coursebox, .course-card, [class*="course"] .card, .card').first();

  pushElement(elements, makeElement({ $, config, key: 'mobile_burger', name: '@tombolburger', title: 'Tombol Menu Burger', type: 'Tombol Navigasi', text: 'Pada tampilan HP, klik tombol menu burger untuk membuka menu.', $el: $burger, selector: '.menu-toggle', previewHeight: 86 }));
  pushElement(elements, makeElement({ $, config, key: 'profile_icon', name: '@ikonprofil', title: 'Ikon Profil Siswa', type: 'Tombol Profil', text: 'Klik ikon profil siswa untuk membuka menu akun.', $el: $profileHeader, selector: '.tool-login', previewHeight: 90 }));
  pushElement(elements, makeElement({ $, config, key: 'profile_menu', name: '@menuprofil', title: 'Menu Profil Siswa', type: 'Menu Profil', text: 'Menu profil berisi Profil, Nilai, Kalender, Preferensi, dan Keluar.', $el: $profileMenu, selector: '#menu-logincontainer .form-inner', previewHeight: 330 }));
  pushElement(elements, makeElement({ $, config, key: 'logout_button', name: '@tombolkeluar', title: 'Tombol Keluar', type: 'Tombol Aksi', text: 'Tombol Keluar untuk logout dari VClass.', $el: $logout, selector: '.logout-link', previewHeight: 78 }));
  pushElement(elements, makeElement({ $, config, key: 'nilai_menu', name: '@menunilai', title: 'Menu Nilai', type: 'Link Menu', text: 'Menu Nilai untuk melihat nilai siswa.', $el: $nilai, selector: 'a[href*="grade"]', previewHeight: 78 }));
  pushElement(elements, makeElement({ $, config, key: 'course_card', name: '@kartukursus', title: 'Kartu Kursus', type: 'Card Kursus', text: 'Kartu kursus yang dapat dibuka siswa.', $el: $courseCard, selector: buildSelector($, $courseCard), previewHeight: 180 }));

  return elements;
}

function buildCourseElements($, config) {
  const elements = [];
  const $mainTabs = $('.secondary-navigation, .moremenu, [role="menubar"]').first();
  const $courseTab = findByText($, 'a.nav-link, a', /^kursus$/i) || findByText($, 'a', /course content|konten kursus/i);
  const $activityTab = findByText($, 'a.nav-link, a', /^aktivitas$/i);
  const $nilaiTab = findByText($, 'a.nav-link, a', /^nilai$/i);
  const $activityList = $('.course-content, .activity-wrapper, .activity, .activity-item').first();

  pushElement(elements, makeElement({ $, config, key: 'course_nav_tabs', name: '@tabnavigasikursus', title: 'Tab Navigasi Kursus', type: 'Navigasi Kursus', text: 'Navigasi kursus berisi menu Kursus, Peserta, Nilai, Aktivitas, dan Kompetensi.', $el: $mainTabs, selector: buildSelector($, $mainTabs), previewHeight: 120 }));
  pushElement(elements, makeElement({ $, config, key: 'tab_kursus', name: '@tabkursus', title: 'Tab Kursus', type: 'Tab Menu', text: 'Tab Kursus untuk membuka halaman utama kursus.', $el: $courseTab, selector: buildSelector($, $courseTab), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'tab_aktivitas', name: '@tabaktivitas', title: 'Tab Aktivitas', type: 'Tab Menu', text: 'Tab Aktivitas untuk melihat daftar semua aktivitas seperti tugas, kuis, forum, dan materi.', $el: $activityTab, selector: buildSelector($, $activityTab), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'tab_nilai', name: '@tabnilai', title: 'Tab Nilai', type: 'Tab Menu', text: 'Tab Nilai untuk melihat laporan nilai.', $el: $nilaiTab, selector: buildSelector($, $nilaiTab), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'activity_list', name: '@daftaraktivitas', title: 'Daftar Aktivitas Kursus', type: 'Daftar Aktivitas', text: 'Daftar aktivitas pada kursus.', $el: $activityList, selector: buildSelector($, $activityList), previewHeight: 240 }));

  return elements;
}

function buildListAktivitasElements($, config) {
  const elements = buildCourseElements($, config);
  const $list = $('table, .generaltable, .activity, .activity-item, .courseindex, .card').filter((_, el) => /tugas|kuis|quiz|forum|aktivitas|materi/i.test(cleanText($(el).text()))).first();
  pushElement(elements, makeElement({ $, config, key: 'full_activities_list', name: '@listaktivitas', title: 'List Aktivitas', type: 'Daftar Aktivitas', text: 'Halaman list aktivitas untuk mencari tugas, kuis, forum, atau materi.', $el: $list, selector: buildSelector($, $list), previewHeight: 260 }));
  return elements;
}

function buildNilaiElements($, config) {
  const elements = buildCourseElements($, config);
  const $gradeTable = $('table, .generaltable, .user-grade, .grade-report, [class*="grade"]').filter((_, el) => /nilai|grade|laporan|total|kuis|tugas/i.test(cleanText($(el).text()))).first();
  const $nilaiTab = findByText($, 'a.nav-link, a', /^nilai$/i);
  pushElement(elements, makeElement({ $, config, key: 'grade_tab', name: '@tabnilai', title: 'Tab Nilai', type: 'Tab Menu', text: 'Klik tab Nilai untuk membuka laporan nilai.', $el: $nilaiTab, selector: buildSelector($, $nilaiTab), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'grade_report', name: '@tabelnilai', title: 'Tabel/Laporan Nilai', type: 'Laporan Nilai', text: 'Area laporan nilai siswa.', $el: $gradeTable, selector: buildSelector($, $gradeTable), previewHeight: 260 }));
  return elements;
}

function buildForumElements($, config) {
  const elements = [];
  const $intro = $('.activity-description, #intro, .generalbox, .box').filter((_, el) => /mulai diskusi|menurut kalian|diskusi|forum/i.test(cleanText($(el).text()))).first();
  const $addTopic = findByText($, 'a, button, input[type="submit"]', /tambahkan topik diskusi|add discussion/i);
  const $searchForum = $('.simplesearchform').first();
  const $discussionList = $('table, .discussion-list, [id*="discussion-list"], .forumheaderlist').filter((_, el) => /diskusi|dimulai oleh|kiriman terakhir|balasan/i.test(cleanText($(el).text()))).first();
  const $subject = $('#fitem_id_subject').first();
  const $message = $('#fitem_id_message').first();
  const $send = $('#id_submitbutton').first();

  pushElement(elements, makeElement({ $, config, key: 'forum_instruction', name: '@instruksiforum', title: 'Instruksi Forum', type: 'Instruksi Forum', text: 'Instruksi atau syarat forum dari guru.', $el: $intro, selector: buildSelector($, $intro), previewHeight: 150 }));
  pushElement(elements, makeElement({ $, config, key: 'add_topic_button', name: '@tambahtopikdiskusi', title: 'Tombol Tambahkan Topik Diskusi', type: 'Tombol Aksi', text: 'Tombol untuk mulai membuat topik diskusi baru.', $el: $addTopic, selector: buildSelector($, $addTopic), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'search_forum', name: '@cariforum', title: 'Kolom Cari Forum', type: 'Area Pencarian', text: 'Kolom pencarian forum.', $el: $searchForum, selector: buildSelector($, $searchForum), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'discussion_list', name: '@daftardiskusi', title: 'Daftar Diskusi Forum', type: 'Tabel Diskusi', text: 'Daftar siswa/topik yang sudah membuat forum diskusi. Pastikan jumlahnya memenuhi syarat guru.', $el: $discussionList, selector: buildSelector($, $discussionList), previewHeight: 230 }));
  pushElement(elements, makeElement({ $, config, key: 'subject_field', name: '@subjekforum', title: 'Kolom Subjek Forum', type: 'Kolom Input', text: 'Kolom Subjek. Jika tidak ada instruksi khusus, isi dengan format nama_kelas_minggu.', $el: $subject, selector: '#id_subject', previewHeight: 90 }));
  pushElement(elements, makeElement({ $, config, key: 'message_editor', name: '@editorpesanforum', title: 'Editor Pesan Forum', type: 'Editor Teks', text: 'Editor Pesan untuk menulis jawaban diskusi.', $el: $message, selector: '#id_message', previewHeight: 230 }));
  pushElement(elements, buildForumToolbarElement($, config));
  pushElement(elements, makeElement({ $, config, key: 'send_forum_button', name: '@tombolkirimforum', title: 'Tombol Kirim ke Forum', type: 'Tombol Aksi', text: 'Tombol Kirim ke forum untuk menyimpan diskusi.', $el: $send, selector: '#id_submitbutton', previewHeight: 78 }));

  return elements;
}

function buildForumToolbarElement($, config) {
  const wanted = ['tebal', 'miring', 'daftar bersimbol', 'daftar bernomor'];
  const buttons = [];
  $('button.tox-tbtn, button').each((_, el) => {
    const $btn = $(el);
    const text = normalizeText([$btn.text(), $btn.attr('aria-label'), $btn.attr('title')].filter(Boolean).join(' '));
    if (wanted.some((item) => text.includes(normalizeText(item)))) {
      buttons.push(stripNoiseInClone($, $btn));
    }
  });

  if (!buttons.length) return null;
  const html = snippetFromHtml(`<div class="tox tox-tinymce"><div class="tox-toolbar__primary"><div class="tox-toolbar__group">${buttons.join('\n')}</div></div></div>`);
  return makeElement({
    $, config,
    key: 'formatting_toolbar',
    name: '@toolbarformatforum',
    title: 'Toolbar Format Pesan',
    type: 'Toolbar Editor',
    text: 'Toolbar format pesan: huruf tebal, huruf miring, daftar bersimbol, dan daftar bernomor.',
    selector: '.tox-toolbar__primary',
    html,
    previewHeight: 90
  });
}

function buildQuizElements($, config) {
  const elements = [];
  const $intro = $('.activity-description, #intro, .generalbox, .box, .quizinfo, .quizattemptsummary').filter((_, el) => /kuis|diizinkan|waktu pengerjaan|metode penilaian|soal/i.test(cleanText($(el).text()))).first();
  const $start = findByText($, 'button, a, input[type="submit"]', /kerjakan kuis|attempt quiz|mulai/i);
  const $question = $('.que, .question, .quizattempt, [id*="question"], .formulation').filter((_, el) => /soal|belum dijawab|poin|pilihan|jawaban|phpmyadmin|composer|filezilla/i.test(cleanText($(el).text()))).first();
  const $nav = $('.qn_buttons, #mod_quiz_navblock, .othernav, .quiznav, [class*="qn_"]').first();
  const $next = findByText($, 'button, a, input[type="submit"]', /halaman selanjutnya|selanjutnya|next/i);
  const $finish = findByText($, 'button, a, input[type="submit"]', /selesaikan kuis|finish attempt|kumpulkan|submit all|kirim semua/i);
  const $summary = $('table, .generaltable, .quizsummary, .summary').filter((_, el) => /ringkasan|status|jawaban|selesai|kumpulkan/i.test(cleanText($(el).text()))).first();

  pushElement(elements, makeElement({ $, config, key: 'quiz_instruction', name: '@petunjukkuis', title: 'Petunjuk Kuis', type: 'Instruksi Kuis', text: 'Petunjuk kuis seperti jumlah soal, durasi, kesempatan mengerjakan, dan metode penilaian.', $el: $intro, selector: buildSelector($, $intro), previewHeight: 170 }));
  pushElement(elements, makeElement({ $, config, key: 'start_quiz_button', name: '@tombolkerjakankuis', title: 'Tombol Kerjakan Kuis', type: 'Tombol Aksi', text: 'Klik tombol Kerjakan kuis untuk mulai mengerjakan.', $el: $start, selector: buildSelector($, $start), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'quiz_question', name: '@soalkuis', title: 'Area Soal Kuis', type: 'Soal Kuis', text: 'Area soal kuis dan pilihan jawaban.', $el: $question, selector: buildSelector($, $question), previewHeight: 230 }));
  pushElement(elements, makeElement({ $, config, key: 'quiz_navigation', name: '@navigasikuis', title: 'Navigasi Kuis', type: 'Navigasi Kuis', text: 'Navigasi nomor soal pada kuis.', $el: $nav, selector: buildSelector($, $nav), previewHeight: 160 }));
  pushElement(elements, makeElement({ $, config, key: 'next_button', name: '@tombolselanjutnya', title: 'Tombol Halaman Selanjutnya', type: 'Tombol Aksi', text: 'Tombol untuk lanjut ke soal/halaman berikutnya.', $el: $next, selector: buildSelector($, $next), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'finish_button', name: '@tombolselesaikankuis', title: 'Tombol Selesaikan/Kumpulkan Kuis', type: 'Tombol Aksi', text: 'Tombol untuk menyelesaikan dan mengumpulkan kuis.', $el: $finish, selector: buildSelector($, $finish), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'summary_table', name: '@ringkasankuis', title: 'Ringkasan Kuis', type: 'Ringkasan Kuis', text: 'Ringkasan jawaban sebelum kuis dikumpulkan.', $el: $summary, selector: buildSelector($, $summary), previewHeight: 210 }));

  return elements;
}

function buildTugasElements($, config) {
  const elements = [];
  const $intro = $('.activity-description, #intro, .generalbox, .box').filter((_, el) => /tugas|instruksi|pengajuan|upload|file|pdf|foto|word/i.test(cleanText($(el).text()))).first();
  const $statusTable = $('table, .generaltable, .submissionstatustable').filter((_, el) => /status pengajuan|status penilaian|pengajuan berkas|terakhir diubah|jumlah upaya/i.test(cleanText($(el).text()))).first();
  const $add = findByText($, 'button, a, input[type="submit"]', /tambahkan pengajuan|add submission|edit pengajuan|ubah pengajuan/i);
  const $file = $('.filemanager, .fp-restrictions, [class*="filemanager"], [id*="filemanager"], [id*="fitem_id_files"]').first();
  const $save = findByText($, 'button, input[type="submit"]', /simpan perubahan|save changes|submit|kirim/i);

  pushElement(elements, makeElement({ $, config, key: 'assignment_instruction', name: '@instruksitugas', title: 'Instruksi Tugas', type: 'Instruksi Tugas', text: 'Instruksi tugas dari guru. Perhatikan format file dan batas pengumpulan.', $el: $intro, selector: buildSelector($, $intro), previewHeight: 170 }));
  pushElement(elements, makeElement({ $, config, key: 'submission_status', name: '@statustugas', title: 'Status Pengajuan Tugas', type: 'Tabel Status', text: 'Status pengajuan, status penilaian, dan file yang sudah dikumpulkan.', $el: $statusTable, selector: buildSelector($, $statusTable), previewHeight: 230 }));
  pushElement(elements, makeElement({ $, config, key: 'add_submission_button', name: '@tomboltambahpengajuan', title: 'Tombol Tambah/Edit Pengajuan', type: 'Tombol Aksi', text: 'Tombol untuk mulai upload atau mengedit pengajuan tugas.', $el: $add, selector: buildSelector($, $add), previewHeight: 80 }));
  pushElement(elements, makeElement({ $, config, key: 'file_upload_area', name: '@areauploadfile', title: 'Area Upload File', type: 'Area Upload File', text: 'Area upload file tugas.', $el: $file, selector: buildSelector($, $file), previewHeight: 220 }));
  pushElement(elements, makeElement({ $, config, key: 'save_submission_button', name: '@tombolsimpanpengajuan', title: 'Tombol Simpan Pengajuan', type: 'Tombol Aksi', text: 'Tombol untuk menyimpan file tugas yang sudah dipilih.', $el: $save, selector: buildSelector($, $save), previewHeight: 80 }));

  return elements;
}

function buildSummaryElements($, config) {
  const elements = [];
  const $content = $('.no-overflow, .activity-description, #page-content, main').filter((_, el) => cleanText($(el).text()).length > 80).first();
  pushElement(elements, makeElement({ $, config, key: 'content_summary', name: '@kontenrangkuman', title: 'Konten Rangkuman Materi', type: 'Materi', text: 'Konten rangkuman materi.', $el: $content, selector: buildSelector($, $content), previewHeight: 260 }));
  return elements;
}

function buildCuratedElements($, config) {
  if (config.type === 'login') return buildManualLogin($, config);
  if (config.type === 'dashboard') return buildDashboardElements($, config);
  if (config.type === 'course') return buildCourseElements($, config);
  if (config.type === 'list_aktivitas') return buildListAktivitasElements($, config);
  if (config.type === 'nilai') return buildNilaiElements($, config);
  if (config.type === 'forum' || config.type === 'forum_detail') return buildForumElements($, config);
  if (config.type === 'quiz' || config.type === 'quiz_attempt' || config.type === 'quiz_summary' || config.type === 'quiz_review') return buildQuizElements($, config);
  if (config.type === 'tugas' || config.type === 'tugas_detail' || config.type === 'tugas_selesai') return buildTugasElements($, config);
  if (config.type === 'summary') return buildSummaryElements($, config);
  return [];
}

function buildTutorialSteps(config) {
  const type = config.type;
  const map = {
    login: [
      { step_number: 1, title: 'Isi username', description: 'Masukkan username akun VClass pada kolom Username.', element_ref: `${type}_field_username` },
      { step_number: 2, title: 'Isi password', description: 'Masukkan password akun VClass pada kolom Password.', element_ref: `${type}_field_password` },
      { step_number: 3, title: 'Klik Log in', description: 'Klik tombol Log in untuk masuk ke dashboard.', element_ref: `${type}_button_login` }
    ],
    forum: [
      { step_number: 1, title: 'Klik Tambahkan topik diskusi', description: 'Klik tombol Tambahkan topik diskusi untuk membuat jawaban forum.', element_ref: `${type}_add_topic_button` },
      { step_number: 2, title: 'Isi subjek', description: 'Isi subjek sesuai instruksi guru atau format nama_kelas_minggu.', element_ref: `${type}_subject_field` },
      { step_number: 3, title: 'Isi pesan', description: 'Tulis jawaban diskusi pada editor pesan.', element_ref: `${type}_message_editor` },
      { step_number: 4, title: 'Kirim ke forum', description: 'Klik tombol Kirim ke forum untuk menyimpan jawaban.', element_ref: `${type}_send_forum_button` }
    ],
    forum_detail: [
      { step_number: 1, title: 'Isi subjek', description: 'Isi subjek sesuai instruksi guru atau format nama_kelas_minggu.', element_ref: `${type}_subject_field` },
      { step_number: 2, title: 'Isi pesan', description: 'Tulis jawaban diskusi pada editor pesan.', element_ref: `${type}_message_editor` },
      { step_number: 3, title: 'Kirim ke forum', description: 'Klik tombol Kirim ke forum untuk menyimpan jawaban.', element_ref: `${type}_send_forum_button` }
    ],
    quiz: [
      { step_number: 1, title: 'Baca petunjuk kuis', description: 'Perhatikan durasi, jumlah percobaan, dan metode penilaian.', element_ref: `${type}_quiz_instruction` },
      { step_number: 2, title: 'Klik Kerjakan kuis', description: 'Klik tombol Kerjakan kuis saat sudah siap.', element_ref: `${type}_start_quiz_button` }
    ],
    quiz_attempt: [
      { step_number: 1, title: 'Kerjakan soal', description: 'Pilih jawaban pada soal kuis.', element_ref: `${type}_quiz_question` },
      { step_number: 2, title: 'Lanjut atau selesaikan', description: 'Gunakan tombol halaman selanjutnya atau selesaikan kuis.', element_ref: `${type}_finish_button` }
    ],
    tugas: [
      { step_number: 1, title: 'Baca instruksi tugas', description: 'Perhatikan format file dan ketentuan pengumpulan.', element_ref: `${type}_assignment_instruction` },
      { step_number: 2, title: 'Tambah/Edit pengajuan', description: 'Klik tombol tambah/edit pengajuan jika ingin mengumpulkan tugas.', element_ref: `${type}_add_submission_button` }
    ],
    tugas_detail: [
      { step_number: 1, title: 'Upload file tugas', description: 'Pilih file tugas pada area upload.', element_ref: `${type}_file_upload_area` },
      { step_number: 2, title: 'Simpan pengajuan', description: 'Klik tombol simpan agar file tugas terkumpul.', element_ref: `${type}_save_submission_button` }
    ],
    nilai: [
      { step_number: 1, title: 'Klik tab Nilai', description: 'Buka tab Nilai pada navigasi kursus.', element_ref: `${type}_grade_tab` },
      { step_number: 2, title: 'Lihat laporan nilai', description: 'Cari nilai tugas, kuis, atau forum yang ingin dilihat.', element_ref: `${type}_grade_report` }
    ],
    list_aktivitas: [
      { step_number: 1, title: 'Buka tab Aktivitas', description: 'Klik tab Aktivitas pada navigasi kursus.', element_ref: `${type}_tab_aktivitas` },
      { step_number: 2, title: 'Cari aktivitas', description: 'Cari tugas, kuis, forum, atau materi yang ingin dibuka.', element_ref: `${type}_full_activities_list` }
    ]
  };
  return map[type] || [];
}

function buildQuestionSuggestions(config) {
  const map = {
    login: [
      { text: 'Cara login ke VClass gimana?', intent: 'bantuan_login' },
      { text: 'Kalau lupa password gimana?', intent: 'bantuan_lupa_password' }
    ],
    forum: [{ text: 'Cara reply forum di VClass', intent: 'bantuan_forum' }],
    forum_detail: [{ text: 'Cara kirim forum di VClass', intent: 'bantuan_forum' }],
    quiz: [{ text: 'Cara mengerjakan kuis di VClass', intent: 'bantuan_kuis' }],
    quiz_attempt: [{ text: 'Cara mengumpulkan kuis', intent: 'bantuan_kuis' }],
    dashboard: [
      { text: 'Cara logout dari VClass', intent: 'bantuan_logout' },
      { text: 'Cara melihat nilai di VClass', intent: 'bantuan_lihat_nilai' }
    ],
    course: [
      { text: 'Cara melihat tugas di VClass', intent: 'bantuan_tugas' },
      { text: 'Cara melihat nilai di VClass', intent: 'bantuan_lihat_nilai' }
    ],
    list_aktivitas: [{ text: 'Cara melihat tugas di VClass', intent: 'bantuan_tugas' }],
    nilai: [{ text: 'Cara melihat nilai di VClass', intent: 'bantuan_lihat_nilai' }]
  };
  return map[config.type] || [];
}

function parseHtml(filePath, config) {
  const rawHtml = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const stylesheetInjectHtml = getStylesheetInject($);
  const $root = pickRoot($);
  const elements_json = buildCuratedElements($, config).filter(Boolean);

  return {
    project_id: PROJECT_ID,
    page_type: config.type,
    template_name: config.name,
    match_url_contains: config.match_url || null,
    match_title_contains: config.match_title || null,
    match_heading_contains: config.match_heading || null,
    html_preview: buildHtmlPreview($, stylesheetInjectHtml, $root),
    elements_json,
    accessibility_json: [],
    tutorial_steps_json: buildTutorialSteps(config),
    question_suggestions_json: buildQuestionSuggestions(config),
    is_active: true
  };
}

async function runSeeder() {
  console.log('🚀 Memulai parsing HTML dan import page_templates (curated visual only)...\n');

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY belum ada di .env');
    process.exitCode = 1;
    return;
  }

  for (const config of templatesConfig) {
    const resolved = findFile(config);
    if (!resolved) {
      console.log(`❌ File tidak ditemukan untuk template ${config.type}: ${config.files.join(', ')} (skip)`);
      continue;
    }

    try {
      console.log(`⏳ Memproses: ${resolved.fileName} -> ${config.type}`);
      const templateData = parseHtml(resolved.filePath, config);

      console.log(`   Komponen penting terdeteksi : ${templateData.elements_json.length}`);
      console.log(`   Tutorial default            : ${templateData.tutorial_steps_json.length}`);
      console.log(`   Pertanyaan cepat default    : ${templateData.question_suggestions_json.length}`);

      const { error: deleteError } = await supabase
        .from('page_templates')
        .delete()
        .eq('project_id', PROJECT_ID)
        .eq('page_type', config.type)
        .eq('template_name', config.name);

      if (deleteError) {
        console.error(`   ❌ Gagal hapus template lama: ${deleteError.message}`);
        continue;
      }

      const { data, error } = await supabase
        .from('page_templates')
        .insert([templateData])
        .select('id, page_type, template_name');

      if (error) {
        console.error(`   ❌ Gagal insert: ${error.message}\n`);
        continue;
      }

      console.log(`   ✅ Berhasil insert: ${data[0].page_type} | ${data[0].template_name} | ${data[0].id}\n`);
    } catch (err) {
      console.error(`   ❌ Error saat memproses ${resolved.fileName}: ${err.message}\n`);
    }
  }

  console.log('🎉 Seeder page_templates selesai!');
}

runSeeder();
