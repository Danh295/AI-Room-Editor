/**
 * Top-down glyphs, drawn in normalized footprint space.
 *
 * Every icon is described in a 0..1 box where x runs left-to-right across the
 * item's width and y runs 0 (front) to 1 (back). Rendering scales that box to
 * the item's real size, so one description works at any dimensions and the
 * glyph never distorts independently of the footprint.
 *
 * Keeping them as plain data rather than SVG means no asset pipeline, no
 * network fetch, and they inherit the item's colour.
 */

export type Stroke =
  | { kind: 'line'; points: number[] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; round?: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'arc'; x: number; y: number; r: number; from: number; to: number };

export interface Glyph {
  strokes: Stroke[];
}

/** Seat with a back along the rear edge and cushion divisions. */
function seating(cushions: number, arms = true): Glyph {
  const strokes: Stroke[] = [
    // Backrest band across the back.
    { kind: 'rect', x: 0.04, y: 0.7, w: 0.92, h: 0.26, round: 0.03 },
  ];
  if (arms) {
    strokes.push({ kind: 'rect', x: 0.04, y: 0.12, w: 0.13, h: 0.6, round: 0.03 });
    strokes.push({ kind: 'rect', x: 0.83, y: 0.12, w: 0.13, h: 0.6, round: 0.03 });
  }
  const left = arms ? 0.17 : 0.04;
  const right = arms ? 0.83 : 0.96;
  const span = right - left;
  for (let i = 1; i < cushions; i += 1) {
    const x = left + (span * i) / cushions;
    strokes.push({ kind: 'line', points: [x, 0.12, x, 0.7] });
  }
  return { strokes };
}

/** Table: outline inset, with an inner line suggesting a top. */
function table(round = false): Glyph {
  return {
    strokes: round
      ? [{ kind: 'circle', x: 0.5, y: 0.5, r: 0.42 }]
      : [{ kind: 'rect', x: 0.08, y: 0.08, w: 0.84, h: 0.84, round: 0.02 }],
  };
}

/** Bed: pillows along the head, a turned-down sheet line across. */
function bed(pillows: number): Glyph {
  const strokes: Stroke[] = [
    { kind: 'line', points: [0.02, 0.68, 0.98, 0.68] },
  ];
  const w = pillows === 1 ? 0.5 : 0.42;
  for (let i = 0; i < pillows; i += 1) {
    const cx = pillows === 1 ? 0.5 : 0.28 + i * 0.44;
    strokes.push({ kind: 'rect', x: cx - w / 2, y: 0.74, w, h: 0.2, round: 0.04 });
  }
  return { strokes };
}

/** Storage: a front face line showing which way the doors or drawers open. */
function storage(divisions = 2): Glyph {
  const strokes: Stroke[] = [
    { kind: 'line', points: [0.02, 0.22, 0.98, 0.22] },
  ];
  for (let i = 1; i < divisions; i += 1) {
    const x = i / divisions;
    strokes.push({ kind: 'line', points: [x, 0.02, x, 0.22] });
  }
  return { strokes };
}

const CIRCLE_ONLY: Glyph = { strokes: [{ kind: 'circle', x: 0.5, y: 0.5, r: 0.36 }] };

const CROSS_HATCH: Glyph = {
  strokes: [
    { kind: 'line', points: [0.1, 0.1, 0.9, 0.9] },
    { kind: 'line', points: [0.9, 0.1, 0.1, 0.9] },
  ],
};

