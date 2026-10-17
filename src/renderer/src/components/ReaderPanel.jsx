import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../lib/usePano.js';
import { useI18n } from '../lib/i18n.jsx';
import { contentToBlocks, extractArticle, isThinContent } from '../lib/content.js';
import { loadImage } from '../lib/remote-image.jsx';
import { ipcMessage } from '../lib/ipc.js';
import { CloseIcon, ExternalIcon } from './Icons.jsx';

// Görsel ana süreçte indirilip data: adresi olarak gelir; olmazsa bağlantıya döner
function ReaderImage({ src, alt, t }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let active = true;
    loadImage(src)
      .then((dataUrl) => active && setState({ status: 'ready', dataUrl }))
      .catch(() => active && setState({ status: 'error' }));
    return () => { active = false; };
  }, [src]);

  if (state.status === 'ready') {
    return (
      <figure className="reader-image">
        <img src={state.dataUrl} alt={alt} />
        {alt && <figcaption>{alt}</figcaption>}
      </figure>
    );
  }
  if (state.status === 'loading') {
    return <p className="reader-media reader-image-loading" role="status">{t('reader.imageLoading')}</p>;
  }
  return (
    <p className="reader-media">
      <LinkOut href={src}>{alt ? t('reader.imageNamed', { alt }) : t('reader.image')}</LinkOut>
    </p>
  );
}

// İçerikteki bağlantılar uygulama içinde gezinmez; köprü yalnızca http(s) ise tarayıcıda açar
function LinkOut({ href, children }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        api.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (n.type === 'break') return <br key={i} />;
    if (n.type === 'link') {
      return <LinkOut key={i} href={n.href}><Inline nodes={n.children} /></LinkOut>;
    }
    let el = n.text;
    if (n.code) el = <code>{el}</code>;
    if (n.italic) el = <em>{el}</em>;
    if (n.bold) el = <strong>{el}</strong>;
    return <Fragment key={i}>{el}</Fragment>;
  });
}

// Blok modeli (lib/content.js) React ile çizilir; HTML hiçbir yerde doğrudan basılmaz
function Blocks({ blocks, t }) {
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'heading': {
        const Tag = b.level === 3 ? 'h3' : 'h4';
        return <Tag key={i}><Inline nodes={b.children} /></Tag>;
      }
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return <Tag key={i}>{b.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)}</Tag>;
      }
      case 'quote':
        return <blockquote key={i}><Blocks blocks={b.children} t={t} /></blockquote>;
      case 'code':
        return <pre key={i}>{b.text}</pre>;
      case 'rule':
        return <hr key={i} />;
      case 'image':
        return <ReaderImage key={i} src={b.src} alt={b.alt} t={t} />;
      case 'video':
        return <p key={i} className="reader-media"><LinkOut href={b.href}>{t('reader.video')}</LinkOut></p>;
      default:
        return <p key={i}><Inline nodes={b.children} /></p>;
    }
  });
}

export default function ReaderPanel({ notification: n, sourceName, onClose }) {
  const { t, time } = useI18n();
  const [state, setState] = useState({ status: 'loading', blocks: [] });
  const [fetchState, setFetchState] = useState({ status: 'idle' });
  const currentId = useRef(n.id);
  currentId.current = n.id;
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tam metin listede taşınmaz; panel açılınca istenir
  useEffect(() => {
    let active = true;
    setState({ status: 'loading', blocks: [] });
    setFetchState({ status: 'idle' });
    api.notifications.content(n.id)
      .then((content) => active && setState({ status: 'ready', blocks: contentToBlocks(content, n.url) }))
      .catch(() => active && setState({ status: 'error', blocks: [] }));
    return () => { active = false; };
  }, [n.id, n.url]);

  // Tam metni olmayan bildirim: haber sayfası ana süreçte indirilir (çerezsiz, yerel ağ yok),
  // makale burada çıkarılıp aynı güvenli yoldan gösterilir ve sonraki açılış için saklanır
  async function fetchFullText() {
    const id = n.id;
    setFetchState({ status: 'fetching' });
    try {
      // Önce bildirimi üreten eklenti (ör. Steam metni API'den alır); vermezse sayfa indirilir
      const fromPlugin = await api.notifications.fetchContent(id);
      if (fromPlugin) {
        if (currentId.current !== id) return;
        setState({ status: 'ready', blocks: contentToBlocks(fromPlugin, n.url) });
        setFetchState({ status: 'done' });
        return;
      }

      const page = await api.web.page(n.url);
      const article = extractArticle(page.html, page.url);
      if (!article) throw new Error(t('reader.extractFailed'));
      if (currentId.current !== id) return;
      setState({ status: 'ready', blocks: contentToBlocks(article.content, page.url) });
      setFetchState({ status: 'done' });
      api.notifications.setContent(id, article.content);
    } catch (err) {
      if (currentId.current === id) setFetchState({ status: 'failed', message: ipcMessage(err) });
    }
  }

  const author = n.meta?.author;
  const hasBody = state.blocks.length > 0;
  // İçerik yok ya da birkaç kelimeden ibaret (ör. yalnızca "Comments" bağlantısı)
  const thin = isThinContent(state.blocks);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <article className="panel reader" role="dialog" aria-modal="true" aria-labelledby="reader-title">
        <header className="reader-header">
          <span className="origin origin-static">
            <span className="origin-source">{sourceName}</span>
            {n.body && <span className="origin-detail">{n.body}</span>}
          </span>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label={t('reader.close')}>
            <CloseIcon />
          </button>
        </header>

        <h2 id="reader-title" className="reader-title">{n.title}</h2>
        <p className="reader-meta">
          <time dateTime={new Date(n.createdAt).toISOString()}>
            {time.dayLabel(n.createdAt)} · {time.clock(n.createdAt)}
          </time>
          {author && <span>{t('reader.by', { author })}</span>}
        </p>
        {n.tags.length > 0 && (
          <span className="tags">{n.tags.map((tag) => <span key={tag} className="tag">{t(tag)}</span>)}</span>
        )}

        <div className="reader-body">
          {state.status === 'loading' && <p className="help" role="status">{t('reader.loading')}</p>}
          {hasBody && <Blocks blocks={state.blocks} t={t} />}
          {/* Tam metni olmayan ya da çok kısa bildirim (GitHub, eski kayıtlar, yalnızca bağlantı
              veren akışlar): özet, "Tam metni getir" ve tarayıcıya yönlendirme */}
          {state.status !== 'loading' && thin && fetchState.status !== 'done' && (
            <>
              {!hasBody && n.meta?.excerpt && <p>{n.meta.excerpt}</p>}
              {n.url && fetchState.status !== 'failed' ? (
                <div className="reader-fetch">
                  <button className="btn" onClick={fetchFullText} disabled={fetchState.status === 'fetching'}>
                    {fetchState.status === 'fetching' ? t('reader.fetching') : t('reader.fetchFull')}
                  </button>
                  <p className="help">{t('reader.fetchHint')}</p>
                </div>
              ) : (
                <p className="notice">
                  {fetchState.status === 'failed'
                    ? fetchState.message
                    : state.status === 'error' ? t('reader.loadFailed') : t('reader.noContent')}
                </p>
              )}
            </>
          )}
        </div>

        {n.url && (
          <footer className="reader-actions">
            <button className="btn btn-primary" onClick={() => api.openExternal(n.url)}>
              {t('reader.openInBrowser')}
              <ExternalIcon />
            </button>
          </footer>
        )}
      </article>
    </div>
  );
}
