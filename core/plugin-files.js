// "filesystem" izni: eklentiye ayrılmış klasör (userData/plugin-data/<ad>/). Yalnızca metin dosyaları;
// yollar klasörün içinde kalmalı (.., mutlak yol, sürücü harfi, ters bölü reddedilir). Kota toplam boyut
// ve dosya sayısıyla sınırlı. Eklenti kaldırılınca klasör silinebilir (uygulama tarafı).

import fs from 'node:fs/promises';
import path from 'node:path';

export const FILE_LIMITS = { totalBytes: 50 * 1024 * 1024, files: 1000, pathLength: 200 };
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

export function createPluginFiles({ dir, error, limits = FILE_LIMITS }) {
  const fail = (key, params) => Object.assign(error(`core.permissions.files.${key}`, params), { code: 'FILES_DENIED' });

  // "notlar/2026.json" → klasör içindeki mutlak yol
  function resolve(rel, { allowRoot = false } = {}) {
    const value = String(rel ?? '');
    // Baştaki "/" mutlak yol sanılmasın diye açıkça reddedilir (yollar hep klasöre göre)
    if (value.length > limits.pathLength || value.startsWith('/')) throw fail('badPath', { path: value.slice(0, 60) });
    const parts = value.split('/').filter((p) => p !== '');
    if (!allowRoot && parts.length === 0) throw fail('badPath', { path: value });
    if (parts.some((p) => !SEGMENT.test(p) || p === '.' || p === '..')) throw fail('badPath', { path: value.slice(0, 60) });
    const full = path.resolve(dir, ...parts);
    if (full !== path.resolve(dir) && !full.startsWith(path.resolve(dir) + path.sep)) throw fail('badPath', { path: value.slice(0, 60) });
    return full;
  }

  async function usage() {
    let bytes = 0;
    let files = 0;
    const walk = async (d) => {
      let entries;
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          files++;
          bytes += (await fs.stat(p)).size;
        }
      }
    };
    await walk(dir);
    return { bytes, files };
  }

  return {
    // Dosya yoksa null
    async read(rel) {
      try {
        return await fs.readFile(resolve(rel), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(rel, text) {
      const full = resolve(rel);
      const content = String(text ?? '');
      const size = Buffer.byteLength(content);
      const { bytes, files } = await usage();
      let existing = 0;
      try {
        existing = (await fs.stat(full)).size;
      } catch { /* yeni dosya */ }
      if (bytes - existing + size > limits.totalBytes || (!existing && files + 1 > limits.files)) {
        throw fail('quota', { mb: Math.round(limits.totalBytes / 1024 / 1024), files: limits.files });
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
      return true;
    },
    // Klasördeki ad listesi; alt klasörler "/" ile biter
    async list(rel = '') {
      try {
        const entries = await fs.readdir(resolve(rel, { allowRoot: true }), { withFileTypes: true });
        return entries.filter((e) => e.isFile() || e.isDirectory()).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
    },
    async remove(rel) {
      await fs.rm(resolve(rel), { recursive: true, force: true });
      return true;
    }
  };
}
