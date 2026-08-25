import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import type Konva from 'konva';
import type { Pt } from '@room/shared';
import {
  distance,
  moveVertex,
  roomPolygon,
  addOpeningNearPoint,
  MM_PER_INCH,
} from '@room/shared';
import { useEditor } from '../store/editorStore.js';
import { useViewport, toWorld, mmPerPixel } from './viewport.js';
import { snapPoint, nearestWall, type SnapResult } from './snapping.js';
import {
  GridLayer,
  FloorLayer,
  WallLayer,
  VertexLayer,
  OpeningLayer,
  DimensionLayer,
  DraftLayer,
  SnapMarker,
} from './layers.js';

/** Snap radius in screen pixels, converted to world units per zoom level. */
const SNAP_PX = 12;
/** How close to the first point you must be for a click to close the loop. */
const CLOSE_PX = 14;

const DEFAULT_DOOR_WIDTH = Math.round(32 * MM_PER_INCH);
const DEFAULT_WINDOW_WIDTH = Math.round(36 * MM_PER_INCH);

export interface PlanCanvasProps {
  /** Opens the length editor for a wall; owned by the parent so it can render UI. */
  onEditWallLength: (wallId: string) => void;
}

export default function PlanCanvas({ onEditWallLength }: PlanCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const draft = useEditor((s) => s.draft);
  const edit = useEditor((s) => s.edit);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const beginGesture = useEditor((s) => s.beginGesture);
  const endGesture = useEditor((s) => s.endGesture);
  const draftStart = useEditor((s) => s.draftStart);
  const draftAdd = useEditor((s) => s.draftAdd);
  const draftHover = useEditor((s) => s.draftHover);
  const draftFinish = useEditor((s) => s.draftFinish);
  const setTool = useEditor((s) => s.setTool);

  const vp = useViewport();
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const panning = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  const room = project?.room;
  const settings = project?.settings;

  // Keep the stage the size of its container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      useViewport.getState().setSize(width, height);
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    useViewport.getState().setSize(rect.width, rect.height);
    return () => observer.disconnect();
  }, []);

  // Track shift for orthogonal locking without re-rendering on every mousemove.
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Shift' && setShiftHeld(true);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toleranceMm = useMemo(() => SNAP_PX * mmPerPixel(vp.scale), [vp.scale]);

  /** Pointer position in world millimeters, with snapping applied. */
  const resolvePointer = useCallback((): { raw: Pt; snapped: SnapResult } | null => {
    const stage = stageRef.current;
    if (!stage || !room || !settings) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;

    const raw = toWorld(pointer, vp);
    const from = draft?.points[draft.points.length - 1] ?? null;

    const snapped = snapPoint(raw, {
      room,
      gridStep: settings.gridStep,
      snapToGrid: settings.snapToGrid,
      from,
      ortho: shiftHeld,
      toleranceMm,
    });

    return { raw, snapped };
  }, [room, settings, vp, draft, shiftHeld, toleranceMm]);

  // ------------------------------------------------------------ interaction

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    // Trackpads report small deltas and mice large ones; a fixed ratio per
    // event feels wrong on both, so scale by the magnitude.
    const factor = Math.exp(-e.evt.deltaY * 0.0015);
    useViewport.getState().zoomAt(pointer, factor);
  }, []);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle button, or space-less right-drag, pans regardless of tool.
      if (e.evt.button === 1 || e.evt.button === 2) {
        e.evt.preventDefault();
        panning.current = {
          startX: e.evt.clientX,
          startY: e.evt.clientY,
          originX: vp.x,
          originY: vp.y,
        };
        return;
      }
      if (e.evt.button !== 0) return;

      const resolved = resolvePointer();
      if (!resolved || !room || !settings) return;
      const point = resolved.snapped.point;

      if (tool === 'wall') {
        if (!draft) {
          draftStart(point);
          return;
        }
        // Clicking the first point again closes the loop.
        const first = draft.points[0];
        if (first && draft.points.length >= 3) {
          const closePx = distance(point, first) * vp.scale;
          if (closePx <= CLOSE_PX) {
            draftFinish(true);
            return;
          }
        }
        draftAdd(point);
        return;
      }

      if (tool === 'door' || tool === 'window') {
        const hit = nearestWall(room, resolved.raw, toleranceMm * 3);
        if (!hit) return;
        const width = tool === 'door' ? DEFAULT_DOOR_WIDTH : DEFAULT_WINDOW_WIDTH;
        edit((d) => {
          addOpeningNearPoint(d.room, hit.point, { kind: tool, width }, toleranceMm * 3);
        });
        return;
      }

      // Select tool: a click on empty canvas clears the selection.
      if (e.target === e.target.getStage()) select([]);
    },
    [tool, draft, room, settings, resolvePointer, draftStart, draftAdd, draftFinish, edit, select, vp, toleranceMm],
  );

  const handleMouseMove = useCallback(() => {
    if (panning.current) return;
    const resolved = resolvePointer();
    if (!resolved) return;
    setSnap(resolved.snapped);
    if (draft) draftHover(resolved.snapped.point);
  }, [resolvePointer, draft, draftHover]);

  // Panning is tracked on the window so the drag survives leaving the canvas.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const pan = panning.current;
      if (!pan) return;
      useViewport
        .getState()
        .setPan(pan.originX + (e.clientX - pan.startX), pan.originY + (e.clientY - pan.startY));
    }
    function onUp() {
      panning.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Enter finishes an open chain, Escape abandons it, Backspace drops a point.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const state = useEditor.getState();
      if (e.key === 'Escape') {
        if (state.draft) state.draftCancel();
        else state.setTool('select');
      } else if (e.key === 'Enter' && state.draft) {
        e.preventDefault();
        state.draftFinish(false);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && state.draft) {
        e.preventDefault();
        state.draftUndoPoint();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleVertexDragMove = useCallback(
    (vertexId: string, point: Pt) => {
      if (!room || !settings) return;
      const snapped = snapPoint(point, {
        room,
        gridStep: settings.gridStep,
        snapToGrid: settings.snapToGrid,
        toleranceMm,
        exclude: new Set([vertexId]),
      });
      edit((d) => {
        moveVertex(d.room, vertexId, snapped.point);
      });
    },
    [room, settings, edit, toleranceMm],
  );

  const willClose = useMemo(() => {
    if (!draft || draft.points.length < 3 || !draft.hover) return false;
    const first = draft.points[0]!;
    return distance(draft.hover, first) * vp.scale <= CLOSE_PX;
  }, [draft, vp.scale]);

  if (!project || !room || !settings) return null;

  const cursor =
    tool === 'wall' ? 'crosshair' : tool === 'select' ? 'default' : 'copy';

  return (
    <div ref={containerRef} className="canvas-host" style={{ cursor }}>
      <Stage
        ref={stageRef}
        width={vp.width}
        height={vp.height}
        scaleX={vp.scale}
        scaleY={vp.scale}
        x={vp.x}
        y={vp.y}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setSnap(null);
          draftHover(null);
        }}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <Layer listening={false}>
          {settings.showGrid && <GridLayer vp={vp} step={settings.gridStep} />}
          <FloorLayer room={room} />
        </Layer>

        <Layer>
          <WallLayer
            room={room}
            vp={vp}
            selection={selection}
            onWallClick={(wallId, e) => toggleSelect(wallId, e.evt.shiftKey)}
            onWallDblClick={onEditWallLength}
          />
          <OpeningLayer
            room={room}
            vp={vp}
            selection={selection}
            onClick={(id) => select([id])}
          />
          {tool === 'select' && (
            <VertexLayer
              room={room}
              vp={vp}
              selection={selection}
              onDragStart={beginGesture}
              onDragMove={handleVertexDragMove}
              onDragEnd={endGesture}
            />
          )}
        </Layer>

        <Layer listening={false}>
          {settings.showDimensions && (
            <DimensionLayer room={room} vp={vp} units={settings.units} />
          )}
          {draft && (
            <DraftLayer
              points={draft.points}
              hover={draft.hover}
              vp={vp}
              units={settings.units}
              thickness={settings.defaultWallThickness}
              willClose={willClose}
            />
          )}
          {tool !== 'select' && snap && (
            <SnapMarker point={snap.point} vp={vp} kind={snap.kind} />
          )}
        </Layer>
      </Stage>

      {tool === 'wall' && (
        <div className="canvas-hint">
          Click to place corners · <b>Shift</b> locks to 90° · click the first point or press{' '}
          <b>Enter</b> to finish · <b>Esc</b> cancels
        </div>
      )}
      {(tool === 'door' || tool === 'window') && (
        <div className="canvas-hint">Click a wall to place a {tool} · <b>Esc</b> to stop</div>
      )}
    </div>
  );
}

/** Frame the room in the viewport; exported so the toolbar can call it. */
export function fitRoomToView(): void {
  const project = useEditor.getState().project;
  if (!project) return;
  const polygon = roomPolygon(project.room);
  useViewport.getState().fitTo(polygon);
}
