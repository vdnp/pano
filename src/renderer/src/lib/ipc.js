// Electron, ana süreçteki hatayı "Error invoking remote method ..." önekiyle iletir;
// kullanıcıya yalnızca core'un ürettiği (çevrilmiş) mesaj gösterilir
export const ipcMessage = (err) =>
  String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
