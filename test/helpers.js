import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

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
  const manifestText = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  if (manifest !== null) fs.writeFileSync(path.join(root, 'manifest.json'), manifestText);
  fs.writeFileSync(path.join(root, main), code);
  return root;
}
