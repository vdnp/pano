// Sıralı şema değişiklikleri. Dizinin i. elemanı şemayı i'den i+1 sürümüne taşır.
// Yayınlanmış bir migration değiştirilmez; yeni değişiklik için sona eleman eklenir.
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
  }
];

// Her migration kendi transaction'ında çalışır; biri hata verirse o sürümde kalınır.
export function migrate(db, list = migrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const from = db.prepare('SELECT version FROM schema_version').get()?.version ?? 0;

  if (from > list.length) {
    throw new Error("Veritabanı Pano'nun daha yeni bir sürümüyle oluşturulmuş. Pano'yu güncelleyip tekrar aç.");
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
      throw new Error(`Veritabanı ${version + 1}. sürüme güncellenemedi: ${err.message}`);
    }
  }

  return { from, to: list.length };
}
