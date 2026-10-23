// Eklenti izinleri (manifest.permissions). Saf JS: core, sandbox ve arayüz aynı kuralları kullanır.
//
// {
//   "network": { "hosts": ["api.github.com", "*.steampowered.com"], "fromSettings": ["feeds.url"] },
//   "notifications": true, "openExternal": true, "runCommand": true, "filesystem": true
// }
// Eski dizi biçimi (["openExternal", "runCommand"]) de kabul edilir. "*" tüm genel internet demektir
// (onay ekranında açıkça "tüm internet" yazar). Yerel ağ hiçbir izinle açılmaz.

export const PERMISSIONS = ['network', 'notifications', 'openExternal', 'runCommand', 'filesystem'];
const FLAGS = ['notifications', 'openExternal', 'runCommand', 'filesystem'];
const HOST = /^(\*|(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)$/;
// Ayar yolu: "alan" (metin ayarı) ya da "liste.alt" (liste öğelerinin alanı)
const SETTING_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const MAX_HOSTS = 50;

// { permissions, warnings }: bilinmeyen ya da hatalı girdiler atılır, uyarı olarak döner
export function normalizePermissions(raw) {
  const out = { network: null, notifications: false, openExternal: false, runCommand: false, filesystem: false };
  const warnings = [];
  if (raw == null) return { permissions: out, warnings };

  let source = raw;
  if (Array.isArray(raw)) {
    source = {};
    for (const item of raw) {
      if (typeof item === 'string') source[item] = true;
      else warnings.push(`geçersiz izin: ${JSON.stringify(item)}`);
    }
  } else if (typeof raw !== 'object') {
    warnings.push('permissions bir nesne olmalı');
    return { permissions: out, warnings };
  }

  for (const [key, value] of Object.entries(source)) {
    if (FLAGS.includes(key)) {
      out[key] = value === true;
    } else if (key === 'network') {
      const net = value === true ? {} : value;
      if (!net || typeof net !== 'object' || Array.isArray(net)) {
        // network: ["a.com"] kısayolu
        if (Array.isArray(value)) out.network = normalizeNetwork({ hosts: value }, warnings);
        else warnings.push('network bir nesne olmalı');
        continue;
      }
      out.network = normalizeNetwork(net, warnings);
    } else {
      warnings.push(`bilinmeyen izin: ${key}`);
    }
  }
  return { permissions: out, warnings };
}

function normalizeNetwork(net, warnings) {
  const hosts = [];
  for (const h of Array.isArray(net.hosts) ? net.hosts : []) {
    const host = String(h).trim().toLowerCase();
    if (!HOST.test(host)) warnings.push(`geçersiz alan adı: ${h}`);
    else if (!hosts.includes(host)) hosts.push(host);
  }
  const fromSettings = [];
  for (const p of Array.isArray(net.fromSettings) ? net.fromSettings : []) {
    if (SETTING_PATH.test(String(p)) && !fromSettings.includes(String(p))) fromSettings.push(String(p));
    else warnings.push(`geçersiz ayar yolu: ${p}`);
  }
  return { hosts: hosts.slice(0, MAX_HOSTS).sort(), fromSettings: fromSettings.sort() };
}

// İzin değişti mi: kararlı metin (sıra ve yazım farkı değişiklik sayılmaz)
export function permissionsKey(p) {
  return JSON.stringify({
    network: p.network ? { hosts: p.network.hosts, fromSettings: p.network.fromSettings } : null,
    ...Object.fromEntries(FLAGS.map((f) => [f, Boolean(p[f])]))
  });
}

// Önceki onaya göre yeni eklenen izinler (onay ekranında vurgulanır)
export function addedPermissions(current, previous) {
  if (!previous) return describePermissions(current);
  const prev = describePermissions(previous).map((d) => JSON.stringify(d));
  return describePermissions(current).filter((d) => !prev.includes(JSON.stringify(d)));
}

// Arayüz için okunur liste: [{ kind: 'network', host }, { kind: 'networkFromSettings', path }, { kind: 'notifications' } …]
export function describePermissions(p) {
  const out = [];
  for (const host of p.network?.hosts ?? []) out.push({ kind: host === '*' ? 'networkAny' : 'network', host });
  for (const path of p.network?.fromSettings ?? []) out.push({ kind: 'networkFromSettings', path });
  for (const f of FLAGS) if (p[f]) out.push({ kind: f });
  return out;
}

// "*.example.com" hem example.com'un alt alanlarını hem kendisini kapsar
export function hostMatches(pattern, hostname) {
  const host = String(hostname).toLowerCase();
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern;
}

// Ayarlarda kullanıcının girdiği adreslerin alan adları ({ host, protocol } listesi)
export function hostsFromSettings(settings, paths) {
  const out = [];
  const add = (value) => {
    try {
      const u = new URL(String(value));
      if (u.protocol === 'https:' || u.protocol === 'http:') out.push({ host: u.hostname.toLowerCase(), protocol: u.protocol });
    } catch { /* adres değil */ }
  };
  for (const path of paths ?? []) {
    const [field, sub] = path.split('.');
    const value = settings?.[field];
    if (sub) for (const item of Array.isArray(value) ? value : []) add(item?.[sub]);
    else add(value);
  }
  return out;
}

// Adres bu izinlerle istenebilir mi: { ok } ya da { ok: false, reason: 'host' | 'scheme' }.
// Sabit alan adları yalnızca https; ayardan gelen adreste kullanıcı http yazdıysa http de olur.
export function networkAllows(p, settings, url) {
  const host = url.hostname.toLowerCase();
  const https = url.protocol === 'https:';
  if (!https && url.protocol !== 'http:') return { ok: false, reason: 'scheme' };
  const fixed = (p.network?.hosts ?? []).some((pattern) => hostMatches(pattern, host));
  if (fixed && https) return { ok: true };
  const fromSettings = hostsFromSettings(settings, p.network?.fromSettings);
  if (fromSettings.some((h) => h.host === host && (https || h.protocol === 'http:'))) return { ok: true };
  return { ok: false, reason: fixed ? 'scheme' : 'host' };
}
