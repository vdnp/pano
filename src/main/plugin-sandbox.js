// Eklenti süreci (aşama A2): her eklenti gizli, Chromium sandbox'lı bir pencerede çalışır.
// - Node yok (sandbox, nodeIntegration kapalı, contextIsolation açık); preload yalnızca portu iletir.
// - Kendi bellek içi oturumu: pano-plugin://<ad>/ dışındaki her istek iptal (ağ, file://, ws…),
//   izin istekleri reddedilir, yeni pencere ve gezinme yok. Ağa yalnızca ctx.fetch (main) ile çıkılır.
// - Dosyalar pano-plugin://<ad>/ adresinden: /__pano__/ çalışma zamanı, gerisi eklenti klasöründen
//   yalnızca .js/.mjs (klasör dışına çıkma engelli). Sayfa CSP ile ayrıca kısıtlı.
// Denetleyici ve RPC Electron'dan bağımsızdır (core/sandbox/remote-host.js); burası yalnızca süreci açar.

import { BrowserWindow, MessageChannelMain, net, protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromMessagePort } from '../../shared/rpc.js';

export const PLUGIN_SCHEME = 'pano-plugin';
const SCRIPT_EXT = new Set(['.js', '.mjs']);
const CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pano eklentisi</title>
<script type="module" src="/__pano__/runtime.js"></script></head><body></body></html>`;

// app.ready'den önce çağrılmalı (Electron şartı)
export function registerPluginScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

const notFound = () => new Response('Bulunamadı', { status: 404 });

function servePluginFile(root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return notFound();
  }
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !SCRIPT_EXT.has(path.extname(file).toLowerCase())) return notFound();
  return net.fetch(pathToFileURL(file).href).then(async (res) =>
    res.ok
      ? new Response(await res.arrayBuffer(), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } })
      : notFound()
  );
}

// runtimeFile: out/plugin-runtime/runtime.js; preloadFile: out/preload/plugin.js
export function createSandboxSpawner({ runtimeFile, preloadFile, devTools = false, logger = console }) {
  const configured = new Set();

  function configureSession(name, root) {
    const partition = `plugin-${name}`;
    const ses = session.fromPartition(partition, { cache: false });
    if (configured.has(partition)) return ses;
    configured.add(partition);

    const origin = `${PLUGIN_SCHEME}://${name}/`;
    ses.protocol.handle(PLUGIN_SCHEME, (request) => {
      const url = new URL(request.url);
      if (url.host !== name) return notFound();
      if (url.pathname === '/__pano__/host.html') {
        return new Response(HOST_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
      }
      if (url.pathname === '/__pano__/runtime.js') {
        return fs.promises.readFile(runtimeFile).then(
          (body) => new Response(body, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } }),
          () => notFound()
        );
      }
      return servePluginFile(path.resolve(root), url.pathname);
    });
    // Eklentinin kendi kökeni dışında hiçbir istek yok (devtools açıksa devtools:// gerekir)
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(origin) || (devTools && details.url.startsWith('devtools://'));
      if (!allowed) logger.warn(`[${name}] eklenti penceresinden istek engellendi: ${details.url.slice(0, 120)}`);
      callback({ cancel: !allowed });
    });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    return ses;
  }

  return async function spawn({ name, root }) {
    const ses = configureSession(name, root);
    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        session: ses,
        preload: preloadFile,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // Gizli pencerede zamanlayıcılar kısılmasın (kaynak işleri ve ping)
        backgroundThrottling: false,
        spellcheck: false,
        devTools
      }
    });
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.on('will-attach-webview', (event) => event.preventDefault());

    let exit = () => {};
    let exited = false;
    const done = (reason) => {
      if (exited) return;
      exited = true;
      exit(reason);
    };
    wc.on('render-process-gone', (_e, details) => done(details?.reason ?? 'crashed'));
    win.on('closed', () => done('closed'));

    await win.loadURL(`${PLUGIN_SCHEME}://${name}/__pano__/host.html`);
    const { port1, port2 } = new MessageChannelMain();
    port1.on('close', () => done('port-closed'));
    wc.postMessage('pano-plugin-port', null, [port2]);
    if (devTools) wc.openDevTools({ mode: 'detach' });

    return {
      // MessagePortMain → RPC'nin beklediği { postMessage, onMessage } (start() çağrılır)
      port: fromMessagePort(port1),
      pid: () => wc.getOSProcessId(),
      onExit(cb) {
        exit = cb;
      },
      kill() {
        exited = true;
        try {
          port1.close();
        } catch { /* kapanmış */ }
        if (!win.isDestroyed()) win.destroy();
      }
    };
  };
}
