import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import rss, { feedId, parseFeed } from '../../plugins/rss/index.js';
import { createContext } from '../../core/context.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSecrets } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { parseXml } from '../../core/xml.js';
import { pluginI18n, silentLogger } from '../helpers.js';

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const RSS = fixture('rss2.xml');
const ATOM = fixture('atom.xml');
const FEED_URL = 'https://blog.example.com/feed.xml';

const xml = (body, headers = {}, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/xml', ...headers } });

// Gerçek ctx (bildirim deposu, durum, parseXml); yalnızca ağ sahte
function setup({ url = FEED_URL, name = '', locale = 'tr' } = {}) {
  const i18n = pluginI18n('rss', locale);
  const storage = createSqliteStorage(':memory:');
  const notifications = createNotificationStore(storage, new EventEmitter());
  const ctx = createContext('rss', {
    notifications,
    store: storage.kv,
    secrets: createSecrets(storage.kv),
    logger: silentLogger(),
    getSettings: () => ({}),
    getI18n: () => i18n
  });
  ctx.fetch = vi.fn();
  const [[id, source]] = Object.entries(rss.sources({ feeds: [{ url, name }] }));
  return { ctx, notifications, id, source, run: () => source.run(ctx) };
}

describe('rss: ayrıştırma', () => {
  it('RSS 2.0 girişlerini ortak biçime çevirir', () => {
    const feed = parseFeed(parseXml(RSS));
    expect(feed.title).toBe('Örnek Blog');
    expect(feed.entries).toHaveLength(9);
    expect(feed.entries.slice(0, 4)).toEqual([
      { id: 'post-7', title: 'Yedinci yazı', link: 'https://blog.example.com/7', date: Date.parse('2026-06-07T09:00:00Z') },
      { id: 'https://blog.example.com/6', title: 'Altıncı & son değil', link: 'https://blog.example.com/6', date: Date.parse('2026-06-06T09:00:00Z') },
      // guid yoksa link kimlik olur
      { id: 'https://blog.example.com/5', title: 'Beşinci: guid yok', link: 'https://blog.example.com/5', date: Date.parse('2026-06-05T09:00:00Z') },
      // pubDate yoksa dc:date
      { id: 'post-4', title: 'Dördüncü: dc:date', link: 'https://blog.example.com/4', date: Date.parse('2026-06-04T09:00:00Z') }
    ]);
    expect(feed.entries[7]).toMatchObject({ id: '', link: '' });
  });

  it('Atom girişlerinde alternate bağlantıyı, published ve link yedeklerini kullanır', () => {
    const feed = parseFeed(parseXml(ATOM));
    expect(feed.title).toBe('Atom Günlüğü');
    expect(feed.entries).toEqual([
      { id: 'tag:example.com,2026:1', title: 'Birinci giriş', link: 'https://atom.example.com/1', date: Date.parse('2026-06-02T09:00:00Z') },
      { id: 'tag:example.com,2026:2', title: 'İkinci giriş', link: 'https://atom.example.com/2', date: Date.parse('2026-06-03T09:00:00Z') },
      { id: 'https://atom.example.com/3', title: 'Üçüncü: id yok', link: 'https://atom.example.com/3', date: Date.parse('2026-06-01T09:00:00Z') }
    ]);
  });

  it('tek girişli ve boş akışları da okur', () => {
    const single = parseFeed(parseXml('<rss><channel><title>T</title><item><guid>1</guid><title>Tek</title></item></channel></rss>'));
    expect(single.entries).toEqual([{ id: '1', title: 'Tek', link: '', date: null }]);

    expect(parseFeed(parseXml('<rss><channel><title>Boş</title></channel></rss>')).entries).toEqual([]);
    expect(parseFeed(parseXml('<feed xmlns="http://www.w3.org/2005/Atom"><title>Boş</title></feed>')).entries).toEqual([]);
    expect(parseFeed(parseXml('<rss><channel><item><link>https://x/1</link></item></channel></rss>'), '(başlıksız)').entries[0].title).toBe('(başlıksız)');
  });

  it('RSS veya Atom olmayan belgede null döner', () => {
    expect(parseFeed(parseXml('<sitemap><url>x</url></sitemap>'))).toBeNull();
  });
});

describe('rss: kaynak listesi', () => {
  it('her akış için ayrı kaynak üretir, boş ve tekrar eden adresleri atlar', () => {
    const sources = rss.sources({
      feeds: [
        { url: 'https://a.example.com/feed', name: 'A blogu' },
        { url: '  ', name: 'Adressiz' },
        { url: 'https://b.example.com/rss', name: '' },
        { url: 'https://a.example.com/feed', name: 'Kopya' }
      ]
    });
    expect(Object.values(sources).map((s) => s.title)).toEqual(['A blogu', 'b.example.com']);
    expect(Object.keys(sources)).toEqual([feedId('https://a.example.com/feed'), feedId('https://b.example.com/rss')]);
  });

  it('kimlik adrese bağlıdır: ad değişince aynı, adres değişince farklı', () => {
    const id = (feeds) => Object.keys(rss.sources({ feeds }))[0];
    expect(id([{ url: FEED_URL, name: 'Eski ad' }])).toBe(id([{ url: FEED_URL, name: 'Yeni ad' }]));
    expect(id([{ url: 'HTTPS://Blog.Example.com/feed.xml' }])).toBe(id([{ url: FEED_URL }]));
    expect(id([{ url: 'https://blog.example.com/diger.xml' }])).not.toBe(id([{ url: FEED_URL }]));
    expect(feedId(FEED_URL)).toMatch(/^feed-[0-9a-f]{8}$/);
  });

  it('akış yoksa kaynak da yoktur', () => {
    expect(rss.sources({})).toEqual({});
    expect(rss.sources({ feeds: [] })).toEqual({});
  });
});

describe('rss: ilk çalıştırma ve yeni girişler', () => {
  it('ilk çalıştırmada yalnızca en yeni 5 girişi bildirir', async () => {
    const { ctx, notifications, id, run } = setup();
    ctx.fetch.mockResolvedValueOnce(xml(RSS));
    await run();

    const list = notifications.list();
    expect(list.map((n) => n.id)).toEqual([
      `rss:${id}:post-8`,
      `rss:${id}:post-7`,
      `rss:${id}:https://blog.example.com/6`,
      `rss:${id}:https://blog.example.com/5`,
      `rss:${id}:post-4`
    ]);
    expect(list[1]).toMatchObject({
      source: 'rss',
      title: 'Yedinci yazı',
      body: 'Örnek Blog',
      url: 'https://blog.example.com/7',
      tags: ['rss:tag.announcement'],
      createdAt: Date.parse('2026-06-07T09:00:00Z')
    });
  });

  it('sonraki çalıştırmada yalnızca yeni girişi bildirir', async () => {
    const { ctx, notifications, id, run } = setup();
    ctx.fetch.mockResolvedValueOnce(xml(RSS));
    await run();

    const withNew = RSS.replace('<item>', `<item>
      <title>Dokuzuncu</title><guid isPermaLink="false">post-9</guid>
      <link>https://blog.example.com/9</link><pubDate>Tue, 09 Jun 2026 09:00:00 GMT</pubDate>
    </item><item>`);
    ctx.fetch.mockResolvedValueOnce(xml(withNew));
    await run();

    expect(notifications.list()).toHaveLength(6);
    expect(notifications.list()[0].id).toBe(`rss:${id}:post-9`);
  });

  it('ilk çalıştırmada atlanan eski girişler sonra da gelmez', async () => {
    const { ctx, notifications, run } = setup();
    ctx.fetch.mockResolvedValue(xml(RSS));
    await run();
    ctx.fetch.mockResolvedValue(xml(RSS));
    await run();
    expect(notifications.list()).toHaveLength(5);
  });

  it('bildirimler temizlense de akıştaki eski girişler yeniden gelmez', async () => {
    const { ctx, notifications, run } = setup();
    ctx.fetch.mockResolvedValueOnce(xml(RSS));
    await run();
    notifications.clear();

    ctx.fetch.mockResolvedValueOnce(xml(RSS));
    await run();
    expect(notifications.list()).toEqual([]);
  });

  it('görünen ad verilmişse gövdede onu kullanır', async () => {
    const { ctx, notifications, run } = setup({ name: 'Takip ettiğim blog' });
    ctx.fetch.mockResolvedValueOnce(xml(ATOM));
    await run();
    expect(notifications.list().map((n) => n.body)).toEqual(Array(3).fill('Takip ettiğim blog'));
  });

  it('akışta da ad yoksa alan adını kullanır', async () => {
    const { ctx, notifications, run } = setup({ url: 'https://adsiz.example.com/rss' });
    ctx.fetch.mockResolvedValueOnce(xml('<rss><channel><item><guid>1</guid><title>X</title></item></channel></rss>'));
    await run();
    expect(notifications.list()[0].body).toBe('adsiz.example.com');
  });
});

describe('rss: koşullu istek', () => {
  it('ETag ve Last-Modified\'ı sonraki istekte gönderir', async () => {
    const { ctx, run } = setup();
    ctx.fetch.mockResolvedValueOnce(xml(RSS, { etag: '"v1"', 'last-modified': 'Mon, 08 Jun 2026 09:00:00 GMT' }));
    await run();
    expect(ctx.fetch.mock.calls[0][1].headers['If-None-Match']).toBeUndefined();

    ctx.fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await run();
    const { headers } = ctx.fetch.mock.calls[1][1];
    expect(headers['If-None-Match']).toBe('"v1"');
    expect(headers['If-Modified-Since']).toBe('Mon, 08 Jun 2026 09:00:00 GMT');
  });

  it('304 gelince hiçbir şey yapmaz ve durumu korur', async () => {
    const { ctx, notifications, id, run } = setup();
    ctx.fetch.mockResolvedValueOnce(xml(RSS, { etag: '"v1"' }));
    await run();
    const before = ctx.state.get(`feed:${id}`);

    ctx.fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await run();
    expect(notifications.list()).toHaveLength(5);
    expect(ctx.state.get(`feed:${id}`)).toEqual(before);
  });
});

describe('rss: hata durumları', () => {
  const failsWith = async (response, message) => {
    const { ctx, id, run } = setup();
    if (response instanceof Error) ctx.fetch.mockRejectedValueOnce(response);
    else ctx.fetch.mockResolvedValueOnce(response);
    await expect(run()).rejects.toThrow(message);
    // Hata durumunda hiçbir şey kaydedilmez
    expect(ctx.state.get(`feed:${id}`)).toBeUndefined();
  };

  it('404 ve 410: adresi kontrol et', async () => {
    await failsWith(xml('yok', {}, 404), 'Akış bulunamadı (404). Adresi kontrol et.');
    await failsWith(xml('gitti', {}, 410), 'Akış bulunamadı (410). Adresi kontrol et.');
  });

  it('diğer HTTP hataları: kodu söyler', async () => {
    await failsWith(xml('', {}, 503), 'Akış sunucusu beklenmeyen bir yanıt verdi (503). Bir sonraki kontrolde tekrar denenecek.');
  });

  it('zaman aşımı', async () => {
    await failsWith(new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'Akış 20 saniye içinde yanıt vermedi. Adresi ve bağlantını kontrol et.');
  });

  it('bağlantı hatası', async () => {
    await failsWith(new TypeError('fetch failed'), 'Akışa ulaşılamadı. İnternet bağlantını ve adresi kontrol et.');
  });

  it('bozuk XML: satır numarasını söyler', async () => {
    await failsWith(xml('<rss>\n<channel>\n<item>\n</channel>\n</rss>'), 'Akış okunamadı: XML bozuk (satır 4).');
  });

  it('HTML sayfa ve akış olmayan XML: akış değil', async () => {
    await failsWith(xml('<!DOCTYPE html><html><body>Merhaba</body></html>'), 'Bu adres bir RSS veya Atom akışı değil.');
    await failsWith(xml('<sitemap><url>x</url></sitemap>'), 'Bu adres bir RSS veya Atom akışı değil.');
  });

  it('ENTITY tanımlı belgeyi reddeder', async () => {
    await failsWith(xml('<!DOCTYPE r [<!ENTITY a "aaaa">]><rss><channel><title>&a;</title></channel></rss>'),
      'Akış okunamadı: Belge izin verilmeyen varlık (ENTITY) tanımları içeriyor.');
  });

  it('http(s) olmayan adreste istek yapmadan hata verir', async () => {
    const { ctx, run } = setup({ url: 'ftp://example.com/feed' });
    await expect(run()).rejects.toThrow('Akış adresi http:// veya https:// ile başlamalı.');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('bir hatadan sonra akış düzelince kaldığı yerden devam eder', async () => {
    const { ctx, notifications, run } = setup();
    ctx.fetch.mockResolvedValueOnce(xml('', {}, 500));
    await expect(run()).rejects.toThrow();
    ctx.fetch.mockResolvedValueOnce(xml(RSS));
    await run();
    expect(notifications.list()).toHaveLength(5);
  });
});

describe('rss: İngilizce', () => {
  it('hata mesajlarını uygulama dilinde verir, anahtarını taşır', async () => {
    const { ctx, run } = setup({ locale: 'en' });
    ctx.fetch.mockResolvedValueOnce(xml('yok', {}, 404));
    const err = await run().catch((e) => e);
    expect(err.message).toBe('Feed not found (404). Check the address.');
    expect(err.i18n).toEqual({ key: 'rss:errors.notFound', params: { status: 404 } });
  });

  it('core hatasını iç içe çevirir', async () => {
    const { ctx, run } = setup({ locale: 'en' });
    ctx.fetch.mockResolvedValueOnce(xml('<!DOCTYPE r [<!ENTITY a "aaaa">]><rss/>'));
    await expect(run()).rejects.toThrow('Could not read the feed: The document contains disallowed entity (ENTITY) declarations.');
  });

  it('başlıksız girişe uygulama dilinde metin yazar', async () => {
    const { ctx, notifications, run } = setup({ locale: 'en' });
    ctx.fetch.mockResolvedValueOnce(xml('<rss><channel><title>T</title><item><guid>1</guid></item></channel></rss>'));
    await run();
    expect(notifications.list()[0].title).toBe('(untitled)');
  });
});
