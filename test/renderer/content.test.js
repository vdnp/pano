// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bbcodeToHtml, blocksTextLength, contentToBlocks, extractArticle, isThinContent, safeUrl } from '../../src/renderer/src/lib/content.js';

// happy-dom, DOMParser belgesindeki iframe ve stil bağlantılarını indirmeye çalışır (Chromium'da
// DOMParser belgesi etkisizdir, hiçbir şey yüklemez). Testler ağa çıkmasın diye her istek yanıtlanır.
beforeAll(() => {
  window.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async () => new window.Response('', { status: 204 }),
    beforeSyncRequest: () => ({ status: 204, statusText: 'No Content', headers: new window.Headers(), body: Buffer.alloc(0) })
  };
});

const html = (body, base) => contentToBlocks({ format: 'html', body }, base);
const bb = (body) => contentToBlocks({ format: 'bbcode', body });
const t = (text, marks = {}) => ({ type: 'text', text, ...marks });

// Blok modelinin her yerindeki metinleri toplar (güvenlik testleri için)
const allText = (blocks) => JSON.stringify(blocks);

describe('okuyucu: HTML → blok modeli', () => {
  it('paragraf, başlık, liste, alıntı, kod ve ayırıcıyı tanır', () => {
    expect(html(`
      <h2>Başlık</h2>
      <p>Bir <strong>kalın</strong>, bir <em>italik</em> ve <code>kod</code>.</p>
      <ul><li>Bir</li><li>İki <b>kalın</b></li></ul>
      <ol><li>Sıralı</li></ol>
      <blockquote><p>Alıntı</p></blockquote>
      <pre>  satır 1
satır 2</pre>
      <hr>`)).toEqual([
      { type: 'heading', level: 3, children: [t('Başlık')] },
      { type: 'paragraph', children: [t('Bir '), t('kalın', { bold: true }), t(', bir '), t('italik', { italic: true }), t(' ve '), t('kod', { code: true }), t('.')] },
      { type: 'list', ordered: false, items: [[t('Bir')], [t('İki '), t('kalın', { bold: true })]] },
      { type: 'list', ordered: true, items: [[t('Sıralı')]] },
      { type: 'quote', children: [{ type: 'paragraph', children: [t('Alıntı')] }] },
      { type: 'code', text: '  satır 1\nsatır 2' },
      { type: 'rule' }
    ]);
  });

  it('bağlantıları yalnızca http(s) ise korur, göreli adresi haberin adresine göre çözer', () => {
    expect(html('<p><a href="/yazi/2">göreli</a> <a href="https://x.com">mutlak</a></p>', 'https://blog.example.com/yazi/1')).toEqual([
      { type: 'paragraph', children: [
        { type: 'link', href: 'https://blog.example.com/yazi/2', children: [t('göreli')] },
        t(' '),
        { type: 'link', href: 'https://x.com/', children: [t('mutlak')] }
      ] }
    ]);
  });

  it('görseli blok olarak, yalnızca http(s) kaynağıyla verir', () => {
    expect(html('<p>Önce<img src="https://img.example.com/a.png" alt="Ekran"> sonra</p><img src="data:image/png;base64,AAA">')).toEqual([
      { type: 'paragraph', children: [t('Önce')] },
      { type: 'image', src: 'https://img.example.com/a.png', alt: 'Ekran' },
      { type: 'paragraph', children: [t('sonra')] }
    ]);
  });

  it('tablo hücrelerini ayrı paragraflara açar', () => {
    expect(html('<table><tr><td>A</td><td>B</td></tr></table>')).toEqual([
      { type: 'paragraph', children: [t('A')] },
      { type: 'paragraph', children: [t('B')] }
    ]);
  });

  it('boş öğeleri ve fazla boşlukları atar', () => {
    expect(html('<p>   </p><div><p>\n  metin \n </p></div><p><br></p>')).toEqual([{ type: 'paragraph', children: [t('metin')] }]);
  });
});

