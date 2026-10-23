import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import steam from '../../plugins/steam/index.js';
import { cleanText, excerpt, newsContent, newsType, toNotification } from '../../plugins/steam/news.js';
import { searchGames } from '../../plugins/steam/store-search.js';
import { createContext } from '../../core/context.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSecrets } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { TEST_PERMISSIONS, pluginI18n, publicResolve, silentLogger } from '../helpers.js';

const NEWS = JSON.parse(fs.readFileSync(new URL('../fixtures/steam-news.json', import.meta.url), 'utf8'));
const GAME = { appId: 730, name: 'Counter-Strike 2' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Haber listesinden yalnızca verilen gid'leri içeren yanıt
const newsWith = (gids) => ({
  appnews: { ...NEWS.appnews, newsitems: NEWS.appnews.newsitems.filter((n) => gids.includes(n.gid)) }
});

// Eklentinin gerçek kataloglarıyla ctx parçaları (dönüşüm ve arama testleri için)
const i18nCtx = (locale = 'tr') => {
  const i18n = pluginI18n('steam', locale);
  return { t: (k, p) => i18n.t(`steam:${k}`, p), key: (k) => `steam:${k}`, error: (k, p) => i18n.error(`steam:${k}`, p) };
};

function setup(settings = {}, locale = 'tr') {
  const i18n = pluginI18n('steam', locale);
  const storage = createSqliteStorage(':memory:');
  const notifications = createNotificationStore(storage, new EventEmitter());
  const current = { officialOnly: false, patchNotesOnly: false, ...settings };
  const ctx = createContext('steam', { permissions: TEST_PERMISSIONS, resolveHost: publicResolve,
    notifications,
    store: storage.kv,
    secrets: createSecrets(storage.kv),
    logger: silentLogger(),
    getSettings: () => current,
    getI18n: () => i18n
  });
  ctx.fetch = vi.fn();
  const source = steam.sources({ games: [GAME] }, ctx)['news-730'];
  return { ctx, notifications, settings: current, run: () => source.run(ctx) };
}

describe('steam: metin temizleme', () => {
  it('BBCode etiketlerini atar, kaçışlı köşeli parantezleri korur', () => {
    expect(cleanText(NEWS.appnews.newsitems[0].contents)).toBe(
      '[ UI ] Demo/Replay viewer improvements: Added a progress bar for demo/replay downloads ' +
      'Camera controls now use click-and-drag scheme [ MISC ] Updated AUG reload animation'
    );
  });

  it('görsel, video ve yer tutucuları atar; bağlantı metnini bırakır', () => {
    expect(cleanText(NEWS.appnews.newsitems[2].contents)).toBe(
      'Some time ago, we began to set our minds on matters of the monstrous. Read more on the event page.'
    );
    expect(cleanText('<p>Bir <a href="x">bağlantı</a>, <strong>kalın</strong>.</p><p>İkinci</p>')).toBe('Bir bağlantı, kalın. İkinci');
  });

  it('HTML etiketlerini ve betikleri atar, varlıkları çözer', () => {
    expect(cleanText(NEWS.appnews.newsitems[1].contents)).toBe("Valve & CS2: AUG artık daha hızlı 'şarjör' değiştiriyor.");
    expect(cleanText('&lt;b&gt; &#x1F3AE; &nbsp;bitti &bilinmeyen;')).toBe('<b> 🎮 bitti &bilinmeyen;');
    expect(cleanText(null)).toBe('');
  });

  it('özeti 200 karakterde kelime sınırında keser', () => {
    const long = 'kelime '.repeat(60).trim();
    const result = excerpt(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('kelime…')).toBe(true);
    expect(excerpt('kısa metin')).toBe('kısa metin');
  });
});

describe('steam: haber türü', () => {
  it.each([
    [{ title: 'Counter-Strike 2 Update', tags: ['patchnotes'] }, 'patchNotes'],
    [{ title: 'PATCH NOTES: Y11S3 MID-SEASON UPDATE' }, 'patchNotes'],
    [{ title: 'Y11S3.1 Patchnotes' }, 'patchNotes'],
    [{ title: 'Hotfix for the Mid-Season update' }, 'hotfix'],
    [{ title: 'Hot-fix 1.2' }, 'hotfix'],
    [{ title: 'Hot fix 1.2' }, 'hotfix'],
    [{ title: 'Spring Update is live' }, 'update'],
    [{ title: 'Updated roadmap' }, 'announcement'],
    [{ title: "Doktor's Curse Is Back" }, 'announcement']
  ])('%j → %s', (item, type) => {
    expect(newsType(item)).toBe(type);
  });

  it('yeni türler etiket anahtarı olarak kaydedilir', () => {
    expect(toNotification({ gid: '1', title: 'Hotfix 2', date: 1 }, GAME, i18nCtx()).tags).toEqual(['steam:tag.hotfix']);
    expect(toNotification({ gid: '2', title: 'Big update', date: 1 }, GAME, i18nCtx()).tags).toEqual(['steam:tag.update']);
  });
});

describe('steam: bildirime dönüşüm', () => {
  it('yama notunu ortak şemaya çevirir', () => {
    expect(toNotification(NEWS.appnews.newsitems[0], GAME, i18nCtx())).toEqual({
      id: '1846651706675829',
      title: 'Counter-Strike 2 Update',
      body: 'Counter-Strike 2',
      url: 'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1846651706675829',
      tags: ['steam:tag.patchNotes'],
      createdAt: 1792018968000,
      meta: {
        appId: 730,
        author: 'Valve',
        feedLabel: 'Community Announcements',
        excerpt: '[ UI ] Demo/Replay viewer improvements: Added a progress bar for demo/replay downloads Camera controls now use click-and-drag scheme [ MISC ] Updated AUG reload animation'
      },
      content: { format: 'bbcode', body: NEWS.appnews.newsitems[0].contents }
    });
  });

  it('basın haberlerinin (feed_type 0) içeriği HTML olarak saklanır', () => {
    expect(toNotification(NEWS.appnews.newsitems[1], GAME, i18nCtx()).content.format).toBe('html');
  });

  it('etiketsiz haber Duyuru olur; ad yoksa uygulama numarası kullanılır', () => {
    const n = toNotification(NEWS.appnews.newsitems[4], { appId: 730, name: '' }, i18nCtx());
    expect(n.tags).toEqual(['steam:tag.announcement']);
    expect(n.body).toBe('Steam uygulaması 730');
  });
});

describe('steam: haber kaynağı', () => {
  it('isteği belgelenen parametrelerle yapar', async () => {
    const { ctx, run } = setup({ officialOnly: true });
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    const url = new URL(ctx.fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: '730', count: '10', maxlength: '0', feeds: 'steam_community_announcements'
    });
  });

  it('resmî duyuru filtresi kapalıyken feeds göndermez', async () => {
    const { ctx, run } = setup();
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    expect(new URL(ctx.fetch.mock.calls[0][0]).searchParams.has('feeds')).toBe(false);
  });

  it('ilk çalıştırmada yalnızca en yeni 3 haberi bildirir', async () => {
    const { ctx, notifications, run } = setup();
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    expect(notifications.list().map((n) => n.id)).toEqual([
      'steam:1846651706675829', 'steam:1846018067932423', 'steam:1846018067924633'
    ]);
    expect(notifications.list()[0].meta.excerpt).toMatch(/^\[ UI \] Demo/);
  });

  it('sonraki çalıştırmada yalnızca yeni haberi bildirir', async () => {
    const { ctx, notifications, run } = setup();
    ctx.fetch.mockResolvedValueOnce(json(newsWith(['1846018067924633', '1845383656394875', '1844751498218029'])));
    await run();
    expect(notifications.list()).toHaveLength(3);

    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    expect(notifications.list()).toHaveLength(5);

    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    expect(notifications.list()).toHaveLength(5);
  });

  it('yama notu filtresi açıkken yalnızca patchnotes etiketlileri bildirir', async () => {
    const { ctx, notifications, run } = setup({ patchNotesOnly: true });
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    expect(notifications.list().map((n) => n.id)).toEqual(['steam:1846651706675829', 'steam:1845383656394875']);
    expect(notifications.list().every((n) => n.tags[0] === 'steam:tag.patchNotes')).toBe(true);
  });

  it('yama notu filtresi sonradan kapatılınca eski duyurular yağmaz', async () => {
    const { ctx, notifications, settings, run } = setup({ patchNotesOnly: true });
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();

    settings.patchNotesOnly = false;
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    expect(notifications.list()).toHaveLength(2);
  });

  it('resmî duyuru filtresi değişince ilk çalıştırma sınırı yeniden uygulanır', async () => {
    const { ctx, notifications, settings, run } = setup();
    ctx.fetch.mockResolvedValueOnce(json(newsWith(['1846018067932423'])));
    await run();

    settings.officialOnly = true;
    ctx.fetch.mockResolvedValueOnce(json(NEWS));
    await run();
    // 1 eski + yeni sorgunun ilk çalıştırmasında en fazla 3 (biri zaten vardı)
    expect(notifications.list()).toHaveLength(3);
  });

  describe('hata durumları', () => {
    const failsWith = async (response, message) => {
      const { ctx, run } = setup();
      if (response instanceof Error) ctx.fetch.mockRejectedValueOnce(response);
      else ctx.fetch.mockResolvedValueOnce(response);
      await expect(run()).rejects.toThrow(message);
      expect(ctx.state.get('news:730')).toBeUndefined();
    };

    it('403 ve boş yanıt: oyunu kontrol et', async () => {
      const message = 'Steam bu oyun için haber vermedi (App ID 730). Ayarlardan oyunu kontrol et.';
      await failsWith(json({}, 403), message);
      await failsWith(json({}), message);
    });

    it('429: istek sınırı', async () => {
      await failsWith(json({}, 429), 'Steam istek sınırına ulaşıldı. Bir sonraki kontrolde tekrar denenecek.');
    });

    it('diğer HTTP hataları: kodu söyler', async () => {
      await failsWith(json({}, 502), 'Steam beklenmeyen bir yanıt verdi (502).');
    });

    it('bozuk JSON', async () => {
      await failsWith(new Response('<html>', { status: 200 }), "Steam'den gelen yanıt okunamadı.");
    });

    it('zaman aşımı ve bağlantı hatası', async () => {
      await failsWith(new DOMException('timeout', 'TimeoutError'), 'Steam 20 saniye içinde yanıt vermedi.');
      await failsWith(new TypeError('fetch failed'), "Steam'e ulaşılamadı.");
    });
  });
});

