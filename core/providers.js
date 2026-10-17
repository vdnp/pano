// providers: istek üzerine veri (bildirim değil, "durum") döndüren eklenti fonksiyonları.
// Sonuç ttl süresince depoda önbelleğe alınır (uygulama yeniden açılınca da geçerli); aynı anda
// gelen aynı istekler tek get çağrısında birleşir. Hata olursa eldeki eski veri "stale" döner.

export const DEFAULT_TTL = 300;
const MIN_TTL = 10;
const MAX_VALUE_BYTES = 256 * 1024;
const MAX_ROWS = 200;

// Parametrelerin anahtar sırasından bağımsız, kararlı metin hali: { b: 1, a: 2 } ile { a: 2, b: 1 } aynı
export function stableKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableKey(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function ttlOf(provider) {
  const ttl = Number(provider?.ttl);
  return Number.isFinite(ttl) ? Math.max(MIN_TTL, ttl) : DEFAULT_TTL;
}

// error(key, params): çevrilebilir hata (core'un i18n.error'u)
export function createProviderCache({ storage, error, now = () => Date.now() }) {
  const inflight = new Map();

  // { plugin, id, provider, ctx, params, force } → { data, fetchedAt, stale, error? }
  async function get({ plugin, id, provider, ctx, params = {}, force = false }) {
    const key = `${plugin}/${id}/${stableKey(params)}`;
    const cached = storage.providerCache.get(key, now());
    if (!force && cached && cached.expiresAt > now()) {
      return { data: cached.value, fetchedAt: cached.fetchedAt, stale: false };
    }
    // Yenile dahil: zaten süren bir istek varsa onun sonucu beklenir
    if (inflight.has(key)) return inflight.get(key);

    const request = (async () => {
      try {
        const value = await provider.get(ctx, params);
        // JSON'a çevrilemeyen ya da çok büyük sonuç saklanmaz; arayüze de yalnızca düz veri gider
        let json;
        try {
          json = JSON.stringify(value ?? null);
        } catch {
          throw error('core.widgets.badData');
        }
        if (Buffer.byteLength(json) > MAX_VALUE_BYTES) throw error('core.widgets.tooLarge');
        const fetchedAt = now();
        storage.providerCache.set(key, json, fetchedAt, fetchedAt + ttlOf(provider) * 1000);
        storage.providerCache.prune(MAX_ROWS);
        return { data: JSON.parse(json), fetchedAt, stale: false };
      } catch (err) {
        if (cached) return { data: cached.value, fetchedAt: cached.fetchedAt, stale: true, error: err };
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, request);
    return request;
  }

  return { get };
}
