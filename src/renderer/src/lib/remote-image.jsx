import { useEffect, useState } from 'react';
import { api } from './usePano.js';
import { createImageLoader } from './images.js';

// Uzak görseller (haber görselleri, avatarlar, kapaklar) CSP gevşetilmeden gösterilir: ana süreç
// indirir (yalnızca http(s), yerel ağ yok, SVG yok, boyut sınırlı) ve data: adresi olarak verir.
// Okuyucu ve panel kartları aynı önbelleği paylaşır.
export const loadImage = createImageLoader((url) => api.web.image(url));

// fallback: yüklenirken ve yüklenemezse gösterilecek öğe (ör. baş harfler, bağlantı)
export function RemoteImage({ src, alt = '', className, fallback = null }) {
  const [state, setState] = useState({ status: src ? 'loading' : 'error' });

  useEffect(() => {
    if (!src) return undefined;
    let active = true;
    setState({ status: 'loading' });
    loadImage(src)
      .then((dataUrl) => active && setState({ status: 'ready', dataUrl }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [src]);

  if (state.status !== 'ready') return fallback;
  return <img className={className} src={state.dataUrl} alt={alt} />;
}
