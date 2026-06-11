// src/services/chat/system-response.service.js

function safeParseJson(value, fallback = []) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/log\s*in/g, 'login')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanFeedbackPrompt(message = '') {
  let result = String(message || '').trim();
  const prefix = 'Jawaban sistem sebelumnya belum menyelesaikan masalah saya. Tolong jelaskan lebih detail dan lebih pelan untuk pertanyaan ini:';
  for (let i = 0; i < 10; i += 1) {
    if (!result.toLowerCase().startsWith(prefix.toLowerCase())) break;
    result = result.slice(prefix.length).trim();
  }
  return result || message || '';
}

function getTemplateElements(template = {}) {
  return safeParseJson(template?.elements_json, []);
}

function getTemplateAccessibility(template = {}) {
  return safeParseJson(template?.accessibility_json, []);
}

function getAllTemplateElements(template = {}) {
  return [...getTemplateElements(template), ...getTemplateAccessibility(template)];
}

function isTemplateProbablyFor(template = {}, targets = []) {
  const haystack = normalizeText([
    template?.page_type,
    template?.template_name,
    template?.match_url_contains,
    template?.match_title_contains,
    template?.match_heading_contains
  ].filter(Boolean).join(' '));
  return targets.some((target) => haystack.includes(normalizeText(target)));
}

function getHtmlPool(template = {}) {
  const parts = [template?.html_preview || ''];
  getAllTemplateElements(template).forEach((el) => { if (el?.html) parts.push(el.html); });
  return parts.join('\n');
}

