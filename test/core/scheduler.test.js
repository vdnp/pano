import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../core/scheduler.js';
import { silentLogger } from '../helpers.js';

const MINUTE = 60_000;

function setup() {
  const bus = new EventEmitter();
  const logger = silentLogger();
  const statuses = [];
  bus.on('source:status', (s) => statuses.push(s));
  return { bus, logger, statuses, scheduler: createScheduler({ bus, logger }) };
}

// Testin elle bitirebileceği bir iş
function deferredJob() {
  let resolve, reject;
  const fn = vi.fn(() => new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { fn, resolve: () => resolve(), reject: (err) => reject(err) };
}

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // ilk çalışma tam 1 sn sonra
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ilk çalışmayı 1-3 sn içinde, sonrakileri aralıkla yapar', async () => {
    const { scheduler } = setup();
    const fn = vi.fn();
    scheduler.add('demo/a', fn, MINUTE, { plugin: 'demo' });

    await vi.advanceTimersByTimeAsync(999);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('durum anlık görüntüsü meta ve zamanları içerir', async () => {
    const { scheduler, statuses } = setup();
    scheduler.add('demo/a', vi.fn(), MINUTE, { plugin: 'demo', title: 'A' });
    expect(statuses[0]).toMatchObject({
      key: 'demo/a', plugin: 'demo', title: 'A', intervalMs: MINUTE, state: 'idle',
      nextRun: Date.now() + 1000
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.map((s) => s.state)).toEqual(['idle', 'running', 'ok']);
    const [status] = scheduler.statuses();
    expect(status.lastSuccess).toBe(Date.now());
    expect(status.nextRun).toBe(Date.now() + MINUTE);
  });

  it('çalışırken ikinci çalıştırma başlamaz', async () => {
    const { scheduler } = setup();
    const job = deferredJob();
    scheduler.add('demo/a', job.fn, MINUTE);

    scheduler.runNow('demo/a');
    scheduler.runNow('demo/a');
    await vi.advanceTimersByTimeAsync(5000); // ilk zamanlanmış çalışma da gelmesin
    expect(job.fn).toHaveBeenCalledTimes(1);

    job.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.statuses()[0].state).toBe('ok');
    scheduler.runNow('demo/a');
    expect(job.fn).toHaveBeenCalledTimes(2);
  });

  it('hatayı kaydeder, sonraki başarılı çalışmada temizler', async () => {
    const { scheduler, logger } = setup();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Anahtar geçersiz.'))
      .mockResolvedValueOnce(undefined);
    scheduler.add('demo/a', fn, MINUTE);

    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.statuses()[0]).toMatchObject({ state: 'error', error: 'Anahtar geçersiz.', lastSuccess: null });
    expect(logger.warn).toHaveBeenCalledWith('[demo/a]', 'Anahtar geçersiz.');

    // Hata sonrası da zamanlama sürer
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(scheduler.statuses()[0]).toMatchObject({ state: 'ok', error: null });
  });

  it('senkron fırlatılan ve Error olmayan hataları da kaydeder', async () => {
    const { scheduler } = setup();
    scheduler.add('demo/a', () => { throw 'düz metin'; }, MINUTE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(scheduler.statuses()[0]).toMatchObject({ state: 'error', error: 'düz metin' });
  });

  it('reschedule yeni aralığı şimdiden itibaren uygular', async () => {
    const { scheduler } = setup();
    const fn = vi.fn();
    scheduler.add('demo/a', fn, MINUTE);
    await vi.advanceTimersByTimeAsync(1000);

    scheduler.reschedule('demo/a', 5 * MINUTE);
    expect(scheduler.statuses()[0].intervalMs).toBe(5 * MINUTE);
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('çalışırken reschedule, iş bitince yeni aralığı kullanır', async () => {
    const { scheduler } = setup();
    const job = deferredJob();
    scheduler.add('demo/a', job.fn, MINUTE);
    await vi.advanceTimersByTimeAsync(1000);

    scheduler.reschedule('demo/a', 2 * MINUTE);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(job.fn).toHaveBeenCalledTimes(1); // hâlâ çalışıyor, yeni çalışma yok

    job.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.statuses()[0].nextRun).toBe(Date.now() + 2 * MINUTE);
  });

  it('bilinmeyen anahtarda reschedule, setMeta, remove ve runNow sessizce geçer', () => {
    const { scheduler } = setup();
    expect(() => scheduler.reschedule('yok', MINUTE)).not.toThrow();
    expect(() => scheduler.setMeta('yok', {})).not.toThrow();
    expect(() => scheduler.remove('yok')).not.toThrow();
    expect(scheduler.runNow('yok')).toBeUndefined();
  });

  it('setMeta zamanlamaya dokunmadan başlığı günceller', async () => {
    const { scheduler, statuses } = setup();
    scheduler.add('demo/a', vi.fn(), MINUTE, { plugin: 'demo', title: 'Eski' });
    const { nextRun } = scheduler.statuses()[0];

    await vi.advanceTimersByTimeAsync(500);
    scheduler.setMeta('demo/a', { plugin: 'demo', title: 'Yeni' });
    expect(scheduler.statuses()[0]).toMatchObject({ title: 'Yeni', nextRun });
    expect(statuses.at(-1).title).toBe('Yeni');
  });

  it('remove işi siler ve bir daha çalıştırmaz', async () => {
    const { scheduler } = setup();
    const a = vi.fn();
    const b = vi.fn();
    scheduler.add('demo/a', a, MINUTE);
    scheduler.add('demo/b', b, MINUTE);

    scheduler.remove('demo/a');
    expect(scheduler.statuses().map((s) => s.key)).toEqual(['demo/b']);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('çalışırken silinen iş biter ama yeniden zamanlanmaz', async () => {
    const { scheduler } = setup();
    const job = deferredJob();
    scheduler.add('demo/a', job.fn, MINUTE);
    await vi.advanceTimersByTimeAsync(1000);

    scheduler.remove('demo/a');
    job.resolve();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(job.fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stopAll sonrası hiçbir iş çalışmaz', async () => {
    const { scheduler } = setup();
    const a = vi.fn();
    const b = vi.fn();
    scheduler.add('demo/a', a, MINUTE);
    scheduler.add('demo/b', b, MINUTE);

    scheduler.stopAll();
    scheduler.runNow('demo/a');
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('çalışan iş stopAll sonrası yeniden zamanlanmaz', async () => {
    const { scheduler } = setup();
    const job = deferredJob();
    scheduler.add('demo/a', job.fn, MINUTE);
    await vi.advanceTimersByTimeAsync(1000);

    scheduler.stopAll();
    job.resolve();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(job.fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drain: süren çalışmanın bitmesini bekler; süre dolarsa false döner', async () => {
    const { scheduler } = setup();
    expect(await scheduler.drain(100)).toBe(true);

    const job = deferredJob();
    scheduler.add('demo/a', job.fn, MINUTE);
    await vi.advanceTimersByTimeAsync(3000);
    expect(job.fn).toHaveBeenCalledTimes(1);
    scheduler.stopAll();

    const late = scheduler.drain(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await late).toBe(false);

    const waiting = scheduler.drain(5000);
    job.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toBe(true);
  });
});
