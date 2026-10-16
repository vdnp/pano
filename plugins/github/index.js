const API = 'https://api.github.com/notifications';

const REASONS = {
  approval_requested: 'Onay istendi',
  assign: 'Sana atandı',
  author: 'Senin açtığın',
  ci_activity: 'CI',
  comment: 'Yorum',
  invitation: 'Davet',
  manual: 'Takip ettiğin',
  mention: 'Senden bahsedildi',
  review_requested: 'İnceleme istendi',
  security_alert: 'Güvenlik uyarısı',
  state_change: 'Durum değişti',
  subscribed: 'Abone olduğun',
  team_mention: 'Takımından bahsedildi'
};

const TYPES = {
  Issue: 'Issue',
  PullRequest: 'Pull request',
  Release: 'Sürüm',
  Commit: 'Commit',
  Discussion: 'Tartışma',
  CheckSuite: 'Kontrol',
  RepositoryVulnerabilityAlert: 'Güvenlik'
};

// API adresini tarayıcıda açılabilir sayfa adresine çevirir.
function htmlUrl(n) {
  const repo = n.repository?.html_url ?? 'https://github.com/notifications';
  const api = n.subject?.url;
  if (!api) return n.subject?.type === 'Discussion' ? `${repo}/discussions` : repo;

  const m = api.match(/\/repos\/[^/]+\/[^/]+\/(issues|pulls|commits|releases)\/([^/]+)$/);
  if (!m) return repo;
  const [, kind, id] = m;
  if (kind === 'issues') return `${repo}/issues/${id}`;
  if (kind === 'pulls') return `${repo}/pull/${id}`;
  if (kind === 'commits') return `${repo}/commit/${id}`;
  return `${repo}/releases`;
}

function describeError(res) {
  if (res.status === 401) return 'GitHub anahtarı geçersiz veya süresi dolmuş.';
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.headers.get('x-ratelimit-remaining') === '0' && reset) {
      const at = new Date(reset * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      return `GitHub istek sınırına ulaşıldı. ${at} sonrasında tekrar denenecek.`;
    }
    return 'GitHub erişimi reddetti. Anahtarın notifications iznine sahip olduğunu kontrol et.';
  }
  return `GitHub beklenmeyen bir yanıt verdi (${res.status}).`;
}

export default {
  sources: {
    notifications: {
      title: 'Bildirimler',

      async run(ctx) {
        const token = ctx.secrets.get('token');
        if (!token) throw new Error('Erişim anahtarı eklenmedi. Ayarlardan bir GitHub token\'ı gir.');

        const query = new URLSearchParams({
          per_page: '50',
          participating: String(Boolean(ctx.settings.get('participatingOnly')))
        }).toString();

        const headers = {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Pano'
        };

        // Değişiklik yoksa GitHub 304 döner ve istek sınırından düşmez.
        const lastModified = ctx.state.get('lastModified');
        if (lastModified && ctx.state.get('lastQuery') === query) {
          headers['If-Modified-Since'] = lastModified;
        }

        const res = await ctx.fetch(`${API}?${query}`, { headers });
        if (res.status === 304) return;
        if (!res.ok) throw new Error(describeError(res));

        const items = await res.json();
        let added = 0;

        for (const n of items) {
          const isNew = ctx.notify({
            // updated_at sayesinde aynı konuya gelen yeni hareket yeniden bildirilir
            id: `${n.id}:${n.updated_at}`,
            title: n.subject?.title ?? '(başlıksız)',
            body: n.repository?.full_name ?? '',
            url: htmlUrl(n),
            level: n.reason === 'security_alert' ? 'warning' : 'info',
            tags: [TYPES[n.subject?.type] ?? n.subject?.type, REASONS[n.reason] ?? n.reason],
            createdAt: Date.parse(n.updated_at),
            meta: {
              threadId: n.id,
              repo: n.repository?.full_name,
              reason: n.reason,
              type: n.subject?.type
            }
          });
          if (isNew) added++;
        }

        ctx.state.set('lastModified', res.headers.get('last-modified'));
        ctx.state.set('lastQuery', query);
        if (added) ctx.log(`${added} yeni bildirim`);
      }
    }
  }
};
