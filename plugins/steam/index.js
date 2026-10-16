import { checkNews, gameName } from './news.js';
import { searchGames } from './store-search.js';

export default {
  // Kaynak kimlikleri türe göre öneklidir (news-570). Profil ve kütüphane işleri
  // sonraki aşamada aynı listeye kendi önekleriyle eklenecek.
  sources(settings, ctx) {
    const result = {};
    for (const entry of settings.games ?? []) {
      const appId = Number(entry?.appId);
      if (!Number.isInteger(appId) || appId < 1) continue;
      const id = `news-${appId}`;
      if (result[id]) continue; // aynı oyun iki kez eklendiyse ilki kullanılır

      const game = { appId, name: String(entry.name ?? '').trim() };
      result[id] = { title: gameName(game, ctx), run: (runCtx) => checkNews(runCtx, game) };
    }
    return result;
  },

  // Ayarlar panelindeki arama kutusu (manifest: settings.games.suggest.provider)
  suggest: { searchGames }
};
