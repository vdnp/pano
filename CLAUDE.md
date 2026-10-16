# CLAUDE.md

Pano için oturumlar arası referans. Kısa tutulur; ayrıntı için README.md.

## Amaç ve yol haritası

Pano, Electron + React ile yazılmış, eklenti tabanlı kişisel bir bildirim panelidir.
Sırasıyla: (1) **bildirimler** — kaynak eklentileri (şimdi GitHub) periyodik çalışır,
ortak şemada bildirim üretir; (2) **oyun verileri ve profil kartları** — `providers`
ve `widgets` katkı türleri; (3) **komutlar** — `commands` katkı türü ve komut paleti;
(4) **otomasyon** — bildirim olaylarına (`bus`) bağlanan kurallar. Yeni iş bu sıraya
uyar; ileriki aşamaya ait altyapıyı erkenden kurma.

## Yapı

```
core/          Electron'dan bağımsız çekirdek (createCore → bus, start/stop, notifications, sources)
  loader.js    plugins/*/manifest.json okur, default export'u dinamik import eder
  context.js   eklentiye verilen ctx
  scheduler.js zincirleme setTimeout ile kaynak işleri, durum olayları
  notifications.js  ortak bildirim şeması, id ile tekrar engelleme, en fazla 500 kayıt
  secrets.js   şifreleme dışarıdan verilen (cipher) gizli alan deposu
  storage/     depo adaptörü (openStorage): node:sqlite ile userData/pano.db; kv tablosu
               (settings, state, secrets, app) + notifications tablosu; migrations.js
               sıralı migration'lar (schema_version); legacy-json.js eski pano.json aktarımı
plugins/github/  örnek kaynak eklentisi (manifest.json + index.js)
src/main/      Electron ana süreç: cipher (safeStorage), IPC, masaüstü bildirimleri, pencere
src/preload/   window.pano köprüsü (contextBridge)
src/renderer/  React arayüz (App.jsx, components/, lib/usePano.js, styles.css)
```

Eklenti klasörleri: yerleşik `plugins/` (paketlenince `resources/plugins`) ve
kullanıcının `userData/plugins` klasörü. Aynı isim iki kez gelirse ilki kazanır.

## Mimari kurallar

1. **core/ Electron'dan tamamen bağımsızdır.** `core/` içinde `electron` import edilmez.
   Electron'a özgü her şey (`safeStorage`, `Notification`, `shell`, `app` yolları)
   `src/main` içinde kalır ve core'a parametre olarak verilir
   (örn. `createCore({ dataDir, pluginDirs, cipher, logger })`). Core'dan dışarıya
   haber `core.bus` olaylarıyla çıkar; main bunları dinler.
2. **Katkı modeli.** Eklenti modülünün default export'u bir nesnedir; isteğe bağlı
   `setup(ctx)` / `teardown(ctx)` ve katkı alanları taşır:
   - `sources` (şimdi): `{ [id]: { title, defaultInterval?, async run(ctx) } }`
   - `providers`, `widgets`, `commands` (ileride): aynı biçimde alan olarak eklenir,
     `core/index.js` `start()` içinde katkı türü başına kayıt yapılır.
   Ayarlar ve gizli alanlar `manifest.json` (`settings`, `secrets`) şemasından gelir;
   ayarlar paneli bu şemadan otomatik oluşur. `manifest.name`: `^[a-z0-9][a-z0-9-]*$`.
3. **Eklentiler Node'a doğrudan erişmez**, yalnızca `core/context.js`'deki `ctx`
   üzerinden: `log`, `warn`, `notify`, `fetch` (20 sn zaman aşımı), `settings.get/all`,
   `secrets.get`, `state.get/set`. Yeni yetenek gerekiyorsa eklentiye `node:*` import
   etmek yerine `ctx`'e eklenir (eklenti adıyla kapsamlanmış şekilde).
