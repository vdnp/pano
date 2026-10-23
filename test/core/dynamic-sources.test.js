import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { publicResolve, removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

const MANIFEST = {
  name: 'dyn',
  setup: { title: 'Henüz akış eklenmedi', body: 'Açıklama', action: 'Akış ekle' },
  settings: {
    feeds: {
      type: 'list',
      item: {
        url: { type: 'string', required: true },
        name: { type: 'string' },
        weight: { type: 'number', default: 1, min: 1, max: 10 },
        muted: { type: 'boolean' }
      }
    },
    interval: { type: 'number', default: 5, min: 1 }
  }
};

// Her akış ayrı bir kaynak; çalıştırmalar test sürecindeki ortak diziye yazılır
const PLUGIN_CODE = `
export default {
  sources(settings) {
    if (settings.feeds.some((f) => f.url === 'patlat')) throw new Error('hesaplanamadı');
    return Object.fromEntries(settings.feeds.map((f) => [
      f.url.replace(/[^a-z0-9]/g, ''),
      { title: f.name || f.url, run: () => { globalThis.__dynRuns.push(f.url); } }
    ]));
  }
};`;

describe('ayarlara göre değişen kaynaklar', () => {
  let pluginDir, core, logger;

  beforeEach(async () => {
    globalThis.__dynRuns = [];
    logger = silentLogger();
    pluginDir = tempDir('pano-dyn-');
    writePlugin(pluginDir, 'dyn', MANIFEST, PLUGIN_CODE);
    core = createCore({ resolveHost: publicResolve,
      pluginDirs: [pluginDir], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:')
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop();
    removeDir(pluginDir);
    delete globalThis.__dynRuns;
  });

  const plugin = () => core.sources.list().find((s) => s.name === 'dyn');
  const jobs = () => plugin().jobs.map((j) => ({ key: j.key, title: j.title }));
  const setFeeds = (feeds) => core.sources.updateSettings('dyn', { feeds });

  describe('list türünün temizlenmesi', () => {
    it('varsayılan değer boş listedir', () => {
      expect(plugin().settings.feeds).toEqual([]);
    });

    it('dizi olmayan değeri boş listeye çevirir', async () => {
      await setFeeds('https://a');
      expect(plugin().settings.feeds).toEqual([]);
    });

    it('alanları alt şemaya göre temizler, boş ve zorunlu alanı boş satırları atar', async () => {
      await setFeeds([
        { url: '  https://a  ', name: 'A', weight: '50', muted: 1, fazla: 'x' },
        { url: '', name: '' },
        { url: '', name: 'Adressiz' },
        null,
        'metin',
        { url: 'https://b' }
      ]);
      expect(plugin().settings.feeds).toEqual([
        { url: 'https://a', name: 'A', weight: 10, muted: true },
        { url: 'https://b', name: '', weight: 1, muted: false }
      ]);
    });

    it('en fazla 50 öğe tutar', async () => {
      await setFeeds(Array.from({ length: 51 }, (_, i) => ({ url: `https://f${i}` })));
      expect(plugin().settings.feeds).toHaveLength(50);
      expect(plugin().settings.feeds.at(-1).url).toBe('https://f49');
    });
  });

  it('başlangıçta akış yoksa iş de yoktur', () => {
    expect(jobs()).toEqual([]);
  });

  it('manifest.setup metnini arayüze iletir, yoksa null verir', async () => {
    expect(plugin().setup).toEqual(MANIFEST.setup);

    const other = tempDir('pano-nosetup-');
    writePlugin(other, 'duz', { name: 'duz' });
    const plain = createCore({ resolveHost: publicResolve, pluginDirs: [other], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:') });
    await plain.start();
    expect(plain.sources.list()[0].setup).toBeNull();
    await plain.stop();
    removeDir(other);
  });

  it('ayar değişince işleri ekler ve siler', async () => {
    await setFeeds([{ url: 'https://a', name: 'A' }, { url: 'https://b', name: 'B' }]);
    expect(jobs()).toEqual([{ key: 'dyn/httpsa', title: 'A' }, { key: 'dyn/httpsb', title: 'B' }]);

    await setFeeds([{ url: 'https://b', name: 'B' }, { url: 'https://c' }]);
    expect(jobs()).toEqual([{ key: 'dyn/httpsb', title: 'B' }, { key: 'dyn/httpsc', title: 'https://c' }]);

    // Silinen iş artık çalıştırılamaz
    core.sources.runNow('dyn/httpsa');
    expect(globalThis.__dynRuns).toEqual([]);
  });

  it('ad değişince işi yeniden kurmaz, yalnızca başlığı günceller', async () => {
    await setFeeds([{ url: 'https://a', name: 'Eski' }]);
    await core.sources.runNow('dyn/httpsa');
    const before = plugin().jobs[0];

    await setFeeds([{ url: 'https://a', name: 'Yeni' }]);
    const after = plugin().jobs[0];
    expect(after.title).toBe('Yeni');
    expect(after.lastSuccess).toBe(before.lastSuccess);
    expect(after.nextRun).toBe(before.nextRun);
  });

  it('çalışan iş en güncel tanımı kullanır', async () => {
    await setFeeds([{ url: 'https://a', name: 'A' }]);
    await core.sources.runNow('dyn/httpsa');
    expect(globalThis.__dynRuns).toEqual(['https://a']);
  });

  it('aralık değişince tüm işleri yeniden zamanlar', async () => {
    await setFeeds([{ url: 'https://a' }, { url: 'https://b' }]);
    await core.sources.updateSettings('dyn', { interval: 15 });
    expect(plugin().jobs.map((j) => j.intervalMs)).toEqual([15 * 60_000, 15 * 60_000]);
  });

  it('setup hata verirse hatayı listeler ve ayar kaydında bile iş kurmaz', async () => {
    const other = tempDir('pano-broken-');
    writePlugin(other, 'bozuk', { name: 'bozuk', settings: { x: { type: 'number', default: 1 } } }, `
      export default {
        setup() { throw new Error('yapılandırma dosyası yok'); },
        sources: { a: { title: 'A', run() {} } }
      };`);
    const broken = createCore({ resolveHost: publicResolve, pluginDirs: [other], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:') });
    await broken.start();

    const [item] = broken.sources.list();
    expect(item.startError).toBe("Eklenti başlatılamadı: yapılandırma dosyası yok. Sorunu giderip Pano'yu yeniden başlat.");
    expect(item.jobs).toEqual([]);

    await broken.sources.updateSettings('bozuk', { x: 2 });
    expect(broken.sources.list()[0].jobs).toEqual([]);
    expect(plugin().startError).toBeNull(); // sağlam eklentide alan boş
    await broken.stop();
    removeDir(other);
  });

  it('bildirimler üreten işin kimliğiyle kaydedilir, aynı anda çalışan işler karışmaz', async () => {
    const other = tempDir('pano-jobs-');
    // Her iş beklemeye girer; ikisi aynı anda çalışırken bildirim üretir
    writePlugin(other, 'oyunlar', { name: 'oyunlar' }, `
      const wait = () => new Promise((r) => setTimeout(r, 5));
      export default {
        sources: {
          'news-1': { title: 'Bir', async run(ctx) { await wait(); ctx.notify({ id: 'a', title: 'A', job: 'sahte' }); } },
          'news-2': { title: 'İki', async run(ctx) { ctx.notify({ id: 'b', title: 'B' }); await wait(); ctx.notify({ id: 'c', title: 'C' }); } }
        }
      };`);
    const games = createCore({ resolveHost: publicResolve, pluginDirs: [other], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:') });
    await games.start();

    await Promise.all([games.sources.runNow('oyunlar/news-1'), games.sources.runNow('oyunlar/news-2')]);
    const byId = Object.fromEntries(games.notifications.list().map((n) => [n.id, n.job]));
    // Eklentinin verdiği job yok sayılır, core yazar
    expect(byId).toEqual({ 'oyunlar:a': 'news-1', 'oyunlar:b': 'news-2', 'oyunlar:c': 'news-2' });

    // İş bazında "tümünü okundu say" yalnızca o işi etkiler
    games.notifications.markAllRead('oyunlar', 'news-2');
    expect(games.notifications.list().filter((n) => n.read).map((n) => n.id).sort()).toEqual(['oyunlar:b', 'oyunlar:c']);

    // Liste halinde okundu işaretleme (tür filtresi seçiliyken görünenler)
    games.notifications.markRead(['oyunlar:a']);
    expect(games.notifications.list().every((n) => n.read)).toBe(true);

    await games.stop();
    removeDir(other);
  });

  it('tam metni önce bildirimi üreten eklentiden ister, vermeyen eklentide null döner', async () => {
    const other = tempDir('pano-content-');
    writePlugin(other, 'kaynakli', { name: 'kaynakli' }, `
      export default {
        sources: { a: { title: 'A', run(ctx) { ctx.notify({ id: '1', title: 'Bir' }); ctx.notify({ id: '2', title: 'İki' }); } } },
        async content(ctx, n) { return n.id === 'kaynakli:1' ? { format: 'text', body: 'Tam metin: ' + n.title } : null; }
      };`);
    writePlugin(other, 'duz', { name: 'duz' }, `
      export default { sources: { a: { title: 'A', run(ctx) { ctx.notify({ id: '1', title: 'Düz' }); } } } };`);
    const c = createCore({ resolveHost: publicResolve, pluginDirs: [other], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:') });
    await c.start();
    await c.sources.runNow('kaynakli/a');
    await c.sources.runNow('duz/a');

    expect(await c.notifications.fetchContent('kaynakli:1')).toEqual({ format: 'text', body: 'Tam metin: Bir' });
    // Önbelleğe yazıldı
    expect(c.notifications.content('kaynakli:1')).toEqual({ format: 'text', body: 'Tam metin: Bir' });
    expect(await c.notifications.fetchContent('kaynakli:2')).toBeNull();
    expect(await c.notifications.fetchContent('duz:1')).toBeNull();
    expect(await c.notifications.fetchContent('yok:1')).toBeNull();

    await c.stop();
    removeDir(other);
  });

  it('kaynak fonksiyonu hata verirse loglar ve iş bırakmaz', async () => {
    await setFeeds([{ url: 'https://a' }]);
    await setFeeds([{ url: 'patlat' }]);
    expect(jobs()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('[dyn] kaynak listesi hesaplanamadı:', 'hesaplanamadı');
  });
});
