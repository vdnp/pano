// Şifreleme işi dışarıdan verilir (Electron'da safeStorage), böylece çekirdek
// Electron'a bağımlı kalmaz.
export const plainCipher = {
  encrypt: (value) => 'plain:' + Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (raw) => (raw.startsWith('plain:') ? Buffer.from(raw.slice(6), 'base64').toString('utf8') : null)
};

export function createSecrets(store, cipher = plainCipher) {
  const all = () => store.get('secrets') ?? {};
  const keyOf = (plugin, key) => `${plugin}.${key}`;

  return {
    has: (plugin, key) => keyOf(plugin, key) in all(),

    get(plugin, key) {
      const raw = all()[keyOf(plugin, key)];
      if (!raw) return null;
      try {
        return cipher.decrypt(raw);
      } catch {
        return null;
      }
    },

    set(plugin, key, value) {
      store.set('secrets', { ...all(), [keyOf(plugin, key)]: cipher.encrypt(value) });
    },

    delete(plugin, key) {
      const next = { ...all() };
      delete next[keyOf(plugin, key)];
      store.set('secrets', next);
    }
  };
}
