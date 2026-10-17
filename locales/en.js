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
    widgets: {
      notFound: 'Card not found: {id}',
      invalidView: 'The card asks for an unknown view: {view}',
      unknownProvider: "The card's data source was not found: {provider}",
      mapFailed: 'The card data could not be prepared. Try updating the plugin.',
      badData: 'The data source returned an unreadable result.',
      tooLarge: "The data source's result is too large."
    },
    web: {
      badUrl: 'The address must start with http:// or https://.',
      blocked: 'Addresses on the local network are not opened in the reader. Try opening it in your browser.',
      timeout: 'The page did not respond within 15 seconds. Try opening it in your browser.',
      network: 'Could not reach the page. Check your internet connection.',
      http: 'The page could not be loaded ({status}). Try opening it in your browser.',
      notHtml: 'This address is not a web page. Try opening it in your browser.',
      notImage: 'This address is not an image.',
      tooLarge: 'The page is too large for the reader. Try opening it in your browser.',
      tooManyRedirects: 'The page redirected too many times. Try opening it in your browser.'
    },
    storage: {
      newerVersion: 'The database was created by a newer version of Pano. Update Pano and open it again.',
      migrationFailed: 'The database could not be upgraded to version {version}: {error}'
    },
    commands: {
      notFound: 'Command not found: {id}',
      tooDeep: 'Commands called each other too deeply ({id}); there may be a loop.',
      needsConfirm: '{id} needs your confirmation; it can only be run from the command palette.',
      cancelled: 'The command was cancelled.',
      urlNotAllowed: 'This address cannot be opened. Only http(s) links and Steam game launch addresses can be opened.',
      notApplicable: 'This action does not apply to this notification.',
      params: {
        missing: '"{param}" cannot be empty.',
        notNumber: '"{param}" must be a number.',
        outOfRange: '"{param}" must be between {min} and {max}.'
      },
      builtin: {
        runAll: 'Check all sources',
        runAllDone: { one: '{count} source checked.', other: '{count} sources checked.' },
        runAllFailed: { one: '{count} source checked, {failed} failed.', other: '{count} sources checked, {failed} failed.' },
        markAllRead: 'Mark all as read',
        markAllReadDone: 'All notifications were marked as read.'
      }
    },
    permissions: {
      denied: 'The {plugin} plugin has not declared the "{permission}" permission in manifest.json (permissions).',
      notInCommand: '"{permission}" can only be used while a command is running.',
      names: {
        openExternal: 'Open links',
        runCommand: 'Run other commands'
      }
    }
  },

  time: {
    justNow: 'just now',
    today: 'Today',
    yesterday: 'Yesterday'
  },

  nav: {
    label: 'View',
    panel: 'Dashboard',
    notifications: 'Notifications',
    history: 'History'
  },

  dashboard: {
    title: 'Dashboard',
    subtitle: { one: '{count} card', other: '{count} cards' },
    edit: 'Edit',
    done: 'Done',
    editHint: 'Choose which cards to show; reorder them by dragging the cards or with the arrows. Changes are saved right away.',
    show: 'Show',
    moveUp: 'Move {title} up',
    moveDown: 'Move {title} down',
    empty: 'No cards yet. Cards appear here when a plugin that provides them is installed.',
    allHidden: 'All cards are hidden. Press Edit to show them.',
    cards: 'Cards'
  },

  card: {
    refresh: 'Refresh',
    refreshLabel: 'Refresh {title}',
    loading: 'Loading…',
    empty: 'Nothing to show.',
    updated: 'Updated {when}',
    stale: 'Could not update, showing older data. {error}',
    retry: 'Try again',
    openProfile: 'Open profile'
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
      startFailed: 'Could not start',
      cardsOnly: 'Dashboard cards only'
    },
    summaryWithErrors: { one: '{count} source · {failed} failing', other: '{count} sources · {failed} failing' },
    runNow: 'Check now',
    runNowLabel: 'Check {name} now',
    settings: 'Settings',
    settingsLabel: '{name} settings',
    jobsLabel: '{name} sources',
    appSettings: 'App settings',
    fix: 'Open settings to fix'
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

  reader: {
    close: 'Close reader',
    openInBrowser: 'Open in browser',
    loading: 'Loading…',
    noContent: 'This notification has no full text. You can read the rest in your browser.',
    loadFailed: 'The text could not be loaded. Try opening it in your browser.',
    image: 'Open image',
    imageNamed: 'Open image: {alt}',
    video: 'Open video',
    by: 'By {author}',
    fetchFull: 'Fetch full text',
    fetchHint: 'The article page is downloaded and its text extracted; the page is not opened and no cookies are sent.',
    fetching: 'Downloading page…',
    extractFailed: 'No readable text could be extracted from this page. Try opening it in your browser.',
    imageLoading: 'Loading image…'
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
    permissions: 'Permissions',
    permissionsHelp: 'Capabilities this plugin declares. They can only be used while a command is running.',
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


  palette: {
    label: 'Command palette',
    placeholder: 'Search commands…',
    empty: 'No matching commands.',
    recent: 'Recently used',
    all: 'Commands',
    hint: '↑↓ select · Enter run · Esc close',
    step: '{step}/{total}',
    optional: 'Optional: leave empty and press Enter to skip.',
    suggestHint: 'Type at least 2 letters to search.',
    searching: 'Searching…',
    noSuggestions: 'No suggestions. You can type the value and press Enter.',
    yes: 'Yes',
    no: 'No',
    confirm: 'Run {title}?',
    confirmHint: 'Enter: run · Esc: back',
    useTyped: 'Use typed value: “{value}”',
    run: 'Run',
    back: 'Back',
    listUnsupported: 'This command needs a list parameter; it cannot be run from the palette.',
    ui: {
      panel: 'Go to dashboard',
      notifications: 'Go to notifications',
      history: 'Open command history',
      appSettings: 'Open app settings',
      openSettings: 'Open settings: {name}'
    }
  },

  runs: {
    label: 'Running commands',
    running: 'Running…',
    cancel: 'Cancel',
    cancelLabel: 'Cancel {title}',
    done: 'Done.',
    cancelled: 'Cancelled.',
    dismiss: 'Close'
  },

  history: {
    title: 'Command history',
    subtitle: { one: 'Last {count} run', other: 'Last {count} runs' },
    empty: 'No commands have been run yet. Open the command palette with Ctrl+K.',
    rerun: 'Run again',
    rerunLabel: 'Run {title} again',
    clear: 'Clear history',
    duration: '{seconds, number} s',
    status: {
      ok: 'Done',
      error: 'Error',
      cancelled: 'Cancelled'
    },
    origin: {
      palette: 'Palette',
      history: 'History',
      notification: 'Notification',
      plugin: 'Plugin',
      tray: 'Tray'
    }
  },

  tray: {
    palette: 'Command palette',
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
