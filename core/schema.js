// Ayarlar (manifest settings) ve komut parametreleri aynı şema sistemini kullanır:
// number (min/max) | boolean | string | list (item alt şeması). Ayarlarda geçersiz değer
// sessizce düzeltilir (kayıt bozulmasın); komut parametrelerinde kullanıcıya hata söylenir.

export const MAX_LIST_ITEMS = 50;
const MAX_TEXT = 1000;

export const isTextField = (schema) => !['number', 'boolean', 'list'].includes(schema.type);
export const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

// Zorunlu alan boş mu: metinde boşluk, sayıda boş ya da sayıya çevrilemeyen değer
export function missingRequired(raw, [key, s]) {
  if (!s.required) return false;
  if (isBlank(raw[key])) return true;
  return s.type === 'number' && !Number.isFinite(Number(raw[key]));
}

// "list": her öğesi schema.item alt şemasına uyan nesnelerden oluşan liste.
// Kullanıcının hiçbir alanı doldurmadığı (onay kutuları sayılmaz) ya da zorunlu
// (required) alanı boş kalan öğe atılır. Kontrol ham değer üzerinde yapılır ki
// varsayılan değerler boş satırı dolu göstermesin.
export function coerceList(value, schema) {
  if (!Array.isArray(value)) return [];
  // İç içe liste desteklenmez
  const fields = Object.entries(schema.item ?? {}).filter(([, s]) => s.type !== 'list');
  const inputs = fields.filter(([, s]) => s.type !== 'boolean');
  const items = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    if (inputs.length && inputs.every(([key]) => isBlank(raw[key]))) continue;
    if (fields.some((field) => missingRequired(raw, field))) continue;

    const item = {};
    for (const [key, s] of fields) {
      const v = coerce(raw[key] ?? s.default, s);
      item[key] = isTextField(s) ? v.trim() : v;
    }
    items.push(item);
    if (items.length === MAX_LIST_ITEMS) break;
  }
  return items;
}

export function coerce(value, schema) {
  if (schema.type === 'list') return coerceList(value, schema);
  if (schema.type === 'number') {
    let n = Number(value);
    if (!Number.isFinite(n)) n = schema.default ?? 0;
    if (schema.min != null) n = Math.max(schema.min, n);
    if (schema.max != null) n = Math.min(schema.max, n);
    return n;
  }
  // IPC veya elle düzenlenmiş dosyadan "false" metni gelebilir; Boolean("false") true olur
  if (schema.type === 'boolean') return value === 'false' ? false : Boolean(value);
  return String(value ?? '');
}

// Komut parametreleri: şemada olmayan alan atılır, eksik ya da geçersiz alan hata verir.
// fail(code, field, extra): çağıranın çevrilebilir hatası (alan etiketiyle)
export function validateParams(schema = {}, raw = {}, fail) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, s] of Object.entries(schema)) {
    const value = input[key];
    const field = [key, s];
    if (s.type === 'list') {
      const list = coerceList(value, s);
      if (s.required && list.length === 0) throw fail('missing', field);
      out[key] = list;
      continue;
    }
    if (isBlank(value)) {
      if (s.required) throw fail('missing', field);
      if (s.default !== undefined) out[key] = coerce(s.default, s);
      continue;
    }
    if (s.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw fail('notNumber', field);
      if ((s.min != null && n < s.min) || (s.max != null && n > s.max)) {
        throw fail('outOfRange', field, { min: s.min ?? '−∞', max: s.max ?? '∞' });
      }
      out[key] = n;
    } else if (s.type === 'boolean') {
      out[key] = coerce(value, s);
    } else {
      out[key] = String(value).trim().slice(0, MAX_TEXT);
    }
  }
  return out;
}
