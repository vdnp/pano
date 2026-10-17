import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { RemoteImage } from '../lib/remote-image.jsx';
import { ExternalIcon } from './Icons.jsx';

// Kart görünümleri: sabit ve sınırlı set. Veri core'da görünümün şemasına göre temizlenmiş gelir;
// burada yalnızca metin olarak basılır, bağlantılar köprü üzerinden tarayıcıda açılır.

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase()).join('');

// Büyük sayılar kısaltılır (tr: 12,9 B · en: 12.9K); küçükler tam yazılır
function formatValue(value, locale) {
  if (typeof value !== 'number') return value;
  return Math.abs(value) >= 10000
    ? value.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 1 })
    : value.toLocaleString(locale);
}

// Birkaç büyük sayı ve etiketi
function StatView({ data }) {
  const { locale } = useI18n();
  return (
    <dl className="stat-grid">
      {data.items.map((item, i) => (
        <div key={i} className="stat">
          {/* Açıklama (ör. "dakika") etikete değil sayıya birim olarak eklenir; etiket tek satır kalır */}
          <dd className="stat-value">
            {formatValue(item.value, locale)}
            {item.hint && <span className="stat-hint">{item.hint}</span>}
          </dd>
          <dt className="stat-label" title={item.label}>{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

// Simge + başlık + alt metin satırları; adresi olan satır tarayıcıda açılır
function ListView({ data }) {
  return (
    <ul className="wlist">
      {data.items.map((item, i) => {
        const body = (
          <>
            {/* Kapak varsa geniş görsel (ör. Steam oyun kapağı), yoksa kare simge */}
            {item.cover ? (
              <RemoteImage
                src={item.cover}
                className="wlist-cover"
                fallback={<span className="wlist-cover wlist-icon-fallback" aria-hidden="true">{initials(item.title)}</span>}
              />
            ) : (
              <RemoteImage
                src={item.icon}
                className="wlist-icon"
                fallback={<span className="wlist-icon wlist-icon-fallback" aria-hidden="true">{initials(item.title)}</span>}
              />
            )}
            <span className="wlist-text">
              <span className="wlist-title">{item.title}</span>
              {item.subtitle && <span className="wlist-subtitle">{item.subtitle}</span>}
            </span>
            {item.meta && <span className="wlist-meta">{item.meta}</span>}
          </>
        );
        return (
          <li key={i}>
            {item.url ? (
              <button className="wlist-row" onClick={() => api.openExternal(item.url)}>{body}</button>
            ) : (
              <div className="wlist-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Avatar, ad, durum ve alanlar
function ProfileView({ data }) {
  const { t } = useI18n();
  return (
    <div className="wprofile">
      <div className="wprofile-head">
        <RemoteImage
          src={data.avatar}
          alt=""
          className="wprofile-avatar"
          fallback={<span className="wprofile-avatar wprofile-initials" aria-hidden="true">{initials(data.name)}</span>}
        />
        <div className="wprofile-id">
          <span className="wprofile-name">{data.name}</span>
          {data.status && (
            <span className="wprofile-status" data-tone={data.status.tone}>
              <span className="status-dot" aria-hidden="true" />
              {data.status.text}
            </span>
          )}
        </div>
      </div>
      {data.fields.length > 0 && (
        <dl className="wprofile-fields">
          {data.fields.map((f, i) => (
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.url && (
        <button className="link wprofile-link" onClick={() => api.openExternal(data.url)}>
          {t('card.openProfile')} <ExternalIcon />
        </button>
      )}
    </div>
  );
}

// İlerleme çubukları (ör. başarımlar) ve altında isteğe bağlı çubuksuz olay satırları
function ProgressView({ data }) {
  const { locale } = useI18n();
  return (
    <div className="wprogress-wrap">
      <ul className="wprogress">
        {data.items.map((item, i) => {
          const percent = Math.round((item.value / item.max) * 100);
          return (
            <li key={i}>
              <div className="wprogress-row">
                <span className="wprogress-label">{item.label}</span>
                <span className="wprogress-count">
                  {formatValue(item.value, locale)}/{formatValue(item.max, locale)} ·{' '}
                  {/* Yüzde dilin biçimiyle: tr "%95", en "95%" */}
                  {(percent / 100).toLocaleString(locale, { style: 'percent' })}
                </span>
              </div>
              <div
                className="wprogress-track"
                role="progressbar"
                aria-label={item.label}
                aria-valuemin={0}
                aria-valuemax={item.max}
                aria-valuenow={item.value}
              >
                <span className="wprogress-fill" style={{ width: `${percent}%` }} data-complete={percent === 100} />
              </div>
              {item.hint && <span className="wprogress-hint">{item.hint}</span>}
            </li>
          );
        })}
      </ul>
      {data.events?.length > 0 && (
        <ul className="wevents">
          {data.events.map((e, i) => (
            <li key={i}>
              <span className="wevents-label">{e.label}</span>
              {e.meta && <span className="wevents-meta">{e.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const VIEWS = { stat: StatView, list: ListView, profile: ProfileView, progress: ProgressView };

export function WidgetView({ view, data }) {
  const View = VIEWS[view];
  return View ? <View data={data} /> : null;
}
