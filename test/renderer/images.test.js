import { describe, expect, it, vi } from 'vitest';
import { createImageLoader } from '../../src/renderer/src/lib/images.js';

// Elle bitirilebilen indirmeler
function deferredFetch() {
  const pending = new Map();
  const fetchImage = vi.fn((url) => new Promise((resolve, reject) => pending.set(url, { resolve, reject })));
  return { fetchImage, pending };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('okuyucu: görsel yükleyici', () => {
  it('aynı anda en fazla 3 görsel indirir, bitenin yerine sıradakini başlatır', async () => {
    const { fetchImage, pending } = deferredFetch();
    const load = createImageLoader(fetchImage);
    const results = ['a', 'b', 'c', 'd', 'e'].map((u) => load(u));
    await tick();
    expect(fetchImage).toHaveBeenCalledTimes(3);

    pending.get('a').resolve('data:a');
    await tick();
    expect(fetchImage).toHaveBeenCalledTimes(4);
    expect(await results[0]).toBe('data:a');
  });

  it('aynı adresi bir kez indirir', async () => {
    const fetchImage = vi.fn(async (url) => `data:${url}`);
    const load = createImageLoader(fetchImage);
    expect(await load('x')).toBe('data:x');
    expect(await load('x')).toBe('data:x');
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it('başarısız indirmeyi önbellekte tutmaz, sonra yeniden dener', async () => {
    const fetchImage = vi.fn().mockRejectedValueOnce(new Error('ağ')).mockResolvedValueOnce('data:ok');
    const load = createImageLoader(fetchImage);
    await expect(load('x')).rejects.toThrow('ağ');
    await tick();
    expect(await load('x')).toBe('data:ok');
    expect(fetchImage).toHaveBeenCalledTimes(2);
  });

  it('önbellek sınırını aşınca en eskisini atar', async () => {
    const fetchImage = vi.fn(async (url) => `data:${url}`);
    const load = createImageLoader(fetchImage, { maxCached: 2 });
    await load('a');
    await load('b');
    await load('a'); // a en son kullanılan olur
    await load('c'); // b atılır
    await load('a');
    expect(fetchImage).toHaveBeenCalledTimes(3);
    await load('b');
    expect(fetchImage).toHaveBeenCalledTimes(4);
  });
});
