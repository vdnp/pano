import { EventEmitter } from 'node:events';
import { openStorage } from './storage/index.js';
import { createNotificationStore } from './notifications.js';
import { createSecrets } from './secrets.js';
import { createScheduler } from './scheduler.js';
import { loadPlugins } from './loader.js';
import { createContext } from './context.js';
import { createI18n, mergeCatalogs, LOCALES } from '../shared/i18n.js';
import { appCatalogs } from '../locales/index.js';

const MAX_LIST_ITEMS = 50;
const MAX_SUGGESTIONS = 20;
const isTextField = (schema) => !['number', 'boolean', 'list'].includes(schema.type);
const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

// Zorunlu alan boş mu: metinde boşluk, sayıda boş ya da sayıya çevrilemeyen değer
function missingRequired(raw, [key, s]) {
  if (!s.required) return false;
  if (isBlank(raw[key])) return true;
  return s.type === 'number' && !Number.isFinite(Number(raw[key]));
}

// "list": her öğesi schema.item alt şemasına uyan nesnelerden oluşan liste.
// Kullanıcının hiçbir alanı doldurmadığı (onay kutuları sayılmaz) ya da zorunlu
// (required) alanı boş kalan öğe atılır. Kontrol ham değer üzerinde yapılır ki
// varsayılan değerler boş satırı dolu göstermesin.
function coerceList(value, schema) {
  if (!Array.isArray(value)) return [];
  // İç içe liste desteklenmez
  const fields = Object.entries(schema.item ?? {}).filter(([, s]) => s.type !== 'list');
  const inputs = fields.filter(([, s]) => s.type !== 'boolean');
  const items = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    if (inputs.length && inputs.every(([key]) => isBlank(raw[key]))) continue;
    if (fields.some((field) => missingRequired(raw, field))) continue;

    const item = {};
    for (const [key, s] of fields) {
      const v = coerce(raw[key] ?? s.default, s);
      item[key] = isTextField(s) ? v.trim() : v;
    }
    items.push(item);
    if (items.length === MAX_LIST_ITEMS) break;
  }
  return items;
}

function coerce(value, schema) {
  if (schema.type === 'list') return coerceList(value, schema);
  if (schema.type === 'number') {
    let n = Number(value);
    if (!Number.isFinite(n)) n = schema.default ?? 0;
    if (schema.min != null) n = Math.max(schema.min, n);
    if (schema.max != null) n = Math.min(schema.max, n);
    return n;
  }
  // IPC veya elle düzenlenmiş dosyadan "false" metni gelebilir; Boolean("false") true olur
  if (schema.type === 'boolean') return value === 'false' ? false : Boolean(value);
  return String(value ?? '');
}

/**
 * Pano çekirdeği. Electron'dan bağımsızdır; Electron, CLI veya bir WebSocket
 * sunucusu bu nesneyi aynı şekilde kullanabilir.
 */
