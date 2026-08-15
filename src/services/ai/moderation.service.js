// [v0.9.91] Dependensi `indonesian-badwords` DIHAPUS: daftarnya luas & cocok substring,
// jadi jadi sumber utama false positive (mis. "sosial"→"sial", "detail"→"tai"). Daftar
// makian kini eksplisit dan dicocokkan sebagai kata utuh — lihat ALWAYS_PROFANE.

const moderationService = {
  checkMessage(message) {
    const originalMessage = message || '';
    const normalizedMessage = normalizeText(originalMessage);

    // =========================
    // 1. Hate Speech / Kekerasan / SARA
    // =========================
    // [v0.9.91] DIPERSEMPIT DRASTIS. Versi lama memuat kata sehari-hari seperti
    // 'mati', 'hancur', 'rusak', 'bom', 'serang', 'benci' sebagai kata TUNGGAL, sehingga
    // pertanyaan wajar ikut diblokir — mis. "batre hp abis dan tiba tiba mati, kuisnya
    // gimana?" dianggap ujaran kebencian. Sekarang yang diblokir hanya ANCAMAN yang
    // ditujukan ke orang (kata kerja + sasaran) dan frasa kebencian yang tak punya
    // makna netral. Kata kerja kekerasan sendirian TIDAK lagi cukup untuk memblokir.
    const hateWords = [
      // Ancaman ke orang: kata kerja kekerasan HARUS punya sasaran.
      'bunuh kamu', 'bunuh dia', 'bunuh lu', 'bunuh lo', 'bunuh aja', 'gua bunuh', 'aku bunuh',
      'kubunuh', 'bunuhin', 'membunuhmu',
      'bacok kamu', 'bacok lu', 'bacok lo', 'gua bacok',
      'tusuk kamu', 'tusuk lu', 'tikam kamu',
      'hajar kamu', 'hajar lu', 'hajar lo', 'gua hajar',
      'gebukin lu', 'gebukin lo', 'bantai lu', 'bantai lo',
      'cekik kamu', 'racun kamu',
      'mati aja lu', 'mati aja lo', 'mati kamu', 'matilah kamu', 'mampus lu', 'mampus lo',
      'semoga mati', 'biar mati aja',

      // Kebencian kelompok — frasa, bukan kata tunggal.
      'agama sampah', 'ras sampah', 'suku sampah', 'kaum rendah', 'dasar kaum',
      'tidak pantas hidup', 'gak pantas hidup', 'usir mereka', 'basmi mereka',
      'dasar kafir', 'dasar sesat', 'dasar najis'
    ];

    // =========================
    // 2. Stress / Burnout / Mental Health Signal
    // =========================
    const stressWords = [
      'capek',
      'cape',
      'lelah',
      'letih',
      'penat',
      'pusing',
      'mumet',
      'stres',
      'stress',
      'str3s',
      'burnout',
      'jenuh',
      'bosan',
      'tertekan',
      'terbebani',
      'overthinking',
      'cemas',
      'takut',
      'panik',
      'anxiety',
      'sedih',
      'hampa',
      'kosong',
      'sendirian',
      'kesepian',
      'down',
      'depresi',
      'depressed',
      'putus asa',
      'menyerah',
      'nyerah',
      'gak sanggup',
      'ga sanggup',
      'tidak sanggup',
      'aku gagal',
      'gagal terus',
      'aku bodoh',
      'aku bego',
      'aku tolol',
      'cape hidup',
      'capek hidup',
      'malas hidup',
      'hidup berat',
      'pengen hilang',
      'ingin hilang',
      'pengen tidur terus',
      'tidak kuat lagi',
      'gak kuat lagi',
      'ga kuat lagi'
    ];

    // =========================
    // PRIORITAS 1: Hate Speech
    // =========================
    if (containsAny(normalizedMessage, hateWords)) {
      // [v0.9.84] Ikut sertakan versi tersensor supaya pesan yang tersimpan & tampil
      // di chat tidak memuat kata aslinya (sama seperti jalur profanity).
      const hateHits = hateWords.filter((w) => normalizedMessage.includes(w));
      return {
        isFlagged: true,
        type: 'hate_speech',
        severity: 'critical',
        responseMessage:
          'Maaf, aku tidak bisa menanggapi pesan yang mengandung unsur kebencian, ancaman, atau SARA. Mari kita fokus ke materi pelajaran ya!',
        censoredText: safeCensor(originalMessage, hateHits),
        detectedWords: hateHits
      };
    }

    // =========================
    // PRIORITAS 2: Kata Kasar / Profanity
    // =========================
    const profanityHit = detectWholeWordProfanity(originalMessage, normalizedMessage);
    if (profanityHit.isFlagged) {
      return {
        isFlagged: true,
        type: 'profanity',
        severity: 'high',
        responseMessage:
          'Aku paham kamu mungkin sedang kesal. Coba gunakan bahasa yang lebih sopan ya, supaya aku bisa bantu belajarmu dengan baik.',
        censoredText: safeCensor(originalMessage, profanityHit.detectedWords),
        detectedWords: profanityHit.detectedWords
      };
    }

    // =========================
    // PRIORITAS 3: Indikasi Burnout / Stres
    // =========================
    if (containsAny(normalizedMessage, stressWords)) {
      return {
        isFlagged: true,
        type: 'mental_health',
        severity: 'low',
        responseMessage:
          'Sepertinya kamu sedang lelah atau jenuh. Jangan lupa istirahat sejenak, minum air putih, dan tarik napas panjang ya. Kalau sudah siap, kita bisa lanjut belajar lagi!'
      };
    }

    // Aman
    return {
      isFlagged: false
    };
  }
};

