// Panel altyapısını denemek için demo: dört görünümün her biri için bir kart. Ağa çıkmaz;
// "stats" sağlayıcısı kısa ttl ile rastgele sayı üretir, böylece önbellek ve yenile gözle görülür.

const pick = (n) => Math.floor(Math.random() * n);

export default {
  providers: {
    stats: {
      title: 'İstatistik',
      ttl: 60,
      async get() {
        return { unread: pick(40), sources: 3 + pick(3), uptime: 30 + pick(600), at: Date.now() };
      }
    },
    profile: {
      title: 'Profil',
      ttl: 600,
      async get() {
        return { name: 'Pano Kullanıcısı', online: true, level: 27, games: 48, since: 2019 };
      }
    },
    library: {
      title: 'Kütüphane',
      ttl: 600,
      async get() {
        return [
          { name: 'Counter-Strike 2', hours: 412, daysAgo: 1 },
          { name: "Tom Clancy's Rainbow Six Siege", hours: 238, daysAgo: 3 },
          { name: 'Stardew Valley', hours: 96, daysAgo: 8 },
          { name: 'Cyberpunk 2077', hours: 71, daysAgo: 34 }
        ];
      }
    },
    achievements: {
      title: 'Başarımlar',
      ttl: 600,
      async get() {
        return [
          { game: 'Stardew Valley', done: 38, total: 40 },
          { game: 'Cyberpunk 2077', done: 29, total: 57 },
          { game: 'Counter-Strike 2', done: 1, total: 1 }
        ];
      }
    },
    broken: {
      title: 'Hatalı kaynak',
      async get(ctx) {
        throw ctx.error('errors.demo');
      }
    }
  },

  // Ayara göre değişen kart listesi: "Hata kartını göster" açıksa bir kart daha
  widgets(settings) {
    // Demo kartları panelde gizli başlar (gerçek kartlarla karışmasın); Düzenle'den açılır
    const cards = {
      summary: {
        title: 'widgets.summary',
        view: 'stat',
        provider: 'stats',
        map: (d, ctx) => ({
          items: [
            { label: ctx.t('stat.unread'), value: d.unread },
            { label: ctx.t('stat.sources'), value: d.sources },
            { label: ctx.t('stat.uptime'), value: d.uptime, hint: ctx.t('stat.minutes') }
          ]
        })
      },
      profile: {
        title: 'widgets.profile',
        view: 'profile',
        provider: 'profile',
        map: (d, ctx) => ({
          name: d.name,
          status: { text: ctx.t(d.online ? 'profile.online' : 'profile.offline'), tone: d.online ? 'ok' : 'muted' },
          fields: [
            { label: ctx.t('profile.level'), value: d.level },
            { label: ctx.t('profile.games'), value: d.games },
            { label: ctx.t('profile.since'), value: d.since }
          ]
        })
      },
      library: {
        title: 'widgets.library',
        view: 'list',
        provider: 'library',
        size: 'wide',
        map: (games, ctx) => ({
          items: games.map((g) => ({ title: g.name, subtitle: ctx.t('library.hours', { hours: g.hours }), meta: ctx.t('library.daysAgo', { count: g.daysAgo }) }))
        })
      },
      achievements: {
        title: 'widgets.achievements',
        view: 'progress',
        provider: 'achievements',
        map: (list) => ({ items: list.map((a) => ({ label: a.game, value: a.done, max: a.total })) })
      }
    };
    if (settings.showError) cards.broken = { title: 'widgets.broken', view: 'stat', provider: 'broken' };
    for (const card of Object.values(cards)) card.hidden = true;
    return cards;
  }
};
