import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { CloseIcon } from './Icons.jsx';

const OPTIONS = [
  {
    key: 'openAtLogin',
    label: 'Bilgisayar açılınca başlat',
    help: 'Pano oturum açıldığında pencere açmadan sistem tepsisinde başlar.'
  },
  {
    key: 'pauseNotifications',
    label: 'Bildirimleri duraklat',
    help: 'Masaüstü bildirimleri gösterilmez; kaynaklar kontrol edilmeye ve akış dolmaya devam eder.'
  }
];

// Değişiklikler anında uygulanır: tepsi menüsü de aynı ayarı değiştirebildiği için
// bekleyen bir form durumu eskiyebilirdi.
export default function AppSettingsPanel({ settings, onClose }) {
  const [message, setMessage] = useState(null);
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggle(key, value) {
    setMessage(null);
    try {
      await api.appSettings.set({ [key]: value });
    } catch {
      setMessage('Ayar kaydedilemedi. Pano\'yu yeniden başlatıp tekrar dene.');
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="app-panel-title">
        <header className="panel-header">
          <div>
            <h2 id="app-panel-title">Uygulama ayarları</h2>
            <p className="panel-desc">Pencereyi kapatınca Pano sistem tepsisinde çalışmaya devam eder.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Ayarları kapat">
            <CloseIcon />
          </button>
        </header>

        <div className="panel-form">
          {OPTIONS.map(({ key, label, help }, i) => (
            <div key={key} className="field field-check">
              <label>
                <input
                  ref={i === 0 ? firstField : undefined}
                  type="checkbox"
                  checked={Boolean(settings?.[key])}
                  disabled={!settings}
                  onChange={(e) => toggle(key, e.target.checked)}
                />
                {label}
              </label>
              <p className="help">{help}</p>
            </div>
          ))}

          {message && <p className="notice notice-error" role="status">{message}</p>}

          <div className="panel-actions">
            <button type="button" className="btn" onClick={onClose}>Kapat</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