describe('okuyucu: güvenlik', () => {
  it('betik, stil, iframe, form ve gömülü nesneleri içeriğiyle atar', () => {
    const blocks = html(`
      <p>güvenli</p>
      <script>alert('xss')</script>
      <style>body { display: none }</style>
      <iframe src="https://evil.example.com"></iframe>
      <object data="x.swf"></object><embed src="x.swf">
      <form action="https://evil.example.com"><input value="gizli"><button>Gönder</button></form>
      <svg><script>alert(1)</script><text>svg metni</text></svg>
      <noscript>noscript metni</noscript>
      <template><p>şablon</p></template>`);
    expect(blocks).toEqual([{ type: 'paragraph', children: [t('güvenli')] }]);
  });

  it('javascript:, data: ve diğer şemalı bağlantıları düz metne çevirir', () => {
    const blocks = html(`<p>
      <a href="javascript:alert(1)">js</a>
      <a href="JaVaScRiPt:alert(1)">karışık</a>
      <a href="  javascript:alert(1)">boşluklu</a>
      <a href="data:text/html,<script>alert(1)</script>">data</a>
      <a href="vbscript:x">vb</a>
      <a href="file:///C:/Windows">dosya</a>
    </p>`);
    expect(allText(blocks)).not.toMatch(/"type":"link"/);
    expect(allText(blocks)).toMatch(/js.*karışık.*boşluklu.*data.*vb.*dosya/);
  });

  it('olay öznitelikleri ve stil modele hiç taşınmaz', () => {
    const blocks = html('<p onclick="alert(1)" style="color:red"><img src="https://x.com/a.png" onerror="alert(1)"><a href="https://x.com" onmouseover="alert(1)">bağlantı</a></p>');
    expect(allText(blocks)).not.toMatch(/alert|onerror|onclick|onmouseover|style/);
  });

  it('iç içe ve bozuk yapılarda da yalnızca metin kalır', () => {
    const blocks = html('<div><p><b><i><a href="javascript:x"><script>alert(1)</script>derin</a></i></b></p></div><p>kapanmamış <b>kalın');
    expect(blocks).toEqual([
      { type: 'paragraph', children: [t('derin', { bold: true, italic: true })] },
      { type: 'paragraph', children: [t('kapanmamış '), t('kalın', { bold: true })] }
    ]);
  });

  it('safeUrl yalnızca http ve https kabul eder', () => {
    expect(safeUrl('https://a.com/x')).toBe('https://a.com/x');
    expect(safeUrl('http://a.com')).toBe('http://a.com/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('/goreli')).toBeNull(); // taban adres yoksa
    expect(safeUrl('')).toBeNull();
  });
});

describe('okuyucu: BBCode', () => {
  it('Steam biçimlerini HTML ile aynı modele çevirir', () => {
    expect(bb('[h2]Başlık[/h2][p]Bir [b]kalın[/b] [url=https://dota2.com]bağlantı[/url].[/p][list][*][p]Madde[/p][/*][/list][hr][/hr]')).toEqual([
      { type: 'heading', level: 3, children: [t('Başlık')] },
      { type: 'paragraph', children: [t('Bir '), t('kalın', { bold: true }), t(' '), { type: 'link', href: 'https://dota2.com/', children: [t('bağlantı')] }, t('.')] },
      { type: 'list', ordered: false, items: [[t('Madde')]] },
      { type: 'rule' }
    ]);
  });

  it('kaçışlı köşeli parantezleri metin olarak korur, harfle başlamayan etiketleri silmez', () => {
    expect(bb('[p]\\[ UI ] Düzeltme [1][/p]')).toEqual([{ type: 'paragraph', children: [t('[ UI ] Düzeltme [1]')] }]);
  });

  it('görsel yer tutucularını çözer, YouTube önizlemesini video bloğu yapar', () => {
    expect(bb('[img src="{STEAM_CLAN_IMAGE}/3703047/a.png"][/img][previewyoutube=abc_123;full][/previewyoutube]')).toEqual([
      { type: 'image', src: 'https://clan.akamai.steamstatic.com/images/3703047/a.png', alt: '' },
      { type: 'video', href: 'https://www.youtube.com/watch?v=abc_123' }
    ]);
  });

  it('BBCode içindeki ham HTML etiket olarak yorumlanmaz', () => {
    expect(bb('[p]<script>alert(1)</script><b>kalın değil</b>[/p]')).toEqual([
      { type: 'paragraph', children: [t('<script>alert(1)</script><b>kalın değil</b>')] }
    ]);
    expect(bbcodeToHtml('<img src=x onerror=alert(1)>')).not.toMatch(/<img/);
  });

  it('[url] içindeki javascript: bağlantısı da düşer', () => {
    expect(allText(bb('[url=javascript:alert(1)]tıkla[/url]'))).not.toMatch(/"type":"link"/);
  });

  it('gerçek bir Steam yama notunu okunur bloklara çevirir', () => {
    const news = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'test/fixtures/steam-news.json'), 'utf8'));
    const blocks = bb(news.appnews.newsitems[0].contents);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'list', 'paragraph', 'list']);
    expect(blocks[0].children).toEqual([t('[ UI ]')]);
    expect(blocks[2].items).toHaveLength(2);
  });
});

