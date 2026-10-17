import { describe, expect, it } from 'vitest';
import { setupNeed as rawSetupNeed } from '../../src/renderer/src/lib/setup.js';
import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';

const i18nFor = (locale, plugins = {}) => createI18n({ locale, catalogs: mergeCatalogs(appCatalogs, plugins) });
const setupNeed = (source) => rawSetupNeed(source, i18nFor('tr'));

const source = (overrides = {}) => ({
  name: 'demo',
  displayName: 'Demo',
  description: 'Demo açıklaması.',
  secretsSchema: {},
  secretsSet: {},
  setup: null,
  jobs: [{ key: 'demo/a' }],
  ...overrides
});

describe('setupNeed', () => {
  it('eksik gizli alan varsa alanın adıyla anahtar ister', () => {
    expect(setupNeed(source({
      name: 'github',
      displayName: 'GitHub',
      secretsSchema: { token: { label: 'Erişim anahtarı (classic token)' } },
      secretsSet: { token: false }
    }))).toEqual({
      name: 'github',
      title: 'GitHub bağlantısı kurulmadı',
      body: 'Bildirimleri görmek için ayarlardan "Erişim anahtarı (classic token)" alanını doldur.',
      action: 'Anahtar ekle'
    });
  });

  it('hiç kaynağı yoksa manifest.setup metnini kullanır', () => {
    expect(setupNeed(source({
      name: 'rss',
      jobs: [],
      setup: { title: 'Henüz akış eklenmedi', body: 'Akış adresi ekle.', action: 'Akış ekle' }
    }))).toEqual({ name: 'rss', title: 'Henüz akış eklenmedi', body: 'Akış adresi ekle.', action: 'Akış ekle' });
  });

  it('setup yoksa genel metin ve açıklamayı kullanır', () => {
    expect(setupNeed(source({ jobs: [] }))).toEqual({
      name: 'demo',
      title: 'Demo için kaynak eklenmedi',
      body: 'Demo açıklaması.',
      action: 'Ayarları aç'
    });
  });

  it('başlatılamayan eklentide hatayı düğmesiz gösterir (eksik anahtardan önce)', () => {
    expect(setupNeed(source({
      jobs: [],
      startError: 'Eklenti başlatılamadı: x.',
      secretsSchema: { token: {} },
      secretsSet: { token: false }
    }))).toEqual({ name: 'demo', title: 'Demo başlatılamadı', body: 'Eklenti başlatılamadı: x.', action: null });
  });

  it('yalnızca kart sunan eklenti kurulum beklemez', () => {
    expect(setupNeed(source({ jobs: [], kinds: { sources: false, widgets: true } }))).toBeNull();
    expect(setupNeed(source({ jobs: [], kinds: { sources: true, widgets: true } }))).not.toBeNull();
  });

  it('gizli alanları dolu ve kaynağı olan eklenti kurulum beklemez', () => {
    expect(setupNeed(source({ secretsSchema: { token: {} }, secretsSet: { token: true } }))).toBeNull();
  });

  describe('İngilizce', () => {
    it('genel metinleri uygulama kataloğundan çevirir', () => {
      expect(rawSetupNeed(source({
        name: 'github',
        displayName: 'GitHub',
        secretsSchema: { token: { label: 'Erişim anahtarı' } },
        secretsSet: { token: false }
      }), i18nFor('en'))).toEqual({
        name: 'github',
        title: 'GitHub is not connected',
        body: 'To see notifications, fill in "Erişim anahtarı" in the settings.',
        action: 'Add key'
      });
    });

    it('manifest metinlerini eklentinin kataloğundan çevirir', () => {
      const plugins = { rss: { en: { manifest: {
        displayName: 'RSS',
        setup: { title: 'No feeds yet', body: 'Add a feed.', action: 'Add feed' },
        secrets: {}
      } } } };
      expect(rawSetupNeed(source({
        name: 'rss',
        jobs: [],
        setup: { title: 'Henüz akış eklenmedi', body: 'Akış adresi ekle.', action: 'Akış ekle' }
      }), i18nFor('en', plugins))).toEqual({ name: 'rss', title: 'No feeds yet', body: 'Add a feed.', action: 'Add feed' });
    });

    it('başlatma hatasını anahtarından yeniden çevirir', () => {
      const need = rawSetupNeed(source({
        jobs: [],
        startError: "Eklenti başlatılamadı: x. Sorunu giderip Pano'yu yeniden başlat.",
        startErrorI18n: { key: 'core.errors.startFailed', params: { error: 'x' } }
      }), i18nFor('en'));
      expect(need.title).toBe('Demo could not start');
      expect(need.body).toBe('The plugin could not start: x. Fix the problem and restart Pano.');
    });
  });
});
