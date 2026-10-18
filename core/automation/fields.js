// Kuralların kullandığı alan erişimi: koşullar ve {{şablonlar}} aynı yol sözdizimini kullanır.
// Yalnızca nesnenin kendi alanları okunur (prototip zinciri yok); kod çalıştırma yoktur.

import { NOTIFICATION_FIELDS } from '../../shared/automation.js';

export const PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

// "meta.appId" → data.meta.appId; bulunamazsa undefined
export function getPath(data, path) {
  if (!PATH.test(String(path))) return undefined;
  let value = data;
  for (const part of String(path).split('.')) {
    if (FORBIDDEN.has(part) || value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

// Koşul alanları: bildirim şemasının alanları ve meta.* (liste arayüzle ortak)
export { NOTIFICATION_FIELDS };
export const isConditionField = (field) =>
  NOTIFICATION_FIELDS.includes(field) || /^meta\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(String(field)) && String(field).length <= 80;
