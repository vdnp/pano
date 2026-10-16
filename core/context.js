import { parseXml } from './xml.js';

// Eklentiye Node'un tamamı yerine bu sınırlı API verilir.
// Yeni yetenekler (dosya sistemi, komut çağırma vb.) ileride buraya eklenecek.
export function createContext(pluginName, { notifications, store, secrets, getSettings, getI18n, logger }) {
  const prefix = `[${pluginName}]`;
  // Eklentinin kendi anahtarları adıyla öneklenir: key('errors.x') → 'rss:errors.x'
  const key = (k) => `${pluginName}:${k}`;

  // job: bildirimi üreten kaynak işi (ör. news-730). Eklentiden alınmaz, core yazar;
  // arayüz bununla oyun/akış bazında filtreler.
  function notifyFor(n, job) {
    if (!n?.id || !n?.title) throw new Error('Bildirimde id ve title zorunlu');
    return notifications.add({ ...n, id: `${pluginName}:${n.id}`, source: pluginName, job });
  }

  const ctx = {
    plugin: pluginName,

    log: (...args) => logger.log(prefix, ...args),
    warn: (...args) => logger.warn(prefix, ...args),

    notify: (n) => notifyFor(n, null),

    // Bir kaynak işi çalışırken eklentiye bu kopya verilir; aynı anda çalışan
    // işlerin bildirimleri birbirine karışmaz.
    forJob: (job) => ({ ...ctx, notify: (n) => notifyFor(n, job) }),

    fetch(url, options = {}) {
      return fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(20_000) });
    },

    // Eklenti klasörleri uygulamanın node_modules'una erişemediği için ayrıştırıcı buradan verilir
    parseXml,

    // Çeviri: hata mesajları ctx.error ile anahtar taşır, arayüz gösterirken uygulama
    // diline çevirir. ctx.t içeriğe yazılan metinler içindir (o anki dilde kalır).
    // ctx.key bildirim etiketleri gibi saklanıp sonra çevrilecek anahtarları üretir.
    key,
    t: (k, params) => getI18n().t(key(k), params),
    error: (k, params) => getI18n().error(key(k), params),

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

  return ctx;
}