// =========================
// Helper: Normalisasi teks
// =========================
function normalizeText(text) {
  return text
    .toLowerCase()

    // Ubah angka/simbol yang sering dipakai untuk menyamarkan huruf
    .replace(/4/g, 'a')
    .replace(/@/g, 'a')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/\|/g, 'i')
    .replace(/3/g, 'e')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/\$/g, 's')
    .replace(/7/g, 't')
    .replace(/\+/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g')

    // Hapus karakter aneh, tapi sisakan huruf, angka, dan spasi
    .replace(/[^a-z0-9\s]/g, '')

    // Gabungkan spasi berlebihan
    .replace(/\s+/g, ' ')

    .trim();
}

function containsAny(text, words) {
  return words.some((word) => {
    const normalizedWord = normalizeText(word);

    // Cocok untuk frasa, contoh: "tidak sanggup"
    if (normalizedWord.includes(' ')) {
      return text.includes(normalizedWord);
    }

    // Cocok untuk kata tunggal
    const regex = new RegExp(`\\b${escapeRegex(normalizedWord)}\\b`, 'i');
    return regex.test(text);
  });
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// [v0.9.91] Makian yang maknanya TUNGGAL — tidak ada pemakaian netral dalam bahasa
// Indonesia, jadi aman diblokir tanpa melihat konteks. Cocok sebagai KATA UTUH; angka
// penyamar (beg0, t0l0l, g0bl0k) sudah dinormalkan lebih dulu oleh normalizeText().
const ALWAYS_PROFANE = [
  // Hinaan kecerdasan
  'bego', 'begok', 'goblok', 'goblog', 'tolol', 'dongo', 'dungu', 'idiot', 'bodoh banget',
  // Makian umum
  'bangsat', 'bajingan', 'keparat', 'brengsek', 'sialan', 'jancok', 'jancuk', 'cok',
  'asu', 'kampret', 'tai', 'taik', 'setan lu', 'setan lo',
  // Alat kelamin / seksual
  'kontol', 'memek', 'pepek', 'itil', 'ngentot', 'ngentod', 'entot', 'peju', 'pantek'
];

// Nama hewan: makian HANYA kalau dipakai untuk mengumpat/meledek. Dalam pertanyaan
// pelajaran ("apa itu anjing laut", "kenapa babi tidak dimakan") ini kata biasa.
const ANIMAL_INSULTS = ['anjing', 'anjir', 'anjay', 'babi', 'monyet', 'kunyuk', 'bangke', 'kadal'];

// Penanda bahwa kalimatnya BERTANYA/membahas, bukan mengumpat.
const INFORMATIONAL_RE = /\b(apa|apakah|kenapa|mengapa|bagaimana|gimana|jelaskan|jelasin|maksud|arti|pengertian|definisi|contoh|jenis|hewan|binatang|spesies|ternak|peliharaan|daging|gambar|materi|tentang|laut|liar)\b/;

// Penanda bahwa kata hewan itu memang dipakai sebagai umpatan/ledekan.
const INSULT_MARKER_RE = /\b(dasar|si|dah|banget|bgt|amat|lu|lo|loe|kamu|elu|kau|nih|deh|woy|woi)\b/;

function matchesWholeWord(word, normalized) {
  return new RegExp(`\\b${escapeRegex(normalizeText(word))}\\b`, 'i').test(normalized);
}

function detectWholeWordProfanity(originalMessage = '', normalizedMessage = '') {
  const normalized = normalizeText(originalMessage || normalizedMessage || '');

  const detected = ALWAYS_PROFANE.filter((word) => matchesWholeWord(word, normalized));

  // Kata hewan butuh konteks: ada penanda umpatan DAN tidak sedang dibahas sebagai topik.
  const isInformational = INFORMATIONAL_RE.test(normalized);
  const hasInsultMarker = INSULT_MARKER_RE.test(normalized);
  if (!isInformational && hasInsultMarker) {
    ANIMAL_INSULTS.forEach((word) => {
      if (matchesWholeWord(word, normalized)) detected.push(word);
    });
  }

  return { isFlagged: detected.length > 0, detectedWords: [...new Set(detected)] };
}

// [v0.9.84] Jumlah bintang = panjang katanya, jadi "BEGO banget" → "**** banget"
// (bentuk kalimatnya tetap terbaca, katanya saja yang tertutup).
function safeCensor(text = '', words = []) {
  let result = String(text || '');
  words.forEach((word) => {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    result = result.replace(re, (match) => '*'.repeat(match.length));
  });
  return result;
}

module.exports = moderationService;
