// Eklentinin ctx.fetch'i: izinli alan adları, yalnızca http(s), yerel ağ yok, yönlendirmenin her adımı
// yeniden denetlenir (izinli bir site izinsiz bir yere yönlendirerek listeyi atlatamasın).
// Yerel ağ denetimi: adres sayısal IP ise doğrudan, alan adıysa DNS'te çözülüp tüm IP'ler denetlenir.
// Bilinen sınır: çözme ile bağlanma arasında DNS kaydı değiştirilirse (DNS rebinding) denetim atlatılabilir;
// bunu kapatmak fetch'in bağlantı katmanına müdahale ister.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateHost } from './web.js';
import { networkAllows } from './permissions.js';

export const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;

const defaultResolve = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

// error(key, params): çevrilebilir hata; resolveHost(hostname) → IP listesi (testlerde sahte)
export function createGuardedFetch({ pluginName, getPermissions, getSettings, error, fetchImpl = (...a) => fetch(...a), resolveHost = defaultResolve }) {
  const fail = (key, params) => Object.assign(error(`core.permissions.network.${key}`, { plugin: pluginName, ...params }), { code: 'NETWORK_DENIED' });

  async function check(raw) {
    let url;
    try {
      url = new URL(String(raw));
    } catch {
      throw fail('badUrl', { url: String(raw).slice(0, 200) });
    }
    const permissions = getPermissions();
    if (!permissions.network) throw fail('notDeclared', { host: url.hostname });
    const verdict = networkAllows(permissions, getSettings(), url);
    if (!verdict.ok) throw fail(verdict.reason === 'scheme' ? 'httpNotAllowed' : 'hostNotAllowed', { host: url.hostname });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isPrivateHost(host)) throw fail('privateAddress', { host: url.hostname });
    if (!isIP(host)) {
      let addresses;
      try {
        addresses = await resolveHost(host);
      } catch (err) {
        // Çözülemeyen ad: fetch'in kendi ağ hatası (eklenti "ulaşılamadı" der)
        throw Object.assign(new TypeError('fetch failed'), { cause: err });
      }
      if (addresses.some((ip) => isPrivateHost(ip))) throw fail('privateAddress', { host: url.hostname });
    }
    return url;
  }

  return async function guardedFetch(input, options = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
    let url = await check(input);
    let init = { ...options, signal, redirect: 'manual' };
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(url.href, init);
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) return res;
      if (hop >= MAX_REDIRECTS) throw fail('tooManyRedirects', { host: url.hostname });
      await res.body?.cancel().catch(() => {});
      url = await check(new URL(location, url));
      // 303 ve POST'a 301/302: tarayıcılar gibi GET'e döner, gövde gönderilmez
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method && init.method !== 'GET' && init.method !== 'HEAD')) {
        const { body, ...rest } = init;
        init = { ...rest, method: 'GET' };
      }
    }
  };
}
