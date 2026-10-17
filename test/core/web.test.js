import { describe, expect, it, vi } from 'vitest';
import { createWebFetcher, isPrivateHost } from '../../core/web.js';
import { baseI18n } from '../../locales/index.js';

const error = (key, params) => baseI18n.error(key, params);
const res = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });
const html = (body, headers = {}) => res(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

function fetcher(...responses) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { web: createWebFetcher({ fetchImpl, error }), fetchImpl };
}

describe('okuyucu: yerel ağ denetimi', () => {
  it.each([
    'localhost', 'app.localhost', 'nas.local', 'router.lan', '127.0.0.1', '10.0.0.5', '192.168.1.1',
    '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]',
    '[fe80::1]', '[::ffff:192.168.1.1]'
  ])('%s yerel sayılır', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['example.com', '8.8.8.8', '172.32.0.1', '[2606:4700::1111]', 'localhost.example.com'])('%s yerel değil', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });

  it('sayısal yazılmış yerel adresleri de engeller', async () => {
    const { web, fetchImpl } = fetcher();
    for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://127.1/']) {
      await expect(web.page(url)).rejects.toThrow('Yerel ağdaki adresler okuyucuda açılmaz.');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('okuyucu: sayfa indirme', () => {
  it('HTML ve son adresi döner, çerezsiz ve yönlendirmeyi elle izleyerek ister', async () => {
    const { web, fetchImpl } = fetcher(
      res(null, { status: 301, headers: { location: '/yazi' } }),
      html('<p>Merhaba</p>')
    );
    expect(await web.page('https://blog.example.com/eski')).toEqual({ url: 'https://blog.example.com/yazi', html: '<p>Merhaba</p>' });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('Cookie');
  });

  it('verilen kullanıcı kimliğini (User-Agent) gönderir', async () => {
    const fetchImpl = vi.fn(async () => html('<p>x</p>'));
    const web = createWebFetcher({ fetchImpl, error, userAgent: 'Mozilla/5.0 pano/0.1.0 Electron/44' });
    await web.page('https://example.com/');
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('Mozilla/5.0 pano/0.1.0 Electron/44');
  });

  it('yerel ağa giden yönlendirmeyi durdurur', async () => {
    const { web, fetchImpl } = fetcher(res(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } }));
    await expect(web.page('https://example.com/')).rejects.toThrow('Yerel ağdaki adresler');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5\'ten fazla yönlendirmede durur', async () => {
    const hops = Array.from({ length: 6 }, (_, i) => res(null, { status: 302, headers: { location: `/r${i}` } }));
    const { web } = fetcher(...hops);
    await expect(web.page('https://example.com/')).rejects.toThrow('Sayfa çok fazla yönlendirme yaptı.');
  });

  it('http(s) olmayan adresi istemeden reddeder', async () => {
    const { web, fetchImpl } = fetcher();
    await expect(web.page('file:///C:/Windows/win.ini')).rejects.toThrow('Adres http:// veya https:// ile başlamalı.');
    await expect(web.page('javascript:alert(1)')).rejects.toThrow('Adres http:// veya https://');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('HTML olmayan yanıtı reddeder', async () => {
    const { web } = fetcher(res('%PDF', { headers: { 'content-type': 'application/pdf' } }));
    await expect(web.page('https://example.com/a.pdf')).rejects.toThrow('Bu adres bir web sayfası değil.');
  });

  it('boyut sınırını hem başlıkta hem akışta uygular', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024 + 1);
    const declared = fetcher(html('kısa', { 'content-length': String(big.length) }));
    await expect(declared.web.page('https://example.com/')).rejects.toThrow('Sayfa okuyucu için çok büyük.');
    // Content-Length yanlış bildirilse de okuma kesilir
    const lying = fetcher(html(big, { 'content-length': '10' }));
    await expect(lying.web.page('https://example.com/')).rejects.toThrow('Sayfa okuyucu için çok büyük.');
  });

  it('karakter kümesini başlıktan okur', async () => {
    const latin = Buffer.from([0x4b, 0xfd, 0x7a]); // windows-1254: "Kız"
    const { web } = fetcher(res(latin, { headers: { 'content-type': 'text/html; charset=windows-1254' } }));
    expect((await web.page('https://example.com/')).html).toBe('Kız');
  });

  it('HTTP hatası, zaman aşımı ve bağlantı hatası için anlaşılır mesaj verir', async () => {
    await expect(fetcher(res('yok', { status: 404 })).web.page('https://example.com/')).rejects.toThrow('Sayfa alınamadı (404).');
    await expect(fetcher(new DOMException('t', 'TimeoutError')).web.page('https://example.com/')).rejects.toThrow('15 saniye içinde');
    await expect(fetcher(new TypeError('fetch failed')).web.page('https://example.com/')).rejects.toThrow('Sayfaya ulaşılamadı.');
  });
});

describe('okuyucu: yönlendirmeyi kendisi izleyen fetch (Electron oturumu)', () => {
  // Electron session.fetch yanıtındaki son adres (yönlendirme sonrası)
  const finalAt = (response, url) => Object.defineProperty(response, 'url', { value: url });
  const follow = (impl) => createWebFetcher({ fetchImpl: vi.fn(impl), error, followsRedirects: true });

  it('yönlendirmeyi fetch\'e bırakır ve son adresi döner', async () => {
    const fetchImpl = vi.fn(async () => finalAt(html('<p>x</p>'), 'https://example.com/son'));
    const web = createWebFetcher({ fetchImpl, error, followsRedirects: true });
    expect(await web.page('https://example.com/ilk')).toEqual({ url: 'https://example.com/son', html: '<p>x</p>' });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('follow');
  });

  it('son adres yerel ağdaysa yine de reddeder', async () => {
    const web = follow(async () => finalAt(html('<p>x</p>'), 'http://192.168.1.1/'));
    await expect(web.page('https://example.com/')).rejects.toThrow('Yerel ağdaki adresler');
  });

  it('oturum filtresinin engellediği isteği yerel ağ hatası olarak bildirir', async () => {
    const blocked = follow(async () => { throw new Error('net::ERR_BLOCKED_BY_CLIENT'); });
    await expect(blocked.page('https://example.com/')).rejects.toThrow('Yerel ağdaki adresler');
    const loop = follow(async () => { throw new Error('net::ERR_TOO_MANY_REDIRECTS'); });
    await expect(loop.page('https://example.com/')).rejects.toThrow('Sayfa çok fazla yönlendirme yaptı.');
  });
});

describe('okuyucu: görsel indirme', () => {
  it('görseli data: adresi olarak döner', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { web } = fetcher(res(png, { headers: { 'content-type': 'image/png' } }));
    expect(await web.image('https://img.example.com/a.png')).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('SVG ve görsel olmayan yanıtları reddeder', async () => {
    const svg = fetcher(res('<svg onload="alert(1)"/>', { headers: { 'content-type': 'image/svg+xml' } }));
    await expect(svg.web.image('https://img.example.com/a.svg')).rejects.toThrow('Bu adres bir görsel değil.');
    const page = fetcher(html('<p>'));
    await expect(page.web.image('https://img.example.com/a')).rejects.toThrow('Bu adres bir görsel değil.');
  });

  it('yerel ağdaki görseli istemez', async () => {
    const { web, fetchImpl } = fetcher();
    await expect(web.image('http://10.0.0.1/a.png')).rejects.toThrow('Yerel ağdaki adresler');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
