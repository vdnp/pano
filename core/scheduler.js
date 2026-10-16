// Her kaynak bir "iş" olarak zamanlanır. setInterval yerine zincirleme setTimeout
// kullanılır: bir çalışma bitmeden diğeri başlamaz, sonraki zaman doğru hesaplanır.
export function createScheduler({ bus, logger }) {
  const jobs = new Map();

  const snapshot = (job) => ({ key: job.key, ...job.meta, intervalMs: job.intervalMs, ...job.status });
  const emit = (job) => bus.emit('source:status', snapshot(job));

  function plan(job, delay) {
    clearTimeout(job.timer);
    job.status.nextRun = Date.now() + delay;
    job.timer = setTimeout(() => execute(job), delay);
  }

  async function execute(job) {
    if (job.running || job.stopped) return;
    clearTimeout(job.timer);
    job.running = true;
    job.status.state = 'running';
    emit(job);

    try {
      await job.fn();
      job.status.state = 'ok';
      job.status.error = null;
      job.status.lastSuccess = Date.now();
    } catch (err) {
      job.status.state = 'error';
      job.status.error = err?.message ?? String(err);
      logger.warn(`[${job.key}]`, job.status.error);
    } finally {
      job.running = false;
      job.status.lastRun = Date.now();
      if (!job.stopped) plan(job, job.intervalMs);
      emit(job);
    }
  }

  return {
    add(key, fn, intervalMs, meta = {}) {
      const job = {
        key, fn, intervalMs, meta,
        timer: null, running: false, stopped: false,
        status: { state: 'idle', error: null, lastRun: null, lastSuccess: null, nextRun: null }
      };
      jobs.set(key, job);
      plan(job, 1000 + Math.random() * 2000); // açılışta hepsi aynı anda vurmasın
      emit(job);
    },

    reschedule(key, intervalMs) {
      const job = jobs.get(key);
      if (!job) return;
      job.intervalMs = intervalMs;
      if (!job.running) plan(job, intervalMs);
      emit(job);
    },

    runNow: (key) => (jobs.has(key) ? execute(jobs.get(key)) : undefined),

    statuses: () => [...jobs.values()].map(snapshot),

    stopAll() {
      for (const job of jobs.values()) {
        job.stopped = true;
        clearTimeout(job.timer);
      }
    }
  };
}
