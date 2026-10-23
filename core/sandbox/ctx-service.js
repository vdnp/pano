// Main tarafı: eklenti sürecinden gelen ctx isteklerini core'un gerçek ctx'ine (core/context.js)
// bağlar. Eklenti güvenilmez sayılır: her isteğin biçimi ve boyutu burada yeniden denetlenir;
// izin ("permissions") ve "komut içinde mi" denetimleri gerçek ctx'te kalır.

export const LIMITS = {
  // ctx.fetch yanıt gövdesi (metin) ve tek bir durum değeri / bildirim nesnesi
  fetchBody: 10 * 1024 * 1024,
  stateValue: 1024 * 1024,
  notification: 256 * 1024,
  logLine: 2000
};
const FETCH_TIMEOUT_MS = 20_000;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

const sizeOf = (value) => {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return Infinity;
  }
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Gövdeyi sınırı aşmadan okur (Content-Length yalan olabilir; akış sayılarak okunur)
async function readLimited(res, limit, limitError) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw limitError('fetch 10 MB');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function createCtxService({ name, ctx, logger, limits = LIMITS, error = (key, params) => new Error(`${key} ${JSON.stringify(params)}`) }) {
  const limitError = (what) => Object.assign(error('core.errors.pluginLimit', { what }), { code: 'PLUGIN_LIMIT' });
  const badRequest = (what) => Object.assign(error('core.errors.pluginBadRequest', { what }), { code: 'PLUGIN_BAD_REQUEST' });
  const commandCtx = (command, signal) =>
    ctx.forCommand({ signal, depth: Number(command.depth) || 0, runId: command.runId ? String(command.runId) : null });

  const handlers = {
    async 'ctx.fetch'({ url, init } = {}, { signal }) {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (!METHODS.has(method)) throw badRequest(`fetch ${method.slice(0, 20)}`);
      const headers = Array.isArray(init?.headers) ? init.headers.slice(0, 100).map(([k, v]) => [String(k), String(v)]) : [];
      const body = init?.body == null ? undefined : String(init.body);
      if (body && body.length > limits.fetchBody) throw limitError('fetch body');
      // Eklentinin iptali ve 20 sn sınırı birlikte geçerli
      const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      let res;
      try {
        res = await ctx.fetch(String(url ?? ''), { method, headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch (err) {
        // Eklenti yalnızca hatanın adını görür (TimeoutError / AbortError / TypeError); nedeni burada loglanır
        logger.warn(`[${name}] fetch başarısız (${String(url).slice(0, 120)}):`, err?.name, err?.message, err?.cause?.code ?? err?.cause?.message ?? '');
        throw err;
      }
      return {
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers.entries()],
        body: method === 'HEAD' ? '' : await readLimited(res, limits.fetchBody, limitError)
      };
    },

    // Dosya işlemleri: izin, yol ve kota denetimi gerçek ctx'te (core/plugin-files.js)
    'ctx.files'({ op, path, text } = {}) {
      if (!['read', 'write', 'list', 'remove'].includes(op)) throw badRequest('files');
      if (op === 'write' && String(text ?? '').length > limits.fetchBody) throw limitError('files 10 MB');
      return op === 'write' ? ctx.files.write(String(path ?? ''), String(text ?? '')) : ctx.files[op](String(path ?? ''));
    },

    'ctx.openExternal'({ url, command } = {}) {
      return isObject(command) ? commandCtx(command).openExternal(String(url ?? '')) : ctx.openExternal(String(url ?? ''));
    },

    'ctx.runCommand'({ id, params, command } = {}, { signal }) {
      const values = isObject(params) ? params : {};
      return isObject(command)
        ? commandCtx(command, signal).runCommand(String(id ?? ''), values)
        : ctx.runCommand(String(id ?? ''), values);
    }
  };

  // Tek yönlü olaylar: hata eklentiye dönmez, loglanır
  function attach(rpc) {
    const guard = (label, fn) => (payload) => {
      try {
        fn(isObject(payload) ? payload : {});
      } catch (err) {
        logger.warn(`[${name}] ${label} reddedildi:`, err?.message ?? err);
      }
    };
    const off = [
      rpc.on('ctx.notify', guard('bildirim', ({ n, job, causedBy }) => {
        if (!isObject(n)) throw badRequest('notify');
        if (sizeOf(n) > limits.notification) throw limitError('notify 256 KB');
        ctx.forJob(job ? String(job) : null, { causedBy: causedBy ? String(causedBy) : null }).notify(n);
      })),
      rpc.on('ctx.state.set', guard('durum', ({ key, value }) => {
        if (typeof key !== 'string' || !key || key.length > 200) throw badRequest('state key');
        if (sizeOf(value) > limits.stateValue) throw limitError('state 1 MB');
        ctx.state.set(key, value ?? undefined);
      })),
      rpc.on('ctx.log', guard('log', ({ level, args }) => {
        const line = (Array.isArray(args) ? args : []).map((a) => String(a).slice(0, limits.logLine));
        (level === 'error' ? logger.error : level === 'warn' ? ctx.warn : ctx.log)(...line);
      }))
    ];
    return () => off.forEach((fn) => fn());
  }

  return { handlers, attach };
}
