// İzinlerin okunur satırları (onay ekranı ve ayarlar paneli). core/permissions.js'in describePermissions
// çıktısı gelir: [{ kind, host?, path? }]. "Ayardaki adresler" satırı ayar alanının adıyla yazılır.

import { pluginText } from './plugin-text.js';

const same = (a, b) => a.kind === b.kind && a.host === b.host && a.path === b.path;

export function permissionLines(i18n, source, list = [], added = null) {
  return list.map((p) => {
    let text;
    if (p.kind === 'networkFromSettings') {
      const field = String(p.path ?? '').split('.')[0];
      const label = pluginText(i18n, source, `settings.${field}.label`, source.settingsSchema?.[field]?.label ?? field);
      text = i18n.t('consent.perm.networkFromSettings', { path: label });
    } else {
      text = i18n.t(`consent.perm.${p.kind}`, { host: p.host ?? '' });
    }
    return { key: `${p.kind}:${p.host ?? p.path ?? ''}`, text, isNew: Boolean(added?.some((a) => same(a, p))) };
  });
}
