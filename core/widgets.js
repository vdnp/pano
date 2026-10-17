// widgets: eklenti kartın verisini ve görünüm adını verir, arayüz kodu yazmaz. Görünümler
// arayüzde sabit bir settir; map() çıktısı burada görünümün şemasına göre temizlenir ki arayüze
// yalnızca doğrulanmış düz veri gitsin (metinler kırpılır, adresler yalnızca http(s), sayılar sonlu,
// öğe sayıları sınırlı). Şemaya uymayan alanlar atılır.

const text = (v, max = 120) =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '';

const finite = (v) => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? n : null;
};

function url(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const list = (v, max) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x === 'object').slice(0, max);
const TONES = new Set(['ok', 'muted', 'warn']);

const VIEWS = {
  // Birkaç büyük sayı ve etiketi
  stat(d) {
    const items = list(d.items, 6)
      .map((i) => ({ label: text(i.label, 40), value: typeof i.value === 'number' ? (finite(i.value) ?? '') : text(i.value, 24), hint: text(i.hint, 60) }))
      .filter((i) => i.label && i.value !== '');
    return { data: { items }, empty: items.length === 0 };
  },

  // Simge ya da geniş kapak (ör. oyun kapağı) + başlık + alt metin satırları
  list(d) {
    const items = list(d.items, 20)
      .map((i) => ({ icon: url(i.icon), cover: url(i.cover), title: text(i.title, 120), subtitle: text(i.subtitle, 160), meta: text(i.meta, 40), url: url(i.url) }))
      .filter((i) => i.title);
    return { data: { items }, empty: items.length === 0 };
  },

  // Avatar, ad, durum ve birkaç alan
  profile(d) {
    const status = d.status && typeof d.status === 'object' && text(d.status.text, 60)
      ? { text: text(d.status.text, 60), tone: TONES.has(d.status.tone) ? d.status.tone : 'muted' }
      : null;
    const data = {
      avatar: url(d.avatar),
      name: text(d.name, 60),
      status,
      fields: list(d.fields, 8).map((f) => ({ label: text(f.label, 40), value: text(f.value, 80) })).filter((f) => f.label && f.value),
      url: url(d.url)
    };
    return { data, empty: !data.name };
  },

  // İlerleme çubukları (ör. başarımlar); değer 0..max aralığına sıkıştırılır. İsteğe bağlı
  // events: çubuğun altında çubuksuz kısa satırlar (ör. son açılan başarımlar ve tarihi)
  progress(d) {
    const items = list(d.items, 20)
      .map((i) => {
        const max = finite(i.max);
        const value = finite(i.value);
        if (!max || max <= 0 || value === null) return null;
        return { label: text(i.label, 80), value: Math.min(Math.max(value, 0), max), max, hint: text(i.hint, 60) };
      })
      .filter((i) => i && i.label);
    const events = list(d.events, 8)
      .map((e) => ({ label: text(e.label, 80), meta: text(e.meta, 40) }))
      .filter((e) => e.label);
    return { data: { items, events }, empty: items.length === 0 && events.length === 0 };
  }
};

export const WIDGET_VIEWS = Object.keys(VIEWS);
export const isWidgetView = (view) => Object.hasOwn(VIEWS, view);

// map() çıktısını görünümün şemasına göre temizler: { data, empty }
export function sanitizeView(view, data) {
  if (!isWidgetView(view)) throw new Error(`Bilinmeyen kart görünümü: ${view}`);
  return VIEWS[view](data && typeof data === 'object' ? data : {});
}
