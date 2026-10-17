import { useI18n } from '../lib/i18n.jsx';
import { commandText } from '../lib/commands.js';

function groupByDay(items, dayLabel) {
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
  const { t } = useI18n();
  if (needsSetup.length > 0) {
    return (
      <div className="setup-list">
        {needsSetup.map((s) => (
          <div key={s.name} className="empty">
            <h2>{s.title}</h2>
            {s.body && <p>{s.body}</p>}
            {s.action && (
              <button className="btn btn-primary" onClick={() => onOpenSettings(s.name)}>
                {s.action}
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>{unreadOnly ? t('feed.emptyUnread') : t('feed.empty')}</h2>
      <p>{t('feed.emptyBody')}</p>
    </div>
  );
}

// Hızlı geçiş çipleri: kaynaklar (oyun/akış) ya da türler (yama notu, duyuru ...)
function ChipRow({ chips, label, onSelect }) {
  if (chips.length === 0) return null;
  return (
    <div className="chips" role="group" aria-label={label}>
      {chips.map((chip) => (
        <button key={chip.id ?? 'all'} className="chip" aria-pressed={chip.active} onClick={() => onSelect(chip.id)}>
          {chip.label}
          {chip.count > 0 && <span className="chip-count">{chip.count}</span>}
        </button>
      ))}
    </div>
  );
}

export default function Feed({
  ready, title, eyebrow, chips, onSelectChip, typeChips, onSelectTypeChip, items, unreadCount, unreadOnly, onToggleUnread,
  sourceNames, onSelectOrigin, needsSetup, onOpenSettings, onOpen, onMarkRead, onMarkAllRead, actions = {}, onRunAction, now
}) {
  const i18n = useI18n();
  const { t, time } = i18n;
  return (
    <main className="feed">
      <header className="feed-header">
        <div>
          {eyebrow && <p className="feed-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          <p className="feed-sub">
            {unreadCount > 0 ? t('feed.unread', { count: unreadCount }) : t('feed.allRead')}
          </p>
        </div>
        <div className="feed-tools">
          <div className="segmented" role="group" aria-label={t('feed.view')}>
            <button aria-pressed={!unreadOnly} onClick={() => onToggleUnread(false)}>{t('feed.all')}</button>
            <button aria-pressed={unreadOnly} onClick={() => onToggleUnread(true)}>{t('feed.unreadOnly')}</button>
          </div>
          <button className="btn" onClick={onMarkAllRead} disabled={unreadCount === 0}>
            {t('feed.markAllRead')}
          </button>
        </div>

        <ChipRow chips={chips} label={t('feed.filter')} onSelect={onSelectChip} />
        <ChipRow chips={typeChips} label={t('feed.typeFilter')} onSelect={onSelectTypeChip} />
      </header>

      <div className="feed-body">
        {ready && items.length === 0 && (
          <EmptyState needsSetup={needsSetup} unreadOnly={unreadOnly} onOpenSettings={onOpenSettings} />
        )}

        {groupByDay(items, time.dayLabel).map((group) => (
          <section key={group.label} className="day">
            <h2 className="day-label">{group.label}</h2>
            <ol className="items">
              {group.items.map((n) => (
                <li key={n.id} className="item" data-read={n.read} data-level={n.level}>
                  <time className="item-time" dateTime={new Date(n.createdAt).toISOString()} title={time.relativeTime(n.createdAt, now)}>
                    {time.clock(n.createdAt)}
                  </time>
                  <div className="item-content">
                    {/* Nereden geldiği: tıklanınca akış o oyun/akışa göre filtrelenir */}
                    <button className="origin" onClick={() => onSelectOrigin(n)} title={t('feed.originFilter')}>
                      <span className="origin-source">{sourceNames[n.source] ?? n.source}</span>
                      {n.body && <span className="origin-detail">{n.body}</span>}
                    </button>
                    <button className="item-main" onClick={() => onOpen(n)}>
                      <span className="item-title">
                        {n.title}
                      </span>
                      {n.meta?.excerpt && <span className="item-excerpt">{n.meta.excerpt}</span>}
                      {n.tags.length > 0 && (
                        <span className="tags">
                          {n.tags.map((tag) => <span key={tag} className="tag">{t(tag)}</span>)}
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="item-actions">
                    {/* Eklentinin bildirim eylemleri (ör. GitHub'da okundu say); komut olarak çalışır */}
                    {(actions[n.source] ?? []).map((c) => {
                      const text = commandText(i18n, c.plugin, c.notificationAction.label || c.title, c.name);
                      return (
                        <button key={c.id} className="item-mark" onClick={() => onRunAction(c, n)} title={commandText(i18n, c.plugin, c.title, c.name)}>
                          {text}
                        </button>
                      );
                    })}
                    {!n.read && (
                      <button className="item-mark" onClick={() => onMarkRead(n)}>
                        {t('feed.markRead')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
