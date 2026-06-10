function installGlobalHelper() {
    window.AILearningBuddy = {
      clearChat: clearChat,
      endSession: endSession,
      getSessionId: function () { return sessionId; }
    };
  }

  function clearChat() {
    if (bodyNode) {
      var lockScreen = bodyNode.querySelector('#alb-lock-screen');
      bodyNode.innerHTML = '';
      if (lockScreen) bodyNode.appendChild(lockScreen);
    }

    hasTypedWelcome = false;
    if (!isLocked) triggerWelcomeText();
    showToast('Tampilan chat dibersihkan. Sesi tetap berjalan.');
  }

  function endSession() {
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(lockCacheKey);
    sessionId = null;
    isLocked = false;
    clearChat();
    initSession();
  }

  function ensureFontAwesome() {
    if (document.querySelector('link[data-alb-fontawesome="true"]')) return;
    var faLink = document.createElement('link');
    faLink.rel = 'stylesheet';
    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    faLink.dataset.albFontawesome = 'true';
    document.head.appendChild(faLink);
  }

  function getPageContext() {
    return {
      type: typeof detectPageType === 'function' ? detectPageType() : 'beranda',
      title: document.title || '',
      url: window.location.href,
      heading: document.querySelector('h1')?.innerText || '',
      textPreview: document.body?.innerText?.slice(0, 1200) || ''
    };
  }

  function detectPageType() {
    var url = window.location.href.toLowerCase();
    var text = (document.body?.innerText || '').toLowerCase();

    if (url.includes('quiz') || url.includes('ujian') || text.includes('kerjakan soal')) return 'quiz';
    if (url.includes('course') || url.includes('materi') || text.includes('materi')) return 'course_detail';
    if (url.includes('login')) return 'login';
    if (url.includes('dashboard') || text.includes('dashboard')) return 'dashboard';
    return 'beranda';
  }

  function initSession() {
    if (sessionId) {
      getChatState()
        .then(function (res) {
          if (res.status !== 'success') {
            endSession();
            return;
          }

          usageData = res.data.ai_usage || usageData;
          updateUsageUI();
          startCooldownTimer();

          if (res.data.safety_state?.locked) {
            handleLockdownState(true);
          } else {
            handleLockdownState(false);
            loadHistory();
          }
        })
        .catch(loadHistory);
      return;
    }

    createChatSession()
      .then(function (res) {
        if (res.status === 'success') {
          sessionId = res.data.session.id;
          sessionStorage.setItem(storageKey, sessionId);
        }
      })
      .catch(console.error);
  }

  function loadHistory() {
    if (!sessionId) return;

    getChatHistory()
      .then(function (res) {
        if (!res.data || res.data.length === 0) return;
        hasTypedWelcome = true;
        if (isLocked) return;

        res.data.forEach(renderMessageFromHistory);
        bodyNode.scrollTop = bodyNode.scrollHeight;
      })
      .catch(function () {});
  }

  function syncAiUsage() {
    if (!sessionId) return;

    getAiUsage()
      .then(function (res) {
        if (!res.data) return;
        usageData = res.data;
        updateUsageUI();
        startCooldownTimer();
      })
      .catch(function () {});
  }

  function fetchSuggestions(trigger) {
    getSuggestions(trigger)
      .then(function (res) {
        if (res.data?.length) renderSuggestions(res.data);
      })
      .catch(console.error);
  }

  function handleSuccessResponse(res) {
    var data = res.data || {};

    if (data.is_locked || data.warnings >= 3) {
      handleLockdownState(true);
      showToast('Peringatan ke-3: Akses dikunci!', true);
      return;
    }

    if (data.warnings === 2) {
      showToast('Peringatan 2/3: Gunakan bahasa yang sopan.', true);
    }

    if (data.ai_usage) {
      usageData = data.ai_usage;
      updateUsageUI();
      startCooldownTimer();
    }

    appendBotMessage(data);

    if (messageCount % 4 === 0) {
      var notes = [
        'Jangan terlalu bergantung pada AI, coba pelajari materinya juga.',
        'Jawaban AI bisa saja kurang tepat, selalu cek referensi.',
        'AI membantu belajar, bukan menggantikan usaha kamu.'
      ];
      appendDisclaimer('💡 ' + notes[Math.floor(Math.random() * notes.length)]);
    }
  }

  function sendRealMessage() {
    // --- TAHAPAN JARINGAN 1: Cegat dari awal jika sudah offline ---
    if (isOffline) {
      showToast('Gagal mengirim: Tidak ada koneksi internet.', true);
      return;
    }

    if (isRequesting) return;

    if (!sessionId) {
      appendSystemError('Sesi belum siap.');
      initSession();
      return;
    }

    var value = inputNode.value.trim();
    if (!value || isLocked || usageData.cooldown_active) return;

    isRequesting = true;
    setInputDisabled(true);

    // --- TAHAPAN JARINGAN 2: Mulai timer 8 detik untuk deteksi lemot ---
    clearTimeout(slowNetworkTimer);
    slowNetworkTimer = setTimeout(function() {
      if (isRequesting) {
        updateNetworkUI('slow', 'Jaringan lemot. Sabar ya, masih memproses...');
      }
    }, 8000);

    var payloadElementContext = activeElementContext;
    appendUserMessage(value);

    inputNode.value = '';
    clearActiveContext();
    clearSuggestions();
    bodyNode.scrollTop = bodyNode.scrollHeight;

    var typingBubble = appendTypingBubble();

    sendChatMessage(value, payloadElementContext)
      .then(function (res) {
        typingBubble.remove();

        if (res.status === 'success') {
          handleSuccessResponse(res);
        } else {
          appendSystemError(res.message || 'Pesan gagal dikirim.');
        }
      })
      .catch(function (err) {
        console.error(err);
        if (typingBubble) typingBubble.remove();

        // --- TAHAPAN JARINGAN 3: Bedakan pesan error saat offline ---
        if (isOffline) {
          appendSystemError('Pesan gagal terkirim karena koneksi terputus.');
        } else {
          appendSystemError('Koneksi ke AI Buddy gagal. Coba lagi sebentar.');
        }
      })
      .finally(function () {
        isRequesting = false;

        // --- TAHAPAN JARINGAN 4: Bersihkan timer dan update UI ---
        clearTimeout(slowNetworkTimer);
        if (!isOffline) {
          updateNetworkUI('online'); // Sembunyikan banner kuning
        }

        // --- TAHAPAN JARINGAN 5: Pastikan tidak membuka input jika offline ---
        if (!isLocked && !usageData.cooldown_active && !isOffline) {
          setInputDisabled(false);
          if (inputNode) setTimeout(function () { inputNode.focus(); }, 100);
        }

        if (bodyNode) bodyNode.scrollTop = bodyNode.scrollHeight;
      });
  }

  function renderInteractive(config) {
    currentMode = config.mode || 'floating';

    var root = document.createElement('div');
    root.id = widgetId;

    overlayNode = document.createElement('div');
    overlayNode.className = 'alb-overlay';
    overlayNode.addEventListener('click', closeChat);
    document.body.appendChild(overlayNode);

    capsuleNode = document.createElement('div');
    capsuleNode.className = 'alb-instruction-capsule alb-capsule-hidden';
    capsuleNode.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Sorot dan klik elemen yang ingin ditanyakan (Tekan Esc untuk batal).</span>';
    document.body.appendChild(capsuleNode);

    chatBoxNode = createChatBox(config);

    if (currentMode === 'embed') {
      root.className = 'alb-inline';
      chatBoxNode.classList.remove('alb-chat-hidden');
      chatBoxNode.classList.add('alb-chat-inline');
      root.appendChild(chatBoxNode);

      if (currentScript && currentScript.parentNode) {
        currentScript.parentNode.insertBefore(root, currentScript.nextSibling);
      } else {
        document.body.appendChild(root);
      }
      return;
    }

    root.className = currentMode === 'button' ? 'alb-button' : 'alb-floating';
    buttonNode = document.createElement('button');
    buttonNode.className = currentMode === 'button' ? 'alb-open-btn' : 'alb-bubble-btn';
    buttonNode.innerHTML = '<i class="fa-solid fa-sparkles"></i> Tanya AI';
    buttonNode.addEventListener('click', openChat);

    root.appendChild(buttonNode);
    document.body.appendChild(root);
    document.body.appendChild(chatBoxNode);
  }

  function renderWidget(config) {
    createStyle(config);
    renderInteractive(config);
    initSession();
    if (isLocked) handleLockdownState(true);
  }

  function bootWidget() {
    if (document.getElementById(widgetId)) return;

    installGlobalHelper();
    ensureFontAwesome();

    getWidgetConfig()
      .then(function (result) {
        if (result.status === 'success') renderWidget(result.data);
        else console.error('[AI Learning Buddy] gagal mengambil config widget');
      })
      .catch(console.error);
  }

  bootWidget();
