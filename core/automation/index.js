// Otomasyon motoru: tetikleyiciler (yeni bildirim, cron zamanı, uygulama açılışı) → koşullar →
// eylemler (komut kayıt defterindeki komutlar). Yeni yetenek eklemez; bus, bildirim şeması ve
// komutları birbirine bağlar. Her eylem komut olarak çalışır ve geçmişe "Otomasyon: <kural>" diye düşer.

import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { evaluateConditions } from './conditions.js';
import { fillParams } from './template.js';
import { nextRuns, normalizeRule } from './rules.js';
import { ruleTemplates } from './templates.js';
import { MAX_RULES, RATE_LIMIT, RATE_WINDOW_MS } from '../../shared/automation.js';

export { RATE_LIMIT, RATE_WINDOW_MS };
// A → bildirim → B → bildirim → C … zincirinin üst sınırı
export const MAX_CHAIN = 5;
export const APPROVAL_TIMEOUT_MS = 15 * 60_000;

export function createAutomation({
  bus, store, commands, notifications, getI18n, logger,
  now = () => Date.now(),
  // Testlerde sahte zamanlayıcı verilebilir: (cron, fn) → { stop() }
  createJob = (cron, fn) => new Cron(cron, { protect: true }, fn),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  approvalTimeoutMs = APPROVAL_TIMEOUT_MS
}) {
  // Döngü önleme: kuralın eylemleri komut olarak, kural zinciriyle (chain) başlatılır. Eylem sırasında
  // doğan bildirim causedBy (komut çalıştırma kimliği) taşır; zincir commands.chainOf ile okunur.
  // Zincirdeki kural aynı olayla yeniden tetiklenmez. Kimlik düz metin olduğu için eklenti ayrı
  // süreçte çalışsa da çalışır (örtük bağlama, AsyncLocalStorage'a dayanmaz).
  const jobs = new Map();
  const windows = new Map();
  // Dış (zincirsiz) bildirim yağmurunda atlanan çalışma sayısı; kural kapanmaz
  const throttled = new Map();
  const pending = new Map();
  let rules = [];
  let state = {};
  let started = false;

  const i18n = () => getI18n();
  const fail = (code, params) => i18n().error(`core.automation.errors.${code}`, params);
  const newId = () => randomUUID().slice(0, 8);
  const changed = () => bus.emit('automation:changed');

  // Kurallar yalnızca değişince, durum (son çalışma) ayrı yazılır; her çalışma tüm kuralları yazmasın
  function persistRules() {
    store.set('automations', { rules });
    changed();
  }

  function setState(id, patch) {
    // Kapanıştan sonra yazılmaz (depo kapanmış olabilir)
    if (!started) return;
    state = { ...state, [id]: { ...(state[id] ?? {}), ...patch } };
    store.set('automationState', state);
    changed();
  }

  // Depodaki kurallar da doğrulamadan geçer; bozuk kural atlanır (kayıt silinmez)
  function load() {
    rules = [];
    for (const raw of store.get('automations')?.rules ?? []) {
      try {
        rules.push(normalizeRule(raw, { fail, newId }));
      } catch (err) {
        logger.warn(`Otomasyon kuralı yüklenemedi (${raw?.name ?? raw?.id}):`, err.message);
      }
    }
    state = store.get('automationState') ?? {};
    // Uygulama kapanırken "çalışıyor" kalan kural yarıda kalmış sayılır
    for (const [id, s] of Object.entries(state)) {
      if (s?.lastRun?.status === 'running') {
        state[id] = { ...s, lastRun: { ...s.lastRun, status: 'skipped', message: i18n().t('core.automation.interrupted'), messageI18n: { key: 'core.automation.interrupted' } } };
      }
    }
  }

  function syncJobs() {
    for (const job of jobs.values()) job.stop();
    jobs.clear();
    if (!started) return;
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger.type !== 'schedule') continue;
      try {
        jobs.set(rule.id, createJob(rule.trigger.cron, () => fire(rule.id, scheduleData(rule))));
      } catch (err) {
        logger.warn(`[otomasyon] ${rule.name} zamanlanamadı:`, err.message);
      }
    }
  }

  // Bildirim dışı tetikleyicilerin şablon verisi
  function scheduleData(rule) {
    const d = new Date(now());
    const pad = (n) => String(n).padStart(2, '0');
    return {
      now: d.toISOString(),
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      rule: rule.name
    };
  }
  const notificationData = (n) => ({ ...n, now: new Date(now()).toISOString() });

  function notifyUser(id, title, body) {
    notifications.add({ id: `automation:${id}:${now()}`, source: 'pano', title, body, level: 'warning', tags: ['core.automation.tag'] });
  }

  // Kural başına dakikada en fazla RATE_LIMIT çalışma. Aşım iki türlü:
  // - Otomasyon zincirinden gelen olaylar (bir kuralın eylemi yeni bildirim üretiyor): döngü
  //   olasılığı → kural kapanır ve kullanıcıya bildirilir.
  // - Dışarıdan gelen bildirim yağmuru (ör. ilk senkronda 15 RSS girişi): döngü değil; fazlası
  //   atlanır, kural açık kalır, son çalışma satırında kaç çalışmanın atlandığı yazar.
  function allowRun(rule, chain) {
    const t = now();
    const recent = (windows.get(rule.id) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (recent.length < RATE_LIMIT) {
      recent.push(t);
      windows.set(rule.id, recent);
      // Yeni pencere: önceki atlama bilgisi silinir
      if (recent.length === 1 && throttled.has(rule.id)) {
        throttled.delete(rule.id);
        setState(rule.id, { throttled: null });
      }
      return true;
    }
    if (chain.length === 0) {
      const count = (throttled.get(rule.id) ?? 0) + 1;
      throttled.set(rule.id, count);
      const params = { count, limit: RATE_LIMIT };
      // Son çalışma satırı gerçek sonuçları gösterir; atlananlar ayrı alanda
      setState(rule.id, { throttled: { at: t, ...params, message: i18n().t('core.automation.rateThrottled', params), messageI18n: { key: 'core.automation.rateThrottled', params } } });
      return false;
    }
    windows.delete(rule.id);
    rules = rules.map((r) => (r.id === rule.id ? { ...r, enabled: false } : r));
    syncJobs();
    persistRules();
    setState(rule.id, { disabledReason: 'rateLimit', disabledAt: t });
    logger.warn(`[otomasyon] ${rule.name} zincirde hız sınırını aştı (döngü olabilir), kapatıldı`);
    notifyUser(rule.id, i18n().t('core.automation.rateLimited.title', { name: rule.name }),
      i18n().t('core.automation.rateLimited.body', { count: RATE_LIMIT }));
    return false;
  }

  // Onay isteyen komut: masaüstü bildirimi + uygulama içi onay; süre dolarsa çalışmaz
  function requestApproval(rule, commandId, params) {
    const described = commands.describe(commands.lookup(commandId));
    // Masaüstü bildirimi için o anki dilde (main'in kataloğunda eklenti metinleri yok)
    const key = described.plugin === 'pano' ? described.title : `${described.plugin}:${described.title}`;
    const commandText = i18n().tOr(key, described.title);
    const id = newId();
    return new Promise((resolve) => {
      const entry = {
        id, ruleId: rule.id, ruleName: rule.name, command: commandId, plugin: described.plugin, title: described.title,
        commandText, params, createdAt: now(), expiresAt: now() + approvalTimeoutMs
      };
      const timer = setTimer(() => settle(id, 'expired'), approvalTimeoutMs);
      pending.set(id, { entry, resolve, timer });
      bus.emit('automation:approval', entry);
      changed();
    });
  }

  function settle(id, result) {
    const item = pending.get(String(id));
    if (!item) return false;
    clearTimer(item.timer);
    pending.delete(String(id));
    item.resolve(result);
    changed();
    return true;
  }

  async function runActions(rule, data, chain) {
    const label = rule.name;
    let last = '';
    for (const action of rule.actions) {
      const filled = fillParams(action.params, data);
      let checked;
      try {
        checked = commands.check(action.command, filled);
      } catch (err) {
        // Komut yok ya da parametre şemaya uymuyor: geçmişte iz kalsın (komut varsa)
        try {
          commands.skip(action.command, filled, { originLabel: label, error: err.message, errorI18n: err.i18n });
        } catch { /* komut kayıt defterinde yok */ }
        return { status: 'error', message: err.message, messageI18n: err.i18n ?? null };
      }

      if (checked.confirm) {
        const answer = await requestApproval(rule, action.command, checked.params);
        // Uygulama kapanıyor: hiçbir şey yazılmaz; açılışta "yarıda kaldı" olarak görünür
        if (answer === 'shutdown') return null;
        if (answer !== 'approved') {
          const key = answer === 'rejected' ? 'core.automation.approval.rejected' : 'core.automation.approval.expired';
          commands.skip(action.command, checked.params, { originLabel: label, message: i18n().t(key) });
          return { status: 'skipped', message: i18n().t(key), messageI18n: { key } };
        }
      }

      const outcome = await commands.start(action.command, checked.params, { origin: 'automation', originLabel: label, chain }).done;
      if (outcome.status === 'error') return { status: 'error', message: outcome.error, messageI18n: outcome.errorI18n };
      if (outcome.status === 'cancelled') return { status: 'skipped', message: i18n().t('core.commands.cancelled'), messageI18n: { key: 'core.commands.cancelled' } };
      last = outcome.message || last;
    }
    return { status: 'ok', message: last };
  }

  function run(rule, data, chain = []) {
    if (!allowRun(rule, chain)) return Promise.resolve(null);
    setState(rule.id, { lastRun: { at: now(), status: 'running' } });
    return (async () => {
      let result;
      try {
        result = await runActions(rule, data, [...chain, rule.id]);
      } catch (err) {
        result = { status: 'error', message: err?.message ?? String(err), messageI18n: err?.i18n ?? null };
      }
      if (result) setState(rule.id, { lastRun: { at: now(), ...result } });
      return result;
    })();
  }

  // Zamanlanmış ve uygulama tetikleyicileri: kural güncel listeden okunur (silinmiş/kapanmış olabilir)
  function fire(id, data) {
    const rule = rules.find((r) => r.id === id);
    if (!rule?.enabled) return null;
    return run(rule, data).catch((err) => logger.warn('[otomasyon]', err.message));
  }

  // Yeni bildirim: zincirdeki (bu bildirimi doğuran) kurallar atlanır
  function onNotification(n, meta) {
    const chain = commands.chainOf(meta?.causedBy);
    if (chain.length >= MAX_CHAIN) return;
    const translate = (tag) => i18n().t(tag);
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger.type !== 'notification' || chain.includes(rule.id)) continue;
      if (!evaluateConditions(rule.conditions, n, translate).matched) continue;
      run(rule, notificationData(n), chain).catch((err) => logger.warn('[otomasyon]', err.message));
    }
  }

  function start() {
    load();
    started = true;
    syncJobs();
    bus.on('notification:new', onNotification);
    for (const rule of rules) {
      if (rule.enabled && rule.trigger.type === 'app' && rule.trigger.event === 'start') fire(rule.id, scheduleData(rule));
    }
  }

  // Bekleyen onaylar "süresi doldu" sayılmaz (yanlış geçmiş kaydı olur); sessizce bırakılır
  function stop() {
    started = false;
    syncJobs();
    bus.off('notification:new', onNotification);
    for (const id of [...pending.keys()]) settle(id, 'shutdown');
  }

  const describeRule = (rule) => ({
    ...rule,
    state: state[rule.id] ?? {},
    nextRuns: rule.enabled && rule.trigger.type === 'schedule' ? nextRuns(rule.trigger.cron, 3, new Date(now())) : []
  });

  function save(raw) {
    const rule = normalizeRule(raw, { fail, newId });
    const exists = rules.some((r) => r.id === rule.id);
    if (!exists && rules.length >= MAX_RULES) throw fail('tooManyRules', { max: MAX_RULES });
    rules = exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
    // Elle açılan kural hız sınırı kaydından temizlenir
    if (rule.enabled) {
      windows.delete(rule.id);
      state = { ...state, [rule.id]: { ...(state[rule.id] ?? {}), disabledReason: null } };
    }
    syncJobs();
    persistRules();
    store.set('automationState', state);
    return describeRule(rule);
  }

  function remove(id) {
    rules = rules.filter((r) => r.id !== String(id));
    const { [String(id)]: _, ...rest } = state;
    state = rest;
    windows.delete(String(id));
    syncJobs();
    persistRules();
    store.set('automationState', state);
  }

  function setEnabled(id, enabled) {
    const rule = rules.find((r) => r.id === String(id));
    if (!rule) throw fail('notFound');
    return save({ ...rule, enabled: Boolean(enabled) });
  }

  // Dry-run: kural bir bildirime karşı denenir; hiçbir komut çalışmaz, onay istenmez
  function test(raw, notificationId) {
    const rule = normalizeRule(raw, { fail, newId });
    const n = notificationId ? notifications.get(String(notificationId)) : null;
    const isNotification = rule.trigger.type === 'notification';
    let matched = true;
    let conditions = [];
    if (isNotification) {
      if (!n) return { rule, matched: null, conditions: [], actions: [], nextRuns: [] };
      ({ matched, results: conditions } = evaluateConditions(rule.conditions, n, (tag) => i18n().t(tag)));
    }
    const data = isNotification ? notificationData(n) : scheduleData(rule);
    const actions = rule.actions.map((action) => {
      const filled = fillParams(action.params, data);
      try {
        const { params, confirm } = commands.check(action.command, filled);
        const d = commands.describe(commands.lookup(action.command));
        return { command: action.command, plugin: d.plugin, title: d.title, params, confirm, error: null };
      } catch (err) {
        return { command: action.command, params: filled, confirm: false, error: err.message, errorI18n: err.i18n ?? null };
      }
    });
    return {
      rule,
      matched,
      conditions,
      actions,
      nextRuns: rule.trigger.type === 'schedule' ? nextRuns(rule.trigger.cron, 3, new Date(now())) : []
    };
  }

  return {
    start,
    stop,
    list: () => rules.map(describeRule),
    save,
    remove,
    setEnabled,
    test,
    templates: () => ruleTemplates((key, params) => i18n().t(key, params)),
    approvals: () => [...pending.values()].map((p) => p.entry),
    approve: (id) => settle(id, 'approved'),
    reject: (id) => settle(id, 'rejected')
  };
}
