const AI_MAX = parseInt(process.env.AI_MAX_USAGE_PER_WINDOW) || 3;
const COOLDOWN_MS = (parseInt(process.env.AI_COOLDOWN_SECONDS) || 180) * 1000;

const aiRateLimitService = {
  users: new Map(),

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