function scoreElements(template = {}, keywords = [], options = {}) {
  const elements = getAllTemplateElements(template);
  const normalizedKeywords = [...new Set(keywords.map(normalizeText).filter(Boolean))];
  const rejectWords = (options.rejectWords || []).map(normalizeText).filter(Boolean);
  const preferWords = (options.preferWords || []).map(normalizeText).filter(Boolean);

  return elements
    .map((el) => {
      const haystack = normalizeText([
        el.key,
        el.name,
        el.type,
        el.title,
        el.text,
        el.selector,
        el.html
      ].filter(Boolean).join(' '));

      let score = 0;
      normalizedKeywords.forEach((keyword) => {
        if (haystack.includes(keyword)) score += 10;
      });
      preferWords.forEach((keyword) => {
        if (haystack.includes(keyword)) score += 8;
      });
      rejectWords.forEach((keyword) => {
        if (haystack.includes(keyword)) score -= 999;
      });

      return { el, score, haystack };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function toVisualAction(el, overrides = {}) {
  if (!el?.html) return null;
  return {
    type: 'inline_visual',
    label: overrides.label || el.title || el.name || 'Visual elemen halaman',
    element_key: overrides.element_key || el.key || '',
    selector: overrides.selector || el.selector || '',
    html: overrides.html || el.html || '',
    text: overrides.text || el.text || '',
    element_type: overrides.element_type || el.type || '',
    after_step: overrides.after_step || null
  };
}

function extractBlockByClass(html = '', className = '') {
  if (!html || !className) return '';
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<div\\b[^>]*class=["'][^"']*${escaped}[^"']*["'][^>]*>[\\s\\S]*?<\\/div>`, 'i');
  return (String(html).match(regex) || [])[0] || '';
}

function extractLoginInputHtml(formHtml = '') {
  const username = extractBlockByClass(formHtml, 'login-form-username');
  const password = extractBlockByClass(formHtml, 'login-form-password');
  if (username || password) return `<div class="login-form">${username}${password}</div>`;
  return formHtml;
}

function extractLoginButtonHtml(formHtml = '') {
  const submit = extractBlockByClass(formHtml, 'login-form-submit');
  if (submit) return `<div class="login-form">${submit}</div>`;
  const button = (String(formHtml).match(/<button\b[\s\S]*?<\/button>/i) || [])[0] || '';
  return button ? `<div class="login-form">${button}</div>` : '';
}

function buildFocusedLoginVisualActions(loginTemplate) {
  if (!loginTemplate || !isTemplateProbablyFor(loginTemplate, ['login', 'landing'])) return [];

  const loginEl = scoreElements(loginTemplate, ['form login utama', 'username', 'password', 'log in', 'login siswa'], {
    rejectWords: ['guest access', 'cookies notice', 'access as a guest', 'login tamu'],
    preferWords: ['username', 'password', 'login-form']
  })[0]?.el;

  if (!loginEl?.html) return [];

  const inputHtml = extractLoginInputHtml(loginEl.html);
  const buttonHtml = extractLoginButtonHtml(loginEl.html);
  const actions = [];

  if (inputHtml) {
    actions.push({
      type: 'inline_visual',
      label: 'Visual langkah 2: kolom username dan password',
      element_key: `${loginEl.key || 'login'}_input_fields`,
      selector: loginEl.selector || '',
      html: inputHtml,
      text: 'Cari bentuk kolom username/email dan password pada halaman login.',
      element_type: 'Focused Visual',
      after_step: 2
    });
  }

  if (buttonHtml) {
    actions.push({
      type: 'inline_visual',
      label: 'Visual langkah 4: tombol Log in',
      element_key: `${loginEl.key || 'login'}_submit_button`,
      selector: loginEl.selector || '',
      html: buttonHtml,
      text: 'Klik tombol ini setelah data login diisi.',
      element_type: 'Focused Visual',
      after_step: 4
    });
  }

  return actions.slice(0, 2);
}

function buildDashboardCourseVisualActions(dashboardTemplate) {
  if (!dashboardTemplate) return [];
  const courseEl = scoreElements(dashboardTemplate, ['informatika', 'enter this course', 'kartu kursus', 'daftar kursus', 'course-card', 'coursename'], {
    rejectWords: ['accessibility', 'skip links', 'abaikan ikhtisar'],
    preferWords: ['informatika', 'enter this course', 'course-card']
  })[0]?.el;

  const action = toVisualAction(courseEl, {
    label: 'Visual langkah 2-3: kartu kursus Informatika',
    text: 'Cari kartu kursus Informatika, lalu klik judul kursus atau tombol Enter this course.',
    after_step: 2
  });
  return action ? [action] : [];
}

function buildCourseMaterialVisualActions(courseTemplate) {
  if (!courseTemplate) return [];
  const materialEl = scoreElements(courseTemplate, ['materi', 'modul', 'pdf', 'dokumen', 'resource', 'aktivitas', 'kisi kisi', 'informatika', 'instancename'], {
    rejectWords: ['accessibility', 'skip links', 'abaikan'],
    preferWords: ['activity', 'activityname', 'instancename', 'modtype_page', 'modtype_resource', 'kisi kisi', 'informatika']
  })[0]?.el;

  const action = toVisualAction(materialEl, {
    label: 'Visual langkah 4: contoh item materi di dalam kursus',
    text: 'Klik judul materi/modul yang diminta guru pada daftar aktivitas kursus.',
    after_step: 4
  });
  return action ? [action] : [];
}

function buildInlineVisualActions({ matchedTemplate, intent = '', keywords = [], limit = 2 }) {
  if (!matchedTemplate) return [];
  const scored = scoreElements(matchedTemplate, keywords, {
    rejectWords: ['guest access', 'cookies notice', 'accessibility', 'skip links', 'abaikan'],
    preferWords: keywords
  });

  const used = new Set();
  const actions = [];
  scored.forEach(({ el }) => {
    const key = el.key || el.selector || el.title || el.name || el.text;
    if (!key || used.has(key)) return;
    used.add(key);
    const action = toVisualAction(el, { label: el.title || el.name || 'Visual elemen halaman' });
    if (action) actions.push(action);
  });
  return actions.slice(0, limit);
}

function buildFeedbackActions(message) {
  const originalQuestion = cleanFeedbackPrompt(message || '');
  return [
    {
      type: 'system_feedback_ok',
      label: 'Sudah menyelesaikan masalah'
    },
    {
      type: 'system_feedback_ai',
      label: 'Belum, jelaskan dengan AI',
      // Simpan pertanyaan asli saja. Jangan simpan prefix panjang agar tidak berulang.
      prompt: originalQuestion
    }
  ];
}

function buildDashboardCourseResponse({ message, pageContext, matchedTemplate, templateMap }) {
  const dashboardTemplate = templateMap?.dashboard || matchedTemplate;
  const pageType = normalizeText(pageContext?.pageType || pageContext?.type || dashboardTemplate?.page_type || '');
  const templateName = dashboardTemplate?.template_name || '';
  const htmlPool = getHtmlPool(dashboardTemplate);
  const hasSearchInput = /searchinput-courses|cari kursus|placeholder=["']cari/i.test(htmlPool);
  const courseEl = scoreElements(dashboardTemplate, ['informatika', 'enter this course', 'kartu kursus', 'course-card', 'coursename'], {
    rejectWords: ['accessibility', 'skip links']
  })[0]?.el;

  let courseName = 'Informatika';
  const courseText = courseEl?.text || '';
  const nameMatch = courseText.match(/Informatika\s+[0-9A-Z]+(?:\s*-\s*[A-Za-z\s.]+)?/i);
  if (nameMatch) courseName = nameMatch[0].replace(/\s+/g, ' ').trim();

  const isDashboard = pageType.includes('dashboard') || pageType.includes('my') || normalizeText(templateName).includes('dashboard') || normalizeText(templateName).includes('kursus');

  let text = '';
  if (isDashboard) {
    text = `Baik, kamu perlu masuk dulu ke kursus **${courseName}** dari dashboard.\n\nLangkah 1:\nLihat bagian **Ikhtisar kursus / Kursus Saya** pada halaman dashboard.`;
    if (hasSearchInput) {
      text += `\n\nLangkah 2:\nKalau ada kolom **Cari**, ketik **Informatika** di kolom pencarian kursus.`;
    } else {
      text += `\n\nLangkah 2:\nCari kartu kursus yang namanya mengandung kata **Informatika**.`;
    }
    text += `\n\nLangkah 3:\nKlik judul kursus **${courseName}** atau tombol **Enter this course**.\n\nLangkah 4:\nSetelah masuk kursus, baru cari bagian **Materi**, **Modul**, **PDF**, atau aktivitas yang diberikan guru.`;
  } else {
    text = `Baik, untuk masuk ke kursus Informatika dari halaman mana pun, ikuti langkah ini:\n\nLangkah 1:\nBuka halaman **Dashboard / Kursus Saya**.\n\nLangkah 2:\nCari kartu kursus yang namanya mengandung kata **Informatika**.\n\nLangkah 3:\nKlik judul kursus Informatika atau tombol **Enter this course**.\n\nLangkah 4:\nSetelah masuk kursus, cari bagian **Materi**, **Modul**, atau aktivitas yang diberikan guru.`;
  }

  const actions = [
    {
      type: 'return_to_source',
      label: 'Buka dashboard / kursus saya',
      pageType: 'dashboard',
      url: 'https://lms.smpn167jakarta.sch.id/my/courses.php'
    },
    ...buildDashboardCourseVisualActions(dashboardTemplate),
    ...buildFeedbackActions(message)
  ];

  return { text, actions, strict: true, allowAiFallback: true };
}

function buildLoginResponse({ message, matchedTemplate, templateMap }) {
  const loginTemplate = templateMap?.login || matchedTemplate;
  const actions = [
    {
      type: 'return_to_source',
      label: 'Buka halaman login',
      pageType: 'login',
      url: 'https://lms.smpn167jakarta.sch.id/login/index.php'
    },
    ...buildFocusedLoginVisualActions(loginTemplate),
    ...buildFeedbackActions(message)
  ];

  const text = `Untuk login ke VClass, ikuti langkah ini:\n\nLangkah 1:\nKlik tombol **Login** atau buka halaman login VClass.\n\nLangkah 2:\nMasukkan **email/username** dan **password** yang diberikan guru atau sekolah.\n\nLangkah 3:\nCek lagi huruf besar-kecil pada username dan password.\n\nLangkah 4:\nKlik tombol **Log in / Login / Masuk**.\n\nCatatan:\nKalau gagal login, kemungkinan username atau password belum tepat. Coba cek kembali penulisannya.`;

  return { text, actions, strict: true, allowAiFallback: true };
}

function buildMaterialResponse({ message, matchedTemplate, templateMap }) {
  const dashboardTemplate = templateMap?.dashboard;
  const courseTemplate = templateMap?.course || matchedTemplate;

  const actions = [
    {
      type: 'return_to_source',
      label: 'Buka dashboard / kursus saya',
      pageType: 'dashboard',
      url: 'https://lms.smpn167jakarta.sch.id/my/courses.php'
    },
    {
      type: 'return_to_source',
      label: 'Buka halaman kursus Informatika',
      pageType: 'course',
      url: 'https://lms.smpn167jakarta.sch.id/course/view.php?id=2'
    },
    ...buildDashboardCourseVisualActions(dashboardTemplate),
    ...buildCourseMaterialVisualActions(courseTemplate),
    ...buildFeedbackActions(message)
  ];

  const text = `Untuk mengakses materi setelah login, ikuti alurnya pelan-pelan:\n\nLangkah 1:\nBuka halaman **Dashboard / Kursus Saya**.\n\nLangkah 2:\nCari dan masuk ke kursus **Informatika**. Biasanya kamu bisa klik judul kursus atau tombol **Enter this course**.\n\nLangkah 3:\nSetelah halaman kursus terbuka, scroll dan perhatikan daftar topik/aktivitas di dalam kursus.\n\nLangkah 4:\nCari judul yang berbentuk **Materi**, **Modul**, **PDF**, **Dokumen**, atau nama aktivitas yang diberikan guru, lalu klik judulnya.\n\nCatatan:\nKalau materinya belum terlihat, scroll dari atas ke bawah karena materi bisa berada di bagian minggu/topik tertentu.`;

  return { text, actions, strict: true, allowAiFallback: true };
}

function buildTaskResponse({ message, matchedTemplate }) {
  const actions = [
    ...buildInlineVisualActions({
      matchedTemplate,
      intent: 'bantuan_tugas',
      keywords: ['tugas', 'assignment', 'upload', 'submit', 'kumpul', 'pengumpulan'],
      limit: 2
    }),
    ...buildFeedbackActions(message)
  ];
  const text = `Untuk melihat atau mengumpulkan tugas, ikuti langkah ini:\n\nLangkah 1:\nMasuk dulu ke kursus yang benar.\n\nLangkah 2:\nCari aktivitas yang bertuliskan **Tugas**, **Assignment**, **Upload**, atau **Pengumpulan**.\n\nLangkah 3:\nKlik judul tugas tersebut.\n\nLangkah 4:\nIkuti instruksi guru, lalu unggah file atau isi jawaban sesuai perintah.`;
  return { text, actions, strict: true, allowAiFallback: true };
}

const systemResponseService = {
  buildSystemResponse({
    message,
    intent,
    moderationResult,
    retrievalResults,
    pageContext,
    elementContext,
    aiUsage,
    matchedTemplate,
    templateMap,
    burnoutCount = 0,
    isErrorFallback = false,
    fallbackType = 'error'
  }) {
    let text = 'Maaf, instruksi spesifik tidak ditemukan dan AI sedang sibuk. Coba tanyakan hal lain.';
    let actions = [];
    let strict = false;
    let allowAiFallback = false;

    if (retrievalResults && retrievalResults.length > 0) {
      const uniqueUrls = new Set();
      retrievalResults.forEach(r => {
        if (r.metadata?.file_url && !uniqueUrls.has(r.metadata.file_url)) {
          uniqueUrls.add(r.metadata.file_url);
          actions.push({
            type: 'open_pdf_viewer',
            label: `Buka ${r.title || 'Materi'}`,
            url: r.metadata.file_url,
            page_number: r.metadata.page_number || r.metadata.page || 1,
            query: message,
            highlight_text: r.metadata.highlight_text || r.content || '',
            chunk_id: r.metadata.chunk_id || null,
            chunk_index: r.metadata.chunk_index || null,
            document_id: r.metadata.document_id || null
          });
        }
      });
    }

    if (moderationResult?.isFlagged) {
      if (['hate_speech', 'profanity'].includes(moderationResult.type)) {
        text = moderationResult.responseMessage || 'Tolong gunakan bahasa yang sopan ya.';
        return { text, actions: [], strict: true, allowAiFallback: false };
      }
      if (moderationResult.type === 'mental_health') {
        intent = 'bantuan_burnout';
      }
    }

    if (intent === 'minta_jawaban_langsung' || intent === 'quiz_answer_request') {
      text = 'Aku tidak bisa memberikan jawaban langsung. Tapi coba baca materi yang berkaitan lalu cocokkan dengan pertanyaannya.';
      if (retrievalResults?.length > 0) text += `\n\nCek bagian: *${retrievalResults[0].title}*`;
      return { text, actions, strict: true, allowAiFallback: false };
    }

    if (intent === 'navigasi_kursus' || intent === 'bantuan_dashboard') {
      return buildDashboardCourseResponse({ message, pageContext, matchedTemplate, templateMap });
    }

    if (intent === 'akses_materi') {
      return buildMaterialResponse({ message, matchedTemplate, templateMap });
    }

    if (intent === 'bantuan_login') {
      return buildLoginResponse({ message, matchedTemplate, templateMap });
    }

    if (intent === 'bantuan_tugas') {
      return buildTaskResponse({ message, matchedTemplate });
    }

    if (intent === 'out_of_context') {
      text = 'Maaf ya, aku hanya difokuskan untuk membantu pembelajaran materi dan penggunaan VClass. Yuk, kita kembali ke topik pelajaran!';
      return { text, actions: [], strict: true, allowAiFallback: false };
    }

    if (intent === 'bantuan_burnout') {
      text = 'Aku paham kamu mulai capek atau kewalahan. Istirahat sebentar dulu ya: minum air putih, tarik napas pelan, lalu lanjutkan sedikit demi sedikit.';
      if (burnoutCount >= 3) {
        text += '\n\nKarena kamu sudah beberapa kali terlihat sangat kesulitan, kamu boleh minta bantuan guru.';
        actions.push({
          type: 'wa_teacher',
          label: 'Hubungi Guru',
          url: 'https://api.whatsapp.com/send/?phone=628989807094&text=Halo%20Instruktur%2C%20saya%20butuh%20bantuan.'
        });
      } else {
        text += `\n\nAku belum akan menampilkan tombol Hubungi Guru dulu. Coba tulis bagian mana yang bikin kamu kesulitan. (${burnoutCount}/3)`;
      }
      return { text, actions, strict: true, allowAiFallback: true };
    }

    if (intent === 'hubungi_guru') {
      text = 'Baik, kalau kamu memang ingin meminta bantuan guru, isi form bantuan berikut dengan singkat dan jelas.';
      actions.push({
        type: 'wa_teacher',
        label: 'Hubungi Guru',
        url: 'https://api.whatsapp.com/send/?phone=628989807094&text=Halo%20Instruktur%2C%20saya%20butuh%20bantuan.'
      });
      return { text, actions, strict: true, allowAiFallback: false };
    }

    if (!aiUsage?.canUseAI || isErrorFallback) {
      let reason = 'sedang cooldown sebentar';
      if (isErrorFallback) {
        if (fallbackType === 'quota') reason = 'telah mencapai batas kuota harian';
        else reason = 'sedang mengalami kendala teknis / jaringan';
      }

      if (retrievalResults?.length > 0) {
        text = `AI ${reason}. Berikut referensi dari database yang mungkin membantu:\n\n`;
        retrievalResults.slice(0, 3).forEach((r) => {
          text += `[ACCORDION=${r.title || 'Materi / FAQ'}]\n${r.content}\n[/ACCORDION]\n`;
        });
      } else {
        text = `AI ${reason}. Maaf, saat ini aku belum menemukan materi spesifik tentang pertanyaanmu di database.`;
      }
      strict = true;
      allowAiFallback = false;
    }

    return { text, actions, strict, allowAiFallback };
  }
};

module.exports = systemResponseService;
