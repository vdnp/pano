import { Readability } from '@mozilla/readability';

// Okuyucu paneli: dış kaynaktan gelen içerik (BBCode, HTML, düz metin) asla doğrudan sayfaya
// basılmaz. Tarayıcının DOMParser'ı ile ayrıştırılır (bu belgede betikler çalışmaz, görsel ve
// diğer kaynaklar yüklenmez) ve yalnızca izin verilen öğelerden oluşan blok modeline çevrilir.
// Modeli React çizer; geri kalan her şey (betik, stil, iframe, form, olay öznitelikleri) atılır.
//
// Blok:   { type: 'paragraph' | 'heading', level?, children: Inline[] }
//         { type: 'list', ordered, items: Inline[][] } | { type: 'quote', children: Block[] }
//         { type: 'code', text } | { type: 'rule' } | { type: 'image', src, alt } | { type: 'video', href }
// Inline: { type: 'text', text, bold?, italic?, code? } | { type: 'link', href, children } | { type: 'break' }

// İçeriğiyle birlikte atılan öğeler
const DROP = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT',
  'TEXTAREA', 'SVG', 'MATH', 'AUDIO', 'CANVAS', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'LINK',
  'META', 'TITLE', 'BASE', 'DIALOG'
]);
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const BLOCKS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE',
  'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD', 'CENTER',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'IMG', ...HEADINGS
]);

// Yalnızca http(s) adresleri; göreli adresler haberin adresine göre çözülür
export function safeUrl(href, base) {
  if (!href) return null;
  try {
    const url = new URL(String(href).trim(), base || undefined);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Steam duyurularındaki görsel yer tutucuları
const STEAM_IMAGE_BASE = 'https://clan.akamai.steamstatic.com/images/';

const BB_SIMPLE = {
  p: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  b: 'strong', i: 'em', u: 'span', s: 'span', strike: 'span', spoiler: 'span', noparse: 'span',
  quote: 'blockquote', code: 'pre', list: 'ul', olist: 'ol', table: 'table', tr: 'tr', td: 'td', th: 'th'
};

// BBCode önce HTML'e çevrilir, sonra HTML ile aynı güvenli yoldan geçer. Metin baştan
// kaçışlandığı için BBCode içindeki ham HTML etiket olarak yorumlanmaz.
export function bbcodeToHtml(source) {
  const unquote = (v) => v.replace(/^(&quot;|')|(&quot;|')$/g, '');
  return escapeHtml(String(source ?? ''))
    .replace(/\\\[/g, '&#91;')
    .replace(/\\\]/g, '&#93;')
    .replace(/\{STEAM_CLAN_(?:LOC_)?IMAGE\}\/?/g, STEAM_IMAGE_BASE)
    .replace(/\[img\s+src=([^\]\s]+)[^\]]*\]\s*\[\/img\]/gi, (_, src) => `<img src="${unquote(src)}">`)
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, src) => `<img src="${src.trim()}">`)
    .replace(/\[previewyoutube=([\w-]+)[^\]]*\]\s*(?:\[\/previewyoutube\])?/gi,
      (_, id) => `<video data-href="https://www.youtube.com/watch?v=${id}"></video>`)
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, href, text) => `<a href="${unquote(href)}">${text}</a>`)
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, href) => `<a href="${href.trim()}">${href}</a>`)
    .replace(/\[\*\]/g, '<li>')
    .replace(/\[\/\*\]/g, '</li>')
    .replace(/\[hr\]\s*(?:\[\/hr\])?/gi, '<hr>')
    // Bilinmeyen etiketler atılır; harfle başlamayanlar ("[1]" gibi dipnotlar) metin kalır
    .replace(/\[(\/?)([a-z][a-z0-9]*)(?:=[^\]]*)?\]/gi, (match, slash, tag) => {
      const html = BB_SIMPLE[tag.toLowerCase()];
      return html ? `<${slash}${html}>` : '';
    })
    .replace(/\n/g, '<br>');
}

