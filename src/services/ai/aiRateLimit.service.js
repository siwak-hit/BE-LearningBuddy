const AI_MAX = parseInt(process.env.AI_MAX_USAGE_PER_WINDOW) || 3;
// [v0.9.85] Cooldown per-siswa dipangkas ke 60 dtk (dulu 180) supaya konsisten dengan
// "sesi AI reset tiap 1 menit". Cooldown ini yang muncul saat request AI ke-4.
const COOLDOWN_MS = (parseInt(process.env.AI_COOLDOWN_SECONDS) || 60) * 1000;
// [v0.9.85] Jendela sesi AI per-siswa: kalau tidak ada request AI selama 60 dtk, hitungan
// used direset ke 0 (sliding window). Jadi 3 request beruntun → cooldown, tapi kalau
// jeda >1 menit, hitungan mulai dari 0 lagi.
const USER_WINDOW_MS = (parseInt(process.env.AI_USER_WINDOW_SECONDS) || 60) * 1000;

// [v0.9.58] Kuota AI BERSAMA berbasis JENDELA 1 JAM. Persentase NAIK tiap jawaban AI dan
// TIDAK pernah turun dalam jendela; saat mencapai budget → AI dinonaktifkan (exhausted).
// Jendela di-reset otomatis 1 jam setelah pemakaian PERTAMA — dihitung saat diakses (lazy),
// TANPA cron. Tujuan: cegah AI kebanjiran request barengan.
const HOURLY_GLOBAL_BUDGET = parseInt(process.env.AI_HOURLY_GLOBAL_BUDGET) || 30;
const GLOBAL_WINDOW_MS = parseInt(process.env.AI_GLOBAL_WINDOW_MS) || 3600000; // 1 jam

const aiRateLimitService = {
  users: new Map(),
  // windowStart = waktu request AI pertama pada jendela berjalan; count = jumlah jawaban AI.
  globalUsage: { windowStart: 0, count: 0 },

  // Reset lazy: kalau jendela sudah lewat 1 jam sejak pemakaian pertama → kosongkan.
  _ensureGlobalWindow() {
    const now = Date.now();
    if (this.globalUsage.windowStart && (now - this.globalUsage.windowStart) >= GLOBAL_WINDOW_MS) {
      this.globalUsage = { windowStart: 0, count: 0 };
    }
  },

  // Dicatat tiap 1 permintaan AI dikirim ke Gemini (≈ per jawaban AI).
  recordGlobalRequest() {
    this._ensureGlobalWindow();
    if (!this.globalUsage.windowStart) this.globalUsage.windowStart = Date.now();
    this.globalUsage.count += 1;
  },

  // Google menolak (kuota Google benar-benar habis) → paksa penuh untuk sisa jendela.
  markGlobalExhausted() {
    if (!this.globalUsage.windowStart) this.globalUsage.windowStart = Date.now();
    this.globalUsage.count = Math.max(this.globalUsage.count, HOURLY_GLOBAL_BUDGET);
  },

  // Dipakai endpoint /chat/ai-usage-global (bar) & gate AI di chat.service.
  getGlobalUsage() {
    this._ensureGlobalWindow();
    const budget = HOURLY_GLOBAL_BUDGET;
    const count = this.globalUsage.count;
    const percent = budget > 0 ? Math.min(100, Math.round((count / budget) * 100)) : 0;
    const exhausted = count >= budget;
    const resetsAt = this.globalUsage.windowStart ? this.globalUsage.windowStart + GLOBAL_WINDOW_MS : 0;
    const resetsInSeconds = resetsAt ? Math.max(0, Math.ceil((resetsAt - Date.now()) / 1000)) : 0;
    return {
      used: count,
      budget,
      percent,
      busy: percent >= 80,
      exhausted,
      rate_limited: exhausted,
      resets_at: resetsAt,
      resets_in_seconds: resetsInSeconds,
      resets_at_label: 'kuota AI bersama direset otomatis 1 jam setelah pemakaian pertama'
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

    // [v0.9.85] Sliding window: idle >60 dtk sejak request AI terakhir → reset hitungan.
    if (userData.lastUsedAt && (now - userData.lastUsedAt) >= USER_WINDOW_MS && Number(userData.used || 0) > 0) {
      this.users.set(sessionId, { used: 0, cooldownEndsAt: null, limitReached: false, lastUsedAt: 0 });
      return this._defaultStatus();
    }

    const used = Number(userData.used || 0);
    const limitReached = used >= AI_MAX || Boolean(userData.limitReached);
    const windowRemaining = userData.lastUsedAt
      ? Math.max(0, Math.ceil((userData.lastUsedAt + USER_WINDOW_MS - now) / 1000))
      : 0;

    return {
      used,
      max: AI_MAX,
      remaining: Math.max(0, AI_MAX - used),
      limit_reached: limitReached,
      cooldown_active: false,
      cooldown_remaining_seconds: 0,
      window_remaining_seconds: windowRemaining,
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
      limitReached,
      lastUsedAt: Date.now() // [v0.9.85] penanda sliding window 1 menit
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
      window_remaining_seconds: 0,
      canUseAI: true
    };
  }
};

module.exports = aiRateLimitService;
