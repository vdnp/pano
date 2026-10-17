// Steam'e yapılan tüm istekler buradan geçer; hatalar tek yerde çevrilebilir mesajlara dönüşür.
// Adres (API anahtarı içerebilir) hiçbir hata mesajına ya da loga yazılmaz.

async function send(ctx, url) {
  try {
    return await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Pano' } });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw ctx.error('errors.timeout');
    }
    throw ctx.error('errors.network');
  }
}

// notFound: Steam uygulamayı tanımadığında (403/404) fırlatılacak hatayı üreten fonksiyon
export async function getJson(ctx, url, { notFound } = {}) {
  const res = await send(ctx, url);

  if (res.status === 429) {
    throw ctx.error('errors.rateLimited');
  }
  // Steam olmayan bir uygulama için 403 ve boş gövde döner
  if (notFound && (res.status === 403 || res.status === 404)) throw notFound();
  if (!res.ok) {
    throw ctx.error('errors.http', { status: res.status });
  }

  try {
    return await res.json();
  } catch {
    throw ctx.error('errors.badJson');
  }
}

// Yanıt kodu ve (varsa) JSON gövde birlikte döner; çağıran uç noktaya özgü durumları kendisi
// yorumlar (ör. gizli profilde 403 + { playerstats: { error } }, geçersiz anahtarda 401/403 + HTML)
export async function fetchJson(ctx, url) {
  const res = await send(ctx, url);
  if (res.status === 429) throw ctx.error('errors.rateLimited');
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}
