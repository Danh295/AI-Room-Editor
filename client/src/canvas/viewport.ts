import { create } from 'zustand';
import type { Pt } from '@room/shared';
import { boundsOf } from '@room/shared';

/**
 * Pan and zoom, kept out of the project store on purpose: where you're looking
 * is not part of the document, shouldn't be undoable, and shouldn't mark the
 * file dirty.
 *
 * `scale` is screen pixels per millimeter. A 4-metre wall at scale 0.05 is
 * 200px across, which is roughly the default framing for a room.
 */
export interface ViewportState {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;

  setSize: (width: number, height: number) => void;
  setPan: (x: number, y: number) => void;
  zoomAt: (screenPoint: Pt, factor: number) => void;
  fitTo: (points: Pt[], paddingPx?: number) => void;
  reset: () => void;
}

const MIN_SCALE = 0.002; // ~500mm per pixel — a whole house
const MAX_SCALE = 2; // 0.5mm per pixel — joinery detail
const DEFAULT_SCALE = 0.05;

export const useViewport = create<ViewportState>((set, get) => ({
  scale: DEFAULT_SCALE,
  x: 80,
  y: 80,
  width: 800,
  height: 600,

  setSize(width, height) {
    set({ width, height });
  },

  setPan(x, y) {
    set({ x, y });
  },

  /**
   * Zoom about a fixed screen point, so the world position under the cursor
   * stays under the cursor. Without this the plan slides away from wherever
   * you were looking as you scroll.
   */
  zoomAt(screenPoint, factor) {
    const { scale, x, y } = get();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    if (next === scale) return;

    const worldX = (screenPoint.x - x) / scale;
    const worldY = (screenPoint.y - y) / scale;

    set({
      scale: next,
      x: screenPoint.x - worldX * next,
      y: screenPoint.y - worldY * next,
    });
  },

  fitTo(points, paddingPx = 60) {
    const { width, height } = get();
    const bounds = boundsOf(points);
    if (!bounds) {
      set({ scale: DEFAULT_SCALE, x: paddingPx, y: paddingPx });
      return;
    }

    const worldW = Math.max(1, bounds.maxX - bounds.minX);
    const worldH = Math.max(1, bounds.maxY - bounds.minY);
    const usableW = Math.max(1, width - paddingPx * 2);
    const usableH = Math.max(1, height - paddingPx * 2);

    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(usableW / worldW, usableH / worldH)));

    // Centre the content in the viewport at the chosen scale.
    set({
      scale,
      x: (width - worldW * scale) / 2 - bounds.minX * scale,
      y: (height - worldH * scale) / 2 - bounds.minY * scale,
    });
  },

  reset() {
    set({ scale: DEFAULT_SCALE, x: 80, y: 80 });
  },
}));

/** Screen pixels -> world millimeters. */
export function toWorld(screen: Pt, vp: { scale: number; x: number; y: number }): Pt {
  return { x: (screen.x - vp.x) / vp.scale, y: (screen.y - vp.y) / vp.scale };
}

/** World millimeters -> screen pixels. */
export function toScreen(world: Pt, vp: { scale: number; x: number; y: number }): Pt {
  return { x: world.x * vp.scale + vp.x, y: world.y * vp.scale + vp.y };
}

/** How many world millimeters a screen pixel covers — for hit tolerances. */
export function mmPerPixel(scale: number): number {
  return 1 / scale;
}

/** The world rectangle currently visible, for culling grid lines. */
export function visibleWorldRect(vp: ViewportState): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const topLeft = toWorld({ x: 0, y: 0 }, vp);
  const bottomRight = toWorld({ x: vp.width, y: vp.height }, vp);
  return {
    minX: topLeft.x,
    minY: topLeft.y,
    maxX: bottomRight.x,
    maxY: bottomRight.y,
  };
}
