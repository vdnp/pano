// İlk eklenen akışta geçmişteki girişler bildirim olarak yağmasın
const FIRST_RUN_LIMIT = 5;
// Görülen kimlikler son yanıttaki girişlerden oluşur; çok büyük akışlarda sınırlanır
const MAX_SEEN = 1000;

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Düğüm metnini düz metne çevirir: CDATA/HTML etiketleri ve fazla boşluk atılır
function text(v) {
  if (v == null) return '';
  if (typeof v === 'object') return text(v['#text']);
  return String(v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function parseDate(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// FNV-1a: eklentiler node:crypto'ya erişemez; kimlik için kriptografik güç gerekmez.
// Adres aynı kaldıkça kimlik de aynı kalır, böylece ad değişince durum korunur.
export function feedId(url) {
  let normalized = url.trim();
  try {
    normalized = new URL(normalized).href;
  } catch { /* geçersiz adres olduğu gibi kullanılır, hatayı run verir */ }

  let hash = 0x811c9dc5;
  for (const ch of normalized) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `feed-${hash.toString(16).padStart(8, '0')}`;
}

// RSS'te <link> metindir; atom:link ile karışırsa dizi gelebilir
function rssLink(link) {
  const links = asArray(link);
  const plain = links.find((l) => typeof l === 'string');
  return plain ?? links.find((l) => l?.['@_href'])?.['@_href'] ?? '';
}

// Atom'da tarayıcıda açılacak adres rel="alternate" (ya da rel'siz) bağlantıdır
function atomLink(link) {
  const links = asArray(link);
  const pick =
    links.find((l) => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate')) ?? links[0];
  return typeof pick === 'string' ? pick : pick?.['@_href'] ?? '';
}

function rssEntry(item, untitled) {
  const link = rssLink(item.link);
  return {
    id: text(item.guid) || link,
    title: text(item.title) || untitled,
    link,
    date: parseDate(text(item.pubDate) || text(item.date))
  };
}

function atomEntry(entry, untitled) {
  const link = atomLink(entry.link);
  return {
    id: text(entry.id) || link,
    title: text(entry.title) || untitled,
    link,
    date: parseDate(text(entry.updated) || text(entry.published))
  };
}

// ctx.parseXml çıktısını ortak biçime çevirir; RSS veya Atom değilse null döner.
// untitled: başlıksız girişe yazılacak metin (uygulama dilinde, ctx.t ile)
export function parseFeed(doc, untitled = '') {
  if (doc?.rss?.channel) {
    const channel = asArray(doc.rss.channel)[0];
    return { title: text(channel.title), entries: asArray(channel.item).map((i) => rssEntry(i, untitled)) };
  }
  if (doc?.feed) {
    return { title: text(doc.feed.title), entries: asArray(doc.feed.entry).map((e) => atomEntry(e, untitled)) };
  }
  return null;
}

const looksLikeHtml = (body) => /^\s*(<!doctype\s+html|<html[\s>])/i.test(body.replace(/^﻿/, ''));

async function download(ctx, url, headers) {
  try {
    const res = await ctx.fetch(url, { headers });
    const body = res.status === 304 || !res.ok ? '' : await res.text();
    return { res, body };
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw ctx.error('errors.timeout');
    }
    throw ctx.error('errors.network');
  }
}

async function checkFeed(ctx, feed) {
  if (!/^https?:\/\//i.test(feed.url)) {
    throw ctx.error('errors.badUrl');
  }

  const stateKey = `feed:${feed.id}`;
  const saved = ctx.state.get(stateKey) ?? {};

  // Değişiklik yoksa sunucu 304 döner ve gövde indirilmez
  const headers = {
    Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    'User-Agent': 'Pano'
  };
  if (saved.etag) headers['If-None-Match'] = saved.etag;
  if (saved.lastModified) headers['If-Modified-Since'] = saved.lastModified;

  const { res, body } = await download(ctx, feed.url, headers);
  if (res.status === 304) return;
  if (res.status === 404 || res.status === 410) {
    throw ctx.error('errors.notFound', { status: res.status });
  }
  if (!res.ok) {
    throw ctx.error('errors.http', { status: res.status });
  }

  if (looksLikeHtml(body)) throw ctx.error('errors.notFeed');

  let doc;
  try {
    doc = ctx.parseXml(body);
  } catch (err) {
    if (err?.code === 'XML_INVALID') throw ctx.error('errors.xmlInvalid', { line: err.line });
    // Core'un hatası (ör. ENTITY) kendi anahtarıyla iç içe taşınır, dil değişince o da çevrilir
    throw ctx.error('errors.unreadable', { reason: err?.i18n ?? err?.message });
  }

  const parsed = parseFeed(doc, ctx.t('untitled'));
  if (!parsed) throw ctx.error('errors.notFeed');

  const entries = parsed.entries.filter((e) => e.id);
  const seen = new Set(saved.seen ?? []);
  let fresh = entries.filter((e) => !seen.has(e.id));
  if (!saved.initialized) {
    // Tarihsiz girişler belge sırasını korur (akışlar çoğunlukla yeniden eskiye sıralıdır)
    fresh = [...fresh].sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, FIRST_RUN_LIMIT);
  }

  const name = feed.name || parsed.title || hostname(feed.url);
  let added = 0;
  for (const entry of fresh) {
    const isNew = ctx.notify({
      // Farklı akışlardaki aynı guid (ör. "1") çakışmasın diye akış kimliğiyle öneklenir
      id: `${feed.id}:${entry.id}`,
      title: entry.title,
      body: name,
      url: entry.link,
      tags: [ctx.key('tag.announcement')],
      createdAt: entry.date ?? undefined,
      meta: { feedId: feed.id, feedUrl: feed.url }
    });
    if (isNew) added++;
  }

  ctx.state.set(stateKey, {
    initialized: true,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    seen: [...new Set(entries.map((e) => e.id))].slice(0, MAX_SEEN)
  });
  if (added) ctx.log(`${name}: ${added} yeni giriş`);
}

export default {
  // Her akış ayrı bir kaynak işi: biri hata verince diğerleri etkilenmez ve
  // sol şeritte hangi akışın sorunlu olduğu görülür.
  sources(settings) {
    const result = {};
    for (const item of settings.feeds ?? []) {
      const url = String(item?.url ?? '').trim();
      if (!url) continue;
      const id = feedId(url);
      if (result[id]) continue; // aynı adres iki kez girildiyse ilki kullanılır

      const feed = { id, url, name: String(item.name ?? '').trim() };
      result[id] = {
        title: feed.name || hostname(url),
        run: (ctx) => checkFeed(ctx, feed)
      };
    }
    return result;
  }
};
