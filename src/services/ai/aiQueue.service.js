// src/services/ai/aiQueue.service.js

const AI_QUEUE_CONCURRENCY = parseInt(process.env.AI_QUEUE_CONCURRENCY || '4', 10);
const AI_QUEUE_MAX_WAITING = parseInt(process.env.AI_QUEUE_MAX_WAITING || '80', 10);
const AI_QUEUE_JOB_TIMEOUT_MS = parseInt(process.env.AI_QUEUE_JOB_TIMEOUT_MS || '20000', 10);

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('AI_QUEUE_JOB_TIMEOUT');
        error.code = 'AI_QUEUE_JOB_TIMEOUT';
        reject(error);
      }, timeoutMs);
    })
  ]);
}

const aiQueueService = {
  running: 0,
  waiting: [],

  getStatus() {
    return {
      running: this.running,
      waiting: this.waiting.length,
      concurrency: AI_QUEUE_CONCURRENCY,
      maxWaiting: AI_QUEUE_MAX_WAITING
    };
  },

  canAccept() {
    return this.waiting.length < AI_QUEUE_MAX_WAITING;
  },

  add(taskFn, meta = {}) {
    if (typeof taskFn !== 'function') {
      return Promise.reject(new Error('AI_QUEUE_TASK_MUST_BE_FUNCTION'));
    }

    if (!this.canAccept()) {
      return Promise.resolve({
        ok: false,
        queueFallback: true,
        text: null,
        model: null,
        queueStatus: this.getStatus()
      });
    }

    return new Promise((resolve) => {
      this.waiting.push({
        taskFn,
        meta,
        resolve,
        createdAt: Date.now()
      });

      this._next();
    });
  },

  _next() {
    while (this.running < AI_QUEUE_CONCURRENCY && this.waiting.length > 0) {
      const job = this.waiting.shift();
      this.running += 1;

      const queueWaitMs = Date.now() - job.createdAt;

      console.log('[AI Queue] Start job', {
        running: this.running,
        waiting: this.waiting.length,
        queueWaitMs,
        meta: job.meta
      });

      withTimeout(Promise.resolve().then(job.taskFn), AI_QUEUE_JOB_TIMEOUT_MS)
        .then((result) => {
          job.resolve({
            ...result,
            queueStatus: this.getStatus(),
            queueWaitMs
          });
        })
        .catch((error) => {
          console.error('[AI Queue] Job error:', error.message);

          job.resolve({
            ok: false,
            queueFallback: false,
            errorFallback: true,
            errorCode: error.code || 'AI_QUEUE_ERROR',
            errorMessage: error.message,
            text: null,
            model: null,
            queueStatus: this.getStatus(),
            queueWaitMs
          });
        })
        .finally(() => {
          this.running = Math.max(0, this.running - 1);
          this._next();
        });
    }
  }
};

module.exports = aiQueueService;
