function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
}

function createStyle(config) {
    var theme = normalizeTheme(config.theme);
    var primaryColor = theme.primaryColor || '#0c0a09';
    var primaryHover = theme.primaryHover || '#292524';
    var buttonTextColor = theme.buttonTextColor || '#ffffff';

    var oldStyle = document.getElementById('ai-learning-buddy-style');
    if (oldStyle) oldStyle.remove();

    var style = document.createElement('style');
    style.id = 'ai-learning-buddy-style';
    style.innerHTML = `
      #ai-learning-buddy-widget { font-family: Inter, Arial, sans-serif; z-index: 999999; color: ${primaryColor}; }
      .alb-overlay { position: fixed; inset: 0; background: rgba(12,10,9,.4); backdrop-filter: blur(2px); z-index: 999998; opacity: 0; pointer-events: none; transition: opacity .25s ease; }
      .alb-overlay.alb-active { opacity: 1; pointer-events: auto; }
      .alb-floating { position: fixed; right: 24px; bottom: 24px; z-index: 999999; }
      .alb-button { display: inline-block; margin: 10px 0; }
      .alb-bubble-btn, .alb-open-btn, .alb-chat-send, .alb-tutorial-next-btn { border: 0; background: ${primaryColor}; color: ${buttonTextColor}; cursor: pointer; }
      .alb-bubble-btn, .alb-open-btn { border-radius: 999px; padding: 12px 20px; font-size: 15px; font-weight: 600; display: flex; gap: 8px; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.12); }
      .alb-bubble-btn:hover, .alb-open-btn:hover, .alb-chat-send:hover, .alb-tutorial-next-btn:hover { background: ${primaryHover}; }
      .alb-btn-hidden { display: none !important; }
      .alb-chat-box { position: fixed; right: 24px; bottom: 24px; width: 360px; height: 520px; background: #fff; border: 1px solid #e7e5e4; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,.14); display: flex; flex-direction: column; z-index: 999999; transition: all .25s ease; transform-origin: bottom right; }
      .alb-chat-hidden { opacity: 0; pointer-events: none; transform: translateY(20px) scale(.96); }
      @media (max-width:640px) { .alb-chat-box { right: 0; bottom: 0; width: 100%; height: 85vh; border-radius: 24px 24px 0 0; } .alb-chat-hidden { transform: translateY(100%); } }
      .alb-chat-inline { position: relative !important; right: auto !important; bottom: auto !important; width: 100% !important; height: 520px !important; opacity: 1 !important; pointer-events: auto !important; transform: none !important; }
      .alb-inline { width: 100%; max-width: 420px; margin: 16px 0; }
      .alb-chat-header { padding: 16px; border-bottom: 1px solid #e7e5e4; display: flex; justify-content: space-between; gap: 12px; background: #fff; }
      .alb-chat-title { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; color: ${primaryColor}; }
      .alb-chat-subtitle { margin: 4px 0 0; font-size: 14px; color: #777169; }
      .alb-header-actions { display: flex; gap: 8px; align-items: flex-start; }
      .alb-action-icon-btn { background: transparent; border: 0; color: #a8a29e; font-size: 18px; cursor: pointer; }
      .alb-action-icon-btn:hover { color: ${primaryColor}; }
      .alb-usage-indicator { display: inline-flex; gap: 4px; margin-top: 6px; padding: 4px 8px; border-radius: 4px; background: #f0efed; color: #777169; font-size: 11px; }
      .alb-usage-indicator.cooldown { background: #fee2e2; color: #b91c1c; }
      .alb-chat-body { flex: 1; padding: 20px; overflow-y: auto; font-size: 14.5px; background: #f5f5f5; color: #4e4e4e; position: relative; }
      .alb-message { margin-bottom: 12px; padding: 12px 16px; border-radius: 12px; line-height: 1.5; word-wrap: break-word; }
      .alb-message.bot { background: #fff; border: 1px solid #e7e5e4; color: #0c0a09; }
      .alb-message.user { background: #f0efed; color: #0c0a09; text-align: right; border-bottom-right-radius: 4px; margin-left: auto; width: fit-content; max-width: 85%; }
      .alb-msg-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-bottom: 6px; font-weight: 700; text-transform: uppercase; }
      .alb-msg-badge.ai { background: #e0f2fe; color: #0284c7; }
      .alb-msg-badge.system { background: #f3f4f6; color: #4b5563; }
      .alb-msg-badge.warning { background: #fee2e2; color: #b91c1c; }
      .alb-msg-context-badge, .alb-context-badge { display: inline-flex; align-items: center; gap: 4px; background: #e0f2fe; color: #0284c7; font-size: 11px; padding: 3px 8px; border-radius: 6px; font-weight: 700; border: 1px solid #bae6fd; }
      .alb-chat-input-wrapper { background: #fff; border-top: 1px solid #e7e5e4; }
      #alb-context-container { padding: 12px 16px 0; display: flex; align-items: center; gap: 6px; }
      .alb-context-hidden { display: none !important; }
      #alb-context-clear { background: transparent; border: 0; color: #94a3b8; cursor: pointer; }
      .alb-chat-input-area { display: flex; padding: 16px; gap: 8px; align-items: center; }
      .alb-magic-cursor-btn { background: transparent; border: 0; color: #a8a29e; cursor: pointer; font-size: 20px; padding: 0 4px; }
      .alb-magic-cursor-btn.active { color: #3b82f6; }
      .alb-chat-input { flex: 1; background: #fff; border: 1px solid #d6d3d1; border-radius: 8px; padding: 12px 16px; font-size: 15px; outline: none; }
      .alb-chat-input:focus { border-color: ${primaryColor}; }
      .alb-chat-send { height: 44px; border-radius: 999px; padding: 0 20px; font-weight: 600; }
      .alb-chat-send:disabled, .alb-chat-input:disabled, .alb-magic-cursor-btn:disabled { opacity: .5; cursor: not-allowed; }
      .alb-instruction-capsule { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; border-radius: 999px; z-index: 9999999; display: flex; gap: 10px; align-items: center; box-shadow: 0 12px 32px rgba(0,0,0,.25); pointer-events: none; max-width: 90vw; }
      .alb-capsule-hidden, .alb-capsule-fade { opacity: 0; transform: translateX(-50%) translateY(-24px); }
      .alb-element-highlight { outline: 3px dashed ${primaryColor} !important; outline-offset: 2px !important; background-color: rgba(59,130,246,.15) !important; cursor: crosshair !important; border-radius: 4px !important; }
      .alb-tutorial-container { position: absolute; inset: 0; background: #fff; z-index: 3; display: flex; flex-direction: column; border-radius: 16px; }
      .alb-tutorial-hidden { display: none !important; }
      .alb-tutorial-header { padding: 16px 20px 4px; text-align: right; }
      .alb-skip-btn { background: transparent; border: 0; color: #a8a29e; cursor: pointer; font-size: 13px; }
      .alb-slides-wrapper { flex: 1; position: relative; overflow: hidden; }
      .alb-slide { position: absolute; inset: 0; padding: 0 32px 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; opacity: 0; pointer-events: none; transition: opacity .25s ease; }
      .alb-slide-active { opacity: 1; pointer-events: auto; }
      .alb-slide-title { font-family: Georgia, 'Times New Roman', serif; font-size: 20px; margin: 0 0 10px; color: ${primaryColor}; }
      .alb-slide-desc { font-size: 13.5px; color: #6b6661; margin: 0; line-height: 1.5; }
      .alb-anim-box { width: 160px; height: 90px; background: #fafaf9; border: 1px solid #f5f5f4; border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
      .alb-tutorial-footer { padding: 16px 24px 24px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #f5f5f4; }
      .alb-dot-container { display: flex; gap: 6px; }
      .alb-tutorial-dot { width: 7px; height: 7px; background: #e7e5e4; border-radius: 999px; transition: all .2s; }
      .alb-dot-active { background: ${primaryColor}; width: 18px; }
      .alb-tutorial-next-btn { padding: 9px 18px; border-radius: 8px; font-size: 13.5px; }
      .alb-lock-overlay { position:absolute; inset:0; background:rgba(255,255,255,.95); z-index:10; display:none; flex-direction:column; justify-content:center; align-items:center; padding:24px; text-align:center; backdrop-filter:blur(4px); }
      .alb-lock-overlay.active { display:flex; }
      .alb-lock-overlay i { font-size:40px; color:#ef4444; margin-bottom:16px; }
      .alb-lock-input { margin-top:16px; padding:8px 12px; border:1px solid #ef4444; border-radius:6px; width:100%; text-align:center; outline:none; }
      .alb-lock-btn { margin-top:8px; background:#ef4444; color:#fff; border:0; padding:8px; border-radius:6px; width:100%; cursor:pointer; font-weight:600; }
      .alb-typing { display:flex; gap:4px; align-items:center; height:20px; }
      .alb-dot { width:6px; height:6px; background:#a8a29e; border-radius:50%; animation: alb-bounce 1.4s infinite ease-in-out both; }
      .alb-dot:nth-child(1) { animation-delay: -.32s; } .alb-dot:nth-child(2) { animation-delay: -.16s; }
      @keyframes alb-bounce { 0%,80%,100% { transform: scale(0); } 40% { transform: scale(1); } }
      .alb-toast { position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#0c0a09; color:#fff; padding:10px 20px; border-radius:8px; font-size:13px; z-index:9999999; opacity:0; transition:opacity .3s; pointer-events:none; }
      .alb-toast.show { opacity:1; }
      .alb-disclaimer { text-align:center; font-size:11px; color:#a8a29e; margin:16px 0; }
      .alb-action-btn { display:inline-block; margin-top:8px; margin-right:6px; padding:6px 12px; background:#f0efed; border:1px solid #d6d3d1; border-radius:6px; font-size:12px; cursor:pointer; color:#0c0a09; text-decoration:none; }
      #alb-suggestions { display:flex; gap:6px; flex-wrap:wrap; padding:0 16px 10px; }
      .alb-suggestion-chip { background:#f0efed; border:1px solid #d6d3d1; padding:4px 12px; border-radius:16px; font-size:12px; cursor:pointer; color:#0c0a09; }

      .alb-network-banner { position: absolute; top: 0; left: 0; right: 0; padding: 6px 12px; font-size: 11px; font-weight: 600; text-align: center; color: #fff; z-index: 10; transition: transform 0.3s ease; transform: translateY(0); }
      .alb-network-banner.offline { background: #ef4444; } /* Merah */
      .alb-network-banner.slow { background: #f59e0b; } /* Kuning/Orange */
      .alb-network-hidden { transform: translateY(-100%); }

      /* Agar tombol hapus chat terlihat mati saat didisable */
      .alb-action-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

      /* TAHAP PDF: Animasi Drawer Slider */
      .alb-pdf-drawer { position: fixed; top: 0; right: -100%; width: 450px; height: 100vh; background: #fff; z-index: 9999999; transition: right 0.3s ease-in-out; box-shadow: -4px 0 24px rgba(0,0,0,0.15); display: flex; flex-direction: column; }
      .alb-pdf-drawer.open { right: 0; }
      .alb-pdf-header { padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb; }
      .alb-pdf-title { font-weight: 600; font-size: 15px; color: #111827; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%; }
      .alb-pdf-close { background: transparent; border: none; color: #6b7280; font-size: 20px; cursor: pointer; }
      .alb-pdf-iframe { flex: 1; width: 100%; border: none; background: #f3f4f6; }

      /* TAHAP PDF: Responsif Mobile (Muncul dari bawah ke atas) */
      @media (max-width: 640px) {
        .alb-pdf-drawer { width: 100%; right: 0; top: 100%; height: 90vh; transition: top 0.3s ease-in-out; border-radius: 24px 24px 0 0; }
        .alb-pdf-drawer.open { top: 10vh; right: 0; }
      }

      /* TAHAP ACCORDION */
      .alb-accordion { background: #fff; border: 1px solid #d6d3d1; border-radius: 8px; margin: 8px 0; overflow: hidden; }
      .alb-accordion-summary { padding: 10px 14px; font-weight: 600; cursor: pointer; background: #f0efed; display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #0c0a09; list-style: none; }
      .alb-accordion-summary::-webkit-details-marker { display: none; }
      .alb-accordion-content { padding: 12px 14px; font-size: 13px; color: #4e4e4e; border-top: 1px solid #d6d3d1; background: #fff; line-height: 1.5; }
      details.alb-accordion[open] .alb-accordion-summary i { transform: rotate(180deg); }
    `;
    document.head.appendChild(style);
}

