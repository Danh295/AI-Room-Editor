/**
 * What the room costs, as far as the library actually knows.
 *
 * The hard part of a cost rollup is not the arithmetic, it's being honest about
 * what the number leaves out. A library item's price is optional, a variant can
 * override it, and an AI-ingested item may carry a price in a different
 * currency to the one next to it. A single bold total hides all three. So the
 * rollup reports what it summed, what it could not, and whether the currencies
 * it summed were even the same.
 */

import type { LibraryItem, PlacedItem } from './types.js';
import { findCategory } from './taxonomy.js';

export interface CostLine {
  /** Stable key for the grouping: same product, same variant. */
  key: string;
  libraryId: string;
  name: string;
  /** Variant label, when the placements are of a specific one. */
  variant?: string;
  categoryId: string;
  count: number;
  /** null when neither the variant nor the item carries a price. */
  unitPrice: number | null;
  total: number | null;
}

export interface CategoryTotal {
  categoryId: string;
  label: string;
  count: number;
  total: number;
}

export interface CostRollup {
  lines: CostLine[];
  byCategory: CategoryTotal[];
  /** Sum of everything that had a price. Never includes unpriced items. */
  total: number;
  /** Placement count, priced and unpriced. */
  itemCount: number;
  /** How many placements contributed nothing to the total. */
  unpricedCount: number;
  /** The currency of the total, or null when nothing was priced. */
  currency: string | null;
  /** True when priced items disagreed about currency — the total is then a mix. */
  mixedCurrencies: boolean;
}

/** Price for one placement: the variant's own price wins over the item's. */
function priceOf(placed: PlacedItem, item: LibraryItem): number | null {
  const variant = item.variants.find((v) => v.id === placed.variantId);
  const price = variant?.price ?? item.price;
  return typeof price === 'number' && Number.isFinite(price) ? price : null;
}

/**
 * Total the placements in a plan, grouped by product and variant.
 *
 * Items whose library entry has gone missing are counted as unpriced rather
 * than dropped: a plan that silently costs less because an entry was deleted is
 * worse than one that says it doesn't know.
 */
export function rollUpCost(items: PlacedItem[], library: Map<string, LibraryItem>): CostRollup {
  const lines = new Map<string, CostLine>();
  const currencies = new Set<string>();
  let total = 0;
  let unpricedCount = 0;

  for (const placed of items) {
    const item = library.get(placed.libraryId);

    if (!item) {
      unpricedCount += 1;
      const key = `missing:${placed.libraryId}`;
      const line = lines.get(key) ?? {
        key,
        libraryId: placed.libraryId,
        name: 'Missing item',
        categoryId: 'other',
        count: 0,
        unitPrice: null,
        total: null,
      };
      line.count += 1;
      lines.set(key, line);
      continue;
    }

    const unitPrice = priceOf(placed, item);
    if (unitPrice === null) unpricedCount += 1;
    else {
      total += unitPrice;
      if (item.currency) currencies.add(item.currency);
    }

    const variant = item.variants.find((v) => v.id === placed.variantId);
    const key = `${item.id}:${variant?.id ?? ''}`;
    const line = lines.get(key) ?? {
      key,
      libraryId: item.id,
      name: item.name,
      variant: variant?.label,
      categoryId: item.categoryId,
      count: 0,
      unitPrice,
      total: null,
    };
    line.count += 1;
    line.total = unitPrice === null ? null : unitPrice * line.count;
    lines.set(key, line);
  }

  const byCategory = new Map<string, CategoryTotal>();
  for (const line of lines.values()) {
    const label = categoryLabel(line.categoryId);
    const entry = byCategory.get(line.categoryId) ?? {
      categoryId: line.categoryId,
      label,
      count: 0,
      total: 0,
    };
    entry.count += line.count;
    entry.total += line.total ?? 0;
    byCategory.set(line.categoryId, entry);
  }

  return {
    lines: [...lines.values()].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)),
    byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
    total: Math.round(total * 100) / 100,
    itemCount: items.length,
    unpricedCount,
    currency: currencies.size === 0 ? null : [...currencies][0]!,
    mixedCurrencies: currencies.size > 1,
  };
}

/** Human label for a category id, falling back to the id itself. */
function categoryLabel(categoryId: string): string {
  return (
    findCategory(categoryId)?.label ?? categoryId.charAt(0).toUpperCase() + categoryId.slice(1)
  );
}

/** One CSV field, quoted only when it has to be. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The rollup as a spreadsheet.
 *
 * The unpriced count rides along as a trailing note rather than being dropped,
 * so a total pasted into a budget can't lose the caveat on the way.
 */
export function rollupToCsv(rollup: CostRollup): string {
  const rows: string[] = [
    ['Item', 'Variant', 'Category', 'Qty', 'Unit price', 'Line total'].join(','),
  ];

  for (const line of rollup.lines) {
    rows.push(
      [
        csvField(line.name),
        csvField(line.variant),
        csvField(line.categoryId),
        csvField(line.count),
        csvField(line.unitPrice),
        csvField(line.total),
      ].join(','),
    );
  }

  rows.push('');
  rows.push(
    [csvField('Total'), '', '', csvField(rollup.itemCount), '', csvField(rollup.total)].join(
      ',',
    ),
  );
  if (rollup.currency) rows.push([csvField('Currency'), csvField(rollup.currency)].join(','));
  if (rollup.unpricedCount > 0) {
    rows.push(
      [
        csvField('Not included'),
        csvField(`${rollup.unpricedCount} placement(s) with no price`),
      ].join(','),
    );
  }
  if (rollup.mixedCurrencies) {
    rows.push(
      [csvField('Warning'), csvField('Prices were in more than one currency')].join(','),
    );
  }

  return `${rows.join('\n')}\n`;
}
