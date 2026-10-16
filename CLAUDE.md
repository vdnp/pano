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
plugins/rss/     ayarlardaki her akış ayrı kaynak işi (sources fonksiyon); ilk çalıştırmada son 5 giriş
plugins/steam/   api.js (ortak istek/hata), news.js (GetNewsForApp, news-<appId> işleri),
                 store-search.js (resmî olmayan mağaza araması); profil/kütüphane buraya eklenecek
src/main/      Electron ana süreç: cipher (safeStorage), IPC, masaüstü bildirimleri, pencere
src/preload/   window.pano köprüsü (contextBridge)
src/renderer/  React arayüz (App.jsx, components/, lib/usePano.js, lib/i18n.jsx, styles.css)
shared/i18n.js çeviri modülü (core, main ve arayüz ortak; saf JS)
locales/       uygulama katalogları tr.js / en.js; eklentiler plugins/<ad>/locales/*.json
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
   - `sources` (şimdi): `{ [id]: { title, defaultInterval?, async run(ctx) } }` ya da
     ayarlardan bu nesneyi hesaplayan senkron `(settings) => {...}` fonksiyonu.
     `syncSources()` start ve her ayar kaydında işleri ekler/siler/günceller; kaynak
     kimliği sabit kalmalı (RSS: adresin hash'i), yoksa iş ve durumu yeniden kurulur.
   - `suggest`: `{ [provider]: async (ctx, query) => [{ label, detail?, value }] }`. Yalnızca
     bir list alanının manifest'te `suggest: { provider, placeholder? }` ile bildirdiği
     sağlayıcı çağrılabilir (IPC `sources:suggest`); `value` listenin alt şemasından geçer.
   - `providers`, `widgets`, `commands` (ileride): aynı biçimde alan olarak eklenir,
     `core/index.js` `start()` içinde katkı türü başına kayıt yapılır.
   Ayarlar ve gizli alanlar `manifest.json` (`settings`, `secrets`) şemasından gelir;
   ayarlar paneli bu şemadan otomatik oluşur. Ayar türleri: `number` (min/max),
   `boolean`, `string`, `list` (`item` alt şeması, `required` alanlar, en fazla 50 öğe,
   iç içe liste yok; boş satır ham değere göre, `required` sayılarda da geçerli). İsteğe bağlı `setup: { title, body, action }`: eklentinin hiç
   kaynağı yokken (ör. akışsız RSS) akışta gösterilen kurulum ekranı metni. `manifest.name`: `^[a-z0-9][a-z0-9-]*$`.
3. **Eklentiler Node'a doğrudan erişmez**, yalnızca `core/context.js`'deki `ctx`
   üzerinden: `log`, `warn`, `notify`, `fetch` (20 sn zaman aşımı), `settings.get/all`,
   `secrets.get`, `state.get/set`, `parseXml` (fast-xml-parser; ENTITY reddedilir). Eklenti
   klasörleri uygulamanın node_modules'una erişemez (paketlenince asar içinde); npm
   paketi gerekiyorsa core'a konur ve ctx ile verilir. Yeni yetenek gerekiyorsa eklentiye `node:*` import
   etmek yerine `ctx`'e eklenir (eklenti adıyla kapsamlanmış şekilde).
4. **Tüm bildirimler `core/notifications.js`'deki ortak şemadan geçer**
   (`id, source, title, body, url, level: info|warning|error, tags, createdAt,
   receivedAt, read, meta, job`). `meta.excerpt` (düz metin, ≤200 karakter) varsa arayüz başlığın
   altında iki satırlık özet gösterir. `body` arayüzde kaynak çipinde ("Steam · oyun adı")
   görünür; oyun/akış/depo adı olmalı. Eklenti `ctx.notify` çağırır; id otomatik
   `eklenti:id` olarak öneklenir. `job` (bildirimi üreten kaynak işi, ör. `news-730`) core
   tarafından yazılır: işler eklentiyi `ctx.forJob(id)` kopyasıyla çalıştırır. Arayüz bununla
   oyun/akış bazında, `tags` ile de tür bazında (çipler, `lib/filter.js`) süzer. Şemayı genişletmek gerekirse `normalize()` güncellenir,
   başka yerde bildirim nesnesi üretilmez.
5. **Arayüz yalnızca `window.pano` köprüsünü kullanır** (`lib/usePano.js` → `api`).
   Yeni IPC kanalı eklenince üç yer birlikte güncellenir: `src/main` `registerIpc()`
   (`handle`, argümanları `String()` vb. ile temizle), `src/preload` köprü nesnesi ve
   main→renderer olayıysa preload'daki `EVENTS` izin listesi. Pencere ayarları
   (`contextIsolation`, `sandbox`, `nodeIntegration: false`) ve CSP gevşetilmez;
   dış bağlantılar yalnızca http(s) ise `shell.openExternal` ile açılır.
6. `run` hata fırlatırsa mesajı kaynak durum satırında gösterilir: hata mesajları
   kullanıcıya dönük ve ne yapılacağını söyleyen cümleler olmalı. Eklenti hatayı
   `throw ctx.error('errors.x', params)` ile atar; metin eklentinin `locales/tr.json` ve
   `en.json` dosyalarında olur. Zamanlayıcı `errorI18n` anahtarını saklar, arayüz dil
   değişince yeniden çevirir.
7. **Çok dillilik (tr, en).** Metin yerine anahtar taşınır, çeviri gösteren katmanda
   yapılır. Arayüz `useI18n().t('feed.title')`; main `i18n.t('tray.open')`; core hataları
   `i18n.error(key)`. Bildirim etiketleri `ctx.key('tag.x')` ile anahtar olarak saklanır;
   içeriğe yazılan metin (ör. ad yerine geçen) `ctx.t` ile o anki dilde üretilir.
   Manifest metinleri Türkçe kalır; İngilizcesi eklenti `en.json`'unda `manifest.<yol>`
   altında. Uygulama dili `app.language` (system | tr | en); "system" main'de
   `app.getPreferredSystemLanguages()` ile çözülür ve `core.setLocale()` ile verilir.
   test/core/catalogs.test.js iki dilin anahtar/yer tutucu eşleşmesini ve manifest
   metinlerinin İngilizcesini denetler.

## Komutlar

```bash
npm install
npm run dev      # electron-vite dev (hot reload)
npm run build    # electron-vite build → out/
npm run start    # derlenmiş hali önizle
npm run dist     # build + electron-builder kurulum dosyası (dist/)
npm test         # vitest run: test/ altındaki core ve eklenti birim testleri (Electron'suz)
```

Testler `test/core/*.test.js`, `test/plugins/*.test.js` ve arayüzün JSX'siz mantığı için
`test/renderer/*.test.js` (ör. `src/renderer/src/lib/setup.js`); ortak yardımcılar
(geçici klasör, `writePlugin`) `test/helpers.js`'te; bellek içi depo için
`createSqliteStorage(':memory:')`. Testler Node 22.13+ ister (`node:sqlite`). Lint yapılandırması yok.

Şema değişikliği: `core/storage/migrations.js` dizisinin sonuna yeni fonksiyon eklenir;
yayınlanmış migration değiştirilmez. `node:sqlite` Vite 5'te çözülemediği için
`process.getBuiltinModule` ile alınır.

## Kod stili

- ESM her yerde; `core/` ve `plugins/` kendi `package.json`'larında `"type": "module"`.
  Node yerleşikleri `node:` önekiyle import edilir.
- Kullanıcıya görünen metinler (UI, hata mesajları, bildirim etiketleri) kodda yazılmaz,
  **tr ve en kataloglarına** eklenir (kaynak dil Türkçe); değişken/fonksiyon adları
  **İngilizce**; yorumlar ve geliştirici logları **Türkçe**, az ama "neden"i anlatan.
- Mevcut desenleri izle: fabrika fonksiyonları (`createX`), sınıf yok; React tarafında
  fonksiyon bileşenleri ve hook'lar, ek durum kütüphanesi yok.
- Tarih/saat seçili dilin biçimiyle (`src/renderer/src/lib/time.js` → `createTimeFormat`);
  mesaj içinde `{at, time}` yer tutucusu kullanılır, `toLocaleTimeString('tr-TR')` yazılmaz.

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
