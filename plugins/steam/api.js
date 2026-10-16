// Steam'e yapılan tüm istekler buradan geçer; hatalar tek yerde çevrilebilir mesajlara dönüşür.
// Profil ve kütüphane kaynakları da ileride aynı yardımcıyı kullanacak.
// notFound: Steam uygulamayı tanımadığında (403/404) fırlatılacak hatayı üreten fonksiyon
export async function getJson(ctx, url, { notFound } = {}) {
  let res;
  try {
    res = await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Pano' } });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw ctx.error('errors.timeout');
    }
    throw ctx.error('errors.network');
  }

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
