// Her kaynak bir "iş" olarak zamanlanır. setInterval yerine zincirleme setTimeout
// kullanılır: bir çalışma bitmeden diğeri başlamaz, sonraki zaman doğru hesaplanır.
export function createScheduler({ bus, logger }) {
  const jobs = new Map();
  // Süren çalışmalar: kapanışta beklenir ki iş kapanmış depoya yazmasın
  const inflight = new Set();

  const snapshot = (job) => ({ key: job.key, ...job.meta, intervalMs: job.intervalMs, ...job.status });
  const emit = (job) => bus.emit('source:status', snapshot(job));

  function plan(job, delay) {
    clearTimeout(job.timer);
    job.status.nextRun = Date.now() + delay;
    // Zamanlanmış çalışmanın nedeni yoktur; yalnızca runNow'a verilen neden o çalışmaya geçer
    job.timer = setTimeout(() => execute(job), delay);
  }

  function execute(job, cause) {
    const run = executeJob(job, cause);
    inflight.add(run);
    run.finally(() => inflight.delete(run));
    return run;
  }

  async function executeJob(job, cause = null) {
    if (job.running || job.stopped) return;
    clearTimeout(job.timer);
    job.running = true;
    job.status.state = 'running';
    emit(job);

    try {
      await job.fn(cause);
      job.status.state = 'ok';
      job.status.error = null;
      job.status.errorI18n = null;
      job.status.lastSuccess = Date.now();
    } catch (err) {
      job.status.state = 'error';
      job.status.error = err?.message ?? String(err);
      // Çevrilebilir hatanın anahtarı: arayüz dil değişince mesajı yeniden çevirir
      job.status.errorI18n = err?.i18n ?? null;
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
        status: { state: 'idle', error: null, errorI18n: null, lastRun: null, lastSuccess: null, nextRun: null }
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

    // Başlık gibi görünen bilgiler değişince zamanlamaya dokunmadan güncellenir
    setMeta(key, meta) {
      const job = jobs.get(key);
      if (!job) return;
      job.meta = meta;
      emit(job);
    },

    // Çalışmakta olan iş biter ama yeniden zamanlanmaz
    remove(key) {
      const job = jobs.get(key);
      if (!job) return;
      job.stopped = true;
      clearTimeout(job.timer);
      jobs.delete(key);
    },

    // cause: { causedBy } — çalıştırmayı başlatan komut (bildirimler bu nedeni taşır)
    runNow: (key, cause = null) => (jobs.has(key) ? execute(jobs.get(key), cause) : undefined),

    statuses: () => [...jobs.values()].map(snapshot),

    // Süren çalışmaların bitmesini en fazla ms kadar bekler; true: hepsi bitti
    async drain(ms) {
      if (inflight.size === 0) return true;
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
      const all = Promise.allSettled([...inflight]).then(() => true);
      const done = await Promise.race([all, timeout]);
      clearTimeout(timer);
      return done;
    },

    stopAll() {
      for (const job of jobs.values()) {
        job.stopped = true;
        clearTimeout(job.timer);
      }
    }
  };
}
