import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCore } from '../../core/index.js';
import { plainCipher } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { cleanSuggestion, MAX_HISTORY, redactParams } from '../../core/commands.js';
import { validateParams } from '../../core/schema.js';
import { removeDir, silentLogger, tempDir, writePlugin } from '../helpers.js';

const TOOL = `
export default {
  setup(ctx) {
    ctx.notify({ id: 'n1', title: 'Bildirim', meta: { tid: '77' } });
    ctx.notify({ id: 'n2', title: 'Kimliksiz' });
  },
  sources: { bg: { title: 'Arka plan', async run(ctx) { await ctx.openExternal('https://example.com'); } } },
  suggest: {
    games: async (ctx, q) => [
      { label: 'Oyun ' + q, detail: 'ayrıntı', value: { appId: '730', name: 'CS', extra: 'x', token: 'gizli' } },
      { label: 'Bozuk', value: { appId: 'abc' } },
      { label: '', value: { appId: 1 } },
      { label: 'Düz', value: 42 }
    ]
  },
  commands(settings) {
    const c = {
      echo: {
        title: 'Yankı',
        params: {
          text: { type: 'string', label: 'Metin', required: true },
          count: { type: 'number', label: 'Adet', min: 1, max: 5, default: 1 },
          loud: { type: 'boolean', label: 'Yüksek' },
          token: { type: 'string', label: 'Anahtar', secret: true }
        },
        async run(ctx, p) { return { message: p.text + 'x' + p.count + (p.loud ? '!' : '') }; }
      },
      open: {
        title: 'Aç',
        params: { url: { type: 'string', label: 'Adres', required: true } },
        async run(ctx, p) { await ctx.openExternal(p.url); return { message: 'açıldı' }; }
      },
      chain: { title: 'Zincir', async run(ctx) { return ctx.runCommand('arac/echo', { text: 'iç', count: 2 }); } },
      loop: { title: 'Döngü', async run(ctx) { return ctx.runCommand('arac/loop', {}); } },
      danger: { title: 'Tehlikeli', confirm: true, async run() { return { message: 'yapıldı' }; } },
      callDanger: { title: 'Çağır', async run(ctx) { return ctx.runCommand('arac/danger', {}); } },
      slow: {
        title: 'Yavaş',
        async run(ctx, p, { signal, progress }) {
          globalThis.__slowSignal = signal;
          progress(0.5, 'yarısı');
          await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('durdu'))));
        }
      },
      stubborn: { title: 'İnatçı', async run() { await new Promise((r) => setTimeout(r, 200)); return { message: 'bitti' }; } },
      fail: { title: 'Hata', async run() { throw new Error('patladı'); } },
      game: {
        title: 'Oyun',
        params: {
          appId: { type: 'number', label: 'Oyun', required: true, suggest: 'games' },
          name: { type: 'string', label: 'Ad' },
          token: { type: 'string', label: 'Anahtar', secret: true }
        },
        async run() { return {}; }
      },
      act: {
        title: 'Eylem',
        palette: false,
        params: { tid: { type: 'string', label: 'T', required: true } },
        notificationAction: { label: 'Kısa', markRead: true, params: (n) => (n.meta?.tid ? { tid: n.meta.tid } : null) },
        async run(ctx, p) { return { message: 'tid ' + p.tid }; }
      },
      'bad name': { title: 'x', async run() {} },
      norun: { title: 'Çalışmaz' }
    };
    if (settings.extra) c.extra = { title: 'Ek', async run() { return {}; } };
    return c;
  }
};`;

const NO_PERMISSION = `
export default {
  commands: {
    open: { title: 'Aç', async run(ctx) { await ctx.openExternal('https://example.com'); } },
    chain: { title: 'Zincir', async run(ctx) { return ctx.runCommand('arac/echo', { text: 'a' }); } }
  }
};`;

// Bitiş olayını bekler (run kimliği eşzamanlı döner, iş sonraki turda biter)
const finished = (core, runId) =>
  new Promise((resolve) => {
    const on = (info) => {
      if (info.runId !== runId) return;
      core.bus.off('command:finished', on);
      resolve(info);
    };
    core.bus.on('command:finished', on);
  });
const runAndWait = (core, id, params = {}, origin) => finished(core, core.commands.run(id, params, origin));

