import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromMessagePort } from '../../shared/rpc.js';
import { startRuntime } from '../../core/sandbox/runtime.js';
import { createRemoteHostFactory } from '../../core/sandbox/remote-host.js';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { publicResolve, removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

// Eklenti "süreci": aynı Node sürecinde ama yalnızca MessageChannel üzerinden konuşan çalışma zamanı.
// Gerçek uygulamada aynı runtime sandbox'lı renderer'da çalışır; core yalnızca portu görür.
function channelSpawner() {
  const procs = [];
  const spawn = async ({ root, entry }) => {
    const { port1, port2 } = new MessageChannel();
    let frozen = false;
    const raw = fromMessagePort(port2);
    // freeze: süreç "takılır" (mesajlara yanıt vermez)
    const port = {
      postMessage: (m) => { if (!frozen) raw.postMessage(m); },
      onMessage: (cb) => raw.onMessage((m) => { if (!frozen) cb(m); })
    };
    const runtime = startRuntime({ port, importModule: (e) => import(pathToFileURL(path.join(root, e)).href) });
    let exit = () => {};
    const proc = {
      port: fromMessagePort(port1),
      kill() {
        runtime.close('killed');
        port1.close();
        port2.close();
        proc.killed = true;
      },
      onExit(cb) { exit = cb; },
      crash() { exit('crash'); },
      freeze() { frozen = true; }
    };
    procs.push(proc);
    return proc;
  };
  return { spawn, procs };
}

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const fixture = (name) => fs.readFileSync(path.join(process.cwd(), 'test', 'fixtures', name), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const GITHUB_THREADS = [{
  id: '100', reason: 'review_requested', updated_at: '2026-10-15T10:00:00Z',
  repository: { full_name: 'acme/app', html_url: 'https://github.com/acme/app' },
  subject: { title: 'Giriş hatası', type: 'PullRequest', url: 'https://api.github.com/repos/acme/app/pulls/12' }
}];

// Ağ yerine sabit yanıtlar; çağrılar kaydedilir (main tarafında yapılır, eklenti yapamaz)
function fakeNetwork() {
  const calls = [];
  const fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET' });
    if (u.startsWith('https://api.github.com/notifications/threads/')) return new Response(null, { status: 205 });
    if (u.startsWith('https://api.github.com/notifications')) {
      return new Response(JSON.stringify(GITHUB_THREADS), { status: 200, headers: { 'content-type': 'application/json', 'last-modified': 'Wed, 15 Oct 2026 10:00:00 GMT' } });
    }
    if (u.includes('ISteamNews/GetNewsForApp')) return new Response(fixture('steam-news.json'), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://feeds.example.com/')) return new Response(fixture('rss2.xml'), { status: 200, headers: { 'content-type': 'application/rss+xml', etag: '"v1"' } });
    if (u.startsWith('https://huge.example.com/')) return new Response('x'.repeat(11 * 1024 * 1024), { status: 200 });
    return new Response('yok', { status: 404 });
  });
  return { fetch, calls };
}

describe('sandbox: gerçek eklentiler RPC üzerinden, kodları değişmeden', () => {
  let core, net, opened, spawner;

  beforeEach(async () => {
    net = fakeNetwork();
    vi.stubGlobal('fetch', net.fetch);
    opened = vi.fn(async () => true);
    spawner = channelSpawner();
    core = createCore({ resolveHost: publicResolve,
      pluginDirs: [PLUGINS_DIR], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:'),
      openExternal: opened,
      hostFactory: createRemoteHostFactory({ spawn: spawner.spawn })
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop({ drainMs: 100 });
    vi.unstubAllGlobals();
  });

  it('her eklenti kendi "sürecinde" yüklenir; core eklenti modülünü hiç import etmez', () => {
    const names = core.sources.list().map((s) => s.name).sort();
    expect(names).toEqual(['github', 'ornek-kart', 'rss', 'steam']);
    expect(spawner.procs).toHaveLength(4);
    expect(core.sources.list().every((s) => !s.startError)).toBe(true);
  });

  it('kaynaklar: bildirim, durum, ayar ve gizli alan RPC ile; tekrar çalışmada aynı bildirim gelmez', async () => {
    await core.sources.updateSettings('rss', { feeds: [{ url: 'https://feeds.example.com/a.xml', name: 'Örnek' }] });
    await core.sources.updateSettings('steam', { games: [{ appId: 730, name: 'Counter-Strike 2' }], officialOnly: false });
    core.sources.setSecret('github', 'token', 'ghp_test');
    const keys = core.sources.list().flatMap((s) => s.jobs.map((j) => j.key));
    for (const key of keys) await core.sources.runNow(key);
    await wait(50);

    const bySource = (s) => core.notifications.list().filter((n) => n.source === s);
    expect(bySource('github')).toHaveLength(1);
    expect(bySource('github')[0]).toMatchObject({ title: 'Giriş hatası', body: 'acme/app', job: 'notifications', tags: ['github:type.PullRequest', 'github:reason.review_requested'] });
    expect(bySource('rss').length).toBeGreaterThan(0);
    expect(bySource('steam').length).toBeGreaterThan(0);
    // Ağ isteği main'de, gizli alan eklenti tarafına kopyayla gitti
    expect(net.calls.some((c) => c.url.startsWith('https://api.github.com/notifications?'))).toBe(true);
    for (const s of core.sources.list()) for (const j of s.jobs) if (j.key !== 'steam/friends') expect(j.error).toBeNull();

    // Durum main'de kalıcı; ikinci çalışmada eklenti "görüldü" bilgisini kopyadan okur
    const before = core.notifications.list().length;
    for (const key of keys) await core.sources.runNow(key);
    await wait(50);
    expect(core.notifications.list().length).toBe(before);
  });

  it('çevrilebilir hata anahtarıyla taşınır (dil değişince yeniden çevrilebilir)', async () => {
    await core.sources.runNow('github/notifications');
    const job = core.sources.list().find((s) => s.name === 'github').jobs[0];
    expect(job.errorI18n).toEqual({ key: 'github:errors.noToken' });
    expect(job.error).toContain('Erişim anahtarı eklenmedi');
  });

  it('kartlar, sağlayıcılar, öneriler ve tam metin RPC üzerinden', async () => {
    const card = core.widgets.list().find((w) => w.id === 'ornek-kart/summary');
    expect(card).toBeTruthy();
    const data = await core.widgets.data('ornek-kart/summary');
    expect(data.data.items.map((i) => i.label)).toEqual(['Okunmamış', 'Kaynak', 'Çalışma']);
    expect(core.commands.list().map((c) => c.id)).toEqual(expect.arrayContaining(['github/markThreadRead', 'steam/launchGame']));
  });

  it('komutlar: bildirim eylemi ve izinli openExternal RPC ile; izin denetimi main\'de', async () => {
    core.sources.setSecret('github', 'token', 'ghp_test');
    await core.sources.runNow('github/notifications');
    await wait(30);
    const n = core.notifications.list().find((x) => x.source === 'github');
    const runId = await core.commands.runForNotification('github/markThreadRead', n.id);
    const done = await new Promise((resolve) => core.bus.on('command:finished', (i) => i.runId === runId && resolve(i)));
    expect(done).toMatchObject({ status: 'ok' });
    expect(net.calls.at(-1)).toMatchObject({ url: 'https://api.github.com/notifications/threads/100', method: 'PATCH' });
    await vi.waitFor(() => expect(core.notifications.list().find((x) => x.id === n.id).read).toBe(true));

    const launch = core.commands.run('steam/launchGame', { appId: 730, name: 'CS2' });
    const launched = await new Promise((resolve) => core.bus.on('command:finished', (i) => i.runId === launch && resolve(i)));
    expect(launched.status).toBe('ok');
    expect(opened).toHaveBeenCalledWith('steam://rungameid/730');
  });
});

// Denetleyici ve sınırlar: geçici eklentilerle, kısa sürelerle
const FLAKY = `
let n = 0;
export default {
  async setup() { globalThis.__sandboxSetups = (globalThis.__sandboxSetups ?? 0) + 1; },
  sources: {
    akis: { title: 'Akış', async run(ctx) { ctx.notify({ id: 'a' + (++n) + Math.random(), title: 'merhaba' }); } },
    akis2: { title: 'Akış 2', async run(ctx) { ctx.notify({ id: 'b' + (++n) + Math.random(), title: 'merhaba' }); } }
  },
  commands: {
    selam: { title: 'Selam', async run() { return { message: 'merhaba' }; } },
    buyukDurum: { title: 'Büyük', async run(ctx) { ctx.state.set('dev', 'x'.repeat(2 * 1024 * 1024)); return { message: String(ctx.state.get('dev').length) }; } },
    buyukFetch: { title: 'Büyük fetch', async run(ctx) { const r = await ctx.fetch('https://huge.example.com/'); return { message: String((await r.text()).length) }; } }
  }
};`;

describe('sandbox denetleyicisi', () => {
  let dir, core, spawner, logger;
  const fast = { pingIntervalMs: 20, pingTimeoutMs: 60, backoffMs: [10, 10, 10], readyWaitMs: 2000, crashWindowMs: 60_000, maxCrashes: 3 };

  beforeEach(async () => {
    globalThis.__sandboxSetups = 0;
    vi.stubGlobal('fetch', fakeNetwork().fetch);
    dir = tempDir('pano-sandbox-');
    writePlugin(dir, 'oynak', { name: 'oynak' }, FLAKY);
    spawner = channelSpawner();
    logger = silentLogger();
    core = createCore({ resolveHost: publicResolve,
      pluginDirs: [dir], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:'),
      hostFactory: createRemoteHostFactory({ spawn: spawner.spawn, timings: fast })
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop({ drainMs: 100 });
    removeDir(dir);
    vi.unstubAllGlobals();
    delete globalThis.__sandboxSetups;
  });

  const run = (id) => new Promise((resolve) => {
    const runId = core.commands.run(id);
    core.bus.on('command:finished', (i) => i.runId === runId && resolve(i));
  });

  it('çökmede yeniden başlatır; setup ve açıklama geri kurulur, komut yine çalışır', async () => {
    expect(globalThis.__sandboxSetups).toBe(1);
    spawner.procs[0].crash();
    expect(spawner.procs[0].killed).toBe(true);
    await vi.waitFor(() => expect(spawner.procs).toHaveLength(2));
    await vi.waitFor(() => expect(core.sources.list()[0].hostState).toBe('restarted'));
    expect(globalThis.__sandboxSetups).toBe(2);
    expect(await run('oynak/selam')).toMatchObject({ status: 'ok', message: 'merhaba' });
  });

  it('yanıt vermeyen süreci (ping zaman aşımı) yeniden başlatır', async () => {
    spawner.procs[0].freeze();
    await vi.waitFor(() => expect(spawner.procs).toHaveLength(2), { timeout: 2000 });
    expect(spawner.procs[0].killed).toBe(true);
    await vi.waitFor(() => expect(core.sources.list()[0].hostState).toBe('restarted'));
    expect(await run('oynak/selam')).toMatchObject({ status: 'ok' });
  });

  it('art arda 3 çökmede eklenti kapanır ve görünür; "Yeniden dene" ile döner', async () => {
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(spawner.procs).toHaveLength(i + 1));
      await vi.waitFor(() => expect(core.sources.list()[0].hostState ?? 'ready').not.toBe('restarting'));
      spawner.procs[i].crash();
    }
    await vi.waitFor(() => expect(core.sources.list()[0].hostState).toBe('disabled'));
    const plugin = core.sources.list()[0];
    expect(plugin.startError).toContain('art arda çöktüğü için kapatıldı');
    expect(plugin.jobs).toEqual([]);
    expect(core.commands.list().some((c) => c.plugin === 'oynak')).toBe(false);

    await core.sources.restartPlugin('oynak');
    expect(core.sources.list()[0].startError).toBeNull();
    expect(core.sources.list()[0].jobs).toHaveLength(2);
    expect(await run('oynak/selam')).toMatchObject({ status: 'ok' });
  });

  it('sınırlar main\'de: 1 MB üstü durum yazılmaz, 10 MB üstü fetch yanıtı reddedilir', async () => {
    // Eklenti kendi kopyasında görür ama main kalıcı yazmaz (sınır aşımı loglanır)
    expect(await run('oynak/buyukDurum')).toMatchObject({ status: 'ok' });
    await wait(30);
    expect(logger.warn.mock.calls.flat().join(' ')).toContain('state 1 MB');
    const big = await run('oynak/buyukFetch');
    expect(big.status).toBe('error');
    expect(big.error).toContain('fetch 10 MB');
  });

  it('döngü önleme süreçler arasında da çalışır (causedBy kimliği RPC ile taşınır)', async () => {
    core.automation.save({
      name: 'Gelince kontrol et',
      trigger: { type: 'notification' },
      conditions: [{ field: 'source', op: 'eq', value: 'oynak' }],
      actions: [{ command: 'oynak/selam' }, { command: 'pano/runAll' }]
    });
    // akis (dış tetik) → kural → runAll akis2'yi çalıştırır; akis2'nin bildirimi eklenti sürecinden
    // causedBy ile gelir ve kuralı yeniden tetiklemez. Kimlik taşınmasaydı runAll akis'i de çalıştırıp
    // döngü kurardı (hız sınırına kadar).
    await core.sources.runNow('oynak/akis');
    await wait(300);
    const runs = core.commands.history().filter((e) => e.command === 'pano/runAll');
    expect(runs).toHaveLength(1);
    // Dış tetik + runAll'un çalıştırdığı iki kaynak (RPC'de akis o an bitmiş olduğu için o da çalışır);
    // ikisinin bildirimi de zinciri taşır, kural bir daha tetiklenmez
    expect(core.notifications.list().filter((n) => n.source === 'oynak')).toHaveLength(3);
    expect(core.automation.list()[0].enabled).toBe(true);
  });
});

// İzinler süreçler arasında da geçerli: denetim main'deki gerçek ctx'te
const NARROW = `
export default {
  commands: {
    izinsizAg: { title: 'A', async run(ctx) { await ctx.fetch('https://evil.example.org/'); return {}; } },
    izinliAg: { title: 'B', async run(ctx) { const r = await ctx.fetch('https://api.example.com/'); return { message: String(r.status) }; } },
    dosya: { title: 'C', async run(ctx) { await ctx.files.write('not.txt', 'merhaba'); return { message: await ctx.files.read('not.txt') }; } },
    disari: { title: 'D', async run(ctx) { await ctx.files.write('../kacis.txt', 'x'); return {}; } },
    bildirim: { title: 'E', async run(ctx) { ctx.notify({ id: 'x', title: 'izinsiz' }); return {}; } }
  }
};`;

describe('sandbox: izinler RPC üzerinden', () => {
  let dir, core;
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('tamam', { status: 200 })));
    dir = tempDir('pano-sandbox-perm-');
    writePlugin(dir, 'dar', { name: 'dar', permissions: { network: { hosts: ['api.example.com'] }, filesystem: true } }, NARROW);
    core = createCore({
      resolveHost: publicResolve, pluginDirs: [dir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:'),
      pluginDataDir: path.join(dir, '..', path.basename(dir) + '-data'),
      hostFactory: createRemoteHostFactory({ spawn: channelSpawner().spawn })
    });
    await core.start();
  });
  afterEach(async () => {
    await core.stop({ drainMs: 50 });
    removeDir(dir);
    removeDir(path.join(dir, '..', path.basename(dir) + '-data'));
    vi.unstubAllGlobals();
  });
  const run = (id) => new Promise((resolve) => {
    const runId = core.commands.run(id);
    core.bus.on('command:finished', (i) => i.runId === runId && resolve(i));
  });

  it('izinsiz alan adı, klasör dışı yol ve izinsiz bildirim reddedilir; izinliler çalışır', async () => {
    expect((await run('dar/izinsizAg')).errorI18n).toMatchObject({ key: 'core.permissions.network.hostNotAllowed', params: { host: 'evil.example.org' } });
    expect(await run('dar/izinliAg')).toMatchObject({ status: 'ok', message: '200' });
    expect(await run('dar/dosya')).toMatchObject({ status: 'ok', message: 'merhaba' });
    expect((await run('dar/disari')).errorI18n).toMatchObject({ key: 'core.permissions.files.badPath' });
    expect((await run('dar/bildirim')).errorI18n).toMatchObject({ key: 'core.permissions.denied' });
    expect(core.notifications.list()).toEqual([]);
  });
});
