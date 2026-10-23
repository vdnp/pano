import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import steam from '../../plugins/steam/index.js';
import {
  checkFriends, mapAchievements, mapLibrary, mapProfile, mapRecent, mapTopPlayed, parseSteamIdInput, providers, resolveSteamId, searchFriends
} from '../../plugins/steam/profile.js';
import { createContext } from '../../core/context.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSecrets } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { sanitizeView } from '../../core/widgets.js';
import { TEST_PERMISSIONS, pluginI18n, publicResolve, silentLogger } from '../helpers.js';

const F = JSON.parse(fs.readFileSync(new URL('../fixtures/steam-profile.json', import.meta.url), 'utf8'));
const ME = '76561197960435530';
const KEY = 'TESTKEY0123456789';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status) => new Response('<html><body>Forbidden</body></html>', { status, headers: { 'content-type': 'text/html' } });

// Uç nokta adına göre yanıt veren sahte fetch; çağrılan adresler kaydedilir
function routes(map) {
  return vi.fn(async (url) => {
    const method = Object.keys(map).find((m) => String(url).includes(`/${m}/`));
    if (!method) throw new Error(`beklenmeyen istek: ${url}`);
    const r = map[method];
    return typeof r === 'function' ? r(new URL(url)) : json(r);
  });
}

function setup(settings = {}, { locale = 'tr', key = KEY } = {}) {
  const i18n = pluginI18n('steam', locale);
  const storage = createSqliteStorage(':memory:');
  const notifications = createNotificationStore(storage, new EventEmitter());
  const secrets = createSecrets(storage.kv);
  if (key) secrets.set('steam', 'apiKey', key);
  const current = { steamId: ME, ...settings };
  const ctx = createContext('steam', { permissions: TEST_PERMISSIONS, resolveHost: publicResolve,
    notifications, store: storage.kv, secrets, logger: silentLogger(), getSettings: () => current, getI18n: () => i18n
  });
  return { ctx, notifications, settings: current };
}

