const supabaseService = require('../supabase/supabase.service');
const MASTER_PROJECT_ID = 'c4ec8eba-e342-4c31-b5de-2d4218dcfd86';

function safeParseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value = '') {
  return normalizeText(value).replace(/\s+/g, '');
}

function includesLoose(haystack = '', needle = '') {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  if (!h || !n) return false;

  // Match normal: "login - sistem" includes "login"
  if (h.includes(n)) return true;

  // Match rapat: "login" includes "log in" => true
  const hc = compactText(h);
  const nc = compactText(n);
  if (hc && nc && hc.includes(nc)) return true;

  return false;
}

function keywordFromTemplate(tmpl = {}) {
  return [
    tmpl.page_type,
    tmpl.template_name,
    tmpl.match_url_contains,
    tmpl.match_title_contains,
    tmpl.match_heading_contains
  ].filter(Boolean).join(' ');
}

function getMatchScore(tmpl, pageContext, sourceUrl) {
  const title = pageContext?.title || '';
  const heading = pageContext?.heading || '';
  const pageType = pageContext?.pageType || pageContext?.page_type || '';
  const summary = pageContext?.summary || '';

  let score = 0;
  const reasons = [];

  if (tmpl.match_url_contains && includesLoose(sourceUrl, tmpl.match_url_contains)) {
    score += 100;
    reasons.push('url');
  }

  if (tmpl.match_title_contains && includesLoose(title, tmpl.match_title_contains)) {
    score += 90;
    reasons.push('title');
  }

  if (tmpl.match_heading_contains && includesLoose(heading, tmpl.match_heading_contains)) {
    score += 80;
    reasons.push('heading');
  }

  if (pageType && tmpl.page_type && includesLoose(pageType, tmpl.page_type)) {
    score += 75;
    reasons.push('pageType');
  }

  // Fallback keyword kuat: title "Login - Sistem..." tetap match page_type/template_name "login/Halaman Login"
  if (tmpl.page_type && includesLoose(`${title} ${heading} ${summary}`, tmpl.page_type)) {
    score += 65;
    reasons.push('page_type_keyword');
  }

  // Fallback template_name: "Halaman Login" juga kebaca dari title login.
  // Ini dibuat kecil supaya tidak mengalahkan match_url/title/heading yang eksplisit.
  const templateKeyword = keywordFromTemplate(tmpl);
  if (templateKeyword && includesLoose(`${title} ${heading} ${summary} ${sourceUrl}`, templateKeyword)) {
    score += 15;
    reasons.push('template_keyword');
  }

  return { score, reasons };
}

const pageTemplateService = {
  async importTemplate(projectId, payload) {
    let cleanHtml = String(payload.html_file || '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/value="[^"]*sesskey[^"]*"/gi, 'value="hidden"');

    const templateData = {
      project_id: projectId, // Tetap projectId asli khusus untuk import (opsional)
      page_type: payload.page_type,
      template_name: payload.template_name,
      match_url_contains: payload.match_url_contains || '',
      match_title_contains: payload.match_title_contains || '',
      match_heading_contains: payload.match_heading_contains || '',
      html_preview: cleanHtml,
      elements_json: payload.elements_json || [],
      tutorial_steps_json: payload.tutorial_steps_json || [],
      question_suggestions_json: payload.question_suggestions_json || [],
      is_active: true
    };

    return supabaseService.create('page_templates', templateData);
  },

  async findTemplateByType(projectId, pageType) {
    // BAJAK KE MASTER ID
    const templates = await supabaseService.findAll('page_templates', {
      filters: { project_id: MASTER_PROJECT_ID, page_type: pageType, is_active: true }
    });
    return templates?.[0] || null;
  },

  async findTemplateById(projectId, templateId) {
    // BAJAK KE MASTER ID
    const templates = await supabaseService.findAll('page_templates', {
      filters: { project_id: MASTER_PROJECT_ID, id: templateId, is_active: true }
    });
    return templates?.[0] || null;
  },

  async matchTemplate(projectId, pageContext, sourceUrl) {
    const context = safeParseJson(pageContext, {});

    // BAJAK KE MASTER ID
    const templates = await supabaseService.findAll('page_templates', {
      filters: { project_id: MASTER_PROJECT_ID, is_active: true }
    });

    if (!templates || templates.length === 0) return null;

    let best = null;
    let bestScore = 0;

    for (const tmpl of templates) {
      const { score, reasons } = getMatchScore(tmpl, context, sourceUrl || '');

      if (score > bestScore) {
        best = { ...tmpl, _match_score: score, _match_reasons: reasons };
        bestScore = score;
      }
    }

    return bestScore > 0 ? best : null;
  }
};

module.exports = pageTemplateService;
