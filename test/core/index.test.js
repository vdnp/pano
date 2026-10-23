import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { publicResolve, removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

const MANIFEST = {
  name: 'demo',
  displayName: 'Demo',
  settings: {
    interval: { type: 'number', default: 5, min: 1, max: 120 },
    flag: { type: 'boolean', default: false },
    label: { type: 'text', default: '' }
  },
  secrets: { token: { label: 'Anahtar' } }
};

// Çalıştırmalar test sürecindeki ortak bir diziye yazılır
const PLUGIN_CODE = `
export default {
  sources: {
    main: {
      title: 'Ana',
      async run(ctx) { globalThis.__panoRuns.push(ctx.secrets.get('token')); }
    }
  }
};`;

describe('createCore', () => {
  let dataDir, pluginDir, core;

  beforeEach(async () => {
    globalThis.__panoRuns = [];
    dataDir = tempDir('pano-data-');
    pluginDir = tempDir('pano-plugins-');
    writePlugin(pluginDir, 'demo', MANIFEST, PLUGIN_CODE);
    core = createCore({ resolveHost: publicResolve, dataDir, pluginDirs: [pluginDir], cipher: plainCipher, logger: silentLogger() });
    await core.start();
  });

  afterEach(async () => {
    await core.stop();
    removeDir(dataDir);
    removeDir(pluginDir);
    delete globalThis.__panoRuns;
  });

  const demo = () => core.sources.list().find((s) => s.name === 'demo');

  it('kaynakları şema, varsayılan ayarlar ve iş durumuyla listeler', async () => {
    expect(demo()).toMatchObject({
      name: 'demo',
      displayName: 'Demo',
      settings: { interval: 5, flag: false, label: '' },
      secretsSet: { token: false },
      jobs: [{ key: 'demo/main', plugin: 'demo', source: 'main', title: 'Ana', intervalMs: 5 * 60_000 }]
    });
  });

  describe('ayarların şemaya göre temizlenmesi', () => {
    it.each([
      [{ interval: '30' }, { interval: 30 }],
      [{ interval: 500 }, { interval: 120 }],
      [{ interval: 0 }, { interval: 1 }],
      [{ interval: 'abc' }, { interval: 5 }],
      [{ flag: 1 }, { flag: true }],
      [{ flag: 'false' }, { flag: false }],
      [{ flag: 'true' }, { flag: true }],
      [{ label: 42 }, { label: '42' }],
      [{ label: null }, { label: '' }]
    ])('%j → %j', async (input, expected) => {
      await core.sources.updateSettings('demo', input);
      expect(demo().settings).toMatchObject(expected);
    });

    it('şemada olmayan anahtarları atar ve diğerlerini korur', async () => {
      await core.sources.updateSettings('demo', { interval: 10, bilinmeyen: 'x' });
      await core.sources.updateSettings('demo', { flag: true });
      expect(demo().settings).toEqual({ interval: 10, flag: true, label: '' });
    });

    it('aralık değişince işi yeniden zamanlar', async () => {
      await core.sources.updateSettings('demo', { interval: 15 });
      expect(demo().jobs[0].intervalMs).toBe(15 * 60_000);
    });

    it('bilinmeyen eklentide hata fırlatır', async () => {
      await expect(core.sources.updateSettings('yok', {})).rejects.toThrow('Eklenti bulunamadı: yok');
    });
  });

  describe('setSecret', () => {
    it('anahtarı kaydeder ve kaynağı hemen çalıştırır', () => {
      expect(globalThis.__panoRuns).toEqual([]);
      core.sources.setSecret('demo', 'token', 'abc');

      expect(globalThis.__panoRuns).toEqual(['abc']);
      expect(demo().secretsSet.token).toBe(true);
    });

    it('boş değer anahtarı siler ve yine çalıştırır', async () => {
      core.sources.setSecret('demo', 'token', 'abc');
      await new Promise((resolve) => setTimeout(resolve, 0)); // ilk çalışma bitsin
      core.sources.setSecret('demo', 'token', '');

      expect(demo().secretsSet.token).toBe(false);
      expect(globalThis.__panoRuns).toEqual(['abc', null]);
    });

    it('çalışma sürerken gelen ikinci setSecret yeni çalışma başlatmaz', () => {
      core.sources.setSecret('demo', 'token', 'abc');
      core.sources.setSecret('demo', 'token', 'def');
      expect(globalThis.__panoRuns).toEqual(['abc']);
    });

    it('şemada olmayan gizli alanı reddeder', () => {
      expect(() => core.sources.setSecret('demo', 'parola', 'x')).toThrow('Bilinmeyen gizli alan: parola');
      expect(globalThis.__panoRuns).toEqual([]);
    });
  });

  it('ayarlar ve gizli alanlar yeniden açılışta korunur', async () => {
    await core.sources.updateSettings('demo', { interval: 20 });
    core.sources.setSecret('demo', 'token', 'abc');
    await core.stop();

    core = createCore({ resolveHost: publicResolve, dataDir, pluginDirs: [pluginDir], cipher: plainCipher, logger: silentLogger() });
    await core.start();
    expect(demo().settings.interval).toBe(20);
    expect(demo().secretsSet.token).toBe(true);
  });

  it('uygulama ayarlarını temizler ve olay yayınlar', () => {
    const seen = [];
    core.bus.on('app:settingsChanged', (s) => seen.push(s));

    expect(core.getAppSettings()).toEqual({ openAtLogin: false, pauseNotifications: false, language: 'system' });
    core.setAppSettings({ pauseNotifications: 'evet', bilinmeyen: true });
    expect(core.getAppSettings()).toEqual({ openAtLogin: false, pauseNotifications: true, language: 'system' });
    expect(seen).toEqual([{ openAtLogin: false, pauseNotifications: true, language: 'system' }]);

    // Dil yalnızca desteklenen değerlerden biri olabilir; geçersiz değer yok sayılır
    core.setAppSettings({ language: 'en' });
    core.setAppSettings({ language: 'de' });
    expect(core.getAppSettings().language).toBe('en');
  });
});
