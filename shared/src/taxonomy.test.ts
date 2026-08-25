import { describe, it, expect } from 'vitest';
import {
  TAXONOMY,
  ALL_SUBCATEGORY_IDS,
  findSubcategory,
  defaultClearances,
  defaultFootprint,
  defaultLayer,
  taxonomyPromptList,
  FALLBACK_SUBCATEGORY_ID,
} from './taxonomy.js';
import { MM_PER_INCH } from './units.js';

describe('taxonomy structure', () => {
  it('has unique category ids', () => {
    const ids = TAXONOMY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The short-form lookup in findSubcategory relies on this, and the AI
   * extraction step returns a bare subcategory id. If two categories ever share
   * a subcategory id, lookups start silently resolving to the wrong one.
   */
  it('has subcategory ids that are unique across every category', () => {
    const duplicates = ALL_SUBCATEGORY_IDS.filter(
      (id, i) => ALL_SUBCATEGORY_IDS.indexOf(id) !== i,
    );
    expect(duplicates).toEqual([]);
  });

  it('gives every category at least one subcategory', () => {
    for (const category of TAXONOMY) {
      expect(category.subcategories.length).toBeGreaterThan(0);
    }
  });

  it('has non-negative integer clearances everywhere', () => {
    for (const category of TAXONOMY) {
      for (const sub of category.subcategories) {
        for (const [side, value] of Object.entries(sub.clearances)) {
          expect(Number.isInteger(value), `${sub.id}.${side} is not an integer`).toBe(true);
          expect(value, `${sub.id}.${side} is negative`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('has positive typical dimensions where provided', () => {
    for (const category of TAXONOMY) {
      for (const sub of category.subcategories) {
        if (!sub.typical) continue;
        expect(sub.typical.w, `${sub.id}.w`).toBeGreaterThan(0);
        expect(sub.typical.d, `${sub.id}.d`).toBeGreaterThan(0);
        expect(sub.typical.h, `${sub.id}.h`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps L-shaped notch ratios inside the bounding box', () => {
    for (const category of TAXONOMY) {
      for (const sub of category.subcategories) {
        if (sub.defaultFootprint.kind !== 'L') continue;
        const { notchW, notchD } = sub.defaultFootprint;
        expect(notchW).toBeGreaterThan(0);
        expect(notchW).toBeLessThan(1);
        expect(notchD).toBeGreaterThan(0);
        expect(notchD).toBeLessThan(1);
      }
    }
  });
});

describe('lookups', () => {
  it('finds a subcategory by bare id', () => {
    const hit = findSubcategory('sofa');
    expect(hit?.category.id).toBe('seating');
    expect(hit?.subcategory.label).toBe('Sofa');
  });

  it('finds a subcategory by category/sub pair', () => {
    expect(findSubcategory('sofa', 'seating')?.subcategory.id).toBe('sofa');
  });

  it('falls back to the bare id when the category is wrong', () => {
    // The model sometimes pairs the right subcategory with the wrong parent.
    expect(findSubcategory('sofa', 'tables')?.subcategory.id).toBe('sofa');
  });

  it('returns null for an unknown id', () => {
    expect(findSubcategory('hovercraft')).toBeNull();
  });
});

describe('defaults', () => {
  it('returns a real clearance for a known subcategory', () => {
    expect(defaultClearances('sofa').front).toBe(Math.round(18 * MM_PER_INCH));
  });

  it('gives a dining table clearance on all four sides', () => {
    const c = defaultClearances('dining-table');
    expect(c.front).toBeGreaterThan(0);
    expect(c.back).toBeGreaterThan(0);
    expect(c.left).toBeGreaterThan(0);
    expect(c.right).toBeGreaterThan(0);
  });

  /**
   * An unrecognized id must not invent constraints the user never asked for —
   * a mystery item should place freely, not light up as a clearance violation.
   */
  it('returns all-zero clearances for an unknown subcategory', () => {
    expect(defaultClearances('hovercraft')).toEqual({
      front: 0,
      back: 0,
      left: 0,
      right: 0,
    });
  });

  it('does not hand out a shared mutable clearance object', () => {
    const a = defaultClearances('hovercraft');
    a.front = 999;
    expect(defaultClearances('hovercraft').front).toBe(0);
  });

  it('defaults an unknown subcategory to a rect on the floor', () => {
    expect(defaultFootprint('hovercraft')).toEqual({ kind: 'rect' });
    expect(defaultLayer('hovercraft')).toBe('floor');
  });

  it('puts rugs and wall pieces on their own layers', () => {
    expect(defaultLayer('area-rug')).toBe('rug');
    expect(defaultLayer('mirror')).toBe('wall');
    expect(defaultLayer('table-lamp')).toBe('onTop');
    expect(defaultLayer('pendant')).toBe('ceiling');
  });

  it('exposes a resolvable fallback subcategory', () => {
    expect(findSubcategory(FALLBACK_SUBCATEGORY_ID)).not.toBeNull();
  });
});

describe('prompt list', () => {
  it('lists every subcategory id exactly once', () => {
    const text = taxonomyPromptList();
    for (const id of ALL_SUBCATEGORY_IDS) {
      expect(text).toContain(id);
    }
    expect(text.split('\n').length).toBe(TAXONOMY.length);
  });
});
