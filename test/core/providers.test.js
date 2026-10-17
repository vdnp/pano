import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderCache, stableKey, ttlOf } from '../../core/providers.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { baseI18n } from '../../locales/index.js';
import { removeDir, tempDir } from '../helpers.js';

const error = (key, params) => baseI18n.error(key, params);

function setup(storage = createSqliteStorage(':memory:')) {
  let time = 1_000_000;
  const clock = { now: () => time, advance: (ms) => { time += ms; } };
  const cache = createProviderCache({ storage, error, now: clock.now });
  return { storage, cache, clock };
}

// get çağrısını elle bitirebilen sağlayıcı
function deferredProvider(ttl = 60) {
  const pending = [];
  const get = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  return { provider: { ttl, get }, pending };
}

const request = (cache, provider, params = {}, force = false) =>
  cache.get({ plugin: 'demo', id: 'profile', provider, ctx: {}, params, force });

describe('providers: önbellek', () => {
  let dir;
  afterEach(() => dir && removeDir(dir));

  it('ttl süresince önbellekten verir, süre dolunca yeniden ister', async () => {
    const { cache, clock } = setup();
    const provider = { ttl: 60, get: vi.fn(async () => ({ sayi: provider.get.mock.calls.length })) };

    expect(await request(cache, provider)).toEqual({ data: { sayi: 1 }, fetchedAt: 1_000_000, stale: false });
    clock.advance(59_000);
    expect((await request(cache, provider)).data).toEqual({ sayi: 1 });
    expect(provider.get).toHaveBeenCalledTimes(1);

    clock.advance(1_000);
    expect((await request(cache, provider)).data).toEqual({ sayi: 2 });
    expect(provider.get).toHaveBeenCalledTimes(2);
  });

  it('parametreler anahtar sırasından bağımsız aynı kaydı kullanır, farklı parametreler ayrı', async () => {
    const { cache } = setup();
    const provider = { ttl: 60, get: vi.fn(async (ctx, params) => params) };
    await request(cache, provider, { a: 1, b: { c: 2, d: 3 } });
    await request(cache, provider, { b: { d: 3, c: 2 }, a: 1 });
    expect(provider.get).toHaveBeenCalledTimes(1);
    await request(cache, provider, { a: 2 });
    expect(provider.get).toHaveBeenCalledTimes(2);
    expect(stableKey({ b: 1, a: [2, { z: 1, y: 2 }] })).toBe('{"a":[2,{"y":2,"z":1}],"b":1}');
  });

  it('uygulama yeniden açılınca da geçerlidir', async () => {
    dir = tempDir('pano-cache-');
    const file = path.join(dir, 'pano.db');
    const first = setup(createSqliteStorage(file));
    const provider = { ttl: 600, get: vi.fn(async () => ({ ad: 'Enes' })) };
    await request(first.cache, provider);
    first.storage.close();

    const second = setup(createSqliteStorage(file));
    expect(await request(second.cache, provider)).toEqual({ data: { ad: 'Enes' }, fetchedAt: 1_000_000, stale: false });
    expect(provider.get).toHaveBeenCalledTimes(1);
    second.storage.close();
  });

  it('ttl en az 10 saniye, verilmezse 300 saniye', () => {
    expect(ttlOf({ ttl: 1 })).toBe(10);
    expect(ttlOf({ ttl: 600 })).toBe(600);
    expect(ttlOf({})).toBe(300);
    expect(ttlOf({ ttl: 'abc' })).toBe(300);
  });

  it('en son kullanılan 200 kaydı tutar', async () => {
    const { cache, storage, clock } = setup();
    const provider = { ttl: 600, get: vi.fn(async (ctx, p) => p) };
    for (let i = 0; i < 205; i++) {
      await request(cache, provider, { i });
      clock.advance(1);
    }
    // En eskiler (0..4) atıldı, yeniden istenince get çağrılır
    expect(storage.providerCache.get(`demo/profile/${stableKey({ i: 0 })}`, 0)).toBeNull();
    expect(storage.providerCache.get(`demo/profile/${stableKey({ i: 204 })}`, 0)).not.toBeNull();
  });
});

describe('providers: istek birleştirme', () => {
  it('aynı anda gelen aynı istekleri tek get çağrısında birleştirir', async () => {
    const { cache } = setup();
    const { provider, pending } = deferredProvider();
    const all = [request(cache, provider), request(cache, provider), request(cache, provider)];
    expect(provider.get).toHaveBeenCalledTimes(1);

    pending[0].resolve({ tamam: true });
    const results = await Promise.all(all);
    expect(results.every((r) => r.data.tamam)).toBe(true);
  });

  it('farklı parametreli istekleri ayrı çalıştırır', async () => {
    const { cache } = setup();
    const { provider, pending } = deferredProvider();
    const a = request(cache, provider, { id: 1 });
    const b = request(cache, provider, { id: 2 });
    expect(provider.get).toHaveBeenCalledTimes(2);
    pending.forEach((p, i) => p.resolve({ i }));
    expect((await a).data).toEqual({ i: 0 });
    expect((await b).data).toEqual({ i: 1 });
  });

  it('yenile önbelleği atlar ama süren isteğe katılır', async () => {
    const { cache } = setup();
    const provider = { ttl: 600, get: vi.fn(async () => ({ n: provider.get.mock.calls.length })) };
    await request(cache, provider);
    expect((await request(cache, provider, {}, true)).data).toEqual({ n: 2 });

    // Önbellekte olmayan ayrı bir anahtar: normal istek sürerken gelen "yenile" ona katılır
    const slow = deferredProvider();
    const normal = request(cache, slow.provider, { yavas: 1 });
    const forced = request(cache, slow.provider, { yavas: 1 }, true);
    expect(slow.provider.get).toHaveBeenCalledTimes(1);
    slow.pending[0].resolve({ ok: 1 });
    expect((await forced).data).toEqual((await normal).data);
  });
});

describe('providers: hatalar', () => {
  it('hata olursa eldeki eski veriyi uyarıyla verir', async () => {
    const { cache, clock } = setup();
    const provider = { ttl: 60, get: vi.fn().mockResolvedValueOnce({ eski: true }).mockRejectedValueOnce(new Error('ağ yok')) };
    await request(cache, provider);
    clock.advance(61_000);
    const result = await request(cache, provider);
    expect(result).toMatchObject({ data: { eski: true }, stale: true, fetchedAt: 1_000_000 });
    expect(result.error.message).toBe('ağ yok');
  });

  it('önbellek yokken hatayı fırlatır ve sonraki istek yeniden dener', async () => {
    const { cache } = setup();
    const provider = { ttl: 60, get: vi.fn().mockRejectedValueOnce(new Error('ağ yok')).mockResolvedValueOnce({ ok: 1 }) };
    await expect(request(cache, provider)).rejects.toThrow('ağ yok');
    expect((await request(cache, provider)).data).toEqual({ ok: 1 });
  });

  it('JSON\'a çevrilemeyen ve çok büyük sonucu anlaşılır hatayla reddeder', async () => {
    const { cache } = setup();
    const circular = {};
    circular.self = circular;
    await expect(request(cache, { get: async () => circular })).rejects.toThrow('Veri kaynağı okunamayan bir sonuç döndürdü.');
    await expect(request(cache, { get: async () => 'x'.repeat(300 * 1024) }, { b: 1 })).rejects.toThrow('çok büyük');
  });
});
