import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage, openStorage } from '../../core/storage/index.js';
import { importLegacyJson } from '../../core/storage/legacy-json.js';
import { migrate, migrations } from '../../core/storage/migrations.js';
import { removeDir, silentLogger, tempDir } from '../helpers.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const version = (db) => db.prepare('SELECT version FROM schema_version').get()?.version;
const tables = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
    .all().map((r) => r.name).sort();

describe('migrations', () => {
  it('boş veritabanını son sürüme taşır', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db)).toEqual({ from: 0, to: migrations.length });
    expect(version(db)).toBe(migrations.length);
    expect(tables(db)).toEqual([
      'command_history', 'command_history_started_at', 'contents', 'kv', 'notifications', 'notifications_created_at', 'notifications_read', 'notifications_source',
      'notifications_source_job', 'provider_cache', 'provider_cache_used_at', 'schema_version'
    ]);
  });

  it('ikinci çalıştırmada hiçbir şey yapmaz', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(migrate(db)).toEqual({ from: migrations.length, to: migrations.length });
    expect(db.prepare('SELECT count(*) AS c FROM schema_version').get().c).toBe(1);
  });

  it('yarım kalmış veritabanında yalnızca eksik migration\'ları çalıştırır', () => {
    const db = new DatabaseSync(':memory:');
    const first = vi.fn((d) => d.exec('CREATE TABLE a (x)'));
    const second = vi.fn((d) => d.exec('CREATE TABLE b (x)'));

    migrate(db, [first]);
    expect(migrate(db, [first, second])).toEqual({ from: 1, to: 2 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(version(db)).toBe(2);
  });

  it('hata veren migration geri alınır, sürüm ilerlemez', () => {
    const db = new DatabaseSync(':memory:');
    const broken = (d) => {
      d.exec('CREATE TABLE yarim (x)');
      throw new Error('bozuk');
    };

    expect(() => migrate(db, [(d) => d.exec('CREATE TABLE a (x)'), broken]))
      .toThrow('Veritabanı 2. sürüme güncellenemedi: bozuk');
    expect(version(db)).toBe(1);
    expect(tables(db)).not.toContain('yarim');
  });

  it('daha yeni bir sürümün veritabanını reddeder', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [() => {}, () => {}]);
    expect(() => migrate(db, [() => {}])).toThrow("Pano'yu güncelleyip tekrar aç");
  });
});

describe('migration 2: etiketler çeviri anahtarına', () => {
  function legacyDb(rows) {
    const db = new DatabaseSync(':memory:');
    migrate(db, migrations.slice(0, 1));
    const insert = db.prepare(`INSERT INTO notifications (id, source, title, tags, created_at, received_at)
      VALUES (?, ?, 'T', ?, 1, 1)`);
    for (const [id, source, tags] of rows) insert.run(id, source, JSON.stringify(tags));
    return db;
  }
  const tagsOf = (db, id) => JSON.parse(db.prepare('SELECT tags FROM notifications WHERE id = ?').get(id).tags);

  it('bilinen Türkçe etiketleri kaynağa göre anahtara çevirir, bilinmeyenleri korur', () => {
    const db = legacyDb([
      ['rss:1', 'rss', ['Duyuru']],
      ['steam:1', 'steam', ['Yama notu']],
      ['steam:2', 'steam', ['Duyuru']],
      ['github:1', 'github', ['Pull request', 'İnceleme istendi']],
      ['github:2', 'github', ['YeniTur', 'yeni_sebep']],
      ['diger:1', 'diger', ['Duyuru']]
    ]);
    migrate(db);

    expect(version(db)).toBe(migrations.length);
    expect(tagsOf(db, 'rss:1')).toEqual(['rss:tag.announcement']);
    expect(tagsOf(db, 'steam:1')).toEqual(['steam:tag.patchNotes']);
    expect(tagsOf(db, 'steam:2')).toEqual(['steam:tag.announcement']);
    expect(tagsOf(db, 'github:1')).toEqual(['github:type.PullRequest', 'github:reason.review_requested']);
    expect(tagsOf(db, 'github:2')).toEqual(['YeniTur', 'yeni_sebep']);
    // Başka bir eklentinin aynı metinli etiketi o eklentiye ait değildir
    expect(tagsOf(db, 'diger:1')).toEqual(['Duyuru']);
  });

  it('eşlenen her anahtarın eklenti kataloğunda karşılığı var', async () => {
    const { pluginI18n } = await import('../helpers.js');
    const db = legacyDb([
      ['github:1', 'github', ['Issue', 'Sürüm', 'Tartışma', 'Kontrol', 'Güvenlik', 'Onay istendi', 'CI', 'Takımından bahsedildi']]
    ]);
    migrate(db);
    const i18n = pluginI18n('github', 'en');
    for (const key of tagsOf(db, 'github:1')) expect(i18n.has(key)).toBe(true);
  });
});

