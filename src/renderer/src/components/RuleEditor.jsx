import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { ipcMessage } from '../lib/ipc.js';
import { commandText } from '../lib/commands.js';
import {
  BASE_FIELDS, CRON_PRESETS, draftFromRule, metaFields, OPERATORS, presetFor, ruleFromDraft, templateFields, valueSuggestions
} from '../lib/automation.js';
import { MAX_ACTIONS, MAX_CONDITIONS } from '../../../../shared/automation.js';
import { CloseIcon } from './Icons.jsx';

const MAX_TEST_NOTIFICATIONS = 30;

// Kural düzenleyici: 1) tetikleyici 2) koşullar 3) eylemler. Alan, değer ve komut listeleri gerçek
// verilerden gelir; komut seçilince parametre formu komutun şemasından üretilir. "Dene" kuralı
// seçilen bildirime karşı core'da kuru çalıştırır (hiçbir komut çalışmaz).
export default function RuleEditor({ rule, commands, notifications, sources, onClose, onSaved }) {
  const i18n = useI18n();
  const { t, time } = i18n;
  const [draft, setDraft] = useState(() => draftFromRule(rule));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testId, setTestId] = useState('');
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState({ runs: [], error: null });
  const nameRef = useRef(null);

  const isNew = !rule.id;
  const triggerType = draft.trigger.type;
  // Denenecek bildirimler: koşuldaki kaynağın (source eq/in) bildirimleri önce, sonra en yeniler
  const wantedSources = draft.conditions
    .filter((c) => c.field === 'source' && (c.op === 'eq' || c.op === 'in'))
    .flatMap((c) => String(c.value).split(',').map((v) => v.trim().toLowerCase()))
    .filter(Boolean);
  const recent = useMemo(() => {
    const preferred = (n) => (wantedSources.includes(n.source) ? 1 : 0);
    return [...notifications].sort((a, b) => preferred(b) - preferred(a) || b.createdAt - a.createdAt).slice(0, MAX_TEST_NOTIFICATIONS);
  }, [notifications, wantedSources.join(',')]);
  const meta = useMemo(() => metaFields(notifications), [notifications]);
  const fields = [...BASE_FIELDS, ...meta];
  const commandLabel = (c) => {
    const title = commandText(i18n, c.plugin, c.title, c.name);
    const source = sources.find((s) => s.name === c.plugin);
    return c.plugin === 'pano' ? `${t('app.name')} · ${title}` : `${source?.label ?? c.plugin} · ${title}`;
  };
  const sortedCommands = useMemo(
    () => [...commands].sort((a, b) => commandLabel(a).localeCompare(commandLabel(b))),
    [commands, sources, i18n]
  );
  const byId = new Map(commands.map((c) => [c.id, c]));
  const fieldLabel = (f) => (BASE_FIELDS.includes(f) ? t(`automations.editor.fields.${f}`) : f);

  const update = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setResult(null);
  };
  const setCondition = (i, patch) => update({ conditions: draft.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setAction = (i, patch) => update({ actions: draft.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Zamanlanmış tetikleyicide sonraki çalışmaların önizlemesi (cron doğrulaması core'da)
  const cron = draft.trigger.cron ?? '';
  useEffect(() => {
    if (triggerType !== 'schedule') return undefined;
    const timer = setTimeout(async () => {
      try {
        const r = await api.automation.test({ name: 'preview', trigger: { type: 'schedule', cron }, actions: [{ command: 'pano/runAll' }] }, null);
        setPreview({ runs: r.nextRuns, error: null });
      } catch (err) {
        setPreview({ runs: [], error: ipcMessage(err) });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [triggerType, cron]);

  async function runTest() {
    setError(null);
    try {
      setResult(await api.automation.test(ruleFromDraft(draft, commands), triggerType === 'notification' ? testId || null : null));
    } catch (err) {
      setResult(null);
      setError(ipcMessage(err));
    }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.automation.save(ruleFromDraft(draft, commands));
      onSaved();
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const listId = (i) => `rule-values-${i}`;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel rule-editor" role="dialog" aria-modal="true" aria-labelledby="rule-title">
        <header className="panel-header">
          <h2 id="rule-title">{t(isNew ? 'automations.editor.titleNew' : 'automations.editor.titleEdit')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('automations.editor.close')}><CloseIcon /></button>
        </header>

        <form className="panel-form" onSubmit={save}>
          <div className="field">
            <label htmlFor="rule-name">{t('automations.editor.name')}</label>
            <input id="rule-name" ref={nameRef} type="text" maxLength={80} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          </div>
          <div className="field field-check">
            <label>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
              {t('automations.editor.enabled')}
            </label>
          </div>

          {/* 1. Tetikleyici */}
          <fieldset className="rule-step">
            <legend>{t('automations.editor.step1')}</legend>
            <div className="rule-choices" role="radiogroup">
              {[['notification', 'triggerNotification'], ['schedule', 'triggerSchedule'], ['app', 'triggerApp']].map(([type, key]) => (
                <label key={type} className="rule-choice">
                  <input
                    type="radio"
                    name="trigger"
                    checked={triggerType === type}
                    onChange={() => update({ trigger: type === 'schedule' ? { type, cron: cron || CRON_PRESETS.weekdayMorning } : type === 'app' ? { type, event: 'start' } : { type } })}
                  />
                  {t(`automations.editor.${key}`)}
                </label>
              ))}
            </div>
            {triggerType === 'schedule' && (
              <div className="rule-schedule">
                <div className="field">
                  <label htmlFor="rule-preset">{t('automations.editor.preset')}</label>
                  <select
                    id="rule-preset"
                    value={presetFor(cron)}
                    onChange={(e) => e.target.value !== 'custom' && update({ trigger: { type: 'schedule', cron: CRON_PRESETS[e.target.value] } })}
                  >
                    {[...Object.keys(CRON_PRESETS), 'custom'].map((k) => (
                      <option key={k} value={k}>{t(`automations.editor.presets.${k}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rule-cron">{t('automations.editor.cron')}</label>
                  <input id="rule-cron" type="text" value={cron} spellCheck="false"
                    onChange={(e) => update({ trigger: { type: 'schedule', cron: e.target.value } })} />
                  <p className="help">{t('automations.editor.cronHelp')}</p>
                  {preview.error && <p className="help help-error">{preview.error}</p>}
                  {preview.runs.length > 0 && (
                    <p className="help">
                      {t('automations.editor.nextRuns')}: {preview.runs.map((at) => time.shortDateTime(at)).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </fieldset>

          {/* 2. Koşullar */}
          <fieldset className="rule-step">
            <legend>{t('automations.editor.step2')}</legend>
            {triggerType !== 'notification' ? (
              <p className="help">{t('automations.editor.conditionsOnlyNotification')}</p>
            ) : (
              <>
                <p className="help">{t('automations.editor.conditionsHelp')}</p>
                {draft.conditions.map((c, i) => {
                  const suggestions = valueSuggestions(c.field, { notifications, sources: sources.map((s) => ({ name: s.name, label: s.label })), t, appLabel: t('app.name') });
                  return (
                    <div key={i} className="rule-row">
                      <select aria-label={t('automations.editor.field')} value={c.field} onChange={(e) => setCondition(i, { field: e.target.value })}>
                        {fields.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
                        {!fields.includes(c.field) && <option value={c.field}>{c.field}</option>}
                      </select>
                      <select aria-label={t('automations.editor.op')} value={c.op} onChange={(e) => setCondition(i, { op: e.target.value })}>
                        {OPERATORS.map((op) => <option key={op} value={op}>{t(`automations.editor.ops.${op}`)}</option>)}
                      </select>
                      <input
                        type="text"
                        aria-label={t('automations.editor.value')}
                        list={suggestions.length ? listId(i) : undefined}
                        placeholder={c.op === 'in' ? t('automations.editor.inHelp') : ''}
                        value={c.value}
                        onChange={(e) => setCondition(i, { value: e.target.value })}
                      />
                      {suggestions.length > 0 && (
                        <datalist id={listId(i)}>
                          {suggestions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </datalist>
                      )}
                      <button type="button" className="icon-btn" onClick={() => update({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                        aria-label={t('automations.editor.removeCondition')} title={t('automations.editor.removeCondition')}>
                        <CloseIcon />
                      </button>
                      {/* Etiket anahtar olarak saklanır; okunur hali altta */}
                      {c.field === 'tags' && c.value && t(c.value) !== c.value && <span className="rule-row-hint">= {t(c.value)}</span>}
                    </div>
                  );
                })}
                {draft.conditions.length < MAX_CONDITIONS && (
                  <button type="button" className="link rule-add" onClick={() => update({ conditions: [...draft.conditions, { field: 'source', op: 'eq', value: '' }] })}>
                    + {t('automations.editor.addCondition')}
                  </button>
                )}
              </>
            )}
          </fieldset>

          {/* 3. Eylemler */}
          <fieldset className="rule-step">
            <legend>{t('automations.editor.step3')}</legend>
            <p className="help">{t('automations.editor.templateHelp', { fields: templateFields(triggerType, meta).join(' ') })}</p>
            {draft.actions.map((a, i) => {
              const command = byId.get(a.command);
              const params = Object.entries(command?.params ?? {}).filter(([, s]) => !s.secret && s.type !== 'list');
              return (
                <div key={i} className="rule-action">
                  <div className="rule-action-head">
                    <select aria-label={t('automations.editor.command')} value={a.command} onChange={(e) => setAction(i, { command: e.target.value, params: {} })}>
                      <option value="">{t('automations.editor.chooseCommand')}</option>
                      {sortedCommands.map((c) => <option key={c.id} value={c.id}>{commandLabel(c)}</option>)}
                      {a.command && !command && <option value={a.command}>{a.command}</option>}
                    </select>
                    {draft.actions.length > 1 && (
                      <button type="button" className="icon-btn" onClick={() => update({ actions: draft.actions.filter((_, j) => j !== i) })}
                        aria-label={t('automations.editor.removeAction')} title={t('automations.editor.removeAction')}>
                        <CloseIcon />
                      </button>
                    )}
                  </div>
                  {command?.confirm && <p className="notice rule-warning">{t('automations.editor.confirmWarning')}</p>}
                  {command && params.length === 0 && <p className="help">{t('automations.editor.noParams')}</p>}
                  {params.map(([key, s]) => {
                    const label = commandText(i18n, command.plugin, s.label, key);
                    const id = `rule-a${i}-${key}`;
                    const value = a.params[key] ?? '';
                    return (
                      <div key={key} className="field">
                        <label htmlFor={id}>{label}{s.required ? ' *' : ''}</label>
                        {s.type === 'boolean' ? (
                          <select id={id} value={String(value)} onChange={(e) => setAction(i, { params: { ...a.params, [key]: e.target.value } })}>
                            <option value="" />
                            <option value="true">{t('palette.yes')}</option>
                            <option value="false">{t('palette.no')}</option>
                          </select>
                        ) : (
                          <input id={id} type="text" value={value}
                            placeholder={s.placeholder ? commandText(i18n, command.plugin, s.placeholder) : s.type === 'number' ? '0 · {{meta.…}}' : ''}
                            onChange={(e) => setAction(i, { params: { ...a.params, [key]: e.target.value } })} />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {draft.actions.length < MAX_ACTIONS && (
              <button type="button" className="link rule-add" onClick={() => update({ actions: [...draft.actions, { command: '', params: {} }] })}>
                + {t('automations.editor.addAction')}
              </button>
            )}
          </fieldset>

          {/* Dene: kuru çalıştırma */}
          <section className="rule-test" aria-labelledby="rule-test-title">
            <h3 id="rule-test-title">{t('automations.editor.test')}</h3>
            <p className="help">{t('automations.editor.testHelp')}</p>
            <div className="rule-test-controls">
              {triggerType === 'notification' && (
                recent.length === 0 ? <p className="help">{t('automations.editor.noNotifications')}</p> : (
                  <select aria-label={t('automations.editor.chooseNotification')} value={testId} onChange={(e) => { setTestId(e.target.value); setResult(null); }}>
                    <option value="">{t('automations.editor.chooseNotification')}</option>
                    {recent.map((n) => <option key={n.id} value={n.id}>{`${n.source} · ${n.title}`.slice(0, 90)}</option>)}
                  </select>
                )
              )}
              <button type="button" className="btn" onClick={runTest} disabled={triggerType === 'notification' && !testId}>
                {t('automations.editor.test')}
              </button>
            </div>
            {result && <TestResult result={result} fieldLabel={fieldLabel} />}
          </section>

          {error && <p className="notice notice-error" role="alert">{error}</p>}

          <div className="panel-actions">
            <button type="button" className="btn" onClick={onClose}>{t('automations.editor.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{t('automations.editor.save')}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function TestResult({ result, fieldLabel }) {
  const i18n = useI18n();
  const { t } = i18n;
  const show = (v) => (v === null || v === undefined || v === '' ? t('automations.editor.emptyValue') : Array.isArray(v) ? v.map((x) => t(String(x))).join(', ') : String(v));
  return (
    <div className="rule-result" data-matched={result.matched}>
      {result.matched !== null && (
        <p className="rule-result-head">{t(result.matched ? 'automations.editor.matched' : 'automations.editor.notMatched')}</p>
      )}
      {result.conditions.length > 0 && (
        <ul className="rule-result-list">
          {result.conditions.map((c, i) => (
            <li key={i} data-ok={c.ok}>
              <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span>{' '}
              {fieldLabel(c.field)} {t(`automations.editor.ops.${c.op}`)} “{show(c.value)}” · <span className="muted">{t('automations.editor.actual', { value: show(c.actual) })}</span>
            </li>
          ))}
        </ul>
      )}
      {result.matched !== false && result.actions.length > 0 && (
        <>
          <p className="rule-result-sub">{t('automations.editor.wouldRun')}</p>
          <ul className="rule-result-list">
            {result.actions.map((a, i) => (
              <li key={i} data-ok={!a.error}>
                <strong>{a.title ? commandText(i18n, a.plugin, a.title) : a.command}</strong>
                {a.confirm && <> · <span className="muted">{t('automations.editor.needsConfirm')}</span></>}
                {a.error ? <span className="rule-result-error"> — {t(a.errorI18n ?? a.error)}</span> : (
                  <span className="rule-result-params">{JSON.stringify(a.params)}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
