const API = 'https://api.github.com/notifications';

// Tanınan sebep ve türler bildirim etiketinde çeviri anahtarı olarak saklanır
// (github:reason.mention); bilinmeyen yeni değerler GitHub'ın verdiği haliyle kalır.
const REASONS = new Set([
  'approval_requested', 'assign', 'author', 'ci_activity', 'comment', 'invitation', 'manual',
  'mention', 'review_requested', 'security_alert', 'state_change', 'subscribed', 'team_mention'
]);
const TYPES = new Set([
  'Issue', 'PullRequest', 'Release', 'Commit', 'Discussion', 'CheckSuite', 'RepositoryVulnerabilityAlert'
]);

const tagFor = (ctx, kind, known, value) => (known.has(value) ? ctx.key(`${kind}.${value}`) : value);

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

function describeError(ctx, res) {
  if (res.status === 401) return ctx.error('errors.invalidToken');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.headers.get('x-ratelimit-remaining') === '0' && reset) {
      // Saat, mesaj gösterilirken uygulama dilinin biçimiyle yazılır
      return ctx.error('errors.rateLimited', { at: reset * 1000 });
    }
    return ctx.error('errors.forbidden');
  }
  return ctx.error('errors.http', { status: res.status });
}

export default {
  sources: {
    notifications: {
      title: 'Bildirimler',

      async run(ctx) {
        const token = ctx.secrets.get('token');
        if (!token) throw ctx.error('errors.noToken');

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
        if (!res.ok) throw describeError(ctx, res);

        const items = await res.json();
        let added = 0;

        for (const n of items) {
          const isNew = ctx.notify({
            // updated_at sayesinde aynı konuya gelen yeni hareket yeniden bildirilir
            id: `${n.id}:${n.updated_at}`,
            title: n.subject?.title ?? ctx.t('untitled'),
            body: n.repository?.full_name ?? '',
            url: htmlUrl(n),
            level: n.reason === 'security_alert' ? 'warning' : 'info',
            tags: [tagFor(ctx, 'type', TYPES, n.subject?.type), tagFor(ctx, 'reason', REASONS, n.reason)],
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