describe('migration 3: bildirimin kaynak işi', () => {
  it('mevcut kayıtları eklentilerin meta alanından doldurur', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, migrations.slice(0, 2));
    const insert = db.prepare(`INSERT INTO notifications (id, source, title, meta, created_at, received_at)
      VALUES (?, ?, 'T', ?, 1, 1)`);
    insert.run('rss:1', 'rss', JSON.stringify({ feedId: 'feed-abcd1234' }));
    insert.run('steam:1', 'steam', JSON.stringify({ appId: 730 }));
    insert.run('github:1', 'github', JSON.stringify({ threadId: '9' }));
    insert.run('diger:1', 'diger', JSON.stringify({ appId: 5 }));
    insert.run('steam:2', 'steam', '{}');

    migrate(db);
    const jobs = Object.fromEntries(db.prepare('SELECT id, job FROM notifications').all().map((r) => [r.id, r.job]));
    expect(jobs).toEqual({
      'rss:1': 'feed-abcd1234',
      'steam:1': 'news-730',
      'github:1': 'notifications',
      'diger:1': null,
      'steam:2': null
    });
  });
});

describe('migration 4: Steam haberlerinin yeniden sınıflanması', () => {
  it('başlık kurallarını uygular, Steam etiketli yama notlarını ve diğer kaynakları korur', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, migrations.slice(0, 3));
    const insert = db.prepare(`INSERT INTO notifications (id, source, title, tags, created_at, received_at)
      VALUES (?, ?, ?, ?, 1, 1)`);
    const rows = [
      ['s1', 'steam', 'PATCH NOTES: Y11S3 MID-SEASON UPDATE', ['steam:tag.announcement']],
      ['s2', 'steam', 'Hotfix 1.2', ['steam:tag.announcement']],
      ['s3', 'steam', 'Spring Update', ['steam:tag.announcement']],
      ['s4', 'steam', 'Counter-Strike 2 Update', ['steam:tag.patchNotes']], // Steam etiketli
      ['s5', 'steam', "Doktor's Curse Is Back", ['steam:tag.announcement']],
      ['s6', 'steam', 'Eski biçim', ['Duyuru']], // anahtar değil, dokunulmaz
      ['r1', 'rss', 'Big update', ['rss:tag.announcement']]
    ];
    for (const [id, source, title, tags] of rows) insert.run(id, source, title, JSON.stringify(tags));

    migrate(db);
    const tags = Object.fromEntries(db.prepare('SELECT id, tags FROM notifications').all().map((r) => [r.id, JSON.parse(r.tags)]));
    expect(tags).toEqual({
      s1: ['steam:tag.patchNotes'],
      s2: ['steam:tag.hotfix'],
      s3: ['steam:tag.update'],
      s4: ['steam:tag.patchNotes'],
      s5: ['steam:tag.announcement'],
      s6: ['Duyuru'],
      r1: ['rss:tag.announcement']
    });
  });
});

