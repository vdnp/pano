import { GearIcon, RefreshIcon } from './Icons.jsx';
import { relativeTime } from '../lib/time.js';

function jobStatusText(job, now) {
  if (!job) return 'Bekliyor';
  if (job.state === 'running') return 'Kontrol ediliyor';
  if (job.state === 'error') return job.error;
  if (job.lastSuccess) return `Son kontrol ${relativeTime(job.lastSuccess, now)}`;
  return 'İlk kontrol bekleniyor';
}

export default function SourceRail({
  sources, unreadBySource, totalUnread, activeSource, onSelect, onRunNow, onOpenSettings,
  onOpenAppSettings, now
}) {
  return (
    <aside className="rail">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Pano
      </div>

      <nav aria-label="Kaynaklar">
        <button
          className="rail-all"
          aria-current={activeSource === null ? 'true' : undefined}
          onClick={() => onSelect(null)}
        >
          <span>Tüm kaynaklar</span>
          {totalUnread > 0 && <span className="count">{totalUnread}</span>}
        </button>

        <h2 className="rail-heading">Kaynaklar</h2>

        {sources.length === 0 && (
          <p className="rail-empty">
            Henüz eklenti yüklenmedi. plugins klasörüne bir eklenti ekle.
          </p>
        )}

        <ul className="source-list">
          {sources.map((source) => {
            const job = source.jobs[0];
            const state = job?.state ?? 'idle';
            return (
              <li key={source.name} className="source" data-state={state}>
                <button
                  className="source-main"
                  aria-current={activeSource === source.name ? 'true' : undefined}
                  onClick={() => onSelect(source.name)}
                >
                  <span className="source-name">
                    <span className="status-dot" aria-hidden="true" />
                    {source.displayName}
                    {unreadBySource[source.name] > 0 && (
                      <span className="count">{unreadBySource[source.name]}</span>
                    )}
                  </span>
                  <span className="source-status" title={job?.error ?? undefined}>
                    {jobStatusText(job, now)}
                  </span>
                </button>
                <div className="source-actions">
                  {job && (
                    <button
                      className="icon-btn"
                      onClick={() => onRunNow(job.key)}
                      disabled={state === 'running'}
                      aria-label={`${source.displayName} kaynağını şimdi kontrol et`}
                      title="Şimdi kontrol et"
                    >
                      <RefreshIcon />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    onClick={() => onOpenSettings(source.name)}
                    aria-label={`${source.displayName} ayarları`}
                    title="Ayarlar"
                  >
                    <GearIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>

      <button className="rail-footer" onClick={onOpenAppSettings}>
        <GearIcon />
        Uygulama ayarları
      </button>
    </aside>
  );
}
