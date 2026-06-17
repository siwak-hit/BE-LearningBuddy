// src/services/rag/keyword-score.service.js

const STOPWORDS = [
  'apa', 'itu', 'ini', 'dan', 'yang', 'di', 'ke', 'dari', 'pada',
  'dalam', 'untuk', 'dengan', 'adalah', 'sebagai', 'bagaimana',
  'kenapa', 'mengapa', 'kapan', 'siapa', 'atau', 'akan', 'bisa', 'ada',
  // TAMBAHAN KATA FILLER & GAUL:
  'cara', 'gimana', 'kalo', 'kalau', 'buat', 'nya', 'sih', 'dong', 'terus', 'lalu', 'ya'
];

const keywordScoreService = {
  normalize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOPWORDS.includes(word));
  },

  analyzeDefinitionalQuery(query) {
    const defRegex = /^(?:apa\s+itu|pengertian|jelaskan\s+pengertian|maksud\s+dari|definisi(?:\s+dari)?)\s+(.+)$/i;
    const match = query.trim().match(defRegex);
    if (match && match[1]) {
      return { isDefinitional: true, subject: match[1].replace(/[?]/g, '').trim().toLowerCase() };
    }
    return { isDefinitional: false, subject: query.replace(/[?]/g, '').trim().toLowerCase() };
  },

  calculateScore(item, query, pageContext) {
    let score = 0;
    const content = (item.content || '').toLowerCase();
    const title = (item.title || '').toLowerCase();
    const topic = (item.topic || '').toLowerCase();
    const lowerQuery = (query || '').toLowerCase().replace(/[?]/g, '').trim();

    const { isDefinitional, subject } = this.analyzeDefinitionalQuery(lowerQuery);
    const keywords = this.normalize(subject || lowerQuery);

    // 1. Exact Phrase Match (PERBAIKAN SKOR)
    // Tingkatkan skor signifikan jika query adalah subjek utama (berada di judul/topik)
    if (lowerQuery.length > 3) {
      if (title.includes(lowerQuery) || topic.includes(lowerQuery)) {
        score += 80; // Boost raksasa agar chunk dengan judul "WordPress" menang telak
      }
      if (content.includes(lowerQuery)) {
        score += 20;
      }
    }

    // 2. Query Terms Appearance
    let termMatches = 0;
    keywords.forEach(word => {
        if (content.includes(word)) termMatches++;
    });

    if (termMatches === keywords.length && keywords.length > 0) {
        score += 15; // Sedikit dinaikkan
    } else {
        score += (termMatches * 2);
    }

    // 3. Heading / Section Match (+10)
    // Pendeteksian frasa query berada di awal baris yang mengindikasikan ia sebagai judul/header
    const headingRegex = new RegExp(`(?:^|\n)\\s*${keywords.join('\\s+')}\\s*(?:\n|$)`, 'i');
    if (headingRegex.test(content) || content.startsWith(lowerQuery)) {
        score += 10;
    }

    // 4. Definitional Query Boost
    if (isDefinitional && subject.length > 2) {
      const defPatterns = [
        `${subject} adalah`,
        `pengertian ${subject}`,
        `${subject} merupakan`,
        `${subject} yaitu`,
        `${subject} disebut`
      ];
      for (const pattern of defPatterns) {
        if (content.includes(pattern)) {
          score += 50; // Boost raksasa agar mengalahkan chunk yang hanya me-mention subjek
          break;
        }
      }
    }

    // 5. Types / List Query Boost
    const isTypeQuery = /(jenis|macam|sebutkan|contoh|apa saja)/.test(lowerQuery);
    if (isTypeQuery) {
      const typeSubject = lowerQuery.replace(/(sebutkan|jenis|macam|contoh|apa saja|jenis-jenis|\s+)+/g, ' ').trim();
      const typePatterns = [
        `jenis-jenis ${typeSubject}`,
        `jenis ${typeSubject}`,
        `tipe`,
        `contoh`,
        `fungsi utama`
      ];
      let typeBoosted = false;
      for (const pattern of typePatterns) {
        if (content.includes(pattern)) {
          score += 40;
          typeBoosted = true;
          break;
        }
      }
      // Boost sekunder jika subjek utamanya tak terdeteksi dengan baik
      if (!typeBoosted && (content.includes("jenis") || content.includes("contoh") || content.includes("tipe"))) {
        score += 15;
      }
    }

    // 6. Comparison Query Boost
    const isCompareQuery = /(perbedaan|bandingkan|vs|dibandingkan|beda)/.test(lowerQuery);
    if (isCompareQuery) {
      const comparePatterns = [ `vs`, `perbedaan`, `perbandingan`, `aspek`, `interaktivitas` ];
      for (const pattern of comparePatterns) {
        if (content.includes(pattern)) {
          score += 40;
          break;
        }
      }
    }

    return score;
  }
};

module.exports = keywordScoreService;