describe('migration 6: Steam için sayfadan çıkarılmış çöp içerik', () => {
  it('yalnızca Steam bildirimlerinin Readability içeriklerini siler', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, migrations.slice(0, 5));
    const note = db.prepare(`INSERT INTO notifications (id, source, title, created_at, received_at) VALUES (?, ?, 'T', 1, 1)`);
    const content = db.prepare('INSERT INTO contents (notification_id, format, body) VALUES (?, ?, ?)');
    const footer = '<div id="readability-page-1" class="page"><p>© Valve Corporation. Tüm hakları saklıdır.</p></div>';
    note.run('steam:1', 'steam'); content.run('steam:1', 'html', footer);
    note.run('steam:2', 'steam'); content.run('steam:2', 'bbcode', '[p]API metni[/p]');
    note.run('rss:1', 'rss'); content.run('rss:1', 'html', '<div id="readability-page-1"><p>RSS makalesi</p></div>');

    migrate(db);
    const left = db.prepare('SELECT notification_id FROM contents ORDER BY notification_id').all().map((r) => r.notification_id);
    expect(left).toEqual(['rss:1', 'steam:2']);
  });
});

describe('sqlite deposu', () => {
  let dir;
  beforeEach(() => { dir = tempDir('pano-db-'); });
  afterEach(() => removeDir(dir));

  it('kv JSON değerlerini saklar, undefined ile siler', () => {
    const storage = createSqliteStorage();
    storage.kv.set('settings', { github: { interval: 5, flag: true } });
    storage.kv.set('liste', [1, 'iki', null]);
    expect(storage.kv.get('settings')).toEqual({ github: { interval: 5, flag: true } });
    expect(storage.kv.get('liste')).toEqual([1, 'iki', null]);
    expect(storage.kv.get('yok')).toBeUndefined();

    storage.kv.set('liste', undefined);
    expect(storage.kv.get('liste')).toBeUndefined();
  });

  it('transaction hata verirse geri alır', () => {
    const storage = createSqliteStorage();
    expect(() => storage.transaction(() => {
      storage.kv.set('a', 1);
      throw new Error('vazgeç');
    })).toThrow('vazgeç');
    expect(storage.kv.get('a')).toBeUndefined();
  });

  it('dosyaya yazılanlar kapatıp açınca korunur', () => {
    const file = path.join(dir, 'pano.db');
    const first = createSqliteStorage(file);
    first.kv.set('state', { github: { etag: 'x' } });
    first.notifications.insert({
      id: 'github:1', source: 'github', title: 'T', body: '', url: null, level: 'info',
      tags: ['a'], createdAt: 10, receivedAt: 11, read: true, meta: { k: 1 }
    });
    first.close();
    first.close(); // ikinci kapatma sorun çıkarmaz

    const second = createSqliteStorage(file);
    expect(second.kv.get('state')).toEqual({ github: { etag: 'x' } });
    expect(second.notifications.list()).toEqual([{
      id: 'github:1', source: 'github', title: 'T', body: '', url: null, level: 'info',
      tags: ['a'], createdAt: 10, receivedAt: 11, read: true, meta: { k: 1 }, job: null
    }]);
    second.close();
  });
});

