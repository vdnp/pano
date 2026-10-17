import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { sanitizeView, WIDGET_VIEWS } from '../../core/widgets.js';
import { removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

describe('kart görünümleri: şema temizleme', () => {
  it('yalnızca dört görünüm vardır', () => {
    expect(WIDGET_VIEWS).toEqual(['stat', 'list', 'profile', 'progress']);
    expect(() => sanitizeView('html', {})).toThrow('Bilinmeyen kart görünümü');
  });

  it('stat: etiketsiz ve değersiz öğeleri atar, en fazla 6', () => {
    const { data, empty } = sanitizeView('stat', {
      items: [{ label: 'Oyun', value: 42 }, { label: 'Saat', value: NaN }, { label: '', value: 1 }, { label: 'Durum', value: 'Çevrimiçi' }, null,
        ...Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, value: i }))]
    });
    expect(data.items.slice(0, 2)).toEqual([{ label: 'Oyun', value: 42, hint: '' }, { label: 'Durum', value: 'Çevrimiçi', hint: '' }]);
    expect(data.items.length).toBeLessThanOrEqual(6);
    expect(empty).toBe(false);
  });

  it('list: başlıksız satırı atar, yalnızca http(s) adres ve simge bırakır', () => {
    const { data } = sanitizeView('list', {
      items: [
        { title: 'Bir', subtitle: 'alt', icon: 'https://cdn.example.com/a.png', url: 'javascript:alert(1)' },
        { title: '', subtitle: 'başlıksız' },
        { title: 'İki', icon: 'data:image/svg+xml,<svg onload=alert(1)>', url: 'https://example.com/2', extra: '<script>' }
      ]
    });
    expect(data.items).toEqual([
      { icon: 'https://cdn.example.com/a.png', cover: null, title: 'Bir', subtitle: 'alt', meta: '', url: null },
      { icon: null, cover: null, title: 'İki', subtitle: '', meta: '', url: 'https://example.com/2' }
    ]);
  });

  it('profile: adı yoksa boş sayılır, durum tonunu sınırlar', () => {
    expect(sanitizeView('profile', { name: '' }).empty).toBe(true);
    const { data } = sanitizeView('profile', {
      name: 'x'.repeat(100), avatar: 'ftp://a', status: { text: 'Oyunda', tone: 'kırmızı' },
      fields: [{ label: 'Seviye', value: 12 }, { label: 'Boş', value: '' }]
    });
    expect(data).toEqual({ avatar: null, name: 'x'.repeat(60), status: { text: 'Oyunda', tone: 'muted' }, fields: [{ label: 'Seviye', value: '12' }], url: null });
  });

  it('progress: değeri 0..max aralığına sıkıştırır, geçersiz öğeleri atar', () => {
    const { data } = sanitizeView('progress', {
      items: [{ label: 'Başarımlar', value: 30, max: 25 }, { label: 'Negatif', value: -5, max: 10 }, { label: 'Maks yok', value: 1, max: 0 }, { label: 'Değer yok', max: 10 }]
    });
    expect(data.items).toEqual([
      { label: 'Başarımlar', value: 25, max: 25, hint: '' },
      { label: 'Negatif', value: 0, max: 10, hint: '' }
    ]);
  });

  it('progress: olay satırları isteğe bağlı, etiketsizler atılır; yalnızca olay varsa boş sayılmaz', () => {
    const { data, empty } = sanitizeView('progress', {
      events: [{ label: 'Kovboy', meta: '10.03.2024', extra: '<b>' }, { label: '', meta: 'x' }, 'metin', ...Array.from({ length: 10 }, (_, i) => ({ label: `E${i}` }))]
    });
    expect(data.items).toEqual([]);
    expect(data.events[0]).toEqual({ label: 'Kovboy', meta: '10.03.2024' });
    expect(data.events.length).toBeLessThanOrEqual(8);
    expect(empty).toBe(false);
    expect(sanitizeView('progress', { items: [] }).data.events).toEqual([]);
  });

  it('nesne olmayan veride boş görünüm verir', () => {
    expect(sanitizeView('list', 'metin')).toEqual({ data: { items: [] }, empty: true });
    expect(sanitizeView('stat', null).empty).toBe(true);
  });
});

// Kart akışını uçtan uca deneyen eklenti: sağlam, map'i bozuk, görünümü geçersiz ve ayara bağlı kartlar
const PLUGIN = `
export default {
  providers: {
    stats: { ttl: 60, async get(ctx, params) { globalThis.__widgetCalls.push(params); return { oyun: 7, saat: 120 }; } },
    hata: { async get() { throw ctx_error(); } }
  },
  widgets(settings, ctx) {
    const cards = {
      ozet: { title: 'Özet', view: 'stat', provider: 'stats', map: (d) => ({ items: [{ label: 'Oyun', value: d.oyun }] }) },
      bozuk: { title: 'Bozuk', view: 'stat', provider: 'stats', map: (d) => d.olmayan.alan },
      gecersiz: { title: 'Geçersiz', view: 'html', provider: 'stats' },
      kaynaksiz: { title: 'Kaynaksız', view: 'list', provider: 'yok' }
    };
    if (settings.genis) cards.genis = { title: 'Geniş', view: 'list', provider: 'stats', size: 'wide', params: { tur: 'liste' } };
    if (settings.gizli) cards.gizli = { title: 'Gizli', view: 'stat', provider: 'stats', hidden: true };
    return cards;
  }
};
function ctx_error() { return new Error('kaynak çöktü'); }`;

