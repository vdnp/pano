import { EventEmitter } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RPC_ERRORS,
  assertCloneable,
  createRpc,
  deserializeError,
  fromMessagePort,
  serializeError
} from '../../shared/rpc.js';

// Node MessagePort olay döngüsünü canlı tutar; her testten sonra kapatılır
const open = [];
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

function channel() {
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  return { port1, port2 };
}

function pair(optsA = {}, optsB = {}) {
  const { port1, port2 } = channel();
  const a = createRpc(fromMessagePort(port1), optsA);
  const b = createRpc(fromMessagePort(port2), optsB);
  open.push(a, b);
  return { a, b, port1, port2 };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Elle ilerletilen zamanlayıcı: zaman aşımı testleri gerçek beklemeye bağlı kalmaz
function manualTimers() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimer: (fn) => { timers.set(++seq, fn); return seq; },
    clearTimer: (id) => timers.delete(id),
    fireAll() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    get size() { return timers.size; }
  };
}

describe('rpc: çağrı', () => {
  it('iki yönde de çağrı yapar', async () => {
    const { a, b } = pair(
      { handlers: { hello: (args) => `merhaba ${args.name}` } },
      { handlers: { add: ({ x, y }) => x + y, obj: async () => ({ list: [1, 'a', null, { ok: true }] }) } }
    );
    expect(await a.call('add', { x: 2, y: 3 })).toBe(5);
    expect(await a.call('obj')).toEqual({ list: [1, 'a', null, { ok: true }] });
    expect(await b.call('hello', { name: 'pano' })).toBe('merhaba pano');
  });

  it('eşzamanlı çağrıları id ile eşler', async () => {
    const { a } = pair({}, { handlers: { echo: async (v) => { await new Promise((r) => setTimeout(r, 10 - v)); return v; } } });
    expect(await Promise.all([0, 1, 2, 3, 4].map((v) => a.call('echo', v)))).toEqual([0, 1, 2, 3, 4]);
  });

  it('bilinmeyen yöntem METHOD_NOT_FOUND ile reddedilir', async () => {
    const { a } = pair({}, { handlers: { known: () => 1 } });
    await expect(a.call('missing')).rejects.toMatchObject({ code: RPC_ERRORS.METHOD_NOT_FOUND });
  });

  it('prototip yöntemleri çağrılamaz', async () => {
    const handlers = Object.create({ inherited: () => 'kalıtım' });
    handlers.own = () => 'öz';
    const { a } = pair({}, { handlers });
    expect(await a.call('own')).toBe('öz');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'inherited']) {
      await expect(a.call(name)).rejects.toMatchObject({ code: RPC_ERRORS.METHOD_NOT_FOUND });
    }
  });

  it('geçersiz yöntem adını göndermeden reddeder', async () => {
    const { a } = pair();
    await expect(a.call('')).rejects.toBeInstanceOf(TypeError);
    await expect(a.call('x'.repeat(500))).rejects.toBeInstanceOf(TypeError);
  });
});

