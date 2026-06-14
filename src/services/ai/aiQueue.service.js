// src/services/ai/aiQueue.service.js
// Queue AI yang lebih stabil untuk beban 200-400 user.
// Fitur:
// - global concurrency
// - per-session serialization ringan
// - max queue guard
// - timeout per job
// - priority sederhana untuk mode system/short/detail

const DEFAULT_CONCURRENCY = Math.max(1, parseInt(process.env.AI_QUEUE_CONCURRENCY || '4', 10));
const DEFAULT_MAX_QUEUE = Math.max(10, parseInt(process.env.AI_QUEUE_MAX_SIZE || '120', 10));
const DEFAULT_TIMEOUT_MS = Math.max(5000, parseInt(process.env.AI_QUEUE_TIMEOUT_MS || '20000', 10));

function priorityOf(meta = {}) {
  const mode = String(meta.responseMode || '').toLowerCase();
  if (mode === 'short') return 30;
  if (mode === 'detail') return 20;
  if (mode === 'system') return 40;
  return 10;
}

class AiQueueService {
  constructor() {
    this.concurrency = DEFAULT_CONCURRENCY;
    this.maxQueue = DEFAULT_MAX_QUEUE;
    this.running = 0;
    this.queue = [];
    this.sessionLocks = new Set();
    this.metrics = { accepted: 0, completed: 0, rejected: 0, failed: 0 };
  }

  getStatus() {
    return {
      running: this.running,
      queued: this.queue.length,
      concurrency: this.concurrency,
      maxQueue: this.maxQueue,
      metrics: this.metrics
    };
  }

  add(taskFn, meta = {}) {
    if (this.queue.length >= this.maxQueue) {
      this.metrics.rejected += 1;
      return Promise.resolve({
        ok: false,
        quotaFallback: true,
        text: 'Server AI sedang ramai. Coba beberapa saat lagi ya.',
        error: 'AI_QUEUE_FULL'
      });
    }

    this.metrics.accepted += 1;
    return new Promise((resolve) => {
      const job = {
        taskFn,
        meta,
        resolve,
        createdAt: Date.now(),
        priority: priorityOf(meta)
      };
      this.queue.push(job);
      this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      this.drain();
    });
  }

  canRun(job) {
    const sessionId = job?.meta?.sessionId;
    if (!sessionId) return true;
    return !this.sessionLocks.has(sessionId);
  }

  takeNextJob() {
    const index = this.queue.findIndex((job) => this.canRun(job));
    if (index < 0) return null;
    return this.queue.splice(index, 1)[0];
  }

  drain() {
    while (this.running < this.concurrency) {
      const job = this.takeNextJob();
      if (!job) break;
      this.run(job);
    }
  }

  async run(job) {
    this.running += 1;
    const sessionId = job?.meta?.sessionId;
    if (sessionId) this.sessionLocks.add(sessionId);

    const timeoutMs = Number(job?.meta?.timeoutMs || DEFAULT_TIMEOUT_MS);
    let timeoutId;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`AI queue timeout setelah ${Math.round(timeoutMs / 1000)} detik`)), timeoutMs);
      });

      const result = await Promise.race([job.taskFn(), timeoutPromise]);
      this.metrics.completed += 1;
      job.resolve(result);
    } catch (error) {
      this.metrics.failed += 1;
      job.resolve({
        ok: false,
        quotaFallback: true,
        text: 'AI terlalu lama merespons. Coba ulangi dengan pertanyaan yang lebih singkat ya.',
        error: error.message
      });
    } finally {
      clearTimeout(timeoutId);
      if (sessionId) this.sessionLocks.delete(sessionId);
      this.running = Math.max(0, this.running - 1);
      setImmediate(() => this.drain());
    }
  }
}

module.exports = new AiQueueService();
