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
  },

  // 4: Steam haberleri başlık kurallarıyla yeniden sınıflanır (Rainbow Six gibi patchnotes
  // etiketi koymayan yayıncılar için). Kurallar Ekim 2026'daki plugins/steam/news.js
  // newsType()'ın kopyasıdır; eklenti sonradan değişse de bu migration aynı sonucu verir.
  // Steam'in kendi etiketiyle "Yama notu" olmuş kayıtlar korunur.
  (db) => {
    const typeOf = (title, current) => {
      if (current === 'steam:tag.patchNotes' || /patch\s*notes/i.test(title)) return 'patchNotes';
      if (/hot[\s-]*fix/i.test(title)) return 'hotfix';
      if (/\bupdate\b/i.test(title)) return 'update';
      return 'announcement';
    };
    const update = db.prepare('UPDATE notifications SET tags = ? WHERE id = ?');
    for (const row of db.prepare("SELECT id, title, tags FROM notifications WHERE source = 'steam'").all()) {
      const tags = JSON.parse(row.tags);
      const i = tags.findIndex((tag) => typeof tag === 'string' && tag.startsWith('steam:tag.'));
      if (i < 0) continue;
      const next = [...tags];
      next[i] = `steam:tag.${typeOf(row.title, tags[i])}`;
      if (next[i] !== tags[i]) update.run(JSON.stringify(next), row.id);
    }
  },

  // 5: okuyucu paneli için haberin tam metni. Liste sorgularını ağırlaştırmasın diye ayrı
  // tabloda; bildirim silinince (temizleme, 500 sınırı) içeriği de silinir.
  (db) => {
    db.exec(`
      CREATE TABLE contents (
        notification_id TEXT PRIMARY KEY REFERENCES notifications (id) ON DELETE CASCADE,
        format          TEXT NOT NULL,
        body            TEXT NOT NULL
      );
    `);
  },

  // 6: Steam haber sayfası içeriği JavaScript ile yüklediği için "Tam metni getir" sayfadan yalnızca
  // alt bilgiyi ("© Valve Corporation ... Gizlilik Politikası") çıkarıp önbelleğe yazmıştı. Steam
  // bildirimlerinin sayfadan çıkarılmış (Readability sarmalayıcılı) içerikleri silinir; okuyucu
  // artık metni Steam API'sinden alır. API'den gelen içerik bu sarmalayıcıyı taşımaz, dokunulmaz.
  (db) => {
    db.exec(`
      DELETE FROM contents
        WHERE body LIKE '<div id="readability-page-1"%'
          AND notification_id IN (SELECT id FROM notifications WHERE source = 'steam');
    `);
  },

  // 7: providers önbelleği (kartların verisi). Anahtar eklenti/sağlayıcı/parametreler;
  // ttl dolana kadar geçerli, uygulama yeniden açılınca da kullanılır.
  (db) => {
    db.exec(`
      CREATE TABLE provider_cache (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER NOT NULL
      );
      CREATE INDEX provider_cache_used_at ON provider_cache (used_at);
    `);
  },

  // 8: komut geçmişi. Parametreler gizli alanlar çıkarılmış JSON; title katalog anahtarı
  // olabilir (arayüz eklenti kataloğundan çevirir). En yeni 200 kayıt tutulur.
  (db) => {
    db.exec(`
      CREATE TABLE command_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT NOT NULL,
        command     TEXT NOT NULL,
        plugin      TEXT NOT NULL,
        title       TEXT NOT NULL,
        params      TEXT NOT NULL,
        origin      TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        duration    INTEGER NOT NULL,
        status      TEXT NOT NULL,
        message     TEXT,
        error       TEXT,
        error_i18n  TEXT
      );
      CREATE INDEX command_history_started_at ON command_history (started_at);
    `);
  },

  // 9: otomasyon. Bildirim sabitlenebilir (akışta üstte, 500 sınırında silinmez); komut
  // geçmişinde kaynağın açıklaması (ör. otomasyonun kural adı)
  (db) => {
    db.exec(`
      ALTER TABLE notifications ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE command_history ADD COLUMN origin_label TEXT;
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
