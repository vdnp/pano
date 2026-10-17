// Panel düzeni: { cards: [{ id, visible }] } (core'un deposunda). Kart tanımları widgets:list'ten gelir.

// Düzen sırasındaki kartlar; düzende olmayan yeni kartlar sona görünür eklenir
export function orderedCards(layout, widgets) {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const out = [];
  for (const c of layout?.cards ?? []) {
    const w = byId.get(c.id);
    if (!w) continue;
    out.push({ ...w, visible: c.visible });
    byId.delete(c.id);
  }
  for (const w of byId.values()) out.push({ ...w, visible: !w.hidden });
  return out;
}

const toLayout = (cards) => ({ cards: cards.map(({ id, visible }) => ({ id, visible })) });

// Kartı bir yukarı (-1) ya da aşağı (+1) taşır; sınırda değişiklik yapmaz
export function moveCard(cards, id, delta) {
  const i = cards.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cards.length) return toLayout(cards);
  const next = [...cards];
  [next[i], next[j]] = [next[j], next[i]];
  return toLayout(next);
}

// Sürükle-bırak: kartı hedef kartın önüne ('before') ya da arkasına ('after') taşır.
// Kendisine ya da bilinmeyen karta bırakılırsa sıra değişmez.
export function dropCard(cards, id, targetId, place = 'before') {
  const card = cards.find((c) => c.id === id);
  if (!card || id === targetId || !cards.some((c) => c.id === targetId)) return toLayout(cards);
  const rest = cards.filter((c) => c.id !== id);
  const at = rest.findIndex((c) => c.id === targetId) + (place === 'after' ? 1 : 0);
  return toLayout([...rest.slice(0, at), card, ...rest.slice(at)]);
}

// Bırakma yeri imlecin kartın hangi yarısında olduğuna göre: ızgarada yatay, listede dikey
export function dropPlace(rect, x, y, horizontal) {
  return horizontal ? (x < rect.left + rect.width / 2 ? 'before' : 'after') : (y < rect.top + rect.height / 2 ? 'before' : 'after');
}

export const setCardVisible = (cards, id, visible) =>
  toLayout(cards.map((c) => (c.id === id ? { ...c, visible } : c)));

// Panelin genişliğine göre sütun sayısı
export function columnsFor(width) {
  if (width >= 1600) return 4;
  if (width >= 1100) return 3;
  if (width >= 600) return 2;
  return 1;
}

// Her kartın kapladığı sütun sayısı. Kartlar seçilen sırada dizilir (sıra hiç değişmez);
// geniş kart 2 sütun kaplar, satırda o kadar yer yoksa satırın kalanını doldurur. Böylece
// satır ortasında boşluk kalmaz (CSS dense ise sırayı bozar).
export function layoutSpans(cards, cols) {
  let used = 0;
  return cards.map((card) => {
    const wanted = card.size === 'wide' ? Math.min(2, cols) : 1;
    const span = Math.min(wanted, cols - used);
    used = (used + span) % cols;
    return span;
  });
}

// Kart başlığı eklentinin kataloğunda bir anahtar olabilir (ör. "widgets.summary"); yoksa metnin kendisi
export const widgetTitle = (i18n, widget) => i18n.tOr(`${widget.plugin}:${widget.title}`, widget.title);
