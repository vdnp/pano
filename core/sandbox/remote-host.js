// Main tarafındaki host: core'a süreç içi host'la aynı arayüzü (inspect / describe / invoke) verir,
// ama eklenti ayrı bir süreçte, RPC'nin öbür ucundadır. Aynı zamanda denetleyicidir:
// - Canlılık: düzenli ping; yanıt gelmezse "takıldı" sayılır ve süreç yeniden başlatılır.
// - Çökme ya da port kapanması: süren çağrılar hata ile biter, artan beklemeyle yeniden başlatılır;
//   yeniden başlatmada setup ve son açıklama (describe) sessizce yeniden kurulur.
// - Kısa sürede art arda çökme: eklenti kapatılır (onState('disabled')); restart() ile yeniden denenir.
// Electron'a bağlı değildir: süreci açan spawn dışarıdan verilir (src/main sandbox'lı pencere açar,
// testler MessageChannel kullanır).

import { createRpc } from '../../shared/rpc.js';
import { createCtxService } from './ctx-service.js';

export const TIMINGS = {
  pingIntervalMs: 10_000,
  pingTimeoutMs: 30_000,
  initTimeoutMs: 20_000,
  callTimeoutMs: 30_000,
  readyWaitMs: 20_000,
  backoffMs: [1_000, 5_000, 15_000],
  crashWindowMs: 10 * 60_000,
  maxCrashes: 3
};
// Kaynak ve komut çalışmaları uzun sürebilir: süre sınırı yok (canlılığı ping izler)
const LONG_RUNNING = new Set(['source.run', 'command.run']);


