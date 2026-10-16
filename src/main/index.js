import {
  app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, powerMonitor, safeStorage, shell, Tray
} from 'electron';
import path from 'node:path';
import { createCore } from '../../core/index.js';
import { createI18n, mergeCatalogs, resolveLocale } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';

// package.json build.appId ile aynı olmalı; Windows bildirimleri bu kimliğe bağlıdır
const APP_ID = 'io.github.vdnp.pano';

let mainWindow = null;
let core = null;
let tray = null;
// Tepsi menüsü ve masaüstü bildirimleri için; uygulama ayarındaki dile göre kurulur
let i18n = createI18n({ locale: 'tr', catalogs: mergeCatalogs(appCatalogs) });
let systemLocale = 'en';
// Kapat düğmesi pencereyi yalnızca gizler; gerçek çıkışta bu bayrak açılır.
let isQuitting = false;

// Oturum açılışında başlatıldıysa pencere açılmaz, uygulama tepside bekler.
const startHidden =
  process.argv.includes('--hidden') ||
  (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);

const isWebUrl = (url) => {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

// Electron'un safeStorage'ı ile token'lar işletim sisteminin anahtar
// zincirinde (Windows DPAPI, macOS Keychain, Linux libsecret) şifrelenir.
const cipher = {
  encrypt(value) {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(value).toString('base64');
    }
    console.warn('Sistem şifrelemesi kullanılamıyor, anahtar şifrelenmeden saklanıyor.');
    return 'plain:' + Buffer.from(value, 'utf8').toString('base64');
  },
  decrypt(raw) {
    if (raw.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
    if (raw.startsWith('plain:')) return Buffer.from(raw.slice(6), 'base64').toString('utf8');
    return null;
  }
};

function pluginDirs() {
  const builtin = app.isPackaged
    ? path.join(process.resourcesPath, 'plugins')
    : path.join(app.getAppPath(), 'plugins');
  // Kullanıcının kendi eklentileri: %APPDATA%/pano/plugins (Windows) vb.
  return [builtin, path.join(app.getPath('userData'), 'plugins')];
}

// Tepsi ve rozet ikonları build/ içindedir; paketlenince resources/icons'a kopyalanır.
// createFromPath aynı klasördeki @2x sürümünü yüksek DPI için kendisi alır.
function icon(name) {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(app.getAppPath(), 'build');
  return nativeImage.createFromPath(path.join(dir, name));
}

const overlays = new Map();
function overlayFor(count) {
  const name = count > 9 ? '9plus' : String(count);
  if (!overlays.has(name)) overlays.set(name, icon(`overlay-${name}.png`));
  return overlays.get(name);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function focusWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    title: 'Pano',
    backgroundColor: '#181B29',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    updateBadge();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  // Windows oturumu kapanırken gizleme kapanışı engellemesin
  mainWindow.on('session-end', () => {
    isQuitting = true;
  });

  // Arayüz içinden açılan tüm bağlantılar varsayılan tarayıcıya gider
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));

  handle('notifications:list', () => core.notifications.list());
  handle('notifications:markRead', (ids) =>
    core.notifications.markRead(Array.isArray(ids) ? ids.slice(0, 1000).map(String) : String(ids))
  );
  handle('notifications:markAllRead', (source, job) =>
    core.notifications.markAllRead(source ? String(source) : undefined, job ? String(job) : undefined)
  );
  handle('notifications:clear', (source) => core.notifications.clear(source ? String(source) : undefined));

  handle('sources:list', () => core.sources.list());
  handle('sources:runNow', (key) => core.sources.runNow(String(key)));
  handle('sources:updateSettings', (name, values) => core.sources.updateSettings(String(name), values ?? {}));
  handle('sources:suggest', (name, provider, query) =>
    core.sources.suggest(String(name), String(provider), String(query ?? ''))
  );
  handle('sources:setSecret', (name, key, value) =>
    core.sources.setSecret(String(name), String(key), value ? String(value) : '')
  );

  handle('app:openExternal', (url) => (isWebUrl(url) ? shell.openExternal(url) : undefined));

  handle('appSettings:get', () => appSettingsPayload());
  handle('appSettings:set', (values) => {
    const input = values && typeof values === 'object' ? values : {};
    const clean = {};
    for (const key of ['openAtLogin', 'pauseNotifications']) {
      if (key in input) clean[key] = Boolean(input[key]);
    }
    // Geçerli değerleri core denetler (system | tr | en)
    if ('language' in input) clean.language = String(input.language);
    setAppSettings(clean);
    return appSettingsPayload();
  });
}

function forwardEvents() {
  core.bus.on('notifications:changed', () => {
    send('notifications:changed');
    updateBadge();
  });
  core.bus.on('source:status', () => send('sources:changed'));
  core.bus.on('sources:changed', () => send('sources:changed'));
  core.bus.on('app:settingsChanged', () => {
    applyLocale();
    send('appSettings:changed', appSettingsPayload());
    buildTrayMenu();
    updateBadge();
  });
}

