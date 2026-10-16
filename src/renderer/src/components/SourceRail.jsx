import { GearIcon, RefreshIcon } from './Icons.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { pluginName } from '../lib/plugin-text.js';
import { jobKey } from '../lib/filter.js';

function jobStatusText(job, now, { t, time }) {
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

function summaryText(jobs, t) {
  const failed = jobs.filter((j) => j.state === 'error').length;
  if (jobs.some((j) => j.state === 'running')) return t('rail.status.running');
  return failed
    ? t('rail.summaryWithErrors', { count: jobs.length, failed })
    : t('rail.summary', { count: jobs.length });
}

export default function SourceRail({
  sources, counts, selection, onSelect, onRunNow, onOpenSettings, onOpenAppSettings, now
}) {
  const i18n = useI18n();
  const { t } = i18n;

  return (
    <aside className="rail">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Pano
      </div>

      <nav aria-label={t('rail.sources')}>
        <button
          className="rail-all"
          aria-current={selection.source === null ? 'true' : undefined}
          onClick={() => onSelect(null)}
        >
          <span>{t('rail.all')}</span>
          {counts.total > 0 && <span className="count">{counts.total}</span>}
        </button>

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
            return (
              <li key={source.name} className="source" data-state={state}>
                <button
                  className="source-main"
                  // Alt satır (oyun/akış) seçiliyse vurgu onda olur
                  aria-current={selection.source === source.name && !selection.job ? 'true' : undefined}
                  onClick={() => onSelect(source.name)}
                >
                  <span className="source-name">
                    <span className="status-dot" aria-hidden="true" />
                    {name}
                    {counts.bySource[source.name] > 0 && (
                      <span className="count">{counts.bySource[source.name]}</span>
                    )}
                  </span>
                  <span className="source-status" title={failed ? startError : multi ? undefined : singleError}>
                    {failed ? t('rail.status.startFailed') : multi ? summaryText(jobs, t) : jobStatusText(job, now, i18n)}
                  </span>
                </button>
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
                          aria-current={selection.source === source.name && selection.job === j.source ? 'true' : undefined}
                          onClick={() => onSelect(source.name, j.source)}
                        >
                          <span className="job-title">
                            <span className="job-name">{j.title}</span>
                            {unread > 0 && <span className="count">{unread}</span>}
                          </span>
                          <span className="job-status" title={j.state === 'error' ? t(j.errorI18n ?? j.error) : undefined}>
                            {jobStatusText(j, now, i18n)}
                          </span>
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
