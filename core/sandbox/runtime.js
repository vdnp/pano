// Eklenti sürecinin çalışma zamanı: main'den gelen port üzerinden RPC kurar, "init" ile eklentiyi
// yükler ve süreç içi host'u (core/plugin-host.js) RPC'ye açar. Böylece eklenti, core ile aynı
// süreçteymiş gibi aynı API'yi görür. Saf JS: sandbox'lı renderer'da ve Node testlerinde çalışır.

import { createRpc } from '../../shared/rpc.js';
import { createInProcessHost } from '../plugin-host.js';
import { createRemoteContext } from './remote-ctx.js';

// importModule(entry): eklentinin giriş dosyasını yükler (renderer'da pano-plugin://<ad>/<entry>)
export function startRuntime({ port, importModule }) {
  let host = null;
  let remote = null;

  const logger = {
    log: (...args) => rpc.emit('ctx.log', { level: 'log', args: args.map(String) }),
    warn: (...args) => rpc.emit('ctx.log', { level: 'warn', args: args.map(String) }),
    error: (...args) => rpc.emit('ctx.log', { level: 'error', args: args.map(String) })
  };

  const ready = () => {
    if (!host) throw Object.assign(new Error('Eklenti henüz yüklenmedi'), { code: 'NOT_READY' });
    return host;
  };

  const rpc = createRpc(port, {
    // Uzun süren kaynak ve komut çalışmaları main tarafında süre sınırı olmadan beklenir
    // (canlılık ayrıca ping ile izlenir); burada da yanıt bekleme sınırı yok
    timeoutMs: 0,
    handlers: {
      async init({ name, entry, snapshot }) {
        if (host) throw new Error('Eklenti zaten yüklü');
        remote = createRemoteContext({ name, rpc, snapshot });
        const module = (await importModule(entry))?.default;
        if (!module || typeof module !== 'object') throw new Error('varsayılan export bir nesne olmalı');
        host = createInProcessHost({ name, module, ctx: remote.ctx, logger });
        return true;
      },
      sync(patch) {
        remote?.apply(patch);
        return true;
      },
      inspect: () => ready().inspect(),
      describe: ({ settings }) => {
        remote?.apply({ settings });
        return ready().describe(settings);
      },
      // İlerleme (komutun progress'i) çağrıya bağlı bildirimle, iptal sinyaliyle taşınır
      invoke: ({ kind, id, args }, { signal, notify }) =>
        ready().invoke(kind, id ?? null, args ?? {}, { signal, onProgress: (value, message) => notify({ value, message }) })
    }
  });

  return rpc;
}
