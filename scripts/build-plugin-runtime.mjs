// Eklenti penceresinin çalışma zamanını tek bir ES modülü olarak paketler: out/plugin-runtime/runtime.js.
// electron-vite'in renderer girişinden ayrı: geliştirme sunucusundan değil, eklentinin kendi
// kökeninden (pano-plugin://<ad>/__pano__/runtime.js) yüklenmesi gerekir. Yeni bağımlılık yok (Vite).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  configFile: false,
  logLevel: 'warn',
  root,
  build: {
    outDir: path.join(root, 'out', 'plugin-runtime'),
    emptyOutDir: true,
    target: 'chrome130',
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.join(root, 'src', 'plugin-runtime', 'main.js'),
      formats: ['es'],
      fileName: () => 'runtime.js'
    }
  }
});
console.log('Eklenti çalışma zamanı paketlendi: out/plugin-runtime/runtime.js');
