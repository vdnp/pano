import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createInProcessHost, rehydrateError, serializeError } from '../../core/plugin-host.js';
import { createContext } from '../../core/context.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSecrets } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import github from '../../plugins/github/index.js';
import rss from '../../plugins/rss/index.js';
import steam from '../../plugins/steam/index.js';
import demo from '../../plugins/ornek-kart/index.js';
import { TEST_PERMISSIONS, pluginI18n, publicResolve, removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

// Gerçek eklenti modülü + gerçek ctx ile süreç içi host
function hostFor(name, module, settings = {}) {
  const storage = createSqliteStorage(':memory:');
  const i18n = pluginI18n(name);
  const ctx = createContext(name, { permissions: TEST_PERMISSIONS, resolveHost: publicResolve,
    notifications: createNotificationStore(storage, new EventEmitter()),
    store: storage.kv,
    secrets: createSecrets(storage.kv),
    logger: silentLogger(),
    getSettings: () => settings,
    getI18n: () => i18n
  });
  return createInProcessHost({ name, module, ctx, logger: silentLogger() });
}

// Sınırdan geçen değer düz veri olmalı: JSON'a gidip gelince aynı kalır, fonksiyon yok
const roundTrips = (value) => expect(JSON.parse(JSON.stringify(value))).toEqual(value);

describe('eklenti sınırı (süreç içi host)', () => {
  it('gerçek eklentilerin inspect ve describe çıktısı düz veridir', async () => {
    const cases = [
      ['github', github, {}],
      ['rss', rss, { feeds: [{ url: 'https://example.com/feed.xml', name: 'Örnek' }] }],
      ['steam', steam, {
        games: [{ appId: 730, name: 'Counter-Strike 2' }], steamId: '76561197960435530',
        achievementGames: [{ appId: 413150, name: 'Stardew Valley' }], friendsOnline: true,
        friends: [{ steamId: '76561197960265731', name: 'Ayşe' }], friendsInterval: 5
      }],
      ['ornek-kart', demo, { showError: true }]
    ];
    for (const [name, module, settings] of cases) {
      const host = hostFor(name, module, settings);
      const info = await host.inspect();
      const desc = await host.describe(settings);
      roundTrips(info);
      roundTrips(desc);
      expect(JSON.stringify(desc)).not.toMatch(/function|=>/);
    }
    const steamDesc = await hostFor('steam', steam).describe({ games: [{ appId: 730, name: 'CS2' }], steamId: '7656119' + '7960435530' });
    expect(Object.keys(steamDesc.sources)).toEqual(['news-730']);
    expect(steamDesc.widgets.profile).toMatchObject({ view: 'profile', provider: 'profile', hasMap: true, size: 'normal' });
    expect(steamDesc.commands.launchGame.params.appId).toMatchObject({ type: 'number', required: true, suggest: { provider: 'searchGames' } });
    const githubDesc = await hostFor('github', github).describe({});
    expect(githubDesc.commands.markThreadRead.notificationAction).toEqual({ label: 'commands.markThreadRead.short', markRead: true, hasParams: true });
  });

  it('invoke: eklenti fonksiyonunu çağırır; sunulmayan çağrı NOT_PROVIDED', async () => {
    const host = hostFor('github', github);
    await host.describe({});
    const params = await host.invoke('notificationAction.params', 'markThreadRead', { notification: { meta: { threadId: 42 } } });
    expect(params).toEqual({ threadId: '42' });
    await expect(host.invoke('suggest', 'yok', { query: 'ab' })).rejects.toMatchObject({ code: 'NOT_PROVIDED' });
    await expect(host.invoke('suggest', 'constructor', { query: 'ab' })).rejects.toMatchObject({ code: 'NOT_PROVIDED' });
    await expect(host.invoke('bilinmeyen')).rejects.toMatchObject({ code: 'NOT_PROVIDED' });
  });

  it('hatalar sınırı düz veri olarak geçer: mesaj, çeviri anahtarı (iç içe), kod ve satır korunur', async () => {
    const err = Object.assign(new Error('XML bozuk'), { code: 'XML_INVALID', line: 3, i18n: { key: 'rss:errors.parse', params: { reason: { key: 'core.xml.invalid', params: { line: 3 } } } }, secret: 'atılır' });
    const data = serializeError(err);
    roundTrips(data);
    expect(data).toEqual({ name: 'Error', message: 'XML bozuk', code: 'XML_INVALID', line: 3, i18n: err.i18n });
    const back = rehydrateError(data);
    expect(back).toBeInstanceOf(Error);
    expect(back).toMatchObject({ message: 'XML bozuk', code: 'XML_INVALID', line: 3, i18n: err.i18n });
    expect(back.secret).toBeUndefined();
    expect(serializeError('düz metin')).toEqual({ name: 'Error', message: 'düz metin' });

    // Gerçek eklentinin fırlattığı çevrilebilir hata invoke'tan aynı anahtarla çıkar
    const host = hostFor('steam', steam);
    await host.describe({});
    await expect(host.invoke('provider.get', 'profile', { params: {} })).rejects.toMatchObject({ i18n: { key: 'steam:errors.steamIdMissing' } });
  });
});

// Çekirdek açıklamaları önbelleğe alır: listeler eklenti kodunu çağırmaz; setup bitmeden ve
// başlatılamayan eklentide hiçbir katkı çağrılmaz; dil değişince başlıklar yenilenir
const COUNTING = `
export default {
  async setup() { await new Promise((r) => setTimeout(r, 20)); globalThis.__hostTest.ready = true; },
  sources(settings, ctx) {
    globalThis.__hostTest.calls.push('sources:' + globalThis.__hostTest.ready);
    return { haber: { title: ctx.t('title'), async run() {} } };
  },
  widgets(settings, ctx) {
    globalThis.__hostTest.calls.push('widgets:' + globalThis.__hostTest.ready);
    return { kart: { title: ctx.t('title'), view: 'stat', provider: 'p', map: (d) => ({ items: [{ label: 'x', value: d.n }] }) } };
  },
  providers: { p: { ttl: 60, async get() { return { n: 1 }; } } },
  commands: { selam: { title: 'Selam', async run() { return { message: 'merhaba' }; } } }
};`;
const BROKEN = `
export default {
  async setup() { throw new Error('kurulamadı'); },
  widgets() { globalThis.__hostTest.calls.push('broken-widgets'); return { k: { title: 'K', view: 'stat', provider: 'p' } }; },
  commands: { x: { title: 'X', async run() {} } }
};`;

describe('çekirdek: önbelleğe alınmış açıklamalar', () => {
  let dir, core;
  afterEach(async () => {
    await core?.stop();
    removeDir(dir);
    delete globalThis.__hostTest;
  });

  async function boot() {
    globalThis.__hostTest = { ready: false, calls: [] };
    dir = tempDir('pano-host-');
    const root = writePlugin(dir, 'sayac', { name: 'sayac' }, COUNTING);
    fs.mkdirSync(path.join(root, 'locales'));
    fs.writeFileSync(path.join(root, 'locales', 'tr.json'), JSON.stringify({ title: 'Başlık' }));
    fs.writeFileSync(path.join(root, 'locales', 'en.json'), JSON.stringify({ title: 'Title' }));
    writePlugin(dir, 'bozuk', { name: 'bozuk' }, BROKEN);
    core = createCore({ resolveHost: publicResolve, pluginDirs: [dir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:') });
    await core.start();
  }

  it('setup bitmeden katkı okunmaz; listeler eklenti kodunu tekrar çağırmaz', async () => {
    await boot();
    expect(globalThis.__hostTest.calls).toEqual(['sources:true', 'widgets:true']);
    for (let i = 0; i < 5; i++) {
      core.widgets.list();
      core.dashboard.get();
      core.commands.list();
    }
    await core.widgets.data('sayac/kart');
    expect(globalThis.__hostTest.calls).toEqual(['sources:true', 'widgets:true']);
    // Ayar kaydı açıklamayı bir kez yeniler
    await core.sources.updateSettings('sayac', {});
    expect(globalThis.__hostTest.calls).toHaveLength(4);
  });

  it('başlatılamayan eklentinin hiçbir katkısı çağrılmaz ve listelenmez', async () => {
    await boot();
    expect(globalThis.__hostTest.calls).not.toContain('broken-widgets');
    expect(core.widgets.list().map((w) => w.id)).toEqual(['sayac/kart']);
    expect(core.commands.list().some((c) => c.plugin === 'bozuk')).toBe(false);
    const broken = core.sources.list().find((s) => s.name === 'bozuk');
    expect(broken.startError).toContain('kurulamadı');
    // Beyan edilen katkı türleri görünür (arayüzün kurulum ekranı buna bakar), çağrılmazlar
    expect(broken.kinds).toEqual({ sources: false, widgets: true, commands: true });
  });

  it('dil değişince kaynak ve kart başlıkları yeni dilde', async () => {
    await boot();
    const titles = () => [core.sources.list().find((s) => s.name === 'sayac').jobs[0].title, core.widgets.list()[0].title];
    expect(titles()).toEqual(['Başlık', 'Başlık']);
    await core.setLocale('en');
    expect(titles()).toEqual(['Title', 'Title']);
  });

  it('kart verisi ve komut host üzerinden çalışır', async () => {
    await boot();
    expect((await core.widgets.data('sayac/kart')).data.items).toEqual([{ label: 'x', value: 1, hint: '' }]);
    const done = new Promise((resolve) => core.bus.on('command:finished', resolve));
    core.commands.run('sayac/selam');
    expect(await done).toMatchObject({ status: 'ok', message: 'merhaba' });
  });
});