describe('steam: kaynak listesi', () => {
  it('her oyun için news- önekli ayrı kaynak üretir, geçersiz ve tekrar edenleri atlar', () => {
    const sources = steam.sources({
      games: [
        { appId: 730, name: 'Counter-Strike 2' },
        { appId: 570, name: '' },
        { appId: 0, name: 'Geçersiz' },
        { appId: 1.5, name: 'Kesirli' },
        { appId: 730, name: 'Kopya' }
      ]
    }, i18nCtx());
    expect(Object.keys(sources)).toEqual(['news-730', 'news-570']);
    expect(sources['news-730'].title).toBe('Counter-Strike 2');
    expect(sources['news-570'].title).toBe('Steam uygulaması 570');
    expect(steam.sources({})).toEqual({});
  });
});

describe('steam: tam metin (okuyucu)', () => {
  const notification = { id: 'steam:1846651706675829', createdAt: 1792018968000, meta: { appId: 730 } };

  it("haberi API'den tarihine göre bulur ve biçimiyle verir", async () => {
    const ctx = { ...i18nCtx(), fetch: vi.fn(async () => json(NEWS)) };
    expect(await newsContent(ctx, notification)).toEqual({ format: 'bbcode', body: NEWS.appnews.newsitems[0].contents });
    const url = new URL(ctx.fetch.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({ appid: '730', count: '3', maxlength: '0', enddate: '1792018969' });
  });

  it('basın haberinin içeriği HTML olarak gelir', async () => {
    const ctx = { ...i18nCtx(), fetch: vi.fn(async () => json(NEWS)) };
    const press = { id: 'steam:1846018067932423', createdAt: 1791530925000, meta: { appId: 730 } };
    expect((await newsContent(ctx, press)).format).toBe('html');
  });

  it('haber yanıtta yoksa null, bilgiler eksikse istek yapmadan null döner', async () => {
    const ctx = { ...i18nCtx(), fetch: vi.fn(async () => json(NEWS)) };
    expect(await newsContent(ctx, { ...notification, id: 'steam:999' })).toBeNull();
    expect(await newsContent(ctx, { ...notification, meta: {} })).toBeNull();
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
  });

  it('eklenti content katkı alanını sunar', () => {
    expect(steam.content).toBe(newsContent);
  });
});

describe('steam: oyun araması', () => {
  it('mağaza sonuçlarını öneriye çevirir, yalnızca uygulamaları alır', async () => {
    const ctx = {
      ...i18nCtx(),
      fetch: vi.fn(async () => json({
        total: 3,
        items: [
          { type: 'app', name: 'Cyberpunk 2077', id: 1091500 },
          { type: 'sub', name: 'Paket', id: 5 },
          { type: 'app', name: 'Cyberpunk 2077: Phantom Liberty', id: 2138330 }
        ]
      }))
    };
    expect(await searchGames(ctx, 'cyberpunk')).toEqual([
      { label: 'Cyberpunk 2077', detail: 'App ID 1091500', value: { appId: 1091500, name: 'Cyberpunk 2077' } },
      { label: 'Cyberpunk 2077: Phantom Liberty', detail: 'App ID 2138330', value: { appId: 2138330, name: 'Cyberpunk 2077: Phantom Liberty' } }
    ]);
    expect(new URL(ctx.fetch.mock.calls[0][0]).searchParams.get('term')).toBe('cyberpunk');
  });

  it('boş sonuçta boş liste döner', async () => {
    const ctx = { ...i18nCtx(), fetch: vi.fn(async () => json({ total: 0, items: [] })) };
    expect(await searchGames(ctx, 'zzz')).toEqual([]);
  });
});

describe('steam: İngilizce', () => {
  it('hata ve yedek adı uygulama dilinde verir', async () => {
    const { ctx, run } = setup({}, 'en');
    ctx.fetch.mockResolvedValueOnce(json({}, 403));
    await expect(run()).rejects.toThrow('Steam returned no news for this game (App ID 730). Check the game in the settings.');
    expect(steam.sources({ games: [{ appId: 570, name: '' }] }, i18nCtx('en'))['news-570'].title).toBe('Steam app 570');
  });

  it('ctx olmadan kaynak başlığı dil bağımsız biçimde kalır', () => {
    expect(steam.sources({ games: [{ appId: 570, name: '' }] })['news-570'].title).toBe('App 570');
  });
});

describe('steam komutu: oyunu başlat', () => {
  const command = steam.commands.launchGame;
  const manifest = JSON.parse(fs.readFileSync(new URL('../../plugins/steam/manifest.json', import.meta.url), 'utf8'));

  it("steam://rungameid/<appId> açar ve oyun adıyla sonuç verir; izin manifest'te beyanlı", async () => {
    const ctx = { ...i18nCtx(), openExternal: vi.fn(async () => {}) };
    expect(await command.run(ctx, { appId: 730, name: 'Counter-Strike 2' })).toEqual({ message: "Steam'de başlatılıyor: Counter-Strike 2" });
    expect(ctx.openExternal).toHaveBeenCalledWith('steam://rungameid/730');
    expect((await command.run(ctx, { appId: 570 })).message).toBe("Steam'de başlatılıyor: Steam uygulaması 570");
    expect(manifest.permissions).toEqual({
      network: { hosts: ['api.steampowered.com', 'store.steampowered.com'] }, openExternal: true, notifications: true
    });
  });

  it('geçersiz App ID açılmaz; oyun araması önerisi bildirilmiş', async () => {
    const ctx = { ...i18nCtx(), openExternal: vi.fn() };
    await expect(command.run(ctx, { appId: 1.5 })).rejects.toThrow('Geçersiz App ID');
    expect(ctx.openExternal).not.toHaveBeenCalled();
    expect(command.params.appId.suggest.provider).toBe('searchGames');
  });
});
