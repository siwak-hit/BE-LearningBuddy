// src/services/chat/system-response.service.js

function safeParseJson(value, fallback = []) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/log\s*in/g, 'login').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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

function getTemplateElements(template = {}) { return safeParseJson(template?.elements_json, []); }
function getTemplateAccessibility(template = {}) { return safeParseJson(template?.accessibility_json, []); }
function getAllTemplateElements(template = {}) { return [...getTemplateElements(template), ...getTemplateAccessibility(template)]; }
function isTemplateProbablyFor(template = {}, targets = []) {
  const haystack = normalizeText([template?.page_type, template?.url_pattern, template?.name].filter(Boolean).join(' '));
  return targets.some(target => haystack.includes(target));
}

function escapeHtml(value = '') {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function normalizeActivityType(value = '') {
  const type = String(value || '').toLowerCase();
  if (type === 'assignment') return 'assign';
  if (['page', 'resource', 'book', 'url', 'folder'].includes(type)) return 'materi';
  return type;
}

function isLearningTaskType(type = '') {
  return ['assign', 'quiz', 'forum', 'materi'].includes(normalizeActivityType(type));
}

function getIntentTargetType(intent = '') {
  const value = String(intent || '');
  if (value.includes('quiz') || value.includes('kuis')) return 'quiz';
  if (value.includes('forum')) return 'forum';
  if (value.includes('tugas') || value.includes('assignment')) return 'assign';
  return '';
}

function getIntentTargetLabel(intent = '') {
  const type = getIntentTargetType(intent);
  if (type === 'assign') return 'tugas';
  if (type === 'quiz') return 'kuis';
  if (type === 'forum') return 'forum';
  return 'aktivitas';
}


function isAnnouncementForum(activity = {}) {
  const type = normalizeActivityType(activity.type || activity.moodle_activity_type || activity.activity_type);
  if (type !== 'forum') return false;
  const title = normalizeText(activity.title || '');
  const forumType = normalizeText(activity.forum_type || '');
  return title === 'pengumuman' || forumType === 'news';
}

function withLinearContext(activity = {}, targetLabel = 'aktivitas') {
  return {
    ...activity,
    linear_context: true,
    linear_context_label: `Prasyarat sebelum ${targetLabel}`
  };
}

function getTypeLabel(activity = {}) {
  const type = normalizeActivityType(activity.type || activity.moodle_activity_type || activity.activity_type);
  if (type === 'assign') return 'Tugas';
  if (type === 'quiz') return 'Kuis';
  if (type === 'forum') return 'Forum';
  if (['page', 'resource', 'book', 'url', 'folder', 'label', 'materi'].includes(type)) return 'Materi';
  return type ? type.toUpperCase() : 'Aktivitas';
}

function getActionLabel(activity = {}) {
  if (isLockedStatus(activity)) return 'Lihat di VClass';
  const label = getTypeLabel(activity);
  if (label === 'Tugas') return 'Kerjakan Sekarang';
  if (label === 'Kuis') return 'Kerjakan Kuis';
  if (label === 'Forum') return 'Jawab Forum';
  if (label === 'Materi') return 'Buka Materi';
  return 'Buka VClass';
}
function isLockedStatus(activity = {}) {
  const status = String(activity.status || '').toLowerCase();
  // Jangan pakai availability_info sebagai indikator tunggal.
  // Pada Moodle linear, availability_info bisa tetap ada sebagai teks syarat,
  // meski syaratnya sudah terpenuhi untuk siswa tersebut. Status final harus
  // mengikuti hasil merge completion di lms-context.service.
  return activity.is_available === false
    || status.includes('terkunci')
    || status.includes('belum terbuka')
    || status.includes('belum bisa dibuka')
    || status.includes('restricted')
    || status.includes('not available');
}
function isSubmittedWaitingGrade(activity = {}) {
  const status = String(activity.status || '').toLowerCase();
  return activity.submitted_not_graded === true
    || status.includes('belum dinilai')
    || status.includes('belum diberi nilai');
}

function isIncompleteStatus(activity = {}) {
  const status = String(activity.status || '').toLowerCase();
  if (isSubmittedWaitingGrade(activity) || activity.is_submitted === true) return false;
  return isLockedStatus(activity) || status.includes('belum') || status.includes('not completed') || status.includes('incomplete') || activity.is_completed === false;
}

function isCompletedStatus(activity = {}) {
  const status = String(activity.status || '').toLowerCase();
  return !isLockedStatus(activity) && (
    status.includes('selesai')
    || status.includes('completed')
    || status.includes('sudah mengerjakan')
    || status.includes('sudah dikumpulkan')
    || status.includes('submitted')
    || activity.is_completed === true
    || activity.is_submitted === true
  );
}

function formatDeadline(deadline) {
  if (!deadline) {
    return '<span class="alb-info-badge inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600 px-2 py-1 text-[11px] font-semibold" title="Aktivitas ini tidak memiliki tanggal deadline yang ditulis secara spesifik di Moodle."><i class="fa-regular fa-clock"></i> Saat ini deadline belum tertulis spesifik</span>';
  }
  try {
    return new Date(deadline).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return escapeHtml(deadline);
  }
}

function dateKeyJakarta(value = new Date()) {
  try {
    return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  } catch (_) {
    return new Date().toISOString().split('T')[0];
  }
}

function deadlineKey(deadline) {
  if (!deadline) return '';
  return dateKeyJakarta(deadline);
}

function statusBadge(activity = {}) {
  if (isLockedStatus(activity)) {
    const info = activity.availability_info ? ` title="${escapeHtml(activity.availability_info)}"` : '';
    return `<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 text-[11px] font-bold"${info}><i class="fa-solid fa-lock"></i> Belum terbuka</span>`;
  }
  if (isSubmittedWaitingGrade(activity)) {
    const label = normalizeActivityType(activity.type || activity.moodle_activity_type || activity.activity_type) === 'quiz'
      ? 'Sudah mengerjakan, belum dinilai'
      : 'Sudah dikumpulkan, belum dinilai';
    return `<span class="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700 px-2 py-1 text-[11px] font-bold"><i class="fa-solid fa-clock-rotate-left"></i> ${label}</span>`;
  }
  if (isCompletedStatus(activity)) {
    return '<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 text-[11px] font-bold"><i class="fa-solid fa-check"></i> Selesai</span>';
  }
  if (isIncompleteStatus(activity)) {
    return '<span class="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 px-2 py-1 text-[11px] font-bold"><i class="fa-solid fa-circle-exclamation"></i> Belum selesai</span>';
  }
  return '<span class="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600 px-2 py-1 text-[11px] font-semibold" title="Status completion belum terbaca dari Moodle."><i class="fa-solid fa-circle-question"></i> Status belum terbaca</span>';
}
function typeBadge(activity = {}) {
  const label = getTypeLabel(activity);
  const type = normalizeActivityType(activity.type || activity.moodle_activity_type || activity.activity_type);
  const classes = type === 'assign' ? 'bg-blue-50 text-blue-700 border-blue-200'
    : type === 'quiz' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : type === 'forum' ? 'bg-violet-50 text-violet-700 border-violet-200'
    : type === 'materi' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-600 border-slate-200';
  return `<span class="inline-flex items-center rounded-full border ${classes} px-2 py-1 text-[10px] font-bold uppercase">${escapeHtml(label)}</span>`;
}

function actionButtons(activity = {}) {
  const locked = isLockedStatus(activity);
  const activityUrl = activity.url || activity.activity_url || '';
  const courseUrl = activity.course_url || activity.action_url || activityUrl || '';
  const rawUrl = locked ? courseUrl : (activityUrl || courseUrl);
  const hasUrl = rawUrl && rawUrl !== '#';
  const url = escapeHtml(hasUrl ? rawUrl : '#');
  const title = escapeHtml(activity.title || 'Aktivitas VClass');
  const label = escapeHtml(getActionLabel(activity));
  const pageType = locked ? 'course' : 'activity';

  if (!hasUrl) {
    return `
      <div class="alb-task-actions" onclick="event.stopPropagation();" style="display:flex;flex-direction:row;align-items:center;gap:6px;flex-wrap:nowrap;">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:7px 11px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#94a3b8;font-size:12px;font-weight:700;white-space:nowrap;">
          <i class="fa-solid fa-link-slash"></i><span>Belum ada link</span>
        </span>
      </div>`;
  }

  return `
    <div class="alb-task-actions" onclick="event.stopPropagation();" style="display:flex;flex-direction:row;align-items:center;gap:6px;flex-wrap:nowrap;">
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="alb-btn-vclass-primary" title="${title}" style="display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 12px;border-radius:8px;border:0;background:#0f172a;color:#ffffff;font-size:12px;font-weight:800;line-height:1.2;white-space:nowrap;cursor:pointer;text-decoration:none;">
        <i class="fa-solid fa-up-right-from-square"></i><span>Lihat di VClass</span>
      </a>
    </div>`;
}

function emptyStateHtml({ title, subtitle, actionUrl = '' }) {
  const safeUrl = escapeHtml(actionUrl || '#');
  return `
    <details class="alb-html-block" open style="background:#fff;border:1px solid #e8ecf0;border-radius:16px;margin-top:14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.05);overflow:hidden;">
      <summary style="display:none;">${escapeHtml(title)}</summary>
      <div style="padding:28px 20px;text-align:center;">
        <div style="width:52px;height:52px;margin:0 auto 14px;border-radius:50%;background:#f8fafc;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:22px;">
          <i class="fa-regular fa-folder-open"></i>
        </div>
        <div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:6px;line-height:1.35;">${escapeHtml(title)}</div>
        <div style="font-size:13px;color:#64748b;max-width:380px;margin:0 auto;line-height:1.6;">${escapeHtml(subtitle)}</div>
        ${actionUrl ? `<div style="margin-top:16px;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;background:#0f172a;color:#fff;border:0;border-radius:999px;padding:9px 18px;font-size:13px;font-weight:800;cursor:pointer;text-decoration:none;"><i class="fa-solid fa-up-right-from-square"></i> Cek Langsung di VClass</a></div>` : ''}
      </div>
    </details>`;
}

function stripTagsForDetail(value = '') {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildActivityDetailModal(act = {}, modalId = '') {
  const title = escapeHtml(act.title || 'Aktivitas');
  const type = escapeHtml(getTypeLabel(act));
  const section = escapeHtml(act.section_name || '-');
  const status = stripTagsForDetail(statusBadge(act));
  const deadline = stripTagsForDetail(formatDeadline(act.deadline));
  const availability = escapeHtml(act.availability_info || 'Tidak ada keterangan prasyarat khusus.');
  const rule = escapeHtml(act.completion_rule || 'Belum ada aturan completion yang terbaca.');

  return `
    <div id="${modalId}" class="alb-mobile-detail-modal" onclick="event.stopPropagation(); if(event.target === this) this.style.display='none';" style="display:none;position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.45);align-items:center;justify-content:center;padding:18px;">
      <div style="width:100%;max-width:360px;background:#fff;border-radius:18px;box-shadow:0 18px 48px rgba(15,23,42,.22);overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">Detail Aktivitas</div>
            <div style="font-size:15px;font-weight:900;color:#0f172a;line-height:1.35;margin-top:2px;">${title}</div>
          </div>
          <button type="button" onclick="event.stopPropagation(); this.closest('.alb-mobile-detail-modal').style.display='none';" style="border:0;background:#f1f5f9;color:#334155;border-radius:999px;width:30px;height:30px;font-weight:900;cursor:pointer;">×</button>
        </div>
        <div style="padding:14px 16px;font-size:12px;color:#334155;line-height:1.55;">
          <div><b>Jenis:</b> ${type}</div>
          <div><b>Bagian:</b> ${section}</div>
          <div><b>Status:</b> ${escapeHtml(status)}</div>
          <div><b>Deadline:</b> ${escapeHtml(deadline)}</div>
          <div style="margin-top:10px;padding:10px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;"><b>Info prasyarat:</b><br>${availability}</div>
          <div style="margin-top:10px;padding:10px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;"><b>Aturan selesai:</b><br>${rule}</div>
        </div>
      </div>
    </div>`;
}

function buildDeadlineOverlay(tableId = '') {
  return `
    <div class="alb-deadline-overlay" data-table-overlay="${tableId}" style="position:absolute;inset:0;background:rgba(255,255,255,.93);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;z-index:5;border-radius:16px;">
      <div style="max-width:400px;width:100%;text-align:center;border:1px solid #dbeafe;background:#fff;border-radius:16px;box-shadow:0 8px 24px rgba(15,23,42,.10);padding:20px 18px;">
        <div style="width:48px;height:48px;margin:0 auto 12px;border-radius:50%;background:#eff6ff;border:1px solid #bfdbfe;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:20px;"><i class="fa-solid fa-calendar-days"></i></div>
        <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:6px;line-height:1.4;">Deadline belum tertulis spesifik di Moodle</div>
        <div style="font-size:12px;color:#64748b;line-height:1.6;margin-bottom:14px;">Instruktur belum menetapkan tanggal deadline. Kamu tetap bisa melihat daftar aktivitas dan mengecek langsung di VClass.</div>
        <button type="button" onclick="event.stopPropagation(); this.closest('.alb-deadline-overlay').style.display='none';" style="display:inline-flex;align-items:center;gap:6px;border:0;background:#0f172a;color:#fff;border-radius:999px;padding:9px 16px;font-size:12px;font-weight:800;cursor:pointer;letter-spacing:.01em;"><i class="fa-solid fa-list"></i> Lihat aktivitas</button>
      </div>
    </div>`;
}

function buildPaginationControls(tableId = '', totalPages = 1, totalRows = 0) {
  const pageSize = 5;
  const showing = Math.min(totalRows, pageSize);

  // [v0.9.27 #3] Tetap render kontrol bila MOBILE butuh paginasi (1/halaman) walau desktop
  // cuma 1 halaman. FE (events.js) yang menyesuaikan max & status tombol per viewport.
  if (totalPages <= 1 && totalRows <= 1) {
    return `<div style="font-size:11px;color:#94a3b8;margin-top:8px;padding:0 2px;">Menampilkan ${showing} dari ${totalRows} aktivitas</div>`;
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding:0 2px;flex-wrap:wrap;gap:6px;">
      <span style="font-size:11px;color:#94a3b8;font-weight:600;" data-page-info="${tableId}">Halaman 1 dari ${totalPages}</span>
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="font-size:11px;color:#94a3b8;">${totalRows} aktivitas</span>
        <button type="button" class="alb-lms-page-btn" data-dir="-1" disabled style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:5px 11px;font-weight:800;cursor:pointer;font-size:14px;color:#475569;line-height:1;transition:background .15s;">‹</button>
        <button type="button" class="alb-lms-page-btn" data-dir="1" style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:5px 11px;font-weight:800;cursor:pointer;font-size:14px;color:#475569;line-height:1;transition:background .15s;">›</button>
      </div>
    </div>`;
}

function buildActivityTable(activities = [], options = {}) {
  const tableId = `alb_lms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const totalRows = activities.length;
  const pageSize = Number(options.pageSize || 5);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  // --- Desktop table rows ---
  const tableRows = activities.map((act, index) => {
    const page = Math.floor(index / pageSize) + 1;
    const modalId = `${tableId}_d_${index}`;
    const hiddenStyle = page > 1 ? 'display:none;' : '';
    return `
    <tr data-alb-page="${page}" style="${hiddenStyle}border-bottom:1px solid #f1f5f9;">
      <td style="padding:12px 14px;vertical-align:top;min-width:220px;max-width:260px;">
        ${act.linear_context ? `<div style="display:inline-flex;align-items:center;gap:4px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;margin-bottom:6px;"><i class="fa-solid fa-route"></i> ${escapeHtml(act.linear_context_label || 'Prasyarat alur')}</div><br>` : ''}
        <div style="font-weight:700;font-size:13px;color:#0f172a;line-height:1.4;margin-bottom:3px;">${escapeHtml(act.title || 'Aktivitas')}</div>
        <div style="font-size:11px;color:#94a3b8;line-height:1.4;">${escapeHtml(act.course_name || act.class_code || '')}${act.section_name ? ` · ${escapeHtml(act.section_name)}` : ''}</div>
        ${isLockedStatus(act) && act.availability_info ? `<div style="font-size:11px;color:#b45309;margin-top:4px;line-height:1.4;"><i class="fa-solid fa-lock" style="margin-right:3px;"></i>${escapeHtml(act.availability_info).slice(0, 120)}</div>` : ''}
        ${buildActivityDetailModal(act, modalId)}
      </td>
      <td style="padding:12px 14px;vertical-align:top;white-space:nowrap;">${typeBadge(act)}</td>
      <td style="padding:12px 14px;vertical-align:top;white-space:nowrap;font-size:12px;${act.deadline ? 'color:#dc2626;font-weight:700;' : 'color:#64748b;'}">${formatDeadline(act.deadline)}</td>
      <td style="padding:12px 14px;vertical-align:top;white-space:nowrap;">${statusBadge(act)}</td>
      <td style="padding:12px 14px;vertical-align:top;">${actionButtons(act)}</td>
    </tr>`;
  }).join('');

  // --- Mobile card rows ---
  // [v0.9.27 #3] Di MOBILE tampilkan 1 card per halaman (paginasi `data-alb-mpage`),
  // beda dari desktop (5/halaman `data-alb-page`).
  const cardRows = activities.map((act, index) => {
    const mpage = index + 1;
    const modalId = `${tableId}_m_${index}`;
    const hiddenStyle = mpage > 1 ? 'display:none;' : '';
    const locked = isLockedStatus(act);
    const activityUrl = act.url || act.activity_url || '';
    const courseUrl = act.course_url || act.action_url || activityUrl || '';
    const rawUrl = locked ? courseUrl : (activityUrl || courseUrl);
    const hasUrl = rawUrl && rawUrl !== '#';
    const url = escapeHtml(hasUrl ? rawUrl : '#');
    const title = escapeHtml(act.title || 'Aktivitas VClass');
    const pageType = locked ? 'course' : 'activity';
    const actionLabel = escapeHtml(getActionLabel(act));
    const deadlineText = act.deadline
      ? formatDeadline(act.deadline).replace(/<[^>]*>/g, '').trim()
      : 'Belum ada deadline';

    return `
    <div data-alb-mpage="${mpage}" style="${hiddenStyle}background:#fff;border:1px solid #e8ecf0;border-radius:16px;margin-bottom:10px;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,.06);">

      <!-- Card header: title + type badge -->
      <div style="padding:14px 14px 0 14px;">
        ${act.linear_context ? `<div style="display:inline-flex;align-items:center;gap:4px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;margin-bottom:8px;"><i class="fa-solid fa-route"></i> ${escapeHtml(act.linear_context_label || 'Prasyarat')}</div><br>` : ''}
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:14px;color:#0f172a;line-height:1.4;word-break:break-word;">${escapeHtml(act.title || 'Aktivitas')}</div>
            ${act.section_name ? `<div style="font-size:11px;color:#94a3b8;margin-top:3px;font-weight:500;">${escapeHtml(act.section_name)}</div>` : ''}
          </div>
          <div style="flex-shrink:0;padding-top:2px;">${typeBadge(act)}</div>
        </div>
      </div>

      <!-- Divider rows: status & deadline -->
      <div style="margin:12px 14px 0 14px;padding:10px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;display:flex;flex-direction:column;gap:7px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;">Status</span>
          ${statusBadge(act)}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;">Deadline</span>
          <span style="font-size:12px;font-weight:${act.deadline ? '700' : '500'};color:${act.deadline ? '#dc2626' : '#94a3b8'};display:inline-flex;align-items:center;gap:4px;text-align:right;">
            ${act.deadline ? '<i class="fa-regular fa-clock"></i>' : ''} ${escapeHtml(deadlineText)}
          </span>
        </div>
      </div>

      <!-- Prerequisite info (only if locked) -->
      ${isLockedStatus(act) && act.availability_info ? `
      <div style="margin:0 14px;padding:9px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;margin-top:10px;font-size:11px;color:#92400e;line-height:1.55;display:flex;align-items:flex-start;gap:6px;">
        <i class="fa-solid fa-lock" style="flex-shrink:0;margin-top:1px;"></i>
        <span>${escapeHtml(act.availability_info).slice(0, 160)}</span>
      </div>` : ''}

      <!-- Action buttons row — [v0.9.27 #3] mobile cukup 2 tombol: Lihat di VClass (tab baru) + info -->
      <div style="padding:12px 14px 14px 14px;display:flex;align-items:center;gap:8px;">
        ${hasUrl ? `
          <a href="${url}" target="_blank" rel="noopener noreferrer" title="${title}"
            style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 14px;border-radius:10px;border:0;background:#0f172a;color:#fff;font-size:13px;font-weight:800;text-decoration:none;min-width:0;">
            <i class="fa-solid fa-up-right-from-square"></i><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Lihat di VClass</span>
          </a>` : `
          <span style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 14px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;color:#94a3b8;font-size:13px;font-weight:600;">
            <i class="fa-solid fa-link-slash"></i> Belum ada link
          </span>`}
        <button type="button" onclick="event.stopPropagation(); var m=document.getElementById('${modalId}'); if(m) m.style.display='flex';"
          style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:15px;cursor:pointer;" title="Lihat detail">
          <i class="fa-solid fa-circle-info"></i>
        </button>
        ${buildActivityDetailModal(act, modalId)}
      </div>
    </div>`;
  }).join('');

  return `
    <details class="alb-html-block alb-lms-render-block" open>
      <summary class="hidden">Daftar aktivitas LMS</summary>
      <style>
        .alb-lms-outer{position:relative;margin-top:14px;margin-bottom:6px;}
        .alb-lms-desktop{display:block;}
        .alb-lms-mobile{display:none;}
        @media (max-width:680px){
          .alb-lms-desktop{display:none!important;}
          .alb-lms-mobile{display:block!important;}
        }
        .alb-lms-th{padding:10px 14px;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;background:#f8fafc;}
        .alb-lms-table tr:hover td{background:#fafbfc;}
      </style>
      <div class="alb-lms-outer" data-alb-lms-table="${tableId}" data-page="1" data-mpage="1" data-total-pages="${totalPages}" data-total-mpages="${totalRows}">

        <!-- Desktop table -->
        <div class="alb-lms-desktop" style="border:1px solid #e8ecf0;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
          <div style="overflow-x:auto;">
            <table class="alb-lms-table" style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;margin:0;">
              <thead>
                <tr style="border-bottom:2px solid #e8ecf0;">
                  <th class="alb-lms-th" style="text-align:left;border-radius:0;">Aktivitas</th>
                  <th class="alb-lms-th" style="text-align:left;">Jenis</th>
                  <th class="alb-lms-th" style="text-align:left;">Deadline</th>
                  <th class="alb-lms-th" style="text-align:left;">Status</th>
                  <th class="alb-lms-th" style="text-align:left;border-radius:0;">Aksi</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>

        <!-- Mobile cards -->
        <div class="alb-lms-mobile">${cardRows}</div>

        ${options.deadlineGate ? buildDeadlineOverlay(tableId) : ''}
        ${buildPaginationControls(tableId, totalPages, totalRows)}
      </div>
    </details>`;
}

function filterByIntent(activities = [], intent, progressAvailable = false) {
  const normalized = (activities || [])
    .filter(Boolean)
    .filter((act) => act.is_visible !== false)
    .sort((a, b) => Number(a.sequence_order || 9999) - Number(b.sequence_order || 9999));

  if (intent === 'cek_aktivitas_course') return normalized;

  if (intent === 'cek_deadline_hari_ini') {
    const today = dateKeyJakarta();
    return normalized
      .filter((act) => act.deadline && deadlineKey(act.deadline) === today)
      .filter((act) => !isCompletedStatus(act))
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  }

  if (intent === 'cek_deadline_terdekat') {
    return normalized
      .filter((act) => act.deadline)
      .filter((act) => !isCompletedStatus(act))
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 10);
  }

  const targetType = getIntentTargetType(intent);
  if (!targetType) return normalized;

  let targetActivities = normalized.filter((act) => {
    const type = normalizeActivityType(act.type || act.moodle_activity_type || act.activity_type);
    if (type !== targetType) return false;
    if (targetType === 'forum' && isAnnouncementForum(act)) return false;
    return true;
  });

  // Untuk menu "belum dikerjakan", sembunyikan yang sudah selesai jika completion tersedia.
  // Modul yang terkunci tetap ditampilkan karena statusnya belum terbuka dan masih relevan.
  if (progressAvailable) {
    targetActivities = targetActivities.filter((act) => !isCompletedStatus(act));
  }

  const byKey = new Map();
  targetActivities.forEach((act) => {
    const key = `${act.course_id || ''}:${act.module_id || ''}:${act.title || ''}:${normalizeActivityType(act.type || act.moodle_activity_type || act.activity_type)}`;
    if (!byKey.has(key)) byKey.set(key, act);
  });

  return Array.from(byKey.values()).slice(0, 50);
}
function getLmsDebugNote(lmsContext = {}) {
  const source = lmsContext.source || 'database';
  const count = (lmsContext.activities || []).length;
  const progress = lmsContext.progress_available ? 'completion aktif' : 'completion belum terbaca';
  return `\n\n<span class="text-[12px] text-muted-soft">Sumber: ${escapeHtml(source)} • ${count} aktivitas terbaca • ${escapeHtml(progress)}</span>`;
}

const systemResponseService = {
  buildSystemResponse({ message, intent, moderationResult, retrievalResults, pageContext, elementContext, aiUsage, matchedTemplate, templateMap, burnoutCount = 0, isErrorFallback = false, fallbackType = 'error', lmsContext = null }) {
    let text = '';
    let actions = [];

    if (moderationResult?.flagged) {
      text = 'Maaf, aku tidak bisa memproses pesan yang mengandung kata-kata kasar atau tidak pantas. Yuk, kita gunakan bahasa yang lebih baik! 😊';
      return { text, actions, strict: true, allowAiFallback: false };
    }

    if (intent === 'bantuan_burnout') {
      if (burnoutCount === 1) text = 'Kamu terlihat lelah atau kesulitan. Jangan dipaksakan ya, istirahat dulu 5-10 menit. Minum air putih atau jalan-jalan sebentar. Belajar pas otak fresh bakal jauh lebih masuk! Semangat! 💪';
      else if (burnoutCount === 2) text = 'Tarik napas panjang... Hembuskan... 🌬️\nMateri ini memang lumayan menantang. Kamu bisa coba ubah cara belajarmu, misalnya baca pelan-pelan sambil catat poin pentingnya. Kalau masih mentok, tanya aku lagi bagian mana yang spesifik bikin kamu bingung.';
      else text = `Kayaknya kamu udah mentok banget nih. Lebih baik kita langsung tanya ke ahlinya aja yuk! Klik tombol Hubungi Guru dulu. Coba tulis bagian mana yang bikin kamu kesulitan. (${burnoutCount}/3)`;
      return { text, actions, strict: true, allowAiFallback: true };
    }

    if (intent === 'hubungi_guru') {
      text = 'Baik, kalau kamu memang ingin meminta bantuan guru, klik tombol berikut untuk menghubungi instruktur/guru via WhatsApp secara langsung.';
      actions.push({ type: 'wa_teacher', label: 'Hubungi Guru', url: 'https://api.whatsapp.com/send/?phone=628989807094&text=Halo%20Instruktur%2C%20saya%20butuh%20bantuan.' });
      return { text, actions, strict: true, allowAiFallback: false };
    }

    const lmsIntents = ['cek_course_saya', 'cek_pengajar_course', 'cek_aktivitas_course', 'cek_tugas_belum_selesai', 'cek_quiz_belum_dikerjakan', 'cek_forum_belum_dijawab', 'cek_deadline_hari_ini', 'cek_deadline_terdekat', 'buka_aktivitas'];

    if (lmsIntents.includes(intent)) {
      if (lmsContext?.error) {
        const title = lmsContext.timeout ? 'Moodle sedang lambat' : 'Data Moodle belum bisa dimuat';
        const subtitle = lmsContext.timeout
          ? 'Request ke Moodle melewati batas waktu. Ini biasanya bukan karena jawaban kamu salah. Coba klik ulang menu/pertanyaan yang tadi. Jika masih timeout sampai 3 kali, coba menu lain dulu atau ulangi beberapa menit lagi.'
          : 'Sistem belum bisa membaca data Moodle saat ini. Coba klik ulang menu/pertanyaan yang tadi, atau cek kembali beberapa saat lagi.';
        text = emptyStateHtml({ title, subtitle });
        return { text, actions, strict: true, allowAiFallback: false };
      }

      if (!lmsContext || !lmsContext.course?.course_name) {
        if (lmsContext && lmsContext.hasConfig) {
          text = emptyStateHtml({ title: 'Kelas atau course belum terdeteksi', subtitle: 'Buka AI dari halaman course VClass atau verifikasi email siswa terlebih dahulu supaya sistem tahu course yang kamu ikuti.' });
        } else {
          text = emptyStateHtml({ title: 'Konfigurasi Moodle belum tersedia', subtitle: 'Instruktur perlu memasukkan endpoint dan token Moodle dari dashboard terlebih dahulu.' });
        }
        return { text, actions, strict: true, allowAiFallback: false };
      }

      const courses = Array.isArray(lmsContext.courses) && lmsContext.courses.length ? lmsContext.courses : [lmsContext.course];
      const studentName = lmsContext.student?.name || 'Siswa';
      const verified = lmsContext.student?.moodle_user_id ? 'terverifikasi dari Moodle' : 'belum terverifikasi';

      if (intent === 'cek_course_saya') {
        const courseList = courses.map((course) => `- **${course.class_code || '-'}**: ${course.course_name || course.course_title || 'Course'}${course.course_url ? `\n  ${course.course_url}` : ''}`).join('\n');
        text = `Identitas sesi: **${studentName}** (${verified}).\n\nCourse yang terdeteksi:\n${courseList}`;
        if (lmsContext.course.course_url) actions.push({ type: 'navigate', label: 'Buka Course Utama', url: lmsContext.course.course_url });
        return { text, actions, strict: true, allowAiFallback: false };
      }

      if (intent === 'cek_pengajar_course') {
        const teachers = courses.map((course) => `- ${course.course_name || course.course_title || 'Course'}: **${course.teacher_name || 'Belum tercatat'}**`).join('\n');
        text = `Berikut data pengajar yang tercatat:\n${teachers}`;
        return { text, actions, strict: true, allowAiFallback: false };
      }

      if (intent === 'buka_aktivitas') {
        const keyword = String(message || '').replace(/(buka|tampilkan|lihat|dong|tolong)/gi, '').trim().toLowerCase();
        const match = (lmsContext.activities || []).find(a => String(a.title || '').toLowerCase().includes(keyword));
        if (match) {
          text = `Ini dia aktivitas **${match.title}** yang kamu cari.\n${buildActivityTable([match])}`;
        } else {
          text = emptyStateHtml({ title: 'Aktivitas tidak ditemukan', subtitle: `Aku belum menemukan aktivitas yang cocok dengan kata kunci "${keyword}" di course yang terdeteksi.`, actionUrl: lmsContext.course.course_url });
        }
        return { text, actions, strict: true, allowAiFallback: false };
      }

      let tableActivities = filterByIntent(lmsContext.activities || [], intent, Boolean(lmsContext.progress_available));
      let deadlineGate = false;
      if ((intent === 'cek_deadline_hari_ini' || intent === 'cek_deadline_terdekat') && tableActivities.length === 0) {
        tableActivities = (lmsContext.activities || [])
          .filter((act) => act.is_visible !== false)
          .filter((act) => isLearningTaskType(act.type || act.moodle_activity_type || act.activity_type))
          .filter((act) => !isCompletedStatus(act))
          .sort((a, b) => Number(a.sequence_order || 9999) - Number(b.sequence_order || 9999))
          .slice(0, 50);
        deadlineGate = tableActivities.length > 0;
      }
      let prefixMessage = '';

      if (intent === 'cek_aktivitas_course') {
        prefixMessage = `Berikut aktivitas yang tercatat untuk course kamu${courses.length > 1 ? ' di beberapa kelas/course' : `: **${lmsContext.course.course_name}**`}.`;
      } else if (intent === 'cek_deadline_hari_ini') {
        prefixMessage = deadlineGate ? 'Saat ini deadline belum tertulis secara spesifik di Moodle. Aku tetap tampilkan aktivitas yang masih perlu dicek.' : (tableActivities.length ? 'Berikut deadline yang tercatat untuk hari ini.' : '');
      } else if (intent === 'cek_deadline_terdekat') {
        prefixMessage = deadlineGate ? 'Saat ini deadline belum tertulis secara spesifik di Moodle. Aku tetap tampilkan aktivitas yang masih perlu dicek.' : (tableActivities.length ? 'Berikut deadline terdekat yang tercatat.' : '');
      } else {
        const typeName = intent.includes('quiz') ? 'kuis' : intent.includes('forum') ? 'forum' : 'tugas';
        prefixMessage = lmsContext.progress_available
          ? `Berikut daftar ${typeName} yang **belum selesai atau belum terbuka** di course ini. Modul yang belum terbuka tetap ditampilkan agar kamu tahu urutan yang harus diselesaikan.`
          : `Status completion siswa belum sepenuhnya terbaca. Aku tampilkan ${typeName} yang tercatat dari course Moodle.`;
      }

      if (tableActivities.length > 0) {
        let conclusion = '';
        if (intent.includes('deadline')) {
          const nearest = tableActivities.filter(a => a.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
          if (nearest) conclusion = `\n\n**Kesimpulan:** deadline paling dekat adalah **${nearest.title}** (${formatDeadline(nearest.deadline).replace(/<[^>]*>/g, '')}).`;
        }
        text = `${prefixMessage}\n${buildActivityTable(tableActivities, { deadlineGate })}${conclusion}`;
      } else {
        const courseUrl = lmsContext.course?.course_url || courses[0]?.course_url || '';
        if (intent === 'cek_deadline_hari_ini') {
          text = emptyStateHtml({
            title: 'Tidak ada deadline hari ini',
            subtitle: `Sistem tidak menemukan deadline yang jatuh hari ini pada course ${lmsContext.course?.course_name || 'yang terdeteksi'}.`,
            actionUrl: courseUrl
          });
        } else if (intent === 'cek_deadline_terdekat') {
          text = emptyStateHtml({
            title: 'Belum ada deadline mendatang',
            subtitle: `Sistem belum menemukan deadline mendatang pada course ${lmsContext.course?.course_name || 'yang terdeteksi'}.`,
            actionUrl: courseUrl
          });
        } else {
          const hasAnyActivityInCourse = (lmsContext.activities || []).length > 0;
          if (intent === 'cek_tugas_belum_selesai') {
            const subtitle = hasAnyActivityInCourse
              ? (lmsContext.progress_available
                ? `Semua aktivitas yang terbaca pada course ${lmsContext.course?.course_name || 'ini'} sudah selesai. Jika di VClass masih terkunci, biasanya syarat penyelesaian materi/forum sebelumnya belum terpenuhi atau completion belum sinkron.`
                : `Aktivitas course terbaca, tetapi status completion siswa belum tersedia dari Moodle. Silakan cek urutan aktivitas di VClass.`)
              : `Untuk sekarang belum ada aktivitas yang bisa kamu akses di kelas ${lmsContext.course?.course_name || 'ini'}. Mungkin gurumu belum membukanya (pengaturan di VClass), atau memang sedang tidak ada. Santai, coba cek lagi nanti ya 🙂`;
            text = emptyStateHtml({ title: hasAnyActivityInCourse ? 'Tidak ada tugas belum selesai' : 'Tugas tidak ditemukan', subtitle, actionUrl: courseUrl });
          } else {
            const typeName = intent.includes('quiz') ? 'kuis' : intent.includes('forum') ? 'forum' : 'tugas';
            const typeTitle = typeName.charAt(0).toUpperCase() + typeName.slice(1);
            const hasTargetActivity = (lmsContext.activities || []).some((act) => normalizeActivityType(act.type || act.moodle_activity_type || act.activity_type) === getIntentTargetType(intent));
            const pendingLinear = (lmsContext.activities || [])
              .filter((act) => isLearningTaskType(act.type || act.moodle_activity_type || act.activity_type))
              .filter((act) => !isCompletedStatus(act))
              .slice(0, 3);

            const subtitle = hasAnyActivityInCourse
              ? (hasTargetActivity
                ? `Semua ${typeName} yang terbaca pada course ${lmsContext.course?.course_name || 'ini'} sudah selesai.`
                : `Untuk sekarang belum ada ${typeName} yang bisa kamu akses di kelas ${lmsContext.course?.course_name || 'ini'}. Mungkin belum dibuka gurumu (pengaturan di VClass) atau memang belum ada. Coba cek lagi nanti ya 🙂`)
              : `Untuk sekarang belum ada aktivitas yang bisa kamu akses di kelas ${lmsContext.course?.course_name || 'ini'}. Mungkin gurumu belum membukanya (pengaturan di VClass), atau memang sedang tidak ada. Santai, coba cek lagi nanti ya 🙂`;
            text = emptyStateHtml({ title: hasTargetActivity ? `${typeTitle} sudah selesai` : `${typeTitle} tidak ditemukan`, subtitle, actionUrl: courseUrl });
          }
        }
      }

      return { text, actions, strict: true, allowAiFallback: false };
    }

    if (!aiUsage?.canUseAI || isErrorFallback) {
      let reason = 'sedang cooldown sebentar';
      if (isErrorFallback) reason = fallbackType === 'quota' ? 'telah mencapai batas kuota harian' : 'sedang mengalami kendala teknis / jaringan';
      if (retrievalResults?.length > 0) {
        text = `AI ${reason}. Berikut referensi dari database yang mungkin membantu:\n\n`;
        retrievalResults.slice(0, 3).forEach((r) => { text += `[ACCORDION=${r.title || 'Materi / FAQ'}]\n${r.content}\n[/ACCORDION]\n`; });
      } else text = `AI ${reason}. Maaf, saat ini aku belum bisa memberikan jawaban panjang. Coba lagi dalam beberapa saat ya!

Kalau ini muncul setelah loading lama, kamu bisa klik ulang menu/pertanyaan yang tadi. Jika masih gagal beberapa kali, coba tanya menu lain dulu karena kemungkinan Moodle/server sedang lambat.`;
      return { text, actions, strict: true, allowAiFallback: false };
    }

    return { text: null, actions: [], strict: false, allowAiFallback: true };
  }
};

module.exports = systemResponseService;