function normalizeTheme(theme) {
    if (typeof theme === 'string') {
      try { return JSON.parse(theme); } catch (e) { return {}; }
    }
    return theme || {};
}

function showToast(message, isError) {
    var toast = document.createElement('div');
    toast.className = 'alb-toast';
    toast.style.background = isError ? '#ef4444' : '#0c0a09';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 10);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
}

function formatResponseText(text) {
  // 1. Amankan sintaks accordion sebelum diproses Markdown
  var accordions = [];
  var parsedText = text || '';

  parsedText = parsedText.replace(/\[ACCORDION=(.*?)\]([\s\S]*?)\[\/ACCORDION\]/g, function(match, title, content) {
    accordions.push({ title: title, content: content.trim() });
    return '___ACCORDION_' + (accordions.length - 1) + '___';
  });

  // 2. Format standar (Escape HTML, Bold, dan Lists)
  var safeText = escapeHtml(parsedText).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  var lines = safeText.split('\n');
  var html = '';
  var inUl = false;
  var inOl = false;

  lines.forEach(function (line) {
    if (/^-\s+(.*)/.test(line)) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul style="margin:8px 0;padding-left:20px;">'; inUl = true; }
      html += '<li>' + line.replace(/^-\s+/, '') + '</li>';
      return;
    }

    if (/^\d+\.\s+(.*)/.test(line)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol style="margin:8px 0;padding-left:20px;">'; inOl = true; }
      html += '<li>' + line.replace(/^\d+\.\s+/, '') + '</li>';
      return;
    }

    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
    html += line ? line + '<br/>' : '<br/>';
  });

  if (inUl) html += '</ul>';
  if (inOl) html += '</ol>';

  // 3. Kembalikan Accordion ke dalam wujud HTML interaktif
  accordions.forEach(function(acc, idx) {
    var safeTitle = escapeHtml(acc.title);

    // Parse huruf tebal dan baris baru di dalam isi accordion
    var safeContent = escapeHtml(acc.content)
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\n/g, '<br/>');

    // Trik: Jika ini adalah accordion pertama (idx === 0), tambahkan atribut 'open'
    var openAttribute = (idx === 0) ? 'open' : '';

    var accHtml = '<details class="alb-accordion" ' + openAttribute + '>' +
                    '<summary class="alb-accordion-summary">' + safeTitle + ' <i class="fa-solid fa-chevron-down" style="transition: transform 0.2s; font-size: 11px;"></i></summary>' +
                    '<div class="alb-accordion-content">' + safeContent + '</div>' +
                  '</details>';

    // Tukar placeholder dengan HTML asli
    html = html.replace('___ACCORDION_' + idx + '___<br/>', accHtml).replace('___ACCORDION_' + idx + '___', accHtml);
  });

  return html;
}

  var isOffline = !navigator.onLine; // Cek status awal saat load
  var slowNetworkTimer = null;

