const cheerio = require('cheerio');
const fs = require('fs');
// const supabaseService = require('../supabase/supabase.service'); // Uncomment untuk insert ke DB

const templateParserService = {
// ==========================================
// FUNGSI PARSER & CHUNKER (DIUPDATE UNTUK GRANULAR ELEMEN)
// ==========================================
 parseHtml(filePath, config) {
    const rawHtml = fs.readFileSync(filePath, 'utf-8');
    const $ = cheerio.load(rawHtml);

    // 1. Bersihkan noise dari halaman (hapus navbar, footer, aside, icon, dll)
    $('nav, footer, aside, script, style:not([scoped]), iframe, noscript').remove();
    $('svg, i.fa, i.fas, i.fab, i.fa-solid, i.fa-regular, img').remove();

    // Simpan html_preview UTUH (setelah dibersihkan) untuk iframe di UI Frontend
    const html_preview = $('body').html() || '';

    const elements_json = [];
    let elementCounter = 1;

    // 2. Target elemen dipecah lebih spesifik (Container, Input, Tombol, Text)
    const targetSelectors = [
      'form',
      '.card, [class*="card"]',
      'article, [class*="materi"]',
      'input', 'select', 'textarea',
      'button', 'a.btn', 'a[class*="btn"]',
      'h1', 'h2', 'h3'
    ].join(', ');

    $(targetSelectors).each((index, el) => {
      const $el = $(el);
      const tagName = el.tagName.toLowerCase();

      // Tentukan Tipe, Judul, dan Teks berdasarkan jenis elemen
      let type = 'Elemen';
      let rawText = '';
      let title = '';

      if (tagName === 'form') {
        type = 'Formulir';
        rawText = $el.text().replace(/\s+/g, ' ').trim();
        title = 'Form ' + ($el.find('h1, h2, h3').first().text().trim() || 'Utama');
      }
      else if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
        type = 'Kolom Input';
        // Prioritaskan placeholder atau name untuk input field
        rawText = $el.attr('placeholder') || $el.attr('name') || tagName;
        title = 'Input ' + ($el.attr('name') || $el.attr('id') || elementCounter);
      }
      else if (tagName === 'button' || tagName === 'a') {
        type = 'Tombol';
        rawText = $el.text().replace(/\s+/g, ' ').trim() || $el.attr('aria-label') || tagName;
        title = 'Tombol ' + rawText.substring(0, 20);
      }
      else if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
        type = 'Judul';
        rawText = $el.text().replace(/\s+/g, ' ').trim();
        title = rawText.substring(0, 30);
      }
      else {
        // Container: Card / Section
        type = ($el.attr('class') && $el.attr('class').includes('card')) ? 'Card' : 'Section';
        rawText = $el.text().replace(/\s+/g, ' ').trim();
        title = type + ' ' + ($el.find('h1, h2, h3, h4').first().text().trim() || elementCounter);
      }

      // Abaikan elemen jika teksnya kosong atau tidak bermakna
      if (!rawText || rawText.length < 2) return;

      // 3. Bangun Selector CSS yang kuat untuk fitur Highlight iframe di Frontend
      let selector = tagName;
      if ($el.attr('id')) {
        selector += `#${$el.attr('id')}`;
      } else if ($el.attr('name')) {
        selector += `[name="${$el.attr('name')}"]`;
      } else if ($el.attr('class')) {
        // Ambil 2 class pertama yang aman (tidak mengandung pseudo-class seperti hover:)
        const classes = $el.attr('class').split(/\s+/).filter(c => c && !c.includes(':')).slice(0, 2);
        if (classes.length > 0) selector += `.${classes.join('.')}`;
      }

      elements_json.push({
        key: `${config.type}_el_${elementCounter}`,
        name: `@${type.replace(/\s+/g, '').toLowerCase()}${elementCounter}`,
        title: title,
        type: type,
        text: rawText.substring(0, 300),
        selector: selector,
        html: $.html(el) // Snippet HTML kecil ini yang akan tampil di accordion frontend
      });

      elementCounter++;
    });

    return {
      project_id: PROJECT_ID,
      page_type: config.type,
      template_name: config.name,
      match_url_contains: config.match,
      html_preview: html_preview,
      elements_json: elements_json,
      tutorial_steps_json: [],
      question_suggestions_json: [],
      is_active: true
    };
  }

};

module.exports = templateParserService;
