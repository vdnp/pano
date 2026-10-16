// Eklentiye Node'un tamamı yerine bu sınırlı API verilir.
// Yeni yetenekler (dosya sistemi, komut çağırma vb.) ileride buraya eklenecek.
export function createContext(pluginName, { notifications, store, secrets, getSettings, logger }) {
  const prefix = `[${pluginName}]`;

  return {
    plugin: pluginName,

    log: (...args) => logger.log(prefix, ...args),
    warn: (...args) => logger.warn(prefix, ...args),

    notify(n) {
      if (!n?.id || !n?.title) throw new Error('Bildirimde id ve title zorunlu');
      return notifications.add({ ...n, id: `${pluginName}:${n.id}`, source: pluginName });
    },

    fetch(url, options = {}) {
      return fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(20_000) });
    },

    settings: {
      get: (key) => getSettings()[key],
      all: () => getSettings()
    },

    secrets: {
      get: (key) => secrets.get(pluginName, key)
    },

    // Eklentinin kendi kalıcı durumu (son kontrol zamanı, ETag vb.)
    state: {
      get: (key) => (store.get('state')?.[pluginName] ?? {})[key],
      set(key, value) {
        const all = store.get('state') ?? {};
        store.set('state', { ...all, [pluginName]: { ...(all[pluginName] ?? {}), [key]: value } });
      }
    }
  };
}
