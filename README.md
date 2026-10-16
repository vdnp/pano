# Pano

Eklenti tabanlı kişisel bildirim paneli. İlk aşamada GitHub bildirimlerini gösterir;
çekirdek, ileride komut ve otomasyon eklentilerini alacak şekilde tasarlandı.

## Çalıştırma

```bash
npm install
npm run dev      # geliştirme modu (hot reload)
npm run dist     # kurulum dosyası üretir (dist/ klasörü)
```

Uygulama açılınca sol taraftaki GitHub satırındaki dişli simgesinden bir
**classic** personal access token ekle (`notifications` izni yeterli).

## Yapı

```
core/            Electron'dan bağımsız çekirdek
  index.js       createCore(): her şeyi birbirine bağlar
  loader.js      plugins klasörlerini tarar, manifest okur, dinamik import yapar
  scheduler.js   kaynakları aralıklarla çalıştırır, durumlarını yayınlar
  notifications.js  ortak bildirim şeması, tekrar engelleme
  context.js     eklentiye verilen sınırlı API (ctx)
  secrets.js     şifreli anahtar saklama (şifreleme dışarıdan verilir)
  storage/       depo adaptörü: SQLite (node:sqlite), migration'lar, eski pano.json aktarımı
plugins/
  github/        örnek kaynak eklentisi
src/main/        Electron ana süreç: IPC, masaüstü bildirimleri
src/preload/     arayüze açılan window.pano köprüsü
src/renderer/    React dashboard
```

Veriler kullanıcı klasöründe `pano.db` (yerel SQLite dosyası) içinde tutulur.
Eski sürümden kalan `pano.json` ilk açılışta aktarılır ve `pano.json.yedek` olarak saklanır
(Windows: `%APPDATA%/pano`, macOS: `~/Library/Application Support/pano`).

## Eklenti yazma

Her eklenti `plugins/` altında (veya kullanıcı klasöründeki `plugins/` altında)
bir klasördür ve iki dosya içerir.

`manifest.json`: kimlik, ayarlar ve gizli alanlar. Ayarlar paneli bu şemadan
otomatik oluşturulur.

```json
{
  "name": "ornek",
  "displayName": "Örnek",
  "main": "index.js",
  "settings": {
    "interval": { "type": "number", "label": "Kontrol sıklığı (dakika)", "default": 10, "min": 1 }
  },
  "secrets": {
    "apiKey": { "label": "API anahtarı" }
  }
}
```

`index.js`: katkılarını dışa aktarır. Şimdilik desteklenen katkı türü `sources`.

```js
export default {
  async setup(ctx) {},          // isteğe bağlı, bir kez çalışır
  async teardown(ctx) {},       // isteğe bağlı, kapanışta çalışır

  sources: {
    haberler: {
      title: 'Haberler',
      async run(ctx) {
        const res = await ctx.fetch('https://ornek.com/api');
        for (const item of await res.json()) {
          ctx.notify({
            id: item.id,              // zorunlu, eklenti içinde benzersiz
            title: item.baslik,       // zorunlu
            body: item.ozet,
            url: item.link,
            level: 'info',            // info | warning | error
            tags: ['Duyuru'],
            createdAt: Date.parse(item.tarih)
          });
        }
      }
    }
  }
};
```

`ctx` içeriği: `log`, `warn`, `notify`, `fetch` (20 sn zaman aşımlı),
`settings.get`, `secrets.get`, `state.get/set` (eklentiye özel kalıcı veri).
`run` bir hata fırlatırsa mesajı kaynağın durum satırında gösterilir.

## Sonraki aşamalar

- `providers` ve `widgets` katkı türleri (oyun profilleri, istatistik kartları)
- `commands` katkı türü ve komut paleti
- Bildirim olaylarına bağlanan otomasyon kuralları
- Sistem tepsisi: pencere kapansa da arka planda çalışmaya devam etme
