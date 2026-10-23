import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createContext } from '../../core/context.js';
import { createNotificationStore } from '../../core/notifications.js';
import { createSecrets } from '../../core/secrets.js';
import { createSqliteStorage } from '../../core/storage/index.js';
import { TEST_PERMISSIONS, publicResolve, silentLogger } from '../helpers.js';

function setup() {
  const storage = createSqliteStorage(':memory:');
  const store = storage.kv;
  const notifications = createNotificationStore(storage, new EventEmitter());
  const secrets = createSecrets(store);
  const logger = silentLogger();
  const make = (name, settings = {}) =>
    createContext(name, { permissions: TEST_PERMISSIONS, resolveHost: publicResolve, notifications, store, secrets, logger, getSettings: () => settings });
  return { store, notifications, secrets, logger, make };
}

describe('context', () => {
  it('notify id\'ye eklenti önekini ekler ve kaynağı zorlar', () => {
    const { make, notifications } = setup();
    const ctx = make('demo');

    expect(ctx.notify({ id: '7', title: 'Merhaba', source: 'baska' })).toBe(true);
    expect(notifications.list()[0]).toMatchObject({ id: 'demo:7', source: 'demo' });
  });

  it('farklı eklentilerin aynı id\'si çakışmaz', () => {
    const { make, notifications } = setup();
    make('a').notify({ id: '1', title: 'A' });
    make('b').notify({ id: '1', title: 'B' });
    expect(notifications.list().map((n) => n.id).sort()).toEqual(['a:1', 'b:1']);
  });

  it('id veya title yoksa hata fırlatır', () => {
    const { make } = setup();
    const ctx = make('demo');
    expect(() => ctx.notify({ title: 'X' })).toThrow('id ve title zorunlu');
    expect(() => ctx.notify({ id: '1' })).toThrow('id ve title zorunlu');
    expect(() => ctx.notify()).toThrow('id ve title zorunlu');
  });

  it('state eklentiye özeldir', () => {
    const { make, store } = setup();
    const a = make('a');
    const b = make('b');

    a.state.set('etag', 'x');
    a.state.set('count', 2);
    b.state.set('etag', 'y');

    expect(a.state.get('etag')).toBe('x');
    expect(b.state.get('etag')).toBe('y');
    expect(b.state.get('count')).toBeUndefined();
    expect(store.get('state')).toEqual({ a: { etag: 'x', count: 2 }, b: { etag: 'y' } });
  });

  it('secrets yalnızca kendi eklentisinin anahtarını okur', () => {
    const { make, secrets } = setup();
    secrets.set('a', 'token', 'gizli');
    expect(make('a').secrets.get('token')).toBe('gizli');
    expect(make('b').secrets.get('token')).toBeNull();
  });

  it('settings get/all getSettings sonucunu verir', () => {
    const { make } = setup();
    const ctx = make('demo', { interval: 5, flag: true });
    expect(ctx.settings.get('interval')).toBe(5);
    expect(ctx.settings.all()).toEqual({ interval: 5, flag: true });
  });

  it('log ve warn eklenti adıyla öneklenir', () => {
    const { make, logger } = setup();
    const ctx = make('demo');
    ctx.log('bir', 2);
    ctx.warn('dikkat');
    expect(logger.log).toHaveBeenCalledWith('[demo]', 'bir', 2);
    expect(logger.warn).toHaveBeenCalledWith('[demo]', 'dikkat');
  });
});
