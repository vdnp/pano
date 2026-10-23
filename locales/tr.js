// Uygulamanın Türkçe metinleri (kaynak dil). Yeni anahtar en.js'e de eklenmeli;
// test/core/catalogs.test.js iki kataloğun anahtar ve yer tutucularını karşılaştırır.
export default {
  core: {
    errors: {
      pluginNotFound: 'Eklenti bulunamadı: {name}',
      unknownSecret: 'Bilinmeyen gizli alan: {key}',
      unknownProvider: 'Bilinmeyen öneri sağlayıcısı: {provider}',
      startFailed: "Eklenti başlatılamadı: {error}. Sorunu giderip Pano'yu yeniden başlat.",
      pluginCrashed: 'Eklenti kısa sürede art arda çöktüğü için kapatıldı. Ayarlarından "Yeniden dene" ile tekrar başlatabilirsin.',
      pluginRestarting: 'Eklenti yeniden başlatılıyor; birkaç saniye sonra tekrar dene.',
      pluginDisposed: 'Eklenti kapatıldı.',
      pluginLimit: 'Eklenti izin verilen sınırı aştı: {what}.',
      pluginBadRequest: 'Eklentiden geçersiz bir istek geldi: {what}.'
    },
    xml: {
      entity: 'Belge izin verilmeyen varlık (ENTITY) tanımları içeriyor.',
      invalid: 'XML bozuk (satır {line}): {detail}'
    },
    widgets: {
      notFound: 'Kart bulunamadı: {id}',
      invalidView: 'Kart bilinmeyen bir görünüm istiyor: {view}',
      unknownProvider: 'Kartın veri kaynağı bulunamadı: {provider}',
      mapFailed: 'Kart verisi hazırlanamadı. Eklentiyi güncellemeyi dene.',
      badData: 'Veri kaynağı okunamayan bir sonuç döndürdü.',
      tooLarge: 'Veri kaynağının sonucu çok büyük.'
    },
    web: {
      badUrl: 'Adres http:// veya https:// ile başlamalı.',
      blocked: 'Yerel ağdaki adresler okuyucuda açılmaz. Tarayıcıda açmayı dene.',
      timeout: 'Sayfa 15 saniye içinde yanıt vermedi. Tarayıcıda açmayı dene.',
      network: 'Sayfaya ulaşılamadı. İnternet bağlantını kontrol et.',
      http: 'Sayfa alınamadı ({status}). Tarayıcıda açmayı dene.',
      notHtml: 'Bu adres bir web sayfası değil. Tarayıcıda açmayı dene.',
      notImage: 'Bu adres bir görsel değil.',
      tooLarge: 'Sayfa okuyucu için çok büyük. Tarayıcıda açmayı dene.',
      tooManyRedirects: 'Sayfa çok fazla yönlendirme yaptı. Tarayıcıda açmayı dene.'
    },
    storage: {
      newerVersion: "Veritabanı Pano'nun daha yeni bir sürümüyle oluşturulmuş. Pano'yu güncelleyip tekrar aç.",
      migrationFailed: 'Veritabanı {version}. sürüme güncellenemedi: {error}'
    },
    commands: {
      notFound: 'Komut bulunamadı: {id}',
      tooDeep: 'Komutlar birbirini çok derin çağırdı ({id}); döngü olabilir.',
      needsConfirm: '{id} kullanıcı onayı gerektiriyor; yalnızca komut paletinden çalıştırılabilir.',
      cancelled: 'Komut iptal edildi.',
      urlNotAllowed: 'Bu adres açılamaz. Yalnızca http(s) bağlantıları ve Steam oyun başlatma adresleri açılabilir.',
      notApplicable: 'Bu eylem bu bildirime uygulanamıyor.',
      params: {
        missing: '"{param}" boş bırakılamaz.',
        notNumber: '"{param}" bir sayı olmalı.',
        outOfRange: '"{param}" {min} ile {max} arasında olmalı.'
      },
      builtin: {
        notify: 'Pano bildirimi oluştur',
        notifyDone: 'Bildirim oluşturuldu.',
        alert: 'Sesli masaüstü uyarısı göster',
        alertDone: 'Uyarı gösterildi.',
        pin: 'Bildirimi üste sabitle',
        pinDone: 'Bildirim sabitlendi.',
        unpin: 'Bildirimin sabitlemesini kaldır',
        unpinDone: 'Sabitleme kaldırıldı.',
        notificationNotFound: 'Bildirim bulunamadı; silinmiş olabilir.',
        params: {
          title: 'Başlık',
          body: 'Ayrıntı',
          level: 'Düzey',
          id: 'Bildirim kimliği'
        },
        runAll: 'Tüm kaynakları kontrol et',
        runAllDone: { one: '{count} kaynak kontrol edildi.', other: '{count} kaynak kontrol edildi.' },
        runAllFailed: { one: '{count} kaynak kontrol edildi, {failed} tanesi hata verdi.', other: '{count} kaynak kontrol edildi, {failed} tanesi hata verdi.' },
        markAllRead: 'Tümünü okundu say',
        markAllReadDone: 'Tüm bildirimler okundu sayıldı.'
      }
    },
    permissions: {
      denied: '{plugin} eklentisi "{permission}" iznini manifest.json\'da (permissions) beyan etmemiş.',
      notInCommand: '"{permission}" yalnızca bir komut çalışırken kullanılabilir.',
      names: {
        openExternal: 'Bağlantı açma',
        runCommand: 'Başka komutları çalıştırma',
        network: 'İnternet erişimi',
        notifications: 'Bildirim gösterme',
        filesystem: 'Kendi veri klasörüne dosya yazma'
      },
      cannotRevokeBuiltin: 'Uygulamayla gelen eklentinin izinleri geri alınamaz.',
      network: {
        badUrl: 'Geçersiz adres: {url}',
        notDeclared: '{plugin} eklentisi internet erişimi izni istememiş; {host} adresine bağlanamaz.',
        hostNotAllowed: '{plugin} eklentisi {host} adresine bağlanma izni istememiş.',
        httpNotAllowed: '{host} adresine yalnızca güvenli bağlantı (https) ile bağlanılabilir.',
        privateAddress: '{host} yerel ağdaki bir adres; eklentiler yerel ağa bağlanamaz.',
        tooManyRedirects: '{host} çok fazla yönlendirme yaptı.'
      },
      files: {
        badPath: 'Geçersiz dosya yolu: {path}. Yalnızca eklentinin kendi klasöründeki yollar kullanılabilir.',
        quota: 'Eklentinin veri klasörü dolu (en fazla {mb} MB ve {files} dosya).',
        unavailable: 'Eklenti veri klasörü bu ortamda kullanılamıyor.'
      }
    },
    automation: {
      rateThrottled: { one: 'Hız sınırı: {count} çalışma atlandı (dakikada en fazla {limit}).', other: 'Hız sınırı: {count} çalışma atlandı (dakikada en fazla {limit}).' },
      interrupted: 'Uygulama kapandığı için yarıda kaldı.',
      tag: 'Otomasyon',
      rateLimited: {
        title: '"{name}" otomasyonu kapatıldı',
        body: "Kural bir dakikada {count} kereden fazla çalıştı; döngü olabilir. Kuralı kontrol edip Otomasyonlar'dan yeniden aç."
      },
      approval: {
        title: 'Otomasyon onay bekliyor',
        body: '{rule}: {command}. Onaylamak ya da reddetmek için tıkla.',
        rejected: 'Onay reddedildi; komut çalıştırılmadı.',
        expired: 'Onay 15 dakika içinde gelmedi; komut çalıştırılmadı.'
      },
      templates: {
        reviewAlert: 'İnceleme istendiğinde sesli uyarı',
        pinPatch: 'Takip ettiğim oyuna yama gelince bildirimi üste sabitle',
        morningCheck: 'Hafta içi her sabah tüm kaynakları kontrol et'
      },
      errors: {
        invalid: 'Kural okunamadı.',
        notFound: 'Kural bulunamadı.',
        noName: 'Kurala bir ad ver.',
        badTrigger: 'Bir tetikleyici seç.',
        badCron: 'Cron ifadesi geçersiz: "{cron}". Örnek: 0 9 * * 1-5 (hafta içi 09:00).',
        badField: '{index}. koşulun alanı geçersiz: {field}',
        badOp: '{index}. koşulun karşılaştırması geçersiz: {op}',
        emptyValue: '{index}. koşulun değeri boş.',
        badPattern: '{index}. koşulun düzenli ifadesi geçersiz ya da 200 karakterden uzun.',
        badCommand: '{index}. eylem için bir komut seç.',
        noActions: 'En az bir eylem ekle.',
        tooManyConditions: 'En fazla {max} koşul eklenebilir.',
        tooManyActions: 'En fazla {max} eylem eklenebilir.',
        tooManyRules: 'En fazla {max} kural oluşturulabilir.'
      }
    }
  },

  time: {
    justNow: 'az önce',
    today: 'Bugün',
    yesterday: 'Dün'
  },

  app: {
    name: 'Pano'
  },

  nav: {
    label: 'Görünüm',
    panel: 'Panel',
    notifications: 'Bildirimler',
    history: 'Geçmiş',
    automations: 'Otomasyonlar'
  },

  dashboard: {
    title: 'Panel',
    subtitle: { one: '{count} kart', other: '{count} kart' },
    edit: 'Düzenle',
    done: 'Bitti',
    editHint: 'Gösterilecek kartları seç; sırayı kartları sürükleyerek ya da oklarla değiştir. Değişiklikler hemen kaydedilir.',
    show: 'Göster',
    moveUp: '{title} kartını yukarı taşı',
    moveDown: '{title} kartını aşağı taşı',
    empty: 'Henüz kart yok. Kart sunan bir eklenti kurulduğunda burada görünür.',
    allHidden: "Tüm kartlar gizli. Göstermek için Düzenle'ye bas.",
    cards: 'Kartlar'
  },

  card: {
    refresh: 'Yenile',
    refreshLabel: '{title} kartını yenile',
    loading: 'Yükleniyor…',
    empty: 'Gösterilecek veri yok.',
    updated: 'Güncellendi: {when}',
    stale: 'Güncellenemedi, eski veri gösteriliyor. {error}',
    retry: 'Tekrar dene',
    openProfile: 'Profili aç'
  },

  rail: {
    sources: 'Kaynaklar',
    all: 'Tüm kaynaklar',
    empty: 'Henüz eklenti yüklenmedi. plugins klasörüne bir eklenti ekle.',
    status: {
      consent: 'Onay bekliyor',
      waiting: 'Bekliyor',
      running: 'Kontrol ediliyor',
      lastCheck: 'Son kontrol {when}',
      firstPending: 'İlk kontrol bekleniyor',
      startFailed: 'Başlatılamadı',
      cardsOnly: 'Yalnızca panel kartları'
    },
    summaryWithErrors: { one: '{count} kaynak · {failed} hatalı', other: '{count} kaynak · {failed} hatalı' },
    runNow: 'Şimdi kontrol et',
    runNowLabel: '{name} kaynağını şimdi kontrol et',
    settings: 'Ayarlar',
    settingsLabel: '{name} ayarları',
    review: 'İzinleri incele ve onayla',
    jobsLabel: '{name} kaynakları',
    appSettings: 'Uygulama ayarları',
    fix: 'Ayarları aç ve düzelt'
  },

  feed: {
    pinned: 'Sabitlenenler',
    pin: 'Sabitle',
    unpin: 'Sabitlemeyi kaldır',
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

  reader: {
    close: 'Okuyucuyu kapat',
    openInBrowser: 'Tarayıcıda aç',
    loading: 'Yükleniyor…',
    noContent: 'Bu bildirimin tam metni yok. Devamını tarayıcıda okuyabilirsin.',
    loadFailed: 'Metin yüklenemedi. Tarayıcıda açmayı dene.',
    image: 'Görseli aç',
    imageNamed: 'Görseli aç: {alt}',
    video: 'Videoyu aç',
    by: '{author} yazdı',
    fetchFull: 'Tam metni getir',
    fetchHint: 'Haber sayfası indirilip metni çıkarılır; sayfa açılmaz, çerez gönderilmez.',
    fetching: 'Sayfa indiriliyor…',
    extractFailed: 'Bu sayfadan okunabilir bir metin çıkarılamadı. Tarayıcıda açmayı dene.',
    imageLoading: 'Görsel yükleniyor…'
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
    restartPlugin: 'Yeniden dene',
    restarting: 'Eklenti yeniden başlatılıyor…',
    permissions: 'İzinler',
    permissionsHelp: 'Bu eklentinin beyan ettiği yetenekler. Yalnızca komut çalışırken kullanılabilirler.',
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



  automations: {
    title: 'Otomasyonlar',
    subtitle: { one: '{count} kural', other: '{count} kural' },
    new: 'Yeni kural',
    fromTemplate: 'Şablondan başla',
    templatesLabel: 'Hazır şablonlar',
    empty: 'Henüz otomasyon yok. Yeni bir kural oluştur ya da hazır bir şablondan başla.',
    toggleLabel: '{name} kuralını aç ya da kapat',
    edit: 'Düzenle',
    delete: 'Sil',
    deleteConfirm: '"{name}" kuralı silinsin mi?',
    trigger: {
      notification: 'Bildirim geldiğinde',
      schedule: 'Zamanlı · {cron}',
      app: 'Uygulama açılınca'
    },
    conditionCount: { one: '{count} koşul', other: '{count} koşul' },
    actionCount: { one: '{count} eylem', other: '{count} eylem' },
    nextRun: 'Sonraki: {at, date} {at, time}',
    neverRun: 'Henüz çalışmadı',
    lastRun: 'Son çalışma {when}',
    status: {
      ok: 'Tamamlandı',
      error: 'Hata',
      skipped: 'Çalışmadı',
      running: 'Çalışıyor'
    },
    disabledRateLimit: 'Dakikada {count} çalışma sınırı aşıldığı için otomatik kapatıldı.',
    approvals: {
      title: 'Onay bekleyenler',
      body: '{rule} → {command}',
      approve: 'Onayla',
      reject: 'Reddet',
      expires: 'Saat {at, time} olunca iptal olur'
    },
    editor: {
      titleNew: 'Yeni kural',
      titleEdit: 'Kuralı düzenle',
      name: 'Kural adı',
      enabled: 'Kural açık',
      step1: '1. Tetikleyici',
      step2: '2. Koşullar',
      step3: '3. Eylemler',
      triggerNotification: 'Yeni bildirim geldiğinde',
      triggerSchedule: 'Belirli zamanlarda',
      triggerApp: 'Uygulama açıldığında',
      preset: 'Sıklık',
      presets: {
        weekdayMorning: 'Hafta içi her sabah 09:00',
        everyHour: 'Her saat başı',
        everyEvening: 'Her gün 18:00',
        custom: 'Özel (cron ifadesi)'
      },
      cron: 'Cron ifadesi',
      cronHelp: 'dakika · saat · ayın günü · ay · haftanın günü (ör. 0 9 * * 1-5)',
      nextRuns: 'Sonraki çalışmalar',
      conditionsHelp: 'Tüm koşullar sağlanınca çalışır. Koşul eklemezsen her yeni bildirimde çalışır.',
      conditionsOnlyNotification: 'Koşullar yalnızca bildirim tetikleyicisinde kullanılır.',
      addCondition: 'Koşul ekle',
      removeCondition: 'Koşulu kaldır',
      field: 'Alan',
      op: 'Karşılaştırma',
      value: 'Değer',
      inHelp: 'Birden fazla değeri virgülle ayır.',
      ops: {
        eq: 'eşittir',
        neq: 'eşit değildir',
        contains: 'içerir',
        matches: 'düzenli ifadeye uyar',
        in: 'şunlardan biri'
      },
      fields: {
        source: 'Kaynak',
        level: 'Düzey',
        title: 'Başlık',
        body: 'Ayrıntı (oyun, akış, depo)',
        url: 'Adres',
        job: 'Kaynak işi',
        tags: 'Etiket'
      },
      addAction: 'Eylem ekle',
      removeAction: 'Eylemi kaldır',
      command: 'Komut',
      chooseCommand: 'Komut seç',
      templateHelp: 'Alanlara tetikleyen olaydan değer yazabilirsin: {fields}',
      noParams: 'Bu komut parametre almaz.',
      confirmWarning: 'Bu komut onay ister: otomasyondan çalışınca masaüstü bildirimiyle onayın sorulur.',
      save: 'Kaydet',
      cancel: 'Vazgeç',
      close: 'Kapat',
      test: 'Dene',
      testHelp: 'Kuralı akıştaki bir bildirimle dene. Hiçbir komut çalıştırılmaz.',
      chooseNotification: 'Bildirim seç',
      noNotifications: 'Akışta denenecek bildirim yok.',
      matched: 'Bu bildirimde kural çalışır.',
      notMatched: 'Bu bildirimde kural çalışmaz.',
      wouldRun: 'Çalışacak eylemler',
      actual: 'gerçek değer: {value}',
      emptyValue: '(boş)',
      needsConfirm: 'onay ister'
    }
  },


  consent: {
    title: '{name} şu izinleri istiyor',
    intro: 'Bu eklenti uygulamayla gelmedi. İzin vermeden kodu hiç çalıştırılmaz. İstediklerini inceleyip karar ver.',
    changed: 'Eklenti güncellendi ve izinleri değişti. Yeni istenenler işaretli.',
    isNew: 'yeni',
    approve: 'İzin ver ve başlat',
    later: 'Şimdi değil',
    revoke: 'İzinleri geri al ve durdur',
    revokeConfirm: '{name} eklentisinin izinleri geri alınsın mı? Eklenti durur ve yeniden onay ister.',
    none: 'Bu eklenti hiçbir izin istemiyor.',
    perm: {
      network: 'İnternet: {host}',
      networkAny: 'İnternette yerel ağ dışındaki her adres',
      networkFromSettings: 'Ayarlarda kendi girdiğin adresler ({path})',
      notifications: 'Bildirim gösterme',
      openExternal: 'Tarayıcıda ya da ilgili uygulamada bağlantı açma',
      runCommand: 'Başka eklentilerin komutlarını çalıştırma',
      filesystem: 'Kendi veri klasörüne dosya yazma'
    }
  },

  palette: {
    label: 'Komut paleti',
    placeholder: 'Komut ara…',
    empty: 'Eşleşen komut yok.',
    recent: 'Son kullanılanlar',
    all: 'Komutlar',
    hint: '↑↓ seç · Enter çalıştır · Esc kapat',
    step: '{step}/{total}',
    optional: 'İsteğe bağlı: boş bırakıp Enter ile geç.',
    suggestHint: 'Aramak için en az 2 harf yaz.',
    searching: 'Aranıyor…',
    noSuggestions: 'Öneri yok. Değeri yazıp Enter ile devam edebilirsin.',
    yes: 'Evet',
    no: 'Hayır',
    confirm: '{title} çalıştırılsın mı?',
    confirmHint: 'Enter: çalıştır · Esc: geri',
    useTyped: 'Yazılanı kullan: “{value}”',
    run: 'Çalıştır',
    back: 'Geri',
    listUnsupported: 'Bu komut liste türünde bir parametre istiyor; paletten çalıştırılamaz.',
    ui: {
      automations: 'Otomasyonları aç',
      panel: 'Panele git',
      notifications: 'Bildirimlere git',
      history: 'Komut geçmişini aç',
      appSettings: 'Uygulama ayarlarını aç',
      openSettings: 'Ayarları aç: {name}'
    }
  },

  runs: {
    label: 'Çalışan komutlar',
    running: 'Çalışıyor…',
    cancel: 'İptal et',
    cancelLabel: '{title} komutunu iptal et',
    done: 'Tamamlandı.',
    cancelled: 'İptal edildi.',
    dismiss: 'Kapat'
  },

  history: {
    title: 'Komut geçmişi',
    subtitle: { one: 'Son {count} çalıştırma', other: 'Son {count} çalıştırma' },
    empty: 'Henüz komut çalıştırılmadı. Komut paletini Ctrl+K ile açabilirsin.',
    rerun: 'Tekrar çalıştır',
    rerunLabel: '{title} komutunu tekrar çalıştır',
    clear: 'Geçmişi temizle',
    duration: '{seconds, number} sn',
    status: {
      ok: 'Tamamlandı',
      error: 'Hata',
      cancelled: 'İptal edildi'
    },
    origin: {
      automation: 'Otomasyon: {name}',
      palette: 'Palet',
      history: 'Geçmiş',
      notification: 'Bildirim',
      plugin: 'Eklenti',
      tray: 'Tepsi'
    }
  },

  tray: {
    palette: 'Komut paleti',
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
