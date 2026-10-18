import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationStore } from '../../core/notifications.js';
import { createSqliteStorage } from '../../core/storage/index.js';

const NOW = new Date('2026-01-15T10:00:00Z').getTime();

function setup() {
  const storage = createSqliteStorage(':memory:');
  const bus = new EventEmitter();
  const events = [];
  bus.on('notification:new', (n) => events.push(['new', n.id]));
  bus.on('notifications:changed', () => events.push(['changed']));
  return { storage, bus, events, notifications: createNotificationStore(storage, bus) };
}

const sample = (id, extra = {}) => ({ id, source: 'demo', title: `Başlık ${id}`, ...extra });

describe('notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  describe('şemaya dönüştürme', () => {
    it('alanları ortak şemaya çevirir ve sınırlar', () => {
      const { notifications } = setup();
      notifications.add({
        id: 42,
        source: 'demo',
        title: 'x'.repeat(300),
        body: 'y'.repeat(2000),
        url: 'https://example.com/a',
        level: 'warning',
        tags: ['a', '', null, 'b', 1, 2, 3, 4],
        createdAt: 1000,
        read: true,
        meta: { k: 1 }
      });

      const [n] = notifications.list();
      expect(n).toEqual({
        id: '42',
        source: 'demo',
        title: 'x'.repeat(200),
        body: 'y'.repeat(1000),
        url: 'https://example.com/a',
        level: 'warning',
        tags: ['a', 'b', '1', '2', '3'],
        createdAt: 1000,
        receivedAt: NOW,
        read: false,
        meta: { k: 1 },
        job: null,
        pinned: false
      });
    });

    it('geçersiz değerler için güvenli varsayılanlar kullanır', () => {
      const { notifications } = setup();
      notifications.add(sample('a', {
        url: 'javascript:alert(1)',
        level: 'critical',
        tags: 'etiket',
        createdAt: 'dün',
        meta: 'metin'
      }));

      const [n] = notifications.list();
      expect(n.url).toBeNull();
      expect(n.level).toBe('info');
      expect(n.tags).toEqual([]);
      expect(n.createdAt).toBe(NOW);
      expect(n.meta).toEqual({});
      expect(n.body).toBe('');
    });
  });

  it('aynı id ikinci kez eklenmez', () => {
    const { notifications, events } = setup();
    expect(notifications.add(sample('a'))).toBe(true);
    expect(notifications.add(sample('a', { title: 'Başka' }))).toBe(false);

    expect(notifications.list()).toHaveLength(1);
    expect(notifications.list()[0].title).toBe('Başlık a');
    expect(events.filter(([type]) => type === 'new')).toHaveLength(1);
  });

  it('createdAt değerine göre yeniden eskiye sıralar', () => {
    const { notifications } = setup();
    notifications.add(sample('eski', { createdAt: 1 }));
    notifications.add(sample('yeni', { createdAt: 3 }));
    notifications.add(sample('orta', { createdAt: 2 }));
    expect(notifications.list().map((n) => n.id)).toEqual(['yeni', 'orta', 'eski']);
  });

  describe('500 kayıt sınırı', () => {
    it('en eski kayıtları atar', () => {
      const { notifications } = setup();
      for (let i = 0; i < 505; i++) notifications.add(sample(`n${i}`, { createdAt: i }));

      const list = notifications.list();
      expect(list).toHaveLength(500);
      expect(list[0].id).toBe('n504');
      expect(list.at(-1).id).toBe('n5');
    });

    it('liste doluyken sığmayan eski bildirimi yeni saymaz', () => {
      const { notifications, events } = setup();
      for (let i = 0; i < 500; i++) notifications.add(sample(`n${i}`, { createdAt: 100 + i }));
      events.length = 0;

      expect(notifications.add(sample('cok-eski', { createdAt: 1 }))).toBe(false);
      expect(notifications.list()).toHaveLength(500);
      expect(notifications.list().some((n) => n.id === 'cok-eski')).toBe(false);
      expect(events).toEqual([]);
    });
  });

  describe('okundu ve temizleme', () => {
    function seeded() {
      const ctx = setup();
      ctx.notifications.add(sample('a1', { source: 'a', createdAt: 3 }));
      ctx.notifications.add(sample('a2', { source: 'a', createdAt: 2 }));
      ctx.notifications.add(sample('b1', { source: 'b', createdAt: 1 }));
      ctx.events.length = 0;
      return ctx;
    }
    const readIds = (list) => list.filter((n) => n.read).map((n) => n.id);

    it('markRead yalnızca verilen id\'yi okundu yapar', () => {
      const { notifications, events } = seeded();
      notifications.markRead('a2');
      expect(readIds(notifications.list())).toEqual(['a2']);
      expect(events).toEqual([['changed']]);
    });

    it('markAllRead kaynağa göre veya hepsini okundu yapar', () => {
      const { notifications } = seeded();
      notifications.markAllRead('a');
      expect(readIds(notifications.list())).toEqual(['a1', 'a2']);
      notifications.markAllRead();
      expect(readIds(notifications.list())).toEqual(['a1', 'a2', 'b1']);
    });

    it('clear kaynağa göre veya hepsini siler', () => {
      const { notifications, events } = seeded();
      notifications.clear('a');
      expect(notifications.list().map((n) => n.id)).toEqual(['b1']);
      notifications.clear();
      expect(notifications.list()).toEqual([]);
      expect(events).toEqual([['changed'], ['changed']]);
    });
  });

  describe('tam metin (okuyucu paneli)', () => {
    it('içeriği bildirimden ayrı saklar', () => {
      const { notifications } = setup();
      notifications.add(sample('a', { content: { format: 'bbcode', body: '[p]Merhaba[/p]' } }));
      expect(notifications.content('a')).toEqual({ format: 'bbcode', body: '[p]Merhaba[/p]' });
      expect(notifications.list()[0]).not.toHaveProperty('content');
      expect(notifications.content('yok')).toBeNull();
    });

    it('geçersiz biçimi ve boş metni yok sayar, 200 KB ile sınırlar', () => {
      const { notifications } = setup();
      notifications.add(sample('a', { content: { format: 'pdf', body: 'x' } }));
      notifications.add(sample('b', { content: { format: 'text', body: '   ' } }));
      notifications.add(sample('c', { content: { format: 'html', body: 'x'.repeat(250_000) } }));
      expect(notifications.content('a')).toBeNull();
      expect(notifications.content('b')).toBeNull();
      expect(notifications.content('c').body).toHaveLength(200_000);
    });

    it('bildirim silinince içeriği de silinir', () => {
      const { notifications, storage } = setup();
      notifications.add(sample('a', { source: 'x', content: { format: 'text', body: 'A' } }));
      notifications.add(sample('b', { source: 'y', content: { format: 'text', body: 'B' } }));
      notifications.clear('x');
      expect(storage.contents.get('a')).toBeNull();
      expect(storage.contents.get('b')).toEqual({ format: 'text', body: 'B' });
    });

    it('500 sınırıyla atılan bildirimin içeriği de silinir', () => {
      const { notifications, storage } = setup();
      notifications.add(sample('en-eski', { createdAt: 0, content: { format: 'text', body: 'eski' } }));
      for (let i = 1; i <= 500; i++) notifications.add(sample(`n${i}`, { createdAt: i }));
      expect(notifications.list().some((n) => n.id === 'en-eski')).toBe(false);
      expect(storage.contents.get('en-eski')).toBeNull();
    });

    it('sığmayan eski bildirimin içeriği hiç yazılmaz', () => {
      const { notifications, storage } = setup();
      for (let i = 0; i < 500; i++) notifications.add(sample(`n${i}`, { createdAt: 100 + i }));
      notifications.add(sample('cok-eski', { createdAt: 1, content: { format: 'text', body: 'x' } }));
      expect(storage.contents.get('cok-eski')).toBeNull();
    });
  });

  it('add önce notification:new, sonra notifications:changed yayınlar', () => {
    const { notifications, events } = setup();
    notifications.add(sample('a'));
    expect(events).toEqual([['new', 'a'], ['changed']]);
  });
});
