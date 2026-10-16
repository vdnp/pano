import { useMemo, useState } from 'react';
import { api, useNow, usePano } from './lib/usePano.js';
import SourceRail from './components/SourceRail.jsx';
import Feed from './components/Feed.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import AppSettingsPanel from './components/AppSettingsPanel.jsx';

export default function App() {
  const { notifications, sources, appSettings, ready } = usePano();
  const now = useNow();
  const [activeSource, setActiveSource] = useState(null); // null = tüm kaynaklar
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);

  const unreadBySource = useMemo(() => {
    const counts = {};
    for (const n of notifications) if (!n.read) counts[n.source] = (counts[n.source] ?? 0) + 1;
    return counts;
  }, [notifications]);

  const visible = useMemo(
    () =>
      notifications.filter(
        (n) => (!activeSource || n.source === activeSource) && (!unreadOnly || !n.read)
      ),
    [notifications, activeSource, unreadOnly]
  );

  const sourceNames = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.name, s.displayName])),
    [sources]
  );

  const settingsSource = sources.find((s) => s.name === settingsFor);
  const needsSetup = sources.filter((s) =>
    Object.entries(s.secretsSet).some(([, isSet]) => !isSet)
  );

  return (
    <div className="shell">
      <SourceRail
        sources={sources}
        unreadBySource={unreadBySource}
        totalUnread={notifications.filter((n) => !n.read).length}
        activeSource={activeSource}
        onSelect={setActiveSource}
        onRunNow={(key) => api.sources.runNow(key)}
        onOpenSettings={setSettingsFor}
        onOpenAppSettings={() => setAppSettingsOpen(true)}
        now={now}
      />

      <Feed
        ready={ready}
        title={activeSource ? sourceNames[activeSource] : 'Bildirimler'}
        items={visible}
        unreadCount={visible.filter((n) => !n.read).length}
        unreadOnly={unreadOnly}
        onToggleUnread={setUnreadOnly}
        sourceNames={sourceNames}
        needsSetup={needsSetup}
        onOpenSettings={setSettingsFor}
        onOpen={(n) => {
          if (!n.read) api.notifications.markRead(n.id);
          if (n.url) api.openExternal(n.url);
        }}
        onMarkRead={(n) => api.notifications.markRead(n.id)}
        onMarkAllRead={() => api.notifications.markAllRead(activeSource ?? undefined)}
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
