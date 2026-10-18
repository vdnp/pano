import { useCallback, useEffect, useState } from 'react';

export const api = window.pano;

export function usePano() {
  const [notifications, setNotifications] = useState([]);
  const [sources, setSources] = useState([]);
  const [appSettings, setAppSettings] = useState(null);
  const [ready, setReady] = useState(false);

  // Olay dinleyicisi olarak da çağrılır; kapanış sırasında IPC reddedilebilir, sonraki olayda yenilenir
  const refreshNotifications = useCallback(
    () => api.notifications.list().then(setNotifications).catch(() => {}),
    []
  );

  const refreshSources = useCallback(
    () => api.sources.list().then(setSources).catch(() => {}),
    []
  );

  useEffect(() => {
    Promise.all([refreshNotifications(), refreshSources()]).then(() => setReady(true));
    api.appSettings.get().then(setAppSettings).catch((err) => console.warn('[pano] uygulama ayarları alınamadı', err));
    const off = [
      api.on('notifications:changed', refreshNotifications),
      api.on('sources:changed', refreshSources),
      // Tepsi menüsünden yapılan değişiklikler de buradan gelir
      api.on('appSettings:changed', setAppSettings)
    ];
    return () => off.forEach((fn) => fn());
  }, [refreshNotifications, refreshSources]);

  return { notifications, sources, appSettings, ready };
}

// Göreli zamanlar ("3 dakika önce") kendiliğinden güncellensin
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
