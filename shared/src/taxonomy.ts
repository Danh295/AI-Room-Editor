/**
 * Furniture taxonomy and the clearance rules that go with it.
 *
 * Clearance values are the space a piece needs around it to actually be usable
 * — the walkway in front of a sofa, the pull-out room for a drawer, the space
 * to slide a dining chair back and stand up. They're drawn from common
 * residential design guidance and are starting points a user can override
 * per item; the point is that a plan flags "this fits, but you can't open the
 * dresser" before you buy the dresser.
 *
 * All distances are millimeters. The inch values they were derived from are in
 * the comments, since that's how the guidance is written.
 */

import type { Clearances, Footprint } from './types.js';

const IN = 25.4;
const inches = (n: number): number => Math.round(n * IN);

export interface Subcategory {
  id: string;
  label: string;
  /** Space needed around the piece to use it. */
  clearances: Clearances;
  /** Starting outline for a manually-entered item of this kind. */
  defaultFootprint: Footprint;
  /** Which plan layer new items land on. */
  defaultLayer: 'rug' | 'floor' | 'onTop' | 'wall' | 'ceiling';
  /** Rough dimensions (w, d, h in mm) to prefill the manual form. */
  typical?: { w: number; d: number; h: number };
  /** Why the clearance is what it is — surfaced as a tooltip in the UI. */
  clearanceNote?: string;
}

export interface Category {
  id: string;
  label: string;
  /** lucide-react icon name. */
  icon: string;
  subcategories: Subcategory[];
}

/** Nothing needs room around it. Rugs, decor, anything purely visual. */
const NONE: Clearances = { front: 0, back: 0, left: 0, right: 0 };

/** Only the front matters: a walkway or a viewing distance. */
const front = (n: number): Clearances => ({ front: inches(n), back: 0, left: 0, right: 0 });

