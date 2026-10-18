import { describe, expect, it } from 'vitest';
import { createTimeFormat } from '../../src/renderer/src/lib/time.js';
import { BASE_FIELDS, OPERATORS } from '../../src/renderer/src/lib/automation.js';
import { NOTIFICATION_FIELDS, OPERATORS as SHARED_OPERATORS } from '../../shared/automation.js';

const t = (k) => k;
const AT = new Date(2026, 9, 19, 9, 5).getTime(); // 19 Ekim 2026 Pazartesi 09:05

describe('zaman biçimleri seçili dilde', () => {
  it('kısa tarih + saat dilin biçimiyle', () => {
    const en = createTimeFormat({ locale: 'en', t });
    const tr = createTimeFormat({ locale: 'tr', t });
    expect(en.shortDateTime(AT)).toBe(`${new Date(AT).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })} ${en.clock(AT)}`);
    expect(en.shortDateTime(AT)).toMatch(/Mon/);
    expect(tr.shortDateTime(AT)).toMatch(/Pzt/);
    expect(tr.shortDateTime(AT)).toContain('09:05');
  });

  it('tam tarih + saat dilin biçimiyle', () => {
    expect(createTimeFormat({ locale: 'tr', t }).fullDateTime(AT)).toBe(new Date(AT).toLocaleString('tr'));
  });
});

describe('otomasyon sabitleri ortak modülden', () => {
  it('arayüz listeleri core ile aynı', () => {
    expect(BASE_FIELDS).toBe(NOTIFICATION_FIELDS);
    expect(OPERATORS).toBe(SHARED_OPERATORS);
  });
});