// spawn({ name, root, entry }) → { port, kill(), onExit(cb) }; port: { postMessage, onMessage }
export function createRemoteHostFactory({ spawn, timings: overrides = {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const timings = { ...TIMINGS, ...overrides };

  return async function createRemoteHost({
    name, root, entry, ctx, logger, snapshot, onState = () => {},
    // Kullanıcıya dönük hatalar core'un çevirisiyle (anahtarı arayüzde dil değişince yeniden çevrilir)
    error = (key) => new Error(key)
  }) {
    const hostError = (code, key) => Object.assign(error(key), { code });
    const service = createCtxService({ name, ctx, logger, error });
    let rpc = null;
    let proc = null;
    let detach = null;
    let pingTimer = null;
    let restartTimer = null;
    let state = 'idle'; // starting | ready | restarting | disabled | disposed
    let readyPromise = null;
    let crashes = [];
    // Yeniden başlatmada geri kurulacaklar
    let setupDone = false;
    let lastSettings = null;

    function stopProcess() {
      clearTimer(pingTimer);
      pingTimer = null;
      detach?.();
      detach = null;
      rpc?.close('stopped');
      rpc = null;
      try {
        proc?.kill();
      } catch { /* zaten kapanmış */ }
      proc = null;
    }

    async function boot() {
      proc = await spawn({ name, root, entry });
      const current = proc;
      current.onExit?.((reason) => {
        if (proc === current) crashed(reason ?? 'exit');
      });
      rpc = createRpc(current.port, { handlers: service.handlers, timeoutMs: timings.callTimeoutMs });
      detach = service.attach(rpc);
      await rpc.call('init', { name, entry, snapshot: snapshot() }, { timeoutMs: timings.initTimeoutMs });
      if (setupDone) await rpc.call('invoke', { kind: 'setup', id: null, args: {} }, { timeoutMs: timings.callTimeoutMs });
      if (lastSettings) await rpc.call('describe', { settings: lastSettings }, { timeoutMs: timings.callTimeoutMs });
      schedulePing();
    }

    function schedulePing() {
      clearTimer(pingTimer);
      pingTimer = setTimer(async () => {
        const current = rpc;
        if (!current || state !== 'ready') return;
        try {
          await current.ping({ timeoutMs: timings.pingTimeoutMs });
          if (rpc === current) schedulePing();
        } catch {
          if (rpc === current) crashed('hang');
        }
      }, timings.pingIntervalMs);
    }

    function start() {
      state = 'starting';
      readyPromise = boot().then(
        () => {
          state = 'ready';
        },
        (err) => {
          stopProcess();
          throw err;
        }
      );
      return readyPromise;
    }

    // Çökme / takılma / port kapanması
    function crashed(reason) {
      if (state === 'disposed' || state === 'disabled' || state === 'restarting') return;
      logger.warn(`[${name}] eklenti süreci ${reason === 'hang' ? 'yanıt vermedi' : 'kapandı'} (${reason}); yeniden başlatılıyor`);
      stopProcess();
      const t = now();
      crashes = [...crashes.filter((c) => t - c < timings.crashWindowMs), t];
      if (crashes.length >= timings.maxCrashes) {
        state = 'disabled';
        logger.error(`[${name}] eklenti art arda ${crashes.length} kez çöktü; kapatıldı`);
        onState('disabled', { reason });
        return;
      }
      state = 'restarting';
      const delay = timings.backoffMs[Math.min(crashes.length - 1, timings.backoffMs.length - 1)];
      readyPromise = new Promise((resolve, reject) => {
        restartTimer = setTimer(() => {
          boot().then(() => {
            state = 'ready';
            onState('restarted', { reason });
            resolve();
          }, (err) => {
            stopProcess();
            state = 'ready'; // crashed() yeniden işlesin
            crashed(`restart failed: ${err?.message ?? err}`);
            reject(err);
          });
        }, delay);
      });
      readyPromise.catch(() => {});
      onState('restarting', { reason, delay });
    }

    // Çağrı: yeniden başlatılıyorsa hazır olmasını (sınırlı) bekler; kapatılmışsa anlaşılır hata
    async function channel() {
      if (state === 'disabled') throw hostError('PLUGIN_DISABLED', 'core.errors.pluginCrashed');
      if (state === 'disposed') throw hostError('PLUGIN_DISPOSED', 'core.errors.pluginDisposed');
      if (state !== 'ready') {
        let timer;
        const wait = new Promise((_, reject) => {
          timer = setTimer(() => reject(hostError('PLUGIN_RESTARTING', 'core.errors.pluginRestarting')), timings.readyWaitMs);
        });
        try {
          await Promise.race([readyPromise, wait]);
        } finally {
          clearTimer(timer);
        }
      }
      if (!rpc) throw hostError('PLUGIN_RESTARTING', 'core.errors.pluginRestarting');
      return rpc;
    }

    const call = async (method, args, options) => (await channel()).call(method, args, options);

    await start();

    return {
      inspect: () => call('inspect', {}),
      async describe(settings) {
        lastSettings = settings;
        return call('describe', { settings });
      },
      async invoke(kind, id = null, args = {}, { signal, onProgress } = {}) {
        const result = await call('invoke', { kind, id, args }, {
          signal,
          timeoutMs: LONG_RUNNING.has(kind) ? 0 : timings.callTimeoutMs,
          onNotify: onProgress ? (p) => onProgress(p?.value, p?.message) : undefined
        });
        if (kind === 'setup') setupDone = true;
        return result;
      },
      // Ayar / gizli alan / dil değişimi: eklenti tarafındaki kopyalar güncellenir
      async sync(patch) {
        if (state !== 'ready' || !rpc) return;
        await rpc.call('sync', patch).catch((err) => logger.warn(`[${name}] eşitleme başarısız:`, err?.message ?? err));
      },
      // Kullanıcının "Yeniden dene"si: sayaç sıfırlanır, eklenti baştan yüklenir (core setup'ı yeniden çağırır)
      async restart() {
        clearTimer(restartTimer);
        stopProcess();
        crashes = [];
        setupDone = false;
        lastSettings = null;
        await start();
      },
      dispose() {
        state = 'disposed';
        clearTimer(restartTimer);
        stopProcess();
      },
      state: () => state
    };
  };
}
