import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { ipcMessage } from '../lib/ipc.js';
import { RefreshIcon } from './Icons.jsx';
import { WidgetView } from './WidgetViews.jsx';

// Bir panel kartı: verisini kendisi ister, yüklenme/hata/boş durumlarını kendi içinde gösterir.
// Kartlar ayrı istendiği için birinin hatası diğerlerini etkilemez. dragProps: Düzenle modunda
// sürükle-bırak olayları (Dashboard verir).
export default function WidgetCard({ widget, title, pluginName, now, span = 1, dragProps }) {
  const { t, time } = useI18n();
  const [state, setState] = useState({ status: 'loading', result: null, error: null, refreshing: false });
  const request = useRef(0);

  const load = useCallback(async (force = false) => {
    const id = ++request.current;
    setState((s) => ({ ...s, status: s.result ? 'ready' : 'loading', refreshing: true }));
    try {
      const result = await api.widgets.data(widget.id, { force });
      if (id === request.current) setState({ status: 'ready', result, error: null, refreshing: false });
    } catch (err) {
      // Yenileme başarısızsa eldeki veri kalır, hata ayrıca gösterilir
      if (id === request.current) {
        setState((s) => ({ status: s.result ? 'ready' : 'error', result: s.result, error: ipcMessage(err), refreshing: false }));
      }
    }
  }, [widget.id]);

  useEffect(() => {
    load(false);
  }, [load]);

  const { status, result, error, refreshing } = state;
  const updated = status === 'ready' ? t('card.updated', { when: time.relativeTime(result.fetchedAt, now) }) : '';
  const stale = status === 'ready' && (result.stale || error);

  return (
    <article
      className="wcard"
      data-view={widget.view}
      aria-busy={refreshing}
      style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
      {...dragProps}
    >
      {/* Eklenti adı her kartta tekrarlanmaz (Düzenle listesinde görünür); başlığın ipucunda kalır */}
      <header className="wcard-head">
        <h2 className="wcard-title" title={`${title} · ${pluginName}`}>{title}</h2>
        {status === 'ready' && (
          <span className="wcard-updated" title={updated}>
            {time.relativeTime(result.fetchedAt, now, { narrow: true })}
          </span>
        )}
        <button
          className="icon-btn"
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label={t('card.refreshLabel', { title })}
          title={t('card.refresh')}
        >
          <RefreshIcon />
        </button>
      </header>

      <div className="wcard-body">
        {status === 'loading' && <p className="wcard-note" role="status">{t('card.loading')}</p>}
        {status === 'error' && (
          <div className="wcard-error">
            <p className="notice notice-error">{error}</p>
            <button className="btn" onClick={() => load(true)}>{t('card.retry')}</button>
          </div>
        )}
        {status === 'ready' && result.empty && <p className="wcard-note">{t('card.empty')}</p>}
        {status === 'ready' && !result.empty && <WidgetView view={result.view} data={result.data} />}
      </div>

      {/* Güncellenemedi: eldeki eski veri gösterilir, hata mesajıyla birlikte */}
      {stale && (
        <footer className="wcard-foot">
          <p className="wcard-stale" role="status">
            {t('card.stale', { error: error ?? t(result.staleErrorI18n ?? result.staleError) })}
          </p>
        </footer>
      )}
    </article>
  );
}
