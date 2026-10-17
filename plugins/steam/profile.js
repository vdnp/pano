import { fetchJson } from './api.js';

// Steam Web API (anahtarlı). Uç noktalar ve parametreler resmî belgeden (partner.steamgames.com/doc/webapi);
// belgeler yanıt alanlarını tanımlamaz, alan adları Valve örneklerinden ve yaygın kullanımdan gelir.
const API = 'https://api.steampowered.com';
const STEAMID64 = /^7656119\d{10}$/;
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;
const FRIENDS_CACHE_MS = 10 * 60_000;

const capsule = (appId) => `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_184x69.jpg`;
const storePage = (appId) => `https://store.steampowered.com/app/${appId}/`;
// 10 saatin altında bir ondalık (0,5 sa), üstünde tam sayı (2.336 sa): büyük sayıda ondalık gürültüdür
const hours = (minutes) => {
  const h = (Number(minutes) || 0) / 60;
  return h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
};

// Ayardaki girdiden SteamID ya da özel ad: "7656119…", ".../profiles/7656119…", ".../id/ad", "ad"
export function parseSteamIdInput(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return null;
  if (STEAMID64.test(input)) return { steamId: input };

  let path = null;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (/(^|\.)steamcommunity\.com$/i.test(url.hostname)) path = url.pathname;
  } catch {
    path = null;
  }
  if (path) {
    const profile = path.match(/^\/profiles\/(\d+)\/?/);
    if (profile) return STEAMID64.test(profile[1]) ? { steamId: profile[1] } : null;
    const vanity = path.match(/^\/id\/([^/]+)\/?/);
    if (vanity) return VANITY.test(vanity[1]) ? { vanity: vanity[1] } : null;
    return null;
  }
  // Yalnızca rakamdan oluşan girdi büyük olasılıkla eksik yazılmış SteamID'dir, özel ad sayılmaz
  return VANITY.test(input) && !/^\d+$/.test(input) ? { vanity: input } : null;
}

// Anahtarlı istek; anahtar adresle gider ama hiçbir hataya/loga yazılmaz
async function call(ctx, method, params) {
  const key = ctx.secrets.get('apiKey');
  if (!key) throw ctx.error('errors.noApiKey');
  const query = new URLSearchParams({ key, ...params });
  return fetchJson(ctx, `${API}/${method}/?${query}`);
}

// Gövdesiz 401/403 geçersiz anahtardır; diğer başarısız kodlar genel hata
function expectOk(ctx, result) {
  if (result.ok) return result.data ?? {};
  if (result.status === 401 || result.status === 403) throw ctx.error('errors.invalidApiKey');
  throw ctx.error('errors.http', { status: result.status });
}

// Ayardaki SteamID ya da profil adresi; özel ad ResolveVanityURL ile çözülür ve önbelleğe alınır
export async function resolveSteamId(ctx) {
  const input = String(ctx.settings.get('steamId') ?? '').trim();
  const parsed = parseSteamIdInput(input);
  if (!parsed) throw ctx.error('errors.steamIdMissing');
  if (parsed.steamId) return parsed.steamId;

  const cached = ctx.state.get('vanity');
  if (cached?.input === input && cached.steamId) return cached.steamId;

  const data = expectOk(ctx, await call(ctx, 'ISteamUser/ResolveVanityURL/v1', { vanityurl: parsed.vanity }));
  const steamId = String(data.response?.steamid ?? '');
  // success 1: bulundu; 42: eşleşme yok
  if (data.response?.success !== 1 || !STEAMID64.test(steamId)) throw ctx.error('errors.steamIdNotFound');
  ctx.state.set('vanity', { input, steamId });
  return steamId;
}

async function summaries(ctx, steamIds) {
  const data = expectOk(ctx, await call(ctx, 'ISteamUser/GetPlayerSummaries/v2', { steamids: steamIds.join(',') }));
  return Array.isArray(data.response?.players) ? data.response.players : [];
}

// --- Providers -------------------------------------------------------------------------------