function updateNetworkUI(status, message) {
    var banner = document.getElementById('alb-network-status');
    var clearBtn = document.getElementById('alb-clear-btn');

    if (!banner) return;

    if (status === 'offline') {
      banner.textContent = message || 'Sedang Offline. Menunggu koneksi...';
      banner.className = 'alb-network-banner offline';

      // Matikan semua interaksi
      setInputDisabled(true);
      if (clearBtn) clearBtn.disabled = true;

    } else if (status === 'slow') {
      banner.textContent = message || 'Koneksi lambat, memproses balasan...';
      banner.className = 'alb-network-banner slow';

      // Input sudah mati karena isRequesting = true, pastikan tombol hapus juga mati
      if (clearBtn) clearBtn.disabled = true;

    } else {
      // Kembali Online / Normal
      banner.className = 'alb-network-banner alb-network-hidden';
      if (clearBtn) clearBtn.disabled = false;

      // Hanya hidupkan input jika tidak sedang memproses chat dan tidak dikunci SARA
      if (!isRequesting && !isLocked && !usageData.cooldown_active) {
        setInputDisabled(false);
      }
    }
}

function setInputDisabled(disabled) {
    var forceDisable = disabled || isLocked;
    if (inputNode) inputNode.disabled = forceDisable;
    if (sendBtnNode) sendBtnNode.disabled = forceDisable;
    if (magicBtnNode) magicBtnNode.disabled = forceDisable;
    if (contextClearNode) contextClearNode.disabled = forceDisable;

    if (!inputNode) return;
    if (isLocked) inputNode.placeholder = 'Akses chat dikunci...';
    else if (usageData.cooldown_active) inputNode.placeholder = 'AI sedang cooldown...';
    else inputNode.placeholder = 'Tanya sesuatu...';
}

