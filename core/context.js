import { parseXml } from './xml.js';
import { normalizePermissions, PERMISSIONS } from './permissions.js';
import { createGuardedFetch } from './net-guard.js';
import { createPluginFiles } from './plugin-files.js';

export { PERMISSIONS };

// Eklentiye Node'un tamamı yerine bu sınırlı API verilir. Her yetenek manifest.permissions'ta
// beyan edilmeli (core/permissions.js): network (alan adları), notifications, filesystem,
// openExternal, runCommand. openExternal ve runCommand ayrıca yalnızca bir komut çalışırken
// kullanılabilir: arka planda periyodik çalışan kaynak işi kullanıcının haberi olmadan tarayıcı açamaz.
// capabilities: core'un verdiği gerçek uygulamalar { openExternal(url), runCommand(id, params, opts) }
// filesDir: eklentiye ayrılmış klasör (filesystem izni); fetchImpl/resolveHost testlerde sahte verilir
export function createContext(pluginName, {
  notifications, store, secrets, getSettings, getI18n, logger, permissions = null, capabilities = {},
  filesDir = null, fetchImpl, resolveHost
}) {
  const prefix = `[${pluginName}]`;
  // Normalleştirilmiş izin nesnesi; eski dizi biçimi de gelebilir
  const granted = permissions && !Array.isArray(permissions) && 'notifications' in permissions
    ? permissions
    : normalizePermissions(permissions).permissions;

  const denied = (permission) =>
    getI18n().error('core.permissions.denied', { plugin: pluginName, permission: { key: `core.permissions.names.${permission}` } });
  const need = (permission) => {
    if (!granted[permission]) throw denied(permission);
  };

  // İzin beyan edilmemişse ya da komut dışında çağrıldıysa anlaşılır hata
  function check(permission, command) {
    need(permission);
    if (!command) throw getI18n().error('core.permissions.notInCommand', { permission: { key: `core.permissions.names.${permission}` } });
  }

  const guardedFetch = createGuardedFetch({
    pluginName,
    getPermissions: () => granted,
    getSettings,
    error: (k, params) => getI18n().error(k, params),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(resolveHost ? { resolveHost } : {})
  });

  let files = null;
  const pluginFiles = () => {
    need('filesystem');
    if (!filesDir) throw getI18n().error('core.permissions.files.unavailable');
    files ??= createPluginFiles({ dir: filesDir, error: (k, params) => getI18n().error(k, params) });
    return files;
  };
  // Eklentinin kendi anahtarları adıyla öneklenir: key('errors.x') → 'rss:errors.x'
  const key = (k) => `${pluginName}:${k}`;

  // job: bildirimi üreten kaynak işi (ör. news-730). Eklentiden alınmaz, core yazar;
  // arayüz bununla oyun/akış bazında filtreler.
  // causedBy: bu bildirimi doğuran komut çalıştırması (varsa). Düz metin olduğu için eklenti ayrı
  // süreçte çalışsa da taşınır; otomasyon zinciri buradan çıkarılır.
  function notifyFor(n, job, causedBy = null) {
    need('notifications');
    if (!n?.id || !n?.title) throw new Error('Bildirimde id ve title zorunlu');
    return notifications.add({ ...n, id: `${pluginName}:${n.id}`, source: pluginName, job }, { causedBy });
  }

  const ctx = {
    plugin: pluginName,

    log: (...args) => logger.log(prefix, ...args),
    warn: (...args) => logger.warn(prefix, ...args),

    notify: (n) => notifyFor(n, null, null),

    // Bir kaynak işi çalışırken eklentiye bu kopya verilir; aynı anda çalışan
    // işlerin bildirimleri birbirine karışmaz.
    // causedBy: iş bir komut tarafından başlatıldıysa (ör. otomasyonun "tüm kaynakları kontrol et"i)
    forJob: (job, { causedBy = null } = {}) => ({ ...ctx, notify: (n) => notifyFor(n, job, causedBy) }),

    // Komut çalışırken verilen kopya: iptal sinyali ve izinli yetenekler. depth iç içe
    // runCommand zincirinin uzunluğu (döngüyü core sınırlar).
    forCommand: ({ signal, depth = 0, runId = null }) => ({
      ...ctx,
      signal,
      notify: (n) => notifyFor(n, null, runId),
      async openExternal(url) {
        check('openExternal', true);
        return capabilities.openExternal(String(url ?? ''));
      },
      async runCommand(id, params = {}) {
        check('runCommand', true);
        return capabilities.runCommand(String(id ?? ''), params, { depth: depth + 1, signal, caller: pluginName, causedBy: runId });
      }
    }),

    async openExternal() {
      check('openExternal', false);
    },
    async runCommand() {
      check('runCommand', false);
    },

    // İzinli alan adları, http(s), yerel ağ yok, yönlendirmeler denetlenir, 20 sn (core/net-guard.js)
    fetch: (url, options = {}) => guardedFetch(url, options),

    // Eklentiye ayrılmış klasör; yalnızca metin (core/plugin-files.js)
    files: {
      read: async (rel) => pluginFiles().read(rel),
      write: async (rel, text) => pluginFiles().write(rel, text),
      list: async (rel) => pluginFiles().list(rel),
      remove: async (rel) => pluginFiles().remove(rel)
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
