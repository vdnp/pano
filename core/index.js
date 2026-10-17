import { EventEmitter } from 'node:events';
import { openStorage } from './storage/index.js';
import { createNotificationStore } from './notifications.js';
import { createSecrets } from './secrets.js';
import { createScheduler } from './scheduler.js';
import { loadPlugins } from './loader.js';
import { createContext, PERMISSIONS } from './context.js';
import { cleanSuggestion, createCommandRunner, resolveCommandDefs } from './commands.js';
import { createWebFetcher } from './web.js';
import { createProviderCache } from './providers.js';
import { isWidgetView, sanitizeView } from './widgets.js';
import { coerce, coerceList } from './schema.js';
import { createI18n, mergeCatalogs, LOCALES } from '../shared/i18n.js';
import { appCatalogs } from '../locales/index.js';

const MAX_SUGGESTIONS = 20;

/**
 * Pano çekirdeği. Electron'dan bağımsızdır; Electron, CLI veya bir WebSocket
 * sunucusu bu nesneyi aynı şekilde kullanabilir.
 */
export function createCore({
  dataDir, pluginDirs, cipher, logger = console, storage: givenStorage, locale: initialLocale = 'tr',
  // Testlerde sahte fetch verilebilir (okuyucunun sayfa/görsel indirmesi)
  fetchImpl = fetch,
  userAgent,
  fetchFollowsRedirects = false,
  // Eklentinin ctx.openExternal'ı: adresi açar ve true döner; izin verilmeyen adreste false.
  // Adres denetimi ve açma işi çekirdeği kullanan tarafa aittir (Electron'da shell).
  openExternal = async () => false
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

  // Okuyucu paneli: sayfa ve görsel indirme (hata mesajları güncel dilde)
  const web = createWebFetcher({
    fetchImpl, userAgent, followsRedirects: fetchFollowsRedirects, error: (key, params) => i18n.error(key, params)
  });

  // Kartların verisi (providers) depoda ttl süresince önbelleğe alınır
  const providerCache = createProviderCache({ storage, error: (key, params) => i18n.error(key, params) });

  // Komutlar: eklentilerin commands alanı + uygulamanın kendi komutları (pano/…)
  const commands = createCommandRunner({ bus, storage, logger, getI18n: () => i18n, getEntries: commandEntries });

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
    // Kaynak kendi aralığını verebilir (ör. Steam arkadaş kaynağı haberlerden sık çalışır)
    const minutes = Number(source.interval ?? settingsFor(name).interval ?? source.defaultInterval ?? 5);
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
      const declared = Array.isArray(plugin.manifest.permissions) ? plugin.manifest.permissions : [];
      for (const p of declared) if (!PERMISSIONS.includes(p)) logger.warn(`[${name}] bilinmeyen izin yok sayıldı: ${p}`);
      plugin.permissions = declared.filter((p) => PERMISSIONS.includes(p));
      plugin.ctx = createContext(name, {
        notifications, store, secrets, logger,
        getSettings: () => settingsFor(name),
        getI18n: () => i18n,
        permissions: plugin.permissions,
        capabilities
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
    return [...plugins.values()].map(({ manifest, startError, locales, module, permissions }) => ({
      name: manifest.name,
      // Metin core'un dilinde; arayüz dil değişince anahtardan yeniden çevirir
      startError: startError ? i18n.t(startError) : null,
      startErrorI18n: startError ?? null,
      locales: locales ?? {},
      // Eklentinin sunduğu katkı türleri: yalnızca kart sunan eklenti "kaynak eklenmedi" sayılmaz
      kinds: { sources: Boolean(module?.sources), widgets: Boolean(module?.widgets), commands: Boolean(module?.commands) },
      // Ayarlar panelinde okunur şekilde gösterilir
      permissions: permissions ?? [],
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

  // "Tam metni getir": önce bildirimi üreten eklentiye sorulur (katkı alanı content(ctx, bildirim);
  // ör. Steam metni API'den alır, çünkü haber sayfası içeriği JavaScript ile yükler). Eklenti
  // vermezse null döner ve okuyucu sayfayı indirip makaleyi kendisi çıkarır.
  // widgets bir nesne ya da ayarlardan kart listesi hesaplayan fonksiyon olabilir (ör. her oyun için kart)
  function resolveWidgets(plugin) {
    if (plugin.startError) return {};
    const { widgets } = plugin.module;
    if (typeof widgets !== 'function') return widgets ?? {};
    try {
      return widgets(settingsFor(plugin.manifest.name), plugin.ctx) ?? {};
    } catch (err) {
      logger.error(`[${plugin.manifest.name}] kart listesi hesaplanamadı:`, err.message);
      return {};
    }
  }

  // Kart tanımları (arayüze yalnızca düz bilgi gider; map ve get core'da kalır)
  function listWidgets() {
    const out = [];
    for (const plugin of plugins.values()) {
      const name = plugin.manifest.name;
      for (const [widget, def] of Object.entries(resolveWidgets(plugin))) {
        out.push({
          id: `${name}/${widget}`,
          plugin: name,
          widget,
          title: String(def?.title ?? widget),
          view: isWidgetView(def?.view) ? def.view : null,
          size: def?.size === 'wide' ? 'wide' : 'normal',
          hidden: def?.hidden === true
        });
      }
    }
    return out;
  }

  // Kartın verisi: sağlayıcı (önbellekli) → map(data, ctx) → görünüm şemasına göre temizleme.
  // Hata kartın kendisine kalır; diğer kartlar ayrı istendiği için etkilenmez.
  async function widgetData(id, { force = false } = {}) {
    const cut = String(id).indexOf('/');
    const plugin = plugins.get(String(id).slice(0, cut));
    const widget = String(id).slice(cut + 1);
    const def = plugin && cut > 0 ? resolveWidgets(plugin)[widget] : null;
    if (!def) throw i18n.error('core.widgets.notFound', { id: String(id) });
    if (!isWidgetView(def.view)) throw i18n.error('core.widgets.invalidView', { view: String(def.view) });
    const provider = plugin.module.providers?.[def.provider];
    if (typeof provider?.get !== 'function') {
      throw i18n.error('core.widgets.unknownProvider', { provider: String(def.provider) });
    }

    const result = await providerCache.get({
      plugin: plugin.manifest.name,
      id: def.provider,
      provider,
      ctx: plugin.ctx,
      params: def.params ?? {},
      force
    });

    let view;
    try {
      const mapped = typeof def.map === 'function' ? await def.map(result.data, plugin.ctx) : result.data;
      view = sanitizeView(def.view, mapped);
    } catch (err) {
      logger.warn(`[${plugin.manifest.name}] kart verisi hazırlanamadı (${widget}):`, err?.message ?? err);
      throw i18n.error('core.widgets.mapFailed');
    }

    return {
      id: String(id),
      view: def.view,
      data: view.data,
      empty: view.empty,
      fetchedAt: result.fetchedAt,
      // Güncellenemedi: eldeki eski veri, hata mesajıyla birlikte (anahtarı dil değişince yeniden çevrilir)
      stale: result.stale,
      staleError: result.stale ? (result.error?.message ?? String(result.error)) : null,
      staleErrorI18n: result.stale ? (result.error?.i18n ?? null) : null
    };
  }

  // Panel düzeni: { cards: [{ id, visible }] }. Yeni kartlar sona görünür eklenir; şu an olmayan
  // kartlar (ör. başlatılamayan eklenti) gösterilmez ama sırası kaybolmasın diye depoda kalır.
  function dashboardLayout() {
    const widgets = listWidgets();
    const known = new Set(widgets.map((w) => w.id));
    const stored = store.get('dashboard')?.cards ?? [];
    const seen = new Set();
    const cards = [];
    for (const c of stored) {
      if (!known.has(c?.id) || seen.has(c.id)) continue;
      seen.add(c.id);
      cards.push({ id: c.id, visible: Boolean(c.visible) });
    }
    // Düzende henüz olmayan kart sona eklenir; tanımı "hidden" ise gizli başlar
    for (const w of widgets) if (!seen.has(w.id)) cards.push({ id: w.id, visible: !w.hidden });
    return { cards };
  }

  function setDashboard(layout) {
    const known = new Set(listWidgets().map((w) => w.id));
    const seen = new Set();
    const cards = [];
    for (const c of Array.isArray(layout?.cards) ? layout.cards : []) {
      const id = String(c?.id ?? '');
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      cards.push({ id, visible: Boolean(c.visible) });
    }
    const unknown = (store.get('dashboard')?.cards ?? []).filter((c) => !known.has(c?.id));
    store.set('dashboard', { cards: [...cards, ...unknown] });
    return dashboardLayout();
  }

  async function fetchContent(id) {
    const n = notifications.get(id);
    const plugin = n && plugins.get(n.source);
    if (!plugin || plugin.startError || typeof plugin.module.content !== 'function') return null;
    const content = await plugin.module.content(plugin.ctx, n);
    if (!content || !notifications.setContent(n.id, content)) return null;
    return notifications.content(n.id);
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

  // --- Komutlar ---------------------------------------------------------------------------

  // ctx'teki izinli yeteneklerin gerçek uygulaması (izin ve "komut içinde mi" denetimi context.js'te)
  const capabilities = {
    async openExternal(url) {
      if (!(await openExternal(url))) throw i18n.error('core.commands.urlNotAllowed');
    },
    runCommand: (id, params, options) => commands.runAndWait(id, params, options)
  };

  // Uygulamanın kendi komutları; arayüzün yaptığı işlerin palet karşılığı
  const builtinCtx = { forCommand: () => ({}) };
  const BUILTIN = {
    runAll: {
      title: 'core.commands.builtin.runAll',
      async run(_ctx, _params, { progress }) {
        const keys = scheduler.statuses().map((s) => s.key);
        let finished = 0;
        await Promise.all(keys.map(async (key) => {
          await scheduler.runNow(key);
          progress(++finished / keys.length);
        }));
        const failed = scheduler.statuses().filter((s) => keys.includes(s.key) && s.state === 'error').length;
        const key = failed ? 'core.commands.builtin.runAllFailed' : 'core.commands.builtin.runAllDone';
        return { message: i18n.t(key, { count: keys.length, failed }) };
      }
    },
    markAllRead: {
      title: 'core.commands.builtin.markAllRead',
      async run() {
        notifications.markAllRead();
        return { message: i18n.t('core.commands.builtin.markAllReadDone') };
      }
    }
  };

  // 'eklenti/komut' → { id, plugin, name, def, ctx }. Ayara bağlı komut listesi her istekte hesaplanır.
  function commandEntries() {
    const out = new Map();
    for (const [name, def] of Object.entries(BUILTIN)) {
      out.set(`pano/${name}`, { id: `pano/${name}`, plugin: 'pano', name, def, ctx: builtinCtx });
    }
    for (const plugin of plugins.values()) {
      if (plugin.startError || !plugin.module.commands) continue;
      const pluginName = plugin.manifest.name;
      const defs = resolveCommandDefs(plugin.module, settingsFor(pluginName), plugin.ctx, logger, pluginName);
      for (const [name, def] of Object.entries(defs)) {
        out.set(`${pluginName}/${name}`, { id: `${pluginName}/${name}`, plugin: pluginName, name, def, ctx: plugin.ctx });
      }
    }
    return out;
  }

  function runCommand(id, params, origin = 'palette') {
    const { runId } = commands.start(id, params, { origin });
    return runId;
  }

  // Paletteki parametre adımının öneri listesi: parametre şemasında bildirilen sağlayıcı
  async function commandSuggest(id, key, query) {
    const entry = commands.lookup(id);
    const schema = entry.def.params ?? {};
    const s = schema[key];
    const provider = typeof s?.suggest === 'string' ? s.suggest : s?.suggest?.provider;
    const plugin = plugins.get(entry.plugin);
    const fn = provider && plugin?.module.suggest?.[provider];
    if (typeof fn !== 'function') throw i18n.error('core.errors.unknownProvider', { provider: String(provider ?? key) });

    const q = String(query ?? '').trim().slice(0, 100);
    if (q.length < 2) return [];
    const results = await fn(plugin.ctx, q);
    const out = [];
    for (const r of Array.isArray(results) ? results : []) {
      const value = cleanSuggestion(schema, key, r?.value);
      const label = String(r?.label ?? '').trim().slice(0, 200);
      if (!value || !label) continue;
      out.push({ label, detail: r.detail ? String(r.detail).slice(0, 200) : '', value });
      if (out.length === MAX_SUGGESTIONS) break;
    }
    return out;
  }

  // Bildirim satırındaki eylem: parametreler bildirimden core'da çıkarılır (eski bildirimlerde
  // de çalışır); yalnızca komutun kendi eklentisinin bildirimine uygulanır.
  function runForNotification(id, notificationId) {
    const entry = commands.lookup(id);
    const action = entry.def.notificationAction;
    const n = notifications.get(String(notificationId));
    const params = action && n && n.source === entry.plugin ? action.params?.(n) : null;
    if (!params) throw i18n.error('core.commands.notApplicable');
    const { runId, done } = commands.start(id, params, { origin: 'notification' });
    if (action.markRead) {
      done.then((o) => {
        if (o.status === 'ok') notifications.markRead(n.id);
      });
    }
    return runId;
  }

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
    widgets: {
      list: listWidgets,
      data: widgetData
    },
    dashboard: {
      get: dashboardLayout,
      set: setDashboard
    },
    getLocale: () => locale,
    web,
    notifications: {
      list: notifications.list,
      markRead: notifications.markRead,
      markAllRead: notifications.markAllRead,
      content: notifications.content,
      setContent: notifications.setContent,
      fetchContent,
      clear: notifications.clear
    },
    commands: {
      list: commands.list,
      run: runCommand,
      cancel: commands.cancel,
      running: commands.running,
      history: commands.history,
      clearHistory: commands.clearHistory,
      suggest: commandSuggest,
      runForNotification
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
