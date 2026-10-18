import { useEffect, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { ipcMessage } from '../lib/ipc.js';
import { commandText, summarizeParams } from '../lib/commands.js';
import { emptyRule } from '../lib/automation.js';
import RuleEditor from './RuleEditor.jsx';
import { RATE_LIMIT } from '../../../../shared/automation.js';

// Otomasyonlar: onay bekleyen komutlar, kural listesi (aç/kapat, son çalışma), düzenleyici ve şablonlar
export default function AutomationsView({ commands, notifications, sources, now }) {
  const i18n = useI18n();
  const { t, time } = i18n;
  const [rules, setRules] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [list, pending] = await Promise.all([api.automation.list(), api.automation.approvals()]);
        setRules(list);
        setApprovals(pending);
      } catch (err) {
        setError(ipcMessage(err));
      }
    };
    load();
    // Şablonlar yüklenemezse liste boş kalır; kapanış sırasında da reddedilebilir
    api.automation.templates().then(setTemplates).catch(() => {});
    return api.on('automation:changed', load);
  }, []);

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(ipcMessage(err));
    }
  };

  const triggerText = (r) =>
    r.trigger.type === 'schedule' ? t('automations.trigger.schedule', { cron: r.trigger.cron }) : t(`automations.trigger.${r.trigger.type}`);

  return (
    <main className="automations">
      <header className="feed-header">
        <div>
          <h1>{t('automations.title')}</h1>
          <p className="feed-sub">{t('automations.subtitle', { count: rules?.length ?? 0 })}</p>
        </div>
        <div className="feed-tools">
          <button className="btn" aria-expanded={showTemplates} onClick={() => setShowTemplates(!showTemplates)}>
            {t('automations.fromTemplate')}
          </button>
          <button className="btn btn-primary" onClick={() => setEditing(emptyRule())}>{t('automations.new')}</button>
        </div>
      </header>

      <div className="automations-body">
        {showTemplates && (
          <section className="auto-templates" aria-label={t('automations.templatesLabel')}>
            {templates.map((tpl) => (
              <button key={tpl.key} className="auto-template" onClick={() => {
                setShowTemplates(false);
                // Şablon kaydedilmeden düzenleyicide açılır
                const { key, ...draft } = tpl;
                setEditing(draft);
              }}>
                <span className="auto-template-name">{tpl.name}</span>
                <span className="auto-template-meta">{triggerText(tpl)}</span>
              </button>
            ))}
          </section>
        )}

        {approvals.length > 0 && (
          <section className="auto-approvals" aria-labelledby="approvals-title">
            <h2 id="approvals-title">{t('automations.approvals.title')}</h2>
            {approvals.map((a) => (
              <div key={a.id} className="auto-approval">
                <div className="auto-approval-text">
                  <strong>{t('automations.approvals.body', { rule: a.ruleName, command: commandText(i18n, a.plugin, a.title) })}</strong>
                  {summarizeParams(a.params) && <span className="auto-meta">{summarizeParams(a.params)}</span>}
                  <span className="auto-meta">{t('automations.approvals.expires', { at: a.expiresAt })}</span>
                </div>
                <button className="btn btn-primary" onClick={() => act(() => api.automation.approve(a.id))}>{t('automations.approvals.approve')}</button>
                <button className="btn" onClick={() => act(() => api.automation.reject(a.id))}>{t('automations.approvals.reject')}</button>
              </div>
            ))}
          </section>
        )}

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {rules?.length === 0 && <div className="empty"><p>{t('automations.empty')}</p></div>}

        <ul className="auto-list">
          {(rules ?? []).map((r) => {
            const last = r.state.lastRun;
            return (
              <li key={r.id} className="auto-rule" data-enabled={r.enabled}>
                <label className="switch" title={t('automations.toggleLabel', { name: r.name })}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={r.enabled}
                    aria-label={t('automations.toggleLabel', { name: r.name })}
                    onChange={(e) => act(() => api.automation.setEnabled(r.id, e.target.checked))}
                  />
                  <span className="switch-track" aria-hidden="true" />
                </label>
                <div className="auto-main">
                  <span className="auto-name">{r.name}</span>
                  <span className="auto-meta">
                    {triggerText(r)}
                    {r.trigger.type === 'notification' && <> · {t('automations.conditionCount', { count: r.conditions.length })}</>}
                    {' · '}{t('automations.actionCount', { count: r.actions.length })}
                    {r.nextRuns[0] && <> · {t('automations.nextRun', { at: r.nextRuns[0] })}</>}
                  </span>
                  <span className="auto-last" data-status={last?.status}>
                    {last
                      ? <>{t('automations.lastRun', { when: time.relativeTime(last.at, now) })} · {t(`automations.status.${last.status}`)}{last.message ? ` — ${t(last.messageI18n ?? last.message)}` : ''}</>
                      : t('automations.neverRun')}
                  </span>
                  {/* Dış bildirim seli: kural açık kalır, fazla çalışmalar atlanır (pencere sıfırlanınca null) */}
                  {r.state.throttled && (
                    <span className="auto-warning">{t(r.state.throttled.messageI18n ?? r.state.throttled.message)}</span>
                  )}
                  {r.state.disabledReason === 'rateLimit' && !r.enabled && (
                    <span className="auto-warning">{t('automations.disabledRateLimit', { count: RATE_LIMIT })}</span>
                  )}
                </div>
                <div className="auto-actions">
                  <button className="link" onClick={() => setEditing(r)}>{t('automations.edit')}</button>
                  <button className="link link-danger" onClick={() => window.confirm(t('automations.deleteConfirm', { name: r.name })) && act(() => api.automation.remove(r.id))}>
                    {t('automations.delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <RuleEditor
          rule={editing}
          commands={commands}
          notifications={notifications}
          sources={sources}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </main>
  );
}
