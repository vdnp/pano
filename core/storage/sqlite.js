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
  meta: JSON.stringify(n.meta ?? {}),
  job: n.job ?? null
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
  meta: JSON.parse(r.meta),
  job: r.job ?? null
});

// Node'un yerleşik SQLite'ı (node:sqlite). Electron ve test ortamı aynı modülü
// kullandığı için native derleme veya ayrı test adaptörü gerekmez.
// file ':memory:' verilirse veritabanı yalnızca bellekte tutulur (testler için).
export function createSqliteStorage(file = ':memory:') {
  const db = new DatabaseSync(file);
  // foreign_keys: bildirim silinince içeriği (contents) de silinsin
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
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
    get: db.prepare('SELECT * FROM notifications WHERE id = ?'),
    insert: db.prepare(`
      INSERT OR IGNORE INTO notifications
        (id, source, title, body, url, level, tags, created_at, received_at, read, meta, job)
      VALUES
        (:id, :source, :title, :body, :url, :level, :tags, :created_at, :received_at, :read, :meta, :job)`),
    // Aynı createdAt'te sonradan eklenen önce gelir
    list: db.prepare('SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC'),
    count: db.prepare('SELECT count(*) AS c FROM notifications'),
    contentGet: db.prepare('SELECT format, body FROM contents WHERE notification_id = ?'),
    cacheGet: db.prepare('SELECT value, fetched_at, expires_at FROM provider_cache WHERE key = ?'),
    cacheTouch: db.prepare('UPDATE provider_cache SET used_at = ? WHERE key = ?'),
    cacheSet: db.prepare(`INSERT INTO provider_cache (key, value, fetched_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at, used_at = excluded.used_at`),
    cachePrune: db.prepare(`DELETE FROM provider_cache WHERE key IN (
      SELECT key FROM provider_cache ORDER BY used_at DESC, rowid DESC LIMIT -1 OFFSET ?)`),
    contentSet: db.prepare(`INSERT INTO contents (notification_id, format, body) VALUES (?, ?, ?)
      ON CONFLICT (notification_id) DO UPDATE SET format = excluded.format, body = excluded.body`),
    historyInsert: db.prepare(`INSERT INTO command_history
        (run_id, command, plugin, title, params, origin, started_at, duration, status, message, error, error_i18n)
      VALUES
        (:run_id, :command, :plugin, :title, :params, :origin, :started_at, :duration, :status, :message, :error, :error_i18n)`),
    historyList: db.prepare('SELECT * FROM command_history ORDER BY started_at DESC, id DESC LIMIT ?'),
    historyPrune: db.prepare(`DELETE FROM command_history WHERE id IN (
      SELECT id FROM command_history ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET ?)`),
    historyClear: db.prepare('DELETE FROM command_history'),
    markRead: db.prepare('UPDATE notifications SET read = 1 WHERE id = ?'),
    markAllRead: db.prepare('UPDATE notifications SET read = 1'),
    markSourceRead: db.prepare('UPDATE notifications SET read = 1 WHERE source = ?'),
    markJobRead: db.prepare('UPDATE notifications SET read = 1 WHERE source = ? AND job = ?'),
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
      get: (id) => {
        const row = q.get.get(id);
        return row ? fromRow(row) : null;
      },
      // Kayıt eklendiyse true; aynı id zaten varsa false
      insert: (item) => q.insert.run(toRow(item)).changes > 0,
      list: () => q.list.all().map(fromRow),
      markRead: (id) => q.markRead.run(id),
      markAllRead: (source, job) =>
        job ? q.markJobRead.run(source, job) : source ? q.markSourceRead.run(source) : q.markAllRead.run(),
      clear: (source) => (source ? q.clearSource.run(source) : q.clear.run()),
      // En yeni max kaydı tutar, gerisini siler
      prune: (max) => q.prune.run(max)
    },

    // providers önbelleği: değer JSON metni olarak saklanır
    providerCache: {
      get(key, now) {
        const row = q.cacheGet.get(key);
        if (!row) return null;
        q.cacheTouch.run(now, key);
        return { value: JSON.parse(row.value), fetchedAt: row.fetched_at, expiresAt: row.expires_at };
      },
      set: (key, json, fetchedAt, expiresAt) => q.cacheSet.run(key, json, fetchedAt, expiresAt, fetchedAt),
      // En son kullanılan max kaydı tutar
      prune: (max) => q.cachePrune.run(max)
    },

    // Okuyucu paneli için haberin tam metni: { format: 'bbcode' | 'html' | 'text', body }
    contents: {
      get: (id) => {
        const row = q.contentGet.get(id);
        return row ? { format: row.format, body: row.body } : null;
      },
      set: (id, content) => q.contentSet.run(id, content.format, content.body)
    },

    // Komut geçmişi: { runId, command, plugin, title, params, origin, startedAt, duration, status, message, error, errorI18n }
    commandHistory: {
      add(r) {
        q.historyInsert.run({
          run_id: r.runId, command: r.command, plugin: r.plugin, title: r.title, params: JSON.stringify(r.params ?? {}),
          origin: r.origin, started_at: r.startedAt, duration: r.duration, status: r.status,
          message: r.message ?? null, error: r.error ?? null, error_i18n: r.errorI18n ? JSON.stringify(r.errorI18n) : null
        });
      },
      list: (limit) => q.historyList.all(limit).map((r) => ({
        id: r.id, runId: r.run_id, command: r.command, plugin: r.plugin, title: r.title, params: JSON.parse(r.params),
        origin: r.origin, startedAt: r.started_at, duration: r.duration, status: r.status,
        message: r.message, error: r.error, errorI18n: r.error_i18n ? JSON.parse(r.error_i18n) : null
      })),
      prune: (max) => q.historyPrune.run(max),
      clear: () => q.historyClear.run()
    },

    isEmpty: () => q.kvCount.get().c === 0 && q.count.get().c === 0,

    close() {
      if (db.isOpen) db.close();
    }
  };
}
