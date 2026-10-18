import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { commandText } from '../lib/commands.js';
import { CloseIcon } from './Icons.jsx';

// Sağ alt köşe: çalışan komutların ilerlemesi ve iptali; bitince sonuç mesajı
export default function RunToasts({ runs, onDismiss }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (runs.length === 0) return null;

  return (
    <section className="runs" aria-label={t('runs.label')}>
      {runs.slice(-4).map((run) => {
        const title = commandText(i18n, run.plugin, run.title, run.command);
        const percent = run.progress == null ? null : Math.round(run.progress * 100);
        const result =
          run.status === 'error' ? t(run.errorI18n ?? run.error)
          : run.status === 'cancelled' ? t('runs.cancelled')
          : run.status === 'ok' ? run.resultMessage || t('runs.done')
          : null;
        return (
          <article key={run.runId} className="run" data-status={run.status} role="status">
            <div className="run-head">
              <span className="run-title" title={title}>{title}</span>
              {run.status === 'running' ? (
                <button className="link run-cancel" onClick={() => api.commands.cancel(run.runId).catch(() => {})} aria-label={t('runs.cancelLabel', { title })}>
                  {t('runs.cancel')}
                </button>
              ) : (
                <button className="icon-btn" onClick={() => onDismiss(run.runId)} aria-label={t('runs.dismiss')} title={t('runs.dismiss')}>
                  <CloseIcon />
                </button>
              )}
            </div>
            {run.status === 'running' ? (
              <>
                {/* İlerleme bildirmeyen komutta belirsiz (kayan) çubuk */}
                <div className="run-track" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
                  <span className="run-fill" data-indeterminate={percent == null} style={percent == null ? undefined : { width: `${percent}%` }} />
                </div>
                <p className="run-message">{run.message || t('runs.running')}</p>
              </>
            ) : (
              <p className="run-message">{result}</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
