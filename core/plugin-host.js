// Eklenti sınırı: core eklenti koduna yalnızca bu arayüzden ulaşır.
//   inspect()            → eklentinin sabit bilgisi (katkı türleri, sağlayıcılar, öneri adları…)
//   describe(settings)   → ayara bağlı katkıların düz açıklaması (kaynaklar, kartlar, komutlar)
//   invoke(kind, id, args, { signal, onProgress }) → eklenti fonksiyonunu çalıştırır (Promise)
// Üçü de yalnızca düz veri alıp verir (JSON'a çevrilebilir; fonksiyon yok), böylece aynı arayüz
// ileride ayrı süreçteki eklentiye RPC ile taşınır. Bu dosya süreç içi uygulamadır: fonksiyonlar
// burada tutulur, ctx (core/context.js) doğrudan verilir.

import { resolveCommandDefs } from './commands.js';
import { deserializeError, serializeError } from '../shared/rpc.js';

export const INVOKE_KINDS = [
  'setup', 'teardown', 'source.run', 'provider.get', 'widget.map', 'content', 'suggest',
  'command.run', 'notificationAction.params'
];

// Hata sınırı geçerken yalnızca düz alanlar kalır (mesaj, çeviri anahtarı, kod, satır); RPC katmanıyla
// aynı biçim, böylece süreç içi ve ayrı süreçteki eklenti aynı davranır
export { serializeError, deserializeError as rehydrateError };

// Fonksiyon ve döngü içermeyen düz kopya (sınırdan geçecek değerler)
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function safeCall(fn, fallback, logger, label) {
  try {
    return fn() ?? fallback;
  } catch (err) {
    logger.error(label, err?.message ?? err);
    return fallback;
  }
}

export function createInProcessHost({ name, module, ctx, logger }) {
  // describe'ın en son çözdüğü (fonksiyon içeren) tanımlar; invoke bunları kullanır
  let resolved = { sources: {}, widgets: {}, commands: {} };

  function inspect() {
    const providers = {};
    for (const [id, p] of Object.entries(module.providers ?? {})) {
      if (typeof p?.get === 'function') providers[id] = { ttl: p.ttl ?? null };
    }
    return {
      kinds: { sources: Boolean(module.sources), widgets: Boolean(module.widgets), commands: Boolean(module.commands) },
      hasSetup: typeof module.setup === 'function',
      hasTeardown: typeof module.teardown === 'function',
      hasContent: typeof module.content === 'function',
      providers,
      suggest: Object.keys(module.suggest ?? {}).filter((k) => typeof module.suggest[k] === 'function')
    };
  }

  // sources / widgets bir nesne ya da ayarlardan hesaplayan fonksiyon olabilir (ör. her RSS akışı,
  // her oyun için kart). ctx ikinci argüman: başlıklar uygulama dilinde üretilebilsin (ctx.t).
  function resolve(field, settings, label) {
    const value = module[field];
    if (typeof value !== 'function') return value ?? {};
    return safeCall(() => value(settings, ctx), {}, logger, label);
  }

  function describe(settings) {
    resolved = {
      sources: resolve('sources', settings, `[${name}] kaynak listesi hesaplanamadı:`),
      widgets: resolve('widgets', settings, `[${name}] kart listesi hesaplanamadı:`),
      commands: resolveCommandDefs(module, settings, ctx, logger, name)
    };

    const sources = {};
    for (const [id, s] of Object.entries(resolved.sources)) {
      if (typeof s?.run !== 'function') continue;
      sources[id] = { title: s.title != null ? String(s.title) : id, interval: s.interval ?? null, defaultInterval: s.defaultInterval ?? null };
    }
    const widgets = {};
    for (const [id, w] of Object.entries(resolved.widgets)) {
      if (!w || typeof w !== 'object') continue;
      widgets[id] = {
        title: w.title != null ? String(w.title) : id,
        view: w.view ?? null,
        provider: w.provider ?? null,
        params: plain(w.params ?? {}),
        size: w.size === 'wide' ? 'wide' : 'normal',
        hidden: w.hidden === true,
        hasMap: typeof w.map === 'function'
      };
    }
    const commands = {};
    for (const [id, c] of Object.entries(resolved.commands)) {
      const action = c.notificationAction;
      commands[id] = {
        title: c.title,
        description: c.description,
        params: plain(c.params ?? {}),
        confirm: Boolean(c.confirm),
        palette: c.palette,
        notificationAction: action
          ? { label: action.label ?? null, markRead: Boolean(action.markRead), hasParams: typeof action.params === 'function' }
          : null
      };
    }
    return { sources, widgets, commands };
  }

  function target(kind, id) {
    switch (kind) {
      case 'setup': return module.setup && (() => module.setup(ctx));
      case 'teardown': return module.teardown && (() => module.teardown(ctx));
      case 'content': return module.content && ((args) => module.content(ctx, args.notification));
      case 'suggest': {
        const fn = Object.hasOwn(module.suggest ?? {}, id) ? module.suggest[id] : null;
        return typeof fn === 'function' && ((args) => fn(ctx, args.query));
      }
      case 'provider.get': {
        const p = Object.hasOwn(module.providers ?? {}, id) ? module.providers[id] : null;
        return typeof p?.get === 'function' && ((args) => p.get(ctx, args.params ?? {}));
      }
      case 'source.run': {
        const s = Object.hasOwn(resolved.sources, id) ? resolved.sources[id] : null;
        // İşe özel ctx: bildirimler bu işin kimliğiyle (job) ve nedeniyle kaydedilir
        return typeof s?.run === 'function' && ((args) => s.run(ctx.forJob(args.job ?? id, { causedBy: args.causedBy ?? null })));
      }
      case 'widget.map': {
        const w = Object.hasOwn(resolved.widgets, id) ? resolved.widgets[id] : null;
        return w && ((args) => (typeof w.map === 'function' ? w.map(args.data, ctx) : args.data));
      }
      case 'command.run': {
        const c = Object.hasOwn(resolved.commands, id) ? resolved.commands[id] : null;
        return typeof c?.run === 'function' && ((args, { signal, onProgress }) => {
          const progress = typeof onProgress === 'function' ? onProgress : () => {};
          const runCtx = ctx.forCommand({ signal, depth: args.depth ?? 0, runId: args.runId ?? null });
          return c.run(runCtx, args.params ?? {}, { signal, progress, runId: args.runId ?? null });
        });
      }
      case 'notificationAction.params': {
        const c = Object.hasOwn(resolved.commands, id) ? resolved.commands[id] : null;
        const fn = c?.notificationAction?.params;
        return typeof fn === 'function' && ((args) => fn(args.notification));
      }
      default: return null;
    }
  }

  // Eklenti hatası sınırı düz veri olarak geçer ve yeniden Error'a çevrilir (RPC ile aynı davranış)
  async function invoke(kind, id = null, args = {}, options = {}) {
    const fn = target(kind, id);
    if (!fn) throw Object.assign(new Error(`Eklenti bu çağrıyı sunmuyor: ${kind}${id ? ` ${id}` : ''}`), { code: 'NOT_PROVIDED' });
    try {
      return await fn(args, options);
    } catch (err) {
      throw deserializeError(serializeError(err));
    }
  }

  return { inspect: async () => inspect(), describe: async (settings) => describe(settings), invoke };
}
