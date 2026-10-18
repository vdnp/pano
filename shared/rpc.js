// İki uç arasında mesaj kanalı üzerinden istek/yanıt, olay ve iptal (aşama A2: eklenti gizli,
// sandbox'lı bir renderer'da çalışır, main ile MessagePort üzerinden konuşur). Saf JS: Node,
// Electron main ve sandbox'lı tarayıcıda aynı dosya çalışır; Node/Electron/DOM import edilmez.
//
// Değerler structured clone ile geçer: düz nesne, dizi, string, sayı, boolean, null. Fonksiyon,
// sınıf örneği, Promise aktarılamaz (postMessage DataCloneError atar ya da prototip kaybolur).
//
// Protokol (her mesaj `rpc: 1` taşır, başka mesajlar yok sayılır):
//   { rpc:1, t:'req',    id, m, a }        istek (m: yöntem adı, a: argüman)
//   { rpc:1, t:'res',    id, ok:true, v }  başarılı yanıt
//   { rpc:1, t:'res',    id, ok:false, e } hata yanıtı (e: serializeError çıktısı)
//   { rpc:1, t:'cancel', id }              arayan iptal etti / zaman aşımı
//   { rpc:1, t:'note',   id, p }           işleyiciden o çağrıya ara bildirim (ilerleme)
//   { rpc:1, t:'evt',    n, p }            tek yönlü olay
//   { rpc:1, t:'ping',   id } / { t:'pong', id }  canlılık denetimi (işleyicilerden bağımsız)

export const RPC_ERRORS = Object.freeze({
  TIMEOUT: 'RPC_TIMEOUT',
  CLOSED: 'RPC_CLOSED',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  BUSY: 'RPC_BUSY',
  UNCLONEABLE: 'RPC_UNCLONEABLE'
});

const MAX_ID = 2 ** 31 - 1;
const MAX_NAME = 128;
const MAX_MESSAGE = 4000;
const MAX_DEPTH = 8;

const isId = (id) => Number.isInteger(id) && id > 0 && id <= MAX_ID;
const isName = (n) => typeof n === 'string' && n.length > 0 && n.length <= MAX_NAME;
const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

function rpcError(code, message, extra) {
  return Object.assign(new Error(message), { code }, extra);
}

function abortError(reason) {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  if (reason !== undefined) err.cause = reason;
  return err;
}

// Karşı taraftan gelen ya da karşıya giden serbest veriyi (i18n gibi) düz veriye indirger;
// derinlik sınırı kötü niyetli iç içe yapıların yığını taşırmasını önler.
function toPlain(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= MAX_DEPTH || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.slice(0, 1000).map((v) => toPlain(v, depth + 1) ?? null);
  if (!isPlainObject(value)) return undefined;
  const out = {};
  for (const key of Object.keys(value)) {
    // __proto__ ataması prototipi değiştirir; düz veri için gereksiz
    if (key === '__proto__') continue;
    const v = toPlain(value[key], depth + 1);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const clip = (s, max) => (typeof s === 'string' ? s.slice(0, max) : undefined);

export function serializeError(err, { includeStack = false } = {}) {
  const src = err instanceof Error || (err && typeof err === 'object') ? err : { message: String(err) };
  const out = {
    name: clip(src.name, MAX_NAME) || 'Error',
    message: clip(src.message, MAX_MESSAGE) ?? (typeof err === 'object' ? 'Non-Error thrown' : String(err))
  };
  if (typeof src.code === 'string' || typeof src.code === 'number') out.code = src.code;
  if (src.i18n !== undefined) {
    const i18n = toPlain(src.i18n);
    if (i18n !== undefined) out.i18n = i18n;
  }
  if (typeof src.line === 'number' || typeof src.line === 'string') out.line = src.line;
  if (includeStack && typeof src.stack === 'string') out.stack = clip(src.stack, MAX_MESSAGE * 4);
  return out;
}

export function deserializeError(data) {
  const d = isPlainObject(data) ? data : {};
  const err = new Error(clip(d.message, MAX_MESSAGE) ?? 'Unknown remote error');
  const name = clip(d.name, MAX_NAME);
  if (name && name !== 'Error') err.name = name;
  if (typeof d.code === 'string' || typeof d.code === 'number') err.code = d.code;
  if (d.i18n !== undefined) err.i18n = toPlain(d.i18n);
  if (typeof d.line === 'number' || typeof d.line === 'string') err.line = d.line;
  // Uzak yığın yerel yığının yerine geçmez; ayrı alanda tutulur
  if (typeof d.stack === 'string') err.remoteStack = d.stack;
  return err;
}

// Geliştirme ve testler için: değer structured clone ile bozulmadan geçer mi?
export function assertCloneable(value, path = 'value', seen = new Set()) {
  if (value === null || value === undefined) return;
  const type = typeof value;
  if (type === 'string' || type === 'boolean' || type === 'number') return;
  if (type !== 'object') throw new TypeError(`${path} is not cloneable (${type})`);
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((v, i) => assertCloneable(v, `${path}[${i}]`, seen));
  else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) assertCloneable(value[key], `${path}.${key}`, seen);
  } else throw new TypeError(`${path} is not a plain object (${value.constructor?.name ?? 'unknown'})`);
}

