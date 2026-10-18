export const MAX_ITEMS = 500;
const CONTENT_FORMATS = new Set(['bbcode', 'html', 'text']);
const MAX_CONTENT = 200_000;

// Okuyucu panelinde gösterilecek tam metin; bildirim nesnesine girmez, ayrı saklanır.
// Biçim arayüzde güvenli blok modeline çevrilir (HTML olduğu gibi basılmaz).
function normalizeContent(content) {
  if (!content || !CONTENT_FORMATS.has(content.format)) return null;
  const body = String(content.body ?? '').slice(0, MAX_CONTENT);
  return body.trim() ? { format: content.format, body } : null;
}
const LEVELS = new Set(['info', 'warning', 'error']);

// Tüm kaynakların ürettiği bildirimler bu ortak şemaya dönüştürülür.
function normalize(raw) {
  return {
    id: String(raw.id),
    source: String(raw.source),
    title: String(raw.title).slice(0, 200),
    body: raw.body ? String(raw.body).slice(0, 1000) : '',
    url: typeof raw.url === 'string' && /^https?:\/\//.test(raw.url) ? raw.url : null,
    level: LEVELS.has(raw.level) ? raw.level : 'info',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean).map(String).slice(0, 5) : [],
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    receivedAt: Date.now(),
    read: false,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    // Bildirimi üreten kaynak işi (ör. news-730); core yazar, arayüz filtrelemede kullanır
    job: raw.job ? String(raw.job) : null,
    // Sabitlenmiş bildirim akışta üstte durur (kullanıcı ya da otomasyon sabitler)
    pinned: false
  };
}

// Daha önce saklanmış bir kaydı (eski pano.json) geri yüklerken okundu bilgisi
// ve alınma zamanı korunur; geri kalan alanlar yine ortak şemadan geçer.
export function restoreNotification(raw) {
  const item = normalize(raw);
  return {
    ...item,
    read: raw.read === true,
    pinned: raw.pinned === true,
    receivedAt: Number.isFinite(raw.receivedAt) ? raw.receivedAt : item.createdAt
  };
}

export function createNotificationStore(storage, bus) {
  const repo = storage.notifications;

  function changed() {
    bus.emit('notifications:changed');
  }

  return {
    list: repo.list,
    get: (id) => repo.get(String(id)),
    content: (id) => storage.contents.get(String(id)),

    // Okuyucunun sonradan getirdiği tam metin (ör. sayfadan çıkarılan makale) önbelleğe yazılır;
    // bildirim artık yoksa (silinmiş) yazılmaz
    setContent(id, raw) {
      const content = normalizeContent(raw);
      if (!content || !repo.has(String(id))) return false;
      storage.contents.set(String(id), content);
      return true;
    },

    // Aynı id daha önce geldiyse false döner (tekrar göstermez). causedBy: bildirimi doğuran komut
    // çalıştırmasının kimliği (otomasyonun döngü önlemesi için; bildirimde saklanmaz)
    add(raw, { causedBy = null } = {}) {
      if (repo.has(String(raw.id))) return false;
      const item = normalize(raw);
      const content = normalizeContent(raw.content);
      // Liste doluyken en eskiden de eski bir kayıt saklanmaz; "yeni" sayılırsa
      // her kontrolde tekrar masaüstü bildirimi çıkar.
      const kept = storage.transaction(() => {
        repo.insert(item);
        repo.prune(MAX_ITEMS);
        const kept = repo.has(item.id);
        if (kept && content) storage.contents.set(item.id, content);
        return kept;
      });
      if (!kept) return false;
      bus.emit('notification:new', item, { causedBy: causedBy ? String(causedBy) : null });
      changed();
      return true;
    },

    // id ya da id listesi (ör. yalnızca görünen bildirimler); liste tek seferde işlenir
    markRead(ids) {
      storage.transaction(() => {
        for (const id of Array.isArray(ids) ? ids : [ids]) repo.markRead(String(id));
      });
      changed();
    },

    // Bildirim yoksa false
    setPinned(id, pinned) {
      const ok = repo.setPinned(String(id), Boolean(pinned));
      if (ok) changed();
      return ok;
    },

    // job verilirse yalnızca o işin (ör. tek bir oyunun) bildirimleri
    markAllRead(source, job) {
      repo.markAllRead(source, job);
      changed();
    },

    clear(source) {
      repo.clear(source);
      changed();
    }
  };
}