export function createCore({
  dataDir, pluginDirs, cipher, logger = console, storage: givenStorage, locale: initialLocale = 'tr'
}) {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);

  // Depo dışarıdan verilebilir (testlerde bellek içi SQLite); yoksa dataDir/pano.db
  const storage = givenStorage ?? openStorage(dataDir, logger);
  const store = storage.kv;
  const notifications = createNotificationStore(storage, bus);
  const secrets = createSecrets(store, cipher);
  const scheduler = createScheduler({ bus, logger });
  const plugins = new Map();

  // Core'un ürettiği hatalar ve eklentilerin ctx.error/ctx.t'si bu dili kullanır.
  // Eklenti katalogları yüklendikçe ve dil değiştikçe yeniden kurulur.
  let locale = LOCALES.includes(initialLocale) ? initialLocale : 'tr';
  let i18n;
  function rebuildI18n() {
    const pluginCatalogs = Object.fromEntries([...plugins.values()].map((p) => [p.manifest.name, p.locales]));
    i18n = createI18n({ locale, catalogs: mergeCatalogs(appCatalogs, pluginCatalogs) });
  }
  rebuildI18n();

  function setLocale(next) {
    if (!LOCALES.includes(next) || next === locale) return;
    locale = next;
    rebuildI18n();
  }

  function settingsFor(name) {
    const schema = plugins.get(name)?.manifest.settings ?? {};
    const defaults = Object.fromEntries(
      Object.entries(schema).map(([k, s]) => [k, s.default ?? (s.type === 'list' ? [] : undefined)])
    );
    return { ...defaults, ...(store.get('settings')?.[name] ?? {}) };
  }

  function intervalFor(name, source) {
    const minutes = Number(settingsFor(name).interval ?? source.defaultInterval ?? 5);
    return Math.max(1, minutes) * 60_000;
  }

  function getPlugin(name) {
    const plugin = plugins.get(name);
    if (!plugin) throw i18n.error('core.errors.pluginNotFound', { name });
    return plugin;
  }

  // sources bir nesne ya da ayarlardan kaynak listesi hesaplayan bir fonksiyon olabilir
  // (ör. RSS'te her akış ayrı bir kaynak).
  function resolveSources(plugin) {
    // setup'ı başarısız olan eklentinin işleri kurulmaz (ayar kaydı da kurmasın)
    if (plugin.startError) return {};
    const { sources } = plugin.module;
    if (typeof sources !== 'function') return sources ?? {};
    try {
      // ctx ikinci argüman: kaynak başlıklarını uygulama dilinde üretebilsin (ctx.t)
      return sources(settingsFor(plugin.manifest.name), plugin.ctx) ?? {};
    } catch (err) {
      logger.error(`[${plugin.manifest.name}] kaynak listesi hesaplanamadı:`, err.message);
      return {};
    }
  }

  // Zamanlayıcıdaki işleri eklentinin güncel kaynak listesiyle eşler: yeni kaynak
  // eklenir, kalkan silinir, kalanın başlığı/aralığı yerinde güncellenir.
  function syncSources(plugin) {
    const name = plugin.manifest.name;
    plugin.sources = resolveSources(plugin);
    const existing = new Map(
      scheduler.statuses().filter((s) => s.plugin === name).map((s) => [s.key, s])
    );

    for (const [sourceId, source] of Object.entries(plugin.sources)) {
      const key = `${name}/${sourceId}`;
      const meta = { plugin: name, source: sourceId, title: source.title ?? sourceId };
      const intervalMs = intervalFor(name, source);
      const current = existing.get(key);
      existing.delete(key);

      if (!current) {
        // Tanım her çalışmada yeniden okunur; ad değişince iş yeniden kurulmaz
        // İşe özel ctx: bildirimler bu işin kimliğiyle (job) kaydedilir
        scheduler.add(key, () => plugin.sources[sourceId].run(plugin.ctx.forJob(sourceId)), intervalMs, meta);
      } else {
        scheduler.setMeta(key, meta);
        if (current.intervalMs !== intervalMs) scheduler.reschedule(key, intervalMs);
      }
    }

    for (const key of existing.keys()) scheduler.remove(key);
  }

  async function start() {
    for (const plugin of await loadPlugins(pluginDirs, logger)) {
      const name = plugin.manifest.name;
      plugins.set(name, plugin);
      rebuildI18n();
      plugin.ctx = createContext(name, {
        notifications, store, secrets, logger,
        getSettings: () => settingsFor(name),
        getI18n: () => i18n
      });

      try {
        await plugin.module.setup?.(plugin.ctx);
      } catch (err) {
        logger.error(`[${name}] başlatılamadı:`, err.message);
        // Arayüz "kaynak eklenmedi" yerine asıl sorunu gösterebilsin
        plugin.startError = { key: 'core.errors.startFailed', params: { error: err?.i18n ?? err?.message ?? String(err) } };
        continue;
      }

      // Katkı modeli: şimdilik sadece "sources". İleride commands, providers, widgets.
      syncSources(plugin);
    }
    bus.emit('sources:changed');
  }

  async function stop() {
    scheduler.stopAll();
    for (const plugin of plugins.values()) {
      try { await plugin.module.teardown?.(plugin.ctx); } catch { /* kapanışta yut */ }
    }
    storage.close();
  }

  function listSources() {
    const statuses = scheduler.statuses();
    return [...plugins.values()].map(({ manifest, startError, locales }) => ({
      name: manifest.name,
      // Metin core'un dilinde; arayüz dil değişince anahtardan yeniden çevirir
      startError: startError ? i18n.t(startError) : null,
      startErrorI18n: startError ?? null,
      locales: locales ?? {},
      displayName: manifest.displayName ?? manifest.name,
      description: manifest.description ?? '',
      // Kaynağı olmayan eklenti için arayüzdeki kurulum ekranı metni: { title, body, action }
      setup: manifest.setup ?? null,
      settingsSchema: manifest.settings ?? {},
      settings: settingsFor(manifest.name),
      secretsSchema: manifest.secrets ?? {},
      secretsSet: Object.fromEntries(
        Object.keys(manifest.secrets ?? {}).map((k) => [k, secrets.has(manifest.name, k)])
      ),
      jobs: statuses.filter((s) => s.plugin === manifest.name)
    }));
  }

  function updateSettings(name, values) {
    const plugin = getPlugin(name);
    const clean = {};
    for (const [key, schema] of Object.entries(plugin.manifest.settings ?? {})) {
      if (key in values) clean[key] = coerce(values[key], schema);
    }
    const all = store.get('settings') ?? {};
    store.set('settings', { ...all, [name]: { ...(all[name] ?? {}), ...clean } });

    syncSources(plugin);
    bus.emit('sources:changed');
  }

  // Ayarlar panelindeki arama kutusu için: bir liste alanının manifest'te bildirdiği
  // sağlayıcıyı (settings.X.suggest.provider) çağırır. Arayüz yalnızca bildirilmiş
  // sağlayıcıları tetikleyebilir; sonuçlar listenin alt şemasından geçirilir ki
  // arayüze yalnızca kaydedilebilir satırlar ulaşsın.
  async function suggest(name, provider, query) {
    const plugin = getPlugin(name);
    const field = Object.values(plugin.manifest.settings ?? {})
      .find((s) => s.type === 'list' && s.suggest?.provider === provider);
    const fn = plugin.module.suggest?.[provider];
    if (!field || typeof fn !== 'function') throw i18n.error('core.errors.unknownProvider', { provider });
    if (plugin.startError) throw i18n.error(plugin.startError.key, plugin.startError.params);

    const q = String(query ?? '').trim().slice(0, 100);
    if (q.length < 2) return [];

    const results = await fn(plugin.ctx, q);
    const out = [];
    for (const r of Array.isArray(results) ? results : []) {
      const [value] = coerceList([r?.value], field);
      const label = String(r?.label ?? '').trim().slice(0, 200);
      if (!value || !label) continue;
      out.push({ label, detail: r.detail ? String(r.detail).slice(0, 200) : '', value });
      if (out.length === MAX_SUGGESTIONS) break;
    }
    return out;
  }

  function setSecret(name, key, value) {
    const plugin = getPlugin(name);
    if (!plugin.manifest.secrets?.[key]) throw i18n.error('core.errors.unknownSecret', { key });
    if (value) secrets.set(name, key, value);
    else secrets.delete(name, key);
    bus.emit('sources:changed');

    // Anahtar değişince beklemeden kontrol et
    for (const sourceId of Object.keys(plugin.sources ?? {})) {
      scheduler.runNow(`${name}/${sourceId}`);
    }
  }

  // Eklentiden bağımsız uygulama ayarları; platforma özgü uygulanışları (oturum
  // açılışı, masaüstü bildirimleri) çekirdeği kullanan tarafa aittir.
  const APP_SCHEMA = {
    openAtLogin: { type: 'boolean', default: false },
    pauseNotifications: { type: 'boolean', default: false },
    // "system": dili çekirdeği kullanan taraf (Electron'da işletim sistemi dili) belirler
    language: { type: 'enum', values: ['system', ...LOCALES], default: 'system' }
  };

  function getAppSettings() {
    const defaults = Object.fromEntries(Object.entries(APP_SCHEMA).map(([k, s]) => [k, s.default]));
    return { ...defaults, ...(store.get('app') ?? {}) };
  }

  function setAppSettings(values = {}) {
    const next = getAppSettings();
    for (const [key, schema] of Object.entries(APP_SCHEMA)) {
      if (!(key in values)) continue;
      if (schema.type === 'boolean') next[key] = Boolean(values[key]);
      // Geçersiz seçim yok sayılır, mevcut değer korunur
      else if (schema.values.includes(values[key])) next[key] = values[key];
    }
    store.set('app', next);
    bus.emit('app:settingsChanged', next);
    return next;
  }

  return {
    bus,
    start,
    stop,
    getAppSettings,
    setAppSettings,
    setLocale,
    getLocale: () => locale,
    notifications: {
      list: notifications.list,
      markRead: notifications.markRead,
      markAllRead: notifications.markAllRead,
      clear: notifications.clear
    },
    sources: {
      list: listSources,
      runNow: (key) => scheduler.runNow(key),
      updateSettings,
      setSecret,
      suggest
    }
  };
}
