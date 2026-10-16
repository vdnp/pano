// Akış seçimi: { source: eklenti adı | null, job: kaynak işi (ör. news-730) | null,
// tag: bildirim etiketi (ör. steam:tag.patchNotes) | null }. null değer "hepsi" demektir.

export const ALL = { source: null, job: null, tag: null };

// Eklentinin kaynak işleri: id (bildirimdeki job ile aynı) ve görünen başlık
export const jobsOf = (source) => (source?.jobs ?? []).map((j) => ({ id: j.source, key: j.key, title: j.title }));

// Seçili eklenti ya da iş artık yoksa (ör. oyun ayarlardan silindi) bir üst seviyeye düşülür
export function resolveSelection(selection, sources) {
  if (!selection?.source) return ALL;
  const source = sources.find((s) => s.name === selection.source);
  if (!source) return ALL;
  if (selection.job && !jobsOf(source).some((j) => j.id === selection.job)) {
    return { source: selection.source, job: null, tag: null };
  }
  return { source: selection.source, job: selection.job ?? null, tag: selection.tag ?? null };
}

export function filterNotifications(list, selection, unreadOnly = false) {
  return list.filter(
    (n) =>
      (!selection.source || n.source === selection.source) &&
      (!selection.job || n.job === selection.job) &&
      (!selection.tag || n.tags.includes(selection.tag)) &&
      (!unreadOnly || !n.read)
  );
}

export const jobKey = (source, job) => `${source}/${job}`;

export function unreadCounts(list) {
  const counts = { total: 0, bySource: {}, byJob: {} };
  for (const n of list) {
    if (n.read) continue;
    counts.total++;
    counts.bySource[n.source] = (counts.bySource[n.source] ?? 0) + 1;
    if (n.job) {
      const key = jobKey(n.source, n.job);
      counts.byJob[key] = (counts.byJob[key] ?? 0) + 1;
    }
  }
  return counts;
}

// Bildirimin kaynak çipine tıklanınca gidilecek seçim: işi hâlâ varsa o iş, yoksa eklenti
export function selectionForNotification(n, sources) {
  return resolveSelection({ source: n.source, job: n.job }, sources);
}

// Seçili kapsamdaki (eklenti/iş) bildirimlerin etiketleri: en sık geçen önce.
// unread: o etiketteki okunmamış sayısı (çipte gösterilir)
export function tagSummary(list) {
  const tags = new Map();
  for (const n of list) {
    for (const tag of n.tags) {
      const entry = tags.get(tag) ?? { tag, total: 0, unread: 0 };
      entry.total++;
      if (!n.read) entry.unread++;
      tags.set(tag, entry);
    }
  }
  return [...tags.values()].sort((a, b) => b.total - a.total);
}