describe('parametre şeması', () => {
  const fail = (code, [key], extra) => Object.assign(new Error(`${code}:${key}`), { extra });
  const schema = {
    text: { type: 'string', required: true },
    count: { type: 'number', min: 1, max: 5, default: 1 },
    loud: { type: 'boolean' },
    tags: { type: 'list', item: { name: { type: 'string', required: true } } }
  };

  it('türlere çevirir, varsayılanı uygular, şemada olmayanı atar', () => {
    expect(validateParams(schema, { text: '  merhaba ', count: '3', loud: 'false', extra: 1, tags: [{ name: 'a' }, { name: '' }] }, fail))
      .toEqual({ text: 'merhaba', count: 3, loud: false, tags: [{ name: 'a' }] });
    expect(validateParams(schema, { text: 'x' }, fail)).toEqual({ text: 'x', count: 1, tags: [] });
  });

  it('eksik, sayı olmayan ve aralık dışı değerde alan adıyla hata verir', () => {
    expect(() => validateParams(schema, {}, fail)).toThrow('missing:text');
    expect(() => validateParams(schema, { text: '   ' }, fail)).toThrow('missing:text');
    expect(() => validateParams(schema, { text: 'a', count: 'beş' }, fail)).toThrow('notNumber:count');
    expect(() => validateParams(schema, { text: 'a', count: 9 }, fail)).toThrow('outOfRange:count');
    expect(() => validateParams({ l: { type: 'list', required: true, item: { a: { type: 'string' } } } }, { l: [] }, fail)).toThrow('missing:l');
  });

  it('öneri değeri: kısmi parametreler, sorulan alan zorunlu; gizli/liste/bilinmeyen alan atılır', () => {
    const s = { appId: { type: 'number' }, name: { type: 'string' }, token: { type: 'string', secret: true }, tags: { type: 'list' } };
    expect(cleanSuggestion(s, 'appId', { appId: '730', name: ' CS ', token: 'x', tags: [1], other: 1 })).toEqual({ appId: 730, name: 'CS' });
    expect(cleanSuggestion(s, 'appId', 570)).toEqual({ appId: 570 });
    expect(cleanSuggestion(s, 'appId', { appId: 'abc' })).toBeNull();
    expect(cleanSuggestion(s, 'appId', { name: 'yalnız ad' })).toBeNull();
  });

  it('gizli parametreler geçmiş için çıkarılır', () => {
    expect(redactParams({ a: {}, b: { secret: true } }, { a: 1, b: 'parola' })).toEqual({ a: 1 });
  });
});