function handleLockdownState(locked) {
    isLocked = locked;
    var lockScreen = document.getElementById('alb-lock-screen');

    if (locked) {
      sessionStorage.setItem(lockCacheKey, 'true');
      if (lockScreen) lockScreen.classList.add('active');
      setInputDisabled(true);

      if (bodyNode) {
        Array.from(bodyNode.children).forEach(function (child) {
          if (child.id !== 'alb-lock-screen') child.remove();
        });
      }
      return;
    }

    sessionStorage.removeItem(lockCacheKey);
    if (lockScreen) lockScreen.classList.remove('active');
    setInputDisabled(false);
}

function updateUsageUI() {
    if (!usageNode) return;
    usageData = usageData || { used: 0, max: 3, cooldown_active: false };

    if (usageData.cooldown_active && usageData.cooldown_remaining_seconds > 0) {
      var m = Math.floor(usageData.cooldown_remaining_seconds / 60);
      var s = usageData.cooldown_remaining_seconds % 60;
      var timeStr = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      usageNode.innerHTML = '<i class="fa-solid fa-clock"></i> AI Cooldown: ' + timeStr;
      usageNode.classList.add('cooldown');
      if (!isLocked) setInputDisabled(true);
      return;
    }

    var currentUsed = typeof usageData === 'number'
      ? usageData
      : usageData.used ?? usageData.count ?? usageData.usage_count ?? 0;
    var maxLimit = typeof usageData === 'number'
      ? 3
      : usageData.max ?? usageData.limit ?? 3;

    usageNode.innerHTML = '<i class="fa-solid fa-bolt"></i> AI Usage: ' + currentUsed + '/' + maxLimit;
    usageNode.classList.remove('cooldown');
    if (!isLocked) setInputDisabled(false);
}

function startCooldownTimer() {
    clearInterval(cooldownInterval);
    if (!usageData.cooldown_active || usageData.cooldown_remaining_seconds <= 0) return;

    cooldownInterval = setInterval(function () {
      usageData.cooldown_remaining_seconds--;
      updateUsageUI();

      if (usageData.cooldown_remaining_seconds <= 0) {
        clearInterval(cooldownInterval);
        usageData.cooldown_active = false;
        usageData.used = 0;
        updateUsageUI();
        if (!isLocked) appendDisclaimer('✅ Anda sudah bisa bertanya dengan AI lagi.');
      }
    }, 1000);
}

function appendDisclaimer(text) {
    if (!bodyNode) return;
    var disc = document.createElement('div');
    disc.className = 'alb-disclaimer';
    disc.textContent = text;
    bodyNode.appendChild(disc);
    bodyNode.scrollTop = bodyNode.scrollHeight;
}

