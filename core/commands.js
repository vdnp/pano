// commands: kullanıcının (komut paleti, geçmiş, bildirim satırı) ya da başka bir eklentinin
// (ctx.runCommand) çalıştırdığı işler. Her çalıştırma bir kimlik alır, iptal edilebilir,
// ilerleme bildirir ve sonunda geçmişe yazılır (gizli parametreler hariç, en yeni 200 kayıt).

import { coerce, isBlank, validateParams } from './schema.js';

export const MAX_HISTORY = 200;
// ctx.runCommand zinciri: A → B → C → D'den uzun zincir döngü sayılır
export const MAX_DEPTH = 3;
const COMMAND_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const PROGRESS_INTERVAL_MS = 100;
const ORIGINS = new Set(['palette', 'history', 'notification', 'plugin', 'tray']);

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const providerOf = (s) => (typeof s?.suggest === 'string' ? s.suggest : s?.suggest?.provider) || null;

// Arayüze giden parametre şeması: yalnızca düz alanlar (fonksiyon ya da bilinmeyen alan yok)
function publicSchema(params = {}) {
  const out = {};
  for (const [key, s] of Object.entries(params)) {
    if (!s || typeof s !== 'object') continue;
    out[key] = {
      type: ['number', 'boolean', 'string', 'list'].includes(s.type) ? s.type : 'string',
      label: text(s.label, 120) || key,
      required: Boolean(s.required),
      secret: Boolean(s.secret),
      ...(s.min != null ? { min: Number(s.min) } : {}),
      ...(s.max != null ? { max: Number(s.max) } : {}),
      ...(s.default !== undefined ? { default: s.default } : {}),
      ...(s.placeholder ? { placeholder: text(s.placeholder, 120) } : {}),
      ...(s.help ? { help: text(s.help, 300) } : {}),
      suggest: providerOf(s) ? { provider: providerOf(s), placeholder: text(s.suggest?.placeholder, 120) } : null
    };
  }
  return out;
}

// Geçmişe yazılmayacak alanlar (ör. parola, tek kullanımlık kod)
export function redactParams(schema = {}, params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !schema[key]?.secret));
}

// Öneri sonucu parametrelerin bir kısmını doldurur: { appId: 730, name: 'CS2' } ya da
// sorulan alanın düz değeri. Şemada olmayan, liste ya da gizli alanlar atılır; sorulan
// alan boşsa ya da sayı geçersizse öneri kullanılmaz.
export function cleanSuggestion(schema, key, value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : { [key]: value };
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = schema[k];
    if (!s || s.type === 'list' || s.secret || isBlank(v)) continue;
    if (s.type === 'number' && !Number.isFinite(Number(v))) continue;
    out[k] = s.type === 'number' ? Number(v) : coerce(v, s);
    if (typeof out[k] === 'string') out[k] = out[k].trim().slice(0, 1000);
  }
  return isBlank(out[key]) ? null : out;
}

// commands bir nesne ya da ayarlardan komut listesi hesaplayan fonksiyon olabilir
export function resolveCommandDefs(module, settings, ctx, logger, name) {
  let defs = module?.commands;
  if (typeof defs === 'function') {
    try {
      defs = defs(settings, ctx);
    } catch (err) {
      logger.error(`[${name}] komut listesi hesaplanamadı:`, err.message);
      return {};
    }
  }
  const out = {};
  for (const [id, def] of Object.entries(defs ?? {})) {
    if (!COMMAND_NAME.test(id) || typeof def?.run !== 'function') {
      logger.warn(`[${name}] geçersiz komut tanımı atlandı: ${id}`);
      continue;
    }
    out[id] = def;
  }
  return out;
}

