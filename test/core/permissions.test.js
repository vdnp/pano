import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addedPermissions, describePermissions, hostMatches, hostsFromSettings, networkAllows, normalizePermissions, permissionsKey
} from '../../core/permissions.js';
import { createGuardedFetch } from '../../core/net-guard.js';
import { createPluginFiles } from '../../core/plugin-files.js';
import { createContext } from '../../core/context.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSecrets, plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { createCore } from '../../core/index.js';
import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';
import { publicResolve, removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

const i18n = createI18n({ locale: 'tr', catalogs: mergeCatalogs(appCatalogs) });
const error = (k, p) => i18n.error(k, p);
const perms = (raw) => normalizePermissions(raw).permissions;

describe('izin modeli', () => {
  it('nesne biçimini temizler; eski dizi biçimini ve network kısayolunu çevirir', () => {
    expect(normalizePermissions({ network: { hosts: ['API.github.com', 'api.github.com', '*.steampowered.com'] }, notifications: true }))
      .toEqual({ permissions: { network: { hosts: ['*.steampowered.com', 'api.github.com'], fromSettings: [] }, notifications: true, openExternal: false, runCommand: false, filesystem: false }, warnings: [] });
    expect(perms(['openExternal', 'runCommand'])).toMatchObject({ openExternal: true, runCommand: true, notifications: false, network: null });
    expect(perms({ network: ['a.com'] }).network).toEqual({ hosts: ['a.com'], fromSettings: [] });
    expect(perms(null)).toMatchObject({ network: null, notifications: false });
  });

  it('bilinmeyen izin, geçersiz alan adı ve ayar yolu uyarıyla atılır', () => {
    const { permissions, warnings } = normalizePermissions({ uydurma: true, network: { hosts: ['http://a.com', 'a..b', '*', 'ok.com'], fromSettings: ['feeds.url', 'a.b.c', '../x'] } });
    expect(permissions.network).toEqual({ hosts: ['*', 'ok.com'], fromSettings: ['feeds.url'] });
    expect(warnings).toHaveLength(5);
  });

  it('değişiklik anahtarı sıra ve yazımdan bağımsız; eklenen izinler ayrılır', () => {
    const a = perms({ network: { hosts: ['b.com', 'a.com'] }, notifications: true });
    const b = perms({ notifications: true, network: { hosts: ['A.com', 'b.com'] } });
    expect(permissionsKey(a)).toBe(permissionsKey(b));
    const c = perms({ notifications: true, network: { hosts: ['a.com', 'b.com', 'c.com'] }, filesystem: true });
    expect(addedPermissions(c, a)).toEqual([{ kind: 'network', host: 'c.com' }, { kind: 'filesystem' }]);
    expect(addedPermissions(a, null)).toEqual(describePermissions(a));
  });

  it('alan adı eşleşmesi: tam, *. (alt alanlar ve kendisi), *', () => {
    expect(hostMatches('api.github.com', 'API.github.com')).toBe(true);
    expect(hostMatches('api.github.com', 'evil-api.github.com')).toBe(false);
    expect(hostMatches('*.steampowered.com', 'store.steampowered.com')).toBe(true);
    expect(hostMatches('*.steampowered.com', 'steampowered.com')).toBe(true);
    expect(hostMatches('*.steampowered.com', 'steampowered.com.evil.io')).toBe(false);
    expect(hostMatches('*.steampowered.com', 'evilsteampowered.com')).toBe(false);
    expect(hostMatches('*', 'herhangi.bir.yer')).toBe(true);
  });

  it('ayardan gelen adresler; sabit alan adlarında yalnızca https, kullanıcının http yazdığı adreste http', () => {
    const p = perms({ network: { hosts: ['api.github.com'], fromSettings: ['feeds.url', 'site'] } });
    const settings = { feeds: [{ url: 'http://eski.example.com/rss' }, { url: 'https://yeni.example.com/feed' }, { url: 'ftp://x' }], site: 'https://tek.example.com' };
    expect(hostsFromSettings(settings, p.network.fromSettings).map((h) => h.host)).toEqual(['eski.example.com', 'yeni.example.com', 'tek.example.com']);
    const allows = (u) => networkAllows(p, settings, new URL(u));
    expect(allows('https://api.github.com/notifications')).toEqual({ ok: true });
    expect(allows('http://api.github.com/x')).toEqual({ ok: false, reason: 'scheme' });
    expect(allows('http://eski.example.com/rss')).toEqual({ ok: true });
    expect(allows('https://eski.example.com/rss')).toEqual({ ok: true });
    expect(allows('http://yeni.example.com/feed')).toEqual({ ok: false, reason: 'host' });
    expect(allows('https://baska.example.com/')).toEqual({ ok: false, reason: 'host' });
    expect(allows('file:///etc/passwd')).toEqual({ ok: false, reason: 'scheme' });
  });
});

describe('korumalı fetch', () => {
  const ok = () => new Response('tamam', { status: 200 });
  const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
  const make = (raw, fetchImpl, { settings = {}, resolveHost = publicResolve } = {}) =>
    createGuardedFetch({ pluginName: 'deneme', getPermissions: () => perms(raw), getSettings: () => settings, error, fetchImpl, resolveHost });

  it('izinli alan adına gider; izinsiz ve beyan edilmemişte anlaşılır hata', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const f = make({ network: { hosts: ['api.github.com'] } }, fetchImpl);
    expect((await f('https://api.github.com/x')).status).toBe(200);
    await expect(f('https://evil.com/')).rejects.toThrow('deneme eklentisi evil.com adresine bağlanma izni istememiş.');
    await expect(make({}, fetchImpl)('https://api.github.com/')).rejects.toThrow('internet erişimi izni istememiş');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('yönlendirmenin her adımı denetlenir: izinsiz yere yönlendirme engellenir', async () => {
    const fetchImpl = vi.fn(async (url) =>
      url.startsWith('https://api.github.com/a') ? redirect('https://api.github.com/b') : url.startsWith('https://api.github.com/b') ? redirect('https://evil.com/steal') : ok());
    const f = make({ network: { hosts: ['api.github.com'] } }, fetchImpl);
    await expect(f('https://api.github.com/a')).rejects.toThrow('evil.com adresine bağlanma izni istememiş');
    expect(fetchImpl.mock.calls.map(([u]) => u)).toEqual(['https://api.github.com/a', 'https://api.github.com/b']);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
  });

  it('izinli yönlendirme izlenir; 303 GET olur; çok fazla yönlendirme durdurulur', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push([url, init.method ?? 'GET', init.body]);
      return url.endsWith('/post') ? redirect('/sonuc', 303) : ok();
    });
    const f = make({ network: { hosts: ['*.example.com'] } }, fetchImpl);
    await f('https://api.example.com/post', { method: 'POST', body: 'x' });
    expect(calls).toEqual([['https://api.example.com/post', 'POST', 'x'], ['https://api.example.com/sonuc', 'GET', undefined]]);
    const loop = make({ network: { hosts: ['*'] } }, async (url) => redirect(url + 'x'));
    await expect(loop('https://a.example.com/')).rejects.toThrow('çok fazla yönlendirme');
  });

  it('yerel ağ hiçbir izinle açılmaz: IP olarak ya da yerel IP\'ye çözülen alan adıyla', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const any = make({ network: { hosts: ['*'] } }, fetchImpl);
    for (const url of ['https://127.0.0.1/', 'https://192.168.1.10/', 'https://10.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://2130706433/']) {
      await expect(any(url)).rejects.toThrow('yerel ağdaki bir adres');
    }
    const rebind = make({ network: { hosts: ['*'] } }, fetchImpl, { resolveHost: async () => ['93.184.216.34', '10.0.0.5'] });
    await expect(rebind('https://kotu.example.com/')).rejects.toThrow('kotu.example.com yerel ağdaki bir adres');
    // İzinli siteden yerel ağa yönlendirme de
    const viaRedirect = make({ network: { hosts: ['*'] } }, async () => redirect('https://192.168.1.1/admin'));
    await expect(viaRedirect('https://a.example.com/')).rejects.toThrow('yerel ağdaki bir adres');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('eklenti dosya alanı', () => {
  let dir;
  afterEach(() => dir && removeDir(dir));

  it('yaz, oku, listele, sil; olmayan dosya null', async () => {
    dir = tempDir('pano-files-');
    const files = createPluginFiles({ dir: path.join(dir, 'eklenti'), error });
    expect(await files.read('yok.txt')).toBeNull();
    expect(await files.list()).toEqual([]);
    await files.write('notlar/a.json', '{"x":1}');
    await files.write('b.txt', 'merhaba');
    expect(await files.read('notlar/a.json')).toBe('{"x":1}');
    expect(await files.list()).toEqual(['b.txt', 'notlar/']);
    expect(await files.list('notlar')).toEqual(['a.json']);
    await files.remove('notlar');
    expect(await files.list()).toEqual(['b.txt']);
  });

  it('klasör dışına çıkılamaz', async () => {
    dir = tempDir('pano-files-');
    const files = createPluginFiles({ dir: path.join(dir, 'eklenti'), error });
    for (const bad of ['../disari.txt', 'a/../../b', '/etc/passwd', 'C:\\Windows\\x', 'a\\b', '', '.', 'x'.repeat(300)]) {
      await expect(files.write(bad, 'x')).rejects.toThrow('Geçersiz dosya yolu');
    }
    expect(fs.existsSync(path.join(dir, 'disari.txt'))).toBe(false);
  });

  it('kota: toplam boyut ve dosya sayısı', async () => {
    dir = tempDir('pano-files-');
    const files = createPluginFiles({ dir: path.join(dir, 'eklenti'), error, limits: { totalBytes: 10, files: 2, pathLength: 200 } });
    await files.write('a', '12345');
    await files.write('a', '1234567890'); // aynı dosyanın üzerine yazmak kotayı iki kez saymaz
    await expect(files.write('b', 'x')).rejects.toThrow('veri klasörü dolu');
    await files.write('a', '1');
    await files.write('b', '1');
    await expect(files.write('c', '1')).rejects.toThrow('veri klasörü dolu');
  });
});

describe('ctx izin denetimleri', () => {
  const ctxWith = (permissions, extra = {}) => {
    const storage = createSqliteStorage(':memory:');
    return createContext('deneme', {
      notifications: createNotificationStore(storage, new EventEmitter()), store: storage.kv, secrets: createSecrets(storage.kv),
      logger: silentLogger(), getSettings: () => ({}), getI18n: () => i18n, permissions, resolveHost: publicResolve, ...extra
    });
  };

  it('izinsiz notify, fetch ve files anlaşılır hata verir', async () => {
    const ctx = ctxWith({});
    expect(() => ctx.notify({ id: '1', title: 'x' })).toThrow('deneme eklentisi "Bildirim gösterme" iznini');
    await expect(ctx.fetch('https://a.com')).rejects.toThrow('internet erişimi izni istememiş');
    await expect(ctx.files.write('a', 'x')).rejects.toThrow('"Kendi veri klasörüne dosya yazma" iznini');
  });

  it('izinliyse çalışır', async () => {
    const dir = tempDir('pano-ctxfiles-');
    const ctx = ctxWith({ notifications: true, filesystem: true }, { filesDir: path.join(dir, 'deneme') });
    expect(ctx.notify({ id: '1', title: 'x' })).toBe(true);
    await ctx.files.write('a.txt', 'merhaba');
    expect(await ctx.files.read('a.txt')).toBe('merhaba');
    removeDir(dir);
  });
});

// Kullanıcı klasöründeki eklenti onaysız çalışmaz; yerleşik (güvenilir) klasördeki onaysız başlar
const USER_PLUGIN = `
globalThis.__consent.loaded++;
export default {
  async setup() { globalThis.__consent.setup++; },
  commands: { selam: { title: 'Selam', async run() { return { message: 'merhaba' }; } } }
};`;

describe('kurulumda izin onayı', () => {
  let builtin, user, storage, core;
  const boot = async () => {
    core = createCore({
      resolveHost: publicResolve, pluginDirs: [builtin, user], trustedPluginDirs: [builtin],
      cipher: plainCipher, logger: silentLogger(), storage, pluginDataDir: path.join(user, '..', 'data')
    });
    await core.start();
  };
  const find = (name) => core.sources.list().find((s) => s.name === name);

  afterEach(async () => {
    await core?.stop({ drainMs: 10 });
    removeDir(path.dirname(builtin));
    delete globalThis.__consent;
  });

  async function setup(userPermissions = { network: { hosts: ['api.example.com'] }, notifications: true }) {
    globalThis.__consent = { loaded: 0, setup: 0 };
    const root = tempDir('pano-consent-');
    builtin = path.join(root, 'builtin');
    user = path.join(root, 'user');
    fs.mkdirSync(builtin);
    fs.mkdirSync(user);
    writePlugin(builtin, 'yerlesik', { name: 'yerlesik', permissions: { notifications: true } }, "export default { commands: { x: { title: 'X', async run() { return {}; } } } };");
    writePlugin(user, 'disaridan', { name: 'disaridan', version: '1.0.0', permissions: userPermissions }, USER_PLUGIN);
    storage = { inner: null };
    storage = createSqliteStorage(path.join(root, 'pano.db'));
  }

  it('yeni kullanıcı eklentisi onay bekler, kodu hiç yüklenmez; yerleşik onaysız başlar', async () => {
    await setup();
    await boot();
    expect(find('yerlesik')).toMatchObject({ trusted: true, consent: null });
    expect(find('disaridan')).toMatchObject({
      trusted: false,
      consent: { status: 'new', added: [{ kind: 'network', host: 'api.example.com' }, { kind: 'notifications' }] }
    });
    expect(globalThis.__consent).toEqual({ loaded: 0, setup: 0 });
    expect(core.commands.list().some((c) => c.plugin === 'disaridan')).toBe(false);
  });

  it('onay verilince başlar; sonraki açılışta yeniden sorulmaz', async () => {
    await setup();
    await boot();
    await core.sources.approvePlugin('disaridan');
    expect(find('disaridan').consent).toBeNull();
    expect(globalThis.__consent.setup).toBe(1);
    expect(core.commands.list().some((c) => c.id === 'disaridan/selam')).toBe(true);
    await core.stop({ drainMs: 10 });
    storage = createSqliteStorage(path.join(path.dirname(builtin), 'pano.db'));
    await boot();
    expect(find('disaridan').consent).toBeNull();
  });

  it('izinler değişince yeniden sorar ve yalnızca yeni istenenleri işaretler', async () => {
    await setup();
    await boot();
    await core.sources.approvePlugin('disaridan');
    await core.stop({ drainMs: 10 });
    writePlugin(user, 'disaridan', { name: 'disaridan', version: '1.1.0', permissions: { network: { hosts: ['api.example.com', 'cdn.example.com'] }, notifications: true, filesystem: true } }, USER_PLUGIN);
    storage = createSqliteStorage(path.join(path.dirname(builtin), 'pano.db'));
    await boot();
    expect(find('disaridan').consent).toEqual({ status: 'changed', added: [{ kind: 'network', host: 'cdn.example.com' }, { kind: 'filesystem' }] });
    expect(core.commands.list().some((c) => c.plugin === 'disaridan')).toBe(false);
  });

  it('onay geri alınınca eklenti durur ve yeniden onay ister; yerleşik eklentide geri alınamaz', async () => {
    await setup();
    await boot();
    await core.sources.approvePlugin('disaridan');
    await core.sources.revokePlugin('disaridan');
    expect(find('disaridan').consent).toMatchObject({ status: 'new' });
    expect(core.commands.list().some((c) => c.plugin === 'disaridan')).toBe(false);
    await expect(core.sources.revokePlugin('yerlesik')).rejects.toThrow('Uygulamayla gelen eklentinin izinleri geri alınamaz.');
  });
});
