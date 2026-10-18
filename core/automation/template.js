// Eylem parametrelerindeki {{alan.yolu}} yer tutucuları tetikleyen olayın verisinden doldurulur.
// Şablon dili yalnızca alan erişimidir: ifade, fonksiyon ya da filtre yoktur; tanınmayan
// sözdizimi olduğu gibi metin kalır.

import { getPath } from './fields.js';

const TOKEN = /\{\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*\}\}\s*$/;
const MAX_TEXT = 2000;

const asText = (v) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.filter((x) => typeof x !== 'object').join(', ') : typeof v === 'object' ? '' : String(v));

// Değerin tamamı tek yer tutucuysa türü korunur (ör. {{meta.appId}} → 730 sayı); değilse metne gömülür
export function fillValue(value, data) {
  if (typeof value !== 'string') return value;
  const whole = value.match(WHOLE);
  if (whole) {
    const v = getPath(data, whole[1]);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? '' : Array.isArray(v) ? asText(v) : v ?? '';
  }
  return value.replace(TOKEN, (_, path) => asText(getPath(data, path))).slice(0, MAX_TEXT);
}

export function fillParams(params = {}, data = {}) {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, fillValue(v, data)]));
}

// Şablonda geçen alan yolları (düzenleyicide ipucu ve doğrulama için)
export const templatePaths = (value) => (typeof value === 'string' ? [...value.matchAll(TOKEN)].map((m) => m[1]) : []);
