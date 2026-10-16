import { useCallback, useEffect, useState } from 'react';

export const api = window.pano;

export function usePano() {
  const [notifications, setNotifications] = useState([]);
  const [sources, setSources] = useState([]);
  const [appSettings, setAppSettings] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshNotifications = useCallback(async () => {
    setNotifications(await api.notifications.list());
  }, []);

  const refreshSources = useCallback(async () => {
    setSources(await api.sources.list());
  }, []);

  useEffect(() => {
    Promise.all([refreshNotifications(), refreshSources()]).then(() => setReady(true));
    api.appSettings.get().then(setAppSettings);
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
