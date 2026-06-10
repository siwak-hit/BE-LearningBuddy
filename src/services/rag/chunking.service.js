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

  chunkText(pagesData, options = {}) {
    // Parameter fallback untuk compatibility format lama (string)
    if (typeof pagesData === 'string') {
        pagesData = [{ pageNumber: 1, text: pagesData }];
    }

    const maxChars = options.maxChars || 1200;
    const minChars = options.minChars || 80;
    const maxParagraphs = options.maxParagraphs || 3;
    const chunks = [];

    for (const page of pagesData) {
      if (this.isCoverPage(page.text)) {
        continue; // Skip halaman cover
      }

      const paragraphs = page.text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
      let currentChunkParams = [];
      let currentLength = 0;
      let overlapSentence = "";

      const pushChunk = (paragraphsArray) => {
        let chunkStr = paragraphsArray.join('\n\n');
        if (chunkStr.length >= minChars) {
          chunks.push({ text: chunkStr, page: page.pageNumber });
        }
      };

      for (const p of paragraphs) {
        if (p.length > maxChars) {
          if (currentChunkParams.length > 0) pushChunk(currentChunkParams);
          currentChunkParams = []; currentLength = 0;

          const sentences = this.splitIntoSentences(p);
          let tempSentenceChunk = [];
          let tempLen = overlapSentence.length;

          for (const sentence of sentences) {
            if (tempLen + sentence.length > maxChars && tempSentenceChunk.length > 0) {
              pushChunk(tempSentenceChunk);
              tempSentenceChunk = [sentence];
              tempLen = sentence.length;
            } else {
              tempSentenceChunk.push(sentence);
              tempLen += sentence.length + 1;
            }
          }
          if (tempSentenceChunk.length > 0) pushChunk(tempSentenceChunk);
          overlapSentence = "";
          continue;
        }

        if (currentChunkParams.length === 0 && overlapSentence) {
          currentChunkParams.push(overlapSentence);
          currentLength += overlapSentence.length;
        }

        if (currentLength + p.length > maxChars || currentChunkParams.length >= (maxParagraphs + (overlapSentence ? 1 : 0))) {
          pushChunk(currentChunkParams);
          currentChunkParams = overlapSentence ? [overlapSentence, p] : [p];
          currentLength = (overlapSentence ? overlapSentence.length + 2 : 0) + p.length;
        } else {
          currentChunkParams.push(p);
          currentLength += p.length + 2;
        }
      }

      if (currentChunkParams.length > 0) pushChunk(currentChunkParams);
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