4. **Tüm bildirimler `core/notifications.js`'deki ortak şemadan geçer**
   (`id, source, title, body, url, level: info|warning|error, tags, createdAt,
   receivedAt, read, meta`). Eklenti `ctx.notify` çağırır; id otomatik
   `eklenti:id` olarak öneklenir. Şemayı genişletmek gerekirse `normalize()` güncellenir,
   başka yerde bildirim nesnesi üretilmez.
5. **Arayüz yalnızca `window.pano` köprüsünü kullanır** (`lib/usePano.js` → `api`).
   Yeni IPC kanalı eklenince üç yer birlikte güncellenir: `src/main` `registerIpc()`
   (`handle`, argümanları `String()` vb. ile temizle), `src/preload` köprü nesnesi ve
   main→renderer olayıysa preload'daki `EVENTS` izin listesi. Pencere ayarları
   (`contextIsolation`, `sandbox`, `nodeIntegration: false`) ve CSP gevşetilmez;
   dış bağlantılar yalnızca http(s) ise `shell.openExternal` ile açılır.
6. `run` hata fırlatırsa mesajı kaynak durum satırında gösterilir: hata mesajları
   kullanıcıya dönük, Türkçe ve ne yapılacağını söyleyen cümleler olmalı.

## Komutlar

```bash
npm install
npm run dev      # electron-vite dev (hot reload)
npm run build    # electron-vite build → out/
npm run start    # derlenmiş hali önizle
npm run dist     # build + electron-builder kurulum dosyası (dist/)
npm test         # vitest run: test/ altındaki core ve eklenti birim testleri (Electron'suz)
```

Testler `test/core/*.test.js` ve `test/plugins/*.test.js`; ortak yardımcılar
(geçici klasör, `writePlugin`) `test/helpers.js`'te; bellek içi depo için
`createSqliteStorage(':memory:')`. Testler Node 22.13+ ister (`node:sqlite`). Lint yapılandırması yok.

Şema değişikliği: `core/storage/migrations.js` dizisinin sonuna yeni fonksiyon eklenir;
yayınlanmış migration değiştirilmez. `node:sqlite` Vite 5'te çözülemediği için
`process.getBuiltinModule` ile alınır.

## Kod stili

- ESM her yerde; `core/` ve `plugins/` kendi `package.json`'larında `"type": "module"`.
  Node yerleşikleri `node:` önekiyle import edilir.
- Kullanıcıya görünen metinler (UI, hata mesajları, bildirim etiketleri) **Türkçe**;
  değişken/fonksiyon adları **İngilizce**; yorumlar **Türkçe** ve az ama "neden"i anlatan.
- Mevcut desenleri izle: fabrika fonksiyonları (`createX`), sınıf yok; React tarafında
  fonksiyon bileşenleri ve hook'lar, ek durum kütüphanesi yok.
- Tarih/saat biçimleri `tr-TR` (`src/renderer/src/lib/time.js`).

## Tasarım sistemi

`src/renderer/src/styles.css` `:root` değişkenleri tek kaynaktır:
`--bg --rail --surface --line --text --muted --amber --amber-ink --ok --err --focus`,
fontlar `--display` (Chakra Petch 500/600, başlıklar) ve `--body` (Manrope 400/600/700,
gövde). Tema koyu (`color-scheme: dark`). Yeni arayüz yalnızca bu değişkenleri
kullanır; **yeni renk veya font eklenmez**, sabit hex yazılmaz. Fontlar
`@fontsource` paketlerinden `main.jsx`'te import edilir (CSP harici kaynağa izin vermez).

## Çalışma şekli

- Her görevde önce kısa bir **plan sun ve onay bekle**; onaysız kod değiştirme.
- Mevcut dosyaları gereksiz yere baştan yazma; hedefli düzenleme yap.
- Kapsam dışı "iyileştirme" yapma; gerekiyorsa öner.
- Bitince **neyi nasıl test ettiğini** özetle (hangi komut, hangi senaryo, ne
  doğrulanamadı). Test yoksa bunu açıkça söyle.
