// English texts. Keys and placeholders must match tr.js (checked by test/core/catalogs.test.js).
export default {
  core: {
    errors: {
      pluginNotFound: 'Plugin not found: {name}',
      unknownSecret: 'Unknown secret field: {key}',
      unknownProvider: 'Unknown suggestion provider: {provider}',
      startFailed: 'The plugin could not start: {error}. Fix the problem and restart Pano.'
    },
    xml: {
      entity: 'The document contains disallowed entity (ENTITY) declarations.',
      invalid: 'Malformed XML (line {line}): {detail}'
    },
    storage: {
      newerVersion: 'The database was created by a newer version of Pano. Update Pano and open it again.',
      migrationFailed: 'The database could not be upgraded to version {version}: {error}'
    }
  },

  time: {
    justNow: 'just now',
    today: 'Today',
    yesterday: 'Yesterday'
  },

  rail: {
    sources: 'Sources',
    all: 'All sources',
    empty: 'No plugins loaded yet. Add a plugin to the plugins folder.',
    status: {
      waiting: 'Waiting',
      running: 'Checking',
      lastCheck: 'Last checked {when}',
      firstPending: 'Waiting for first check',
      startFailed: 'Could not start'
    },
    summary: { one: '{count} source', other: '{count} sources' },
    summaryWithErrors: { one: '{count} source · {failed} failing', other: '{count} sources · {failed} failing' },
    runNow: 'Check now',
    runNowLabel: 'Check {name} now',
    settings: 'Settings',
    settingsLabel: '{name} settings',
    jobsLabel: '{name} sources',
    appSettings: 'App settings'
  },

  feed: {
    title: 'Notifications',
    unread: { one: '{count} unread', other: '{count} unread' },
    allRead: 'All read',
    view: 'View',
    all: 'All',
    unreadOnly: 'Unread',
    markAllRead: 'Mark all as read',
    markRead: 'Mark as read',
    filter: 'Source filter',
    typeFilter: 'Type filter',
    originFilter: 'Show only notifications from this source',
    emptyUnread: 'No unread notifications',
    empty: 'No notifications yet',
    emptyBody: 'Sources are checked in the background. New items will show up here.'
  },

  setup: {
    startFailed: '{name} could not start',
    secretTitle: '{name} is not connected',
    secretBody: 'To see notifications, fill in "{label}" in the settings.',
    secretAction: 'Add key',
    noSourcesTitle: 'No sources added for {name}',
    noSourcesAction: 'Open settings'
  },

  settings: {
    title: '{name} settings',
    close: 'Close settings',
    closeButton: 'Close',
    save: 'Save settings',
    saving: 'Saving',
    saved: 'Settings saved.',
    secretRemoved: 'Key removed.',
    secretSet: 'Saved. Enter a new one to replace it.',
    secretEmpty: 'Paste the key here',
    openKeyPage: 'Open the key creation page',
    removeSecret: 'Remove saved key',
    jobError: '{title}: {error}',
    list: {
      addRow: 'Add row',
      removeRow: 'Remove row',
      removeRowLabel: 'Remove row {index}',
      fieldLabel: '{label}, row {index}'
    },
    suggest: {
      placeholder: 'Search',
      searching: 'Searching…',
      empty: 'No results.',
      added: 'Added'
    }
  },

  appSettings: {
    title: 'App settings',
    description: 'When you close the window, Pano keeps running in the system tray.',
    saveFailed: 'The setting could not be saved. Restart Pano and try again.',
    openAtLogin: {
      label: 'Start when the computer starts',
      help: 'Pano starts in the system tray without opening a window when you sign in.'
    },
    pauseNotifications: {
      label: 'Pause notifications',
      help: 'Desktop notifications are not shown; sources keep being checked and the feed keeps filling.'
    },
    language: {
      label: 'Dil / Language',
      help: 'The interface, error messages and tags are shown in this language. Notification contents stay in their original language.',
      system: 'System language ({language})',
      tr: 'Türkçe',
      en: 'English'
    }
  },

  tray: {
    open: 'Open Pano',
    checkAll: 'Check all now',
    pause: 'Pause notifications',
    quit: 'Quit Pano',
    tooltip: 'Pano',
    tooltipUnread: { one: 'Pano: {count} unread notification', other: 'Pano: {count} unread notifications' },
    tooltipPaused: '{tooltip} (notifications paused)',
    overlay: { one: '{count} unread notification', other: '{count} unread notifications' }
  },

  desktop: {
    batchTitle: { one: '{count} new notification', other: '{count} new notifications' },
    batchBody: 'Source: {sources}'
  }
};