/** Keyed by subcategory id; anything unlisted falls back to a plain footprint. */
const GLYPHS: Record<string, Glyph> = {
  // seating
  sofa: seating(3),
  sectional: seating(3),
  loveseat: seating(2),
  armchair: seating(1),
  'dining-chair': { strokes: [{ kind: 'rect', x: 0.1, y: 0.74, w: 0.8, h: 0.2, round: 0.03 }] },
  'office-chair': {
    strokes: [
      { kind: 'circle', x: 0.5, y: 0.45, r: 0.33 },
      { kind: 'arc', x: 0.5, y: 0.5, r: 0.46, from: 200, to: 340 },
    ],
  },
  stool: CIRCLE_ONLY,

  // tables
  'dining-table': table(),
  'coffee-table': table(),
  'side-table': table(true),
  console: table(),
  desk: {
    strokes: [
      { kind: 'rect', x: 0.06, y: 0.08, w: 0.88, h: 0.84, round: 0.02 },
      { kind: 'line', points: [0.06, 0.3, 0.94, 0.3] },
    ],
  },
  nightstand: storage(1),

  // storage
  dresser: storage(3),
  wardrobe: storage(2),
  bookshelf: {
    strokes: [
      { kind: 'line', points: [0.02, 0.3, 0.98, 0.3] },
      { kind: 'line', points: [0.02, 0.6, 0.98, 0.6] },
    ],
  },
  'media-unit': storage(3),
  cabinet: storage(2),
  'shelf-wall': { strokes: [{ kind: 'line', points: [0.02, 0.5, 0.98, 0.5] }] },

  // beds
  'bed-king': bed(2),
  'bed-queen': bed(2),
  'bed-full': bed(2),
  'bed-twin': bed(1),
  crib: {
    strokes: [
      { kind: 'rect', x: 0.1, y: 0.1, w: 0.8, h: 0.8, round: 0.06 },
      { kind: 'line', points: [0.1, 0.5, 0.9, 0.5] },
    ],
  },

  // lighting
  'floor-lamp': CIRCLE_ONLY,
  'table-lamp': CIRCLE_ONLY,
  pendant: {
    strokes: [
      { kind: 'circle', x: 0.5, y: 0.5, r: 0.4 },
      { kind: 'circle', x: 0.5, y: 0.5, r: 0.14 },
    ],
  },
  sconce: { strokes: [{ kind: 'arc', x: 0.5, y: 0.9, r: 0.42, from: 200, to: 340 }] },

  // rugs
  'area-rug': {
    strokes: [{ kind: 'rect', x: 0.06, y: 0.06, w: 0.88, h: 0.88, round: 0.01 }],
  },
  runner: { strokes: [{ kind: 'rect', x: 0.1, y: 0.05, w: 0.8, h: 0.9, round: 0.01 }] },

  // appliances
  refrigerator: storage(2),
  range: {
    strokes: [
      { kind: 'circle', x: 0.3, y: 0.68, r: 0.14 },
      { kind: 'circle', x: 0.7, y: 0.68, r: 0.14 },
      { kind: 'circle', x: 0.3, y: 0.32, r: 0.14 },
      { kind: 'circle', x: 0.7, y: 0.32, r: 0.14 },
    ],
  },
  dishwasher: storage(1),
  'washer-dryer': { strokes: [{ kind: 'circle', x: 0.5, y: 0.45, r: 0.3 }] },
  tv: { strokes: [{ kind: 'line', points: [0.04, 0.5, 0.96, 0.5] }] },

  // decor
  plant: {
    strokes: [
      { kind: 'circle', x: 0.5, y: 0.5, r: 0.4 },
      { kind: 'circle', x: 0.5, y: 0.5, r: 0.12 },
    ],
  },
  mirror: { strokes: [{ kind: 'line', points: [0.04, 0.5, 0.96, 0.5] }] },
  art: CROSS_HATCH,
  'other-decor': CROSS_HATCH,

  // outdoor
  'patio-seating': seating(2),
  'patio-table': table(true),
  grill: {
    strokes: [
      { kind: 'rect', x: 0.1, y: 0.2, w: 0.8, h: 0.6, round: 0.06 },
      { kind: 'line', points: [0.1, 0.5, 0.9, 0.5] },
    ],
  },
};

export function glyphFor(subcategoryId: string): Glyph | null {
  return GLYPHS[subcategoryId] ?? null;
}

/**
 * Which way the item "faces" matters for the glyph: a sofa's back should sit
 * against the wall it's pushed to. Front is -Y in local space before rotation.
 */
export const FRONT_IS_NEGATIVE_Y = true;
