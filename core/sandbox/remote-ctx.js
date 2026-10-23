// Eklenti sürecindeki ctx: core/context.js ile aynı yüz, ama arkasında RPC var. Eklentinin senkron
// beklediği değerler (ayar, kendi gizli alanları, durum, çeviri, notify'ın sonucu) main'in gönderdiği
// kopyalardan anında verilir; yazmalar ve yan etkili işler (bildirim, durum yazma, fetch, bağlantı
// açma, komut çalıştırma, log) main'e gider. Main her isteği yeniden denetler (eklenti güvenilmez).
// Saf JS: hem sandbox'lı renderer'da hem Node testlerinde çalışır.

import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { parseXml } from '../xml.js';

// ctx.fetch'in 20 sn sınırı main'de uygulanır; RPC çağrısının sınırı biraz daha uzun
const FETCH_RPC_TIMEOUT_MS = 25_000;

// fetch yanıtı düz veri olarak gelir ({ status, statusText, headers: [[ad, değer]], body: metin });
// eklentinin kullandığı yüz (status, ok, headers.get, json, text) için gerçek Response kurulur
function toResponse(data) {
  const nullBody = [101, 204, 205, 304].includes(data.status);
  return new Response(nullBody ? null : data.body ?? '', {
    status: data.status,
    statusText: data.statusText ?? '',
    headers: data.headers ?? []
  });
}

const plainHeaders = (headers) => {
  if (!headers) return [];
  if (typeof headers.entries === 'function') return [...headers.entries()];
  if (Array.isArray(headers)) return headers.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(headers).map(([k, v]) => [String(k), String(v)]);
};

export function createRemoteContext({ name, rpc, snapshot }) {
  let settings = snapshot.settings ?? {};
  let secrets = snapshot.secrets ?? {};
  const state = { ...(snapshot.state ?? {}) };
  // Bu eklentinin kayıtlı bildirim kimlikleri (önek olmadan): notify'ın true/false sonucu için
  const known = new Set(snapshot.knownIds ?? []);
  let i18n;
  let catalogs = snapshot.catalogs ?? {};
  const rebuild = (locale) => {
    i18n = createI18n({ locale, catalogs: mergeCatalogs({}, { [name]: catalogs }) });
  };
  rebuild(snapshot.locale ?? 'tr');

  const key = (k) => `${name}:${k}`;
  const send = (event, payload) => rpc.emit(event, payload);

  const permissions = snapshot.permissions ?? {};
  // Çeviri main'de: hata anahtarla taşınır, arayüz ve zamanlayıcı errorI18n'den çevirir
  const denied = (permission) => Object.assign(new Error('core.permissions.denied'), {
    i18n: { key: 'core.permissions.denied', params: { plugin: name, permission: { key: `core.permissions.names.${permission}` } } }
  });

  function notifyFor(n, job, causedBy) {
    if (!permissions.notifications) throw denied('notifications');
    if (!n?.id || !n?.title) throw new Error('Bildirimde id ve title zorunlu');
    const id = String(n.id);
    if (known.has(id)) return false;
    known.add(id);
    send('ctx.notify', { n: { ...n, id }, job: job ?? null, causedBy: causedBy ?? null });
    return true;
  }

  async function fetchRemote(url, options = {}) {
    const { signal, headers, method, body } = options;
    const init = { method: method ?? 'GET', headers: plainHeaders(headers) };
    if (body != null) init.body = String(body);
    const data = await rpc.call('ctx.fetch', { url: String(url), init }, { signal, timeoutMs: FETCH_RPC_TIMEOUT_MS });
    return toResponse(data);
  }

  // Komut içindeyken verilen kopya; izin ve "komut içinde mi" denetimi main'deki gerçek ctx'te
  const commandScope = ({ signal, depth = 0, runId = null }) => ({
    ...ctx,
    signal,
    notify: (n) => notifyFor(n, null, runId),
    openExternal: (url) => rpc.call('ctx.openExternal', { url: String(url ?? ''), command: { depth, runId } }),
    runCommand: (id, params = {}) =>
      rpc.call('ctx.runCommand', { id: String(id ?? ''), params, command: { depth, runId } }, { signal, timeoutMs: 0 })
  });

  const ctx = {
    plugin: name,
    log: (...args) => send('ctx.log', { level: 'log', args: args.map(String) }),
    warn: (...args) => send('ctx.log', { level: 'warn', args: args.map(String) }),
    notify: (n) => notifyFor(n, null, null),
    forJob: (job, { causedBy = null } = {}) => ({ ...ctx, notify: (n) => notifyFor(n, job, causedBy) }),
    forCommand: commandScope,
    // Komut dışında çağrılınca main anlaşılır hatayı verir (izin yok / komut içinde değil)
    openExternal: (url) => rpc.call('ctx.openExternal', { url: String(url ?? ''), command: null }),
    runCommand: (id, params = {}) => rpc.call('ctx.runCommand', { id: String(id ?? ''), params, command: null }),
    fetch: fetchRemote,
    // Eklentiye ayrılmış klasör: izin ve yol denetimi main'de
    files: {
      read: (rel) => rpc.call('ctx.files', { op: 'read', path: String(rel ?? '') }),
      write: (rel, text) => rpc.call('ctx.files', { op: 'write', path: String(rel ?? ''), text: String(text ?? '') }),
      list: (rel = '') => rpc.call('ctx.files', { op: 'list', path: String(rel ?? '') }),
      remove: (rel) => rpc.call('ctx.files', { op: 'remove', path: String(rel ?? '') })
    },
    parseXml,
    key,
    t: (k, params) => i18n.t(key(k), params),
    error: (k, params) => i18n.error(key(k), params),
    settings: {
      get: (k) => settings[k],
      all: () => settings
    },
    secrets: {
      get: (k) => secrets[k] ?? null
    },
    state: {
      get: (k) => state[k],
      set(k, value) {
        // Kopya hemen güncellenir (sonraki get aynı değeri görsün), kalıcı yazım main'de
        state[k] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        send('ctx.state.set', { key: String(k), value: state[k] ?? null });
      }
    }
  };

  // Main'den gelen güncellemeler (ayar kaydı, gizli alan, dil değişimi)
  function apply(patch = {}) {
    if (patch.settings) settings = patch.settings;
    if (patch.secrets) secrets = patch.secrets;
    if (patch.catalogs) catalogs = patch.catalogs;
    if (patch.locale || patch.catalogs) rebuild(patch.locale ?? i18n.locale);
  }

  return { ctx, apply };
}
