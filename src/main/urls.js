// Dışarıda açılacak adreslerin denetimi (Electron'suz; test edilebilir).

// Arayüzden gelen bağlantılar: yalnızca http(s)
export function isWebUrl(url) {
  try {
    return ['https:', 'http:'].includes(new URL(String(url)).protocol);
  } catch {
    return false;
  }
}

// Steam istemcisinde oyun başlatma: yalnızca tam olarak steam://rungameid/<rakamlar>.
// steam:// başka komutları da taşıyabildiği (ör. konsol, kurulum) için protokolün tamamı açılmaz.
const STEAM_RUN = /^steam:\/\/rungameid\/[1-9]\d{0,9}$/;
export const isSteamRunUrl = (url) => STEAM_RUN.test(String(url));

// Eklentinin ctx.openExternal'ı (izin beyanı ve komut içinde olma core'da denetlenir)
export const isPluginOpenable = (url) => isWebUrl(url) || isSteamRunUrl(url);
