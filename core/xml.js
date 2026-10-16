import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { baseI18n } from '../locales/index.js';

// Öznitelikler "@_" önekiyle, metin + öznitelik taşıyan düğümlerin metni "#text" ile gelir.
// Ad alanı önekleri atılır (atom:link → link). Değerler sayıya çevrilmez, metin kalır.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true
});

function xmlError(key, params, extra = {}) {
  return Object.assign(baseI18n.error(key, params), extra);
}

// Eklentilere ctx.parseXml olarak verilir. Hata nesnesinde code ('XML_INVALID',
// 'XML_ENTITY'), varsa line ve çeviri anahtarı (err.i18n) bulunur.
export function parseXml(text) {
  const source = String(text ?? '');

  // Varlık tanımları küçük bir belgeyi bellekte devasa boyuta şişirebilir;
  // akış biçimleri bunlara ihtiyaç duymaz.
  if (/<!ENTITY/i.test(source)) {
    throw xmlError('core.xml.entity', {}, { code: 'XML_ENTITY' });
  }

  const result = XMLValidator.validate(source);
  if (result !== true) {
    const { line, msg } = result.err;
    throw xmlError('core.xml.invalid', { line, detail: msg }, { code: 'XML_INVALID', line });
  }

  return parser.parse(source);
}
