// Okuyucu paneli için web sayfası ve görsel indirme ("Tam metni getir", görseller).
// Adresler bildirimlerden (dolayısıyla akışlardan) geldiği için:
// - yalnızca http(s), çerez gönderilmez (Electron'da ayrı, bellekte tutulan oturum; Node fetch'te zaten yok);
// - yerel ağ adresleri engellenir (kötü niyetli bir akış Pano'ya modem/iç ağ isteği attırmasın);
// - yönlendirmeler elle izlenir, her adım aynı denetimden geçer; süre ve boyut sınırlıdır.
// Not: DNS ile yerel adrese çözülen alan adları (DNS rebinding) bu denetimle yakalanmaz.

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PAGE_TYPES = ['text/html', 'application/xhtml+xml'];
// SVG içinde betik bulunabilir; okuyucuda yalnızca piksel tabanlı biçimler
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

function isPrivateIPv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(host)) return true;
  if (host.includes(':')) {
    // IPv6: döngü, belirtilmemiş, yerel ve bağlantı yerel aralıklar; IPv4 eşlemeli adresler
    if (host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIPv4(mapped[1]) : false;
  }
  // new URL sayısal biçimleri (2130706433, 0x7f.1) noktalı IPv4'e çevirir
  return isPrivateIPv4(host);
}

// Gövdeyi sınırı aşmadan okur; Content-Length yalan söylese bile akış kesilir
async function readLimited(res, limit, tooLarge) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > limit) throw tooLarge();
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > limit) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const mediaType = (res) => (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

function charsetOf(res) {
  const m = (res.headers.get('content-type') ?? '').match(/charset=([^;]+)/i);
  return m ? m[1].trim().replace(/^"|"$/g, '') : 'utf-8';
}

// error(key, params): çevrilebilir hata üretir (core'un i18n.error'u)
// userAgent: Electron'da uygulamanın gerçek kimliği (Chromium + pano + Electron sürümü). Bazı siteler
// (ör. Cloudflare arkasındakiler) tanımadıkları kimlikleri bot doğrulamasına takıp 403 döndürür.
// followsRedirects: fetchImpl yönlendirmeyi kendisi izler ve her adımı kendi filtresiyle denetler
// (Electron'da ayrı oturumun session.fetch'i; redirect: 'manual' desteklemez). Node fetch'te false.
export function createWebFetcher({ fetchImpl = fetch, error, userAgent = 'Mozilla/5.0 (Pano)', followsRedirects = false }) {
  function checkUrl(raw) {
    let url;
    try {
      url = new URL(String(raw));
    } catch {
      throw error('core.web.badUrl');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw error('core.web.badUrl');
    if (isPrivateHost(url.hostname)) throw error('core.web.blocked');
    return url;
  }

  function networkError(err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return error('core.web.timeout');
    // Electron oturumunun istek filtresi yerel ağa giden adımı (yönlendirme dahil) iptal etti
    if (/ERR_BLOCKED_BY_CLIENT/.test(err?.message ?? '')) return error('core.web.blocked');
    if (/ERR_TOO_MANY_REDIRECTS/.test(err?.message ?? '')) return error('core.web.tooManyRedirects');
    return error('core.web.network');
  }

  async function request(raw, accept) {
    let url = checkUrl(raw);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const headers = { Accept: accept, 'User-Agent': userAgent };

    // Yönlendirmeyi kendisi izleyen fetch (Electron oturumu): her adımı oturumun istek filtresi
    // denetler; burada ayrıca son adres denetlenir
    if (followsRedirects) {
      let res;
      try {
        res = await fetchImpl(url.href, { redirect: 'follow', signal, headers });
      } catch (err) {
        throw networkError(err);
      }
      const finalUrl = checkUrl(res.url || url.href);
      if (!res.ok) throw error('core.web.http', { status: res.status });
      return { res, url: finalUrl };
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res;
      try {
        res = await fetchImpl(url.href, { redirect: 'manual', signal, headers });
      } catch (err) {
        throw networkError(err);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = checkUrl(new URL(res.headers.get('location'), url).href);
        continue;
      }
      if (!res.ok) throw error('core.web.http', { status: res.status });
      return { res, url };
    }
    throw error('core.web.tooManyRedirects');
  }

  // Sayfanın HTML'i ve son adresi (yönlendirme sonrası; göreli bağlantılar buna göre çözülür)
  async function page(raw) {
    const { res, url } = await request(raw, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
    if (!PAGE_TYPES.includes(mediaType(res))) throw error('core.web.notHtml');
    const bytes = await readLimited(res, MAX_PAGE_BYTES, () => error('core.web.tooLarge'));
    let decoder;
    try {
      decoder = new TextDecoder(charsetOf(res));
    } catch {
      decoder = new TextDecoder('utf-8');
    }
    return { url: url.href, html: decoder.decode(bytes) };
  }

  // Görsel data: adresi olarak döner; CSP'ye dokunmadan (img-src data:) gösterilebilir
  async function image(raw) {
    const { res } = await request(raw, IMAGE_TYPES.join(','));
    const type = mediaType(res);
    if (!IMAGE_TYPES.includes(type)) throw error('core.web.notImage');
    const bytes = await readLimited(res, MAX_IMAGE_BYTES, () => error('core.web.tooLarge'));
    return `data:${type};base64,${bytes.toString('base64')}`;
  }

  return { page, image };
}
