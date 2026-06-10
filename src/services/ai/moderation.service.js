const badwords = require('indonesian-badwords');

const moderationService = {
  checkMessage(message) {
    const originalMessage = message || '';
    const normalizedMessage = normalizeText(originalMessage);

    // =========================
    // 1. Hate Speech / Kekerasan / SARA
    // =========================
    const hateWords = [
      // Kekerasan / ancaman
      'bunuh',
      'membunuh',
      'dibunuh',
      'ngebunuh',
      'habisi',
      'menghabisi',
      'hajar',
      'pukul',
      'gebuk',
      'gebukin',
      'bantai',
      'membantai',
      'serang',
      'menyerang',
      'tikam',
      'tusuk',
      'bacok',
      'tembak',
      'gantung',
      'cekik',
      'racun',
      'ledakkan',
      'bom',
      'mati',
      'matilah',
      'mampus',
      'modar',
      'lenyapkan',
      'hancurkan',
      'hancur',
      'rusak',
      'rusakin',

      // Kebencian / penghinaan kelompok
      'rasis',
      'sara',
      'diskriminasi',
      'diskriminatif',
      'hina',
      'menghina',
      'benci',
      'kebencian',
      'usir',
      'usir mereka',
      'tidak pantas hidup',
      'rendahan',
      'kaum rendah',
      'dasar kaum',

      // Agama / identitas yang sering jadi bahan serangan
      // Catatan: kata ini tidak selalu hate speech, tapi kalau muncul sebaiknya dipantau.
      'kafir',
      'sesat',
      'najis',
      'agama sampah',
      'ras sampah',
      'suku sampah'
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
      return {
        isFlagged: true,
        type: 'hate_speech',
        severity: 'critical',
        responseMessage:
          'Maaf, aku tidak bisa menanggapi pesan yang mengandung unsur kebencian, ancaman, atau SARA. Mari kita fokus ke materi pelajaran ya!'
      };
    }

    // =========================
    // PRIORITAS 2: Kata Kasar / Profanity
    // =========================
    if (badwords.flag(originalMessage) || badwords.flag(normalizedMessage)) {
      return {
        isFlagged: true,
        type: 'profanity',
        severity: 'high',
        responseMessage:
          'Aku paham kamu mungkin sedang kesal. Coba gunakan bahasa yang lebih sopan ya, supaya aku bisa bantu belajarmu dengan baik.',
        censoredText: badwords.censor(originalMessage),
        detectedWords: badwords.badwords(originalMessage)
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

module.exports = moderationService;
