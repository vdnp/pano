// Komut paletinin JSX'siz mantığı: bulanık arama, sıralama, parametre adımları, son kullanılanlar.

const fold = (s) => String(s ?? '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Sorgunun harfleri metinde sırayla geçiyorsa puan, geçmiyorsa null. Kelime başı ve ardışık
// eşleşmeler daha çok puan alır; böylece "tkk" → "Tüm kaynakları kontrol et" üstte çıkar.
export function fuzzyScore(query, text) {
  const q = fold(query).replace(/\s+/g, '');
  const s = fold(text);
  if (!q) return 0;
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const i = s.indexOf(ch, from);
    if (i < 0) return null;
    const wordStart = i === 0 || /[\s:/·.-]/.test(s[i - 1]);
    score += 1 + (wordStart ? 6 : 0) + (i === prev + 1 ? 4 : 0);
    prev = i;
    from = i + 1;
  }
  // Kısa metin ve baştan eşleşme biraz öne
  return score - s.length * 0.01 + (s.startsWith(q) ? 5 : 0);
}

// items: [{ id, text }]. Sorgu yoksa son kullanılanlar (kullanım sırasıyla) üstte, kalanı alfabetik;
// sorgu varsa puana göre (eşitlikte son kullanılan önce). { recent, rest } gruplarıyla döner.
export function rankCommands(items, query, recents = []) {
  const recentIndex = new Map(recents.map((id, i) => [id, i]));
  const byRecency = (a, b) => (recentIndex.get(a.id) ?? Infinity) - (recentIndex.get(b.id) ?? Infinity);
  if (!String(query ?? '').trim()) {
    const recent = items.filter((i) => recentIndex.has(i.id)).sort(byRecency);
    const rest = items.filter((i) => !recentIndex.has(i.id)).sort((a, b) => a.text.localeCompare(b.text));
    return { recent, rest };
  }
  const rest = items
    .map((item) => ({ item, score: fuzzyScore(query, item.text) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score - a.score || byRecency(a.item, b.item))
    .map((x) => x.item);
  return { recent: [], rest };
}

export const MAX_RECENTS = 8;
export const pushRecent = (recents, id) => [id, ...recents.filter((x) => x !== id)].slice(0, MAX_RECENTS);

const RECENTS_KEY = 'pano.palette.recent';
export function loadRecents() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((x) => typeof x === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}
export function saveRecents(recents) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    /* saklanamazsa yalnızca bu oturumda geçerli */
  }
}

// Komut ve parametre metinleri katalog anahtarı olabilir: uygulama komutu (pano/…) uygulama
// kataloğunda, eklenti komutu eklentinin kataloğunda (steam:commands.x)
export const commandText = (i18n, plugin, value, fallback = '') =>
  !value ? fallback : plugin === 'pano' ? i18n.tOr(value, value) : i18n.tOr(`${plugin}:${value}`, value);

// Sorulacak parametreler: önceden doldurulmuşlar (öneriyle ya da geçmişten) atlanır.
// Liste türü paletten sorulmaz; zorunlu liste varsa komut paletten çalıştırılamaz.
export function paramSteps(command, filled = {}) {
  const entries = Object.entries(command.params ?? {});
  if (entries.some(([, s]) => s.type === 'list' && s.required)) return { unsupported: true, steps: [] };
  const steps = entries
    .filter(([key, s]) => s.type !== 'list' && (filled[key] === undefined || filled[key] === ''))
    .map(([key]) => key);
  return { unsupported: false, steps };
}

// Geçmişten tekrar: gizli parametre geçmişte yoktur, eksik zorunlu alan da sorulmalıdır
export function needsInput(command, params = {}) {
  return Object.entries(command.params ?? {}).some(
    ([key, s]) => s.secret || (s.required && s.type !== 'list' && (params[key] === undefined || params[key] === ''))
  );
}

// Paletteki tek adımın girdisini parametre değerine çevirir; { value } ya da { error }
export function readStepValue(schema, raw) {
  const text = String(raw ?? '').trim();
  if (schema.type === 'boolean') return { value: raw === true || raw === 'true' };
  if (!text) return schema.required ? { error: 'missing' } : { value: undefined };
  if (schema.type === 'number') {
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return { error: 'notNumber' };
    if ((schema.min != null && n < schema.min) || (schema.max != null && n > schema.max)) return { error: 'outOfRange' };
    return { value: n };
  }
  return { value: text };
}

// Geçmiş satırı için kısa parametre özeti: "appId: 730 · name: CS2"
export const summarizeParams = (params = {}) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && !Array.isArray(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
