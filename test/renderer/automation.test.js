import { describe, expect, it } from 'vitest';
import {
  draftFromRule, emptyRule, metaFields, presetFor, ruleFromDraft, templateFields, valueSuggestions
} from '../../src/renderer/src/lib/automation.js';

const NOTIFICATIONS = [
  { id: '1', source: 'steam', job: 'news-730', tags: ['steam:tag.patchNotes'], meta: { appId: 730, gid: 'x', excerpt: 'e', nested: { deep: 1, obj: {} } } },
  { id: '2', source: 'github', job: 'notifications', tags: ['github:reason.mention', 'steam:tag.patchNotes'], meta: { repo: 'a/b', 'bad key': 1 } }
];
const COMMANDS = [
  { id: 'steam/launchGame', params: { appId: { type: 'number' }, name: { type: 'string' } } },
  { id: 'x/flag', params: { on: { type: 'boolean' } } }
];

describe('otomasyon düzenleyicisi: gerçek veriden listeler', () => {
  it('meta alanları bildirimlerden (iç içe bir seviye, geçersiz ad yok)', () => {
    expect(metaFields(NOTIFICATIONS)).toEqual(['meta.appId', 'meta.excerpt', 'meta.gid', 'meta.nested.deep', 'meta.repo']);
  });

  it('değer önerileri: kaynaklar (+Pano), düzeyler, etiketler çevirisiyle, işler', () => {
    const t = (k) => ({ 'steam:tag.patchNotes': 'Yama notu', 'github:reason.mention': 'Senden bahsedildi' })[k] ?? k;
    expect(valueSuggestions('source', { sources: [{ name: 'steam', label: 'Steam' }] }).map((s) => s.value)).toEqual(['steam', 'pano']);
    // Uygulamanın kendi kaynağının adı çağırandan (katalogdan) gelir
    expect(valueSuggestions('source', { appLabel: 'Pano' })).toEqual([{ value: 'pano', label: 'Pano' }]);
    expect(valueSuggestions('level').map((s) => s.value)).toEqual(['info', 'warning', 'error']);
    expect(valueSuggestions('tags', { notifications: NOTIFICATIONS, t })).toEqual([
      { value: 'github:reason.mention', label: 'Senden bahsedildi' },
      { value: 'steam:tag.patchNotes', label: 'Yama notu' }
    ]);
    expect(valueSuggestions('job', { notifications: NOTIFICATIONS }).map((s) => s.value)).toEqual(['news-730', 'notifications']);
    expect(valueSuggestions('title', { notifications: NOTIFICATIONS })).toEqual([]);
  });

  it('şablon alanı ipucu tetikleyiciye göre', () => {
    expect(templateFields('notification', ['meta.appId'])).toContain('{{meta.appId}}');
    expect(templateFields('schedule')).toEqual(['{{now}}', '{{date}}', '{{time}}', '{{rule}}']);
  });

  it('cron hazır seçeneği tanınır, diğerleri özel', () => {
    expect(presetFor('0 9 * * 1-5')).toBe('weekdayMorning');
    expect(presetFor(' 0 * * * * ')).toBe('everyHour');
    expect(presetFor('*/5 * * * *')).toBe('custom');
  });
});

describe('taslak ↔ kural', () => {
  it('"in" değeri virgüllü metin olarak düzenlenir ve listeye geri döner', () => {
    const rule = { id: 'r1', name: 'K', enabled: true, trigger: { type: 'notification' }, conditions: [{ field: 'source', op: 'in', value: ['steam', 'rss'] }], actions: [{ command: 'x/flag', params: {} }] };
    const draft = draftFromRule(rule);
    expect(draft.conditions[0].value).toBe('steam, rss');
    expect(ruleFromDraft(draft, COMMANDS)).toEqual(rule);
  });

  it('sayı ve evet/hayır türüne çevrilir; şablon metin kalır; boş parametre atılır', () => {
    const draft = {
      ...emptyRule(),
      name: '  Başlat ',
      actions: [
        { command: 'steam/launchGame', params: { appId: '730', name: '' } },
        { command: 'steam/launchGame', params: { appId: '{{meta.appId}}' } },
        { command: 'x/flag', params: { on: 'false' } }
      ]
    };
    expect(ruleFromDraft(draft, COMMANDS).actions).toEqual([
      { command: 'steam/launchGame', params: { appId: 730 } },
      { command: 'steam/launchGame', params: { appId: '{{meta.appId}}' } },
      { command: 'x/flag', params: { on: false } }
    ]);
    expect(ruleFromDraft(draft, COMMANDS).name).toBe('Başlat');
  });

  it('bildirim dışı tetikleyicide koşullar gönderilmez; zamanlanmış kuralda cron kırpılır', () => {
    const draft = { ...emptyRule(), name: 'S', trigger: { type: 'schedule', cron: ' 0 9 * * 1-5 ' }, conditions: [{ field: 'title', op: 'eq', value: 'x' }] };
    const rule = ruleFromDraft(draft, COMMANDS);
    expect(rule.trigger).toEqual({ type: 'schedule', cron: '0 9 * * 1-5' });
    expect(rule.conditions).toEqual([]);
  });
});
