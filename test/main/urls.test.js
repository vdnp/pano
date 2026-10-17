import { describe, expect, it } from 'vitest';
import { isPluginOpenable, isSteamRunUrl, isWebUrl } from '../../src/main/urls.js';

describe('dışarıda açılacak adresler', () => {
  it('arayüz yalnızca http(s) açar', () => {
    expect(isWebUrl('https://example.com')).toBe(true);
    expect(isWebUrl('http://example.com/a?b')).toBe(true);
    for (const bad of ['steam://rungameid/730', 'file:///C:/Windows', 'javascript:alert(1)', 'ms-settings:', '', null, 'example.com']) {
      expect(isWebUrl(bad)).toBe(false);
    }
  });

  it('Steam: yalnızca tam olarak steam://rungameid/<rakamlar>', () => {
    expect(isSteamRunUrl('steam://rungameid/730')).toBe(true);
    expect(isSteamRunUrl('steam://rungameid/1091500')).toBe(true);
    for (const bad of [
      'steam://rungameid/', 'steam://rungameid/0', 'steam://rungameid/730/', 'steam://rungameid/730?x=1',
      'steam://rungameid/730 -console', 'steam://rungameid/12345678901', 'steam://install/730',
      'steam://open/console', 'STEAM://rungameid/730', 'steam:rungameid/730', 'steam://rungameid/-1'
    ]) {
      expect(isSteamRunUrl(bad)).toBe(false);
    }
  });

  it('eklenti yolu: http(s) + Steam oyun başlatma; başka protokol yok', () => {
    expect(isPluginOpenable('https://store.steampowered.com/app/730/')).toBe(true);
    expect(isPluginOpenable('steam://rungameid/730')).toBe(true);
    expect(isPluginOpenable('steam://open/console')).toBe(false);
    expect(isPluginOpenable('file:///etc/passwd')).toBe(false);
  });
});