// Geliştirme modunda exe electron.exe olduğu için uygulama yolu da argüman olarak verilir.
// Windows kaydı kaldırırken aynı argümanları ister, bu yüzden her çağrıda aynı liste kullanılır.
function applyLoginItem(openAtLogin) {
  const args = process.defaultApp ? [path.resolve(process.argv[1] ?? '.'), '--hidden'] : ['--hidden'];
  app.setLoginItemSettings({ openAtLogin, args });
}

// "system" seçiliyse işletim sisteminin dil listesinden çözülür; core ve tepsi aynı dili kullanır
function applyLocale() {
  const preferred = app.getPreferredSystemLanguages();
  systemLocale = resolveLocale('system', preferred);
  const locale = resolveLocale(core.getAppSettings().language, preferred);
  core.setLocale(locale);
  i18n = createI18n({ locale, catalogs: mergeCatalogs(appCatalogs) });
}

// Arayüz çözülmüş dili (locale) ve "Sistem dili (…)" seçeneği için sistem dilini de alır
const appSettingsPayload = () => ({ ...core.getAppSettings(), locale: i18n.locale, systemLocale });

function setAppSettings(values) {
  const next = core.setAppSettings(values);
  if ('openAtLogin' in values) applyLoginItem(next.openAtLogin);
  return next;
}

function runAllSources() {
  for (const source of core.sources.list()) {
    for (const job of source.jobs) core.sources.runNow(job.key);
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function buildTrayMenu() {
  if (!tray) return;
  const { pauseNotifications } = core.getAppSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: i18n.t('tray.open'), click: focusWindow },
      { label: i18n.t('tray.checkAll'), click: runAllSources },
      {
        label: i18n.t('tray.pause'),
        type: 'checkbox',
        checked: pauseNotifications,
        click: (item) => setAppSettings({ pauseNotifications: item.checked })
      },
      { type: 'separator' },
      { label: i18n.t('tray.quit'), click: quitApp }
    ])
  );
}

function updateBadge() {
  if (!core) return;
  const count = core.notifications.list().filter((n) => !n.read).length;
  const { pauseNotifications } = core.getAppSettings();

  let tooltip = count ? i18n.t('tray.tooltipUnread', { count }) : i18n.t('tray.tooltip');
  if (pauseNotifications) tooltip = i18n.t('tray.tooltipPaused', { tooltip });
  tray?.setToolTip(tooltip);

  if (process.platform === 'darwin') tray?.setTitle(count ? String(count) : '');
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOverlayIcon(count ? overlayFor(count) : null, count ? i18n.t('tray.overlay', { count }) : '');
  }
}

function createTray() {
  tray = new Tray(icon('tray.png'));
  // macOS'ta tıklama menüyü açar; Windows ve Linux'ta sol tık pencereyi getirir
  tray.on('click', () => {
    if (process.platform !== 'darwin') focusWindow();
  });
  buildTrayMenu();
  updateBadge();
}

// İlk açılışta onlarca bildirim gelirse masaüstünü boğmamak için toplu gösterim
function setupDesktopNotifications() {
  let pending = [];
  let timer = null;

  function show(title, body, url) {
    const toast = new Notification({ title, body: body?.slice(0, 200) ?? '' });
    toast.on('click', () => (url && isWebUrl(url) ? shell.openExternal(url) : focusWindow()));
    toast.show();
  }

  function flush() {
    const batch = pending;
    pending = [];
    // Duraklatılmışken bildirimler akışa yine eklenir, yalnızca masaüstünde gösterilmez
    if (core.getAppSettings().pauseNotifications) return;
    if (!batch.length || !Notification.isSupported()) return;

    if (batch.length <= 3) {
      batch.forEach((n) => show(n.title, n.body, n.url));
    } else {
      const sources = [...new Set(batch.map((n) => n.source))].join(', ');
      show(i18n.t('desktop.batchTitle', { count: batch.length }), i18n.t('desktop.batchBody', { sources }), null);
    }
  }

  core.bus.on('notification:new', (n) => {
    pending.push(n);
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID); // Windows bildirimleri için gerekli

    core = createCore({
      dataDir: app.getPath('userData'),
      pluginDirs: pluginDirs(),
      cipher,
      // Dil ayarı core'un deposunda; onu okumadan önceki hatalar sistem dilinde olsun
      locale: resolveLocale('system', app.getPreferredSystemLanguages())
    });
    applyLocale();

    registerIpc();
    forwardEvents();
    setupDesktopNotifications();
    createTray();
    // Kurulum yolu değişmiş olabilir; kaydı yeniden yaz. Dev'de dokunma ki
    // kurulu sürümün kaydı electron.exe ile ezilmesin.
    if (app.isPackaged) applyLoginItem(core.getAppSettings().openAtLogin);
    if (!startHidden) createWindow();
    await core.start();

    app.on('activate', focusWindow);
    // macOS/Linux kapanışında gizleme kapanışı engellemesin
    powerMonitor.on('shutdown', quitApp);
  });

  // Uygulama tepside yaşamaya devam eder; çıkış yalnızca tepsi menüsünden
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    isQuitting = true;
    core?.stop();
  });
}
