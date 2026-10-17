import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { ipcMessage } from '../lib/ipc.js';
import {
  commandText, loadRecents, paramSteps, pushRecent, rankCommands, readStepValue, saveRecents
} from '../lib/commands.js';

// Komut paleti: arama → (varsa) parametre adımları → (gerekirse) onay → çalıştır.
// Tamamen klavyeyle kullanılır: ↑↓ seç, Enter ilerle, Esc bir adım geri / kapat.
// commands: core'un komutları; uiCommands: arayüzün kendi işleri ({ id, text, run }), geçmişe yazılmaz.
// request: paleti doğrudan bir komutun parametre adımında açar (geçmişten tekrar çalıştırma).
export default function CommandPalette({ commands, uiCommands, sourceNames, request, onClose }) {
  const i18n = useI18n();
  const { t } = i18n;
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const [recents, setRecents] = useState(loadRecents);
  const [mode, setMode] = useState('search'); // search | param | confirm
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [command, setCommand] = useState(null);
  const [values, setValues] = useState({});
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [origin, setOrigin] = useState('palette');
  const [suggest, setSuggest] = useState({ status: 'idle', items: [] });
  const [error, setError] = useState(null);

  const title = (c) => commandText(i18n, c.plugin, c.title, c.name);
  const label = (key, s) => commandText(i18n, command.plugin, s.label, key);

  // Arama listesi: uygulama + eklenti komutları (paletten gizli olanlar hariç)
  const items = useMemo(() => [
    ...uiCommands.map((c) => ({ ...c, kind: 'ui' })),
    ...commands.filter((c) => c.palette).map((c) => ({
      id: c.id,
      kind: 'core',
      text: title(c),
      detail: c.plugin === 'pano' ? '' : sourceNames[c.plugin] ?? c.plugin,
      command: c
    }))
  ], [commands, uiCommands, sourceNames, i18n]);
  const ranked = useMemo(() => rankCommands(items, query, recents), [items, query, recents]);
  const results = [...ranked.recent, ...ranked.rest];

  const stepKey = mode === 'param' ? steps[stepIndex] : null;
  const schema = stepKey ? command.params[stepKey] : null;

  // Parametre adımındaki seçenekler: evet/hayır, öneriler ve "yazılanı kullan"
  const options = useMemo(() => {
    if (!schema) return [];
    if (schema.type === 'boolean') {
      return [{ id: 'yes', text: t('palette.yes'), value: true }, { id: 'no', text: t('palette.no'), value: false }];
    }
    if (!schema.suggest) return [];
    const list = suggest.items.map((s, i) => ({ id: `s${i}`, text: s.label, detail: s.detail, suggestion: s.value }));
    if (query.trim()) list.push({ id: 'typed', text: t('palette.useTyped', { value: query.trim() }), typed: true });
    return list;
  }, [schema, suggest.items, query, t]);

  const list = mode === 'search' ? results : options;

  function begin(cmd, prefill = {}, from = 'palette') {
    const { unsupported, steps: keys } = paramSteps(cmd, prefill);
    setCommand(cmd);
    setOrigin(from);
    setError(unsupported ? t('palette.listUnsupported') : null);
    if (unsupported) return;
    setValues(prefill);
    setSteps(keys);
    if (keys.length) enterStep(cmd, keys, 0, prefill);
    else if (cmd.confirm) setMode('confirm');
    else execute(cmd, prefill, from);
  }

  function enterStep(cmd, keys, index, current) {
    const s = cmd.params[keys[index]];
    setMode('param');
    setStepIndex(index);
    setQuery(s.type === 'boolean' || current[keys[index]] === undefined ? '' : String(current[keys[index]]));
    setActive(s.type === 'boolean' ? (s.default ? 0 : 1) : 0);
    setSuggest({ status: 'idle', items: [] });
    setError(null);
  }

  // Öneri birden fazla alanı doldurmuş olabilir; dolu adımlar atlanır
  function advance(next) {
    setValues(next);
    let i = stepIndex + 1;
    while (i < steps.length && next[steps[i]] !== undefined && next[steps[i]] !== '') i++;
    if (i < steps.length) enterStep(command, steps, i, next);
    else if (command.confirm) {
      setMode('confirm');
      setError(null);
    } else execute(command, next, origin);
  }

  async function execute(cmd, params, from) {
    try {
      await api.commands.run(cmd.id, params, from);
      const next = pushRecent(recents, cmd.id);
      saveRecents(next);
      setRecents(next);
      onClose();
    } catch (err) {
      // Doğrulama hatası (ör. boş zorunlu alan): palet açık kalır, mesaj gösterilir
      setError(ipcMessage(err));
    }
  }

  function choose(item) {
    if (!item) return;
    if (item.kind === 'ui') {
      const next = pushRecent(recents, item.id);
      saveRecents(next);
      onClose();
      item.run();
      return;
    }
    begin(item.command);
  }

  function submitStep(index = active) {
    const option = options[index];
    if (option?.suggestion) return advance({ ...values, ...option.suggestion });
    const raw = schema.type === 'boolean' ? option?.value : query;
    const result = readStepValue(schema, raw);
    if (result.error) {
      setError(t(`core.commands.params.${result.error}`, { param: label(stepKey, schema), min: schema.min ?? '−∞', max: schema.max ?? '∞' }));
      return;
    }
    const next = { ...values };
    if (result.value === undefined) delete next[stepKey];
    else next[stepKey] = result.value;
    advance(next);
  }

  function back() {
    if (mode === 'search') return onClose();
    // Geçmişten açıldıysa ilk adımdan geri çıkmak paleti kapatır
    if (mode === 'param' && stepIndex > 0) return enterStep(command, steps, stepIndex - 1, values);
    if (mode === 'confirm' && steps.length) return enterStep(command, steps, steps.length - 1, values);
    if (request) return onClose();
    setMode('search');
    setCommand(null);
    setQuery('');
    setActive(0);
    setError(null);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'search') choose(results[active]);
      else if (mode === 'param') submitStep();
      else execute(command, values, origin);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      back();
    }
  }

  // Geçmişten açılış: doğrudan komutun ilk eksik parametresi
  useEffect(() => {
    if (request) begin(request.command, request.prefill, request.origin);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode, stepIndex]);

  // Seçili satır görünür kalsın
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Öneriler: yazmayı bitirince (250 ms) core'daki sağlayıcıya sorulur
  useEffect(() => {
    if (!schema?.suggest) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setSuggest({ status: 'idle', items: [] });
      return undefined;
    }
    let cancelled = false;
    setSuggest((s) => ({ ...s, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const found = await api.commands.suggest(command.id, stepKey, q);
        if (!cancelled) {
          setSuggest({ status: 'ready', items: found });
          setActive(0);
        }
      } catch (err) {
        if (!cancelled) setSuggest({ status: 'error', items: [], error: ipcMessage(err) });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, stepKey, command]);

  const listId = 'palette-list';
  const activeId = list[active] ? `palette-opt-${active}` : undefined;
  // Parametre adımında: öneri kutusunun ya da alanın kendi ipucu, yoksa alan adı
  const hintText = schema?.suggest?.placeholder || schema?.placeholder;
  const placeholder = mode === 'search'
    ? t('palette.placeholder')
    : schema ? (hintText ? commandText(i18n, command.plugin, hintText) : label(stepKey, schema)) : '';

  const renderOption = (item, i) => (
    <li
      key={item.id}
      id={`palette-opt-${i}`}
      role="option"
      aria-selected={i === active}
      className="palette-option"
      onMouseMove={() => setActive(i)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (mode === 'search' ? choose(item) : submitStep(i))}
    >
      <span className="palette-option-text">{item.text}</span>
      {item.detail && <span className="palette-option-detail">{item.detail}</span>}
    </li>
  );

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.label')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {mode !== 'search' && command && (
          <div className="palette-crumb">
            <span className="palette-crumb-title">{title(command)}</span>
            {mode === 'param' && steps.length > 1 && (
              <span className="palette-crumb-step">{t('palette.step', { step: stepIndex + 1, total: steps.length })}</span>
            )}
          </div>
        )}

        {mode === 'confirm' ? (
          <div className="palette-confirm">
            <p>{t('palette.confirm', { title: title(command) })}</p>
            <div className="palette-confirm-actions">
              <button ref={inputRef} className="btn btn-primary" onClick={() => execute(command, values, origin)}>
                {t('palette.run')}
              </button>
              <button className="btn" onClick={back}>{t('palette.back')}</button>
            </div>
          </div>
        ) : (
          <>
            {mode === 'param' && <label className="palette-label" htmlFor="palette-input">{label(stepKey, schema)}</label>}
            <input
              id="palette-input"
              ref={inputRef}
              className="palette-input"
              type="text"
              autoComplete="off"
              spellCheck="false"
              role="combobox"
              aria-expanded={list.length > 0}
              aria-controls={listId}
              aria-activedescendant={activeId}
              placeholder={placeholder}
              value={query}
              readOnly={schema?.type === 'boolean'}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setError(null);
              }}
            />
          </>
        )}

        {error && <p className="notice notice-error palette-notice" role="alert">{error}</p>}

        {mode === 'search' && (
          <ul id={listId} ref={listRef} className="palette-list" role="listbox" aria-label={t('palette.label')}>
            {results.length === 0 && <li className="palette-empty">{t('palette.empty')}</li>}
            {ranked.recent.length > 0 && <li className="palette-group" role="presentation">{t('palette.recent')}</li>}
            {ranked.recent.map((item, i) => renderOption(item, i))}
            {ranked.recent.length > 0 && ranked.rest.length > 0 && (
              <li className="palette-group" role="presentation">{t('palette.all')}</li>
            )}
            {ranked.rest.map((item, i) => renderOption(item, ranked.recent.length + i))}
          </ul>
        )}

        {mode === 'param' && (
          <>
            {options.length > 0 && (
              <ul id={listId} ref={listRef} className="palette-list" role="listbox" aria-label={label(stepKey, schema)}>
                {options.map(renderOption)}
              </ul>
            )}
            <p className="palette-help">
              {schema.suggest && suggest.status === 'loading' && t('palette.searching')}
              {schema.suggest && suggest.status === 'idle' && t('palette.suggestHint')}
              {schema.suggest && suggest.status === 'ready' && suggest.items.length === 0 && t('palette.noSuggestions')}
              {schema.suggest && suggest.status === 'error' && suggest.error}
              {!schema.required && schema.type !== 'boolean' && <> {t('palette.optional')}</>}
            </p>
          </>
        )}

        <p className="palette-hint">{mode === 'confirm' ? t('palette.confirmHint') : t('palette.hint')}</p>
      </div>
    </div>
  );
}