const isEmptyInline = (inlines) =>
  inlines.every((n) => (n.type === 'text' && !n.text.trim()) || n.type === 'break');

// Paragraf kenarlarındaki boşluk ve satır sonları atılır
function trimInline(inlines) {
  const out = [...inlines];
  while (out.length && (out[0].type === 'break' || (out[0].type === 'text' && !out[0].text.trim()))) out.shift();
  while (out.length && (out.at(-1).type === 'break' || (out.at(-1).type === 'text' && !out.at(-1).text.trim()))) out.pop();
  if (out[0]?.type === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const last = out.length - 1;
  if (out[last]?.type === 'text') out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, '') };
  return out;
}

function inlineFrom(node, base, marks = {}, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = child.nodeValue.replace(/\s+/g, ' ');
      if (text) out.push({ type: 'text', text, ...marks });
      continue;
    }
    if (child.nodeType !== 1 || DROP.has(child.tagName)) continue;
    const tag = child.tagName;
    if (tag === 'BR') out.push({ type: 'break' });
    else if (tag === 'A') {
      const href = safeUrl(child.getAttribute('href'), base);
      const children = inlineFrom(child, base, marks);
      if (href && !isEmptyInline(children)) out.push({ type: 'link', href, children });
      else out.push(...children);
    } else if (tag === 'B' || tag === 'STRONG') inlineFrom(child, base, { ...marks, bold: true }, out);
    else if (tag === 'I' || tag === 'EM') inlineFrom(child, base, { ...marks, italic: true }, out);
    else if (tag === 'CODE' || tag === 'KBD') inlineFrom(child, base, { ...marks, code: true }, out);
    else if (tag === 'IMG' || tag === 'VIDEO') continue; // satır içinde değil, blok olarak ele alınır
    else {
      // Blok öğe satır içine düşerse (ör. liste maddesinde paragraf) satır sonuyla ayrılır
      if (BLOCKS.has(tag) && out.length) out.push({ type: 'break' });
      inlineFrom(child, base, marks, out);
    }
  }
  return out;
}

function blocksFrom(node, base) {
  const blocks = [];
  let inline = [];

  const flush = () => {
    const children = trimInline(inline);
    if (!isEmptyInline(children)) blocks.push({ type: 'paragraph', children });
    inline = [];
  };

  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      inline.push(...inlineFrom({ childNodes: [child] }, base));
      continue;
    }
    if (child.nodeType !== 1 || DROP.has(child.tagName)) continue;
    const tag = child.tagName;

    if (!BLOCKS.has(tag) && tag !== 'VIDEO') {
      inline.push(...inlineFrom({ childNodes: [child] }, base));
      continue;
    }

    flush();
    if (HEADINGS.has(tag)) {
      const children = trimInline(inlineFrom(child, base));
      if (!isEmptyInline(children)) blocks.push({ type: 'heading', level: tag <= 'H2' ? 3 : 4, children });
    } else if (tag === 'UL' || tag === 'OL') {
      const items = [...child.children]
        .filter((li) => li.tagName === 'LI')
        .map((li) => trimInline(inlineFrom(li, base)))
        .filter((item) => !isEmptyInline(item));
      if (items.length) blocks.push({ type: 'list', ordered: tag === 'OL', items });
    } else if (tag === 'BLOCKQUOTE') {
      const children = blocksFrom(child, base);
      if (children.length) blocks.push({ type: 'quote', children });
    } else if (tag === 'PRE') {
      const text = child.textContent.replace(/^\n+|\s+$/g, '');
      if (text) blocks.push({ type: 'code', text });
    } else if (tag === 'HR') {
      blocks.push({ type: 'rule' });
    } else if (tag === 'IMG') {
      const src = safeUrl(child.getAttribute('src'), base);
      if (src) blocks.push({ type: 'image', src, alt: (child.getAttribute('alt') ?? '').trim() });
    } else if (tag === 'VIDEO') {
      // Yalnızca BBCode'daki YouTube önizlemesi (data-href); sitelerin kendi video öğeleri atlanır
      const href = safeUrl(child.getAttribute('data-href'), base);
      if (href) blocks.push({ type: 'video', href });
    } else {
      // Kapsayıcı (p, div, td ...): içindekiler ayrı bloklar olur
      blocks.push(...blocksFrom(child, base));
    }
  }
  flush();
  return blocks;
}

