import { createContext, useContext, useMemo } from 'react';
import { createI18n, mergeCatalogs } from '../../../../shared/i18n.js';
import { appCatalogs } from '../../../../locales/index.js';
import { createTimeFormat } from './time.js';

function build(locale, pluginCatalogs = {}) {
  const i18n = createI18n({ locale, catalogs: mergeCatalogs(appCatalogs, pluginCatalogs) });
  return { ...i18n, time: createTimeFormat(i18n) };
}

const I18nContext = createContext(build('tr'));

// Uygulama kataloğu + eklentilerin locales/*.json katalogları (core listSources ile iletir)
export function I18nProvider({ locale, sources, children }) {
  // Kaynak durumları sık güncellenir; katalog yalnızca dil ya da eklenti listesi değişince kurulur
  const pluginKey = sources.map((s) => s.name).join(',');
  const value = useMemo(
    () => build(locale, Object.fromEntries(sources.map((s) => [s.name, s.locales]))),
    [locale, pluginKey]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
