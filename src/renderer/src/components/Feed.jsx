import { ExternalIcon } from './Icons.jsx';
import { clock, dayLabel, relativeTime } from '../lib/time.js';

function groupByDay(items) {
  const groups = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function EmptyState({ needsSetup, unreadOnly, onOpenSettings }) {
  if (needsSetup.length > 0) {
    const first = needsSetup[0];
    return (
      <div className="empty">
        <h2>{first.displayName} bağlantısı kurulmadı</h2>
        <p>Bildirimleri görmek için {first.displayName} erişim anahtarını ekle.</p>
        <button className="btn btn-primary" onClick={() => onOpenSettings(first.name)}>
          Anahtar ekle
        </button>
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>{unreadOnly ? 'Okunmamış bildirim yok' : 'Henüz bildirim yok'}</h2>
      <p>Kaynaklar arka planda kontrol ediliyor. Yeni bir şey geldiğinde burada görünecek.</p>
    </div>
  );
}

export default function Feed({
  ready, title, items, unreadCount, unreadOnly, onToggleUnread, sourceNames,
  needsSetup, onOpenSettings, onOpen, onMarkRead, onMarkAllRead, now
}) {
  return (
    <main className="feed">
      <header className="feed-header">
        <div>
          <h1>{title}</h1>
          <p className="feed-sub">
            {unreadCount > 0 ? `${unreadCount} okunmamış` : 'Hepsi okundu'}
          </p>
        </div>
        <div className="feed-tools">
          <div className="segmented" role="group" aria-label="Görünüm">
            <button aria-pressed={!unreadOnly} onClick={() => onToggleUnread(false)}>Tümü</button>
            <button aria-pressed={unreadOnly} onClick={() => onToggleUnread(true)}>Okunmamış</button>
          </div>
          <button className="btn" onClick={onMarkAllRead} disabled={unreadCount === 0}>
            Tümünü okundu say
          </button>
        </div>
      </header>

      <div className="feed-body">
        {ready && items.length === 0 && (
          <EmptyState needsSetup={needsSetup} unreadOnly={unreadOnly} onOpenSettings={onOpenSettings} />
        )}

        {groupByDay(items).map((group) => (
          <section key={group.label} className="day">
            <h2 className="day-label">{group.label}</h2>
            <ol className="items">
              {group.items.map((n) => (
                <li key={n.id} className="item" data-read={n.read} data-level={n.level}>
                  <time className="item-time" dateTime={new Date(n.createdAt).toISOString()} title={relativeTime(n.createdAt, now)}>
                    {clock(n.createdAt)}
                  </time>
                  <button className="item-main" onClick={() => onOpen(n)}>
                    <span className="item-title">
                      {n.title}
                      {n.url && <ExternalIcon />}
                    </span>
                    <span className="item-meta">
                      <span className="item-source">{sourceNames[n.source] ?? n.source}</span>
                      {n.body && <span className="item-body">{n.body}</span>}
                    </span>
                    {n.tags.length > 0 && (
                      <span className="tags">
                        {n.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                      </span>
                    )}
                  </button>
                  {!n.read && (
                    <button className="item-mark" onClick={() => onMarkRead(n)}>
                      Okundu say
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
