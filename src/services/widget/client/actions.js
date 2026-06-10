function bindChatBoxEvents(box) {
    var closeBtn = box.querySelector('.alb-close-btn');
    var clearBtn = box.querySelector('#alb-clear-btn');
    var unlockInput = box.querySelector('#alb-unlock-input');
    var unlockBtn = box.querySelector('#alb-unlock-btn');
    var tutorialContainer = box.querySelector('.alb-tutorial-container');
    var slides = box.querySelectorAll('.alb-slide');
    var dots = box.querySelectorAll('.alb-tutorial-dot');
    var nextBtn = box.querySelector('.alb-tutorial-next-btn');
    var skipBtn = box.querySelector('.alb-skip-btn');
    var currentSlide = 0;

    if (contextClearNode) contextClearNode.addEventListener('click', clearActiveContext);
    if (clearBtn) clearBtn.addEventListener('click', clearChat);
    if (closeBtn) closeBtn.addEventListener('click', closeChat);
    if (magicBtnNode) magicBtnNode.addEventListener('click', togglePickerMode);
    if (sendBtnNode) sendBtnNode.addEventListener('click', sendRealMessage);

    if (inputNode) {
      inputNode.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') sendRealMessage();
      });

      inputNode.addEventListener('input', function () {
        var value = inputNode.value.trim().toLowerCase();
        clearTimeout(suggestionTimer);

        if (!value) {
          clearSuggestions();
          return;
        }

        if (value.startsWith('tanya')) {
          suggestionTimer = setTimeout(function () {
            fetchSuggestions('tanya');
          }, 250);
        }
      });
    }

    if (unlockBtn) {
      unlockBtn.addEventListener('click', function () {
        var nameInput = document.getElementById('alb-lock-name-input');
        var name = nameInput ? nameInput.value.trim() : '';
        var key = unlockInput.value.trim();

        if (!name) {
          showToast('Harap masukkan nama panggilanmu!', true);
          if(nameInput) nameInput.style.borderColor = '#ef4444';
          return;
        }
        if (!key) {
          showToast('Harap masukkan key dari guru!', true);
          return;
        }

        unlockBtn.textContent = 'Memproses...';
        unlockBtn.disabled = true;

        var frontendBaseUrl = typeof ALB_FRONTEND_URL !== 'undefined' ? ALB_FRONTEND_URL : 'http://localhost:4321';

        // 1. Simpan Nama Siswa Terlebih Dahulu
        fetch(frontendBaseUrl + '/api/chat/session/' + (window.CURRENT_SESSION_ID || localStorage.getItem('alb_session_id')) + '/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_name: name })
        }).then(function() {
            // 2. Jika sukses simpan nama, barulah kirim request Unlock Key
            return unlockChat(key);
        }).then(function (res) {
            if (res.status === 'success') {
              handleLockdownState(false);
              showToast('Chat berhasil dibuka kembali.');
              appendDisclaimer('Akses dibuka. Gunakan AI ini untuk belajar dengan sopan ya, ' + name + '!');
              triggerWelcomeText();
            } else {
              showToast(res.message || 'Key salah atau kedaluwarsa!', true);
            }
        }).catch(function () {
            showToast('Gagal membuka akses koneksi.', true);
        }).finally(function () {
            unlockBtn.textContent = 'Verifikasi & Buka Akses';
            unlockBtn.disabled = false;
            unlockInput.value = '';
        });
      });
    }

    function updateCarouselUI() {
      slides.forEach(function (slide, idx) {
        slide.classList.toggle('alb-slide-active', idx === currentSlide);
      });
      dots.forEach(function (dot, idx) {
        dot.classList.toggle('alb-dot-active', idx === currentSlide);
      });
      if (nextBtn) nextBtn.textContent = currentSlide === slides.length - 1 ? 'Mulai Chat ✨' : 'Lanjut';
    }

    function finishTutorial() {
      localStorage.setItem('alb_tutorial_done_' + projectKey, 'true');
      if (tutorialContainer) tutorialContainer.classList.add('alb-tutorial-hidden');
      triggerWelcomeText();
    }

    if (localStorage.getItem('alb_tutorial_done_' + projectKey) === 'true' && tutorialContainer) {
      tutorialContainer.classList.add('alb-tutorial-hidden');
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (currentSlide < slides.length - 1) {
          currentSlide++;
          updateCarouselUI();
        } else {
          finishTutorial();
        }
      });
    }

    if (skipBtn) skipBtn.addEventListener('click', finishTutorial);
  }

  function bindBotActions(botMessage) {
    // 1. Tombol Hubungi Guru (WA)
    var waBtn = botMessage.querySelector('.alb-wa-trigger-btn');
    if (waBtn) {
      waBtn.addEventListener('click', function () {
        renderWaForm(waBtn);
      });
    }

    // 2. Tombol Highlight Elemen
    botMessage.querySelectorAll('.alb-highlight-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        highlightBySelector(btn.getAttribute('data-selector'));
      });
    });

    // 3. Tombol Buka Materi PDF (YANG BARU)
    botMessage.querySelectorAll('.btn-open-source-viewer').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();

        var dataStr = btn.getAttribute('data-source');
        if (!dataStr) return;

        try {
          var data = JSON.parse(decodeURIComponent(dataStr));

          // ALB_FRONTEND_URL disuntikkan dari widget-loader.service.js
          var frontendBaseUrl = typeof ALB_FRONTEND_URL !== 'undefined' ? ALB_FRONTEND_URL : 'http://localhost:4321';

          var pdfUrl = encodeURIComponent(data.file_url || '');
          var page = data.page_number || 1;
          var query = encodeURIComponent(data.query || '');

          var iframeUrl = frontendBaseUrl + '/embed/pdf?url=' + pdfUrl + '&page=' + page + '&q=' + query;

          // Buat Drawer on-the-fly jika belum ada di HTML
          if (!document.getElementById('alb-pdf-drawer')) {
            createPdfDrawerUI();
          }

          var drawer = document.getElementById('alb-pdf-drawer');
          var iframe = document.getElementById('alb-pdf-iframe');
          var title = document.getElementById('alb-pdf-title');

          if (drawer && iframe) {
            title.textContent = data.title || 'Materi Referensi';
            iframe.src = iframeUrl;
            drawer.classList.add('open');
          }
        } catch (err) {
          console.error('[AI Buddy] Error parsing PDF data:', err);
        }
      });
    });
  }

  function highlightBySelector(selector) {
    if (!selector) return;

    var el = document.querySelector(selector);
    if (!el) {
      showToast('Elemen tidak ditemukan di halaman ini.', true);
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') el.focus();
    el.style.outline = '3px dashed #3b82f6';
    setTimeout(function () { el.style.outline = ''; }, 3000);
  }

  function renderWaForm(btnNode) {
    btnNode.disabled = true;
    btnNode.style.opacity = '0.5';

    var formHtml = document.createElement('div');
    formHtml.className = 'alb-message bot';
    formHtml.innerHTML = `
      <div style="background:#f9fafb;padding:12px;border-radius:8px;border:1px solid #e5e7eb;margin-top:4px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111827;">Kirim Pesan Bantuan Guru</p>
        <input type="text" class="alb-wa-input-name" placeholder="Nama Kamu..." style="width:100%;padding:8px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;box-sizing:border-box;" />
        <textarea class="alb-wa-input-issue" placeholder="Tulis kendala yang sedang kamu alami..." style="width:100%;padding:8px;margin-bottom:8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;min-height:60px;resize:vertical;box-sizing:border-box;"></textarea>
        <button type="button" class="alb-wa-submit-btn" style="width:100%;background:#22c55e;color:#fff;border:0;padding:8px;border-radius:4px;cursor:pointer;font-weight:700;font-size:13px;">Kirim via WhatsApp</button>
        <button type="button" class="alb-wa-cancel-btn" style="width:100%;background:transparent;color:#6b7280;border:0;padding:8px;margin-top:4px;cursor:pointer;font-size:12px;">Batal</button>
      </div>
    `;

    bodyNode.appendChild(formHtml);
    bodyNode.scrollTop = bodyNode.scrollHeight;

    formHtml.querySelector('.alb-wa-cancel-btn').addEventListener('click', function () {
      formHtml.remove();
      btnNode.disabled = false;
      btnNode.style.opacity = '1';
    });

    formHtml.querySelector('.alb-wa-submit-btn').addEventListener('click', function () {
      var name = formHtml.querySelector('.alb-wa-input-name').value.trim() || 'Siswa';
      var issue = formHtml.querySelector('.alb-wa-input-issue').value.trim() || 'Saya butuh bantuan di VClass.';
      var text = 'Halo Pak/Bu Guru, saya ingin meminta bantuan.\n\n' +
        'Nama: ' + name + '\n' +
        'Kendala: ' + issue + '\n' +
        'Halaman: ' + window.location.href + '\n' +
        'Waktu: ' + new Date().toLocaleString('id-ID') + '\n\n' +
        'Saya merasa kesulitan saat belajar di VClass.';

      window.open('https://api.whatsapp.com/send/?phone=628989807094&text=' + encodeURIComponent(text), '_blank');
      formHtml.innerHTML = '<div style="font-size:13px;color:#16a34a;padding:8px;text-align:center;"><i class="fa-solid fa-check"></i> Mengalihkan ke WhatsApp...</div>';
    });
  }

  function getMeaningfulElement(el) {
    if (!el || el === document.body || el === document.documentElement) return el;
    var selectors = ['button', 'a', 'form', 'article', 'section', 'nav', 'header', 'footer', 'table', 'tr', 'th', 'td', '.card', '.container', '.wrapper', '.item', '.box', '[class*="card"]', '[class*="item"]'];

    for (var i = 0; i < selectors.length; i++) {
      var closest = el.closest(selectors[i]);
      if (closest && closest !== document.body) return closest;
    }

    return el.closest('div[class], div[id]') || el;
  }

  function getDynamicElementName(el) {
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role');
    var classes = el.className || '';
    if (typeof classes !== 'string') classes = '';

    if (tag === 'button' || role === 'button') return '@Tombol';
    if (tag === 'a' || role === 'link') return '@Tautan';
    if (tag === 'img') return '@Gambar';
    if (tag === 'form') return '@Formulir';
    if (tag === 'table' || tag === 'th' || tag === 'td' || tag === 'tr') return '@Tabel_Data';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return '@KolomInput';

    classes = classes.toLowerCase();
    if (classes.includes('card')) return '@Card';
    if (classes.includes('nav') || classes.includes('menu')) return '@Navigasi';
    if (classes.includes('header')) return '@Header';
    if (classes.includes('footer')) return '@Footer';
    if (classes.includes('section') || classes.includes('bagian')) return '@Bagian';
    if (classes.includes('item') || classes.includes('list')) return '@DaftarItem';
    if (classes.includes('container') || classes.includes('wrapper')) return '@WadahKonten';
    if (classes.includes('modal') || classes.includes('popup')) return '@ModalPopUp';
    return '@' + tag.charAt(0).toUpperCase() + tag.slice(1);
  }

  function resetCapsuleTimer() {
    if (!capsuleNode) return;
    capsuleNode.classList.remove('alb-capsule-fade');
    clearTimeout(capsuleTimer);
    capsuleTimer = setTimeout(function () {
      if (isPickingMode && capsuleNode) capsuleNode.classList.add('alb-capsule-fade');
    }, 3000);
  }

  function handleMouseMove() {
    if (isPickingMode) resetCapsuleTimer();
  }

  function handleMouseOver(e) {
    if (!isPickingMode || e.target.closest('.alb-chat-box') || e.target.closest('#ai-learning-buddy-widget')) return;
    var target = getMeaningfulElement(e.target);
    if (hoveredElement === target) return;
    if (hoveredElement) hoveredElement.classList.remove('alb-element-highlight');
    hoveredElement = target;
    hoveredElement.classList.add('alb-element-highlight');
  }

  function handleMouseOut(e) {
    if (!isPickingMode) return;
    if (hoveredElement && hoveredElement === getMeaningfulElement(e.target)) {
      hoveredElement.classList.remove('alb-element-highlight');
      hoveredElement = null;
    }
  }

  function handleElementClick(e) {
    if (!isPickingMode || e.target.closest('#ai-learning-buddy-widget')) return;
    e.preventDefault();
    e.stopPropagation();

    var el = getMeaningfulElement(e.target);
    var mentionName = getDynamicElementName(el);

    activeElementContext = {
      name: mentionName,
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || '').substring(0, 80).trim(),
      role: el.getAttribute('role') || el.type || 'element',
      nearText: (el.parentElement ? el.parentElement.innerText : '').substring(0, 150).trim()
    };

    if (contextLabelNode && contextContainerNode) {
      contextLabelNode.innerHTML = '<i class="fa-solid fa-tag" style="font-size:10px;"></i> ' + escapeHtml(mentionName);
      contextContainerNode.classList.remove('alb-context-hidden');
    }

    togglePickerMode();
    openChat();
    setTimeout(function () { inputNode.focus(); }, 300);
  }

  function handleEscKey(e) {
    if (e.key === 'Escape' && isPickingMode) {
      togglePickerMode();
      openChat();
    }
  }

  function togglePickerMode() {
    isPickingMode = !isPickingMode;

    if (isPickingMode) {
      magicBtnNode.classList.add('active');
      if (overlayNode) overlayNode.style.pointerEvents = 'none';
      if (capsuleNode) {
        capsuleNode.classList.remove('alb-capsule-hidden');
        resetCapsuleTimer();
      }
      closeChat();
      document.body.addEventListener('mousemove', handleMouseMove);
      document.body.addEventListener('mouseover', handleMouseOver);
      document.body.addEventListener('mouseout', handleMouseOut);
      document.body.addEventListener('click', handleElementClick, true);
      document.addEventListener('keydown', handleEscKey);
      return;
    }

    magicBtnNode.classList.remove('active');
    if (overlayNode) overlayNode.style.pointerEvents = 'auto';
    if (capsuleNode) {
      capsuleNode.classList.add('alb-capsule-hidden');
      capsuleNode.classList.remove('alb-capsule-fade');
      clearTimeout(capsuleTimer);
    }
    document.body.removeEventListener('mousemove', handleMouseMove);
    document.body.removeEventListener('mouseover', handleMouseOver);
    document.body.removeEventListener('mouseout', handleMouseOut);
    document.body.removeEventListener('click', handleElementClick, true);
    document.removeEventListener('keydown', handleEscKey);
    if (hoveredElement) {
      hoveredElement.classList.remove('alb-element-highlight');
      hoveredElement = null;
    }
  }


  // TAHAP PDF: Event Listener untuk Tombol Buka Materi
  document.body.addEventListener('click', function(e) {
    var btn = e.target.closest('.btn-open-source-viewer');
    if (!btn) return;

    e.preventDefault();
    var dataStr = btn.getAttribute('data-source');
    if (!dataStr) return;

    try {
      var data = JSON.parse(decodeURIComponent(dataStr));

      // PERHATIAN: Ganti URL ini dengan URL domain Frontend React kamu!
      // Kalau di local misal jalan di port 5173 atau 3000
      var frontendBaseUrl = ALB_FRONTEND_URL;

      var pdfUrl = encodeURIComponent(data.file_url || '');
      var page = data.page_number || 1;
      var query = encodeURIComponent(data.query || '');

      // Rakit URL untuk memanggil rute Frontend yang kita buat di Langkah 1
      var iframeUrl = frontendBaseUrl + '/embed/pdf?url=' + pdfUrl + '&page=' + page + '&q=' + query;

      // Update UI Drawer
      var drawer = document.getElementById('alb-pdf-drawer');
      var iframe = document.getElementById('alb-pdf-iframe');
      var title = document.getElementById('alb-pdf-title');

      if (drawer && iframe) {
        title.textContent = data.title || 'Materi Referensi';
        iframe.src = iframeUrl; // Muat React PDF Highlighter ke dalam iframe

        // Buka laci geser
        drawer.classList.add('open');
      }
    } catch(err) {
      console.error('[AI Buddy] Gagal membaca data sumber PDF', err);
    }
  });
