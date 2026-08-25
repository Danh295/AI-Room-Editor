/**
 * The domain model, shared verbatim between client and server.
 *
 * Invariant: every length is an **integer number of millimeters**. Angles are
 * degrees, clockwise, with 0 pointing along +X. The 2D plan uses screen-style
 * axes — +X right, +Y down — so that canvas coordinates and world coordinates
 * differ only by scale and pan, never by a flip.
 */

import type { UnitSystem } from './units.js';

export type { UnitSystem };

export interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Room geometry
// ---------------------------------------------------------------------------

/**
 * Walls reference vertices by id rather than embedding coordinates, so dragging
 * one corner moves every wall meeting at it without a reconciliation pass.
 */
export interface Wall {
  id: string;
  a: string;
  b: string;
  /** Wall thickness in mm, drawn centered on the a-b line. */
  thickness: number;
}

export type OpeningKind = 'door' | 'window' | 'opening';

export interface DoorSwing {
  /** Which end of the wall the hinge sits at. */
  hinge: 'a' | 'b';
  /** Which side of the wall the leaf sweeps into. */
  into: 'in' | 'out';
  /** Sweep in degrees; 90 is a standard door. */
  angle: number;
}

export interface Opening {
  id: string;
  wallId: string;
  /** Distance in mm from the wall's `a` vertex to the near edge of the opening. */
  offset: number;
  width: number;
  kind: OpeningKind;
  /** Height of the opening itself, mm. Used by the 3D view. */
  height?: number;
  /** Height of the sill above the floor, mm. Windows only. */
  sillHeight?: number;
  /** Present for doors; drives both the plan arc and clearance checking. */
  swing?: DoorSwing;
}

/**
 * A reference image sitting behind the plan — a photographed or AI-traced floor
 * plan you correct against. `scaleMmPerPx` is what converts it to world units;
 * it comes from the AI's estimate or from clicking two points of known distance.
 */
