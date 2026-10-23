import { ipcRenderer } from 'electron';

// Eklenti penceresinin preload'u (sandbox'lı): hiçbir API açmaz, yalnızca main'in gönderdiği
// MessagePort'u sayfaya (ana dünyaya) iletir. Eklenti main ile yalnızca bu port üzerinden konuşur.
ipcRenderer.once('pano-plugin-port', (event) => {
  window.postMessage('pano-plugin-port', '*', event.ports);
});
