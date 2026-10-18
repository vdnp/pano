import { useEffect, useMemo, useState } from 'react';
import { api, useNow, usePano } from './lib/usePano.js';
import SourceRail from './components/SourceRail.jsx';
import Feed from './components/Feed.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { setupNeed } from './lib/setup.js';
import AppSettingsPanel from './components/AppSettingsPanel.jsx';
import ReaderPanel from './components/ReaderPanel.jsx';
import Dashboard from './components/Dashboard.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import RunToasts from './components/RunToasts.jsx';
import HistoryView from './components/HistoryView.jsx';
import AutomationsView from './components/AutomationsView.jsx';
import { useCommands } from './lib/useCommands.js';
import { needsInput } from './lib/commands.js';
import { I18nProvider, useI18n } from './lib/i18n.jsx';
import { pluginName } from './lib/plugin-text.js';
import {
  ALL, filterNotifications, jobKey, jobsOf, resolveSelection, selectionForNotification, tagSummary, unreadCounts
} from './lib/filter.js';

// Sonucu beklenmeyen IPC çağrıları: kapanış sırasında reddedilebilir; durum olaylarla güncellenir
const quiet = (promise) => promise.catch(() => {});

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
  const [readingId, setReadingId] = useState(null);
  // Komut paleti: null kapalı; { request } geçmişten tekrar çalıştırmada doğrudan parametre adımı
  const [palette, setPalette] = useState(null);
  const { commands, runs, dismiss, report } = useCommands();
  // Ana alan: "panel" (kartlar), "notifications" (akış) ya da "history" (komut geçmişi);
  // son seçim bu bilgisayarda hatırlanır
  const [view, setViewState] = useState(() => {
    try {
      const saved = localStorage.getItem('pano.view');
      return ['notifications', 'history', 'automations'].includes(saved) ? saved : 'panel';
    } catch {
      return 'panel';
    }
  });
  const setView = (next) => {
    setViewState(next);
    try {
      localStorage.setItem('pano.view', next);
    } catch {
      /* saklanamazsa yalnızca bu oturumda geçerli */
    }
  };

  // Ctrl+K (macOS: Cmd+K) pencere içinde; genel kısayol ve tepsi menüsü main'den palette:open ile
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => p ?? {});
      }
    };
    window.addEventListener('keydown', onKey);
    const off = api.on('palette:open', () => setPalette((p) => p ?? {}));
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, []);

  // Onay bekleyen otomasyon komutları: kenar çubuğunda sayaç; masaüstü bildirimine tıklanınca
  // Otomasyonlar görünümü açılır (onay orada verilir)
  const [approvalCount, setApprovalCount] = useState(0);
  useEffect(() => {
    // Kapanış sırasında IPC reddedilebilir; sayaç bir sonraki olayda güncellenir
    const load = () => api.automation.approvals().then((list) => setApprovalCount(list.length)).catch(() => {});
    load();
    const off = [api.on('automation:changed', load), api.on('automation:show', () => setView('automations'))];
    return () => off.forEach((fn) => fn());
  }, []);

  // Seçili oyun/akış ayarlardan silinmişse bir üst seviyeye düşülür
  const resolved = resolveSelection(rawSelection, sources);
  // Oyun/akış değişince tür seçimi sıfırlanır
  // Bir kaynak ya da "Bildirimler" seçilince akış görünümüne geçilir
  const select = (source, job = null) => {
    setSelection({ source, job, tag: null });
    setView('notifications');
  };

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

  // "pano": uygulamanın kendi bildirimleri (otomasyon uyarıları, pano/notify)
  const sourceNames = useMemo(
    () => ({ pano: i18n.t('app.name'), ...Object.fromEntries(sources.map((s) => [s.name, pluginName(i18n, s)])) }),
    [sources, i18n]
  );

  // Arayüzün kendi işleri de paletten açılır (geçmişe yazılmaz): görünümler ve ayarlar
  const uiCommands = useMemo(() => [
    { id: 'ui:panel', text: i18n.t('palette.ui.panel'), run: () => setView('panel') },
    { id: 'ui:notifications', text: i18n.t('palette.ui.notifications'), run: () => select(null) },
    { id: 'ui:history', text: i18n.t('palette.ui.history'), run: () => setView('history') },
    { id: 'ui:automations', text: i18n.t('palette.ui.automations'), run: () => setView('automations') },
    { id: 'ui:appSettings', text: i18n.t('palette.ui.appSettings'), run: () => setAppSettingsOpen(true) },
    ...sources.map((s) => ({
      id: `ui:settings:${s.name}`,
      text: i18n.t('palette.ui.openSettings', { name: sourceNames[s.name] }),
      run: () => setSettingsFor(s.name)
    }))
  ], [sources, sourceNames, i18n]);

  // Geçmişten tekrar: gizli ya da eksik parametre varsa palet sorar, yoksa doğrudan çalışır
  const rerun = (command, params) => {
    if (needsInput(command, params)) setPalette({ request: { command, prefill: params, origin: 'history' } });
    else api.commands.run(command.id, params, 'history').catch((err) => report(command, err));
  };

  // Bildirim satırındaki eylemler: komutun eklentisinin bildirimlerinde gösterilir
  const notificationActions = useMemo(() => {
    const out = {};
    for (const c of commands) if (c.notificationAction) (out[c.plugin] ??= []).push(c);
    return out;
  }, [commands]);

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
  const reading = readingId ? notifications.find((n) => n.id === readingId) : null;
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
        view={view}
        onSelect={select}
        onShowPanel={() => setView('panel')}
        onShowHistory={() => setView('history')}
        onShowAutomations={() => setView('automations')}
        approvalCount={approvalCount}
        onRunNow={(key) => quiet(api.sources.runNow(key))}
        onOpenSettings={setSettingsFor}
        onOpenAppSettings={() => setAppSettingsOpen(true)}
        now={now}
      />

      {view === 'panel' ? (
        <Dashboard sourceNames={sourceNames} now={now} />
      ) : view === 'history' ? (
        <HistoryView commands={commands} onRerun={rerun} now={now} />
      ) : view === 'automations' ? (
        <AutomationsView
          commands={commands}
          notifications={notifications}
          sources={sources.map((s) => ({ name: s.name, label: sourceNames[s.name] }))}
          now={now}
        />
      ) : (
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
          // Haber uygulama içinde okuyucu panelinde açılır; tarayıcı paneldeki düğmeyle
          if (!n.read) quiet(api.notifications.markRead(n.id));
          setReadingId(n.id);
        }}
        onMarkRead={(n) => quiet(api.notifications.markRead(n.id))}
        onTogglePin={(n) => quiet(api.notifications.setPinned(n.id, !n.pinned))}
        actions={notificationActions}
        onRunAction={(command, n) => api.commands.runForNotification(command.id, n.id).catch((err) => report(command, err))}
        onMarkAllRead={() =>
          // Tür seçiliyken yalnızca görünenler; değilse core eklenti/oyun kapsamında işaretler
          quiet(selection.tag
            ? api.notifications.markRead(visible.filter((n) => !n.read).map((n) => n.id))
            : api.notifications.markAllRead(selection.source ?? undefined, selection.job ?? undefined))
        }
        now={now}
      />
      )}

      {settingsSource && (
        <SettingsPanel source={settingsSource} onClose={() => setSettingsFor(null)} />
      )}

      {/* Bildirim listeden düşerse (temizleme, 500 sınırı) panel kapanır */}
      {reading && (
        <ReaderPanel
          notification={reading}
          sourceName={sourceNames[reading.source] ?? reading.source}
          onClose={() => setReadingId(null)}
        />
      )}

      {appSettingsOpen && (
        <AppSettingsPanel settings={appSettings} onClose={() => setAppSettingsOpen(false)} />
      )}

      {palette && (
        <CommandPalette
          commands={commands}
          uiCommands={uiCommands}
          sourceNames={sourceNames}
          request={palette.request}
          onClose={() => setPalette(null)}
        />
      )}

      <RunToasts runs={runs} onDismiss={dismiss} />
    </div>
  );
}