export const providers = {
  profile: {
    title: 'Steam profili',
    ttl: 120,
    async get(ctx) {
      const steamId = await resolveSteamId(ctx);
      const [player] = await summaries(ctx, [steamId]);
      if (!player) throw ctx.error('errors.steamIdNotFound');
      return player;
    }
  },

  recent: {
    title: 'Son oynananlar',
    ttl: 600,
    async get(ctx) {
      const steamid = await resolveSteamId(ctx);
      const data = expectOk(ctx, await call(ctx, 'IPlayerService/GetRecentlyPlayedGames/v1', { steamid, count: '10' }));
      // Gizli profilde response boş gelir; herkese açık ama son iki haftada oyun yoksa total_count 0
      if (!data.response || !('total_count' in data.response)) throw ctx.error('errors.privateProfile');
      return data.response.games ?? [];
    }
  },

  library: {
    title: 'Kütüphane',
    ttl: 3600,
    async get(ctx) {
      const steamid = await resolveSteamId(ctx);
      const data = expectOk(ctx, await call(ctx, 'IPlayerService/GetOwnedGames/v1', {
        steamid,
        include_appinfo: 'true',
        include_played_free_games: 'true'
      }));
      if (!data.response || !('game_count' in data.response)) throw ctx.error('errors.privateProfile');
      // Önbelleğe yalnızca kartların kullandığı alanlar girer (büyük kütüphanelerde boyut sınırı)
      return {
        count: data.response.game_count,
        games: (data.response.games ?? []).map((g) => ({ appid: g.appid, name: g.name, playtime: g.playtime_forever ?? 0 }))
      };
    }
  },

  achievements: {
    title: 'Başarımlar',
    ttl: 1800,
    async get(ctx, { appId }) {
      const steamid = await resolveSteamId(ctx);
      const l = ctx.t('apiLanguage');
      const player = await call(ctx, 'ISteamUserStats/GetPlayerAchievements/v1', { steamid, appid: String(appId), l });
      const stats = player.data?.playerstats;
      // Gizli profil ve başarımsız oyun, hata koduyla birlikte JSON gövdede açıklanır
      if (stats?.success === false || (!player.ok && stats?.error)) {
        const reason = String(stats?.error ?? '');
        if (/not public|private/i.test(reason)) throw ctx.error('errors.privateProfile');
        if (/no stats|no achievements/i.test(reason)) throw ctx.error('errors.noAchievements');
        throw ctx.error('errors.http', { status: player.status });
      }
      expectOk(ctx, player);

      const schema = expectOk(ctx, await call(ctx, 'ISteamUserStats/GetSchemaForGame/v2', { appid: String(appId), l }));
      const defs = schema.game?.availableGameStats?.achievements ?? [];
      const unlocked = new Map((stats?.achievements ?? []).map((a) => [a.apiname, a]));
      if (defs.length === 0 && unlocked.size === 0) throw ctx.error('errors.noAchievements');

      return {
        gameName: stats?.gameName || schema.game?.gameName || '',
        achievements: (defs.length ? defs : [...unlocked.values()].map((a) => ({ name: a.apiname }))).map((d) => {
          const u = unlocked.get(d.name);
          return {
            name: d.displayName || u?.name || d.name,
            hidden: d.hidden === 1,
            achieved: u?.achieved === 1,
            unlockTime: Number(u?.unlocktime) || 0
          };
        })
      };
    }
  }
};

// --- Kartların map fonksiyonları -------------------------------------------------------------

// personastate: 0 çevrimdışı, 1 çevrimiçi, 2 meşgul, 3 uzakta, 4 uyuyor, 5 takas, 6 oyun arıyor
const PERSONA = { 0: ['offline', 'muted'], 1: ['online', 'ok'], 2: ['busy', 'warn'], 3: ['away', 'warn'], 4: ['snooze', 'warn'], 5: ['online', 'ok'], 6: ['online', 'ok'] };

export function mapProfile(p, ctx) {
  const [state, tone] = PERSONA[p.personastate] ?? PERSONA[0];
  const status = p.gameextrainfo
    ? { text: ctx.t('profile.playing', { game: p.gameextrainfo }), tone: 'ok' }
    : { text: ctx.t(`profile.state.${state}`), tone };
  const fields = [];
  if (!p.gameextrainfo && p.personastate === 0 && p.lastlogoff) {
    fields.push({ label: ctx.t('profile.lastSeen'), value: ctx.t('profile.date', { at: p.lastlogoff * 1000 }) });
  }
  if (p.timecreated) {
    fields.push({ label: ctx.t('profile.memberSince'), value: new Date(p.timecreated * 1000).getUTCFullYear() });
  }
  // communityvisibilitystate 3 herkese açık; diğerlerinde oyun ayrıntıları görünmez
  if (p.communityvisibilitystate !== 3) fields.push({ label: ctx.t('profile.visibility'), value: ctx.t('profile.private') });
  return { name: p.personaname, avatar: p.avatarfull, url: p.profileurl, status, fields };
}

export function mapRecent(games, ctx) {
  return {
    items: [...games]
      .sort((a, b) => (b.playtime_2weeks ?? 0) - (a.playtime_2weeks ?? 0))
      .map((g) => ({
        cover: capsule(g.appid),
        title: g.name,
        subtitle: ctx.t('recent.total', { hours: hours(g.playtime_forever) }),
        meta: ctx.t('recent.twoWeeks', { hours: hours(g.playtime_2weeks) }),
        url: storePage(g.appid)
      }))
  };
}

