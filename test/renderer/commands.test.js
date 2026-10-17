import { describe, expect, it } from 'vitest';
import {
  commandText, fuzzyScore, MAX_RECENTS, needsInput, paramSteps, pushRecent, rankCommands, readStepValue, summarizeParams
} from '../../src/renderer/src/lib/commands.js';
import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';

const ITEMS = [
  { id: 'pano/runAll', text: 'Tüm kaynakları kontrol et' },
  { id: 'pano/markAllRead', text: 'Tümünü okundu say' },
  { id: 'steam/launchGame', text: 'Oyunu başlat' },
  { id: 'ui:settings:steam', text: 'Ayarları aç: Steam' }
];

describe('bulanık arama', () => {
  it('harfler sırayla geçmiyorsa eşleşmez; Türkçe karakter ve büyük harf fark etmez', () => {
    expect(fuzzyScore('xyz', 'Oyunu başlat')).toBeNull();
    expect(fuzzyScore('BASLAT', 'Oyunu başlat')).not.toBeNull();
    expect(fuzzyScore('', 'herhangi')).toBe(0);
  });

  it('kelime başı eşleşmeleri öne çıkar', () => {
    const { rest } = rankCommands(ITEMS, 'tkk');
    expect(rest[0].id).toBe('pano/runAll');
    expect(rankCommands(ITEMS, 'ayar steam').rest[0].id).toBe('ui:settings:steam');
    expect(rankCommands(ITEMS, 'okundu').rest.map((i) => i.id)).toEqual(['pano/markAllRead']);
  });

  it('sorgu yokken son kullanılanlar kullanım sırasıyla üstte, kalanı alfabetik', () => {
    const { recent, rest } = rankCommands(ITEMS, '', ['steam/launchGame', 'pano/markAllRead', 'silinmis/komut']);
    expect(recent.map((i) => i.id)).toEqual(['steam/launchGame', 'pano/markAllRead']);
    expect(rest.map((i) => i.text)).toEqual(['Ayarları aç: Steam', 'Tüm kaynakları kontrol et']);
  });

  it('eşit puanda son kullanılan önce gelir', () => {
    const items = [{ id: 'a', text: 'Kontrol et' }, { id: 'b', text: 'Kontrol et' }];
    expect(rankCommands(items, 'kontrol', ['b']).rest.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('son kullanılanlar: başa alır, tekrarı siler, sınırlar', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(Array.from({ length: 20 }, (_, i) => `k${i}`), 'yeni')).toHaveLength(MAX_RECENTS);
  });
});

describe('parametre adımları', () => {
  const cmd = {
    params: {
      appId: { type: 'number', required: true, min: 1 },
      name: { type: 'string' },
      tags: { type: 'list' },
      token: { type: 'string', secret: true }
    }
  };

  it('doldurulmuş alanları ve listeleri atlar; zorunlu liste paletten çalıştırılamaz', () => {
    expect(paramSteps(cmd)).toEqual({ unsupported: false, steps: ['appId', 'name', 'token'] });
    expect(paramSteps(cmd, { appId: 730, name: 'CS' }).steps).toEqual(['token']);
    expect(paramSteps({ params: { l: { type: 'list', required: true } } })).toEqual({ unsupported: true, steps: [] });
    expect(paramSteps({}).steps).toEqual([]);
  });

  it('geçmişten tekrar: gizli ya da eksik zorunlu alan varsa palet sorar', () => {
    expect(needsInput(cmd, { appId: 730 })).toBe(true); // token gizli
    expect(needsInput({ params: { appId: cmd.params.appId } }, { appId: 730 })).toBe(false);
    expect(needsInput({ params: { appId: cmd.params.appId } }, {})).toBe(true);
  });

  it('adım girdisi: sayı (virgüllü), aralık, zorunlu, isteğe bağlı boş ve evet/hayır', () => {
    expect(readStepValue(cmd.params.appId, ' 730 ')).toEqual({ value: 730 });
    expect(readStepValue({ type: 'number' }, '1,5')).toEqual({ value: 1.5 });
    expect(readStepValue(cmd.params.appId, 'abc')).toEqual({ error: 'notNumber' });
    expect(readStepValue(cmd.params.appId, '0')).toEqual({ error: 'outOfRange' });
    expect(readStepValue(cmd.params.appId, '')).toEqual({ error: 'missing' });
    expect(readStepValue(cmd.params.name, '  ')).toEqual({ value: undefined });
    expect(readStepValue({ type: 'boolean' }, true)).toEqual({ value: true });
    expect(readStepValue({ type: 'boolean' }, false)).toEqual({ value: false });
  });

  it('geçmiş satırının parametre özeti', () => {
    expect(summarizeParams({ appId: 730, name: 'CS', empty: '', list: [1] })).toBe('appId: 730 · name: CS');
  });
});

describe('komut metinleri', () => {
  const i18n = createI18n({
    locale: 'tr',
    catalogs: mergeCatalogs(appCatalogs, { steam: { tr: { commands: { launchGame: { title: 'Oyunu başlat' } } } } })
  });

  it('uygulama komutu uygulama kataloğundan, eklenti komutu eklenti kataloğundan; yoksa metnin kendisi', () => {
    expect(commandText(i18n, 'pano', 'core.commands.builtin.runAll')).toBe('Tüm kaynakları kontrol et');
    expect(commandText(i18n, 'steam', 'commands.launchGame.title')).toBe('Oyunu başlat');
    expect(commandText(i18n, 'arac', 'Yankı')).toBe('Yankı');
    expect(commandText(i18n, 'arac', '', 'echo')).toBe('echo');
  });
});
