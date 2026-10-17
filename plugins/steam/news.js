import { getJson } from './api.js';

// Resmî belge: https://partner.steamgames.com/doc/webapi/ISteamNews (anahtar gerekmez).
// Yanıt alanları ve "tags" belgelenmemiştir; gerçek yanıtlarda yama notları
// tags dizisindeki "patchnotes" değeriyle işaretlidir (her yama notu etiketli değildir).
const NEWS_API = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/';
const OFFICIAL_FEED = 'steam_community_announcements';
const COUNT = 10;
// İlk eklenen oyunda geçmiş haberler bildirim olarak yağmasın
const FIRST_RUN_LIMIT = 3;
const EXCERPT_LENGTH = 200;

// Adı girilmemiş oyun için uygulama dilinde yedek ad (ctx yoksa dil bağımsız biçim)
export const gameName = (game, ctx) =>
  game.name || (ctx ? ctx.t('unknownApp', { appId: game.appId }) : `App ${game.appId}`);

// Haber türü; sıralı kurallar, ilk tutan kazanır. Steam'in patchnotes etiketi her yayıncıda
// yok (ör. Rainbow Six), bu yüzden başlığa da bakılır. Türler akışta çip olarak süzülür.
export function newsType(item) {
  const title = String(item?.title ?? '');
  const tagged = Array.isArray(item?.tags) && item.tags.includes('patchnotes');
  if (tagged || /patch\s*notes/i.test(title)) return 'patchNotes';
  if (/hot[\s-]*fix/i.test(title)) return 'hotfix';
  if (/\bupdate\b/i.test(title)) return 'update';
  return 'announcement';
}

export const isPatchNote = (item) => newsType(item) === 'patchNotes';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
  });
}

// Resmî duyurular BBCode, basın haberleri HTML taşır; ikisi de düz metne çevrilir.
// Steam metindeki gerçek köşeli parantezleri "\[" olarak kaçışlar; onlar korunur.
export function cleanText(raw) {
  const text = String(raw ?? '')
    .replace(/\\\[/g, '\u0001')
    .replace(/\\\]/g, '\u0002')
    .replace(/\[(img|previewyoutube|video)\b[^\]]*\][\s\S]*?\[\/\1\]/gi, ' ')
    .replace(/\[(img|previewyoutube|video)\b[^\]]*\]/gi, ' ')
    // Satır içi biçim etiketleri iz bırakmaz ("[b]kalın[/b]." → "kalın."), bloklar boşluğa döner
    .replace(/\[\/?(b|i|u|s|strike|spoiler|noparse|url)(=[^\]]*)?\]/gi, '')
    .replace(/\[\/?[a-z*][^\]]*\]/gi, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(a|b|i|u|s|em|strong|span|code)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{STEAM_[A-Z_]+\}\S*/g, ' ')
    .replace(/\u0001/g, '[')
    .replace(/\u0002/g, ']');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

// En fazla 200 karakter; kelime ortasında kesilmez
export function excerpt(text, max = EXCERPT_LENGTH) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`;
}

export function toNotification(item, game, ctx) {
  const date = Number(item.date) * 1000;
  return {
    id: String(item.gid),
    title: cleanText(item.title) || ctx.t('untitled'),
    body: gameName(game, ctx),
    url: item.url,
    tags: [ctx.key(`tag.${newsType(item)}`)],
    createdAt: Number.isFinite(date) && date > 0 ? date : undefined,
    meta: {
      appId: game.appId,
      author: String(item.author ?? ''),
      feedLabel: String(item.feedlabel ?? ''),
      excerpt: excerpt(cleanText(item.contents))
    },
    content: contentOf(item)
  };
}

// Okuyucu paneli için tam metin: resmî duyurular (feed_type 1) BBCode, basın haberleri HTML
const contentOf = (item) => ({ format: item.feed_type === 1 ? 'bbcode' : 'html', body: String(item.contents ?? '') });

// "Tam metni getir" (core'un content katkı alanı): tam metni olmayan eski bildirimler için.
// Steam'in haber sayfası içeriği JavaScript ile yüklediğinden sayfa indirmek işe yaramaz;
// haber API'den tarihine göre bulunur (enddate: bu tarihten öncekiler, en yenisi başta).
export async function newsContent(ctx, notification) {
  const appId = Number(notification.meta?.appId);
  const gid = notification.id.slice(notification.id.indexOf(':') + 1);
  if (!Number.isInteger(appId) || !gid || !Number.isFinite(notification.createdAt)) return null;

  const params = new URLSearchParams({
    appid: String(appId),
    count: '3',
    maxlength: '0',
    enddate: String(Math.floor(notification.createdAt / 1000) + 1)
  });
  const data = await getJson(ctx, `${NEWS_API}?${params}`, {
    notFound: () => ctx.error('errors.noNews', { appId })
  });
  const item = (data?.appnews?.newsitems ?? []).find((n) => String(n?.gid) === gid);
  return item ? contentOf(item) : null;
}

export async function checkNews(ctx, game) {
  const params = new URLSearchParams({ appid: String(game.appId), count: String(COUNT), maxlength: '0' });
  if (ctx.settings.get('officialOnly')) params.set('feeds', OFFICIAL_FEED);
  const query = params.toString();

  const notFound = () => ctx.error('errors.noNews', { appId: game.appId });
  const data = await getJson(ctx, `${NEWS_API}?${query}`, { notFound });
  const items = data?.appnews?.newsitems;
  if (!Array.isArray(items)) throw notFound();

  const stateKey = `news:${game.appId}`;
  const saved = ctx.state.get(stateKey) ?? {};
  // Sorgu değiştiyse (ör. resmî duyuru filtresi açıldı) ilk çalıştırma gibi davranılır
  const firstRun = !saved.initialized || saved.query !== query;
  const seen = new Set(firstRun ? [] : saved.seen ?? []);
  const patchNotesOnly = Boolean(ctx.settings.get('patchNotesOnly'));

  const valid = items.filter((n) => n?.gid != null);
  let fresh = valid.filter((n) => !seen.has(String(n.gid)) && (!patchNotesOnly || isPatchNote(n)));
  if (firstRun) {
    fresh = [...fresh].sort((a, b) => Number(b.date) - Number(a.date)).slice(0, FIRST_RUN_LIMIT);
  }

  let added = 0;
  for (const item of fresh) {
    if (ctx.notify(toNotification(item, game, ctx))) added++;
  }

  // Filtreden önceki tüm haberler görüldü sayılır: yama notu filtresi sonradan
  // kapatılınca eski duyurular bildirim olarak yağmaz.
  ctx.state.set(stateKey, { initialized: true, query, seen: valid.map((n) => String(n.gid)) });
  if (added) ctx.log(`${gameName(game, ctx)}: ${added} yeni haber`);
}
