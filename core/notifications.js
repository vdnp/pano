export const MAX_ITEMS = 500;
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
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  };
}

// Daha önce saklanmış bir kaydı (eski pano.json) geri yüklerken okundu bilgisi
// ve alınma zamanı korunur; geri kalan alanlar yine ortak şemadan geçer.
export function restoreNotification(raw) {
  const item = normalize(raw);
  return {
    ...item,
    read: raw.read === true,
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

    // Aynı id daha önce geldiyse false döner (tekrar göstermez).
    add(raw) {
      if (repo.has(String(raw.id))) return false;
      const item = normalize(raw);
      // Liste doluyken en eskiden de eski bir kayıt saklanmaz; "yeni" sayılırsa
      // her kontrolde tekrar masaüstü bildirimi çıkar.
      const kept = storage.transaction(() => {
        repo.insert(item);
        repo.prune(MAX_ITEMS);
        return repo.has(item.id);
      });
      if (!kept) return false;
      bus.emit('notification:new', item);
      changed();
      return true;
    },

    markRead(id) {
      repo.markRead(id);
      changed();
    },

    markAllRead(source) {
      repo.markAllRead(source);
      changed();
    },

    clear(source) {
      repo.clear(source);
      changed();
    }
  };
}
