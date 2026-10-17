import { checkNews, gameName, newsContent } from './news.js';
import {
  checkFriends, mapAchievements, mapLibrary, mapProfile, mapRecent, mapTopPlayed, providers, searchFriends
} from './profile.js';
import { searchGames } from './store-search.js';

const validAppId = (v) => Number.isInteger(Number(v)) && Number(v) >= 1;

export default {
  // Kaynak kimlikleri türe göre öneklidir (news-570, friends)
  sources(settings, ctx) {
    const result = {};
    for (const entry of settings.games ?? []) {
      const appId = Number(entry?.appId);
      if (!validAppId(appId)) continue;
      const id = `news-${appId}`;
      if (result[id]) continue; // aynı oyun iki kez eklendiyse ilki kullanılır

      const game = { appId, name: String(entry.name ?? '').trim() };
      result[id] = { title: gameName(game, ctx), run: (runCtx) => checkNews(runCtx, game) };
    }

    // Arkadaş bildirimi isteğe bağlı; haberlerden daha sık çalışır
    const friends = (settings.friends ?? []).filter((f) => /^\d{17}$/.test(String(f?.steamId ?? '').trim()))
      .map((f) => ({ steamId: String(f.steamId).trim(), name: String(f.name ?? '').trim() }));
    if (settings.friendsOnline && friends.length > 0) {
      result.friends = {
        title: ctx.t('friends.title'),
        interval: settings.friendsInterval,
        run: (runCtx) => checkFriends(runCtx, friends)
      };
    }
    return result;
  },

  providers,

  // Profil kartları yalnızca SteamID girildiyse görünür. Önbellek anahtarı SteamID'yi içerir;
  // ayardaki hesap değişince eski hesabın verisi gösterilmez (API anahtarı anahtara girmez).
  widgets(settings, ctx) {
    const steamId = String(settings.steamId ?? '').trim();
    if (!steamId) return {};
    const cards = {
      profile: { title: 'widgets.profile', view: 'profile', provider: 'profile', params: { steamId }, map: mapProfile },
      recent: { title: 'widgets.recent', view: 'list', provider: 'recent', size: 'wide', params: { steamId }, map: mapRecent },
      library: { title: 'widgets.library', view: 'stat', provider: 'library', params: { steamId }, map: mapLibrary },
      topPlayed: { title: 'widgets.topPlayed', view: 'list', provider: 'library', params: { steamId }, map: mapTopPlayed }
    };
    for (const entry of settings.achievementGames ?? []) {
      if (!validAppId(entry?.appId)) continue;
      const appId = Number(entry.appId);
      const id = `achievements-${appId}`;
      if (cards[id]) continue;
      // Başlık o anki dilde üretilir; liste her istendiğinde yeniden hesaplanır
      const game = { appId, name: String(entry.name ?? '').trim() };
      cards[id] = {
        title: ctx.t('widgets.achievementsFor', { game: gameName(game, ctx) }),
        view: 'progress',
        provider: 'achievements',
        params: { steamId, appId },
        map: mapAchievements
      };
    }
    return cards;
  },

  commands: {
    // steam://rungameid/<appId>: Steam istemcisi oyunu başlatır (kurulu değilse kurulum ekranını açar).
    // Uygulama bu adres türünü ayrıca ve yalnızca bu biçimde izinli sayar (src/main/urls.js).
    launchGame: {
      title: 'commands.launchGame.title',
      description: 'commands.launchGame.description',
      params: {
        appId: {
          type: 'number', label: 'commands.launchGame.appId', required: true, min: 1,
          suggest: { provider: 'searchGames', placeholder: 'commands.launchGame.placeholder' }
        },
        name: { type: 'string', label: 'commands.launchGame.name' }
      },
      async run(ctx, { appId, name }) {
        if (!validAppId(appId)) throw ctx.error('errors.badAppId');
        await ctx.openExternal(`steam://rungameid/${appId}`);
        return { message: ctx.t('commands.launchGame.done', { game: gameName({ appId, name: name ?? '' }, ctx) }) };
      }
    }
  },

  // Ayarlar panelindeki ve paletteki arama kutuları (manifest: settings.X.suggest.provider)
  suggest: { searchGames, searchFriends },

  // Okuyucunun "Tam metni getir"i: haber metni Steam API'sinden
  content: newsContent
};
