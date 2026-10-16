import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

// Yer tutucu adları ({count}, {at, time} → count, at); çoğul biçimlerin hepsinden toplanır
function placeholders(value) {
  const texts = typeof value === 'object' ? Object.values(value) : [value];
  const names = new Set();
  for (const text of texts) for (const m of String(text).matchAll(/\{(\w+)/g)) names.add(m[1]);
  return [...names].sort();
}

function expectParity(tr, en) {
  const trFlat = flatten(tr);
  const enFlat = flatten(en);
  expect(Object.keys(enFlat).sort()).toEqual(Object.keys(trFlat).sort());
  for (const key of Object.keys(trFlat)) {
    expect({ key, placeholders: placeholders(enFlat[key]) }).toEqual({ key, placeholders: placeholders(trFlat[key]) });
  }
}

describe('çeviri katalogları', () => {
  it('uygulamanın tr ve en katalogları aynı anahtar ve yer tutuculara sahip', () => {
    expectParity(appCatalogs.tr, appCatalogs.en);
  });

  const plugins = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, e.name, 'locales')))
    .map((e) => e.name);

  const read = (name, locale) =>
    JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, name, 'locales', `${locale}.json`), 'utf8'));
  // Manifest metinleri Türkçe kataloğa yazılmaz (manifest zaten kaynak dilde);
  // eşleşme manifest dışındaki anahtarlar için aranır.
  const withoutManifest = ({ manifest, ...rest }) => rest;

  it.each(plugins)('%s eklentisinin tr ve en katalogları eşleşiyor', (name) => {
    expectParity(withoutManifest(read(name, 'tr')), withoutManifest(read(name, 'en')));
  });

  // Manifest'teki her çevrilebilir metnin İngilizce karşılığı olmalı
  function translatablePaths(manifest) {
    const paths = ['displayName', 'description'].filter((k) => manifest[k]);
    for (const k of ['title', 'body', 'action']) if (manifest.setup?.[k]) paths.push(`setup.${k}`);
    const field = (prefix, s) => {
      for (const k of ['label', 'help', 'addLabel', 'placeholder']) if (s[k]) paths.push(`${prefix}.${k}`);
      if (s.suggest?.placeholder) paths.push(`${prefix}.suggest.placeholder`);
      for (const [key, sub] of Object.entries(s.item ?? {})) field(`${prefix}.item.${key}`, sub);
    };
    for (const [key, s] of Object.entries(manifest.settings ?? {})) field(`settings.${key}`, s);
    for (const [key, s] of Object.entries(manifest.secrets ?? {})) field(`secrets.${key}`, s);
    return paths;
  }

  it.each(plugins)('%s eklentisinin manifest metinlerinin İngilizcesi var', (name) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, name, 'manifest.json'), 'utf8'));
    const en = flatten(read(name, 'en').manifest ?? {});
    // displayName dil bağımsız olabilir (ör. "RSS"); yoksa manifest'teki ad kullanılır
    const missing = translatablePaths(manifest).filter((p) => p !== 'displayName' && !(p in en));
    expect(missing).toEqual([]);
  });
});
