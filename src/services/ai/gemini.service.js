// src/services/ai/gemini.service.js
const { GoogleGenAI } = require('@google/genai');
const aiRateLimitService = require('./aiRateLimit.service');

// Daftar model terbaru yang aktif, diurutkan dari yang paling ringan/murah ke berat
const MODEL_CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.5-flash'
];

const geminiService = {
  async generateWithFallback(promptText) {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY belum dikonfigurasi di file .env');
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    // [v0.9.3] Catat 1 permintaan AI bersama (proxy RPD untuk bar kuota di FE).
    try { aiRateLimitService.recordGlobalRequest(); } catch (_) {}

    // LOOP: Coba satu per satu modelnya
    for (let modelName of MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: promptText,
          config: {
            temperature: 0.4,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 1024
          }
        });

        if (!response.text) {
          throw new Error('Format response dari Gemini kosong.');
        }

        // BERHASIL! Kembalikan teks dan nama model yang dipakai
        return {
          ok: true,
          model: modelName,
          text: response.text,
          quotaFallback: false
        };

      } catch (error) {
        const errorMessage = error.message || '';

        // Deteksi apakah ini error kuota / limit harian
        const isQuotaError =
          errorMessage.includes('429') ||
          errorMessage.includes('RESOURCE_EXHAUSTED') ||
          errorMessage.toLowerCase().includes('quota');

        // Deteksi apakah model sudah dihapus/deprecated oleh Google
        const isNotFoundError =
          errorMessage.includes('404') ||
          errorMessage.includes('NOT_FOUND');

        // Jika error karena Kuota Habis ATAU Model Tidak Ditemukan, coba model berikutnya
        if (isQuotaError || isNotFoundError) {
          console.warn(`⚠️ [Gemini] Model ${modelName} gagal (Limit/Not Found). Mencoba model berikutnya...`);
          continue;
        } else {
          // Error lain (seperti API Key salah atau masalah jaringan kritis)
          console.error(`❌ [Gemini Error SDK pada ${modelName}]`, errorMessage);
          throw error;
        }
      }
    }

    // Jika loop selesai tapi tidak ada yang me-return sukses, berarti SEMUA model gagal/limit
    console.error('🚨 [Gemini] SEMUA MODEL TELAH MENCAPAI LIMIT KUOTA HARIAN ATAU TIDAK TERSEDIA.');
    return {
      ok: false,
      model: null,
      text: null,
      quotaFallback: true // Flag penting untuk trigger Pesan Fallback Quota di UI
    };
  }
};

module.exports = geminiService;
