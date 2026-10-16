import { describe, expect, it } from 'vitest';
import {
  ALL, filterNotifications, jobsOf, resolveSelection, selectionForNotification, tagSummary, unreadCounts
} from '../../src/renderer/src/lib/filter.js';

const n = (id, source, job, read = false) => ({ id, source, job, read, tags: [] });
const LIST = [
  n('1', 'steam', 'news-730'),
  n('2', 'steam', 'news-359550'),
  n('3', 'steam', 'news-730', true),
  n('4', 'rss', 'feed-aaaa'),
  n('5', 'github', 'notifications'),
  n('6', 'steam', null) // iş bilgisi olmayan eski kayıt
];

const SOURCES = [
  { name: 'steam', jobs: [{ key: 'steam/news-730', source: 'news-730', title: 'Counter-Strike 2' }, { key: 'steam/news-359550', source: 'news-359550', title: 'Rainbow Six Siege' }] },
  { name: 'rss', jobs: [{ key: 'rss/feed-aaaa', source: 'feed-aaaa', title: 'HN' }] },
  { name: 'github', jobs: [{ key: 'github/notifications', source: 'notifications', title: 'Bildirimler' }] }
];

const ids = (list) => list.map((x) => x.id);

describe('akış filtresi', () => {
  it('tüm kaynaklar, eklenti ve tek bir iş seçimine göre süzer', () => {
    expect(ids(filterNotifications(LIST, ALL))).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ids(filterNotifications(LIST, { source: 'steam', job: null }))).toEqual(['1', '2', '3', '6']);
    expect(ids(filterNotifications(LIST, { source: 'steam', job: 'news-730' }))).toEqual(['1', '3']);
    expect(ids(filterNotifications(LIST, { source: 'steam', job: 'news-730' }, true))).toEqual(['1']);
  });

  it('okunmamışları toplam, eklenti ve iş bazında sayar', () => {
    expect(unreadCounts(LIST)).toEqual({
      total: 5,
      bySource: { steam: 3, rss: 1, github: 1 },
      byJob: { 'steam/news-730': 1, 'steam/news-359550': 1, 'rss/feed-aaaa': 1, 'github/notifications': 1 }
    });
  });

  it('artık olmayan iş ya da eklenti seçiliyse bir üst seviyeye düşer', () => {
    expect(resolveSelection({ source: 'steam', job: 'news-730' }, SOURCES)).toEqual({ source: 'steam', job: 'news-730', tag: null });
    expect(resolveSelection({ source: 'steam', job: 'news-1' }, SOURCES)).toEqual({ source: 'steam', job: null, tag: null });
    expect(resolveSelection({ source: 'silindi', job: 'x' }, SOURCES)).toEqual(ALL);
    expect(resolveSelection(null, SOURCES)).toEqual(ALL);
  });

  it('kaynak çipi bildirimin işine, iş yoksa eklentisine götürür', () => {
    expect(selectionForNotification(LIST[1], SOURCES)).toEqual({ source: 'steam', job: 'news-359550', tag: null });
    expect(selectionForNotification(LIST[5], SOURCES)).toEqual({ source: 'steam', job: null, tag: null });
    expect(selectionForNotification(n('x', 'steam', 'news-silinen'), SOURCES)).toEqual({ source: 'steam', job: null, tag: null });
  });

  it('türe (etikete) göre süzer ve kapsamdaki türleri en sık geçen önce özetler', () => {
    const tagged = [
      { id: 'a', source: 'steam', job: 'news-730', read: false, tags: ['steam:tag.patchNotes'] },
      { id: 'b', source: 'steam', job: 'news-730', read: true, tags: ['steam:tag.patchNotes'] },
      { id: 'c', source: 'steam', job: 'news-359550', read: false, tags: ['steam:tag.announcement'] }
    ];
    expect(ids(filterNotifications(tagged, { source: 'steam', job: null, tag: 'steam:tag.patchNotes' }))).toEqual(['a', 'b']);
    expect(tagSummary(tagged)).toEqual([
      { tag: 'steam:tag.patchNotes', total: 2, unread: 1 },
      { tag: 'steam:tag.announcement', total: 1, unread: 1 }
    ]);
  });

  it('oyun silinince tür seçimi de sıfırlanır', () => {
    expect(resolveSelection({ source: 'steam', job: 'news-1', tag: 'x' }, SOURCES)).toEqual({ source: 'steam', job: null, tag: null });
    expect(resolveSelection({ source: 'steam', job: 'news-730', tag: 'x' }, SOURCES)).toEqual({ source: 'steam', job: 'news-730', tag: 'x' });
  });

  it('eklentinin işlerini kimlik ve başlıkla verir', () => {
    expect(jobsOf(SOURCES[0])).toEqual([
      { id: 'news-730', key: 'steam/news-730', title: 'Counter-Strike 2' },
      { id: 'news-359550', key: 'steam/news-359550', title: 'Rainbow Six Siege' }
    ]);
    expect(jobsOf(undefined)).toEqual([]);
  });
});