function appendSystemError(message) {
    if (!bodyNode) return;
    var errMessage = document.createElement('div');
    errMessage.className = 'alb-message bot';
    errMessage.textContent = message || 'Maaf, terjadi kesalahan. Coba lagi sebentar.';
    bodyNode.appendChild(errMessage);
    bodyNode.scrollTop = bodyNode.scrollHeight;
}

function appendUserMessage(value) {
    var userMessage = document.createElement('div');
    userMessage.className = 'alb-message user';

    if (activeElementContext) {
      userMessage.innerHTML = `
        <div class="alb-msg-context-badge">
          <i class="fa-solid fa-tag" style="font-size:9px;"></i> ${escapeHtml(activeElementContext.name)}
        </div>
        <div style="margin-top:2px;">${escapeHtml(value)}</div>
      `;
    } else {
      userMessage.textContent = value;
    }

    bodyNode.appendChild(userMessage);
    messageCount++;
}

function appendTypingBubble() {
    var typingBubble = document.createElement('div');
    typingBubble.className = 'alb-message bot';
    typingBubble.innerHTML = '<div class="alb-typing"><div class="alb-dot"></div><div class="alb-dot"></div><div class="alb-dot"></div></div>';
    bodyNode.appendChild(typingBubble);
    bodyNode.scrollTop = bodyNode.scrollHeight;
    return typingBubble;
}

function getResponseBadge(data) {
    var badgeClass = data.response_source === 'ai' ? 'ai' : 'system';
    var badgeIcon = data.response_source === 'ai'
      ? '<i class="fa-solid fa-sparkles"></i> Jawaban AI'
      : '<i class="fa-solid fa-robot"></i> Jawaban Sistem';

    if (data.warnings > 0) {
      badgeClass = 'warning';
      badgeIcon = '<i class="fa-solid fa-triangle-exclamation"></i> Peringatan Sistem';
    }

    if (data.ai_error_fallback) {
      badgeClass = 'warning';
      badgeIcon = '<i class="fa-solid fa-server"></i> Fallback Sistem';
    }

    return { badgeClass: badgeClass, badgeIcon: badgeIcon };
}

function createActionButtons(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return '';

    var html = actions.map(function (act) {
      var type = act.type || '';
      var label = escapeHtml(act.label || 'Aksi');

      if (type === 'open_url' || type === 'navigate') {
        var target = type === 'open_url' ? '_blank' : '_self';
        var url = escapeHtml(act.url || '#');
        return '<a href="' + url + '" target="' + target + '" class="alb-action-btn"><i class="fa-solid fa-arrow-right"></i> ' + label + '</a>';
      }

      if (type === 'highlight_element') {
        var selector = escapeHtml(act.selector || '');
        return '<button type="button" class="alb-action-btn alb-highlight-trigger" data-selector="' + selector + '"><i class="fa-solid fa-eye"></i> ' + label + '</button>';
      }

      if (type === 'wa_teacher') {
        return '<button type="button" class="alb-action-btn alb-wa-trigger-btn" style="background:#22c55e;color:#fff;border:none;"><i class="fa-brands fa-whatsapp"></i> ' + label + '</button>';
      }

      // FITUR BARU: RENDER TOMBOL PDF HIGHLIGHTER
      if (type === 'open_pdf_viewer') {
        var payload = {
          title: act.label ? act.label.replace('Buka ', '') : 'Materi Referensi',
          file_url: act.url || '',
          file_type: 'pdf',
          page_number: act.page_number || 1,
          query: act.query || ''
        };
        // Encode JSON agar aman diselipkan di dalam attribute HTML data-source
        var safePayload = encodeURIComponent(JSON.stringify(payload));

        // Perhatikan penambahan class "btn-open-source-viewer"
        return '<button type="button" class="alb-action-btn btn-open-source-viewer" data-source="' + safePayload + '"><i class="fa-solid fa-file-pdf"></i> ' + label + '</button>';
      }

      return '<button type="button" class="alb-action-btn"><i class="fa-solid fa-bolt"></i> ' + label + '</button>';
    }).join('');

    return '<div style="margin-top:8px;">' + html + '</div>';
}

function appendBotMessage(data) {
    var botMessage = document.createElement('div');
    botMessage.className = 'alb-message bot';

    var badge = getResponseBadge(data);
    var message = data.botMessage?.message || '';
    var actionsHtml = createActionButtons(data.botMessage?.actions);

    botMessage.innerHTML = `
      <div class="alb-msg-badge ${badge.badgeClass}">${badge.badgeIcon}</div>
      <div>${formatResponseText(message)}</div>
      ${actionsHtml}
    `;

    bodyNode.appendChild(botMessage);
    bindBotActions(botMessage);
}

