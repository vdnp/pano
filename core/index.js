import { EventEmitter } from 'node:events';
import { openStorage } from './storage/index.js';
import { createNotificationStore } from './notifications.js';
import { createSecrets } from './secrets.js';
import { createScheduler } from './scheduler.js';
import { loadPlugins } from './loader.js';
import { createContext, PERMISSIONS } from './context.js';
import { cleanSuggestion, createCommandRunner } from './commands.js';
import { createInProcessHost } from './plugin-host.js';
import { createAutomation } from './automation/index.js';
import { createWebFetcher } from './web.js';
import { createProviderCache } from './providers.js';
import { isWidgetView, sanitizeView } from './widgets.js';
import { coerce, coerceList } from './schema.js';
import { createI18n, mergeCatalogs, LOCALES } from '../shared/i18n.js';
import { appCatalogs } from '../locales/index.js';

const MAX_SUGGESTIONS = 20;
// Başlatılamamış ya da henüz hazır olmayan eklentinin katkısı yoktur
const EMPTY_INFO = { kinds: { sources: false, widgets: false, commands: false }, hasSetup: false, hasTeardown: false, hasContent: false, providers: {}, suggest: [] };
const EMPTY_DESC = { sources: {}, widgets: {}, commands: {} };

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

  // Otomasyon: bildirim/zaman/açılış tetikleyicileri → koşullar → komutlar
  const automation = createAutomation({ bus, store, commands, notifications, getI18n: () => i18n, logger });

  // Kaynak ve kart başlıkları eklentide ctx.t ile üretildiği için açıklamalar yeni dilde yeniden alınır
  async function setLocale(next) {
    if (!LOCALES.includes(next) || next === locale) return;
    locale = next;
    rebuildI18n();
    await Promise.all([...plugins.values()].map((plugin) => refresh(plugin)));
    bus.emit('sources:changed');
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

  // Eklentinin ayara bağlı katkıları (kaynaklar, kartlar, komutlar) host'tan düz açıklama olarak
  // alınır ve burada önbelleğe konur; listeler eklenti kodunu çağırmadan bundan okunur. Yenileme
  // başlangıçta, ayar kaydında ve dil değişiminde yapılır; aynı eklenti için sırayla çalışır.
  function refresh(plugin) {
    plugin.refreshing = (plugin.refreshing ?? Promise.resolve()).then(async () => {
      if (!plugin.ready) return;
      try {
        plugin.desc = await plugin.host.describe(settingsFor(plugin.manifest.name));
      } catch (err) {
        logger.error(`[${plugin.manifest.name}] katkılar okunamadı:`, err?.message ?? err);
        plugin.desc = EMPTY_DESC;
      }
      commandsCache = null;
      syncSources(plugin);
    });
    return plugin.refreshing;
  }

  // Zamanlayıcıdaki işleri eklentinin güncel kaynak listesiyle eşler: yeni kaynak
  // eklenir, kalkan silinir, kalanın başlığı/aralığı yerinde güncellenir.
  function syncSources(plugin) {
    const name = plugin.manifest.name;
    const sources = plugin.desc?.sources ?? {};
    const existing = new Map(
      scheduler.statuses().filter((s) => s.plugin === name).map((s) => [s.key, s])
    );

    for (const [sourceId, source] of Object.entries(sources)) {
      const key = `${name}/${sourceId}`;
      const meta = { plugin: name, source: sourceId, title: source.title ?? sourceId };
      const intervalMs = intervalFor(name, source);
      const current = existing.get(key);
      existing.delete(key);

      if (!current) {
        // Tanım her çalışmada host'taki güncel haliyle çalışır; ad değişince iş yeniden kurulmaz.
        // Bildirimler bu işin kimliğiyle (job) ve varsa nedeniyle (causedBy) kaydedilir.
        scheduler.add(key, (cause) => plugin.host.invoke('source.run', sourceId, { job: sourceId, causedBy: cause?.causedBy ?? null }), intervalMs, meta);
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
      const ctx = createContext(name, {
        notifications, store, secrets, logger,
        getSettings: () => settingsFor(name),
        getI18n: () => i18n,
        permissions: plugin.permissions,
        capabilities
      });
      // Eklentiye yalnızca host üzerinden ulaşılır (aşama A'da ayrı süreçteki eklenti için RPC)
      plugin.host = createInProcessHost({ name, module: plugin.module, ctx, logger });
      plugin.info = EMPTY_INFO;
      plugin.desc = EMPTY_DESC;

      try {
        plugin.info = await plugin.host.inspect();
        if (plugin.info.hasSetup) await plugin.host.invoke('setup');
      } catch (err) {
        logger.error(`[${name}] başlatılamadı:`, err.message);
        // Arayüz "kaynak eklenmedi" yerine asıl sorunu gösterebilsin
        plugin.startError = { key: 'core.errors.startFailed', params: { error: err?.i18n ?? err?.message ?? String(err) } };
        continue;
      }

      // setup bitmeden katkıları çağrılmaz
      plugin.ready = true;
      await refresh(plugin);
    }
    bus.emit('sources:changed');
    // Eklentiler ve komutları yüklendikten sonra (kurallar onların komutlarını çağırır)
    automation.start();
  }

  // Kapanış: yeni çalışma başlamaz, sürenler kısa süre beklenir, sonra depo kapanır.
  // Çekirdeği kullanan taraf bu sözü beklemeli (Electron'da before-quit).
  async function stop({ drainMs = 3000 } = {}) {
    automation.stop();
    scheduler.stopAll();
    if (!(await scheduler.drain(drainMs))) logger.warn('Kapanışta süren kaynak işleri beklenmeden kapatıldı');
    for (const plugin of plugins.values()) {
      if (!plugin.ready || !plugin.info.hasTeardown) continue;
      try { await plugin.host.invoke('teardown'); } catch { /* kapanışta yut */ }
    }
    storage.close();
  }

  function listSources() {
    const statuses = scheduler.statuses();
    return [...plugins.values()].map(({ manifest, startError, locales, info, permissions }) => ({
      name: manifest.name,
      // Metin core'un dilinde; arayüz dil değişince anahtardan yeniden çevirir
      startError: startError ? i18n.t(startError) : null,
      startErrorI18n: startError ?? null,
      locales: locales ?? {},
      // Eklentinin sunduğu katkı türleri: yalnızca kart sunan eklenti "kaynak eklenmedi" sayılmaz
      kinds: { ...(info ?? EMPTY_INFO).kinds },
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

  async function updateSettings(name, values) {
    const plugin = getPlugin(name);
    const clean = {};
    for (const [key, schema] of Object.entries(plugin.manifest.settings ?? {})) {
      if (key in values) clean[key] = coerce(values[key], schema);
    }
    const all = store.get('settings') ?? {};
    store.set('settings', { ...all, [name]: { ...(all[name] ?? {}), ...clean } });

    await refresh(plugin);
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
    if (plugin.startError) throw i18n.error(plugin.startError.key, plugin.startError.params);
    if (!field || !plugin.info.suggest.includes(provider)) throw i18n.error('core.errors.unknownProvider', { provider });

    const q = String(query ?? '').trim().slice(0, 100);
    if (q.length < 2) return [];

    const results = await plugin.host.invoke('suggest', provider, { query: q });
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

  // Kart tanımları: önbelleğe alınmış açıklamadan (eklenti kodu çağrılmaz; map ve get host'ta kalır)
  function listWidgets() {
    const out = [];
    for (const plugin of plugins.values()) {
      const name = plugin.manifest.name;
      for (const [widget, def] of Object.entries(plugin.desc?.widgets ?? {})) {
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
    const def = plugin && cut > 0 && Object.hasOwn(plugin.desc?.widgets ?? {}, widget) ? plugin.desc.widgets[widget] : null;
    if (!def) throw i18n.error('core.widgets.notFound', { id: String(id) });
    if (!isWidgetView(def.view)) throw i18n.error('core.widgets.invalidView', { view: String(def.view) });
    const providerInfo = Object.hasOwn(plugin.info.providers, def.provider ?? '') ? plugin.info.providers[def.provider] : null;
    if (!providerInfo) {
      throw i18n.error('core.widgets.unknownProvider', { provider: String(def.provider) });
    }

    // Önbellek sağlayıcıyı bu sarmalayıcıyla çağırır (ttl açıklamadan)
    const provider = {
      ttl: providerInfo.ttl,
      get: (_ctx, params) => plugin.host.invoke('provider.get', def.provider, { params })
    };
    const result = await providerCache.get({
      plugin: plugin.manifest.name,
      id: def.provider,
      provider,
      ctx: null,
      params: def.params ?? {},
      force
    });

    let view;
    try {
      const mapped = def.hasMap ? await plugin.host.invoke('widget.map', widget, { data: result.data }) : result.data;
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
    if (!plugin?.ready || !plugin.info.hasContent) return null;
    const content = await plugin.host.invoke('content', null, { notification: n });
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
    for (const sourceId of Object.keys(plugin.desc?.sources ?? {})) {
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
      async run(_ctx, _params, { progress, runId }) {
        const keys = scheduler.statuses().map((s) => s.key);
        let finished = 0;
        await Promise.all(keys.map(async (key) => {
          // Kaynakların bu çalıştırmada ürettiği bildirimler bu komuta bağlanır (otomasyon döngüsü)
          await scheduler.runNow(key, { causedBy: runId });
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
    },
    // Otomasyonların yardımcı komutları (paletten de çalışır)
    notify: {
      title: 'core.commands.builtin.notify',
      params: {
        title: { type: 'string', label: 'core.commands.builtin.params.title', required: true },
        body: { type: 'string', label: 'core.commands.builtin.params.body' },
        level: { type: 'string', label: 'core.commands.builtin.params.level', default: 'info', placeholder: 'info | warning | error' }
      },
      async run(_ctx, { title, body, level }, { runId }) {
        notifications.add({
          id: `notify:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          source: 'pano', title, body, level
        }, { causedBy: runId });
        return { message: i18n.t('core.commands.builtin.notifyDone') };
      }
    },
    // Sesli masaüstü uyarısı: gösterimi çekirdeği kullanan taraf yapar (Electron'da Notification)
    alert: {
      title: 'core.commands.builtin.alert',
      params: {
        title: { type: 'string', label: 'core.commands.builtin.params.title', required: true },
        body: { type: 'string', label: 'core.commands.builtin.params.body' }
      },
      async run(_ctx, { title, body }) {
        bus.emit('app:alert', { title, body: body ?? '' });
        return { message: i18n.t('core.commands.builtin.alertDone') };
      }
    },
    // Bildirim kimliği gerektirir; otomasyonda {{id}} ile kullanılır, paletten gizli
    pin: {
      title: 'core.commands.builtin.pin',
      palette: false,
      params: { id: { type: 'string', label: 'core.commands.builtin.params.id', required: true } },
      async run(_ctx, { id }) {
        if (!notifications.setPinned(id, true)) throw i18n.error('core.commands.builtin.notificationNotFound');
        return { message: i18n.t('core.commands.builtin.pinDone') };
      }
    },
    unpin: {
      title: 'core.commands.builtin.unpin',
      palette: false,
      params: { id: { type: 'string', label: 'core.commands.builtin.params.id', required: true } },
      async run(_ctx, { id }) {
        if (!notifications.setPinned(id, false)) throw i18n.error('core.commands.builtin.notificationNotFound');
        return { message: i18n.t('core.commands.builtin.unpinDone') };
      }
    }
  };

  // 'eklenti/komut' → { id, plugin, name, def, ctx }. Eklenti komutlarının tanımı önbelleğe alınmış
  // açıklamadan gelir (her aramada eklenti kodu çağrılmaz); run host'a gider. Açıklama yenilenince
  // (ayar, dil) önbellek silinir.
  let commandsCache = null;
  function commandEntries() {
    if (commandsCache) return commandsCache;
    const out = new Map();
    for (const [name, def] of Object.entries(BUILTIN)) {
      out.set(`pano/${name}`, { id: `pano/${name}`, plugin: 'pano', name, def, ctx: builtinCtx });
    }
    for (const plugin of plugins.values()) {
      if (!plugin.ready) continue;
      const pluginName = plugin.manifest.name;
      for (const [name, described] of Object.entries(plugin.desc?.commands ?? {})) {
        const def = {
          ...described,
          run: (_ctx, params, { signal, progress, runId, depth }) =>
            plugin.host.invoke('command.run', name, { params, runId, depth }, { signal, onProgress: progress })
        };
        out.set(`${pluginName}/${name}`, { id: `${pluginName}/${name}`, plugin: pluginName, name, def, ctx: builtinCtx, host: plugin.host });
      }
    }
    commandsCache = out;
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
    // Başlatılamamış eklentinin komutu zaten listede yoktur; öneri adı inspect'ten
    if (!provider || !plugin?.ready || !plugin.info.suggest.includes(provider)) {
      throw i18n.error('core.errors.unknownProvider', { provider: String(provider ?? key) });
    }

    const q = String(query ?? '').trim().slice(0, 100);
    if (q.length < 2) return [];
    const results = await plugin.host.invoke('suggest', provider, { query: q });
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

  // Bildirim satırındaki eylem: parametreler bildirimden eklentide çıkarılır (eski bildirimlerde
  // de çalışır); yalnızca komutun kendi eklentisinin bildirimine uygulanır.
  async function runForNotification(id, notificationId) {
    const entry = commands.lookup(id);
    const action = entry.def.notificationAction;
    const n = notifications.get(String(notificationId));
    const applicable = action?.hasParams && entry.host && n && n.source === entry.plugin;
    const params = applicable ? await entry.host.invoke('notificationAction.params', entry.name, { notification: n }) : null;
    if (!params || typeof params !== 'object') throw i18n.error('core.commands.notApplicable');
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
    automation: {
      list: automation.list,
      save: automation.save,
      remove: automation.remove,
      setEnabled: automation.setEnabled,
      test: automation.test,
      templates: automation.templates,
      approvals: automation.approvals,
      approve: automation.approve,
      reject: automation.reject
    },
    notifications: {
      list: notifications.list,
      markRead: notifications.markRead,
      setPinned: notifications.setPinned,
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
