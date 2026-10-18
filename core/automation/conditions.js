// Koşul değerlendirme: { field, op, value } bildirimin alanı üzerinde. Tüm koşullar "ve" ile
// birleşir; "veya" için in kullanılır. Karşılaştırma büyük/küçük harf duyarsızdır.

import { getPath } from './fields.js';
import { OPERATORS } from '../../shared/automation.js';

export { OPERATORS };
export const MAX_PATTERN = 200;
// matches düzenli ifadesi kırpılmış metne uygulanır (aşırı geri izleme riskini sınırlar)
const MAX_SUBJECT = 1000;

// Harf duyarsız karşılaştırma hem Türkçe hem İngilizce metinde tutmalı: tr yerel ayarıyla
// "CI" → "cı" olur ve "ci" ile eşleşmez. Bu yüzden I, İ, ı ve i aynı harf sayılır.
export const norm = (v) =>
  String(v ?? '').trim().replace(/[İIı]/g, 'i').toLowerCase().normalize('NFC');

// Düzenli ifade kayıtta derlenip denenir; burada da derlenemezse koşul tutmaz
export function compilePattern(pattern) {
  const source = String(pattern ?? '');
  if (!source || source.length > MAX_PATTERN) return null;
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

// Alanın karşılaştırılacak değerleri. Etiketler anahtar olarak saklanır (github:reason.mention);
// hem anahtar hem o anki dildeki çevirisi ("Senden bahsedildi") eşleşir.
function candidates(notification, field, translate) {
  const actual = getPath(notification, field);
  if (field === 'tags') {
    const tags = Array.isArray(actual) ? actual : [];
    return { actual: tags, values: tags.flatMap((tag) => [tag, translate?.(tag) ?? tag]) };
  }
  if (Array.isArray(actual)) return { actual, values: actual.filter((v) => v === null || typeof v !== 'object') };
  if (actual !== null && typeof actual === 'object') return { actual, values: [] };
  return { actual, values: actual === undefined ? [] : [actual] };
}

// { ok, actual }; translate(tagKey) → çeviri
export function evaluateCondition(condition, notification, translate) {
  const { field, op, value } = condition;
  const { actual, values } = candidates(notification, field, translate);
  const texts = values.map(norm);
  const expected = Array.isArray(value) ? value.map(norm) : [norm(value)];
  const list = Array.isArray(actual) || field === 'tags';

  let ok;
  switch (op) {
    case 'eq':
      ok = texts.includes(expected[0]);
      break;
    case 'neq':
      ok = !texts.includes(expected[0]);
      break;
    // Metinde parça arama; listede (etiketler) öğe arama
    case 'contains':
      ok = list ? texts.includes(expected[0]) : texts.some((t) => expected[0] !== '' && t.includes(expected[0]));
      break;
    case 'matches': {
      const re = compilePattern(Array.isArray(value) ? value[0] : value);
      // JS'nin i bayrağı Türkçe İ/ı'yı eşlemez; metin ayrıca Türkçe küçük harfle de denenir
      ok = Boolean(re) && values.some((v) => {
        const subject = String(v).slice(0, MAX_SUBJECT);
        return re.test(subject) || re.test(norm(subject));
      });
      break;
    }
    case 'in':
      ok = texts.some((t) => expected.includes(t));
      break;
    default:
      ok = false;
  }
  return { ok, actual: actual === undefined ? null : actual };
}

export function evaluateConditions(conditions, notification, translate) {
  const results = conditions.map((c) => ({ ...c, ...evaluateCondition(c, notification, translate) }));
  return { matched: results.every((r) => r.ok), results };
}