// DOM MessagePort, Node MessagePort (EventTarget) ve Electron MessagePortMain (yalnızca
// EventEmitter; olay nesnesi { data, ports }) için ortak arayüz.
export function fromMessagePort(port) {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage(cb) {
      const listener = (event) => cb(event?.data);
      let off;
      if (typeof port.addEventListener === 'function') {
        port.addEventListener('message', listener);
        off = () => port.removeEventListener('message', listener);
      } else {
        port.on('message', listener);
        off = () => (port.off ?? port.removeListener).call(port, 'message', listener);
      }
      // DOM ve Electron portları start() çağrılmadan mesaj teslim etmez
      port.start?.();
      return off;
    }
  };
}

export function createRpc(port, {
  handlers = {},
  timeoutMs: defaultTimeout = 30_000,
  maxInflight = 256,
  includeStack = false,
  checkCloneable = false,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  onError = () => {}
} = {}) {
  const pending = new Map(); // id → { resolve, reject, timer, onNotify, detach }
  const inflight = new Map(); // gelen istek id → AbortController
  const listeners = new Map(); // olay adı → Set<cb>
  let nextId = 0;
  let closed = false;

  const report = (err) => { try { onError(err); } catch { /* tanılama geri çağrısı akışı bozmamalı */ } };
  const post = (msg) => port.postMessage({ rpc: 1, ...msg });
  const newId = () => (nextId = nextId >= MAX_ID ? 1 : nextId + 1);

  function settle(id, fn, value) {
    const entry = pending.get(id);
    if (!entry) return; // zaman aşımı/iptal sonrası geç yanıt
    pending.delete(id);
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.detach?.();
    entry[fn](value);
  }

  function request(msg, { timeoutMs = defaultTimeout, signal, onNotify } = {}) {
    return new Promise((resolve, reject) => {
      if (closed) return reject(rpcError(RPC_ERRORS.CLOSED, 'RPC channel is closed'));
      if (signal?.aborted) return reject(abortError(signal.reason));
      const id = newId();
      const entry = { resolve, reject, onNotify };
      const cancel = () => { try { post({ t: 'cancel', id }); } catch { /* port kapanmış olabilir */ } };
      pending.set(id, entry);
      if (signal) {
        const onAbort = () => { cancel(); settle(id, 'reject', abortError(signal.reason)); };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.detach = () => signal.removeEventListener('abort', onAbort);
      }
      if (timeoutMs > 0) {
        entry.timer = setTimer(() => {
          cancel();
          settle(id, 'reject', rpcError(RPC_ERRORS.TIMEOUT, `RPC ${msg.m ?? msg.t} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      }
      try {
        if (checkCloneable) assertCloneable(msg.a, 'args');
        post({ ...msg, id });
      } catch (err) {
        settle(id, 'reject', err);
      }
    });
  }

  function respond(id, ok, payload) {
    if (closed) return;
    try {
      if (ok && checkCloneable) assertCloneable(payload, 'result');
      post(ok ? { t: 'res', id, ok: true, v: payload } : { t: 'res', id, ok: false, e: payload });
    } catch (err) {
      // Dönen değer kopyalanamıyorsa arayan asılı kalmasın diye hata yanıtı gönderilir
      try {
        post({ t: 'res', id, ok: false, e: serializeError(rpcError(RPC_ERRORS.UNCLONEABLE, err.message)) });
      } catch (e) { report(e); }
    }
  }

  async function handleRequest(id, method, args) {
    if (inflight.has(id)) return report(new Error(`duplicate request id ${id}`));
    if (!Object.hasOwn(handlers, method) || typeof handlers[method] !== 'function') {
      return respond(id, false, serializeError(rpcError(RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`)));
    }
    if (inflight.size >= maxInflight) {
      return respond(id, false, serializeError(rpcError(RPC_ERRORS.BUSY, 'Too many concurrent requests')));
    }
    const controller = new AbortController();
    inflight.set(id, controller);
    const notify = (payload) => {
      if (closed || controller.signal.aborted || inflight.get(id) !== controller) return false;
      try { post({ t: 'note', id, p: payload }); return true; } catch (err) { report(err); return false; }
    };
    let ok = true;
    let result;
    try {
      result = await handlers[method](args, { signal: controller.signal, notify });
    } catch (err) {
      ok = false;
      result = serializeError(err, { includeStack });
    }
    if (inflight.get(id) === controller) inflight.delete(id);
    // İptal edilen çağrının yanıtını arayan zaten yok sayar; göndermeye gerek yok
    if (!controller.signal.aborted) respond(id, ok, result);
  }

  function handle(msg) {
    if (closed) return;
    if (!isPlainObject(msg) || msg.rpc !== 1 || typeof msg.t !== 'string') {
      return report(new Error('ignored malformed RPC message'));
    }
    const { t, id } = msg;
    if (t === 'evt') {
      if (!isName(msg.n)) return report(new Error('ignored event with invalid name'));
      for (const cb of listeners.get(msg.n) ?? []) {
        try { cb(msg.p); } catch (err) { report(err); }
      }
      return;
    }
    if (!isId(id)) return report(new Error(`ignored ${t} message with invalid id`));
    switch (t) {
      case 'req':
        if (!isName(msg.m)) return respond(id, false, serializeError(rpcError(RPC_ERRORS.METHOD_NOT_FOUND, 'Invalid method name')));
        handleRequest(id, msg.m, msg.a);
        return;
      case 'res':
        if (msg.ok === true) settle(id, 'resolve', msg.v);
        else settle(id, 'reject', deserializeError(msg.e));
        return;
      case 'note': {
        const cb = pending.get(id)?.onNotify;
        if (cb) try { cb(msg.p); } catch (err) { report(err); }
        return;
      }
      case 'cancel':
        inflight.get(id)?.abort(abortError('cancelled by caller'));
        inflight.delete(id);
        return;
      case 'ping':
        try { post({ t: 'pong', id }); } catch (err) { report(err); }
        return;
      case 'pong':
        settle(id, 'resolve', true);
        return;
      default:
        report(new Error(`ignored unknown RPC message type ${String(t).slice(0, MAX_NAME)}`));
    }
  }

  const unsubscribe = port.onMessage((msg) => {
    try { handle(msg); } catch (err) { report(err); }
  });

  return {
    call(method, args, options) {
      if (!isName(method)) return Promise.reject(new TypeError('RPC method name must be a short string'));
      return request({ t: 'req', m: method, a: args }, options);
    },
    async ping({ timeoutMs = defaultTimeout } = {}) {
      const start = now();
      await request({ t: 'ping' }, { timeoutMs });
      return now() - start;
    },
    emit(event, payload) {
      if (closed || !isName(event)) return false;
      if (checkCloneable) assertCloneable(payload, 'payload');
      post({ t: 'evt', n: event, p: payload });
      return true;
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event)?.delete(cb);
    },
    close(reason) {
      if (closed) return;
      closed = true;
      try { unsubscribe?.(); } catch (err) { report(err); }
      for (const id of [...pending.keys()]) {
        settle(id, 'reject', rpcError(RPC_ERRORS.CLOSED, 'RPC channel closed', reason === undefined ? undefined : { cause: reason }));
      }
      for (const controller of inflight.values()) controller.abort(rpcError(RPC_ERRORS.CLOSED, 'RPC channel closed'));
      inflight.clear();
      listeners.clear();
    },
    isClosed: () => closed
  };
}
