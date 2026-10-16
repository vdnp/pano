import fs from 'node:fs';
import { MAX_ITEMS, restoreNotification } from '../notifications.js';
import { legacyJob, legacyTagsToKeys } from './migrations.js';

const KV_KEYS = ['settings', 'state', 'secrets', 'app'];

function backupPath(file) {
  const backup = `${file}.yedek`;
  return fs.existsSync(backup) ? `${backup}-${Date.now()}` : backup;
}

// Eski JSON deposunu (pano.json) bir kez içe aktarır ve dosyayı pano.json.yedek
// olarak yeniden adlandırır. Hata olursa veritabanına hiçbir şey yazılmaz ve dosya
// yerinde kalır; bir sonraki açılışta tekrar denenir.
export function importLegacyJson(storage, file, logger = console) {
  if (!fs.existsSync(file)) return false;

  if (!storage.isEmpty()) {
    logger.warn(`${file} bulundu ama veritabanı boş değil; içe aktarma atlandı.`);
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];

    storage.transaction(() => {
      for (const key of KV_KEYS) {
        if (data[key] !== undefined) storage.kv.set(key, data[key]);
      }
      for (const raw of notifications) {
        if (raw?.id == null || raw.title == null || raw.source == null) continue;
        const item = restoreNotification(raw);
        storage.notifications.insert({
          ...item,
          tags: legacyTagsToKeys(item.source, item.tags),
          job: item.job ?? legacyJob(item.source, item.meta)
        });
      }
      storage.notifications.prune(MAX_ITEMS);
    });

    const backup = backupPath(file);
    fs.renameSync(file, backup);
    logger.log(`Eski veriler SQLite'a aktarıldı (${notifications.length} bildirim); dosya ${backup} olarak saklandı.`);
    return true;
  } catch (err) {
    logger.error(`Eski veriler (${file}) içe aktarılamadı:`, err.message);
    return false;
  }
}