describe('kartlar: core üzerinden', () => {
  let dir, core;

  beforeEach(async () => {
    globalThis.__widgetCalls = [];
    dir = tempDir('pano-widgets-');
    writePlugin(dir, 'kart', { name: 'kart', settings: { genis: { type: 'boolean', default: false }, gizli: { type: 'boolean', default: false } } }, PLUGIN);
    core = createCore({ pluginDirs: [dir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:') });
    await core.start();
  });

  afterEach(async () => {
    await core.stop();
    removeDir(dir);
    delete globalThis.__widgetCalls;
  });

  it('kart tanımlarını düz bilgi olarak listeler, ayara göre kart ekler', () => {
    expect(core.widgets.list().map((w) => [w.id, w.view, w.size])).toEqual([
      ['kart/ozet', 'stat', 'normal'], ['kart/bozuk', 'stat', 'normal'], ['kart/gecersiz', null, 'normal'], ['kart/kaynaksiz', 'list', 'normal']
    ]);
    core.sources.updateSettings('kart', { genis: true });
    expect(core.widgets.list().at(-1)).toMatchObject({ id: 'kart/genis', size: 'wide' });
  });

  it('kart verisini sağlayıcı → map → temizleme ile üretir ve önbellekten verir', async () => {
    const first = await core.widgets.data('kart/ozet');
    expect(first).toMatchObject({ id: 'kart/ozet', view: 'stat', data: { items: [{ label: 'Oyun', value: 7, hint: '' }] }, empty: false, stale: false });
    await core.widgets.data('kart/ozet');
    expect(globalThis.__widgetCalls).toHaveLength(1);
    await core.widgets.data('kart/ozet', { force: true });
    expect(globalThis.__widgetCalls).toHaveLength(2);
  });

  it('map hatası yalnızca o kartı etkiler', async () => {
    const results = await Promise.allSettled(['kart/bozuk', 'kart/ozet'].map((id) => core.widgets.data(id)));
    expect(results[0].reason.message).toBe('Kart verisi hazırlanamadı. Eklentiyi güncellemeyi dene.');
    expect(results[1].status).toBe('fulfilled');
  });

  it('geçersiz görünüm, olmayan kaynak ve olmayan kart için anlaşılır hata verir', async () => {
    await expect(core.widgets.data('kart/gecersiz')).rejects.toThrow('Kart bilinmeyen bir görünüm istiyor: html');
    await expect(core.widgets.data('kart/kaynaksiz')).rejects.toThrow('Kartın veri kaynağı bulunamadı: yok');
    await expect(core.widgets.data('kart/yok')).rejects.toThrow('Kart bulunamadı: kart/yok');
    await expect(core.widgets.data('yok')).rejects.toThrow('Kart bulunamadı: yok');
  });

  it('panel düzeni: yeni kartlar sona görünür eklenir, sıra ve görünürlük saklanır', () => {
    expect(core.dashboard.get().cards.map((c) => c.id)).toEqual(['kart/ozet', 'kart/bozuk', 'kart/gecersiz', 'kart/kaynaksiz']);

    core.dashboard.set({ cards: [
      { id: 'kart/kaynaksiz', visible: false }, { id: 'kart/ozet', visible: true }, { id: 'bilinmeyen/x', visible: true }, { id: 'kart/ozet', visible: false }
    ] });
    expect(core.dashboard.get().cards).toEqual([
      { id: 'kart/kaynaksiz', visible: false }, { id: 'kart/ozet', visible: true },
      { id: 'kart/bozuk', visible: true }, { id: 'kart/gecersiz', visible: true }
    ]);

    core.sources.updateSettings('kart', { genis: true });
    expect(core.dashboard.get().cards.at(-1)).toEqual({ id: 'kart/genis', visible: true });
  });

  it('hidden kart düzene gizli eklenir; kullanıcı açınca açık kalır', () => {
    core.sources.updateSettings('kart', { gizli: true });
    expect(core.widgets.list().at(-1)).toMatchObject({ id: 'kart/gizli', hidden: true });
    expect(core.dashboard.get().cards.at(-1)).toEqual({ id: 'kart/gizli', visible: false });
    core.dashboard.set({ cards: [{ id: 'kart/gizli', visible: true }] });
    expect(core.dashboard.get().cards[0]).toEqual({ id: 'kart/gizli', visible: true });
  });

  it('şu an olmayan kartın sırası depoda korunur', () => {
    core.sources.updateSettings('kart', { genis: true });
    core.dashboard.set({ cards: [{ id: 'kart/genis', visible: false }, { id: 'kart/ozet', visible: true }] });
    core.sources.updateSettings('kart', { genis: false });
    expect(core.dashboard.get().cards.some((c) => c.id === 'kart/genis')).toBe(false);
    // Başka bir değişiklik kaydedilse de gizli kartın tercihi kaybolmaz
    core.dashboard.set({ cards: [{ id: 'kart/ozet', visible: false }] });
    core.sources.updateSettings('kart', { genis: true });
    expect(core.dashboard.get().cards.find((c) => c.id === 'kart/genis')).toEqual({ id: 'kart/genis', visible: false });
  });
});
