const AI_MAX = parseInt(process.env.AI_MAX_USAGE_PER_WINDOW) || 3;
const COOLDOWN_MS = (parseInt(process.env.AI_COOLDOWN_SECONDS) || 180) * 1000;

const aiRateLimitService = {
  users: new Map(),

  getStatus(sessionId) {
    if (!sessionId) return this._defaultStatus();

    const now = Date.now();
    const userData = this.users.get(sessionId);

    // Belum pernah hit AI
    if (!userData) return this._defaultStatus();

    // Cek apakah sedang cooldown
    if (userData.cooldownEndsAt) {
      if (now >= userData.cooldownEndsAt) {
        // Cooldown selesai, reset
        this.users.set(sessionId, { used: 0, cooldownEndsAt: null });
        return this._defaultStatus();
      } else {
        // Masih cooldown
        const remainingSeconds = Math.ceil((userData.cooldownEndsAt - now) / 1000);
        return {
          used: userData.used,
          max: AI_MAX,
          remaining: 0,
          cooldown_active: true,
          cooldown_remaining_seconds: remainingSeconds,
          canUseAI: false
        };
      }
    }

    // Ada usage, tidak cooldown
    return {
      used: userData.used,
      max: AI_MAX,
      remaining: AI_MAX - userData.used,
      cooldown_active: false,
      cooldown_remaining_seconds: 0,
      canUseAI: userData.used < AI_MAX
    };
  },

  consume(sessionId) {
    if (!sessionId) return this._defaultStatus();

    const now = Date.now();
    const currentStatus = this.getStatus(sessionId);

    // Update usage
    let newUsed = currentStatus.used + 1;
    let cooldownEndsAt = null;

    if (newUsed >= AI_MAX) {
      cooldownEndsAt = now + COOLDOWN_MS;
    }

    this.users.set(sessionId, {
      used: newUsed,
      cooldownEndsAt: cooldownEndsAt
    });

    return this.getStatus(sessionId);
  },

  _defaultStatus() {
    return {
      used: 0,
      max: AI_MAX,
      remaining: AI_MAX,
      cooldown_active: false,
      cooldown_remaining_seconds: 0,
      canUseAI: true
    };
  }
};

module.exports = aiRateLimitService;