describe('pano.json içe aktarma', () => {
  let dir, logger;
  const jsonFile = () => path.join(dir, 'pano.json');

  const LEGACY = {
    notifications: [
      { id: 'github:2', source: 'github', title: 'Yeni', body: 'acme/app', url: 'https://github.com/x',
        level: 'info', tags: ['Issue'], createdAt: 200, receivedAt: 210, read: false, meta: { threadId: '2' } },
      { id: 'github:1', source: 'github', title: 'Eski', body: '', url: null,
        level: 'warning', tags: [], createdAt: 100, receivedAt: 110, read: true, meta: {} },
      { title: 'id yok', source: 'github' }
    ],
    settings: { github: { interval: 15 } },
    state: { github: { lastModified: 'LM' } },
    secrets: { 'github.token': 'enc:abc' },
    app: { openAtLogin: true, pauseNotifications: false }
  };

  beforeEach(() => {
    dir = tempDir('pano-legacy-');
    logger = silentLogger();
  });
  afterEach(() => removeDir(dir));

  it('ilk açılışta her şeyi aktarır ve dosyayı pano.json.yedek yapar', () => {
    fs.writeFileSync(jsonFile(), JSON.stringify(LEGACY));
    const storage = openStorage(dir, logger);

    expect(storage.kv.get('settings')).toEqual(LEGACY.settings);
    expect(storage.kv.get('state')).toEqual(LEGACY.state);
    expect(storage.kv.get('secrets')).toEqual(LEGACY.secrets);
    expect(storage.kv.get('app')).toEqual(LEGACY.app);

    // Okundu bilgisi ve alınma zamanı korunur; id'siz kayıt atlanır
    // Eski Türkçe etiketler çeviri anahtarına dönüşür
    expect(storage.notifications.list()).toEqual([
      { ...LEGACY.notifications[0], tags: ['github:type.Issue'], job: 'notifications' },
      { ...LEGACY.notifications[1], job: 'notifications' }
    ]);

    expect(fs.existsSync(jsonFile())).toBe(false);
    expect(JSON.parse(fs.readFileSync(`${jsonFile()}.yedek`, 'utf8'))).toEqual(LEGACY);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('SQLite\'a aktarıldı'));
    storage.close();
  });

  it('yedek dosyası zaten varsa üzerine yazmaz', () => {
    fs.writeFileSync(`${jsonFile()}.yedek`, 'eski yedek');
    fs.writeFileSync(jsonFile(), JSON.stringify(LEGACY));
    openStorage(dir, logger).close();

    expect(fs.readFileSync(`${jsonFile()}.yedek`, 'utf8')).toBe('eski yedek');
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('pano.json.yedek-'))).toHaveLength(1);
  });

  it('bozuk JSON\'da hiçbir şey yazmaz ve dosyayı yerinde bırakır', () => {
    fs.writeFileSync(jsonFile(), '{ bozuk');
    const storage = openStorage(dir, logger);

    expect(storage.isEmpty()).toBe(true);
    expect(fs.existsSync(jsonFile())).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('içe aktarılamadı'), expect.any(String));
    storage.close();
  });

  it('yarıda hata olursa tamamını geri alır, bir sonraki açılışta tekrar dener', () => {
    fs.writeFileSync(jsonFile(), JSON.stringify(LEGACY));
    const storage = createSqliteStorage(path.join(dir, 'pano.db'));
    const insert = vi.spyOn(storage.notifications, 'insert').mockImplementationOnce(() => {
      throw new Error('disk dolu');
    });

    expect(importLegacyJson(storage, jsonFile(), logger)).toBe(false);
    expect(storage.isEmpty()).toBe(true);
    expect(fs.existsSync(jsonFile())).toBe(true);

    insert.mockRestore();
    expect(importLegacyJson(storage, jsonFile(), logger)).toBe(true);
    expect(storage.notifications.list()).toHaveLength(2);
    storage.close();
  });

  it('veritabanı doluysa aktarmaz ve dosyaya dokunmaz', () => {
    const storage = createSqliteStorage(path.join(dir, 'pano.db'));
    storage.kv.set('settings', { github: { interval: 99 } });
    fs.writeFileSync(jsonFile(), JSON.stringify(LEGACY));

    expect(importLegacyJson(storage, jsonFile(), logger)).toBe(false);
    expect(storage.kv.get('settings')).toEqual({ github: { interval: 99 } });
    expect(fs.existsSync(jsonFile())).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
    storage.close();
  });

  it('500\'den fazla bildirimde en yeni 500\'ü alır', () => {
    const many = Array.from({ length: 520 }, (_, i) => ({ id: `d:${i}`, source: 'd', title: 'T', createdAt: i }));
    fs.writeFileSync(jsonFile(), JSON.stringify({ notifications: many }));
    const storage = openStorage(dir, logger);
    const list = storage.notifications.list();
    expect(list).toHaveLength(500);
    expect(list.at(-1).id).toBe('d:20');
    storage.close();
  });

  it('createCore aktarılan verilerle açılır', async () => {
    fs.writeFileSync(jsonFile(), JSON.stringify(LEGACY));
    const core = createCore({ dataDir: dir, pluginDirs: [], cipher: plainCipher, logger });

    expect(core.notifications.list().map((n) => n.id)).toEqual(['github:2', 'github:1']);
    expect(core.getAppSettings()).toEqual({ ...LEGACY.app, language: 'system' });
    await core.stop();
  });
});
