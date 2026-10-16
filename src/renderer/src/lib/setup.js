import { pluginName, pluginText } from './plugin-text.js';

// Eklenti kurulum bekliyor mu: başlatma hatası, eksik gizli alan (ör. GitHub token'ı) ya da
// hiç kaynağı olmaması (ör. akış eklenmemiş RSS). Metin manifest.setup'tan (ya da eklentinin
// kataloğundaki çevirisinden) gelir, yoksa genel metin kullanılır.
export function setupNeed(source, i18n) {
  const { t } = i18n;
  const name = pluginName(i18n, source);

  if (source.startError) {
    return {
      name: source.name,
      title: t('setup.startFailed', { name }),
      body: t(source.startErrorI18n ?? source.startError),
      action: null
    };
  }

  const missing = Object.keys(source.secretsSet).find((key) => !source.secretsSet[key]);
  if (missing) {
    const label = pluginText(i18n, source, `secrets.${missing}.label`, source.secretsSchema[missing]?.label ?? missing);
    return {
      name: source.name,
      title: t('setup.secretTitle', { name }),
      body: t('setup.secretBody', { label }),
      action: t('setup.secretAction')
    };
  }

  if (source.jobs.length === 0) {
    return {
      name: source.name,
      title: pluginText(i18n, source, 'setup.title', source.setup?.title ?? t('setup.noSourcesTitle', { name })),
      body: pluginText(i18n, source, 'setup.body', source.setup?.body ?? pluginText(i18n, source, 'description', source.description)),
      action: pluginText(i18n, source, 'setup.action', source.setup?.action ?? t('setup.noSourcesAction'))
    };
  }
  return null;
}
