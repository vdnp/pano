import fs from 'node:fs';
import path from 'node:path';
import { createSqliteStorage } from './sqlite.js';
import { importLegacyJson } from './legacy-json.js';

// Depo arayüzü (core'un geri kalanı yalnızca bunu görür):
//   kv.get(key) / kv.set(key, value)       JSON değerli anahtarlar
//   notifications.has/insert/list/markRead/markAllRead/clear/prune
//   transaction(fn), isEmpty(), close()
export { createSqliteStorage };

export function openStorage(dataDir, logger = console) {
  fs.mkdirSync(dataDir, { recursive: true });
  const storage = createSqliteStorage(path.join(dataDir, 'pano.db'));
  importLegacyJson(storage, path.join(dataDir, 'pano.json'), logger);
  return storage;
}
