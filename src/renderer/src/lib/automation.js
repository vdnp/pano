// Otomasyon düzenleyicisinin JSX'siz mantığı: alan listeleri gerçek bildirimlerden, taslak ↔ kural
// dönüşümü, cron hazır seçenekleri. Doğrulamanın asıl yeri core'dur (core/automation/rules.js).

import { NOTIFICATION_FIELDS, OPERATORS } from '../../../../shared/automation.js';

// Alan ve operatör listeleri core ile ortak modülden; burada yeniden tanımlanmaz
export const BASE_FIELDS = NOTIFICATION_FIELDS;
export { OPERATORS };
export const LEVELS = ['info', 'warning', 'error'];

export const CRON_PRESETS = {
  weekdayMorning: '0 9 * * 1-5',
  everyHour: '0 * * * *',
  everyEvening: '0 18 * * *'
};
export const presetFor = (cron) => Object.keys(CRON_PRESETS).find((k) => CRON_PRESETS[k] === String(cron ?? '').trim()) ?? 'custom';

const MAX_META_FIELDS = 40;

// Bildirimlerin meta alanlarından koşul alanları: meta.appId, meta.repo … (iç içe bir seviye)
export function metaFields(notifications) {
  const out = new Set();
  for (const n of notifications) {
    for (const [key, value] of Object.entries(n.meta ?? {})) {
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [sub, v] of Object.entries(value)) {
          if (/^[A-Za-z0-9_]+$/.test(sub) && (v === null || typeof v !== 'object')) out.add(`meta.${key}.${sub}`);
        }
      } else {
        out.add(`meta.${key}`);
      }
      if (out.size >= MAX_META_FIELDS) break;
    }
  }
  return [...out].sort();
}

// Değer önerileri gerçek veriden: kaynak adları, düzeyler, akıştaki etiketler (çevirisiyle) ve işler
// appLabel: uygulamanın kendi kaynağının ("pano") görünen adı; çağıran katalogdan verir
export function valueSuggestions(field, { notifications = [], sources = [], t = (k) => k, appLabel = 'pano' } = {}) {
  const unique = (items) => [...new Map(items.map((i) => [i.value, i])).values()];
  if (field === 'source') {
    return unique([...sources.map((s) => ({ value: s.name, label: s.label ?? s.name })), { value: 'pano', label: appLabel }]);
  }
  if (field === 'level') return LEVELS.map((l) => ({ value: l, label: l }));
  if (field === 'tags') {
    return unique(notifications.flatMap((n) => n.tags ?? []).map((tag) => ({ value: tag, label: t(tag) })))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  if (field === 'job') {
    return unique(notifications.filter((n) => n.job).map((n) => ({ value: n.job, label: `${n.source} · ${n.job}` })));
  }
  return [];
}

// Eylem parametrelerinde kullanılabilir şablon alanları (tetikleyiciye göre)
export const templateFields = (triggerType, meta = []) =>
  triggerType === 'notification'
    ? ['title', 'body', 'source', 'url', 'id', 'level', ...meta.slice(0, 6)].map((f) => `{{${f}}}`)
    : ['now', 'date', 'time', 'rule'].map((f) => `{{${f}}}`);

export const emptyRule = () => ({
  name: '',
  enabled: true,
  trigger: { type: 'notification' },
  conditions: [],
  actions: [{ command: '', params: {} }]
});

// Kural → düzenleyici taslağı ("in" değerleri virgüllü metin olarak düzenlenir)
export function draftFromRule(rule) {
  return {
    ...(rule.id ? { id: rule.id } : {}),
    name: rule.name ?? '',
    enabled: rule.enabled !== false,
    trigger: { ...rule.trigger },
    conditions: (rule.conditions ?? []).map((c) => ({ ...c, value: Array.isArray(c.value) ? c.value.join(', ') : c.value ?? '' })),
    actions: (rule.actions?.length ? rule.actions : [{ command: '', params: {} }])
      .map((a) => ({ command: a.command ?? '', params: { ...(a.params ?? {}) } }))
  };
}

// Taslak → core'a gidecek kural. Boş parametreler atılır; sayı ve evet/hayır alanları şablon değilse
// türüne çevrilir (şablon ise metin kalır, core doldurduktan sonra doğrular).
export function ruleFromDraft(draft, commands = []) {
  const byId = new Map(commands.map((c) => [c.id, c]));
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    enabled: draft.enabled,
    trigger: draft.trigger.type === 'schedule' ? { type: 'schedule', cron: String(draft.trigger.cron ?? '').trim() }
      : draft.trigger.type === 'app' ? { type: 'app', event: 'start' } : { type: 'notification' },
    conditions: draft.trigger.type === 'notification'
      ? draft.conditions.map((c) => ({ field: c.field, op: c.op, value: c.op === 'in' ? String(c.value).split(',').map((v) => v.trim()).filter(Boolean) : String(c.value) }))
      : [],
    actions: draft.actions.map((a) => {
      const schema = byId.get(a.command)?.params ?? {};
      const params = {};
      for (const [key, value] of Object.entries(a.params ?? {})) {
        if (value === '' || value === undefined || value === null) continue;
        const s = schema[key];
        const isTemplate = typeof value === 'string' && value.includes('{{');
        if (s?.type === 'number' && !isTemplate && Number.isFinite(Number(value))) params[key] = Number(value);
        else if (s?.type === 'boolean' && !isTemplate) params[key] = value === true || value === 'true';
        else params[key] = value;
      }
      return { command: a.command, params };
    })
  };
}