describe('rpc: hatalar', () => {
  it('Error özellikleri (iç içe i18n, code, line) aynen geri gelir, yığın sızmaz', async () => {
    const i18n = { key: 'core.errors.startFailed', params: { error: { key: 'rss:errors.notFound', params: { url: 'https://x' } }, n: 3 } };
    const { a } = pair({}, {
      handlers: {
        fail: () => {
          const err = new TypeError('kötü ayar');
          Object.assign(err, { code: 'XML_ENTITY', i18n, line: 12 });
          throw err;
        }
      }
    });
    const err = await a.call('fail').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TypeError');
    expect(err.message).toBe('kötü ayar');
    expect(err.code).toBe('XML_ENTITY');
    expect(err.line).toBe(12);
    expect(err.i18n).toEqual(i18n);
    expect(err.remoteStack).toBeUndefined();
  });

  it('includeStack ile uzak yığın ayrı alanda gelir', async () => {
    const { a } = pair({}, { includeStack: true, handlers: { fail: () => { throw new Error('x'); } } });
    const err = await a.call('fail').catch((e) => e);
    expect(err.remoteStack).toContain('Error: x');
  });

  it('Error olmayan fırlatmalar Error olur', async () => {
    const { a } = pair({}, {
      handlers: {
        str: () => { throw 'düz metin'; },
        obj: () => { throw { message: 'nesne', code: 'E_OBJ', i18n: { key: 'k' } }; },
        bare: () => { throw { foo: 1 }; },
        nul: () => { throw null; },
        num: () => Promise.reject(42)
      }
    });
    const get = (m) => a.call(m).catch((e) => e);
    const str = await get('str');
    expect(str).toBeInstanceOf(Error);
    expect(str.message).toBe('düz metin');
    expect(await get('obj')).toMatchObject({ message: 'nesne', code: 'E_OBJ', i18n: { key: 'k' } });
    expect((await get('bare')).message).toBe('Non-Error thrown');
    expect((await get('nul')).message).toBe('null');
    expect((await get('num')).message).toBe('42');
  });

  it('serializeError kopyalanamayan i18n parçalarını ve __proto__ anahtarını atar', () => {
    const i18n = JSON.parse('{"key":"k","params":{"__proto__":{"polluted":true},"fn":null}}');
    i18n.params.fn = () => {};
    const data = serializeError(Object.assign(new Error('m'), { i18n }));
    expect(data.i18n).toEqual({ key: 'k', params: {} });
    expect(() => structuredClone(data)).not.toThrow();
    const back = deserializeError(data);
    expect(back.i18n.params.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  it('deserializeError bozuk veriden yine Error üretir', () => {
    for (const bad of [null, 'x', 5, [], { message: 7, name: {} }]) {
      const err = deserializeError(bad);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.message).toBe('string');
    }
  });

  it('kopyalanamayan dönüş değeri RPC_UNCLONEABLE hatasıyla döner', async () => {
    const { a } = pair({}, { handlers: { fn: () => ({ f: () => {} }) } });
    await expect(a.call('fn')).rejects.toMatchObject({ code: RPC_ERRORS.UNCLONEABLE });
  });
});

describe('rpc: zaman aşımı ve iptal', () => {
  it('zaman aşımında RPC_TIMEOUT verir, geç yanıtı yok sayar', async () => {
    const timers = manualTimers();
    const { port1, port2 } = channel();
    const onError = vi.fn();
    const a = createRpc(fromMessagePort(port1), { ...timers, onError });
    open.push(a);
    const received = [];
    const gotRequest = deferred();
    port2.on('message', (msg) => { received.push(msg); if (msg.t === 'req') gotRequest.resolve(msg); });

    const promise = a.call('slow', null);
    const req = await gotRequest.promise;
    expect(timers.size).toBe(1);
    timers.fireAll();
    const err = await promise.catch((e) => e);
    expect(err.code).toBe(RPC_ERRORS.TIMEOUT);

    // Geç yanıt: hiçbir şey olmamalı (çözülmüş söz yeniden çözülmez, hata fırlamaz)
    port2.postMessage({ rpc: 1, t: 'res', id: req.id, ok: true, v: 'geç' });
    port2.postMessage({ rpc: 1, t: 'note', id: req.id, p: 'geç' });
    port2.postMessage({ rpc: 1, t: 'ping', id: 99 });
    await new Promise((r) => port2.once('message', r)); // pong gelene kadar bekle: önceki mesajlar işlendi
    expect(onError).not.toHaveBeenCalled();
    // Zaman aşımı karşıya iptal olarak bildirilir
    expect(received.some((m) => m.t === 'cancel' && m.id === req.id)).toBe(true);
  });

  it('çağrı başına timeoutMs ve 0 = sınırsız', async () => {
    const timers = manualTimers();
    const started = deferred();
    const release = deferred();
    const { a } = pair(timers, { handlers: { wait: async () => { started.resolve(); await release.promise; return 'bitti'; } } });
    const p = a.call('wait', null, { timeoutMs: 0 });
    await started.promise;
    expect(timers.size).toBe(0);
    release.resolve();
    expect(await p).toBe('bitti');
  });

  it('gerçek zamanlayıcıyla kısa zaman aşımı', async () => {
    const { a } = pair({}, { handlers: { never: () => new Promise(() => {}) } });
    await expect(a.call('never', null, { timeoutMs: 20 })).rejects.toMatchObject({ code: RPC_ERRORS.TIMEOUT });
  });

  it('iptal işleyicinin sinyalini tetikler ve AbortError ile reddeder', async () => {
    const started = deferred();
    const aborted = deferred();
    const { a } = pair({}, {
      handlers: {
        work: (_args, { signal }) => new Promise((resolve) => {
          signal.addEventListener('abort', () => aborted.resolve(signal.reason));
          started.resolve();
          setTimeout(() => resolve('geç'), 200);
        })
      }
    });
    const controller = new AbortController();
    const p = a.call('work', null, { signal: controller.signal });
    await started.promise;
    controller.abort();
    const err = await p.catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect((await aborted.promise).name).toBe('AbortError');
  });

  it('önceden iptal edilmiş sinyal hiç göndermeden reddeder', async () => {
    const handler = vi.fn();
    const { a } = pair({}, { handlers: { work: handler } });
    await expect(a.call('work', null, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await a.ping()).toBeGreaterThanOrEqual(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('rpc: bildirim ve olaylar', () => {
  it('işleyici çağrı sürerken ilerleme bildirir', async () => {
    const { a } = pair({}, {
      handlers: {
        job: async (n, { notify }) => {
          for (let i = 1; i <= n; i++) notify({ progress: i / n });
          return 'tamam';
        }
      }
    });
    const notes = [];
    expect(await a.call('job', 4, { onNotify: (p) => notes.push(p) })).toBe('tamam');
    expect(notes).toEqual([{ progress: 0.25 }, { progress: 0.5 }, { progress: 0.75 }, { progress: 1 }]);
  });

  it('çağrı bitince notify false döner', async () => {
    let saved;
    const { a } = pair({}, { handlers: { job: (_a, ctx) => { saved = ctx; return 1; } } });
    await a.call('job');
    expect(saved.notify('geç')).toBe(false);
  });

  it('emit/on tek yönlü olay taşır, off dinlemeyi bırakır', async () => {
    const { a, b } = pair();
    const got = [];
    const off = b.on('status', (p) => got.push(p));
    const last = deferred();
    b.on('done', last.resolve);
    expect(a.emit('status', { n: 1 })).toBe(true);
    a.emit('other', 'yok sayılır');
    a.emit('done');
    await last.promise;
    off();
    const again = deferred();
    b.on('done', again.resolve);
    a.emit('status', { n: 2 });
    a.emit('done');
    await again.promise;
    expect(got).toEqual([{ n: 1 }]);
  });

  it('olay dinleyicisinin hatası onError’a gider', async () => {
    const onError = vi.fn();
    const { a, b } = pair({}, { onError, handlers: { x: () => 1 } });
    b.on('boom', () => { throw new Error('dinleyici'); });
    a.emit('boom');
    await a.call('x');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'dinleyici' }));
  });
});

describe('rpc: kapatma ve canlılık', () => {
  it('close bekleyen çağrıları RPC_CLOSED ile reddeder', async () => {
    const started = deferred();
    const { a } = pair({}, { handlers: { hang: () => { started.resolve(); return new Promise(() => {}); } } });
    const p = a.call('hang');
    await started.promise;
    a.close('durduruldu');
    const err = await p.catch((e) => e);
    expect(err.code).toBe(RPC_ERRORS.CLOSED);
    expect(err.cause).toBe('durduruldu');
    expect(a.isClosed()).toBe(true);
    await expect(a.call('hang')).rejects.toMatchObject({ code: RPC_ERRORS.CLOSED });
    expect(a.emit('x')).toBe(false);
  });

  it('close süren işleyicilerin sinyalini iptal eder ve dinlemeyi bırakır', async () => {
    const started = deferred();
    let signal;
    const handler = vi.fn();
    const { a, b } = pair({}, { handlers: { hang: (_a, ctx) => { signal = ctx.signal; started.resolve(); return new Promise(() => {}); }, later: handler } });
    a.call('hang', null, { timeoutMs: 0 }).catch(() => {});
    await started.promise;
    b.close();
    expect(signal.aborted).toBe(true);
    expect(signal.reason.code).toBe(RPC_ERRORS.CLOSED);
    await expect(a.call('later', null, { timeoutMs: 30 })).rejects.toMatchObject({ code: RPC_ERRORS.TIMEOUT });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ping gidiş-dönüş süresini verir', async () => {
    let t = 1000;
    const { a } = pair({ now: () => (t += 5) });
    expect(await a.ping()).toBe(5);
  });

  it('cevap vermeyen uçta ping RPC_TIMEOUT verir', async () => {
    const timers = manualTimers();
    const { port1 } = channel(); // port2 dinlenmiyor: asılı eklenti
    const a = createRpc(fromMessagePort(port1), timers);
    open.push(a);
    const p = a.ping({ timeoutMs: 30_000 });
    timers.fireAll();
    await expect(p).rejects.toMatchObject({ code: RPC_ERRORS.TIMEOUT });
  });
});

describe('rpc: güvenilmeyen girdi', () => {
  it('bozuk mesajları çökmeden yok sayar', async () => {
    const onError = vi.fn();
    const handler = vi.fn(() => 'ok');
    const { port1, port2 } = channel();
    const b = createRpc(fromMessagePort(port2), { onError, handlers: { x: handler } });
    open.push(b);
    const garbage = [
      null, undefined, 'metin', 42, true, [], [1, 2], { foo: 1 },
      { rpc: 2, t: 'req', id: 1, m: 'x' },
      { rpc: 1 }, { rpc: 1, t: 5 }, { rpc: 1, t: 'nope', id: 1 },
      { rpc: 1, t: 'req', id: 2 ** 53, m: 'x' },
      { rpc: 1, t: 'req', id: 1e300, m: 'x' },
      { rpc: 1, t: 'req', id: -1, m: 'x' },
      { rpc: 1, t: 'req', id: 1.5, m: 'x' },
      { rpc: 1, t: 'req', id: '1', m: 'x' },
      { rpc: 1, t: 'req', id: NaN, m: 'x' },
      { rpc: 1, t: 'res', id: 77, ok: true, v: 1 },
      { rpc: 1, t: 'res', id: 77, ok: false, e: 'bozuk' },
      { rpc: 1, t: 'cancel', id: 12345 },
      { rpc: 1, t: 'note', id: 9 },
      { rpc: 1, t: 'pong', id: 3 },
      { rpc: 1, t: 'evt', n: { a: 1 } },
      { rpc: 1, t: 'evt', n: 'x'.repeat(1000) },
      { rpc: 1, t: 'req', id: 5, m: 'constructor' },
      { rpc: 1, t: 'req', id: 6, m: ['x'] }
    ];
    for (const msg of garbage) port1.postMessage(msg);
    // Son olarak geçerli bir istek: sıralı teslim sayesinde öncekiler işlenmiş olur
    const reply = new Promise((resolve) => port1.on('message', (m) => { if (m?.id === 1000) resolve(m); }));
    const replies = [];
    port1.on('message', (m) => replies.push(m));
    port1.postMessage({ rpc: 1, t: 'req', id: 1000, m: 'x', a: null });
    expect(await reply).toMatchObject({ rpc: 1, t: 'res', id: 1000, ok: true, v: 'ok' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalled();
    // Geçerli id'li ama bilinmeyen/geçersiz yöntemli istekler hata yanıtı alır
    const errors = replies.filter((m) => m.ok === false).map((m) => [m.id, m.e.code]);
    expect(errors).toEqual([[5, RPC_ERRORS.METHOD_NOT_FOUND], [6, RPC_ERRORS.METHOD_NOT_FOUND]]);
    expect(b.isClosed()).toBe(false);
  });

  it('eşzamanlı istek sınırını aşınca RPC_BUSY döner', async () => {
    const release = deferred();
    const { a } = pair({}, { maxInflight: 2, handlers: { hang: () => release.promise } });
    const first = [a.call('hang'), a.call('hang')];
    await expect(a.call('hang')).rejects.toMatchObject({ code: RPC_ERRORS.BUSY });
    release.resolve('ok');
    expect(await Promise.all(first)).toEqual(['ok', 'ok']);
  });

  it('onError’un kendisi fırlatsa da akış sürer', async () => {
    const { a, port1 } = pair({}, { onError: () => { throw new Error('tanı'); }, handlers: { x: () => 1 } });
    port1.postMessage('çöp');
    expect(await a.call('x')).toBe(1);
  });
});

describe('rpc: yardımcılar', () => {
  it('assertCloneable düz veriyi kabul eder, fonksiyon ve sınıfı reddeder', () => {
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    expect(() => assertCloneable({ a: [1, 'x', null, { b: true }], c: undefined })).not.toThrow();
    expect(() => assertCloneable(cyclic)).not.toThrow();
    expect(() => assertCloneable({ f: () => {} })).toThrow(/value\.f/);
    expect(() => assertCloneable([new Map()])).toThrow(/value\[0\].*Map/);
    expect(() => assertCloneable(new Date())).toThrow(TypeError);
  });

  it('checkCloneable açıkken kopyalanamayan argüman reddedilir', async () => {
    const { a } = pair({ checkCloneable: true }, { handlers: { x: () => 1 } });
    await expect(a.call('x', { f: () => {} })).rejects.toBeInstanceOf(TypeError);
    expect(await a.call('x', { ok: 1 })).toBe(1);
  });

  it('fromMessagePort Electron MessagePortMain biçimini ({ data } olaylı EventEmitter) destekler', async () => {
    // Electron MessagePortMain: addEventListener yok, .on('message', e => e.data), start() gerekli
    const makePort = () => Object.assign(new EventEmitter(), { started: false, start() { this.started = true; } });
    const left = makePort();
    const right = makePort();
    left.postMessage = (data) => queueMicrotask(() => right.started && right.emit('message', { data, ports: [] }));
    right.postMessage = (data) => queueMicrotask(() => left.started && left.emit('message', { data, ports: [] }));
    const a = createRpc(fromMessagePort(left));
    const b = createRpc(fromMessagePort(right), { handlers: { sum: (xs) => xs.reduce((s, x) => s + x, 0) } });
    expect(left.started && right.started).toBe(true);
    expect(await a.call('sum', [1, 2, 3])).toBe(6);
    b.close();
    expect(right.listenerCount('message')).toBe(0);
    a.close();
  });

  it('global MessageChannel (DOM benzeri EventTarget) ile çalışır', async () => {
    const { port1, port2 } = new globalThis.MessageChannel();
    open.push(port1, port2);
    const a = createRpc(fromMessagePort(port1));
    const b = createRpc(fromMessagePort(port2), { handlers: { up: (s) => s.toUpperCase() } });
    open.push(a, b);
    expect(await a.call('up', 'pano')).toBe('PANO');
  });
});
