import { EventEmitter } from 'node:events';
import { openStorage } from './storage/index.js';
import { createNotificationStore } from './notifications.js';
import { createSecrets } from './secrets.js';
import { createScheduler } from './scheduler.js';
import { loadPlugins } from './loader.js';
import { createContext } from './context.js';

function coerce(value, schema) {
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
export function createCore({ dataDir, pluginDirs, cipher, logger = console, storage: givenStorage }) {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);

  // Depo dışarıdan verilebilir (testlerde bellek içi SQLite); yoksa dataDir/pano.db
  const storage = givenStorage ?? openStorage(dataDir, logger);
  const store = storage.kv;
  const notifications = createNotificationStore(storage, bus);
  const secrets = createSecrets(store, cipher);
  const scheduler = createScheduler({ bus, logger });
  const plugins = new Map();

  function settingsFor(name) {
    const schema = plugins.get(name)?.manifest.settings ?? {};
    const defaults = Object.fromEntries(Object.entries(schema).map(([k, s]) => [k, s.default]));
    return { ...defaults, ...(store.get('settings')?.[name] ?? {}) };
  }

  function intervalFor(name, source) {
    const minutes = Number(settingsFor(name).interval ?? source.defaultInterval ?? 5);
    return Math.max(1, minutes) * 60_000;
  }

  function getPlugin(name) {
    const plugin = plugins.get(name);
    if (!plugin) throw new Error(`Eklenti bulunamadı: ${name}`);
    return plugin;
  }

  async function start() {
    for (const plugin of await loadPlugins(pluginDirs, logger)) {
      const name = plugin.manifest.name;
      plugins.set(name, plugin);
      plugin.ctx = createContext(name, {
        notifications, store, secrets, logger,
        getSettings: () => settingsFor(name)
      });

      try {
        await plugin.module.setup?.(plugin.ctx);
      } catch (err) {
        logger.error(`[${name}] başlatılamadı:`, err.message);
        continue;
      }

      // Katkı modeli: şimdilik sadece "sources". İleride commands, providers, widgets.
      for (const [sourceId, source] of Object.entries(plugin.module.sources ?? {})) {
        scheduler.add(
          `${name}/${sourceId}`,
          () => source.run(plugin.ctx),
          intervalFor(name, source),
          { plugin: name, source: sourceId, title: source.title ?? sourceId }
        );
      }
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
    return [...plugins.values()].map(({ manifest }) => ({
      name: manifest.name,
      displayName: manifest.displayName ?? manifest.name,
      description: manifest.description ?? '',
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

    for (const [sourceId, source] of Object.entries(plugin.module.sources ?? {})) {
      scheduler.reschedule(`${name}/${sourceId}`, intervalFor(name, source));
    }
    bus.emit('sources:changed');
  }

  function setSecret(name, key, value) {
    const plugin = getPlugin(name);
    if (!plugin.manifest.secrets?.[key]) throw new Error(`Bilinmeyen gizli alan: ${key}`);
    if (value) secrets.set(name, key, value);
    else secrets.delete(name, key);
    bus.emit('sources:changed');

    // Anahtar değişince beklemeden kontrol et
    for (const sourceId of Object.keys(plugin.module.sources ?? {})) {
      scheduler.runNow(`${name}/${sourceId}`);
    }
  }

  // Eklentiden bağımsız uygulama ayarları; platforma özgü uygulanışları (oturum
  // açılışı, masaüstü bildirimleri) çekirdeği kullanan tarafa aittir.
  const APP_DEFAULTS = { openAtLogin: false, pauseNotifications: false };

  function getAppSettings() {
    return { ...APP_DEFAULTS, ...(store.get('app') ?? {}) };
  }

  function setAppSettings(values = {}) {
    const next = getAppSettings();
    for (const key of Object.keys(APP_DEFAULTS)) {
      if (key in values) next[key] = Boolean(values[key]);
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
      setSecret
    }
  };
}