function renderMessageFromHistory(msg) {
    var msgDiv = document.createElement('div');
    msgDiv.className = 'alb-message ' + (msg.role === 'user' ? 'user' : 'bot');

    if (msg.role === 'user') {
      var ctxEl = msg.context_used?.element_info;
      if (ctxEl) {
        msgDiv.innerHTML = '<div class="alb-msg-context-badge"><i class="fa-solid fa-tag" style="font-size:9px;"></i> ' + escapeHtml(ctxEl.name) + '</div><div style="margin-top:2px;">' + escapeHtml(msg.message) + '</div>';
      } else {
        msgDiv.textContent = msg.message;
      }
    } else {
      var ctx = msg.context_used || {};
      appendBotMessage({
        response_source: ctx.response_source || 'system',
        warnings: 0,
        botMessage: { message: msg.message, actions: ctx.actions || [] }
      });
      return;
    }

    bodyNode.appendChild(msgDiv);
}

function typeWriter(element, text, speed, callback) {
    var i = 0;
    element.innerHTML = '<span class="alb-text"></span><span class="alb-cursor"></span>';
    var textSpan = element.querySelector('.alb-text');
    var cursor = element.querySelector('.alb-cursor');

    function type() {
      if (i < text.length) {
        textSpan.textContent += text.charAt(i);
        i++;
        setTimeout(type, speed);
      } else {
        cursor.style.display = 'none';
        if (callback) callback();
      }
    }

    type();
}

function triggerWelcomeText() {
  if (hasTypedWelcome || !chatBoxNode || isLocked) return;
  hasTypedWelcome = true;

  var titleEl = chatBoxNode.querySelector('.alb-welcome-title');
  var tagEl = chatBoxNode.querySelector('.alb-welcome-tagline');
  if (!titleEl || !tagEl) return;

  typeWriter(titleEl, 'Selamat Datang di AI Buddy 🎓', 40, function () {
    typeWriter(tagEl, 'Kalau bingung, tanya aja. Nanti dijawab dengan pasti!', 30, function() {
      // Panggil prompt nama setelah animasi teks selamat datang selesai
      showNamePrompt();
    });
  });
}

// FITUR BARU: Menampilkan prompt nama siswa di awal chat
function showNamePrompt() {
  // Cek agar form tidak muncul berulang kali jika sudah diisi atau dilewati di sesi ini
  if (sessionStorage.getItem('alb_student_name_filled') === 'true') return;

  var promptDiv = document.createElement('div');
  promptDiv.className = 'alb-message bot';
  promptDiv.style.marginTop = '12px';
  promptDiv.innerHTML = `
    <div style="background:#f9fafb;padding:12px;border-radius:8px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;">Boleh isi nama panggilan dulu agar guru lebih mudah mengenali sesi ini?</p>
      <div style="display:flex; gap: 8px;">
        <input type="text" id="alb-student-name-input" placeholder="Nama kamu..." style="flex:1; border:1px solid #d4d4d8; border-radius: 4px; padding: 6px 8px; font-size:13px; outline:none;" />
        <button id="alb-student-name-submit" style="background:#0c0a09; color:white; border:none; border-radius:4px; padding: 6px 12px; font-size:13px; cursor:pointer; font-weight:600;">Simpan</button>
      </div>
      <button id="alb-student-name-skip" style="background:transparent; border:none; color:#6b7280; font-size:12px; margin-top:8px; cursor:pointer; padding:0; outline:none;">Lewati</button>
    </div>
  `;

  bodyNode.appendChild(promptDiv);
  bodyNode.scrollTop = bodyNode.scrollHeight;

  // Tangkap elemen di dalam form
  var inputEl = promptDiv.querySelector('#alb-student-name-input');
  var submitBtn = promptDiv.querySelector('#alb-student-name-submit');
  var skipBtn = promptDiv.querySelector('#alb-student-name-skip');

  // Event saat klik simpan
  submitBtn.addEventListener('click', function() {
    var name = inputEl.value.trim();
    if (!name) {
      inputEl.style.borderColor = '#ef4444'; // Merah kalau kosong
      return;
    }

    submitBtn.textContent = '...';
    submitBtn.disabled = true;

    // Ambil base URL dan Session ID
    // Note: Pastikan variabel penyimpan Session ID Anda benar (biasanya disimpan di state widget atau localStorage)
    var frontendBaseUrl = typeof ALB_FRONTEND_URL !== 'undefined' ? ALB_FRONTEND_URL : 'http://localhost:4321';
    var sessionId = localStorage.getItem('alb_session_id') || window.currentSessionId;

    if (!sessionId) {
       submitBtn.textContent = 'Simpan';
       submitBtn.disabled = false;
       return;
    }

    // Kirim request ke endpoint PATCH profil yang baru kita buat di backend
    fetch(frontendBaseUrl + '/api/chat/session/' + sessionId + '/profile', {
       method: 'PATCH',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ student_name: name })
    }).then(function(res) {
       if(res.ok) {
         sessionStorage.setItem('alb_student_name_filled', 'true');
         promptDiv.innerHTML = '<div style="font-size:13px;color:#16a34a;padding:8px;text-align:center;"><i class="fa-solid fa-check"></i> Nama berhasil disimpan!</div>';
         setTimeout(function() { promptDiv.remove(); }, 2500); // Hilang otomatis setelah 2.5 detik
       } else {
         throw new Error('Gagal menyimpan');
       }
    }).catch(function(err) {
       console.error('[AI Buddy] Gagal update profil', err);
       submitBtn.textContent = 'Simpan';
       submitBtn.disabled = false;
    });
  });

  // Event saat klik lewati
  skipBtn.addEventListener('click', function() {
    sessionStorage.setItem('alb_student_name_filled', 'true');
    promptDiv.remove();
  });
}


