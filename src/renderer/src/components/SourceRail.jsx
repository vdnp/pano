import { GearIcon, RefreshIcon } from './Icons.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { pluginName } from '../lib/plugin-text.js';
import { jobKey } from '../lib/filter.js';

function jobStatusText(job, now, { t, time }, source) {
  if (!job && source?.kinds?.sources === false) return t('rail.status.cardsOnly');
  if (!job) return t('rail.status.waiting');
  if (job.state === 'running') return t('rail.status.running');
  // Anahtarlı hata dil değişince yeniden çevrilir; düz metin olduğu gibi gösterilir
  if (job.state === 'error') return t(job.errorI18n ?? job.error);
  if (job.lastSuccess) return t('rail.status.lastCheck', { when: time.relativeTime(job.lastSuccess, now) });
  return t('rail.status.firstPending');
}

// Birden fazla işi olan eklentide (ör. her RSS akışı) satırın özet durumu
function summaryState(jobs) {
  if (jobs.some((j) => j.state === 'error')) return 'error';
  if (jobs.some((j) => j.state === 'running')) return 'running';
  if (jobs.every((j) => j.state === 'ok')) return 'ok';
  return 'idle';
}

// Alt satırları olan eklentide özet yalnızca hata varken yazılır; alt satırlar kendini anlatır
function summaryText(jobs, t) {
  const failed = jobs.filter((j) => j.state === 'error').length;
  return failed ? t('rail.summaryWithErrors', { count: jobs.length, failed }) : null;
}

export default function SourceRail({
  sources, counts, selection, view, onSelect, onShowPanel, onShowHistory, onShowAutomations, approvalCount = 0,
  onRunNow, onOpenSettings, onOpenAppSettings, now
}) {
  const i18n = useI18n();
  const { t } = i18n;

  return (
    <aside className="rail">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        {t('app.name')}
      </div>

      {/* Ana alanın görünümü: eklenti kartlarından oluşan Panel ya da bildirim akışı */}
      <nav className="rail-views" aria-label={t('nav.label')}>
        <button
          className="rail-all"
          aria-current={view === 'panel' ? 'true' : undefined}
          onClick={onShowPanel}
        >
          <span>{t('nav.panel')}</span>
        </button>
        <button
          className="rail-all"
          aria-current={view === 'notifications' && selection.source === null ? 'true' : undefined}
          onClick={() => onSelect(null)}
        >
          <span>{t('nav.notifications')}</span>
          {counts.total > 0 && <span className="count">{counts.total}</span>}
        </button>
        <button
          className="rail-all"
          aria-current={view === 'history' ? 'true' : undefined}
          onClick={onShowHistory}
        >
          <span>{t('nav.history')}</span>
        </button>
        <button
          className="rail-all"
          aria-current={view === 'automations' ? 'true' : undefined}
          onClick={onShowAutomations}
        >
          <span>{t('nav.automations')}</span>
          {/* Onay bekleyen otomasyon komutları */}
          {approvalCount > 0 && <span className="count">{approvalCount}</span>}
        </button>
      </nav>

      <nav aria-label={t('rail.sources')}>

        <h2 className="rail-heading">{t('rail.sources')}</h2>

        {sources.length === 0 && <p className="rail-empty">{t('rail.empty')}</p>}

        <ul className="source-list">
          {sources.map((source) => {
            const name = pluginName(i18n, source);
            const { jobs } = source;
            const multi = jobs.length > 1;
            const job = jobs[0];
            const failed = Boolean(source.startError);
            const startError = failed ? t(source.startErrorI18n ?? source.startError) : undefined;
            const state = failed ? 'error' : multi ? summaryState(jobs) : job?.state ?? 'idle';
            const singleError = job?.state === 'error' ? t(job.errorI18n ?? job.error) : undefined;
            const statusText = failed ? t('rail.status.startFailed') : multi ? summaryText(jobs, t) : jobStatusText(job, now, i18n, source);
            // Hata satırında ayarları açan kısa yol (anahtar eksik, adres hatalı vb. çoğu hata oradan düzelir)
            const fixable = state === 'error';
            return (
              <li key={source.name} className="source" data-state={state}>
                <button
                  className="source-main"
                  // Alt satır (oyun/akış) seçiliyse vurgu onda olur
                  aria-current={view === 'notifications' && selection.source === source.name && !selection.job ? 'true' : undefined}
                  onClick={() => onSelect(source.name)}
                >
                  <span className="source-name">
                    <span className="status-dot" aria-hidden="true" />
                    {name}
                    {counts.bySource[source.name] > 0 && (
                      <span className="count">{counts.bySource[source.name]}</span>
                    )}
                  </span>
                  {statusText && (
                    <span className="source-status" title={failed ? startError : multi ? undefined : singleError}>
                      {statusText}
                    </span>
                  )}
                </button>
                {fixable && (
                  <button className="link source-fix" onClick={() => onOpenSettings(source.name)}>
                    {t('rail.fix')}
                  </button>
                )}
                <div className="source-actions">
                  {job && (
                    <button
                      className="icon-btn"
                      onClick={() => jobs.forEach((j) => onRunNow(j.key))}
                      disabled={jobs.every((j) => j.state === 'running')}
                      aria-label={t('rail.runNowLabel', { name })}
                      title={t('rail.runNow')}
                    >
                      <RefreshIcon />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    onClick={() => onOpenSettings(source.name)}
                    aria-label={t('rail.settingsLabel', { name })}
                    title={t('rail.settings')}
                  >
                    <GearIcon />
                  </button>
                </div>

                {multi && (
                  <ul className="job-list" aria-label={t('rail.jobsLabel', { name })}>
                    {jobs.map((j) => {
                      const unread = counts.byJob[jobKey(source.name, j.source)] ?? 0;
                      return (
                      <li key={j.key} className="job" data-state={j.state}>
                        <span className="status-dot" aria-hidden="true" />
                        <button
                          className="job-main"
                          aria-current={view === 'notifications' && selection.source === source.name && selection.job === j.source ? 'true' : undefined}
                          onClick={() => onSelect(source.name, j.source)}
                        >
                          <span className="job-title">
                            <span className="job-name">{j.title}</span>
                            {unread > 0 && <span className="count">{unread}</span>}
                          </span>
                          {/* Durum yalnızca hata ya da kontrol sürerken yazılır; normalde nokta yeter */}
                          {(j.state === 'error' || j.state === 'running') && (
                            <span className="job-status" title={j.state === 'error' ? t(j.errorI18n ?? j.error) : undefined}>
                              {jobStatusText(j, now, i18n)}
                            </span>
                          )}
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => onRunNow(j.key)}
                          disabled={j.state === 'running'}
                          aria-label={t('rail.runNowLabel', { name: j.title })}
                          title={t('rail.runNow')}
                        >
                          <RefreshIcon />
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <button className="rail-footer" onClick={onOpenAppSettings}>
        <GearIcon />
        {t('rail.appSettings')}
      </button>
    </aside>
  );
}