describe('steam profil: SteamID girdisi', () => {
  it('SteamID64, profil adresleri ve özel adı ayırır', () => {
    expect(parseSteamIdInput(` ${ME} `)).toEqual({ steamId: ME });
    expect(parseSteamIdInput(`https://steamcommunity.com/profiles/${ME}/`)).toEqual({ steamId: ME });
    expect(parseSteamIdInput(`steamcommunity.com/profiles/${ME}`)).toEqual({ steamId: ME });
    expect(parseSteamIdInput('https://steamcommunity.com/id/gabelogannewell/')).toEqual({ vanity: 'gabelogannewell' });
    expect(parseSteamIdInput('gabelogannewell')).toEqual({ vanity: 'gabelogannewell' });
  });

  it('geçersiz girdide null döner', () => {
    for (const bad of ['', '   ', null, '12345', 'https://example.com/id/ad', 'https://steamcommunity.com/groups/x',
      'https://steamcommunity.com/profiles/123/', 'ad soyad', 'a']) {
      expect(parseSteamIdInput(bad)).toBeNull();
    }
  });

  it('SteamID64 doğrudan kullanılır, istek atılmaz', async () => {
    const { ctx } = setup();
    ctx.fetch = routes({});
    expect(await resolveSteamId(ctx)).toBe(ME);
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('özel ad ResolveVanityURL ile çözülür ve önbelleğe alınır', async () => {
    const { ctx, settings } = setup({ steamId: 'https://steamcommunity.com/id/panotest/' });
    ctx.fetch = routes({ 'ResolveVanityURL/v1': F.vanity });
    expect(await resolveSteamId(ctx)).toBe(ME);
    expect(await resolveSteamId(ctx)).toBe(ME);
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(ctx.fetch.mock.calls[0][0]).searchParams.get('vanityurl')).toBe('panotest');

    // Ayar değişince önbellek kullanılmaz
    settings.steamId = 'baskaad';
    await resolveSteamId(ctx);
    expect(ctx.fetch).toHaveBeenCalledTimes(2);
  });

  it('bulunamayan ad ve boş ayar anlaşılır hata verir', async () => {
    const { ctx, settings } = setup({ steamId: 'olmayanad' });
    ctx.fetch = routes({ 'ResolveVanityURL/v1': F.vanityMissing });
    await expect(resolveSteamId(ctx)).rejects.toThrow('Bu Steam hesabı bulunamadı');
    settings.steamId = '';
    await expect(resolveSteamId(ctx)).rejects.toThrow('Steam hesabı tanınmadı');
  });
});

describe('steam profil: hata eşleme', () => {
  it('anahtar yoksa istek atmadan söyler', async () => {
    const { ctx } = setup({}, { key: null });
    ctx.fetch = routes({});
    await expect(providers.profile.get(ctx, {})).rejects.toThrow('API anahtarı girilmemiş');
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('401/403 (HTML gövde) geçersiz anahtardır; anahtar hata metnine girmez', async () => {
    for (const status of [401, 403]) {
      const { ctx } = setup();
      ctx.fetch = routes({ 'GetPlayerSummaries/v2': () => html(status), 'GetOwnedGames/v1': () => html(status) });
      const err = await providers.profile.get(ctx, {}).catch((e) => e);
      expect(err.message).toMatch('API anahtarı geçersiz');
      expect(err.message).not.toContain(KEY);
      await expect(providers.library.get(ctx, {})).rejects.toThrow('API anahtarı geçersiz');
    }
  });

  it('gizli profilde (boş response) oyun ayrıntılarını açmayı söyler', async () => {
    const { ctx } = setup();
    ctx.fetch = routes({ 'GetOwnedGames/v1': { response: {} }, 'GetRecentlyPlayedGames/v1': { response: {} } });
    await expect(providers.library.get(ctx, {})).rejects.toThrow('"Oyun ayrıntıları"nı "Herkese açık" yap');
    await expect(providers.recent.get(ctx, {})).rejects.toThrow('Gizlilik Ayarları');
  });

  it('başarımlarda gizli profil ve başarımsız oyun ayrı mesaj verir', async () => {
    const { ctx } = setup();
    ctx.fetch = routes({ 'GetPlayerAchievements/v1': () => json(F.achievementsPrivate, 403) });
    await expect(providers.achievements.get(ctx, { appId: 413150 })).rejects.toThrow('oyun ayrıntıları gizli');
    ctx.fetch = routes({ 'GetPlayerAchievements/v1': () => json(F.achievementsNone, 400) });
    await expect(providers.achievements.get(ctx, { appId: 620 })).rejects.toThrow('Bu oyunun Steam başarımı yok');
  });

  it('İngilizce katalogla da çevrilir', async () => {
    const { ctx } = setup({}, { locale: 'en' });
    ctx.fetch = routes({ 'GetOwnedGames/v1': { response: {} } });
    await expect(providers.library.get(ctx, {})).rejects.toThrow('set "Game details" to "Public"');
  });
});

describe('steam profil: sağlayıcılar', () => {
  it('kütüphane yalnızca kartların kullandığı alanları saklar', async () => {
    const { ctx } = setup();
    ctx.fetch = routes({ 'GetOwnedGames/v1': F.owned });
    const lib = await providers.library.get(ctx, {});
    expect(lib.count).toBe(6);
    expect(lib.games[0]).toEqual({ appid: 730, name: 'Counter-Strike 2', playtime: 24720 });
    const params = new URL(ctx.fetch.mock.calls[0][0]).searchParams;
    expect(params.get('include_appinfo')).toBe('true');
    expect(params.get('include_played_free_games')).toBe('true');
    expect(params.get('steamid')).toBe(ME);
  });

  it('başarımlar şema ile birleşir, dil uygulama dilinden gelir', async () => {
    const { ctx } = setup();
    ctx.fetch = routes({ 'GetPlayerAchievements/v1': F.achievements, 'GetSchemaForGame/v2': F.schema });
    const data = await providers.achievements.get(ctx, { appId: 413150 });
    expect(data.gameName).toBe('Stardew Valley');
    expect(data.achievements).toHaveLength(4);
    expect(data.achievements[3]).toEqual({ name: 'Gizli', hidden: true, achieved: false, unlockTime: 0 });
    for (const [url] of ctx.fetch.mock.calls) expect(new URL(url).searchParams.get('l')).toBe('turkish');
  });
});

describe('steam profil: kart dönüşümleri', () => {
  const ctx = setup().ctx;
  const enCtx = setup({}, { locale: 'en' }).ctx;

  it('profil: oyundaysa oyun adı, alanlar ve adres', () => {
    const view = sanitizeView('profile', mapProfile(F.summaries.response.players[0], ctx));
    expect(view.data).toMatchObject({
      name: 'Pano Test',
      avatar: 'https://avatars.steamstatic.com/abc_full.jpg',
      url: 'https://steamcommunity.com/id/panotest/',
      status: { text: 'Oynuyor: Counter-Strike 2', tone: 'ok' },
      fields: [{ label: 'Üyelik', value: '2003' }]
    });
  });

  it('profil: çevrimdışı, son görülme ve gizli profil', () => {
    const p = { ...F.summaries.response.players[0], personastate: 0, gameextrainfo: undefined, lastlogoff: 1700000000, communityvisibilitystate: 1 };
    const view = mapProfile(p, enCtx);
    expect(view.status).toEqual({ text: 'Offline', tone: 'muted' });
    expect(view.fields.map((f) => f.label)).toEqual(['Last seen', 'Member since', 'Profile']);
    expect(view.fields[2].value).toBe('Private');
    expect(mapProfile({ ...p, personastate: 3 }, ctx).status).toEqual({ text: 'Uzakta', tone: 'warn' });
  });

  it('son oynananlar: iki haftalık süreye göre sıralı, kapaklı', () => {
    const { data } = sanitizeView('list', mapRecent(F.recent.response.games, ctx));
    expect(data.items.map((i) => i.title)).toEqual(['Counter-Strike 2', 'Stardew Valley', "Tom Clancy's Rainbow Six Siege"]);
    expect(data.items[0]).toMatchObject({
      cover: 'https://cdn.akamai.steamstatic.com/steam/apps/730/capsule_184x69.jpg',
      subtitle: 'Toplam 412 sa',
      meta: '2 haftada 11 sa',
      url: 'https://store.steampowered.com/app/730/'
    });
    expect(mapRecent([], ctx).items).toEqual([]);
  });

  it('kütüphane özeti: oyun sayısı, toplam saat, oynanma oranı', () => {
    const lib = { count: 6, games: F.owned.response.games.map((g) => ({ appid: g.appid, name: g.name, playtime: g.playtime_forever })) };
    expect(sanitizeView('stat', mapLibrary(lib, ctx)).data.items).toEqual([
      { label: 'Oyun', value: 6, hint: '' },
      { label: 'Toplam süre', value: 818, hint: 'sa' },
      { label: 'Oynanan', value: '%83', hint: '' }
    ]);
    expect(mapLibrary(lib, enCtx).items[2].value).toBe('83%');
    expect(mapLibrary({ count: 0, games: [] }, ctx).items[2].value).toBe('%0');
  });

  it('en çok oynananlar: oynanmamışlar hariç ilk 5', () => {
    const lib = { count: 6, games: F.owned.response.games.map((g) => ({ appid: g.appid, name: g.name, playtime: g.playtime_forever })) };
    const items = mapTopPlayed(lib, ctx).items;
    expect(items.map((i) => i.title)).toEqual([
      'Counter-Strike 2', "Tom Clancy's Rainbow Six Siege", 'Stardew Valley', 'Cyberpunk 2077', 'The Witcher 3: Wild Hunt'
    ]);
    // 10 saatin üstü tam sayı, altı bir ondalık
    expect(items[0].subtitle).toBe('412 saat');
    expect(items[3].subtitle).toBe('71 saat');
    expect(items[4].subtitle).toBe('0,5 saat');
    expect(mapTopPlayed({ count: 1, games: [{ appid: 1, name: 'X', playtime: 140178 }] }, ctx).items[0].subtitle).toBe('2.336 saat');
  });

  it('başarımlar: toplam ilerleme ve son açılanlar (yeniden eskiye)', () => {
    const data = {
      gameName: 'Stardew Valley',
      achievements: [
        { name: 'Acemi', hidden: false, achieved: true, unlockTime: 1700000000 },
        { name: 'Kovboy', hidden: false, achieved: true, unlockTime: 1710000000 },
        { name: 'Çiftçi', hidden: false, achieved: false, unlockTime: 0 },
        { name: 'Gizli', hidden: true, achieved: false, unlockTime: 0 }
      ]
    };
    const { data: view } = sanitizeView('progress', mapAchievements(data, ctx));
    // Tek ilerleme çubuğu; son açılanlar çubuksuz satırlar
    expect(view.items.map((i) => [i.label, i.value, i.max])).toEqual([['Toplam', 2, 4]]);
    expect(view.events).toEqual([
      { label: 'Kovboy', meta: new Date(1710000000 * 1000).toLocaleDateString('tr') },
      { label: 'Acemi', meta: new Date(1700000000 * 1000).toLocaleDateString('tr') }
    ]);
    // Gizli ve açılmamış başarımın adı hiçbir yerde görünmez
    expect(JSON.stringify(view)).not.toContain('Gizli');
  });
});

describe('steam profil: kart listesi', () => {
  it('SteamID yoksa kart yok; varsa dört kart + oyun başına başarım kartı', () => {
    const { ctx } = setup();
    expect(steam.widgets({ steamId: '' }, ctx)).toEqual({});
    const cards = steam.widgets({
      steamId: ME,
      achievementGames: [{ appId: 413150, name: 'Stardew Valley' }, { appId: 413150, name: 'tekrar' }, { appId: 'x' }, { appId: 620 }]
    }, ctx);
    expect(Object.keys(cards)).toEqual(['profile', 'recent', 'library', 'topPlayed', 'achievements-413150', 'achievements-620']);
    expect(cards.recent.size).toBe('wide');
    expect(cards['achievements-413150']).toMatchObject({ title: 'Başarımlar · Stardew Valley', params: { steamId: ME, appId: 413150 } });
    expect(cards['achievements-620'].title).toBe('Başarımlar · Steam uygulaması 620');
    // Önbellek anahtarı (params) hesabı içerir, API anahtarını içermez
    expect(JSON.stringify(Object.values(cards).map((c) => c.params))).not.toContain(KEY);
  });
});

describe('steam profil: arkadaşlar', () => {
  const players = (overrides) => ({
    response: {
      players: [
        { steamid: '76561197960265731', personaname: 'Ayşe', profileurl: 'https://steamcommunity.com/id/ayse/', personastate: 0, ...overrides[0] },
        { steamid: '76561197960265732', personaname: 'Mehmet', profileurl: 'https://steamcommunity.com/id/mehmet/', personastate: 0, ...overrides[1] }
      ]
    }
  });
  const FRIENDS = [{ steamId: '76561197960265731', name: 'Ayşe' }, { steamId: '76561197960265732', name: 'Mehmet' }];

  it('kaynak varsayılan kapalı; açılınca kendi aralığıyla eklenir', () => {
    const { ctx } = setup();
    expect(steam.sources({ friends: FRIENDS }, ctx).friends).toBeUndefined();
    expect(steam.sources({ friendsOnline: true, friends: [] }, ctx).friends).toBeUndefined();
    const source = steam.sources({ friendsOnline: true, friendsInterval: 3, friends: [...FRIENDS, { steamId: 'kotu' }] }, ctx).friends;
    expect(source).toMatchObject({ title: 'Arkadaşlar', interval: 3 });
  });

  it('ilk çalıştırma yalnızca durumu kaydeder; sonra çevrimiçi/oyun geçişlerini bildirir', async () => {
    const { ctx, notifications } = setup();
    let state = players([{}, {}]);
    ctx.fetch = routes({ 'GetPlayerSummaries/v2': () => json(state) });

    await checkFriends(ctx, FRIENDS);
    expect(notifications.list()).toHaveLength(0);

    state = players([{ personastate: 1 }, { personastate: 1, gameextrainfo: 'Counter-Strike 2' }]);
    await checkFriends(ctx, FRIENDS);
    const titles = notifications.list().map((n) => n.title).sort();
    expect(titles).toEqual(['Ayşe çevrimiçi oldu', 'Mehmet Counter-Strike 2 oynamaya başladı']);
    expect(notifications.list().find((n) => n.title.startsWith('Mehmet')).tags).toEqual(['steam:tag.friendPlaying']);

    // Aynı durum tekrar bildirilmez
    await checkFriends(ctx, FRIENDS);
    expect(notifications.list()).toHaveLength(2);
  });

  it('arama: arkadaş listesi adlarıyla gelir, önbellekten süzülür; gizli liste anlaşılır hata', async () => {
    const { ctx } = setup();
    ctx.fetch = routes({ 'GetFriendList/v1': F.friendList, 'GetPlayerSummaries/v2': players([{}, {}]) });
    const result = await searchFriends(ctx, 'ayş');
    expect(result).toEqual([{ label: 'Ayşe', detail: 'SteamID 76561197960265731', value: { steamId: '76561197960265731', name: 'Ayşe' } }]);
    await searchFriends(ctx, 'meh');
    expect(ctx.fetch).toHaveBeenCalledTimes(2);

    const other = setup().ctx;
    other.fetch = routes({ 'GetFriendList/v1': () => html(401) });
    await expect(searchFriends(other, 'a')).rejects.toThrow('Arkadaş listen gizli');
  });
});
