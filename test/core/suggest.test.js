import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { publicResolve, removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

const MANIFEST = {
  name: 'oyun',
  settings: {
    games: {
      type: 'list',
      suggest: { provider: 'searchGames' },
      item: {
        appId: { type: 'number', required: true, min: 1 },
        name: { type: 'string' }
      }
    }
  }
};

// Sorguya göre farklı sonuçlar; "gizli" bildirilmemiş bir sağlayıcı
const PLUGIN_CODE = `
export default {
  suggest: {
    async searchGames(ctx, query) {
      globalThis.__suggestCalls.push(query);
      if (query === 'patlat') throw new Error('Mağaza şu an yanıt vermiyor.');
      if (query === 'cok') return Array.from({ length: 30 }, (_, i) => ({ label: 'Oyun ' + i, value: { appId: i + 1 } }));
      return [
        { label: 'Cyberpunk 2077', detail: 'App ID 1091500', value: { appId: 1091500, name: 'Cyberpunk 2077' } },
        { label: '', value: { appId: 5 } },
        { label: 'Geçersiz değer', value: { appId: '' } },
        { label: 'Değersiz' },
        { label: 'x'.repeat(300), value: { appId: '42', fazla: true } }
      ];
    },
    async gizli() { globalThis.__suggestCalls.push('gizli'); return []; }
  }
};`;

describe('öneri sağlayıcısı', () => {
  let pluginDir, core;

  beforeEach(async () => {
    globalThis.__suggestCalls = [];
    pluginDir = tempDir('pano-suggest-');
    writePlugin(pluginDir, 'oyun', MANIFEST, PLUGIN_CODE);
    core = createCore({ resolveHost: publicResolve,
      pluginDirs: [pluginDir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:')
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop();
    removeDir(pluginDir);
    delete globalThis.__suggestCalls;
  });

  it('sonuçları listenin alt şemasından geçirir, geçersizleri atar', async () => {
    expect(await core.sources.suggest('oyun', 'searchGames', '  cyber  ')).toEqual([
      { label: 'Cyberpunk 2077', detail: 'App ID 1091500', value: { appId: 1091500, name: 'Cyberpunk 2077' } },
      { label: 'x'.repeat(200), detail: '', value: { appId: 42, name: '' } }
    ]);
    expect(globalThis.__suggestCalls).toEqual(['cyber']);
  });

  it('en fazla 20 sonuç döner', async () => {
    expect(await core.sources.suggest('oyun', 'searchGames', 'cok')).toHaveLength(20);
  });

  it('2 karakterden kısa sorguda sağlayıcıyı çağırmaz, sorguyu 100 karakterde keser', async () => {
    expect(await core.sources.suggest('oyun', 'searchGames', ' a ')).toEqual([]);
    expect(globalThis.__suggestCalls).toEqual([]);

    await core.sources.suggest('oyun', 'searchGames', 'q'.repeat(150));
    expect(globalThis.__suggestCalls[0]).toHaveLength(100);
  });

  it('manifest\'te bildirilmemiş fonksiyonu çağırmaz', async () => {
    await expect(core.sources.suggest('oyun', 'gizli', 'abc')).rejects.toThrow('Bilinmeyen öneri sağlayıcısı: gizli');
    await expect(core.sources.suggest('oyun', 'yok', 'abc')).rejects.toThrow('Bilinmeyen öneri sağlayıcısı: yok');
    expect(globalThis.__suggestCalls).toEqual([]);
  });

  it('bilinmeyen eklentide ve sağlayıcı hatasında anlaşılır hata verir', async () => {
    await expect(core.sources.suggest('bilinmeyen', 'searchGames', 'abc')).rejects.toThrow('Eklenti bulunamadı: bilinmeyen');
    await expect(core.sources.suggest('oyun', 'searchGames', 'patlat')).rejects.toThrow('Mağaza şu an yanıt vermiyor.');
  });

  describe('list türünde zorunlu sayı ve boş satır', () => {
    const games = () => core.sources.list()[0].settings.games;

    it('yalnızca sayısı dolu satırı tutar', async () => {
      await core.sources.updateSettings('oyun', { games: [{ appId: 570, name: '' }] });
      expect(games()).toEqual([{ appId: 570, name: '' }]);
    });

    it('zorunlu sayı boş ya da sayı değilse satırı atar', async () => {
      await core.sources.updateSettings('oyun', {
        games: [{ appId: '', name: 'Adsız' }, { appId: 'abc', name: 'Harf' }, { appId: '730', name: 'CS2' }, { appId: null, name: '' }]
      });
      expect(games()).toEqual([{ appId: 730, name: 'CS2' }]);
    });
  });
});