describe('komutlar: core üzerinden', () => {
  let dir, core, opened;

  beforeEach(async () => {
    dir = tempDir('pano-commands-');
    writePlugin(dir, 'arac', { name: 'arac', permissions: ['openExternal', 'runCommand', 'uydurma'], settings: { extra: { type: 'boolean', default: false } } }, TOOL);
    writePlugin(dir, 'izinsiz', { name: 'izinsiz' }, NO_PERMISSION);
    opened = vi.fn(async (url) => url.startsWith('https://'));
    core = createCore({
      pluginDirs: [dir], cipher: plainCipher, logger: silentLogger(), storage: createSqliteStorage(':memory:'), openExternal: opened
    });
    await core.start();
  });

  afterEach(async () => {
    await core.stop();
    removeDir(dir);
    delete globalThis.__slowSignal;
  });

  describe('kayıt defteri', () => {
    it('uygulama ve eklenti komutlarını "eklenti/komut" anahtarıyla listeler, bozuk tanımları atlar', () => {
      const ids = core.commands.list().map((c) => c.id);
      expect(ids.slice(0, 2)).toEqual(['pano/runAll', 'pano/markAllRead']);
      expect(ids).toContain('arac/echo');
      expect(ids).toContain('izinsiz/open');
      expect(ids).not.toContain('arac/bad name');
      expect(ids).not.toContain('arac/norun');
    });

    it('arayüze yalnızca düz bilgi gider: şema, onay, palet ve bildirim eylemi', () => {
      const list = core.commands.list();
      const echo = list.find((c) => c.id === 'arac/echo');
      expect(echo.params.count).toEqual({ type: 'number', label: 'Adet', required: false, secret: false, min: 1, max: 5, default: 1, suggest: null });
      expect(echo.params.token.secret).toBe(true);
      expect(list.find((c) => c.id === 'arac/game').params.appId.suggest).toEqual({ provider: 'games', placeholder: '' });
      expect(list.find((c) => c.id === 'arac/danger').confirm).toBe(true);
      expect(list.find((c) => c.id === 'arac/act')).toMatchObject({ palette: false, notificationAction: { label: 'Kısa' } });
      expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    });

    it('ayara bağlı komut listesi ayar değişince güncellenir', async () => {
      expect(core.commands.list().some((c) => c.id === 'arac/extra')).toBe(false);
      await core.sources.updateSettings('arac', { extra: true });
      expect(core.commands.list().some((c) => c.id === 'arac/extra')).toBe(true);
    });

    it('bilinmeyen komut ve geçersiz parametre çalışmadan reddedilir', () => {
      expect(() => core.commands.run('arac/yok')).toThrow('Komut bulunamadı: arac/yok');
      expect(() => core.commands.run('arac/echo', {})).toThrow('"Metin" boş bırakılamaz.');
      expect(() => core.commands.run('arac/echo', { text: 'a', count: 9 })).toThrow('"Adet" 1 ile 5 arasında olmalı.');
      expect(core.commands.history()).toEqual([]);
    });
  });

  describe('çalıştırma ve geçmiş', () => {
    it('sonuç mesajını verir; geçmişe parametreler (gizliler hariç), süre ve kaynak yazılır', async () => {
      const done = await runAndWait(core, 'arac/echo', { text: 'merhaba', count: 2, loud: true, token: 'parola' });
      expect(done).toMatchObject({ status: 'ok', message: 'merhabax2!', command: 'arac/echo', plugin: 'arac', title: 'Yankı' });
      const [entry] = core.commands.history();
      expect(entry).toMatchObject({ command: 'arac/echo', status: 'ok', message: 'merhabax2!', origin: 'palette', params: { text: 'merhaba', count: 2, loud: true } });
      expect(entry.params).not.toHaveProperty('token');
      expect(JSON.stringify(core.commands.history())).not.toContain('parola');
      expect(entry.duration).toBeGreaterThanOrEqual(0);
    });

    it('hata mesajı geçmişte saklanır; kaynak bilgisi korunur', async () => {
      const done = await runAndWait(core, 'arac/fail', {}, 'history');
      expect(done).toMatchObject({ status: 'error', error: 'patladı' });
      expect(core.commands.history()[0]).toMatchObject({ status: 'error', error: 'patladı', origin: 'history' });
    });

    it(`en yeni ${MAX_HISTORY} kayıt tutulur`, async () => {
      for (let i = 0; i < MAX_HISTORY + 5; i++) await runAndWait(core, 'arac/echo', { text: `k${i}` });
      const history = core.commands.history();
      expect(history).toHaveLength(MAX_HISTORY);
      expect(history[0].params.text).toBe(`k${MAX_HISTORY + 4}`);
      core.commands.clearHistory();
      expect(core.commands.history()).toEqual([]);
    });

    it('ilerleme olayı ve çalışan komut listesi; iptal sinyali tetiklenir, geçmişe "iptal" yazılır', async () => {
      const progress = vi.fn();
      core.bus.on('command:progress', progress);
      const runId = core.commands.run('arac/slow');
      const end = finished(core, runId);
      await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ runId, progress: 0.5, message: 'yarısı' }));
      expect(core.commands.running().map((r) => r.runId)).toEqual([runId]);

      expect(core.commands.cancel(runId)).toBe(true);
      expect(globalThis.__slowSignal.aborted).toBe(true);
      expect((await end).status).toBe('cancelled');
      expect(core.commands.running()).toEqual([]);
      expect(core.commands.history()[0].status).toBe('cancelled');
      expect(core.commands.cancel(runId)).toBe(false);
    });

    it('sinyali dinlemeyen komut da iptalde hemen biter; geç gelen sonucu yok sayılır', async () => {
      const runId = core.commands.run('arac/stubborn');
      const end = finished(core, runId);
      core.commands.cancel(runId);
      expect((await end).status).toBe('cancelled');
      await new Promise((r) => setTimeout(r, 250));
      expect(core.commands.history()).toHaveLength(1);
    });

    it('uygulama komutları: tümünü okundu say ve tüm kaynakları kontrol et', async () => {
      expect(core.notifications.list().some((n) => !n.read)).toBe(true);
      expect(await runAndWait(core, 'pano/markAllRead')).toMatchObject({ status: 'ok', message: 'Tüm bildirimler okundu sayıldı.' });
      expect(core.notifications.list().every((n) => n.read)).toBe(true);
      // arac/bg izinli ama komut dışında openExternal çağırdığı için hata verir
      expect(await runAndWait(core, 'pano/runAll', {}, 'tray')).toMatchObject({
        status: 'ok', message: '1 kaynak kontrol edildi, 1 tanesi hata verdi.', origin: 'tray'
      });
    });
  });

  describe('izinler', () => {
    it('beyan edilen izinler listelenir, bilinmeyen izin atılır', () => {
      const arac = core.sources.list().find((s) => s.name === 'arac');
      expect(arac.permissions).toEqual(['openExternal', 'runCommand']);
      expect(core.sources.list().find((s) => s.name === 'izinsiz').permissions).toEqual([]);
    });

    it('izin beyan etmeyen eklenti anlaşılır hata alır', async () => {
      expect((await runAndWait(core, 'izinsiz/open')).error)
        .toBe('izinsiz eklentisi "Bağlantı açma" iznini manifest.json\'da (permissions) beyan etmemiş.');
      expect((await runAndWait(core, 'izinsiz/chain')).error).toContain('"Başka komutları çalıştırma" iznini');
      expect(opened).not.toHaveBeenCalled();
    });

    it('izin olsa da komut dışında (kaynak işinde) kullanılamaz', async () => {
      await core.sources.runNow('arac/bg');
      const job = core.sources.list().find((s) => s.name === 'arac').jobs[0];
      expect(job.error).toBe('"Bağlantı açma" yalnızca bir komut çalışırken kullanılabilir.');
      expect(opened).not.toHaveBeenCalled();
    });

    it('komut içinde adresi açar; izin verilmeyen adreste anlaşılır hata', async () => {
      expect(await runAndWait(core, 'arac/open', { url: 'https://example.com/x' })).toMatchObject({ status: 'ok' });
      expect(opened).toHaveBeenCalledWith('https://example.com/x');
      expect((await runAndWait(core, 'arac/open', { url: 'file:///etc/passwd' })).error).toMatch('Bu adres açılamaz');
    });
  });

  describe('ctx.runCommand', () => {
    it('başka komutu çalıştırır ve sonucunu döner; iç çalıştırma da geçmişe "eklenti" kaynağıyla yazılır', async () => {
      expect(await runAndWait(core, 'arac/chain')).toMatchObject({ status: 'ok', message: 'içx2' });
      // İkisi aynı milisaniyede başlayabilir; sıraya değil kayda bakılır
      const history = core.commands.history();
      expect(history.map((e) => e.command).sort()).toEqual(['arac/chain', 'arac/echo']);
      expect(history.find((e) => e.command === 'arac/echo').origin).toBe('plugin');
      expect(history.find((e) => e.command === 'arac/chain').origin).toBe('palette');
    });

    it('onay gerektiren komutu çalıştıramaz', async () => {
      expect((await runAndWait(core, 'arac/callDanger')).error).toBe('arac/danger kullanıcı onayı gerektiriyor; yalnızca komut paletinden çalıştırılabilir.');
    });

    it('kendini çağıran komut derinlik sınırında durur', async () => {
      expect((await runAndWait(core, 'arac/loop')).error).toBe('Komutlar birbirini çok derin çağırdı (arac/loop); döngü olabilir.');
    });
  });

  describe('öneri ve bildirim eylemi', () => {
    it('parametre önerisi şemadan geçer; kısa sorgu ve bilinmeyen sağlayıcı', async () => {
      expect(await core.commands.suggest('arac/game', 'appId', 'cs')).toEqual([
        { label: 'Oyun cs', detail: 'ayrıntı', value: { appId: 730, name: 'CS' } },
        { label: 'Düz', detail: '', value: { appId: 42 } }
      ]);
      expect(await core.commands.suggest('arac/game', 'appId', 'c')).toEqual([]);
      await expect(core.commands.suggest('arac/game', 'name', 'cs')).rejects.toThrow('Bilinmeyen öneri sağlayıcısı');
    });

    it('bildirimden parametre çıkarır, başarıda bildirimi okundu yapar; uygulanamazsa hata', async () => {
      const runId = await core.commands.runForNotification('arac/act', 'arac:n1');
      expect(await finished(core, runId)).toMatchObject({ status: 'ok', message: 'tid 77', origin: 'notification' });
      await vi.waitFor(() => expect(core.notifications.list().find((n) => n.id === 'arac:n1').read).toBe(true));
      await expect(core.commands.runForNotification('arac/act', 'arac:n2')).rejects.toThrow('Bu eylem bu bildirime uygulanamıyor.');
      await expect(core.commands.runForNotification('arac/act', 'yok')).rejects.toThrow('uygulanamıyor');
    });
  });
});

describe('ayrılmış eklenti adı', () => {
  it('"pano" adlı eklenti yüklenmez', async () => {
    const dir = tempDir('pano-reserved-');
    writePlugin(dir, 'pano', { name: 'pano' }, 'export default { commands: { x: { run() {} } } };');
    const logger = silentLogger();
    const core = createCore({ pluginDirs: [dir], cipher: plainCipher, logger, storage: createSqliteStorage(':memory:') });
    await core.start();
    expect(core.sources.list()).toEqual([]);
    expect(logger.error.mock.calls.flat().join(' ')).toContain('uygulamaya ayrılmış');
    await core.stop();
    removeDir(dir);
  });
});
