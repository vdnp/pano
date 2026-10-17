import { useEffect, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { commandText, summarizeParams } from '../lib/commands.js';
import { RefreshIcon } from './Icons.jsx';

// Komut geçmişi: en yeni 200 çalıştırma. "Tekrar çalıştır" aynı parametrelerle çalıştırır;
// gizli ya da eksik parametre varsa palet onları sorar (App: onRerun).
export default function HistoryView({ commands, onRerun, now }) {
  const i18n = useI18n();
  const { t, time } = i18n;
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    const load = async () => setEntries(await api.commands.history());
    load();
    return api.on('commands:finished', load);
  }, []);

  const known = new Map(commands.map((c) => [c.id, c]));

  return (
    <main className="history">
      <header className="feed-header">
        <div>
          <h1>{t('history.title')}</h1>
          <p className="feed-sub">{t('history.subtitle', { count: entries?.length ?? 0 })}</p>
        </div>
        {entries?.length > 0 && (
          <div className="feed-tools">
            <button className="btn" onClick={async () => {
              await api.commands.clearHistory();
              setEntries([]);
            }}>
              {t('history.clear')}
            </button>
          </div>
        )}
      </header>

      <div className="history-body">
        {entries?.length === 0 && <div className="empty"><p>{t('history.empty')}</p></div>}
        <ol className="history-list">
          {(entries ?? []).map((e) => {
            const command = known.get(e.command);
            const title = commandText(i18n, e.plugin, e.title, e.command);
            const params = summarizeParams(e.params);
            const result = e.status === 'error' ? t(e.errorI18n ?? e.error) : e.message;
            return (
              <li key={e.id} className="history-row" data-status={e.status}>
                <span className="status-dot" aria-hidden="true" />
                <div className="history-main">
                  <span className="history-title">{title}</span>
                  {params && <span className="history-params" title={params}>{params}</span>}
                  {result && <span className="history-result">{result}</span>}
                  <span className="history-meta">
                    {t(`history.status.${e.status}`)} · {t(`history.origin.${e.origin}`)} ·{' '}
                    <time dateTime={new Date(e.startedAt).toISOString()} title={new Date(e.startedAt).toLocaleString(i18n.locale)}>
                      {time.relativeTime(e.startedAt, now)}
                    </time>{' '}
                    · {t('history.duration', { seconds: Math.round(e.duration / 100) / 10 })}
                  </span>
                </div>
                {/* Komut artık yoksa (eklenti kaldırıldı, ayar değişti) tekrar çalıştırılamaz */}
                {command && (
                  <button
                    className="icon-btn history-rerun"
                    onClick={() => onRerun(command, e.params)}
                    aria-label={t('history.rerunLabel', { title })}
                    title={t('history.rerun')}
                  >
                    <RefreshIcon />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}
