// Kural doğrulama ve temizleme. Arayüzden ya da elle düzenlenmiş depodan gelen kural buradan
// geçmeden kaydedilmez ve çalıştırılmaz.
//
// { id, name, enabled,
//   trigger:    { type: 'notification' } | { type: 'schedule', cron } | { type: 'app', event: 'start' },
//   conditions: [{ field, op, value }],                 (yalnızca bildirim tetikleyicisinde)
//   actions:    [{ command: 'eklenti/komut', params }]  ({ type: 'notify', title, body?, level? } kısayolu da olur) }

import { Cron } from 'croner';
import { isConditionField } from './fields.js';
import { compilePattern, OPERATORS } from './conditions.js';
import { MAX_ACTIONS, MAX_CONDITIONS, MAX_RULES } from '../../shared/automation.js';

export { MAX_ACTIONS, MAX_CONDITIONS, MAX_RULES };
const MAX_IN_VALUES = 20;
const ID = /^[a-z0-9-]{1,40}$/;
const COMMAND = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_-]{1,64}$/;
export const TRIGGERS = ['notification', 'schedule', 'app'];
export const APP_EVENTS = ['start'];

const text = (v, max) => String(v ?? '').trim().slice(0, max);

// Cron ifadesi geçerli mi. Yalnızca 5 alan (dakika saat gün ay haftanın-günü): croner 6. alanı
// saniye sayar; dakikadan sık zamanlama hız sınırına takılıp kuralı her seferinde kapatırdı.
export function validCron(pattern) {
  if (String(pattern ?? '').trim().split(/\s+/).length !== 5) return false;
  try {
    const job = new Cron(String(pattern), { paused: true });
    const ok = Boolean(job.nextRun());
    job.stop();
    return ok;
  } catch {
    return false;
  }
}

// Sonraki n çalışma zamanı (düzenleyicide önizleme)
export function nextRuns(pattern, n = 3, from) {
  try {
    const job = new Cron(String(pattern), { paused: true });
    const out = job.nextRuns(n, from).map((d) => d.getTime());
    job.stop();
    return out;
  } catch {
    return [];
  }
}

function normalizeCondition(raw, fail, index) {
  const field = text(raw?.field, 80);
  const op = text(raw?.op, 10);
  if (!isConditionField(field)) throw fail('badField', { index: index + 1, field });
  if (!OPERATORS.includes(op)) throw fail('badOp', { index: index + 1, op });
  let value;
  if (op === 'in') {
    // Liste ya da virgülle ayrılmış metin
    const list = Array.isArray(raw.value) ? raw.value : String(raw.value ?? '').split(',');
    value = list.map((v) => text(v, 200)).filter(Boolean).slice(0, MAX_IN_VALUES);
    if (value.length === 0) throw fail('emptyValue', { index: index + 1 });
  } else {
    value = text(Array.isArray(raw.value) ? raw.value[0] : raw.value, 200);
    if (op === 'matches' && !compilePattern(value)) throw fail('badPattern', { index: index + 1 });
  }
  return { field, op, value };
}

function normalizeAction(raw, fail, index) {
  // { type: 'notify' } kısayolu: Pano bildirimi üreten uygulama komutu
  if (raw?.type === 'notify') {
    return normalizeAction({ command: 'pano/notify', params: { title: raw.title, body: raw.body, level: raw.level } }, fail, index);
  }
  const command = text(raw?.command, 120);
  if (!COMMAND.test(command)) throw fail('badCommand', { index: index + 1 });
  const params = {};
  for (const [key, value] of Object.entries(raw?.params && typeof raw.params === 'object' ? raw.params : {})) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || value === undefined || value === null || value === '') continue;
    // Değerler düz: metin (şablon olabilir), sayı ya da evet/hayır
    if (typeof value === 'number' && Number.isFinite(value)) params[key] = value;
    else if (typeof value === 'boolean') params[key] = value;
    else if (typeof value === 'string') params[key] = value.slice(0, 2000);
  }
  return { command, params };
}

// fail(code, params): çevrilebilir hata (core.automation.errors.<code>)
export function normalizeRule(raw, { fail, newId }) {
  if (!raw || typeof raw !== 'object') throw fail('invalid');
  const id = ID.test(String(raw.id ?? '')) ? String(raw.id) : newId();
  const name = text(raw.name, 80);
  if (!name) throw fail('noName');

  const type = raw.trigger?.type;
  if (!TRIGGERS.includes(type)) throw fail('badTrigger');
  let trigger;
  if (type === 'schedule') {
    const cron = text(raw.trigger.cron, 100);
    if (!validCron(cron)) throw fail('badCron', { cron });
    trigger = { type, cron };
  } else if (type === 'app') {
    trigger = { type, event: APP_EVENTS.includes(raw.trigger.event) ? raw.trigger.event : 'start' };
  } else {
    trigger = { type };
  }

  // Koşullar yalnızca bildirime uygulanır; diğer tetikleyicilerde süzülecek bildirim yok
  const rawConditions = type === 'notification' && Array.isArray(raw.conditions) ? raw.conditions : [];
  if (rawConditions.length > MAX_CONDITIONS) throw fail('tooManyConditions', { max: MAX_CONDITIONS });
  const conditions = rawConditions.map((c, i) => normalizeCondition(c, fail, i));

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  if (rawActions.length === 0) throw fail('noActions');
  if (rawActions.length > MAX_ACTIONS) throw fail('tooManyActions', { max: MAX_ACTIONS });
  const actions = rawActions.map((a, i) => normalizeAction(a, fail, i));

  return { id, name, enabled: raw.enabled !== false, trigger, conditions, actions };
}