export const TAXONOMY: Category[] = [
  {
    id: 'seating',
    label: 'Seating',
    icon: 'Armchair',
    subcategories: [
      {
        id: 'sofa',
        label: 'Sofa',
        clearances: front(18),
        clearanceNote: '18" walkway in front — enough to pass between sofa and coffee table.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(84), d: inches(38), h: inches(34) },
      },
      {
        id: 'sectional',
        label: 'Sectional',
        clearances: front(18),
        clearanceNote: '18" walkway in front.',
        defaultFootprint: { kind: 'L', notchW: 0.45, notchD: 0.45, corner: 'ne' },
        defaultLayer: 'floor',
        typical: { w: inches(110), d: inches(90), h: inches(34) },
      },
      {
        id: 'loveseat',
        label: 'Loveseat',
        clearances: front(18),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(58), d: inches(36), h: inches(34) },
      },
      {
        id: 'armchair',
        label: 'Armchair',
        clearances: front(18),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(33), d: inches(35), h: inches(32) },
      },
      {
        id: 'dining-chair',
        label: 'Dining chair',
        clearances: { front: 0, back: inches(36), left: 0, right: 0 },
        clearanceNote: '36" behind — room to slide the chair back and stand up.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(19), d: inches(21), h: inches(36) },
      },
      {
        id: 'office-chair',
        label: 'Office chair',
        clearances: { front: 0, back: inches(36), left: 0, right: 0 },
        clearanceNote: '36" behind for roll-back.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(26), d: inches(26), h: inches(40) },
      },
      {
        id: 'stool',
        label: 'Stool / bench',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(17), d: inches(17), h: inches(26) },
      },
    ],
  },
  {
    id: 'tables',
    label: 'Tables',
    icon: 'Table',
    subcategories: [
      {
        id: 'dining-table',
        label: 'Dining table',
        clearances: {
          front: inches(36),
          back: inches(36),
          left: inches(36),
          right: inches(36),
        },
        clearanceNote: '36" on every side — chairs pull out on all four.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(72), d: inches(36), h: inches(30) },
      },
      {
        id: 'coffee-table',
        label: 'Coffee table',
        clearances: { front: inches(16), back: inches(16), left: 0, right: 0 },
        clearanceNote: '16" to the sofa — close enough to reach, wide enough to pass.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(48), d: inches(24), h: inches(18) },
      },
      {
        id: 'side-table',
        label: 'Side / end table',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(22), d: inches(22), h: inches(24) },
      },
      {
        id: 'console',
        label: 'Console table',
        clearances: front(30),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(48), d: inches(15), h: inches(30) },
      },
      {
        id: 'desk',
        label: 'Desk',
        clearances: { front: inches(36), back: 0, left: 0, right: 0 },
        clearanceNote: '36" in front for the chair.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(60), d: inches(30), h: inches(30) },
      },
      {
        id: 'nightstand',
        label: 'Nightstand',
        clearances: front(24),
        clearanceNote: '24" in front — drawer pull-out plus standing room.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(22), d: inches(18), h: inches(26) },
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: 'Archive',
    subcategories: [
      {
        id: 'dresser',
        label: 'Dresser',
        clearances: front(36),
        clearanceNote: '36" in front — a drawer is ~20" deep, plus room to stand.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(60), d: inches(18), h: inches(32) },
      },
      {
        id: 'wardrobe',
        label: 'Wardrobe / armoire',
        clearances: front(36),
        clearanceNote: '36" in front for the door swing.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(48), d: inches(24), h: inches(78) },
      },
      {
        id: 'bookshelf',
        label: 'Bookshelf',
        clearances: front(30),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(32), d: inches(12), h: inches(72) },
      },
      {
        id: 'media-unit',
        label: 'Media unit / TV stand',
        clearances: front(30),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(60), d: inches(16), h: inches(24) },
      },
      {
        id: 'cabinet',
        label: 'Cabinet / sideboard',
        clearances: front(36),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(60), d: inches(18), h: inches(34) },
      },
      {
        id: 'shelf-wall',
        label: 'Wall shelf',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'wall',
        typical: { w: inches(36), d: inches(10), h: inches(2) },
      },
    ],
  },
  {
    id: 'beds',
    label: 'Beds',
    icon: 'BedDouble',
    subcategories: [
      {
        id: 'bed-king',
        label: 'King bed',
        clearances: { front: inches(36), back: 0, left: inches(24), right: inches(24) },
        clearanceNote: '24" each side to get in and make it; 36" at the foot to walk past.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(76), d: inches(80), h: inches(24) },
      },
      {
        id: 'bed-queen',
        label: 'Queen bed',
        clearances: { front: inches(36), back: 0, left: inches(24), right: inches(24) },
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(60), d: inches(80), h: inches(24) },
      },
      {
        id: 'bed-full',
        label: 'Full / double bed',
        clearances: { front: inches(36), back: 0, left: inches(24), right: inches(24) },
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(54), d: inches(75), h: inches(24) },
      },
      {
        id: 'bed-twin',
        label: 'Twin bed',
        clearances: { front: inches(36), back: 0, left: inches(24), right: 0 },
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(38), d: inches(75), h: inches(24) },
      },
      {
        id: 'crib',
        label: 'Crib',
        clearances: front(30),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(52), d: inches(28), h: inches(36) },
      },
    ],
  },
  {
    id: 'lighting',
    label: 'Lighting',
    icon: 'Lamp',
    subcategories: [
      {
        id: 'floor-lamp',
        label: 'Floor lamp',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(16), d: inches(16), h: inches(62) },
      },
      {
        id: 'table-lamp',
        label: 'Table lamp',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'onTop',
        typical: { w: inches(14), d: inches(14), h: inches(24) },
      },
      {
        id: 'pendant',
        label: 'Pendant / chandelier',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'ceiling',
        typical: { w: inches(20), d: inches(20), h: inches(18) },
      },
      {
        id: 'sconce',
        label: 'Wall sconce',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'wall',
        typical: { w: inches(6), d: inches(6), h: inches(12) },
      },
    ],
  },
  {
    id: 'rugs',
    label: 'Rugs',
    icon: 'Square',
    subcategories: [
      {
        id: 'area-rug',
        label: 'Area rug',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'rug',
        typical: { w: inches(96), d: inches(120), h: 10 },
      },
      {
        id: 'runner',
        label: 'Runner',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'rug',
        typical: { w: inches(30), d: inches(96), h: 10 },
      },
    ],
  },
  {
    id: 'appliances',
    label: 'Appliances',
    icon: 'Refrigerator',
    subcategories: [
      {
        id: 'refrigerator',
        label: 'Refrigerator',
        clearances: front(42),
        clearanceNote: '42" in front — door swing plus room to stand and load.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(36), d: inches(31), h: inches(70) },
      },
      {
        id: 'range',
        label: 'Range / oven',
        clearances: front(42),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(30), d: inches(26), h: inches(36) },
      },
      {
        id: 'dishwasher',
        label: 'Dishwasher',
        clearances: front(42),
        clearanceNote: '42" in front — the door drops down and the rack slides out.',
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(24), d: inches(24), h: inches(34) },
      },
      {
        id: 'washer-dryer',
        label: 'Washer / dryer',
        clearances: front(36),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(27), d: inches(31), h: inches(39) },
      },
      {
        id: 'tv',
        label: 'Television',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'onTop',
        typical: { w: inches(57), d: inches(3), h: inches(33) },
      },
    ],
  },
  {
    id: 'decor',
    label: 'Decor',
    icon: 'Flower2',
    subcategories: [
      {
        id: 'plant',
        label: 'Plant',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(20), d: inches(20), h: inches(48) },
      },
      {
        id: 'mirror',
        label: 'Mirror',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'wall',
        typical: { w: inches(30), d: inches(2), h: inches(40) },
      },
      {
        id: 'art',
        label: 'Art / wall hanging',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'wall',
        typical: { w: inches(24), d: inches(2), h: inches(36) },
      },
      {
        id: 'other-decor',
        label: 'Other',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'onTop',
        typical: { w: inches(12), d: inches(12), h: inches(12) },
      },
    ],
  },
  {
    id: 'outdoor',
    label: 'Outdoor',
    icon: 'TreePine',
    subcategories: [
      {
        id: 'patio-seating',
        label: 'Patio seating',
        clearances: front(18),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(60), d: inches(32), h: inches(32) },
      },
      {
        id: 'patio-table',
        label: 'Patio table',
        clearances: {
          front: inches(36),
          back: inches(36),
          left: inches(36),
          right: inches(36),
        },
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(48), d: inches(48), h: inches(29) },
      },
      {
        id: 'grill',
        label: 'Grill',
        clearances: front(36),
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(52), d: inches(26), h: inches(48) },
      },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    icon: 'Box',
    subcategories: [
      {
        id: 'uncategorized',
        label: 'Uncategorized',
        clearances: NONE,
        defaultFootprint: { kind: 'rect' },
        defaultLayer: 'floor',
        typical: { w: inches(24), d: inches(24), h: inches(24) },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const SUBCATEGORY_INDEX = new Map<string, { category: Category; subcategory: Subcategory }>();
for (const category of TAXONOMY) {
  for (const subcategory of category.subcategories) {
    SUBCATEGORY_INDEX.set(`${category.id}/${subcategory.id}`, { category, subcategory });
    // Subcategory ids are unique across the whole taxonomy, so allow the short
    // form too — the AI extraction step returns a bare subcategory id.
    SUBCATEGORY_INDEX.set(subcategory.id, { category, subcategory });
  }
}

export const FALLBACK_CATEGORY_ID = 'other';
export const FALLBACK_SUBCATEGORY_ID = 'uncategorized';

export function findSubcategory(
  subcategoryId: string,
  categoryId?: string,
): { category: Category; subcategory: Subcategory } | null {
  const key = categoryId ? `${categoryId}/${subcategoryId}` : subcategoryId;
  return SUBCATEGORY_INDEX.get(key) ?? SUBCATEGORY_INDEX.get(subcategoryId) ?? null;
}

/**
 * Clearances for a subcategory, or all-zero when the id isn't recognized.
 * Unknown ids come back from the model occasionally; defaulting to zero means a
 * mystery item never invents constraints the user didn't ask for.
 */
export function defaultClearances(subcategoryId: string): Clearances {
  return findSubcategory(subcategoryId)?.subcategory.clearances ?? { ...NONE };
}

export function defaultFootprint(subcategoryId: string): Footprint {
  return findSubcategory(subcategoryId)?.subcategory.defaultFootprint ?? { kind: 'rect' };
}

export function defaultLayer(subcategoryId: string): Subcategory['defaultLayer'] {
  return findSubcategory(subcategoryId)?.subcategory.defaultLayer ?? 'floor';
}

/** Flat list of every valid subcategory id — used to constrain the AI's output. */
export const ALL_SUBCATEGORY_IDS: string[] = TAXONOMY.flatMap((c) =>
  c.subcategories.map((s) => s.id),
);

/** A compact `category/subcategory` listing for the extraction prompt. */
export function taxonomyPromptList(): string {
  return TAXONOMY.map(
    (c) => `${c.id}: ${c.subcategories.map((s) => s.id).join(', ')}`,
  ).join('\n');
}
