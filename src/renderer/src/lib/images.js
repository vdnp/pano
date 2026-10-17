// Okuyucudaki görseller ana süreçte indirilip data: adresi olarak gelir (CSP: img-src 'self' data:).
// Aynı anda en fazla birkaç indirme yapılır; oturum içinde sınırlı sayıda görsel önbellekte tutulur.
export function createImageLoader(fetchImage, { concurrency = 3, maxCached = 40 } = {}) {
  const cache = new Map(); // adres → Promise<data: adresi>
  const queue = [];
  let active = 0;

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve()
        .then(() => fetchImage(job.url))
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  return function load(url) {
    if (cache.has(url)) {
      // En son kullanılan sona taşınır; sınır aşılınca en eski atılır
      const hit = cache.get(url);
      cache.delete(url);
      cache.set(url, hit);
      return hit;
    }
    const promise = new Promise((resolve, reject) => {
      queue.push({ url, resolve, reject });
      pump();
    });
    cache.set(url, promise);
    // Başarısız indirme önbellekte kalmaz; panel yeniden açılınca tekrar denenir
    promise.catch(() => cache.get(url) === promise && cache.delete(url));
    while (cache.size > maxCached) cache.delete(cache.keys().next().value);
    return promise;
  };
}
