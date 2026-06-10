// src/controllers/page-template.controller.js

const pageTemplateService = require('../services/template/page-template.service');
const supabaseService = require('../services/supabase/supabase.service');
const chatModel = require('../models/chat.model');
const response = require('../utils/response');
const asyncHandler = require('../utils/async-handler');

// --- 1. TAMBAHKAN MASTER PROJECT ID DI SINI ---
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

exports.match = asyncHandler(async (req, res) => {
  const { projectKey, sessionId, forceType, templateId } = req.query;

  // --- 2. BAJAK PROJECT ID KE MASTER ---
  // Kita abaikan getProjectIdByKey bawaan
  const projectId = MASTER_PROJECT_ID;

  const session = await chatModel.getSessionById(sessionId);

  if (!session || !projectId) {
    return response.error(res, 'Session/Project invalid', null, 404);
  }

  let matchedTemplate = null;

  if (templateId) {
    matchedTemplate = await pageTemplateService.findTemplateById(projectId, templateId);
  } else if (forceType) {
    matchedTemplate = await pageTemplateService.findTemplateByType(projectId, forceType);
  } else {
    const pageContext = safeParseJson(session.page_context || session.pageContext, {});
    matchedTemplate = await pageTemplateService.matchTemplate(projectId, pageContext, session.source_url);
  }

  if (!matchedTemplate) {
    return response.success(res, 'No template found', null, 200);
  }

  return response.success(res, 'Template matched', matchedTemplate, 200);
});

exports.list = asyncHandler(async (req, res) => {
  const { projectKey, full } = req.query;

  // --- 3. BAJAK PROJECT ID KE MASTER ---
  // Kita abaikan getProjectIdByKey bawaan
  const projectId = MASTER_PROJECT_ID;

  if (!projectId) return response.error(res, 'Project invalid', null, 404);

  const options = {
    filters: { project_id: projectId, is_active: true }
  };

  // Default ringan untuk dropdown. Pakai ?full=1 kalau FE mau langsung apply tanpa panggil /match lagi.
  if (full !== '1') {
    options.select = 'id, page_type, template_name, match_url_contains, match_title_contains, match_heading_contains';
  }

  const templates = await supabaseService.findAll('page_templates', options);

  return response.success(res, 'List retrieved', templates || [], 200);
});


function getRequestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function resolveCssUrl(assetUrl, cssUrl) {
  try {
    return new URL(assetUrl, cssUrl).href;
  } catch (_) {
    return assetUrl;
  }
}

function rewriteCssAssetUrls(cssText, cssUrl, req) {
  const origin = getRequestOrigin(req);
  const proxy = (rawUrl) => {
    const clean = String(rawUrl || '').trim().replace(/^['"]|['"]$/g, '');
    if (!clean || clean.startsWith('data:') || clean.startsWith('blob:') || clean.startsWith('#')) return rawUrl;
    const absolute = resolveCssUrl(clean, cssUrl);
    return `${origin}/page-templates/proxy-asset?url=${encodeURIComponent(absolute)}`;
  };

  return String(cssText || '')
    .replace(/url\(([^)]+)\)/gi, (match, rawUrl) => `url("${proxy(rawUrl)}")`)
    .replace(/@import\s+(?:url\()?['"]?([^'";)]+)['"]?\)?\s*;/gi, (match, importUrl) => {
      return `@import url("${proxy(importUrl)}");`;
    });
}

exports.proxyAsset = asyncHandler(async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();

  if (!rawUrl) return response.error(res, 'URL asset tidak valid', null, 400);

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
  } catch (_) {
    return response.error(res, 'Format URL asset tidak valid', null, 400);
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return response.error(res, 'Protocol asset tidak diizinkan', null, 400);
  }

  // Optional allowlist ringan. Tambahkan domain lain jika template kamu butuh CDN tertentu.
  const allowedHosts = [
    'lms.smpn167jakarta.sch.id',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com'
  ];

  if (!allowedHosts.includes(targetUrl.hostname)) {
    return response.error(res, 'Domain asset tidak diizinkan untuk preview', null, 403);
  }

  const upstream = await fetch(targetUrl.href, {
    headers: {
      'User-Agent': 'AI-Learning-Buddy-Preview/1.0',
      'Accept': req.headers.accept || '*/*'
    }
  });

  if (!upstream.ok) {
    return response.error(res, `Asset gagal diambil (${upstream.status})`, null, upstream.status);
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', contentType);

  const buffer = Buffer.from(await upstream.arrayBuffer());

  // Kalau CSS, rewrite semua url(...) font/gambar agar lewat proxy juga.
  if (contentType.includes('text/css') || targetUrl.pathname.endsWith('.css') || targetUrl.pathname.includes('/styles.php')) {
    const cssText = buffer.toString('utf8');
    res.send(rewriteCssAssetUrls(cssText, targetUrl.href, req));
    return;
  }

  res.send(buffer);
});