function openChat() {
    if (currentMode === 'embed') return;
    if (isPickingMode) togglePickerMode();
    if (chatBoxNode) chatBoxNode.classList.remove('alb-chat-hidden');
    if (buttonNode) buttonNode.classList.add('alb-btn-hidden');
    if (overlayNode) overlayNode.classList.add('alb-active');

    if (localStorage.getItem('alb_tutorial_done_' + projectKey) === 'true') {
      triggerWelcomeText();
    }
}

function closeChat() {
    if (currentMode === 'embed') return;
    if (chatBoxNode) chatBoxNode.classList.add('alb-chat-hidden');
    if (buttonNode) buttonNode.classList.remove('alb-btn-hidden');
    if (overlayNode) overlayNode.classList.remove('alb-active');
}

function clearActiveContext() {
    activeElementContext = null;
    if (contextContainerNode) contextContainerNode.classList.add('alb-context-hidden');
    if (inputNode && !isLocked && !usageData.cooldown_active) inputNode.focus();
}

function createChatBox(config) {
    var theme = normalizeTheme(config.theme);
    var title = theme.title || 'AI Learning Buddy';
    var subtitle = theme.subtitle || 'Tanya materi atau panduan VClass';

    var box = document.createElement('div');
    box.className = 'alb-chat-box alb-chat-hidden';
    box.innerHTML = `
      <div class="alb-tutorial-container">
        <div class="alb-tutorial-header"><button class="alb-skip-btn" type="button">Lewati</button></div>
        <div class="alb-slides-wrapper">
          <div class="alb-slide alb-slide-active"><div class="alb-anim-box">👋</div><h4 class="alb-slide-title">Kenalan dengan AI Buddy!</h4><p class="alb-slide-desc">Asisten pintar yang siap menemani perjalanan belajarmu di VClass.</p></div>
          <div class="alb-slide"><div class="alb-anim-box">💬</div><h4 class="alb-slide-title">Pahami Konteks Halaman</h4><p class="alb-slide-desc">Kamu bisa bertanya seputar materi atau cara menggunakan halaman ini.</p></div>
          <div class="alb-slide"><div class="alb-anim-box">🪄</div><h4 class="alb-slide-title">Gunakan Kursor Ajaib</h4><p class="alb-slide-desc">Klik tombol kursor, pilih elemen UI, lalu tanyakan kegunaannya.</p></div>
          <div class="alb-slide"><div class="alb-anim-box">⏱️</div><h4 class="alb-slide-title">Sesi Chat & Cooldown</h4><p class="alb-slide-desc">Jika AI sedang cooldown, sistem akan memberi jawaban otomatis.</p></div>
        </div>
        <div class="alb-tutorial-footer"><div class="alb-dot-container"><span class="alb-tutorial-dot alb-dot-active"></span><span class="alb-tutorial-dot"></span><span class="alb-tutorial-dot"></span><span class="alb-tutorial-dot"></span></div><button class="alb-tutorial-next-btn" type="button">Lanjut</button></div>
      </div>

      <div class="alb-chat-header">
        <div class="alb-header-info">
          <p class="alb-chat-title">${escapeHtml(title)}</p>
          <p class="alb-chat-subtitle">${escapeHtml(subtitle)}</p>
          <div class="alb-usage-indicator" id="alb-usage-display"><i class="fa-solid fa-bolt"></i> AI Usage: 0/3</div>
        </div>
        <div class="alb-header-actions">
          <button id="alb-clear-btn" class="alb-action-icon-btn" type="button" title="Bersihkan Chat"><i class="fa-solid fa-trash-can"></i></button>
          <button class="alb-close-btn alb-action-icon-btn" type="button" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>

      <div class="alb-chat-body" id="alb-chat-body">
        <!-- BANNER JARINGAN -->
        <div id="alb-network-status" class="alb-network-banner alb-network-hidden"></div>

        <div id="alb-lock-screen" class="alb-lock-overlay">
          <i class="fa-solid fa-shield-halved" style="font-size:40px; color:#ef4444; margin-bottom:16px;"></i>
          <h3 style="margin:0 0 8px;color:#0c0a09;font-size:16px;">Chat Terkunci</h3>
          <p style="font-size:12px;color:#777;margin:0;margin-bottom:12px;">Akses diblokir (Pelanggaran Pedoman). Isi identitasmu untuk verifikasi kunci guru.</p>

          <div style="width:100%; text-align:left; box-sizing:border-box;">
            <label style="font-size:11px; font-weight:600; color:#555;">Nama Panggilan (Wajib)</label>
            <input type="text" id="alb-lock-name-input" class="alb-lock-input" placeholder="Masukkan nama kamu..." autocomplete="off" style="margin-top:4px; margin-bottom:12px; border:1px solid #d4d4d8; box-sizing:border-box;" />

            <label style="font-size:11px; font-weight:600; color:#555;">Unlock Key Guru</label>
            <input type="text" id="alb-unlock-input" class="alb-lock-input" placeholder="Misal: GURU-1234" autocomplete="off" style="margin-top:4px; border:1px solid #ef4444; box-sizing:border-box;" />
          </div>

          <button id="alb-unlock-btn" class="alb-lock-btn" style="margin-top:16px;">Verifikasi & Buka Akses</button>
        </div>
        <div class="alb-welcome-container"><h3 class="alb-welcome-title"></h3><p class="alb-welcome-tagline"></p></div>
      </div>

      <div class="alb-chat-input-wrapper">
        <div id="alb-context-container" class="alb-context-hidden">
          <span id="alb-context-label" class="alb-context-badge"></span>
          <button type="button" id="alb-context-clear" title="Batal Pilih"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div id="alb-suggestions"></div>
        <div class="alb-chat-input-area">
          <button class="alb-magic-cursor-btn" type="button" title="Pilih elemen halaman"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
          <input type="text" class="alb-chat-input" placeholder="Tanya sesuatu..." autocomplete="off" />
          <button class="alb-chat-send" type="button">Kirim</button>
        </div>
      </div>
    `;

    inputNode = box.querySelector('.alb-chat-input');
    magicBtnNode = box.querySelector('.alb-magic-cursor-btn');
    usageNode = box.querySelector('#alb-usage-display');
    contextContainerNode = box.querySelector('#alb-context-container');
    contextLabelNode = box.querySelector('#alb-context-label');
    contextClearNode = box.querySelector('#alb-context-clear');
    bodyNode = box.querySelector('#alb-chat-body');
    sendBtnNode = box.querySelector('.alb-chat-send');

    bindChatBoxEvents(box);
    updateUsageUI();
    return box;
}

