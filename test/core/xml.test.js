import { describe, expect, it } from 'vitest';
import { parseXml } from '../../core/xml.js';

describe('parseXml', () => {
  it('öznitelikleri @_ önekiyle, metni olduğu gibi verir ve ad alanı önekini atar', () => {
    const doc = parseXml('<r xmlns:atom="x"><atom:link href="https://a" /><n>007</n><t a="1">metin &amp; &nbsp;son</t></r>');
    expect(doc.r.link).toEqual({ '@_href': 'https://a' });
    expect(doc.r.n).toBe('007'); // sayıya çevrilmez
    expect(doc.r.t).toEqual({ '#text': 'metin &  son', '@_a': '1' });
  });

  it('bozuk XML\'de kod ve satır numarasıyla hata fırlatır', () => {
    try {
      parseXml('<a>\n<b>\n</a>');
      expect.unreachable();
    } catch (err) {
      expect(err.code).toBe('XML_INVALID');
      expect(err.line).toBe(3);
      expect(err.message).toMatch(/^XML bozuk \(satır 3\)/);
    }
  });

  it('ENTITY tanımlarını reddeder', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>'))
      .toThrow(expect.objectContaining({ code: 'XML_ENTITY' }));
  });

  it('eklentiye ctx.parseXml olarak verilir', async () => {
    const { createContext } = await import('../../core/context.js');
    const ctx = createContext('demo', { getSettings: () => ({}), logger: console });
    expect(ctx.parseXml).toBe(parseXml);
  });
});
