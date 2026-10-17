import { describe, expect, it } from 'vitest';
import { columnsFor, dropCard, dropPlace, layoutSpans, moveCard, orderedCards, setCardVisible, widgetTitle } from '../../src/renderer/src/lib/dashboard.js';
import { createI18n, mergeCatalogs } from '../../shared/i18n.js';
import { appCatalogs } from '../../locales/index.js';

const W = (id) => ({ id, plugin: id.split('/')[0], widget: id.split('/')[1], title: id, view: 'stat', size: 'normal' });
const WIDGETS = [W('a/1'), W('a/2'), W('b/1')];

describe('panel düzeni', () => {
  it('kartları düzen sırasında verir, düzende olmayanları sona görünür ekler', () => {
    const cards = orderedCards({ cards: [{ id: 'b/1', visible: false }, { id: 'yok/x', visible: true }, { id: 'a/1', visible: true }] }, WIDGETS);
    expect(cards.map((c) => [c.id, c.visible])).toEqual([['b/1', false], ['a/1', true], ['a/2', true]]);
    expect(orderedCards(null, WIDGETS).map((c) => c.id)).toEqual(['a/1', 'a/2', 'b/1']);
  });

  it('yukarı/aşağı taşır, sınırda değiştirmez', () => {
    const cards = orderedCards(null, WIDGETS);
    expect(moveCard(cards, 'a/2', -1).cards.map((c) => c.id)).toEqual(['a/2', 'a/1', 'b/1']);
    expect(moveCard(cards, 'a/2', 1).cards.map((c) => c.id)).toEqual(['a/1', 'b/1', 'a/2']);
    expect(moveCard(cards, 'a/1', -1).cards.map((c) => c.id)).toEqual(['a/1', 'a/2', 'b/1']);
    expect(moveCard(cards, 'b/1', 1).cards.map((c) => c.id)).toEqual(['a/1', 'a/2', 'b/1']);
  });

  it('varsayılan gizli kart (hidden) düzende yoksa gizli eklenir', () => {
    const cards = orderedCards({ cards: [] }, [W('a/1'), { ...W('demo/1'), hidden: true }]);
    expect(cards.map((c) => [c.id, c.visible])).toEqual([['a/1', true], ['demo/1', false]]);
    // Kullanıcı açtıysa düzendeki tercih geçerli
    expect(orderedCards({ cards: [{ id: 'demo/1', visible: true }] }, [{ ...W('demo/1'), hidden: true }])[0].visible).toBe(true);
  });

  it('sürükle-bırak: hedefin önüne ya da arkasına taşır, kendine bırakmada değiştirmez', () => {
    const cards = orderedCards(null, [...WIDGETS, W('b/2')]);
    const ids = (layout) => layout.cards.map((c) => c.id);
    expect(ids(dropCard(cards, 'b/2', 'a/1', 'before'))).toEqual(['b/2', 'a/1', 'a/2', 'b/1']);
    expect(ids(dropCard(cards, 'a/1', 'b/1', 'after'))).toEqual(['a/2', 'b/1', 'a/1', 'b/2']);
    expect(ids(dropCard(cards, 'a/1', 'b/1', 'before'))).toEqual(['a/2', 'a/1', 'b/1', 'b/2']);
    expect(ids(dropCard(cards, 'a/2', 'a/2', 'after'))).toEqual(['a/1', 'a/2', 'b/1', 'b/2']);
    expect(ids(dropCard(cards, 'a/2', 'yok/x'))).toEqual(['a/1', 'a/2', 'b/1', 'b/2']);
    expect(ids(dropCard(cards, 'yok/x', 'a/1'))).toEqual(['a/1', 'a/2', 'b/1', 'b/2']);
    // Görünürlük korunur
    const hidden = setCardVisible(cards, 'b/1', false);
    expect(dropCard(orderedCards(hidden, [...WIDGETS, W('b/2')]), 'b/1', 'a/1').cards[0]).toEqual({ id: 'b/1', visible: false });
  });

  it('bırakma yeri: ızgarada sol/sağ yarı, listede üst/alt yarı', () => {
    const rect = { left: 100, top: 50, width: 200, height: 40 };
    expect(dropPlace(rect, 150, 0, true)).toBe('before');
    expect(dropPlace(rect, 250, 0, true)).toBe('after');
    expect(dropPlace(rect, 0, 60, false)).toBe('before');
    expect(dropPlace(rect, 0, 80, false)).toBe('after');
  });

  it('görünürlüğü değiştirir ve düzeni yalnızca id/visible olarak verir', () => {
    expect(setCardVisible(orderedCards(null, WIDGETS), 'a/2', false)).toEqual({
      cards: [{ id: 'a/1', visible: true }, { id: 'a/2', visible: false }, { id: 'b/1', visible: true }]
    });
  });

  it('panel genişliğine göre sütun sayısı', () => {
    expect([400, 600, 1099, 1100, 1599, 1600, 2400].map(columnsFor)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it('kart sırasını korur, geniş kart satıra sığmazsa satırın kalanını doldurur', () => {
    const n = { size: 'normal' };
    const w = { size: 'wide' };
    // 3 sütun: [n n | w→1] [n w] — satır ortasında boşluk yok
    expect(layoutSpans([n, n, w, n, w], 3)).toEqual([1, 1, 1, 1, 2]);
    // 4 sütun: [n n w] [n]
    expect(layoutSpans([n, n, w, n], 4)).toEqual([1, 1, 2, 1]);
    // 2 sütun: geniş kart tam satır
    expect(layoutSpans([w, n, n, w], 2)).toEqual([2, 1, 1, 2]);
    // 1 sütun: hepsi tek sütun
    expect(layoutSpans([w, n], 1)).toEqual([1, 1]);
  });

  it('kart başlığını eklentinin kataloğundan çevirir, yoksa metni kullanır', () => {
    const i18n = createI18n({ locale: 'en', catalogs: mergeCatalogs(appCatalogs, { demo: { en: { widgets: { summary: 'Summary' } } } }) });
    expect(widgetTitle(i18n, { plugin: 'demo', title: 'widgets.summary' })).toBe('Summary');
    expect(widgetTitle(i18n, { plugin: 'demo', title: 'Düz başlık' })).toBe('Düz başlık');
  });
});
