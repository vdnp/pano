import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import {
  columnsFor, dropCard, dropPlace, layoutSpans, moveCard, orderedCards, setCardVisible, widgetTitle
} from '../lib/dashboard.js';
import WidgetCard from './WidgetCard.jsx';

const GripIcon = () => (
  <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
    {[3, 8, 13].flatMap((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}
  </svg>
);

const ArrowIcon = ({ up }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d={up ? 'M8 3l5 6H3z' : 'M8 13L3 7h10z'} fill="currentColor" />
  </svg>
);

// Panel: eklentilerin kartları bir ızgarada. Düzen (görünürlük ve sıra) core'un deposunda saklanır.
export default function Dashboard({ sourceNames, now }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [widgets, setWidgets] = useState(null);
  const [layout, setLayout] = useState(null);
  const [editing, setEditing] = useState(false);
  const [cols, setCols] = useState(1);
  // Sürükle-bırak: sürüklenen kart ve imlecin üzerinde olduğu kart + bırakma yönü
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const bodyRef = useRef(null);

  // Sütun sayısı pencereye değil panelin gerçek genişliğine göre
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setCols(columnsFor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [widgets]);

  useEffect(() => {
    let timer = null;
    let last = '';
    const load = async () => {
      // Kapanış sırasında IPC reddedilebilir; panel bir sonraki olayda yeniden yüklenir
      const [list, saved] = await Promise.all([api.widgets.list(), api.dashboard.get()]).catch(() => []);
      if (!list) return;
      const key = JSON.stringify([list, saved]);
      if (key === last) return; // kaynak durum olayları sık gelir; değişmediyse yeniden çizme
      last = key;
      setWidgets(list);
      setLayout(saved);
    };
    load();
    // Eklenti ayarı değişince kart listesi değişebilir (ör. yeni oyun kartı)
    const off = api.on('sources:changed', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  if (!widgets || !layout) return <main className="dashboard" />;

  const cards = orderedCards(layout, widgets);
  const visible = cards.filter((c) => c.visible);
  const spans = layoutSpans(visible, cols);
  const save = async (next) => {
    setLayout(next);
    try {
      setLayout(await api.dashboard.set(next));
    } catch {
      /* kaydedilemezse düzen yalnızca bu oturumda geçerli kalır */
    }
  };

  // Düzenle modunda hem ızgaradaki kartlar hem listedeki satırlar sürüklenir. Klavye için
  // yukarı/aşağı düğmeleri kalır. horizontal: ızgarada bırakma yeri kartın sol/sağ yarısı.
  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const dragProps = (id, horizontal) => ({
    draggable: true,
    'data-dragging': dragId === id || undefined,
    'data-drop': over?.id === id ? over.place : undefined,
    'data-drop-axis': horizontal ? 'x' : 'y',
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDragId(id);
    },
    onDragOver: (e) => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const place = dropPlace(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY, horizontal);
      setOver((o) => (o?.id === id && o.place === place ? o : { id, place }));
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o?.id === id ? null : o));
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragId && over?.id === id) save(dropCard(cards, dragId, id, over.place));
      endDrag();
    },
    onDragEnd: endDrag
  });

  return (
    <main className="dashboard" data-editing={editing || undefined}>
      <header className="feed-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className="feed-sub">{t('dashboard.subtitle', { count: visible.length })}</p>
        </div>
        {cards.length > 0 && (
          <div className="feed-tools">
            <button className={editing ? 'btn btn-primary' : 'btn'} onClick={() => setEditing(!editing)} aria-expanded={editing}>
              {editing ? t('dashboard.done') : t('dashboard.edit')}
            </button>
          </div>
        )}
      </header>

      <div className="dashboard-body" ref={bodyRef}>
        {editing && (
          <section className="dashboard-edit" aria-label={t('dashboard.cards')}>
            <p className="help">{t('dashboard.editHint')}</p>
            <ol className="dashboard-edit-list">
              {cards.map((card, i) => {
                const title = widgetTitle(i18n, card);
                return (
                  <li key={card.id} data-hidden={!card.visible} {...dragProps(card.id, false)}>
                    <span className="dashboard-edit-grip"><GripIcon /></span>
                    <label className="dashboard-edit-show">
                      <input
                        type="checkbox"
                        checked={card.visible}
                        onChange={(e) => save(setCardVisible(cards, card.id, e.target.checked))}
                      />
                      <span className="dashboard-edit-title">{title}</span>
                      <span className="dashboard-edit-source">{sourceNames[card.plugin] ?? card.plugin}</span>
                    </label>
                    <button className="icon-btn" disabled={i === 0} onClick={() => save(moveCard(cards, card.id, -1))}
                      aria-label={t('dashboard.moveUp', { title })}>
                      <ArrowIcon up />
                    </button>
                    <button className="icon-btn" disabled={i === cards.length - 1} onClick={() => save(moveCard(cards, card.id, 1))}
                      aria-label={t('dashboard.moveDown', { title })}>
                      <ArrowIcon />
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {cards.length === 0 && <div className="empty"><p>{t('dashboard.empty')}</p></div>}
        {cards.length > 0 && visible.length === 0 && !editing && <div className="empty"><p>{t('dashboard.allHidden')}</p></div>}

        <div className="widget-grid" style={{ '--cols': cols }}>
          {visible.map((card, i) => (
            <WidgetCard
              key={card.id}
              span={spans[i]}
              widget={card}
              title={widgetTitle(i18n, card)}
              pluginName={sourceNames[card.plugin] ?? card.plugin}
              now={now}
              dragProps={editing ? dragProps(card.id, cols > 1) : undefined}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
