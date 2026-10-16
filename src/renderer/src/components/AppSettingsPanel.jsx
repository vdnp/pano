import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { CloseIcon } from './Icons.jsx';

const TOGGLES = ['openAtLogin', 'pauseNotifications'];
const LANGUAGES = ['system', 'tr', 'en'];

// Değişiklikler anında uygulanır: tepsi menüsü de aynı ayarı değiştirebildiği için
// bekleyen bir form durumu eskiyebilirdi.
export default function AppSettingsPanel({ settings, onClose }) {
  const { t } = useI18n();
  const [message, setMessage] = useState(null);
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(key, value) {
    setMessage(null);
    try {
      await api.appSettings.set({ [key]: value });
    } catch {
      setMessage(t('appSettings.saveFailed'));
    }
  }

  const languageLabel = (value) =>
    value === 'system'
      ? t('appSettings.language.system', { language: t(`appSettings.language.${settings?.systemLocale ?? 'en'}`) })
      : t(`appSettings.language.${value}`);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="app-panel-title">
        <header className="panel-header">
          <div>
            <h2 id="app-panel-title">{t('appSettings.title')}</h2>
            <p className="panel-desc">{t('appSettings.description')}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('settings.close')}>
            <CloseIcon />
          </button>
        </header>

        <div className="panel-form">
          <div className="field">
            <label htmlFor="app-language">{t('appSettings.language.label')}</label>
            <select
              id="app-language"
              ref={firstField}
              value={settings?.language ?? 'system'}
              disabled={!settings}
              onChange={(e) => update('language', e.target.value)}
            >
              {LANGUAGES.map((value) => (
                <option key={value} value={value}>{languageLabel(value)}</option>
              ))}
            </select>
            <p className="help">{t('appSettings.language.help')}</p>
          </div>

          {TOGGLES.map((key) => (
            <div key={key} className="field field-check">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(settings?.[key])}
                  disabled={!settings}
                  onChange={(e) => update(key, e.target.checked)}
                />
                {t(`appSettings.${key}.label`)}
              </label>
              <p className="help">{t(`appSettings.${key}.help`)}</p>
            </div>
          ))}

          {message && <p className="notice notice-error" role="status">{message}</p>}

          <div className="panel-actions">
            <button type="button" className="btn" onClick={onClose}>{t('settings.closeButton')}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
