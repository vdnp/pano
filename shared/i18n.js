// Core, main ve arayüzün ortak çeviri modülü (saf JS, Node veya Electron'a bağımlı değil).
// Metin yerine anahtar taşınır; çeviri metni gösteren katmanda yapılır. Böylece dil
// değişince eski hata satırları ve bildirim etiketleri de yeni dilde görünür.

export const LOCALES = ['tr', 'en'];
// Kaynak dil: her anahtar en az Türkçe katalogda bulunur
const BASE_LOCALE = 'tr';
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

const isPlural = (v) =>
  v && typeof v === 'object' && 'other' in v && Object.keys(v).every((k) => PLURAL_FORMS.includes(k));

// İç içe katalog nesnesini noktalı anahtarlara açar: { feed: { empty: 'x' } } → { 'feed.empty': 'x' }
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !isPlural(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Uygulama kataloğu ile eklenti kataloglarını birleştirir; eklenti anahtarları
// eklenti adıyla öneklenir (rss:errors.notFound) ki çakışmasın.
export function mergeCatalogs(app = {}, plugins = {}) {
  const out = {};
  for (const locale of LOCALES) {
    out[locale] = flatten(app[locale]);
    for (const [name, catalogs] of Object.entries(plugins)) {
      for (const [key, value] of Object.entries(flatten(catalogs?.[locale]))) {
        out[locale][`${name}:${key}`] = value;
      }
    }
  }
  return out;
}

// Ayardaki dil ("system" | "tr" | "en") ve işletim sisteminin dil listesinden kullanılacak dil
export function resolveLocale(preference, systemLocales = []) {
  if (LOCALES.includes(preference)) return preference;
  for (const tag of systemLocales) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if (LOCALES.includes(base)) return base;
  }
  return 'en';
}

// {name}, {at, time}, {n, number}, {d, date}; parametresi olmayan yer tutucu olduğu gibi kalır.
// Parametre bir mesaj nesnesiyse ({ key, params }) o da çevrilir (ör. hata içinde hata).
function interpolate(text, params, locale, t) {
  return text.replace(/\{(\w+)(?:,\s*(time|date|number))?\}/g, (match, name, style) => {
    const value = params?.[name];
    if (value === undefined || value === null) return match;
    if (typeof value === 'object') return t(value);
    if (style === 'time') return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    if (style === 'date') return new Date(value).toLocaleDateString(locale);
    if (style === 'number') return Number(value).toLocaleString(locale);
    return String(value);
  });
}

export function createI18n({ locale = BASE_LOCALE, catalogs = {} } = {}) {
  const plural = new Intl.PluralRules(locale);

  function lookup(key) {
    return catalogs[locale]?.[key] ?? catalogs[BASE_LOCALE]?.[key];
  }

  const has = (key) => typeof key === 'string' && lookup(key) !== undefined;

  // message: anahtar, { key, params } nesnesi ya da düz metin. Katalogda olmayan
  // metin olduğu gibi döner; eklentilerin düz Türkçe hataları da böylece gösterilir.
  function t(message, params) {
    if (message == null) return '';
    if (typeof message === 'object') return t(message.key, { ...message.params, ...params });

    let value = lookup(message);
    if (value === undefined) return String(message);
    if (isPlural(value)) value = value[plural.select(Number(params?.count ?? 0))] ?? value.other;
    return interpolate(String(value), params, locale, t);
  }

  // Manifest gibi kendi metni olan yerler için: katalogda varsa çeviri, yoksa verilen metin
  const tOr = (key, fallback, params) => (has(key) ? t(key, params) : fallback);

  // Çevrilebilir hata: mesajı bu dilde, anahtarı err.i18n'de taşır. Hatayı gösteren
  // katman (ör. arayüz) dil değişince anahtardan yeniden çevirebilir.
  function error(key, params) {
    return Object.assign(new Error(t(key, params)), { i18n: { key, params } });
  }

  return { locale, t, tOr, has, error };
}
