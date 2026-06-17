const AI_MAX = parseInt(process.env.AI_MAX_USAGE_PER_WINDOW) || 3;
const COOLDOWN_MS = (parseInt(process.env.AI_COOLDOWN_SECONDS) || 180) * 1000;
// [v0.9.1] Anggaran harian GLOBAL (gabungan semua user) untuk kuota gratis Gemini.
// Reset otomatis tiap hari (zona Asia/Jakarta). Bisa diatur via env.
const DAILY_GLOBAL_BUDGET = parseInt(process.env.AI_DAILY_GLOBAL_BUDGET) || 250;
// Lama bar ditahan "penuh" setelah Google membalas 429 (default 10 menit). Limit per-menit
// (RPM/TPM) pulih sendiri; bila memang kuota harian, akan ditandai ulang tiap kali dicoba.
const GLOBAL_EXHAUST_TTL_MS = parseInt(process.env.AI_GLOBAL_EXHAUST_TTL_MS) || 600000;

const aiRateLimitService = {
  users: new Map(),
  // Penghitung pemakaian AI bersama (per hari Pasifik, mengikuti reset RPD Google).
  globalUsage: { day: null, count: 0, exhaustedUntil: 0 },

  _pacificDay() {
    // YYYY-MM-DD menurut zona America/Los_Angeles (acuan reset RPD Gemini).
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  },

  _ensureGlobalDay() {
    const day = this._pacificDay();
    if (this.globalUsage.day !== day) this.globalUsage = { day, count: 0, exhaustedUntil: 0 };
  },

  // [v0.9.3] Dicatat tiap kali KITA mengirim 1 permintaan ke Gemini (RPD proxy).
  recordGlobalRequest() {
    this._ensureGlobalDay();
    this.globalUsage.count += 1;
  },

  // [v0.9.2] Dipanggil saat Gemini menolak karena kuota/sibuk (quota_fallback).
  // Memaksa bar menampilkan PENUH walau penghitung lokal belum mencapai budget —
  // karena kenyataannya kuota gratis Gemini di Google sudah habis hari ini.
  markGlobalExhausted() {
    this._ensureGlobalDay();
    this.globalUsage.exhaustedUntil = Date.now() + GLOBAL_EXHAUST_TTL_MS;
  },

  // Dipakai endpoint /chat/ai-usage-global → bar pemakaian AI bersama di FE.
  getGlobalUsage() {
    this._ensureGlobalDay();

    const budget = DAILY_GLOBAL_BUDGET;
    const now = Date.now();
    const rateLimited = now < (this.globalUsage.exhaustedUntil || 0);
    const exhausted = rateLimited || this.globalUsage.count >= budget;
    const used = exhausted ? Math.max(this.globalUsage.count, budget) : this.globalUsage.count;
    const percent = exhausted ? 100 : (budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0);
    return {
      used,
      budget,
      percent,
      busy: percent >= 90,
      exhausted,
      rate_limited: rateLimited,
      resets_at_label: 'reset harian tengah malam waktu Pasifik (kira-kira siang-sore WIB)',
      day: this.globalUsage.day
    };
  },

  getStatus(sessionId) {
    if (!sessionId) return this._defaultStatus();

    const now = Date.now();
    const userData = this.users.get(sessionId);

    if (!userData) return this._defaultStatus();

    if (userData.cooldownEndsAt) {
      if (now >= userData.cooldownEndsAt) {
        this.users.set(sessionId, {
          used: 0,
          cooldownEndsAt: null,
          limitReached: false
        });

        return this._defaultStatus();
      }

      const remainingSeconds = Math.ceil((userData.cooldownEndsAt - now) / 1000);

      return {
        used: AI_MAX,
        max: AI_MAX,
        remaining: 0,
        limit_reached: true,
        cooldown_active: true,
        cooldown_remaining_seconds: remainingSeconds,
        canUseAI: false
      };
    }

    const used = Number(userData.used || 0);
    const limitReached = used >= AI_MAX || Boolean(userData.limitReached);

    return {
      used,
      max: AI_MAX,
      remaining: Math.max(0, AI_MAX - used),
      limit_reached: limitReached,
      cooldown_active: false,
      cooldown_remaining_seconds: 0,
      canUseAI: !limitReached
    };
  },

  consume(sessionId) {
    if (!sessionId) return this._defaultStatus();

    const currentStatus = this.getStatus(sessionId);

    if (currentStatus.cooldown_active || currentStatus.limit_reached) {
      return currentStatus;
    }

    const newUsed = Math.min(AI_MAX, Number(currentStatus.used || 0) + 1);
    const limitReached = newUsed >= AI_MAX;

    this.users.set(sessionId, {
      used: newUsed,
      cooldownEndsAt: null,
      limitReached
    });

    // Catatan: penghitung GLOBAL kini dicatat di gemini.service (recordGlobalRequest)
    // saat request benar-benar dikirim — jadi tidak di-bump lagi di sini.

    return this.getStatus(sessionId);
  },

  startCooldown(sessionId) {
    if (!sessionId) return this._defaultStatus();

    const now = Date.now();

    this.users.set(sessionId, {
      used: AI_MAX,
      cooldownEndsAt: now + COOLDOWN_MS,
      limitReached: true
    });

    return this.getStatus(sessionId);
  },

  _defaultStatus() {
    return {
      used: 0,
      max: AI_MAX,
      remaining: AI_MAX,
      limit_reached: false,
      cooldown_active: false,
      cooldown_remaining_seconds: 0,
      canUseAI: true
    };
  }
};

module.exports = aiRateLimitService;
