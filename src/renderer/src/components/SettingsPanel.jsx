import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { CloseIcon } from './Icons.jsx';

export default function SettingsPanel({ source, onClose }) {
  const [values, setValues] = useState(source.settings);
  const [secrets, setSecrets] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const job = source.jobs[0];
  const secretEntries = Object.entries(source.secretsSchema);
  const settingEntries = Object.entries(source.settingsSchema);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.sources.updateSettings(source.name, values);
      for (const [key, value] of Object.entries(secrets)) {
        if (value.trim()) await api.sources.setSecret(source.name, key, value.trim());
      }
      setSecrets({});
      setMessage({ type: 'ok', text: 'Ayarlar kaydedildi.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function removeSecret(key) {
    await api.sources.setSecret(source.name, key, '');
    setMessage({ type: 'ok', text: 'Anahtar silindi.' });
  }

  let fieldIndex = 0;
  const refFor = () => (fieldIndex++ === 0 ? firstField : undefined);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <header className="panel-header">
          <div>
            <h2 id="panel-title">{source.displayName} ayarları</h2>
            {source.description && <p className="panel-desc">{source.description}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Ayarları kapat">
            <CloseIcon />
          </button>
        </header>

        {job?.state === 'error' && <p className="notice notice-error">{job.error}</p>}

        <form onSubmit={save} className="panel-form">
          {secretEntries.map(([key, schema]) => {
            const isSet = source.secretsSet[key];
            return (
              <div key={key} className="field">
                <label htmlFor={`secret-${key}`}>{schema.label ?? key}</label>
                <input
                  ref={refFor()}
                  id={`secret-${key}`}
                  type="password"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder={isSet ? 'Kayıtlı. Değiştirmek için yenisini gir.' : 'Anahtarı buraya yapıştır'}
                  value={secrets[key] ?? ''}
                  onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })}
                />
                {schema.help && <p className="help">{schema.help}</p>}
                <div className="field-links">
                  {schema.helpUrl && (
                    <button type="button" className="link" onClick={() => api.openExternal(schema.helpUrl)}>
                      Anahtar oluşturma sayfasını aç
                    </button>
                  )}
                  {isSet && (
                    <button type="button" className="link link-danger" onClick={() => removeSecret(key)}>
                      Kayıtlı anahtarı sil
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {settingEntries.map(([key, schema]) => (
            <div key={key} className={schema.type === 'boolean' ? 'field field-check' : 'field'}>
              {schema.type === 'boolean' ? (
                <label>
                  <input
                    ref={refFor()}
                    type="checkbox"
                    checked={Boolean(values[key])}
                    onChange={(e) => setValues({ ...values, [key]: e.target.checked })}
                  />
                  {schema.label ?? key}
                </label>
              ) : (
                <>
                  <label htmlFor={`setting-${key}`}>{schema.label ?? key}</label>
                  <input
                    ref={refFor()}
                    id={`setting-${key}`}
                    type={schema.type === 'number' ? 'number' : 'text'}
                    min={schema.min}
                    max={schema.max}
                    value={values[key] ?? ''}
                    onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  />
                </>
              )}
            </div>
          ))}

          {message && (
            <p className={`notice ${message.type === 'error' ? 'notice-error' : 'notice-ok'}`} role="status">
              {message.text}
            </p>
          )}

          <div className="panel-actions">
            <button type="button" className="btn" onClick={onClose}>Kapat</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Kaydediliyor' : 'Ayarları kaydet'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
