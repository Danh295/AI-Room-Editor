import { describe, it, expect } from 'vitest';
import { rollUpCost, rollupToCsv } from './rollup.js';
import { createLibraryItem, placeItem } from './factory.js';
import type { LibraryItem, PlacedItem, Variant } from './types.js';

function priced(name: string, price: number | undefined, currency = 'CAD'): LibraryItem {
  const item = createLibraryItem({ name, subcategoryId: 'sofa', w: 2000, d: 900, h: 800 });
  return { ...item, price, currency };
}

function lib(...items: LibraryItem[]): Map<string, LibraryItem> {
  return new Map(items.map((i) => [i.id, i]));
}

function place(item: LibraryItem, variantId?: string): PlacedItem {
  const placed = placeItem(item, 0, 0);
  return variantId ? { ...placed, variantId } : { ...placed, variantId: undefined };
}

const swatch = (id: string, price?: number): Variant => ({
  id,
  label: id,
  hex: '#ffffff',
  price,
});

describe('rollUpCost', () => {
  it('sums priced placements and groups repeats onto one line', () => {
    const sofa = priced('Sofa', 1200);
    const rollup = rollUpCost([place(sofa), place(sofa)], lib(sofa));

    expect(rollup.total).toBe(2400);
    expect(rollup.itemCount).toBe(2);
    expect(rollup.lines).toHaveLength(1);
    expect(rollup.lines[0]).toMatchObject({ count: 2, unitPrice: 1200, total: 2400 });
  });

  it('lets a variant price override the item price', () => {
    const base = priced('Sofa', 1200);
    const sofa: LibraryItem = { ...base, variants: [swatch('var_velvet', 1800)] };

    const rollup = rollUpCost([place(sofa, 'var_velvet')], lib(sofa));
    expect(rollup.total).toBe(1800);
    expect(rollup.lines[0]?.variant).toBe('var_velvet');
  });

  it('keeps different variants of one product on separate lines', () => {
    const base = priced('Sofa', 1200);
    const sofa: LibraryItem = {
      ...base,
      variants: [swatch('var_a', 1000), swatch('var_b', 2000)],
    };

    const rollup = rollUpCost([place(sofa, 'var_a'), place(sofa, 'var_b')], lib(sofa));
    expect(rollup.lines).toHaveLength(2);
    expect(rollup.total).toBe(3000);
  });

  it('counts unpriced placements instead of guessing a price', () => {
    const sofa = priced('Sofa', 1200);
    const mystery = priced('Mystery', undefined);

    const rollup = rollUpCost([place(sofa), place(mystery)], lib(sofa, mystery));
    expect(rollup.total).toBe(1200);
    expect(rollup.unpricedCount).toBe(1);
    expect(rollup.lines.find((l) => l.name === 'Mystery')).toMatchObject({
      unitPrice: null,
      total: null,
    });
  });

  it('reports a placement whose library entry is gone rather than dropping it', () => {
    const sofa = priced('Sofa', 1200);
    const orphan = place(priced('Deleted', 900));

    const rollup = rollUpCost([place(sofa), orphan], lib(sofa));
    expect(rollup.itemCount).toBe(2);
    expect(rollup.unpricedCount).toBe(1);
    expect(rollup.total).toBe(1200);
    expect(rollup.lines.some((l) => l.name === 'Missing item')).toBe(true);
  });

  it('flags a mix of currencies instead of quietly adding them up', () => {
    const cad = priced('Sofa', 1000, 'CAD');
    const usd = priced('Chair', 500, 'USD');

    const rollup = rollUpCost([place(cad), place(usd)], lib(cad, usd));
    expect(rollup.mixedCurrencies).toBe(true);
    expect(rollup.total).toBe(1500);
  });

  it('totals by category', () => {
    const sofa = priced('Sofa', 1000);
    const table = {
      ...createLibraryItem({ name: 'Table', subcategoryId: 'coffee-table', w: 1200, d: 600, h: 450 }),
      price: 400,
      currency: 'CAD',
    };

    const rollup = rollUpCost([place(sofa), place(table)], lib(sofa, table));
    expect(rollup.byCategory).toEqual([
      { categoryId: 'seating', label: 'Seating', count: 1, total: 1000 },
      { categoryId: 'tables', label: 'Tables', count: 1, total: 400 },
    ]);
  });

  it('is empty, not broken, with nothing placed', () => {
    const rollup = rollUpCost([], new Map());
    expect(rollup).toMatchObject({ total: 0, itemCount: 0, unpricedCount: 0, currency: null });
    expect(rollup.lines).toEqual([]);
  });
});

describe('rollupToCsv', () => {
  it('writes a header, a row per line, and the total', () => {
    const sofa = priced('Sofa', 1200);
    const csv = rollupToCsv(rollUpCost([place(sofa), place(sofa)], lib(sofa)));
    const rows = csv.trim().split('\n');

    expect(rows[0]).toBe('Item,Variant,Category,Qty,Unit price,Line total');
    expect(rows[1]).toBe('Sofa,,seating,2,1200,2400');
    expect(csv).toContain('Total,,,2,,2400');
    expect(csv).toContain('Currency,CAD');
  });

  it('quotes fields containing commas', () => {
    const sofa = priced('Sofa, three-seat', 100);
    expect(rollupToCsv(rollUpCost([place(sofa)], lib(sofa)))).toContain('"Sofa, three-seat"');
  });

  it('carries the unpriced caveat into the file', () => {
    const mystery = priced('Mystery', undefined);
    expect(rollupToCsv(rollUpCost([place(mystery)], lib(mystery)))).toContain(
      'Not included,1 placement(s) with no price',
    );
  });
});
