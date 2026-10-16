import { describe, expect, it, vi } from 'vitest';
import github from '../../plugins/github/index.js';

const source = github.sources.notifications;

function fakeCtx({ token = 'tok', settings = {}, state = {}, responses = [] } = {}) {
  const stateMap = new Map(Object.entries(state));
  const queue = [...responses];
  return {
    secrets: { get: (key) => (key === 'token' ? token : null) },
    settings: { get: (key) => settings[key] },
    state: { get: (key) => stateMap.get(key), set: (key, value) => stateMap.set(key, value) },
    stateMap,
    fetch: vi.fn(async () => queue.shift()),
    notify: vi.fn(() => true),
    log: vi.fn()
  };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function thread(overrides = {}) {
  return {
    id: '100',
    reason: 'mention',
    updated_at: '2026-01-15T10:00:00Z',
    repository: { full_name: 'acme/app', html_url: 'https://github.com/acme/app' },
    subject: { title: 'Bir sorun', type: 'Issue', url: 'https://api.github.com/repos/acme/app/issues/12' },
    ...overrides
  };
}

describe('github eklentisi', () => {
  it('anahtar yoksa ne yapılacağını söyleyen hata fırlatır', async () => {
    const ctx = fakeCtx({ token: null });
    await expect(source.run(ctx)).rejects.toThrow('Erişim anahtarı eklenmedi');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  describe('200 yanıtı', () => {
    it('her konu için ortak şemada bildirim üretir', async () => {
      const ctx = fakeCtx({
        responses: [json([thread()], 200, { 'last-modified': 'Thu, 15 Jan 2026 10:00:00 GMT' })]
      });
      await source.run(ctx);

      expect(ctx.notify).toHaveBeenCalledTimes(1);
      expect(ctx.notify).toHaveBeenCalledWith({
        id: '100:2026-01-15T10:00:00Z',
        title: 'Bir sorun',
        body: 'acme/app',
        url: 'https://github.com/acme/app/issues/12',
        level: 'info',
        tags: ['Issue', 'Senden bahsedildi'],
        createdAt: Date.parse('2026-01-15T10:00:00Z'),
        meta: { threadId: '100', repo: 'acme/app', reason: 'mention', type: 'Issue' }
      });
      expect(ctx.log).toHaveBeenCalledWith('1 yeni bildirim');
    });

    it('isteği doğru başlık ve sorguyla yapar, durumu kaydeder', async () => {
      const ctx = fakeCtx({
        settings: { participatingOnly: true },
        responses: [json([], 200, { 'last-modified': 'LM' })]
      });
      await source.run(ctx);

      const [url, { headers }] = ctx.fetch.mock.calls[0];
      expect(url).toBe('https://api.github.com/notifications?per_page=50&participating=true');
      expect(headers.Authorization).toBe('Bearer tok');
      expect(headers['If-Modified-Since']).toBeUndefined();
      expect(ctx.stateMap.get('lastModified')).toBe('LM');
      expect(ctx.stateMap.get('lastQuery')).toBe('per_page=50&participating=true');
      expect(ctx.log).not.toHaveBeenCalled();
    });

    it('güvenlik uyarısını warning seviyesinde, bilinmeyen türleri olduğu gibi etiketler', async () => {
      const ctx = fakeCtx({
        responses: [json([
          thread({ reason: 'security_alert', subject: { title: 'Açık', type: 'RepositoryVulnerabilityAlert', url: null } }),
          thread({ id: '2', reason: 'yeni_sebep', subject: { title: 'X', type: 'YeniTur', url: null } })
        ])]
      });
      await source.run(ctx);

      expect(ctx.notify.mock.calls[0][0]).toMatchObject({ level: 'warning', tags: ['Güvenlik', 'Güvenlik uyarısı'] });
      expect(ctx.notify.mock.calls[1][0]).toMatchObject({ level: 'info', tags: ['YeniTur', 'yeni_sebep'] });
    });

    it('yalnızca gerçekten yeni olanları sayar', async () => {
      const ctx = fakeCtx({ responses: [json([thread(), thread({ id: '2' })])] });
      ctx.notify.mockReturnValueOnce(false).mockReturnValueOnce(true);
      await source.run(ctx);
      expect(ctx.log).toHaveBeenCalledWith('1 yeni bildirim');
    });
  });

  describe('304 yanıtı', () => {
    it('aynı sorguda If-Modified-Since gönderir, 304 gelince hiçbir şey yapmaz', async () => {
      const query = 'per_page=50&participating=false';
      const ctx = fakeCtx({
        state: { lastModified: 'LM', lastQuery: query },
        responses: [new Response(null, { status: 304 })]
      });
      await source.run(ctx);

      expect(ctx.fetch.mock.calls[0][1].headers['If-Modified-Since']).toBe('LM');
      expect(ctx.notify).not.toHaveBeenCalled();
      expect(ctx.stateMap.get('lastModified')).toBe('LM');
    });

    it('sorgu değiştiyse If-Modified-Since göndermez', async () => {
      const ctx = fakeCtx({
        settings: { participatingOnly: true },
        state: { lastModified: 'LM', lastQuery: 'per_page=50&participating=false' },
        responses: [json([])]
      });
      await source.run(ctx);
      expect(ctx.fetch.mock.calls[0][1].headers['If-Modified-Since']).toBeUndefined();
    });
  });

  describe('hata yanıtları', () => {
    it('401: anahtar geçersiz', async () => {
      const ctx = fakeCtx({ responses: [json({ message: 'Bad credentials' }, 401)] });
      await expect(source.run(ctx)).rejects.toThrow('GitHub anahtarı geçersiz veya süresi dolmuş.');
    });

    it('403 istek sınırı: sıfırlanma saatini söyler', async () => {
      const reset = Math.floor(Date.parse('2026-01-15T10:30:00Z') / 1000);
      const ctx = fakeCtx({
        responses: [json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) })]
      });
      const expectedTime = new Date(reset * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      await expect(source.run(ctx)).rejects.toThrow(
        `GitHub istek sınırına ulaşıldı. ${expectedTime} sonrasında tekrar denenecek.`
      );
    });

    it('429 istek sınırı da aynı mesajı verir', async () => {
      const ctx = fakeCtx({
        responses: [json({}, 429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1768473000' })]
      });
      await expect(source.run(ctx)).rejects.toThrow('GitHub istek sınırına ulaşıldı.');
    });

    it('istek sınırı dışındaki 403: izinleri kontrol et', async () => {
      const ctx = fakeCtx({ responses: [json({}, 403, { 'x-ratelimit-remaining': '42' })] });
      await expect(source.run(ctx)).rejects.toThrow('notifications iznine sahip olduğunu kontrol et');
    });

    it('diğer durumlar: kodu söyler, durumu değiştirmez', async () => {
      const ctx = fakeCtx({ responses: [json({}, 502)] });
      await expect(source.run(ctx)).rejects.toThrow('GitHub beklenmeyen bir yanıt verdi (502).');
      expect(ctx.stateMap.size).toBe(0);
    });
  });

  describe('htmlUrl dönüşümleri', () => {
    const repo = 'https://github.com/acme/app';
    const api = 'https://api.github.com/repos/acme/app';

    it.each([
      ['issue', { type: 'Issue', url: `${api}/issues/12` }, `${repo}/issues/12`],
      ['pull request', { type: 'PullRequest', url: `${api}/pulls/7` }, `${repo}/pull/7`],
      ['commit', { type: 'Commit', url: `${api}/commits/abc123` }, `${repo}/commit/abc123`],
      ['sürüm', { type: 'Release', url: `${api}/releases/999` }, `${repo}/releases`],
      ['adressiz tartışma', { type: 'Discussion', url: null }, `${repo}/discussions`],
      ['adressiz diğer', { type: 'CheckSuite', url: null }, repo],
      ['tanınmayan adres', { type: 'Issue', url: `${api}/issues/12/comments` }, repo]
    ])('%s', async (_label, subject, expected) => {
      const ctx = fakeCtx({ responses: [json([thread({ subject: { title: 'T', ...subject } })])] });
      await source.run(ctx);
      expect(ctx.notify.mock.calls[0][0].url).toBe(expected);
    });

    it('depo bilgisi yoksa GitHub bildirim sayfasına gider', async () => {
      const ctx = fakeCtx({
        responses: [json([thread({ repository: undefined, subject: { title: 'T', url: null } })])]
      });
      await source.run(ctx);
      expect(ctx.notify.mock.calls[0][0]).toMatchObject({
        url: 'https://github.com/notifications', body: ''
      });
    });
  });
});
