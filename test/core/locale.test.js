import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../../core/index.js';
import { loadPlugins } from '../../core/loader.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

function writeLocales(root, catalogs) {
  fs.mkdirSync(path.join(root, 'locales'), { recursive: true });
  for (const [locale, data] of Object.entries(catalogs)) {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    fs.writeFileSync(path.join(root, 'locales', `${locale}.json`), text);
  }
}

describe('çok dilli core', () => {
  let dir, core, logger;

  beforeEach(async () => {
    logger = silentLogger();
    dir = tempDir('pano-locale-');
    const ok = writePlugin(dir, 'demo', { name: 'demo', displayName: 'Demo' }, `
      export default {
        sources: { a: { title: 'A', run(ctx) { throw ctx.error('errors.down', { code: 503 }); } } }
      };`);
    writeLocales(ok, {
      tr: { errors: { down: 'Sunucu çalışmıyor ({code}).' } },
      en: { errors: { down: 'Server is down ({code}).' }, manifest: { displayName: 'Demo EN' } }
    });
    const broken = writePlugin(dir, 'bozuk', { name: 'bozuk' }, `
      export default { setup() { throw new Error('ayar yok'); } };`);
    writeLocales(broken, { tr: '{ bozuk json' });

    core = createCore({
      pluginDirs: [dir], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:'), locale: 'en'
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop();
    removeDir(dir);
  });

  const find = (name) => core.sources.list().find((s) => s.name === name);

  it('eklenti kataloglarını yükler, bozuk dil dosyasını loglar', async () => {
    expect(find('demo').locales.en.manifest.displayName).toBe('Demo EN');
    expect(find('bozuk').locales).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Dil dosyası okunamadı'), expect.any(String));

    const [plugin] = await loadPlugins([path.join(dir, 'yok')], logger);
    expect(plugin).toBeUndefined();
  });

  it('iş hatası seçili dilde, anahtarı ile kaydedilir', async () => {
    await core.sources.runNow('demo/a');
    expect(find('demo').jobs[0]).toMatchObject({
      state: 'error',
      error: 'Server is down (503).',
      errorI18n: { key: 'demo:errors.down', params: { code: 503 } }
    });
  });

  it('dil değişince core mesajları yeni dilde üretilir', async () => {
    expect(find('bozuk').startError).toBe('The plugin could not start: ayar yok. Fix the problem and restart Pano.');
    expect(find('bozuk').startErrorI18n).toEqual({ key: 'core.errors.startFailed', params: { error: 'ayar yok' } });

    await core.setLocale('tr');
    expect(core.getLocale()).toBe('tr');
    expect(find('bozuk').startError).toBe("Eklenti başlatılamadı: ayar yok. Sorunu giderip Pano'yu yeniden başlat.");
    await expect(core.sources.updateSettings('yok', {})).rejects.toThrow('Eklenti bulunamadı: yok');

    await core.setLocale('de'); // desteklenmeyen dil yok sayılır
    expect(core.getLocale()).toBe('tr');
  });
});
