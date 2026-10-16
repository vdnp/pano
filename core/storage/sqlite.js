import { migrate } from './migrations.js';

// Vite 5 'node:sqlite'ı yerleşik modül olarak tanımıyor ve dosya olarak çözmeye
// çalışıyor (hem electron-vite build'inde hem Vitest'te); bu yüzden doğrudan Node'dan alınır.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const toRow = (n) => ({
  id: n.id,
  source: n.source,
  title: n.title,
  body: n.body ?? '',
  url: n.url ?? null,
  level: n.level ?? 'info',
  tags: JSON.stringify(n.tags ?? []),
  created_at: n.createdAt,
  received_at: n.receivedAt ?? n.createdAt,
  read: n.read ? 1 : 0,
  meta: JSON.stringify(n.meta ?? {})
});

const fromRow = (r) => ({
  id: r.id,
  source: r.source,
  title: r.title,
  body: r.body,
  url: r.url,
  level: r.level,
  tags: JSON.parse(r.tags),
  createdAt: r.created_at,
  receivedAt: r.received_at,
  read: r.read === 1,
  meta: JSON.parse(r.meta)
});

// Node'un yerleşik SQLite'ı (node:sqlite). Electron ve test ortamı aynı modülü
// kullandığı için native derleme veya ayrı test adaptörü gerekmez.
// file ':memory:' verilirse veritabanı yalnızca bellekte tutulur (testler için).
export function createSqliteStorage(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  migrate(db);

  // İç içe çağrılırsa dıştaki transaction'a katılır
  function transaction(fn) {
    if (db.isTransaction) return fn();
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const q = {
    kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
    kvSet: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    kvDelete: db.prepare('DELETE FROM kv WHERE key = ?'),
    kvCount: db.prepare('SELECT count(*) AS c FROM kv'),

    has: db.prepare('SELECT 1 FROM notifications WHERE id = ?'),
    insert: db.prepare(`
      INSERT OR IGNORE INTO notifications
        (id, source, title, body, url, level, tags, created_at, received_at, read, meta)
      VALUES
        (:id, :source, :title, :body, :url, :level, :tags, :created_at, :received_at, :read, :meta)`),
    // Aynı createdAt'te sonradan eklenen önce gelir
    list: db.prepare('SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC'),
    count: db.prepare('SELECT count(*) AS c FROM notifications'),
    markRead: db.prepare('UPDATE notifications SET read = 1 WHERE id = ?'),
    markAllRead: db.prepare('UPDATE notifications SET read = 1'),
    markSourceRead: db.prepare('UPDATE notifications SET read = 1 WHERE source = ?'),
    clear: db.prepare('DELETE FROM notifications'),
    clearSource: db.prepare('DELETE FROM notifications WHERE source = ?'),
    prune: db.prepare(`
      DELETE FROM notifications WHERE rowid IN (
        SELECT rowid FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
      )`)
  };

  return {
    transaction,

    // Ayarlar, eklenti durumu, gizli alanlar ve uygulama ayarları: JSON değerli anahtarlar
    kv: {
      get(key) {
        const row = q.kvGet.get(key);
        return row ? JSON.parse(row.value) : undefined;
      },
      set(key, value) {
        if (value === undefined) q.kvDelete.run(key);
        else q.kvSet.run(key, JSON.stringify(value));
      }
    },

    notifications: {
      has: (id) => Boolean(q.has.get(id)),
      // Kayıt eklendiyse true; aynı id zaten varsa false
      insert: (item) => q.insert.run(toRow(item)).changes > 0,
      list: () => q.list.all().map(fromRow),
      markRead: (id) => q.markRead.run(id),
      markAllRead: (source) => (source ? q.markSourceRead.run(source) : q.markAllRead.run()),
      clear: (source) => (source ? q.clearSource.run(source) : q.clear.run()),
      // En yeni max kaydı tutar, gerisini siler
      prune: (max) => q.prune.run(max)
    },

    isEmpty: () => q.kvCount.get().c === 0 && q.count.get().c === 0,

    close() {
      if (db.isOpen) db.close();
    }
  };
}