describe('okuyucu: tam metni getir (makale çıkarma)', () => {
  const PAGE = `<!doctype html><html><head><title>Yeni sezon duyuruldu | Örnek Haber</title>
    <script>window.track = true</script></head><body>
    <nav><a href="/">Ana sayfa</a> <a href="/oyunlar">Oyunlar</a> <a href="/giris">Giriş yap</a></nav>
    <aside class="ad">REKLAM: Şimdi satın al</aside>
    <article>
      <h1>Yeni sezon duyuruldu</h1>
      <p class="byline">Yazan: Deniz Yılmaz</p>
      <p>Geliştirici ekip, uzun süredir beklenen yeni sezonun önümüzdeki ay başlayacağını açıkladı. Sezonla birlikte
      iki yeni harita, üç yeni karakter ve kapsamlı bir denge güncellemesi geliyor. Ekip ayrıca topluluktan gelen
      geri bildirimler doğrultusunda eşleştirme sisteminde de iyileştirmeler yapıldığını belirtti.</p>
      <p>Ayrıntılı yama notları için <a href="/yama-notlari">bu sayfaya</a> göz atabilirsiniz. Yeni haritaların
      ilk görüntüleri de önümüzdeki hafta yayımlanacak; ekip test sunucularının bu hafta sonu açılacağını söyledi.</p>
    </article>
    <section class="comments"><h2>Yorumlar</h2><p>İlk yorum!</p></section>
    <footer>© Örnek Haber · Gizlilik · Çerezler</footer>
  </body></html>`;

  it('makaleyi çıkarır; menü, reklam, yorum ve betikleri atar', () => {
    const article = extractArticle(PAGE, 'https://haber.example.com/oyun/yeni-sezon');
    expect(article.title).toMatch(/Yeni sezon duyuruldu/);
    const blocks = contentToBlocks(article.content, 'https://haber.example.com/oyun/yeni-sezon');
    const text = allText(blocks);
    expect(text).toMatch(/iki yeni harita/);
    expect(text).toMatch(/test sunucularının/);
    expect(text).not.toMatch(/Giriş yap|REKLAM|İlk yorum|Çerezler|window\.track/);
    // Göreli bağlantı haberin adresine göre çözülür
    expect(text).toMatch(/"href":"https:\/\/haber\.example\.com\/yama-notlari"/);
  });

  it('içeriği JavaScript ile yüklenen sayfada alt bilgiyi makale saymaz (Steam topluluk)', () => {
    // Gerçek olay: indirilen HTML'de haber yok, yalnızca menü, boş uygulama kabı ve alt bilgi var
    const steamPage = `<!doctype html><html><head><title>Steam Topluluğu :: Duyurular</title></head><body>
      <div id="global_header"><a href="/">MAĞAZA</a> <a href="/community">TOPLULUK</a> <a href="/about">HAKKINDA</a> <a href="/support">DESTEK</a></div>
      <div id="application_root" data-loading="true"></div>
      <script>window.SSR = {}; loadAnnouncement();</script>
      <div id="footer"><div class="footer_content">
        <p><img src="https://community.fastly.steamstatic.com/public/shared/images/responsive/footerLogo_valve_new.png"></p>
        <p>© Valve Corporation. Tüm hakları saklıdır. Tüm ticari markalar, ABD ve diğer ülkelerde ilgili sahiplerinin mülkiyetindedir.
          <span><a href="https://store.steampowered.com/privacy_agreement/">Gizlilik Politikası</a> | <a href="http://www.valvesoftware.com/legal.htm">Yasal Bilgi</a>
          | <a href="https://help.steampowered.com/faqs/view/10BB">Erişilebilirlik</a> | <a href="https://store.steampowered.com/subscriber_agreement/">Steam Abonelik Sözleşmesi</a>
          | <a href="https://store.steampowered.com/steam_refunds/">İadeler</a> | <a href="https://store.steampowered.com/account/cookiepreferences/">Çerezler</a></span></p>
      </div></div>
    </body></html>`;
    expect(extractArticle(steamPage, 'https://steamcommunity.com/ogg/359550/announcements/detail/1')).toBeNull();
  });

  it('makale olmayan sayfada null döner', () => {
    expect(extractArticle('<html><body><nav><a href="/">x</a></nav></body></html>', 'https://example.com/')).toBeNull();
    expect(extractArticle('', 'https://example.com/')).toBeNull();
  });
});

describe('okuyucu: kısa içerik', () => {
  it('yalnızca bağlantıdan oluşan içerik kısa sayılır, gerçek makale sayılmaz', () => {
    expect(isThinContent(html('<a href="https://news.ycombinator.com/item?id=1">Comments</a>'))).toBe(true);
    expect(isThinContent([])).toBe(true);
    const long = 'Uzun bir paragraf metni. '.repeat(10);
    expect(blocksTextLength(html(`<p>${long}</p>`))).toBe(long.trim().length);
    expect(isThinContent(html(`<ul><li>${long}</li></ul>`))).toBe(false);
  });
});

describe('okuyucu: düz metin', () => {
  it('boş satırları paragraf, tek satır sonlarını kırılım yapar', () => {
    expect(contentToBlocks({ format: 'text', body: 'Bir\niki\n\nÜç' })).toEqual([
      { type: 'paragraph', children: [t('Bir'), { type: 'break' }, t('iki')] },
      { type: 'paragraph', children: [t('Üç')] }
    ]);
    expect(contentToBlocks(null)).toEqual([]);
  });
});