export interface Underlay {
  assetId: string;
  scaleMmPerPx: number;
  /** World position of the image's top-left corner, mm. */
  origin: Pt;
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface Room {
  /** Keyed by vertex id. */
  vertices: Record<string, Pt>;
  walls: Wall[];
  openings: Opening[];
  /** Floor-to-ceiling height in mm; used by the 3D preview. */
  ceilingHeight: number;
  underlay?: Underlay;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * An item's plan-view outline.
 *
 * `rect` covers the overwhelming majority. `L` handles sectionals and corner
 * desks by notching one corner out of the bounding box. `poly` is the escape
 * hatch, stored normalized to 0..1 of the bounding box so it survives a resize.
 */
export type Footprint =
  | { kind: 'rect' }
  | { kind: 'L'; notchW: number; notchD: number; corner: 'nw' | 'ne' | 'sw' | 'se' }
  | { kind: 'poly'; points: Pt[] };

/** Space an item needs around it to be usable: walkway, drawer pull, seat exit. */
export interface Clearances {
  front: number;
  back: number;
  left: number;
  right: number;
}

export interface Variant {
  id: string;
  label: string;
  /** Swatch color, `#rrggbb`. Drives both the 2D fill and the 3D material. */
  hex: string;
  material?: string;
  imageAssetId?: string;
  price?: number;
}

export type Confidence = 'high' | 'medium' | 'low' | 'manual';

/** Where an item's data came from, so a suspicious dimension is traceable. */
export interface Provenance {
  method: 'url' | 'model' | 'photo' | 'query' | 'manual';
  /** Source URLs the model cited. */
  citations: string[];
  capturedAt: string;
  /** Free-text note from the model about conflicts between sources. */
  note?: string;
}

/**
 * A product in your library — the reusable definition, not a placement.
 * `w` is width across the front, `d` is depth front-to-back, `h` is height.
 */
export interface LibraryItem {
  id: string;
  name: string;
  brand?: string;
  modelNumber?: string;
  categoryId: string;
  subcategoryId: string;

  w: number;
  d: number;
  h: number;
  /** Seat height, for chairs and sofas. Optional, mm. */
  seatHeight?: number;

  footprint: Footprint;
  clearances: Clearances;
  variants: Variant[];

  price?: number;
  currency?: string;
  sourceUrl?: string;
  imageAssetId?: string;

  confidence: Confidence;
  provenance: Provenance;
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stacking order. A rug has to render under a coffee table in plan and sit at
 * floor level in 3D; a table lamp has to render over the console it stands on.
 */
export type Layer = 'rug' | 'floor' | 'onTop' | 'wall' | 'ceiling';

export const LAYER_ORDER: Record<Layer, number> = {
  rug: 0,
  floor: 1,
  onTop: 2,
  wall: 3,
  ceiling: 4,
};

/**
 * An instance of a library item placed in a room.
 *
 * Dimension and clearance fields are optional overrides; when absent the
 * library item's values apply. This keeps "I trimmed 2 inches off this one
 * shelf" from mutating the catalog entry every other placement shares.
 */
export interface PlacedItem {
  id: string;
  libraryId: string;

  /** Center of the bounding box, mm. */
  x: number;
  y: number;
  /** Degrees clockwise about the center. */
  rotation: number;
  /** Height off the floor, mm — a wall shelf or a lamp on a table. */
  z: number;

  w?: number;
  d?: number;
  h?: number;
  footprint?: Footprint;
  clearances?: Partial<Clearances>;
  variantId?: string;

  flipX: boolean;
  locked: boolean;
  layer: Layer;
  notes?: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type ItemRenderMode = 'icon' | 'photo' | 'both';

export interface ProjectSettings {
  units: UnitSystem;
  /** Snap grid step, mm. */
  gridStep: number;
  snapToGrid: boolean;
  snapToWalls: boolean;
  showGrid: boolean;
  showDimensions: boolean;
  showClearances: boolean;
  itemRender: ItemRenderMode;
  defaultWallThickness: number;
}

export interface Project {
  id: string;
  name: string;
  settings: ProjectSettings;
  room: Room;
  items: PlacedItem[];
  createdAt: string;
  updatedAt: string;
}

/** What `GET /api/projects` returns — enough to render a picker, no geometry. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// AI ingestion wire types
// ---------------------------------------------------------------------------

/** One value plus how much the model trusts it and where it came from. */
export interface Sourced<T> {
  value: T;
  confidence: Confidence;
  /** The literal text the model read it from, for the review card. */
  citedText?: string;
  sourceUrl?: string;
}

export type IngestRequest =
  | { method: 'url'; url: string }
  | { method: 'model'; modelNumber: string; brand?: string }
  | { method: 'query'; query: string }
  | { method: 'photo'; imageBase64: string; mediaType: string; hint?: string };

/**
 * The reviewable result of an ingestion. Deliberately not a LibraryItem: it is
 * a proposal with per-field confidence that a human edits and confirms before
 * anything enters the library.
 */
export interface ProductDraft {
  name: Sourced<string>;
  brand?: Sourced<string>;
  modelNumber?: Sourced<string>;
  categoryId: Sourced<string>;
  subcategoryId: Sourced<string>;
  w: Sourced<number>;
  d: Sourced<number>;
  h: Sourced<number>;
  seatHeight?: Sourced<number>;
  price?: Sourced<number>;
  currency?: string;
  footprint: Footprint;
  variants: Variant[];
  clearances: Clearances;
  imageAssetId?: string;
  sourceUrl?: string;
  provenance: Provenance;
  /** Conflicts or gaps worth showing above the form. */
  warnings: string[];
}

export interface FloorplanTraceResult {
  /** Wall loop in image pixel space; the client maps it to world mm. */
  polygonPx: Pt[];
  openings: {
    kind: OpeningKind;
    /** Midpoint in image pixel space. */
    atPx: Pt;
    widthPx: number;
  }[];
  /** null when nothing legible was found — the client then asks for two points. */
  scaleMmPerPx: number | null;
  /** Dimension strings read off the drawing, for the user to sanity-check. */
  readDimensions: string[];
  confidence: Confidence;
  warnings: string[];
}

export interface LayoutSuggestion {
  placements: {
    itemId: string;
    x: number;
    y: number;
    rotation: number;
  }[];
  rationale: string;
  warnings: string[];
}
