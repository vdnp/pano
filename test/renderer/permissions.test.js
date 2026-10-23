import { describe, expect, it } from 'vitest';
import { permissionLines } from '../../src/renderer/src/lib/permissions.js';
import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';

const i18n = createI18n({ locale: 'tr', catalogs: mergeCatalogs(appCatalogs, { rss: { tr: { manifest: { settings: { feeds: { label: 'Akışlar' } } } } } }) });

describe('izin satırları', () => {
  it('okunur metin; ayardaki adresler ayar alanının adıyla; yeni istenenler işaretli', () => {
    const source = { name: 'rss', settingsSchema: { feeds: { label: 'Akışlar' } } };
    const list = [{ kind: 'network', host: 'api.example.com' }, { kind: 'networkFromSettings', path: 'feeds.url' }, { kind: 'networkAny', host: '*' }, { kind: 'notifications' }];
    expect(permissionLines(i18n, source, list, [{ kind: 'notifications' }])).toEqual([
      { key: 'network:api.example.com', text: 'İnternet: api.example.com', isNew: false },
      { key: 'networkFromSettings:feeds.url', text: 'Ayarlarda kendi girdiğin adresler (Akışlar)', isNew: false },
      { key: 'networkAny:*', text: 'İnternette yerel ağ dışındaki her adres', isNew: false },
      { key: 'notifications:', text: 'Bildirim gösterme', isNew: true }
    ]);
  });
});
