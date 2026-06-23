// src/services/rag/chunking.service.js

const chunkingService = {
  trimToLastSentence(text) {
    if (!text) return '';
    const match = text.match(/(.*[.?!:])\s*/s);
    if (match && match[1]) return match[1].trim();
    return '';
  },

  splitIntoSentences(text) {
    const regex = /[^.?!:]+[.?!:]+/g;
    const matches = text.match(regex);
    if (!matches) return [text];
    return matches.map(s => s.trim()).filter(s => s.length > 0);
  },

  // Deteksi Halaman Cover
  isCoverPage(text) {
    const lowerText = text.toLowerCase();
    const isShort = text.length < 500;
    const hasExplanatoryWords = /(adalah|merupakan|yaitu|digunakan|contoh|fungsi|sedangkan)/.test(lowerText);
    const hasCoverKeywords = /(materi tik kelas|minggu \d+|bab \d+|disusun dari|ringkasan isi|tujuan pembelajaran)/.test(lowerText);

    // Jika teks tergolong pendek, mengandung keyword pembuka LMS, dan TIDAK memiliki kalimat materi inti
    return (isShort && hasCoverKeywords && !hasExplanatoryWords);
  },

  // [#5] Chunking PER PERGANTIAN PARAGRAF.
  // Dasar: tiap paragraf memuat SATU ide pokok (kalimat utama + kalimat penjelas)
  // dan ditandai dengan baris baru. Maka 1 paragraf = 1 chunk. Pengecualian:
  //  - Fragmen sangat pendek (mis. sub-judul / kalimat tunggal di bawah minChars)
  //    digabung ke paragraf BERIKUTNYA agar tetap satu kesatuan gagasan.
  //  - Paragraf yang melebihi maxChars dipecah per kalimat (tetap dalam paragraf itu).
  chunkText(pagesData, options = {}) {
    // Parameter fallback untuk compatibility format lama (string)
    if (typeof pagesData === 'string') {
        pagesData = [{ pageNumber: 1, text: pagesData }];
    }

    const maxChars = options.maxChars || 1200;
    const minChars = options.minChars || 80;
    const chunks = [];

    const appendToLast = (text, pageNumber) => {
      if (chunks.length > 0) chunks[chunks.length - 1].text += `\n${text}`;
      else chunks.push({ text, page: pageNumber });
    };

    for (const page of pagesData) {
      if (this.isCoverPage(page.text)) {
        continue; // Skip halaman cover
      }

      const paragraphs = page.text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
      let carry = ''; // fragmen pendek yang menunggu digabung ke paragraf berikutnya

      for (const rawPara of paragraphs) {
        const para = carry ? `${carry}\n${rawPara}` : rawPara;
        carry = '';

        // Masih terlalu pendek → bawa ke paragraf berikutnya (jangan dibuang).
        if (para.length < minChars) {
          carry = para;
          continue;
        }

        // Paragraf normal → satu chunk utuh (satu ide pokok).
        if (para.length <= maxChars) {
          chunks.push({ text: para, page: page.pageNumber });
          continue;
        }

        // Paragraf terlalu panjang → pecah per kalimat agar tetap di bawah maxChars.
        const sentences = this.splitIntoSentences(para);
        let buf = [];
        let len = 0;
        const flush = () => {
          if (!buf.length) return;
          const text = buf.join(' ').trim();
          if (text.length >= minChars) chunks.push({ text, page: page.pageNumber });
          else appendToLast(text, page.pageNumber);
          buf = []; len = 0;
        };
        for (const sentence of sentences) {
          if (len + sentence.length > maxChars && buf.length > 0) flush();
          buf.push(sentence);
          len += sentence.length + 1;
        }
        flush();
      }

      // Sisa fragmen pendek di akhir halaman → tempel ke chunk terakhir.
      if (carry) appendToLast(carry, page.pageNumber);
    }

    // Filter duplikat teks lintas chunk
    const uniqueChunks = [];
    const seenTexts = new Set();
    for (const c of chunks) {
      if (!seenTexts.has(c.text)) {
        seenTexts.add(c.text);
        uniqueChunks.push(c);
      }
    }
    return uniqueChunks;
  }
};

module.exports = chunkingService;
