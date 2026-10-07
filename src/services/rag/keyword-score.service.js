// src/services/rag/keyword-score.service.js
// [v0.9.92] Perbaikan relevansi:
//  • Kata kunci juga dicocokkan ke JUDUL & TOPIK dokumen (dulu hanya isi chunk).
//  • Alias ID↔EN ringan (blok→block) + toleransi salah ketik (guttenberg→gutenberg).
//  • Frasa "subjek" (tanpa "apa itu") dipakai untuk pencocokan judul.

const STOPWORDS = [
  'apa', 'itu', 'ini', 'dan', 'yang', 'di', 'ke', 'dari', 'pada',
  'dalam', 'untuk', 'dengan', 'adalah', 'sebagai', 'bagaimana',
  'kenapa', 'mengapa', 'kapan', 'siapa', 'atau', 'akan', 'bisa', 'ada',
  // TAMBAHAN KATA FILLER & GAUL:
  'cara', 'gimana', 'kalo', 'kalau', 'buat', 'nya', 'sih', 'dong', 'terus', 'lalu', 'ya'
];

// Alias kata Indonesia → bentuk yang sering muncul di materi (judul/isi berbahasa Inggris).
const ALIASES = {
  blok: ['block'],
  bloks: ['block'],
  pengaya: ['plugin'],
  tema: ['theme'],
  halaman: ['page'],
  tulisan: ['post'],
  gambar: ['image']
};

function levenshtein(a, b, maxDist) {
  if (a === b) return 0;
  const la = a.length; const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[lb];
}

function tokenize(text = '') {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
}

// Apakah kata `word` "ada" di teks? (langsung → alias → fuzzy untuk kata ≥5 huruf)
function wordHit(word, text, tokens) {
  if (!word || !text) return false;
  if (text.includes(word)) return true;
  const aliases = ALIASES[word];
  if (aliases && aliases.some((a) => text.includes(a))) return true;
  if (word.length >= 5) {
    const maxDist = word.length >= 9 ? 2 : 1;
    for (const t of tokens) {
      if (Math.abs(t.length - word.length) > maxDist) continue;
      if (levenshtein(word, t, maxDist) <= maxDist) return true;
    }
  }
  return false;
}

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

    // 1. Exact Phrase Match — pakai SUBJEK (tanpa "apa itu") agar judul bisa cocok.
    const phrases = [...new Set([lowerQuery, subject].filter((p) => p && p.length > 3))];
    phrases.forEach((phrase) => {
      if (title.includes(phrase) || topic.includes(phrase)) score += (phrase === subject && phrase !== lowerQuery) ? 60 : 80;
      if (content.includes(phrase)) score += 20;
    });
    // (Skor frasa dibatasi agar subjek === query tidak dihitung ganda.)

    // 2. Query Terms Appearance (isi chunk) — langsung / alias / fuzzy.
    const contentTokens = tokenize(content);
    const titleTokens = tokenize(title);
    const topicTokens = tokenize(topic);

    let termMatches = 0;
    keywords.forEach(word => {
      if (wordHit(word, content, contentTokens)) termMatches++;
    });

    if (termMatches === keywords.length && keywords.length > 0) {
      score += 15;
    } else {
      score += (termMatches * 2);
    }

    // 2b. [BARU] Kata kunci di JUDUL / TOPIK dokumen — sinyal paling kuat.
    let titleHits = 0;
    keywords.forEach(word => {
      if (wordHit(word, title, titleTokens)) { titleHits++; score += 12; }
      else if (wordHit(word, topic, topicTokens)) { score += 6; }
    });
    if (keywords.length > 0 && titleHits === keywords.length) score += 30;

    // 3. Heading / Section Match (+10)
    if (keywords.length > 0) {
      const headingRegex = new RegExp(`(?:^|\n)\\s*${keywords.join('\\s+')}\\s*(?:\n|$)`, 'i');
      if (headingRegex.test(content) || content.startsWith(lowerQuery)) score += 10;
    }

    // 4. Definitional Query Boost
    if (isDefinitional && subject.length > 2) {
      const defPatterns = [
        `${subject} adalah`, `pengertian ${subject}`, `${subject} merupakan`,
        `${subject} yaitu`, `${subject} disebut`
      ];
      for (const pattern of defPatterns) {
        if (content.includes(pattern)) { score += 50; break; }
      }
    }

    // 5. Types / List Query Boost
    const isTypeQuery = /(jenis|macam|sebutkan|contoh|apa saja)/.test(lowerQuery);
    if (isTypeQuery) {
      const typeSubject = lowerQuery.replace(/(sebutkan|jenis|macam|contoh|apa saja|jenis-jenis|\s+)+/g, ' ').trim();
      const typePatterns = [`jenis-jenis ${typeSubject}`, `jenis ${typeSubject}`, `tipe`, `contoh`, `fungsi utama`];
      let typeBoosted = false;
      for (const pattern of typePatterns) {
        if (content.includes(pattern)) { score += 40; typeBoosted = true; break; }
      }
      if (!typeBoosted && (content.includes("jenis") || content.includes("contoh") || content.includes("tipe"))) {
        score += 15;
      }
    }

    // 6. Comparison Query Boost
    const isCompareQuery = /(perbedaan|bandingkan|vs|dibandingkan|beda)/.test(lowerQuery);
    if (isCompareQuery) {
      const comparePatterns = [`vs`, `perbedaan`, `perbandingan`, `aspek`, `interaktivitas`];
      for (const pattern of comparePatterns) {
        if (content.includes(pattern)) { score += 40; break; }
      }
    }

    return score;
  }
};

module.exports = keywordScoreService;
