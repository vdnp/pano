// Uygulamanın Türkçe metinleri (kaynak dil). Yeni anahtar en.js'e de eklenmeli;
// test/core/catalogs.test.js iki kataloğun anahtar ve yer tutucularını karşılaştırır.
export default {
  core: {
    errors: {
      pluginNotFound: 'Eklenti bulunamadı: {name}',
      unknownSecret: 'Bilinmeyen gizli alan: {key}',
      unknownProvider: 'Bilinmeyen öneri sağlayıcısı: {provider}',
      startFailed: "Eklenti başlatılamadı: {error}. Sorunu giderip Pano'yu yeniden başlat."
    },
    xml: {
      entity: 'Belge izin verilmeyen varlık (ENTITY) tanımları içeriyor.',
      invalid: 'XML bozuk (satır {line}): {detail}'
    },
    storage: {
      newerVersion: "Veritabanı Pano'nun daha yeni bir sürümüyle oluşturulmuş. Pano'yu güncelleyip tekrar aç.",
      migrationFailed: 'Veritabanı {version}. sürüme güncellenemedi: {error}'
    }
  },

  time: {
    justNow: 'az önce',
    today: 'Bugün',
    yesterday: 'Dün'
  },

  rail: {
    sources: 'Kaynaklar',
    all: 'Tüm kaynaklar',
    empty: 'Henüz eklenti yüklenmedi. plugins klasörüne bir eklenti ekle.',
    status: {
      waiting: 'Bekliyor',
      running: 'Kontrol ediliyor',
      lastCheck: 'Son kontrol {when}',
      firstPending: 'İlk kontrol bekleniyor',
      startFailed: 'Başlatılamadı'
    },
    summary: { one: '{count} kaynak', other: '{count} kaynak' },
    summaryWithErrors: { one: '{count} kaynak · {failed} hatalı', other: '{count} kaynak · {failed} hatalı' },
    runNow: 'Şimdi kontrol et',
    runNowLabel: '{name} kaynağını şimdi kontrol et',
    settings: 'Ayarlar',
    settingsLabel: '{name} ayarları',
    jobsLabel: '{name} kaynakları',
    appSettings: 'Uygulama ayarları'
  },

  feed: {
    title: 'Bildirimler',
    unread: { one: '{count} okunmamış', other: '{count} okunmamış' },
    allRead: 'Hepsi okundu',
    view: 'Görünüm',
    all: 'Tümü',
    unreadOnly: 'Okunmamış',
    markAllRead: 'Tümünü okundu say',
    markRead: 'Okundu say',
    filter: 'Kaynak filtresi',
    typeFilter: 'Tür filtresi',
    originFilter: 'Yalnızca bu kaynağın bildirimlerini göster',
    emptyUnread: 'Okunmamış bildirim yok',
    empty: 'Henüz bildirim yok',
    emptyBody: 'Kaynaklar arka planda kontrol ediliyor. Yeni bir şey geldiğinde burada görünecek.'
  },

  setup: {
    startFailed: '{name} başlatılamadı',
    secretTitle: '{name} bağlantısı kurulmadı',
    secretBody: 'Bildirimleri görmek için ayarlardan "{label}" alanını doldur.',
    secretAction: 'Anahtar ekle',
    noSourcesTitle: '{name} için kaynak eklenmedi',
    noSourcesAction: 'Ayarları aç'
  },

  settings: {
    title: '{name} ayarları',
    close: 'Ayarları kapat',
    closeButton: 'Kapat',
    save: 'Ayarları kaydet',
    saving: 'Kaydediliyor',
    saved: 'Ayarlar kaydedildi.',
    secretRemoved: 'Anahtar silindi.',
    secretSet: 'Kayıtlı. Değiştirmek için yenisini gir.',
    secretEmpty: 'Anahtarı buraya yapıştır',
    openKeyPage: 'Anahtar oluşturma sayfasını aç',
    removeSecret: 'Kayıtlı anahtarı sil',
    jobError: '{title}: {error}',
    list: {
      addRow: 'Satır ekle',
      removeRow: 'Satırı sil',
      removeRowLabel: '{index}. satırı sil',
      fieldLabel: '{label}, {index}. satır'
    },
    suggest: {
      placeholder: 'Ara',
      searching: 'Aranıyor…',
      empty: 'Sonuç bulunamadı.',
      added: 'Ekli'
    }
  },

  appSettings: {
    title: 'Uygulama ayarları',
    description: 'Pencereyi kapatınca Pano sistem tepsisinde çalışmaya devam eder.',
    saveFailed: "Ayar kaydedilemedi. Pano'yu yeniden başlatıp tekrar dene.",
    openAtLogin: {
      label: 'Bilgisayar açılınca başlat',
      help: 'Pano oturum açıldığında pencere açmadan sistem tepsisinde başlar.'
    },
    pauseNotifications: {
      label: 'Bildirimleri duraklat',
      help: 'Masaüstü bildirimleri gösterilmez; kaynaklar kontrol edilmeye ve akış dolmaya devam eder.'
    },
    language: {
      label: 'Dil / Language',
      help: 'Arayüz, hata mesajları ve etiketler bu dilde gösterilir. Bildirim içerikleri kaynağın kendi dilinde kalır.',
      system: 'Sistem dili ({language})',
      // Dil adları her katalogda kendi dilinde yazılır
      tr: 'Türkçe',
      en: 'English'
    }
  },

  tray: {
    open: "Pano'yu aç",
    checkAll: 'Tümünü şimdi kontrol et',
    pause: 'Bildirimleri duraklat',
    quit: "Pano'dan çık",
    tooltip: 'Pano',
    tooltipUnread: { one: 'Pano: {count} okunmamış bildirim', other: 'Pano: {count} okunmamış bildirim' },
    tooltipPaused: '{tooltip} (bildirimler duraklatıldı)',
    overlay: { one: '{count} okunmamış bildirim', other: '{count} okunmamış bildirim' }
  },

  desktop: {
    batchTitle: { one: '{count} yeni bildirim', other: '{count} yeni bildirim' },
    batchBody: 'Kaynak: {sources}'
  }
};
