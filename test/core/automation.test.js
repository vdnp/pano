import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateCondition, evaluateConditions } from '../../core/automation/conditions.js';
import { fillParams, fillValue } from '../../core/automation/template.js';
import { nextRuns, normalizeRule, validCron } from '../../core/automation/rules.js';
import { createAutomation, RATE_LIMIT } from '../../core/automation/index.js';
import { createCommandRunner } from '../../core/commands.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';
import { removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

const N = {
  id: 'github:1',
  source: 'github',
  title: 'Fix login bug',
  body: 'acme/app',
  level: 'info',
  tags: ['github:type.PullRequest', 'github:reason.review_requested'],
  meta: { appId: 730, repo: 'acme/app', nested: { deep: 'evet' }, list: ['a', 'b'] }
};
const LABELS = { 'github:reason.review_requested': 'İnceleme istendi', 'github:type.PullRequest': 'Pull request' };
const translate = (tag) => LABELS[tag] ?? tag;
const check = (field, op, value, n = N) => evaluateCondition({ field, op, value }, n, translate).ok;

describe('koşul değerlendirme', () => {
  it('eq / neq: büyük-küçük harf ve baştaki boşluk fark etmez', () => {
    expect(check('source', 'eq', 'GitHub ')).toBe(true);
    expect(check('source', 'eq', 'steam')).toBe(false);
    expect(check('level', 'neq', 'warning')).toBe(true);
    expect(check('meta.appId', 'eq', '730')).toBe(true);
    expect(check('meta.nested.deep', 'eq', 'EVET')).toBe(true);
  });

  it('contains: metinde parça, listede öğe arar', () => {
    expect(check('title', 'contains', 'login')).toBe(true);
    expect(check('title', 'contains', 'logout')).toBe(false);
    expect(check('title', 'contains', '')).toBe(false);
    expect(check('meta.list', 'contains', 'b')).toBe(true);
    expect(check('meta.list', 'contains', 'x')).toBe(false);
  });

  it('etiketler hem anahtarla hem o anki dildeki çevirisiyle eşleşir', () => {
    expect(check('tags', 'contains', 'github:reason.review_requested')).toBe(true);
    expect(check('tags', 'contains', 'İnceleme istendi')).toBe(true);
    expect(check('tags', 'contains', 'Senden bahsedildi')).toBe(false);
    expect(check('tags', 'neq', 'Pull request')).toBe(false);
    expect(check('tags', 'in', ['Sürüm', 'Pull request'])).toBe(true);
    expect(check('tags', 'matches', '^inceleme')).toBe(true);
  });

  it('büyük/küçük harf: I, İ, ı ve i aynı sayılır (İngilizce "CI" ile Türkçe "İnceleme" birlikte tutar)', () => {
    const n = { ...N, title: 'CI failed on ISSUE', meta: { kind: 'İnceleme' } };
    expect(check('title', 'contains', 'ci', n)).toBe(true);
    expect(check('title', 'contains', 'issue', n)).toBe(true);
    expect(check('title', 'eq', 'ci failed on issue', n)).toBe(true);
    expect(check('meta.kind', 'eq', 'inceleme', n)).toBe(true);
    expect(check('meta.kind', 'eq', 'INCELEME', n)).toBe(true);
    expect(check('source', 'in', ['GITHUB'], n)).toBe(true);
    expect(check('title', 'matches', 'ci\\s+failed', n)).toBe(true);
  });

  it('matches: düzenli ifade (harf duyarsız); geçersiz ya da çok uzun desen tutmaz', () => {
    expect(check('title', 'matches', '^fix\\s+\\w+')).toBe(true);
    expect(check('title', 'matches', '(')).toBe(false);
    expect(check('title', 'matches', 'a'.repeat(201))).toBe(false);
  });

  it('in: değerlerden biri', () => {
    expect(check('source', 'in', ['steam', 'github'])).toBe(true);
    expect(check('source', 'in', ['steam', 'rss'])).toBe(false);
  });

  it('olmayan alan boş sayılır; prototip zinciri okunmaz', () => {
    expect(evaluateCondition({ field: 'meta.yok', op: 'eq', value: '' }, N, translate)).toEqual({ ok: false, actual: null });
    expect(check('meta.yok', 'neq', 'x')).toBe(true);
    expect(check('meta.constructor', 'eq', 'function Object() { [native code] }')).toBe(false);
  });

  it('tüm koşullar "ve" ile birleşir; sonuçta her koşulun gerçek değeri döner', () => {
    const { matched, results } = evaluateConditions([
      { field: 'source', op: 'eq', value: 'github' },
      { field: 'tags', op: 'contains', value: 'İnceleme istendi' }
    ], N, translate);
    expect(matched).toBe(true);
    expect(results[0]).toMatchObject({ ok: true, actual: 'github' });
    expect(evaluateConditions([{ field: 'source', op: 'eq', value: 'github' }, { field: 'level', op: 'eq', value: 'error' }], N, translate).matched).toBe(false);
    expect(evaluateConditions([], N, translate).matched).toBe(true);
  });
});

describe('şablon doldurma', () => {
  it('tek yer tutucu türünü korur, metne gömülü olan metin olur', () => {
    expect(fillValue('{{meta.appId}}', N)).toBe(730);
    expect(fillValue(' {{ meta.appId }} ', N)).toBe(730);
    expect(fillValue('Oyun {{meta.appId}}: {{title}}', N)).toBe('Oyun 730: Fix login bug');
    expect(fillValue('{{meta.list}}', N)).toBe('a, b');
    expect(fillValue(42, N)).toBe(42);
  });

  it('olmayan alan boş metin; nesne değer basılmaz', () => {
    expect(fillValue('{{meta.yok}}', N)).toBe('');
    expect(fillValue('[{{meta.nested}}]', N)).toBe('[]');
    expect(fillValue('{{meta.nested}}', N)).toBe('');
  });

  it('kod çalıştırmaz: ifade, çağrı ve prototip erişimi metin olarak kalır ya da boş döner', () => {
    expect(fillValue('{{title.toUpperCase()}}', N)).toBe('{{title.toUpperCase()}}');
    expect(fillValue('{{ 1 + 1 }}', N)).toBe('{{ 1 + 1 }}');
    expect(fillValue('{{constructor.constructor}}', N)).toBe('');
    expect(fillValue('{{__proto__}}', N)).toBe('');
    expect(fillValue('${process.env.HOME}', N)).toBe('${process.env.HOME}');
  });

  it('parametre nesnesini doldurur', () => {
    expect(fillParams({ appId: '{{meta.appId}}', note: '{{source}}/{{id}}', loud: true }, N))
      .toEqual({ appId: 730, note: 'github/github:1', loud: true });
  });
});

describe('kural doğrulama', () => {
  const fail = (code, params) => Object.assign(new Error(code), { params });
  const opts = { fail, newId: () => 'yeni' };
  const base = { name: 'Kural', trigger: { type: 'notification' }, actions: [{ command: 'x/echo', params: { text: '{{title}}' } }] };

  it('geçerli kuralı temizler; notify kısayolu ve virgüllü in', () => {
    const rule = normalizeRule({
      ...base,
      conditions: [{ field: 'source', op: 'in', value: 'github, steam ,' }],
      actions: [{ type: 'notify', title: 'Merhaba {{title}}' }, { command: 'x/echo', params: { text: 'a', bos: '', yok: null, sayi: 3, nesne: {} } }]
    }, opts);
    expect(rule).toEqual({
      id: 'yeni', name: 'Kural', enabled: true, trigger: { type: 'notification' },
      conditions: [{ field: 'source', op: 'in', value: ['github', 'steam'] }],
      actions: [{ command: 'pano/notify', params: { title: 'Merhaba {{title}}' } }, { command: 'x/echo', params: { text: 'a', sayi: 3 } }]
    });
  });

  it('hatalı kuralda anlaşılır hata kodu', () => {
    const code = (raw) => { try { normalizeRule(raw, opts); return null; } catch (e) { return e.message; } };
    expect(code({ ...base, name: ' ' })).toBe('noName');
    expect(code({ ...base, trigger: { type: 'webhook' } })).toBe('badTrigger');
    expect(code({ ...base, trigger: { type: 'schedule', cron: 'her sabah' } })).toBe('badCron');
    expect(code({ ...base, conditions: [{ field: 'secrets.token', op: 'eq', value: 'x' }] })).toBe('badField');
    expect(code({ ...base, conditions: [{ field: 'title', op: 'gt', value: 'x' }] })).toBe('badOp');
    expect(code({ ...base, conditions: [{ field: 'title', op: 'matches', value: '([a-' }] })).toBe('badPattern');
    expect(code({ ...base, conditions: [{ field: 'title', op: 'in', value: ' , ' }] })).toBe('emptyValue');
    expect(code({ ...base, actions: [] })).toBe('noActions');
    expect(code({ ...base, actions: [{ command: 'rm -rf /' }] })).toBe('badCommand');
    expect(code({ ...base, conditions: Array.from({ length: 11 }, () => ({ field: 'title', op: 'eq', value: 'x' })) })).toBe('tooManyConditions');
  });

  it('zamanlanmış ve açılış kuralında koşullar atılır; cron önizlemesi', () => {
    const rule = normalizeRule({ ...base, trigger: { type: 'schedule', cron: '0 9 * * 1-5' }, conditions: [{ field: 'title', op: 'eq', value: 'x' }] }, opts);
    expect(rule.conditions).toEqual([]);
    expect(validCron('0 9 * * 1-5')).toBe(true);
    expect(validCron('61 * * * *')).toBe(false);
    // Saniyeli (6 alan) ve yıllı (7 alan) ifadeler reddedilir: dakikadan sık çalışma kuralı kapatırdı
    expect(validCron('*/5 * * * * *')).toBe(false);
    expect(validCron('0 0 9 * * 1-5 2027')).toBe(false);
    // 17 Ekim 2026 Cumartesi → sonraki hafta içi sabahlar
    const runs = nextRuns('0 9 * * 1-5', 3, new Date(2026, 9, 17, 12, 0));
    expect(runs.map((t) => new Date(t).getDay())).toEqual([1, 2, 3]);
    expect(runs.map((t) => new Date(t).getHours())).toEqual([9, 9, 9]);
  });
});

// Motoru sahte saat, sahte cron ve sahte zamanlayıcıyla, gerçek komut çalıştırıcı ve bildirim deposuyla kurar
function harness() {
  let time = Date.parse('2026-10-19T09:00:00Z');
  const storage = createSqliteStorage(':memory:');
  const bus = new EventEmitter();
  const i18n = createI18n({ locale: 'tr', catalogs: mergeCatalogs(appCatalogs) });
  const notifications = createNotificationStore(storage, bus);
  const calls = [];
  let seq = 0;
  // causedBy: bildirimi üreten komut çalıştırması (eklentinin ctx.notify'ı bunu kendisi ekler)
  const emit = (title, extra = {}, causedBy = null) => notifications.add({ id: `n${++seq}`, source: 'x', title, ...extra }, { causedBy });
  const defs = {
    echo: {
      title: 'Yankı',
      params: { text: { type: 'string', label: 'Metin', required: true }, n: { type: 'number', label: 'Sayı' } },
      async run(ctx, p) { calls.push(['echo', p]); return { message: `ok ${p.text}` }; }
    },
    emit: {
      title: 'Yay',
      params: { title: { type: 'string', label: 'Başlık', required: true } },
      async run(ctx, p, { runId }) { calls.push(['emit', p]); await Promise.resolve(); emit(p.title, {}, runId); return {}; }
    },
    emitMany: {
      title: 'Çok yay',
      params: { count: { type: 'number', label: 'Adet', required: true }, title: { type: 'string', label: 'Başlık', required: true } },
      async run(ctx, p, { runId }) { calls.push(['emitMany', p]); for (let i = 0; i < p.count; i++) emit(`${p.title} ${i}`, {}, runId); return {}; }
    },
    danger: { title: 'Tehlikeli', confirm: true, async run() { calls.push(['danger']); return { message: 'yapıldı' }; } },
    fail: { title: 'Hata', async run() { throw new Error('patladı'); } }
  };
  const ctx = { forCommand: () => ({}) };
  const entries = new Map(Object.entries(defs).map(([name, def]) => [`x/${name}`, { id: `x/${name}`, plugin: 'x', name, def, ctx }]));
  const commands = createCommandRunner({ bus, storage, logger: silentLogger(), getI18n: () => i18n, getEntries: () => entries, now: () => time });
  const jobs = [];
  const timers = [];
  const automation = createAutomation({
    bus, store: storage.kv, commands, notifications, getI18n: () => i18n, logger: silentLogger(),
    now: () => time,
    createJob: (cron, fn) => {
      const job = { cron, fn, stopped: false, stop() { this.stopped = true; } };
      jobs.push(job);
      return job;
    },
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => {}
  });
  automation.start();
  return {
    automation, notifications, commands, calls, jobs, timers, bus, storage, emit,
    advance: (ms) => { time += ms; },
    // Eylemler async; zincirin bitmesini bekler
    idle: () => new Promise((r) => setTimeout(r, 15))
  };
}

const rule = (extra = {}) => ({
  name: 'Kural',
  trigger: { type: 'notification' },
  conditions: [{ field: 'title', op: 'contains', value: 'merhaba' }],
  actions: [{ command: 'x/echo', params: { text: '{{title}}', n: '{{meta.n}}' } }],
  ...extra
});

describe('otomasyon motoru', () => {
  it('eşleşen bildirimde eylemi şablonla doldurup çalıştırır; geçmişe "otomasyon" kaynağıyla yazar', async () => {
    const h = harness();
    const saved = h.automation.save(rule({ name: 'Selam' }));
    h.emit('Merhaba dünya', { meta: { n: 5 } });
    h.emit('başka bir şey');
    await h.idle();
    expect(h.calls).toEqual([['echo', { text: 'Merhaba dünya', n: 5 }]]);
    const [entry] = h.commands.history();
    expect(entry).toMatchObject({ command: 'x/echo', origin: 'automation', originLabel: 'Selam', status: 'ok' });
    expect(h.automation.list()[0].state.lastRun).toMatchObject({ status: 'ok', message: 'ok Merhaba dünya' });
    expect(saved.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('kapalı kural çalışmaz; hatalı eylem durur ve hata kaydedilir', async () => {
    const h = harness();
    const r = h.automation.save(rule({ enabled: false }));
    h.emit('merhaba');
    await h.idle();
    expect(h.calls).toEqual([]);
    h.automation.save({ ...r, enabled: true, actions: [{ command: 'x/fail' }, { command: 'x/echo', params: { text: 'a' } }] });
    h.emit('merhaba 2');
    await h.idle();
    expect(h.calls).toEqual([]);
    expect(h.automation.list()[0].state.lastRun).toMatchObject({ status: 'error', message: 'patladı' });
  });

  it('şemaya uymayan doldurulmuş parametre komutu çalıştırmaz, geçmişe hata düşer', async () => {
    const h = harness();
    h.automation.save(rule({ actions: [{ command: 'x/echo', params: { text: '{{meta.yok}}' } }] }));
    h.emit('merhaba');
    await h.idle();
    expect(h.calls).toEqual([]);
    expect(h.commands.history()[0]).toMatchObject({ status: 'error', error: '"Metin" boş bırakılamaz.', originLabel: 'Kural' });
  });

  describe('döngü önleme', () => {
    it('kuralın kendi ürettiği bildirim aynı kuralı tetiklemez', async () => {
      const h = harness();
      h.automation.save(rule({ actions: [{ command: 'x/emit', params: { title: 'merhaba yine' } }] }));
      h.emit('merhaba');
      await h.idle();
      expect(h.calls).toEqual([['emit', { title: 'merhaba yine' }]]);
      expect(h.notifications.list()).toHaveLength(2);
    });

    it('kurallar arası döngü (A → B → A) zincirde durur', async () => {
      const h = harness();
      h.automation.save(rule({ name: 'A', conditions: [{ field: 'title', op: 'eq', value: 'a' }], actions: [{ command: 'x/emit', params: { title: 'b' } }] }));
      h.automation.save(rule({ name: 'B', conditions: [{ field: 'title', op: 'eq', value: 'b' }], actions: [{ command: 'x/emit', params: { title: 'a' } }] }));
      h.emit('a');
      await h.idle();
      // dış bildirim → A ("b" üretir) → B ("a" üretir) → A zincirde, durur
      expect(h.calls.map(([, p]) => p.title)).toEqual(['b', 'a']);
    });

    it('zincir dışındaki bildirim (aynı anda gelen) kuralı normal tetikler', async () => {
      const h = harness();
      h.automation.save(rule({ actions: [{ command: 'x/emit', params: { title: 'merhaba iç' } }] }));
      h.emit('merhaba 1');
      h.emit('merhaba 2');
      await h.idle();
      expect(h.calls).toHaveLength(2);
    });

    it('neden yalnızca açık kimlikle taşınır: causedBy olmayan bildirim zincirsizdir, bilinmeyen kimlik de', async () => {
      const h = harness();
      h.automation.save(rule({ actions: [{ command: 'x/echo', params: { text: '{{title}}' } }] }));
      // Eklenti ayrı süreçteyken de yalnızca bu düz metin kimlik gelir
      h.emit('merhaba 1', {}, 'bilinmeyen-calistirma');
      await h.idle();
      expect(h.calls).toHaveLength(1);
      expect(h.commands.chainOf('bilinmeyen-calistirma')).toEqual([]);
    });
  });

  describe('hız sınırı', () => {
    it(`dış bildirim yağmuru: dakikada ${RATE_LIMIT} çalışmadan fazlası atlanır, kural açık kalır`, async () => {
      const h = harness();
      h.automation.save(rule({ name: 'Gürültülü' }));
      for (let i = 0; i < RATE_LIMIT + 3; i++) h.emit(`merhaba ${i}`);
      await h.idle();
      expect(h.calls).toHaveLength(RATE_LIMIT);
      const [r] = h.automation.list();
      expect(r.enabled).toBe(true);
      expect(r.state.disabledReason).toBeFalsy();
      // Son çalışma gerçek sonucu, atlananlar ayrı alanda; uyarı bildirimi yok
      expect(r.state.lastRun.status).toBe('ok');
      expect(r.state.throttled).toMatchObject({ count: 3, limit: 10, message: 'Hız sınırı: 3 çalışma atlandı (dakikada en fazla 10).' });
      expect(h.notifications.list().some((n) => n.source === 'pano')).toBe(false);

      // Pencere kayınca yeniden çalışır
      h.advance(61_000);
      h.emit('merhaba sonra');
      await h.idle();
      expect(h.calls).toHaveLength(RATE_LIMIT + 1);
      expect(h.automation.list()[0].state.throttled).toBeNull();
    });

    it('otomasyon zincirinden gelen aşım (döngü olasılığı) kuralı kapatır ve kullanıcıya bildirir', async () => {
      const h = harness();
      // A tek çalışmada 12 bildirim üretir; B her birinde çalışır (zincir: A)
      h.automation.save(rule({ name: 'A', conditions: [{ field: 'title', op: 'eq', value: 'başla' }], actions: [{ command: 'x/emitMany', params: { count: 12, title: 'yağmur' } }] }));
      const b = h.automation.save(rule({ name: 'B', conditions: [{ field: 'title', op: 'contains', value: 'yağmur' }], actions: [{ command: 'x/echo', params: { text: '{{title}}' } }] }));
      h.emit('başla');
      await h.idle();
      expect(h.calls.filter(([c]) => c === 'echo')).toHaveLength(RATE_LIMIT);
      const ruleB = h.automation.list().find((r) => r.id === b.id);
      expect(ruleB.enabled).toBe(false);
      expect(ruleB.state.disabledReason).toBe('rateLimit');
      const warnings = h.notifications.list().filter((n) => n.source === 'pano');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ level: 'warning', title: '"B" otomasyonu kapatıldı', tags: ['core.automation.tag'] });
      // Kapatılma kalıcıdır; elle açınca sayaç sıfırlanır
      expect(h.storage.kv.get('automations').rules.find((r) => r.id === b.id).enabled).toBe(false);
      h.automation.setEnabled(b.id, true);
      expect(h.automation.list().find((r) => r.id === b.id).state.disabledReason).toBeNull();
      h.emit('yağmur elle');
      await h.idle();
      expect(h.calls.filter(([c]) => c === 'echo')).toHaveLength(RATE_LIMIT + 1);
    });
  });

  describe('onay isteyen komut', () => {
    const dangerRule = () => rule({ name: 'Riskli', actions: [{ command: 'x/danger' }, { command: 'x/echo', params: { text: 'sonra' } }] });

    it('onay gelene kadar çalışmaz; onaylanınca çalışır ve sonraki eylemlere geçer', async () => {
      const h = harness();
      const asked = vi.fn();
      h.bus.on('automation:approval', asked);
      h.automation.save(dangerRule());
      h.emit('merhaba');
      await h.idle();
      expect(h.calls).toEqual([]);
      const [approval] = h.automation.approvals();
      expect(approval).toMatchObject({ ruleName: 'Riskli', command: 'x/danger', title: 'Tehlikeli' });
      expect(asked).toHaveBeenCalledWith(approval);

      expect(h.automation.approve(approval.id)).toBe(true);
      await h.idle();
      expect(h.calls).toEqual([['danger'], ['echo', { text: 'sonra' }]]);
      expect(h.automation.approvals()).toEqual([]);
      expect(h.automation.approve(approval.id)).toBe(false);
    });

    it('reddedilirse ya da süre dolarsa çalışmaz; geçmişe nedeniyle düşer', async () => {
      const h = harness();
      h.automation.save(dangerRule());
      h.emit('merhaba');
      await h.idle();
      h.automation.reject(h.automation.approvals()[0].id);
      await h.idle();
      expect(h.calls).toEqual([]);
      expect(h.commands.history()[0]).toMatchObject({ command: 'x/danger', status: 'cancelled', message: 'Onay reddedildi; komut çalıştırılmadı.', originLabel: 'Riskli' });

      h.emit('merhaba 2');
      await h.idle();
      expect(h.timers.at(-1).ms).toBe(15 * 60_000);
      h.timers.at(-1).fn();
      await h.idle();
      expect(h.calls).toEqual([]);
      expect(h.commands.history()[0].message).toBe('Onay 15 dakika içinde gelmedi; komut çalıştırılmadı.');
      expect(h.automation.list()[0].state.lastRun.status).toBe('skipped');
    });
  });

  describe('kapanış', () => {
    it('bekleyen onay kapanışta "süresi doldu" diye yazılmaz; açılışta çalışma "yarıda kaldı" görünür', async () => {
      const h = harness();
      h.automation.save(rule({ name: 'Riskli', actions: [{ command: 'x/danger' }] }));
      h.emit('merhaba');
      await h.idle();
      expect(h.automation.approvals()).toHaveLength(1);
      expect(h.automation.list()[0].state.lastRun.status).toBe('running');

      h.automation.stop();
      await h.idle();
      expect(h.automation.approvals()).toEqual([]);
      expect(h.commands.history()).toEqual([]);
      expect(h.calls).toEqual([]);

      h.automation.start();
      expect(h.automation.list()[0].state.lastRun).toMatchObject({ status: 'skipped', message: 'Uygulama kapandığı için yarıda kaldı.' });
    });
  });

  describe('zamanlanmış ve açılış tetikleyicileri', () => {
    it('cron işi kurulur, tetiklenince eylem zaman verisiyle çalışır; kural değişince iş yenilenir', async () => {
      const h = harness();
      const r = h.automation.save(rule({ name: 'Sabah', trigger: { type: 'schedule', cron: '0 9 * * 1-5' }, actions: [{ command: 'x/echo', params: { text: '{{rule}} {{date}}' } }] }));
      expect(h.jobs.map((j) => j.cron)).toEqual(['0 9 * * 1-5']);
      await h.jobs[0].fn();
      expect(h.calls).toEqual([['echo', { text: 'Sabah 2026-10-19' }]]);
      expect(h.automation.list()[0].nextRuns).toHaveLength(3);

      h.automation.setEnabled(r.id, false);
      expect(h.jobs[0].stopped).toBe(true);
      expect(h.jobs.filter((j) => !j.stopped)).toHaveLength(0);
      // Kapalı kuralın eski işi tetiklense de çalışmaz
      await h.jobs[0].fn();
      expect(h.calls).toHaveLength(1);
    });

    it('uygulama açılınca çalışan kural', async () => {
      const h = harness();
      h.automation.save(rule({ trigger: { type: 'app', event: 'start' }, actions: [{ command: 'x/echo', params: { text: 'açıldı' } }] }));
      expect(h.calls).toEqual([]);
      h.automation.stop();
      h.automation.start();
      await h.idle();
      expect(h.calls).toEqual([['echo', { text: 'açıldı' }]]);
    });
  });

  describe('dry-run (Dene)', () => {
    it('eşleşmeyi, koşulların gerçek değerlerini ve doldurulmuş parametreleri gösterir; hiçbir şey çalıştırmaz', () => {
      const h = harness();
      h.emit('Merhaba dünya', { meta: { n: 7 } });
      const id = h.notifications.list()[0].id;
      const result = h.automation.test(rule({ actions: [{ command: 'x/echo', params: { text: '{{title}}', n: '{{meta.n}}' } }, { command: 'x/danger' }] }), id);
      expect(result.matched).toBe(true);
      expect(result.conditions).toEqual([{ field: 'title', op: 'contains', value: 'merhaba', ok: true, actual: 'Merhaba dünya' }]);
      expect(result.actions).toEqual([
        { command: 'x/echo', plugin: 'x', title: 'Yankı', params: { text: 'Merhaba dünya', n: 7 }, confirm: false, error: null },
        { command: 'x/danger', plugin: 'x', title: 'Tehlikeli', params: {}, confirm: true, error: null }
      ]);
      expect(h.calls).toEqual([]);
      expect(h.commands.history()).toEqual([]);
      expect(h.automation.approvals()).toEqual([]);
      // Denenen kural kaydedilmez
      expect(h.automation.list()).toEqual([]);
    });

    it('eşleşmeyen bildirim, şemaya uymayan parametre ve olmayan komut', () => {
      const h = harness();
      h.emit('başka');
      const id = h.notifications.list()[0].id;
      const result = h.automation.test(rule({ actions: [{ command: 'x/echo', params: { n: 'abc', text: 'a' } }, { command: 'x/yok' }] }), id);
      expect(result.matched).toBe(false);
      expect(result.actions[0].error).toBe('"Sayı" bir sayı olmalı.');
      expect(result.actions[1].error).toBe('Komut bulunamadı: x/yok');
    });

    it('bildirim seçilmezse eşleşme bilinmez; zamanlanmış kuralda sonraki çalışmalar', () => {
      const h = harness();
      expect(h.automation.test(rule(), null).matched).toBeNull();
      const scheduled = h.automation.test(rule({ trigger: { type: 'schedule', cron: '*/15 * * * *' } }), null);
      expect(scheduled.matched).toBe(true);
      expect(scheduled.nextRuns).toHaveLength(3);
      expect(() => h.automation.test(rule({ trigger: { type: 'schedule', cron: 'yanlış' } }), null)).toThrow('Cron ifadesi geçersiz');
    });
  });

  it('kural kaydı kalıcıdır; silinince durumu da silinir', async () => {
    const h = harness();
    const r = h.automation.save(rule());
    expect(h.storage.kv.get('automations').rules).toHaveLength(1);
    h.automation.remove(r.id);
    expect(h.automation.list()).toEqual([]);
    expect(h.storage.kv.get('automationState')).toEqual({});
  });
});

// Gerçek çekirdekle: hazır şablonlar ve yardımcı komutlar (sabitleme, uyarı)
const STEAM_LIKE = `
export default {
  commands: {
    patch: {
      title: 'Yama yay',
      async run(ctx) {
        ctx.notify({ id: 'p' + Math.random(), title: 'Patch 1.2', body: 'Counter-Strike 2', tags: [ctx.key('tag.patchNotes')] });
        return {};
      }
    }
  }
};`;

// Kaynak her çalışmada yeni bildirim üretir; komutlar zinciri ctx.runCommand ile devralır
const LOOPY = `
let n = 0;
export default {
  sources: {
    akis: { title: 'Akış', async run(ctx) { ctx.notify({ id: 'k' + (++n) + '-' + Math.random(), title: 'yeni giriş' }); } },
    akis2: { title: 'Akış 2', async run(ctx) { ctx.notify({ id: 'm' + (++n) + '-' + Math.random(), title: 'yeni giriş' }); } }
  },
  commands: {
    yay: { title: 'Yay', async run(ctx) { ctx.notify({ id: 'y' + Math.random(), title: 'yayın' }); return {}; } },
    zincir: { title: 'Zincir', async run(ctx) { return ctx.runCommand('dongu/yay', {}); } }
  }
};`;

describe('otomasyon döngü önleme: çekirdek üzerinden (açık neden kimliği)', () => {
  let dir, core;
  afterEach(async () => {
    await core?.stop();
    if (dir) removeDir(dir);
  });

  async function boot() {
    dir = tempDir('pano-loop-');
    writePlugin(dir, 'dongu', { name: 'dongu', permissions: ['runCommand'] }, LOOPY);
    core = createCore({ pluginDirs: [dir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:') });
    await core.start();
  }
  const settleAll = () => new Promise((r) => setTimeout(r, 150));
  const count = (id) => core.commands.history().filter((e) => e.command === id).length;

  it('"tüm kaynakları kontrol et" eylemli kural, kaynakların ürettiği bildirimlerle kendini yeniden tetiklemez', async () => {
    await boot();
    core.automation.save({
      name: 'Gelince kontrol et',
      trigger: { type: 'notification' },
      conditions: [{ field: 'source', op: 'eq', value: 'dongu' }, { field: 'title', op: 'eq', value: 'yeni giriş' }],
      actions: [{ command: 'pano/runAll' }]
    });
    // Dış tetik: akis kendi başına çalışır (neden yok) → kural bir kez çalışır → runAll akis2'yi
    // çalıştırır (akis o an zaten çalıştığı için atlanır). akis2'nin bildirimi kuralın zincirini taşır
    // ve kuralı yeniden tetiklemez; taşımasaydı runAll akis'i de çalıştırıp döngüye girerdi.
    await core.sources.runNow('dongu/akis');
    await settleAll();
    expect(count('pano/runAll')).toBe(1);
    expect(core.notifications.list().filter((n) => n.title === 'yeni giriş')).toHaveLength(2);
    expect(core.automation.list()[0].enabled).toBe(true);
  });

  it('ctx.runCommand ile çalışan iç komut zinciri devralır', async () => {
    await boot();
    core.automation.save({
      name: 'Yayında zincirle',
      trigger: { type: 'notification' },
      conditions: [{ field: 'title', op: 'eq', value: 'yayın' }],
      actions: [{ command: 'dongu/zincir' }]
    });
    // Dış tetik → kural → zincir → (runCommand) yay → "yayın" bildirimi zincirde: kural durur
    await new Promise((resolve) => {
      const runId = core.commands.run('dongu/yay');
      core.bus.on('command:finished', (i) => i.runId === runId && resolve());
    });
    await settleAll();
    expect(count('dongu/zincir')).toBe(1);
    expect(count('dongu/yay')).toBe(2);
  });
});

describe('otomasyon: çekirdek üzerinden', () => {
  let dir, core;
  afterEach(async () => {
    await core?.stop();
    if (dir) removeDir(dir);
  });

  async function boot() {
    dir = tempDir('pano-automation-');
    writePlugin(dir, 'steam', { name: 'steam' }, STEAM_LIKE);
    core = createCore({ pluginDirs: [dir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:') });
    await core.start();
  }
  const finished = (runId) => new Promise((resolve) => {
    const on = (info) => { if (info.runId === runId) { core.bus.off('command:finished', on); resolve(info); } };
    core.bus.on('command:finished', on);
  });

  it('hazır şablonlar geçerli kurallardır', async () => {
    await boot();
    const templates = core.automation.templates();
    expect(templates.map((t) => t.name)).toEqual([
      'İnceleme istendiğinde sesli uyarı',
      'Takip ettiğim oyuna yama gelince bildirimi üste sabitle',
      'Hafta içi her sabah tüm kaynakları kontrol et'
    ]);
    for (const t of templates) expect(() => core.automation.test(t, null)).not.toThrow();
  });

  it('"yama gelince sabitle" şablonu bildirimi sabitler; geçmişte kural adı görünür', async () => {
    await boot();
    core.automation.save(core.automation.templates().find((t) => t.key === 'pinPatch'));
    await finished(core.commands.run('steam/patch'));
    await vi.waitFor(() => expect(core.notifications.list().find((n) => n.source === 'steam')?.pinned).toBe(true));
    const entry = core.commands.history().find((e) => e.command === 'pano/pin');
    expect(entry).toMatchObject({ origin: 'automation', originLabel: 'Takip ettiğim oyuna yama gelince bildirimi üste sabitle', status: 'ok' });
  });

  it('sesli uyarı komutu app:alert olayını yayar; notify Pano bildirimi üretir', async () => {
    await boot();
    const alert = vi.fn();
    core.bus.on('app:alert', alert);
    await finished(core.commands.run('pano/alert', { title: 'İnceleme', body: 'acme/app' }));
    expect(alert).toHaveBeenCalledWith({ title: 'İnceleme', body: 'acme/app' });
    await finished(core.commands.run('pano/notify', { title: 'Merhaba', level: 'warning' }));
    expect(core.notifications.list()[0]).toMatchObject({ source: 'pano', title: 'Merhaba', level: 'warning' });
    const pin = await finished(core.commands.run('pano/unpin', { id: 'yok' }));
    expect(pin.error).toBe('Bildirim bulunamadı; silinmiş olabilir.');
  });
});
