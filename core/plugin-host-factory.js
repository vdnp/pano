// Süreç içi host fabrikası (Node tarafı): eklenti modülünü bu süreçte yükler. Testlerin ve
// PANO_PLUGIN_HOST=inprocess geliştirme modunun varsayılanı. plugin-host.js'ten ayrı tutulur çünkü
// o dosya eklenti sürecine (tarayıcı) de paketlenir; burada Node'a özgü import var.

import { pathToFileURL } from 'node:url';
import { createInProcessHost } from './plugin-host.js';

export function createInProcessHostFactory() {
  return async ({ name, entryFile, module, ctx, logger }) => {
    const mod = module ?? (await import(/* @vite-ignore */ pathToFileURL(entryFile).href)).default;
    if (!mod || typeof mod !== 'object') throw new Error('varsayılan export bir nesne olmalı');
    return createInProcessHost({ name, module: mod, ctx, logger });
  };
}
