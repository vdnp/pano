import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const LOCALE_FILES = ['tr', 'en'];

// Eklentinin locales/<dil>.json katalogları; olmayan dosya sorun değil, bozuk dosya loglanır
async function readLocales(root, logger) {
  const locales = {};
  for (const locale of LOCALE_FILES) {
    try {
      locales[locale] = JSON.parse(await readFile(path.join(root, 'locales', `${locale}.json`), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn(`Dil dosyası okunamadı (${root}, ${locale}):`, err.message);
    }
  }
  return locales;
}

// "pano" uygulamanın kendi komutlarına ayrılmıştır (pano/runAll)
const RESERVED = new Set(['pano']);

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json okunamadı');
  if (!NAME_PATTERN.test(manifest.name ?? '')) {
    throw new Error('manifest.name küçük harf, rakam ve tire içermeli');
  }
  if (RESERVED.has(manifest.name)) throw new Error(`"${manifest.name}" adı uygulamaya ayrılmış`);
}

// Verilen klasörlerdeki her alt klasörü bir eklenti olarak yükler.
// Aynı isimde iki eklenti varsa ilk bulunan kullanılır.
export async function loadPlugins(dirs, logger) {
  const plugins = [];
  const seen = new Set();

  for (const dir of dirs) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // klasör yoksa sorun değil
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = path.join(dir, entry.name);

      try {
        const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
        validateManifest(manifest);
        if (seen.has(manifest.name)) {
          logger.warn(`"${manifest.name}" eklentisi zaten yüklü, ${root} atlandı`);
          continue;
        }

        const entryFile = path.join(root, manifest.main ?? 'index.js');
        const mod = (await import(/* @vite-ignore */ pathToFileURL(entryFile).href)).default;
        if (!mod || typeof mod !== 'object') throw new Error('varsayılan export bir nesne olmalı');

        seen.add(manifest.name);
        plugins.push({ manifest, module: mod, root, locales: await readLocales(root, logger) });
        logger.log(`Eklenti yüklendi: ${manifest.name}`);
      } catch (err) {
        logger.error(`Eklenti yüklenemedi (${root}):`, err.message);
      }
    }
  }

  return plugins;
}