// getEntries(): Map<'eklenti/komut', { id, plugin, name, def, ctx }>; ctx.forCommand({ signal, depth })
export function createCommandRunner({ bus, storage, logger, getI18n, getEntries, now = () => Date.now() }) {
  const active = new Map();
  let seq = 0;

  const error = (key, params) => getI18n().error(key, params);
  // Katalog anahtarı ya da düz metin (eklentinin kendi kataloğunda: steam:commands.x)
  const label = (plugin, value, fallback) => getI18n().tOr(`${plugin}:${value}`, value || fallback);

  function describe(entry) {
    const { def } = entry;
    return {
      id: entry.id,
      plugin: entry.plugin,
      name: entry.name,
      title: text(def.title, 200) || entry.name,
      description: text(def.description, 400),
      params: publicSchema(def.params),
      confirm: Boolean(def.confirm),
      // false: paletten gizli (ör. yalnızca bildirim satırından anlamlı olan komut)
      palette: def.palette !== false,
      notificationAction: def.notificationAction ? { label: text(def.notificationAction.label, 120) || null } : null
    };
  }

  const list = () => [...getEntries().values()].map(describe);

  function lookup(id) {
    const entry = getEntries().get(String(id));
    if (!entry) throw error('core.commands.notFound', { id: String(id) });
    return entry;
  }

  function validate(entry, raw) {
    const fail = (code, [key, s], extra = {}) =>
      error(`core.commands.params.${code}`, { param: label(entry.plugin, s.label, key), ...extra });
    return validateParams(entry.def.params ?? {}, raw, fail);
  }

  function record(info, outcome) {
    try {
      storage.commandHistory.add({ ...info, ...outcome, duration: Math.max(0, now() - info.startedAt) });
      storage.commandHistory.prune(MAX_HISTORY);
    } catch (err) {
      logger.warn('Komut geçmişi yazılamadı:', err.message);
    }
  }

  // Çalıştırmayı başlatır, hemen { runId, done } döner. done: { status: ok|error|cancelled, message?, error?, errorI18n? }
  function start(id, raw = {}, { origin = 'palette', depth = 0, signal: parentSignal, caller = null } = {}) {
    const entry = lookup(id);
    if (depth > MAX_DEPTH) throw error('core.commands.tooDeep', { id: entry.id });
    // Kullanıcı onayı gereken komutu başka bir eklenti çalıştıramaz (onay atlanmasın)
    if (caller && entry.def.confirm) throw error('core.commands.needsConfirm', { id: entry.id });
    const params = validate(entry, raw);

    const runId = `${now().toString(36)}-${++seq}`;
    const controller = new AbortController();
    const { signal } = controller;
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const info = {
      runId,
      command: entry.id,
      plugin: entry.plugin,
      title: text(entry.def.title, 200) || entry.name,
      params: redactParams(entry.def.params, params),
      origin: ORIGINS.has(origin) ? origin : 'palette',
      startedAt: now()
    };
    active.set(runId, { ...info, controller, progress: null, message: '' });
    bus.emit('command:started', info);

    // İlerleme saniyede en fazla ~10 kez iletilir; tamamlanma (1) her zaman iletilir
    let lastEmit = 0;
    function progress(value, message) {
      const run = active.get(runId);
      if (!run || signal.aborted) return;
      const v = Number(value);
      run.progress = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
      run.message = typeof message === 'string' ? message.slice(0, 200) : run.message;
      const t = now();
      if (t - lastEmit < PROGRESS_INTERVAL_MS && run.progress !== 1) return;
      lastEmit = t;
      bus.emit('command:progress', { runId, progress: run.progress, message: run.message });
    }

    const ctx = entry.ctx.forCommand({ signal, depth });
    const work = Promise.resolve().then(() => entry.def.run(ctx, params, { signal, progress }));
    // İptalden sonra gelen sonuç ya da hata yok sayılır (yakalanmamış hata olmasın)
    work.catch(() => {});
    const aborted = new Promise((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });

    const done = (async () => {
      let outcome;
      try {
        const result = await Promise.race([work.then((value) => ({ value })), aborted.then(() => ({ cancelled: true }))]);
        outcome = result.cancelled || signal.aborted
          ? { status: 'cancelled' }
          : { status: 'ok', message: text(result.value?.message, 500) };
      } catch (err) {
        outcome = signal.aborted
          ? { status: 'cancelled' }
          : { status: 'error', error: err?.message ?? String(err), errorI18n: err?.i18n ?? null };
        if (outcome.status === 'error') logger.warn(`[${entry.id}]`, outcome.error);
      }
      active.delete(runId);
      record(info, outcome);
      bus.emit('command:finished', { ...info, ...outcome, duration: Math.max(0, now() - info.startedAt) });
      return outcome;
    })();

    return { runId, done };
  }

  // ctx.runCommand: sonucu bekler; hata ve iptal çağıran eklentiye hata olarak döner
  async function runAndWait(id, params, options) {
    const outcome = await start(id, params, { ...options, origin: 'plugin' }).done;
    if (outcome.status === 'ok') return { message: outcome.message };
    if (outcome.status === 'cancelled') throw error('core.commands.cancelled');
    throw Object.assign(new Error(outcome.error), { i18n: outcome.errorI18n });
  }

  function cancel(runId) {
    const run = active.get(String(runId));
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  const running = () => [...active.values()].map(({ controller, ...info }) => info);

  return {
    list,
    lookup,
    describe,
    start,
    runAndWait,
    cancel,
    running,
    history: (limit = MAX_HISTORY) => storage.commandHistory.list(Math.min(MAX_HISTORY, Math.max(1, Number(limit) || MAX_HISTORY))),
    clearHistory: () => storage.commandHistory.clear()
  };
}
