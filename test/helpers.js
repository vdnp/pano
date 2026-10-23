import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { createI18n, mergeCatalogs } from '../shared/i18n.js';
import { appCatalogs } from '../locales/index.js';

// Eklentinin gerçek kataloglarıyla çeviri nesnesi (createContext'in getI18n'i için)
export function pluginI18n(name, locale = 'tr') {
  const dir = path.join(process.cwd(), 'plugins', name, 'locales');
  const read = (l) => {
    const file = path.join(dir, `${l}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  };
  return createI18n({ locale, catalogs: mergeCatalogs(appCatalogs, { [name]: { tr: read('tr'), en: read('en') } }) });
}

// Testlerdeki geçici eklentilerin varsayılan izinleri: bildirim ve (sahte ağda) tüm genel internet.
// İzin denetimi testleri kendi manifestini açıkça verir.
export const TEST_PERMISSIONS = { notifications: true, network: { hosts: ['*'] } };

// Sahte DNS: her alan adı genel bir IP'ye çözülür (yerel ağ denetimi için; ağa çıkılmaz)
export const publicResolve = async () => ['93.184.216.34'];

export function silentLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

export function tempDir(prefix = 'pano-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// dir/folder altına manifest.json ve modül dosyası yazar. dir'e "type": "module"
// koyulur ki eklenti dosyaları ESM olarak yüklensin.
export function writePlugin(dir, folder, manifest, code = 'export default {};', main = 'index.js') {
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }');
  const root = path.join(dir, folder);
  fs.mkdirSync(root, { recursive: true });
  const withDefaults = manifest && typeof manifest === 'object' && !('permissions' in manifest)
    ? { ...manifest, permissions: TEST_PERMISSIONS }
    : manifest;
  const manifestText = typeof manifest === 'string' ? manifest : JSON.stringify(withDefaults);
  if (manifest !== null) fs.writeFileSync(path.join(root, 'manifest.json'), manifestText);
  fs.writeFileSync(path.join(root, main), code);
  return root;
}
