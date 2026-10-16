import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { CloseIcon } from './Icons.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { pluginName, pluginText } from '../lib/plugin-text.js';

const MAX_LIST_ITEMS = 50;

// Satır silinince odak ve input durumu doğru satırda kalsın diye her satıra kalıcı anahtar
let rowKey = 0;
const withRowKey = (row) => ({ ...row, _k: ++rowKey });

function withRowKeys(settings, schema) {
  const out = { ...settings };
  for (const [key, s] of Object.entries(schema)) {
    if (s.type === 'list') out[key] = (settings[key] ?? []).map(withRowKey);
  }
  return out;
}

function emptyRow(fields) {
  return withRowKey(Object.fromEntries(fields.map(([key, s]) => [key, s.default ?? (s.type === 'boolean' ? false : '')])));
}

// Electron, ana süreçteki hatayı "Error invoking remote method ..." önekiyle iletir
const ipcMessage = (err) =>
  String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let suggestId = 0;

// Liste alanının manifest'te bildirdiği öneri sağlayıcısıyla arama (ör. Steam'de oyun adı).
// Seçilen sonuç satırın tamamını doldurur.
function SuggestBox({ plugin, schema, rows, onPick, inputRef, placeholder }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | empty | error
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const request = useRef(0);
  const [listId] = useState(() => `suggest-${++suggestId}`);

  const alreadyAdded = (value) =>
    rows.some((row) => Object.keys(value).every((k) => String(row[k] ?? '') === String(value[k])));

  useEffect(() => {
    const q = query.trim();
    const id = ++request.current; // geç gelen eski yanıtlar yok sayılır
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return undefined;
    }
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const found = await api.sources.suggest(plugin, schema.suggest.provider, q);
        if (id !== request.current) return;
        setResults(found);
        setActive(found.length ? 0 : -1);
        setStatus(found.length ? 'idle' : 'empty');
      } catch (err) {
        if (id !== request.current) return;
        setResults([]);
        setStatus('error');
        setError(ipcMessage(err));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, plugin, schema.suggest.provider]);

  function pick(result) {
    if (!alreadyAdded(result.value)) onPick(result.value);
    setQuery('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault(); // formu göndermesin
      if (results[active]) pick(results[active]);
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActive((active + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((active - 1 + results.length) % results.length);
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation(); // paneli değil yalnızca aramayı kapatsın
      setQuery('');
    }
  }

  const open = results.length > 0;
  return (
    <div className="suggest">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={placeholder}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        spellCheck="false"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="suggest-list">
          {results.map((r, i) => {
            const added = alreadyAdded(r.value);
            return (
              <li
                key={`${r.label}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={added || undefined}
                className="suggest-option"
                onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="suggest-label">{r.label}</span>
                <span className="suggest-detail">{added ? t('settings.suggest.added') : r.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      {status === 'loading' && <p className="help" role="status">{t('settings.suggest.searching')}</p>}
      {status === 'empty' && <p className="help" role="status">{t('settings.suggest.empty')}</p>}
      {status === 'error' && <p className="help help-error" role="status">{error}</p>}
    </div>
  );
}

// txt(yol, yedek): eklentinin manifest metni ya da kataloğundaki çevirisi
function ListField({ name, plugin, schema, rows, onChange, firstRef, txt }) {
  const { t } = useI18n();
  const base = `settings.${name}`;
  const fields = Object.entries(schema.item ?? {}).filter(([, s]) => s.type !== 'list');
  const hasSuggest = Boolean(schema.suggest?.provider);
  const columns = { gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr)) 30px` };
  const update = (index, key, value) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <fieldset className="field list-field">
      <legend>{txt(`${base}.label`, schema.label ?? name)}</legend>
      {schema.help && <p className="help">{txt(`${base}.help`, schema.help)}</p>}

      {hasSuggest && (
        <SuggestBox plugin={plugin} schema={schema} rows={rows} inputRef={firstRef}
          placeholder={txt(`${base}.suggest.placeholder`, schema.suggest.placeholder ?? t('settings.suggest.placeholder'))}
          onPick={(value) => rows.length < MAX_LIST_ITEMS && onChange([...rows, { ...emptyRow(fields), ...value }])} />
      )}

      {rows.length > 0 && (
        <div className="list-head" style={columns} aria-hidden="true">
          {fields.map(([key, s]) => <span key={key}>{txt(`${base}.item.${key}.label`, s.label ?? key)}</span>)}
        </div>
      )}

      {rows.map((row, index) => (
        <div key={row._k} className="list-row" style={columns}>
          {fields.map(([key, s], f) => {
            const label = t('settings.list.fieldLabel', { label: txt(`${base}.item.${key}.label`, s.label ?? key), index: index + 1 });
            const ref = !hasSuggest && index === 0 && f === 0 ? firstRef : undefined;
            return s.type === 'boolean' ? (
              <input key={key} ref={ref} type="checkbox" aria-label={label}
                checked={Boolean(row[key])} onChange={(e) => update(index, key, e.target.checked)} />
            ) : (
              <input key={key} ref={ref} type={s.type === 'number' ? 'number' : 'text'} aria-label={label}
                spellCheck="false" placeholder={txt(`${base}.item.${key}.placeholder`, s.placeholder ?? '')}
                value={row[key] ?? ''} onChange={(e) => update(index, key, e.target.value)} />
            );
          })}
          <button type="button" className="icon-btn" title={t('settings.list.removeRow')} aria-label={t('settings.list.removeRowLabel', { index: index + 1 })}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            <CloseIcon />
          </button>
        </div>
      ))}

      <div>
        <button type="button" className="btn" ref={!hasSuggest && rows.length === 0 ? firstRef : undefined}
          disabled={rows.length >= MAX_LIST_ITEMS} onClick={() => onChange([...rows, emptyRow(fields)])}>
          {txt(`${base}.addLabel`, schema.addLabel ?? t('settings.list.addRow'))}
        </button>
      </div>
    </fieldset>
  );
}

export default function SettingsPanel({ source, onClose }) {
  const i18n = useI18n();
  const { t } = i18n;
  const txt = (path, fallback) => pluginText(i18n, source, path, fallback);
  const [values, setValues] = useState(() => withRowKeys(source.settings, source.settingsSchema));
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

  const failing = source.jobs.filter((j) => j.state === 'error');
  const secretEntries = Object.entries(source.secretsSchema);
  const settingEntries = Object.entries(source.settingsSchema);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.sources.updateSettings(source.name, values);
      // Çekirdek boş satırları atar ve değerleri düzeltir; form kaydedilen hali göstersin
      const saved = (await api.sources.list()).find((s) => s.name === source.name);
      if (saved) setValues(withRowKeys(saved.settings, saved.settingsSchema));
      for (const [key, value] of Object.entries(secrets)) {
        if (value.trim()) await api.sources.setSecret(source.name, key, value.trim());
      }
      setSecrets({});
      setMessage({ type: 'ok', text: t('settings.saved') });
    } catch (err) {
      setMessage({ type: 'error', text: ipcMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function removeSecret(key) {
    await api.sources.setSecret(source.name, key, '');
    setMessage({ type: 'ok', text: t('settings.secretRemoved') });
  }

  let fieldIndex = 0;
  const refFor = () => (fieldIndex++ === 0 ? firstField : undefined);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <header className="panel-header">
          <div>
            <h2 id="panel-title">{t('settings.title', { name: pluginName(i18n, source) })}</h2>
            {source.description && <p className="panel-desc">{txt('description', source.description)}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('settings.close')}>
            <CloseIcon />
          </button>
        </header>

        {failing.map((j) => (
          <p key={j.key} className="notice notice-error">
            {source.jobs.length > 1
              ? t('settings.jobError', { title: j.title, error: j.errorI18n ?? j.error })
              : t(j.errorI18n ?? j.error)}
          </p>
        ))}

        <form onSubmit={save} className="panel-form">
          {secretEntries.map(([key, schema]) => {
            const isSet = source.secretsSet[key];
            return (
              <div key={key} className="field">
                <label htmlFor={`secret-${key}`}>{txt(`secrets.${key}.label`, schema.label ?? key)}</label>
                <input
                  ref={refFor()}
                  id={`secret-${key}`}
                  type="password"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder={isSet ? t('settings.secretSet') : t('settings.secretEmpty')}
                  value={secrets[key] ?? ''}
                  onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })}
                />
                {schema.help && <p className="help">{txt(`secrets.${key}.help`, schema.help)}</p>}
                <div className="field-links">
                  {schema.helpUrl && (
                    <button type="button" className="link" onClick={() => api.openExternal(schema.helpUrl)}>
                      {t('settings.openKeyPage')}
                    </button>
                  )}
                  {isSet && (
                    <button type="button" className="link link-danger" onClick={() => removeSecret(key)}>
                      {t('settings.removeSecret')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {settingEntries.map(([key, schema]) => schema.type === 'list' ? (
            <ListField key={key} name={key} plugin={source.name} schema={schema} rows={values[key] ?? []} txt={txt}
              firstRef={refFor()} onChange={(rows) => setValues({ ...values, [key]: rows })} />
          ) : (
            <div key={key} className={schema.type === 'boolean' ? 'field field-check' : 'field'}>
              {schema.type === 'boolean' ? (
                <label>
                  <input
                    ref={refFor()}
                    type="checkbox"
                    checked={Boolean(values[key])}
                    onChange={(e) => setValues({ ...values, [key]: e.target.checked })}
                  />
                  {txt(`settings.${key}.label`, schema.label ?? key)}
                </label>
              ) : (
                <>
                  <label htmlFor={`setting-${key}`}>{txt(`settings.${key}.label`, schema.label ?? key)}</label>
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
            <button type="button" className="btn" onClick={onClose}>{t('settings.closeButton')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