export function mapLibrary(lib, ctx) {
  const total = lib.games.reduce((sum, g) => sum + g.playtime, 0);
  const played = lib.games.filter((g) => g.playtime > 0).length;
  const ratio = lib.count ? Math.round((played / lib.count) * 100) : 0;
  return {
    items: [
      { label: ctx.t('library.games'), value: lib.count },
      { label: ctx.t('library.hours'), value: Math.round(total / 60), hint: ctx.t('library.hoursUnit') },
      { label: ctx.t('library.played'), value: ctx.t('library.percent', { value: ratio }) }
    ]
  };
}

export function mapTopPlayed(lib, ctx) {
  return {
    items: [...lib.games]
      .filter((g) => g.playtime > 0)
      .sort((a, b) => b.playtime - a.playtime)
      .slice(0, 5)
      .map((g) => ({ cover: capsule(g.appid), title: g.name, subtitle: ctx.t('top.hours', { hours: hours(g.playtime) }), url: storePage(g.appid) }))
  };
}

// Tek ilerleme çubuğu ve altında son açılan 5 başarım (çubuksuz satırlar);
// gizli ve açılmamış başarımların adı gösterilmez
export function mapAchievements(data, ctx) {
  const total = data.achievements.length;
  const done = data.achievements.filter((a) => a.achieved);
  const recent = [...done].sort((a, b) => b.unlockTime - a.unlockTime).slice(0, 5);
  return {
    items: [{ label: ctx.t('achievements.total'), value: done.length, max: total }],
    events: recent.map((a) => ({
      label: a.name,
      meta: a.unlockTime ? ctx.t('achievements.unlocked', { at: a.unlockTime * 1000 }) : ''
    }))
  };
}

// --- Arkadaşlar: arama önerisi ve bildirim kaynağı ------------------------------------------

// Arkadaş listesi (adlarıyla) 10 dakika önbellekte; arama kutusu her tuşta API'ye gitmesin
async function friendsWithNames(ctx) {
  const cached = ctx.state.get('friends');
  if (cached && Date.now() - cached.at < FRIENDS_CACHE_MS) return cached.list;

  const steamid = await resolveSteamId(ctx);
  const res = await call(ctx, 'ISteamUser/GetFriendList/v1', { steamid, relationship: 'friend' });
  // Belge: arkadaş listesi gizliyse 401
  if (res.status === 401) throw ctx.error('errors.friendsPrivate');
  const data = expectOk(ctx, res);
  const ids = (data.friendslist?.friends ?? []).map((f) => String(f.steamid)).slice(0, 500);

  const list = [];
  for (let i = 0; i < ids.length; i += 100) {
    for (const p of await summaries(ctx, ids.slice(i, i + 100))) list.push({ steamId: String(p.steamid), name: p.personaname });
  }
  ctx.state.set('friends', { at: Date.now(), list });
  return list;
}

export async function searchFriends(ctx, query) {
  const q = query.toLocaleLowerCase();
  return (await friendsWithNames(ctx))
    .filter((f) => f.name.toLocaleLowerCase().includes(q))
    .slice(0, 20)
    .map((f) => ({ label: f.name, detail: ctx.t('friends.detail', { id: f.steamId }), value: { steamId: f.steamId, name: f.name } }));
}

// Seçili arkadaşlar çevrimiçi olunca ya da bir oyuna girince bildirim. İlk çalıştırma
// yalnızca başlangıç durumunu kaydeder; aynı durumda tekrar bildirim gelmez.
export async function checkFriends(ctx, friends) {
  const ids = friends.map((f) => f.steamId).slice(0, 100);
  if (ids.length === 0) return;
  const players = await summaries(ctx, ids);
  const saved = ctx.state.get('presence') ?? null;
  const now = {};

  for (const p of players) {
    const id = String(p.steamid);
    const current = { online: Number(p.personastate) > 0, game: p.gameextrainfo || null };
    now[id] = current;
    const before = saved?.[id];
    if (!saved || !before) continue;

    const name = p.personaname;
    const stamp = Math.floor(Date.now() / 60_000);
    if (current.game && current.game !== before.game) {
      ctx.notify({
        id: `${id}:game:${stamp}`,
        title: ctx.t('friends.playing', { name, game: current.game }),
        body: name,
        url: p.profileurl,
        tags: [ctx.key('tag.friendPlaying')],
        meta: { steamId: id, game: current.game }
      });
    } else if (current.online && !before.online) {
      ctx.notify({
        id: `${id}:online:${stamp}`,
        title: ctx.t('friends.online', { name }),
        body: name,
        url: p.profileurl,
        tags: [ctx.key('tag.friendOnline')],
        meta: { steamId: id }
      });
    }
  }
  ctx.state.set('presence', { ...(saved ?? {}), ...now });
}
