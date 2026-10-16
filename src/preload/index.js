import { contextBridge, ipcRenderer } from 'electron';

const EVENTS = new Set(['notifications:changed', 'sources:changed', 'appSettings:changed']);
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// Arayüz sadece bu nesneyi görür; Node veya ipcRenderer'a doğrudan erişemez.
contextBridge.exposeInMainWorld('pano', {
  notifications: {
    list: invoke('notifications:list'),
    markRead: invoke('notifications:markRead'),
    markAllRead: invoke('notifications:markAllRead'),
    clear: invoke('notifications:clear')
  },
  sources: {
    list: invoke('sources:list'),
    runNow: invoke('sources:runNow'),
    updateSettings: invoke('sources:updateSettings'),
    setSecret: invoke('sources:setSecret'),
    suggest: invoke('sources:suggest')
  },
  appSettings: {
    get: invoke('appSettings:get'),
    set: invoke('appSettings:set')
  },
  openExternal: invoke('app:openExternal'),

  // Dinleyiciyi kaldıran bir fonksiyon döner
  on(channel, callback) {
    if (!EVENTS.has(channel)) throw new Error(`Bilinmeyen olay: ${channel}`);
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
