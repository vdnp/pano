// Eklenti penceresindeki çalışma zamanının girişi (sandbox'lı renderer, pano-plugin://<ad>/ kökeni).
// Preload'un ilettiği ilk portu alır ve runtime'ı kurar; eklentinin giriş dosyası kendi kökeninden
// yüklenir. Sonraki port mesajları yok sayılır (eklenti kodu sahte port gönderemesin).

import { fromMessagePort } from '../../shared/rpc.js';
import { startRuntime } from '../../core/sandbox/runtime.js';

let started = false;
window.addEventListener('message', (event) => {
  if (started || event.source !== window || event.data !== 'pano-plugin-port' || !event.ports?.[0]) return;
  started = true;
  startRuntime({
    port: fromMessagePort(event.ports[0]),
    importModule: (entry) => import(/* @vite-ignore */ `/${String(entry).replace(/^\/+/, '')}`)
  });
});
