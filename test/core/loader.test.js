import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins } from '../../core/loader.js';
import { removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

describe('loader', () => {
  let dirs;
  let logger;
  const dir = () => {
    const d = tempDir('pano-plugins-');
    dirs.push(d);
    return d;
  };

  beforeEach(() => {
    dirs = [];
    logger = silentLogger();
  });
  afterEach(() => dirs.forEach(removeDir));

  it('geçerli eklentiyi manifest ve modülüyle yükler', async () => {
    const d = dir();
    const root = writePlugin(d, 'demo', { name: 'demo', displayName: 'Demo' },
      "export default { sources: { a: { title: 'A', run() {} } } };");

    const plugins = await loadPlugins([d], logger);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest).toMatchObject({ name: 'demo', displayName: 'Demo' });
    expect(plugins[0].root).toBe(root);
    expect(Object.keys(plugins[0].module.sources)).toEqual(['a']);
    expect(logger.log).toHaveBeenCalledWith('Eklenti yüklendi: demo');
  });

  it('manifest.main ile farklı giriş dosyası kullanılabilir', async () => {
    const d = dir();
    writePlugin(d, 'demo', { name: 'demo', main: 'giris.js' }, 'export default { ok: true };', 'giris.js');
    const [plugin] = await loadPlugins([d], logger);
    expect(plugin.module.ok).toBe(true);
  });

  it.each([
    ['bozuk JSON', '{ name: demo', /JSON/],
    ['geçersiz isim', { name: 'Demo_Eklenti' }, /manifest.name/],
    ['isimsiz', { displayName: 'X' }, /manifest.name/],
    ['nesne olmayan manifest', '42', /manifest.json okunamadı/]
  ])('%s olan eklentiyi atlar ve hatayı loglar', async (_label, manifest, message) => {
    const d = dir();
    writePlugin(d, 'bozuk', manifest);
    writePlugin(d, 'saglam', { name: 'saglam' });

    const plugins = await loadPlugins([d], logger);
    expect(plugins.map((p) => p.manifest.name)).toEqual(['saglam']);
    expect(logger.error).toHaveBeenCalledWith(
      `Eklenti yüklenemedi (${path.join(d, 'bozuk')}):`,
      expect.stringMatching(message)
    );
  });

  it('manifest dosyası olmayan klasörü atlar', async () => {
    const d = dir();
    writePlugin(d, 'manifestsiz', null);
    expect(await loadPlugins([d], logger)).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('varsayılan export nesne değilse atlar', async () => {
    const d = dir();
    writePlugin(d, 'demo', { name: 'demo' }, 'export default 5;');
    expect(await loadPlugins([d], logger)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), 'varsayılan export bir nesne olmalı');
  });

  it('aynı isimli ikinci eklentiyi atlar, ilki kazanır', async () => {
    const builtin = dir();
    const user = dir();
    const first = writePlugin(builtin, 'github', { name: 'github' }, "export default { from: 'builtin' };");
    const second = writePlugin(user, 'github-kopya', { name: 'github' }, "export default { from: 'user' };");

    const plugins = await loadPlugins([builtin, user], logger);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].root).toBe(first);
    expect(plugins[0].module.from).toBe('builtin');
    expect(logger.warn).toHaveBeenCalledWith(`"github" eklentisi zaten yüklü, ${second} atlandı`);
  });

  it('var olmayan klasörü sessizce geçer', async () => {
    const d = dir();
    writePlugin(d, 'demo', { name: 'demo' });

    const plugins = await loadPlugins([path.join(d, 'yok'), d], logger);
    expect(plugins.map((p) => p.manifest.name)).toEqual(['demo']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('klasör olmayan girdileri yok sayar', async () => {
    const d = dir();
    writePlugin(d, 'demo', { name: 'demo' }); // d/package.json bir dosya
    expect(await loadPlugins([d], logger)).toHaveLength(1);
  });
});
