import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './usePano.js';
import { ipcMessage } from './ipc.js';

// Başarılı ve iptal edilen çalıştırmanın sonucu bu kadar görünür; hata kapatılana kadar kalır
const KEEP_MS = 6000;

// Komut listesi ve çalışan/biten komutlar (köşedeki ilerleme kutuları için)
export function useCommands() {
  const [commands, setCommands] = useState([]);
  const [runs, setRuns] = useState([]);
  const timers = useRef(new Map());

  const refresh = useCallback(async () => {
    setCommands(await api.commands.list());
  }, []);

  const dismiss = useCallback((runId) => {
    clearTimeout(timers.current.get(runId));
    timers.current.delete(runId);
    setRuns((list) => list.filter((r) => r.runId !== runId));
  }, []);

  useEffect(() => {
    refresh();
    // Pencere yeniden yüklendiyse hâlâ çalışanlar
    api.commands.running().then((list) => setRuns((current) => (current.length ? current : list.map((r) => ({ ...r, status: 'running' })))));

    const update = (runId, patch) =>
      setRuns((list) => list.map((r) => (r.runId === runId ? { ...r, ...patch } : r)));
    const off = [
      // Ayar değişince komut listesi değişebilir (ör. ayara bağlı komutlar)
      api.on('sources:changed', refresh),
      api.on('commands:started', (info) =>
        setRuns((list) => [...list.filter((r) => r.runId !== info.runId), { ...info, status: 'running', progress: null, message: '' }])
      ),
      api.on('commands:progress', ({ runId, progress, message }) => update(runId, { progress, message })),
      api.on('commands:finished', (info) => {
        update(info.runId, { ...info, resultMessage: info.message, message: '' });
        if (info.status !== 'error') timers.current.set(info.runId, setTimeout(() => dismiss(info.runId), KEEP_MS));
      })
    ];
    const pending = timers.current;
    return () => {
      off.forEach((fn) => fn());
      pending.forEach(clearTimeout);
    };
  }, [refresh, dismiss]);

  // Çalışmaya hiç başlamadan reddedilen istek (IPC hatası) köşede hata kutusu olarak
  const report = useCallback((command, err) => {
    const runId = `local-${Date.now()}`;
    setRuns((list) => [...list, {
      runId, command: command.id, plugin: command.plugin, title: command.title, status: 'error', error: ipcMessage(err)
    }]);
  }, []);

  return { commands, runs, dismiss, report };
}