function htmlToBlocks(html, base) {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  return blocksFrom(doc.body, base);
}

function textToBlocks(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({
      type: 'paragraph',
      children: part.split('\n').flatMap((line, i) => (i ? [{ type: 'break' }] : []).concat({ type: 'text', text: line }))
    }));
}

const MIN_ARTICLE_CHARS = 200;
const BOILERPLATE_MAX_CHARS = 1000;
const BOILERPLATE_LINK_RATIO = 0.3;

// İçeriği JavaScript ile yükleyen sayfalarda (ör. Steam topluluk) indirilen HTML'de yalnızca alt
// bilgi kalır ve Readability onu makale sanar: "© ... Gizlilik Politikası | Yasal Bilgi | Çerezler".
// Kısa ve metninin önemli kısmı bağlantı olan sonuç makale sayılmaz (önbelleğe de yazılmaz).
function looksLikeBoilerplate(html) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const total = body.textContent.replace(/\s+/g, ' ').trim().length;
  if (total >= BOILERPLATE_MAX_CHARS) return false;
  const linked = [...body.querySelectorAll('a')].reduce(
    (sum, a) => sum + a.textContent.replace(/\s+/g, ' ').trim().length, 0
  );
  return total === 0 || linked / total > BOILERPLATE_LINK_RATIO;
}

// Bloklardaki okunur metnin uzunluğu. Bazı akışlar açıklamaya yalnızca bir bağlantı koyar
// (ör. Hacker News'te "Comments"); bu kadar kısa içerikte okuyucu "Tam metni getir"i de sunar.
export function blocksTextLength(blocks) {
  const inline = (nodes) => nodes.reduce((sum, n) => sum + (n.text?.length ?? 0) + (n.children ? inline(n.children) : 0), 0);
  return blocks.reduce((sum, b) => {
    if (b.children && b.type !== 'quote') return sum + inline(b.children);
    if (b.type === 'quote') return sum + blocksTextLength(b.children);
    if (b.type === 'list') return sum + b.items.reduce((s, item) => s + inline(item), 0);
    if (b.type === 'code') return sum + b.text.length;
    return sum;
  }, 0);
}

export const isThinContent = (blocks) => blocksTextLength(blocks) < MIN_ARTICLE_CHARS;

// "Tam metni getir": indirilen sayfadan makale gövdesi çıkarılır (Mozilla Readability; menü,
// reklam, yorum gibi kısımlar atılır). Sonuç yine contentToBlocks'tan geçer, yani Readability'nin
// HTML'i de doğrudan basılmaz. Makale bulunamazsa null.
export function extractArticle(html, url) {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  // Readability göreli adresleri belgenin adresine göre mutlak yapar
  const base = doc.createElement('base');
  base.setAttribute('href', url);
  doc.head.prepend(base);
  const article = new Readability(doc, { charThreshold: MIN_ARTICLE_CHARS }).parse();
  // Readability menü gibi kısa parçaları da "makale" sayabilir; okunacak bir metin yoksa çıkarma başarısız
  if (!article?.content || (article.textContent ?? '').trim().length < MIN_ARTICLE_CHARS) return null;
  if (looksLikeBoilerplate(article.content)) return null;
  return {
    title: article.title ?? '',
    byline: article.byline ?? '',
    content: { format: 'html', body: article.content }
  };
}

// content: { format: 'bbcode' | 'html' | 'text', body }; base: göreli bağlantılar için haberin adresi
export function contentToBlocks(content, base) {
  if (!content?.body) return [];
  if (content.format === 'text') return textToBlocks(content.body);
  if (content.format === 'bbcode') return htmlToBlocks(bbcodeToHtml(content.body), base);
  return htmlToBlocks(content.body, base);
}
