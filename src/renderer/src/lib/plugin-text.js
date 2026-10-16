// Eklentinin manifest metni (displayName, settings.x.label, setup.title ...): eklentinin
// kataloğunda "manifest.<yol>" anahtarı varsa çevirisi, yoksa manifest'teki metin.
export const pluginText = (i18n, source, path, fallback) =>
  i18n.tOr(`${source.name}:manifest.${path}`, fallback);

export const pluginName = (i18n, source) => pluginText(i18n, source, 'displayName', source.displayName);
