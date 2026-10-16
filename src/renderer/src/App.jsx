import { useEffect, useMemo, useState } from 'react';
import { api, useNow, usePano } from './lib/usePano.js';
import SourceRail from './components/SourceRail.jsx';
import Feed from './components/Feed.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { setupNeed } from './lib/setup.js';
import AppSettingsPanel from './components/AppSettingsPanel.jsx';
import { I18nProvider, useI18n } from './lib/i18n.jsx';
import { pluginName } from './lib/plugin-text.js';
import {
  ALL, filterNotifications, jobKey, jobsOf, resolveSelection, selectionForNotification, tagSummary, unreadCounts
} from './lib/filter.js';

export default function App() {
  const pano = usePano();
  const locale = pano.appSettings?.locale;

  useEffect(() => {
    if (locale) document.documentElement.lang = locale;
  }, [locale]);

  // Dil bilinmeden çizilmez; açılışta yanlış dilde bir an görünmesin
  if (!locale) return null;
  return (
    <I18nProvider locale={locale} sources={pano.sources}>
      <Shell {...pano} />
    </I18nProvider>
  );
}

function Shell({ notifications, sources, appSettings, ready }) {
  const i18n = useI18n();
  const now = useNow();
  const [rawSelection, setSelection] = useState(ALL);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);

  // Seçili oyun/akış ayarlardan silinmişse bir üst seviyeye düşülür
  const resolved = resolveSelection(rawSelection, sources);
  // Oyun/akış değişince tür seçimi sıfırlanır
  const select = (source, job = null) => setSelection({ source, job, tag: null });

  // Seçili kapsamdaki (eklenti/oyun) bildirimlerin türleri; en az iki tür varsa çip olarak gösterilir
  const scope = useMemo(
    () => filterNotifications(notifications, { ...resolved, tag: null }),
    [notifications, resolved.source, resolved.job]
  );
  const tags = resolved.source ? tagSummary(scope) : [];
  // Seçili tür bu kapsamda artık yoksa kaldırılır
  const selection = tags.some((x) => x.tag === resolved.tag) ? resolved : { ...resolved, tag: null };

  const counts = useMemo(() => unreadCounts(notifications), [notifications]);
  const visible = useMemo(
    () => filterNotifications(notifications, selection, unreadOnly),
    [notifications, selection.source, selection.job, selection.tag, unreadOnly]
  );

  const sourceNames = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.name, pluginName(i18n, s)])),
    [sources, i18n]
  );

  const activeSource = sources.find((s) => s.name === selection.source);
  const jobs = jobsOf(activeSource);
  const activeJob = jobs.find((j) => j.id === selection.job);

  // Birden fazla kaynağı olan eklenti seçiliyken başlığın altında hızlı geçiş çipleri
  const chips = jobs.length > 1
    ? [
        { id: null, label: i18n.t('feed.all'), count: counts.bySource[selection.source] ?? 0 },
        ...jobs.map((j) => ({ id: j.id, label: j.title, count: counts.byJob[jobKey(selection.source, j.id)] ?? 0 }))
      ].map((chip) => ({ ...chip, active: chip.id === selection.job }))
    : [];

  const typeChips = tags.length > 1
    ? [
        { id: null, label: i18n.t('feed.all'), count: scope.filter((n) => !n.read).length },
        ...tags.map((x) => ({ id: x.tag, label: i18n.t(x.tag), count: x.unread }))
      ].map((chip) => ({ ...chip, active: chip.id === selection.tag }))
    : [];

  const settingsSource = sources.find((s) => s.name === settingsFor);
  // Seçili kaynak varsa yalnızca onun kurulum ekranı gösterilir
  const needsSetup = sources
    .filter((s) => !selection.source || s.name === selection.source)
    .map((s) => setupNeed(s, i18n))
    .filter(Boolean);

  return (
    <div className="shell">
      <SourceRail
        sources={sources}
        counts={counts}
        selection={selection}
        onSelect={select}
        onRunNow={(key) => api.sources.runNow(key)}
        onOpenSettings={setSettingsFor}
        onOpenAppSettings={() => setAppSettingsOpen(true)}
        now={now}
      />

      <Feed
        ready={ready}
        title={activeJob?.title ?? (selection.source ? sourceNames[selection.source] : i18n.t('feed.title'))}
        eyebrow={activeJob ? sourceNames[selection.source] : null}
        chips={chips}
        onSelectChip={(job) => select(selection.source, job)}
        typeChips={typeChips}
        onSelectTypeChip={(tag) => setSelection({ ...selection, tag })}
        items={visible}
        unreadCount={visible.filter((n) => !n.read).length}
        unreadOnly={unreadOnly}
        onToggleUnread={setUnreadOnly}
        sourceNames={sourceNames}
        onSelectOrigin={(n) => setSelection(selectionForNotification(n, sources))}
        needsSetup={needsSetup}
        onOpenSettings={setSettingsFor}
        onOpen={(n) => {
          if (!n.read) api.notifications.markRead(n.id);
          if (n.url) api.openExternal(n.url);
        }}
        onMarkRead={(n) => api.notifications.markRead(n.id)}
        onMarkAllRead={() =>
          // Tür seçiliyken yalnızca görünenler; değilse core eklenti/oyun kapsamında işaretler
          selection.tag
            ? api.notifications.markRead(visible.filter((n) => !n.read).map((n) => n.id))
            : api.notifications.markAllRead(selection.source ?? undefined, selection.job ?? undefined)
        }
        now={now}
      />

      {settingsSource && (
        <SettingsPanel source={settingsSource} onClose={() => setSettingsFor(null)} />
      )}

      {appSettingsOpen && (
        <AppSettingsPanel settings={appSettings} onClose={() => setAppSettingsOpen(false)} />
      )}
    </div>
  );
}
