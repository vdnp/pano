import { describe, expect, it } from 'vitest';
import { createI18n, flatten, mergeCatalogs, resolveLocale } from '../../shared/i18n.js';

const catalogs = mergeCatalogs(
  {
    tr: {
      feed: { title: 'Bildirimler', unread: { one: '{count} okunmamış', other: '{count} okunmamış' } },
      only: { tr: 'Yalnızca Türkçe' },
      greet: 'Merhaba {name}, {missing}',
      at: 'Saat {when, time}',
      wrap: 'Okunamadı: {reason}'
    },
    en: {
      feed: { title: 'Notifications', unread: { one: '{count} unread item', other: '{count} unread items' } },
      greet: 'Hello {name}, {missing}',
      at: 'At {when, time}',
      wrap: 'Unreadable: {reason}'
    }
  },
  {
    rss: { tr: { errors: { notFound: 'Akış bulunamadı ({status})' } }, en: { errors: { notFound: 'Feed not found ({status})' } } }
  }
);

describe('i18n', () => {
  it('iç içe katalogları noktalı anahtarlara açar, çoğul nesnelerini korur', () => {
    expect(flatten({ a: { b: 'x', c: { one: '1', other: 'n' } } })).toEqual({ 'a.b': 'x', 'a.c': { one: '1', other: 'n' } });
  });

  it('anahtarı seçili dilde çevirir', () => {
    expect(createI18n({ locale: 'en', catalogs }).t('feed.title')).toBe('Notifications');
    expect(createI18n({ locale: 'tr', catalogs }).t('feed.title')).toBe('Bildirimler');
  });

  it('eksik anahtarda Türkçeye, o da yoksa metnin kendisine düşer', () => {
    const { t } = createI18n({ locale: 'en', catalogs });
    expect(t('only.tr')).toBe('Yalnızca Türkçe');
    expect(t('Düz bir hata mesajı')).toBe('Düz bir hata mesajı');
    expect(t(null)).toBe('');
  });

  it('yer tutucuları doldurur, verilmeyenleri olduğu gibi bırakır', () => {
    expect(createI18n({ locale: 'en', catalogs }).t('greet', { name: 'Enes' })).toBe('Hello Enes, {missing}');
  });

  it('çoğul halini dile göre seçer', () => {
    const en = createI18n({ locale: 'en', catalogs });
    expect(en.t('feed.unread', { count: 1 })).toBe('1 unread item');
    expect(en.t('feed.unread', { count: 3 })).toBe('3 unread items');
    expect(createI18n({ locale: 'tr', catalogs }).t('feed.unread', { count: 3 })).toBe('3 okunmamış');
  });

  it('saati dilin biçimiyle yazar', () => {
    const when = new Date(2026, 0, 15, 14, 5).getTime();
    expect(createI18n({ locale: 'tr', catalogs }).t('at', { when })).toBe('Saat 14:05');
    expect(createI18n({ locale: 'en', catalogs }).t('at', { when })).toMatch(/^At 0?2:05\sPM$/);
  });

  it('eklenti anahtarlarını önekle ayırır ve mesaj nesnelerini çevirir', () => {
    const { t } = createI18n({ locale: 'en', catalogs });
    expect(t({ key: 'rss:errors.notFound', params: { status: 404 } })).toBe('Feed not found (404)');
    // Parametre olarak verilen mesaj nesnesi de çevrilir
    expect(t('wrap', { reason: { key: 'rss:errors.notFound', params: { status: 410 } } })).toBe('Unreadable: Feed not found (410)');
    expect(t('errors.notFound')).toBe('errors.notFound');
  });

  it('tOr katalogda yoksa verilen metni kullanır', () => {
    const { tOr } = createI18n({ locale: 'en', catalogs });
    expect(tOr('feed.title', 'yedek')).toBe('Notifications');
    expect(tOr('rss:manifest.displayName', 'RSS')).toBe('RSS');
  });

  it('error mesajı seçili dilde, anahtarı err.i18n\'de taşır', () => {
    const err = createI18n({ locale: 'en', catalogs }).error('rss:errors.notFound', { status: 404 });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Feed not found (404)');
    expect(err.i18n).toEqual({ key: 'rss:errors.notFound', params: { status: 404 } });
  });

  it('dili ayardan ya da sistem dil listesinden belirler', () => {
    expect(resolveLocale('en', ['tr-TR'])).toBe('en');
    expect(resolveLocale('system', ['tr-TR', 'en-US'])).toBe('tr');
    expect(resolveLocale('system', ['de-DE', 'en-GB'])).toBe('en');
    expect(resolveLocale('system', ['de-DE'])).toBe('en');
    expect(resolveLocale('system', [])).toBe('en');
  });
});
