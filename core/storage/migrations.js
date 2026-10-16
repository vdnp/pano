// Sıralı şema değişiklikleri. Dizinin i. elemanı şemayı i'den i+1 sürümüne taşır.
// Yayınlanmış bir migration değiştirilmez; yeni değişiklik için sona eleman eklenir.
import { baseI18n } from '../../locales/index.js';

// Çok dilli yapıdan önce etiketler Türkçe metin olarak saklanıyordu. Bilinen etiketler
// kaynağa göre çeviri anahtarına eşlenir; bilinmeyenler olduğu gibi kalır.
const LEGACY_TAGS = {
  rss: { Duyuru: 'rss:tag.announcement' },
  steam: { Duyuru: 'steam:tag.announcement', 'Yama notu': 'steam:tag.patchNotes' },
  github: {
    Issue: 'github:type.Issue',
    'Pull request': 'github:type.PullRequest',
    'Sürüm': 'github:type.Release',
    Commit: 'github:type.Commit',
    'Tartışma': 'github:type.Discussion',
    Kontrol: 'github:type.CheckSuite',
    'Güvenlik': 'github:type.RepositoryVulnerabilityAlert',
    'Onay istendi': 'github:reason.approval_requested',
    'Sana atandı': 'github:reason.assign',
    'Senin açtığın': 'github:reason.author',
    CI: 'github:reason.ci_activity',
    Yorum: 'github:reason.comment',
    Davet: 'github:reason.invitation',
    'Takip ettiğin': 'github:reason.manual',
    'Senden bahsedildi': 'github:reason.mention',
    'İnceleme istendi': 'github:reason.review_requested',
    'Güvenlik uyarısı': 'github:reason.security_alert',
    'Durum değişti': 'github:reason.state_change',
    'Abone olduğun': 'github:reason.subscribed',
    'Takımından bahsedildi': 'github:reason.team_mention'
  }
};

// Eski pano.json aktarımı da kullanır (aktarma migration'lardan sonra çalışır)
export function legacyTagsToKeys(source, tags) {
  const map = LEGACY_TAGS[source];
  return map && Array.isArray(tags) ? tags.map((tag) => map[tag] ?? tag) : tags;
}

// Çok dilli yapıdan ve iş bazlı filtreden önceki kayıtlar için iş kimliği (migration 3 ile aynı kural)
export function legacyJob(source, meta = {}) {
  if (source === 'rss' && meta.feedId) return String(meta.feedId);
  if (source === 'steam' && meta.appId != null) return `news-${meta.appId}`;
  if (source === 'github') return 'notifications';
  return null;
}

export const migrations = [
  (db) => {
    db.exec(`
      CREATE TABLE kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE notifications (
        id          TEXT PRIMARY KEY,
        source      TEXT NOT NULL,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        url         TEXT,
        level       TEXT NOT NULL DEFAULT 'info',
        tags        TEXT NOT NULL DEFAULT '[]',
        created_at  INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        read        INTEGER NOT NULL DEFAULT 0,
        meta        TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX notifications_source ON notifications (source);
      CREATE INDEX notifications_created_at ON notifications (created_at DESC);
      CREATE INDEX notifications_read ON notifications (read);
    `);
  },

  // 2: etiketler metin yerine çeviri anahtarı; dil değişince eski bildirimler de çevrilsin
  (db) => {
    const update = db.prepare('UPDATE notifications SET tags = ? WHERE id = ?');
    for (const row of db.prepare('SELECT id, source, tags FROM notifications').all()) {
      const tags = JSON.parse(row.tags);
      const next = legacyTagsToKeys(row.source, tags);
      if (next.some((tag, i) => tag !== tags[i])) update.run(JSON.stringify(next), row.id);
    }
  },

  // 3: bildirimi üreten kaynak işi (oyun/akış bazında filtre için). Mevcut kayıtlar
  // eklentilerin meta alanından doldurulur; iş kimlikleri eklentilerin sources anahtarlarıdır.
  (db) => {
    db.exec(`
      ALTER TABLE notifications ADD COLUMN job TEXT;
      CREATE INDEX notifications_source_job ON notifications (source, job);

      UPDATE notifications SET job = json_extract(meta, '$.feedId')
        WHERE source = 'rss' AND json_extract(meta, '$.feedId') IS NOT NULL;
      UPDATE notifications SET job = 'news-' || json_extract(meta, '$.appId')
        WHERE source = 'steam' AND json_extract(meta, '$.appId') IS NOT NULL;
      UPDATE notifications SET job = 'notifications' WHERE source = 'github';
    `);
  }
];

// Her migration kendi transaction'ında çalışır; biri hata verirse o sürümde kalınır.
export function migrate(db, list = migrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const from = db.prepare('SELECT version FROM schema_version').get()?.version ?? 0;

  if (from > list.length) {
    throw baseI18n.error('core.storage.newerVersion');
  }

  for (let version = from; version < list.length; version++) {
    db.exec('BEGIN');
    try {
      list[version](db);
      db.exec('DELETE FROM schema_version');
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version + 1);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw baseI18n.error('core.storage.migrationFailed', { version: version + 1, error: err.i18n ?? err.message });
    }
  }

  return { from, to: list.length };
}