function createPdfDrawer() {
  if (document.getElementById('alb-pdf-drawer')) return;

  var drawer = document.createElement('div');
  drawer.id = 'alb-pdf-drawer';
  drawer.className = 'alb-pdf-drawer';
  drawer.innerHTML = `
    <div class="alb-pdf-header">
      <h4 id="alb-pdf-title" class="alb-pdf-title">Materi Referensi</h4>
      <button id="alb-pdf-close" class="alb-pdf-close"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <iframe id="alb-pdf-iframe" class="alb-pdf-iframe" src=""></iframe>
  `;
  document.body.appendChild(drawer);

  // Event untuk menutup drawer
  document.getElementById('alb-pdf-close').addEventListener('click', function() {
    drawer.classList.remove('open');
    // Kosongkan iframe agar audionya mati/resource terlepas
    setTimeout(function() { document.getElementById('alb-pdf-iframe').src = ''; }, 300);
  });
}

function createPdfDrawerUI() {
  var drawer = document.createElement('div');
  drawer.id = 'alb-pdf-drawer';
  drawer.className = 'alb-pdf-drawer';
  drawer.innerHTML = `
    <div class="alb-pdf-header">
      <h4 id="alb-pdf-title" class="alb-pdf-title">Materi Referensi</h4>
      <button id="alb-pdf-close" class="alb-pdf-close"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <iframe id="alb-pdf-iframe" class="alb-pdf-iframe" src=""></iframe>
  `;
  document.body.appendChild(drawer);

  // Event tutup drawer
  document.getElementById('alb-pdf-close').addEventListener('click', function() {
    drawer.classList.remove('open');
    // Kosongkan src iframe setelah delay animasi agar audionya mati/memori lega
    setTimeout(function() { document.getElementById('alb-pdf-iframe').src = ''; }, 300);
  });
}

function renderSuggestions(suggestions) {
    var suggestionBox = document.getElementById('alb-suggestions');
    if (!suggestionBox || !Array.isArray(suggestions)) return;

    suggestionBox.innerHTML = '';
    suggestions.forEach(function (item) {
      var text = item.suggestion_text || item.text || item.label || '';
      if (!text) return;

      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'alb-suggestion-chip';
      chip.textContent = text;
      chip.addEventListener('click', function () {
        inputNode.value = text;
        clearSuggestions();
        inputNode.focus();
      });
      suggestionBox.appendChild(chip);
    });
}

function clearSuggestions() {
    var suggestionBox = document.getElementById('alb-suggestions');
    if (suggestionBox) suggestionBox.innerHTML = '';
}


// Deteksi saat WiFi/Data Seluler mati
window.addEventListener('offline', function() {
    isOffline = true;
    updateNetworkUI('offline', 'Tidak ada jaringan internet.');
});

// Deteksi saat WiFi/Data Seluler menyala kembali
window.addEventListener('online', function() {
    isOffline = false;
    updateNetworkUI('online');
    showToast('Koneksi kembali terhubung!', false);
});
