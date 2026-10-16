import { getJson } from './api.js';

// RESMÎ OLMAYAN uç nokta: Steam mağaza sayfasının kendi arama kutusunun kullandığı
// storesearch. Belgelenmemiştir ve haber verilmeden değişebilir; bozulursa yalnızca
// ayarlardaki oyun araması etkilenir (elle App ID girmek çalışmaya devam eder).
// Resmî alternatif IStoreService/GetAppList Web API anahtarı ister ve tüm kataloğu
// döner; eski ISteamApps/GetAppList kullanımdan kalkmıştır.
const SEARCH_API = 'https://store.steampowered.com/api/storesearch/';

export async function searchGames(ctx, query) {
  const params = new URLSearchParams({ term: query, l: 'english', cc: 'US' });
  const data = await getJson(ctx, `${SEARCH_API}?${params}`);
  const items = Array.isArray(data?.items) ? data.items : [];

  // Yalnızca oyun/uygulama; paketler ve DLC dışındaki türler haber kaynağı değildir
  return items
    .filter((i) => i?.type === 'app' && Number.isInteger(i.id) && i.name)
    .map((i) => ({
      label: i.name,
      detail: ctx.t('suggest.detail', { appId: i.id }),
      value: { appId: i.id, name: i.name }
    }));
}
