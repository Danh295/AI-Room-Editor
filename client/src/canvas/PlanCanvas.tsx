import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import type Konva from 'konva';
import type { Pt } from '@room/shared';
import {
  distance,
  moveVertex,
  roomPolygon,
  addOpeningNearPoint,
  findConflicts,
  snapToWall,
  snapToItems,
  MM_PER_INCH,
} from '@room/shared';
import { useEditor } from '../store/editorStore.js';
import { isTextEntry, ownsSpace } from '../keyboard.js';
import { useViewport, toWorld, mmPerPixel } from './viewport.js';
import { snapPoint, nearestWall, type SnapResult } from './snapping.js';
import ItemLayer from './ItemLayer.js';
import ConflictLayer from './ConflictLayer.js';
import { useConflictStore } from './conflictStore.js';
import { registerStage, useExportMode } from './exportPlan.js';
import {
  GridLayer,
  UnderlayLayer,
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
/** How far the pointer must travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD_PX = 3;

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
  const library = useEditor((s) => s.library);
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
  const updatePlacement = useEditor((s) => s.updatePlacement);
  const setTool = useEditor((s) => s.setTool);

  const vp = useViewport();
  // A view-only override while a PNG is being taken; see exportPlan.ts.
  const exporting = useExportMode((s) => s.exporting);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  // Space is a *temporary* pan, on top of whatever tool is active — held
  // separately from `tool` so releasing it returns you to a wall chain in
  // progress instead of abandoning it.
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Only flips twice per gesture (mousedown/up), not per mousemove, so it's
  // cheap to hold in state rather than the ref below.
  const [grabbing, setGrabbing] = useState(false);
  const panning = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    /** Past the click-vs-drag threshold — a real pan, not a stationary click. */
    moved: boolean;
    /** Clear the selection on mouseup if the pointer never moved. */
    clearOnClick: boolean;
  } | null>(null);

  const room = project?.room;
  const settings = project?.settings;
  // Held Space temporarily behaves like the pan tool without switching to it,
  // so releasing it drops you back into whatever you were doing.
  const panMode = tool === 'pan' || spaceHeld;

  // Hand the stage to the exporter for as long as this canvas is mounted.
  useEffect(() => {
    registerStage(stageRef.current);
    return () => registerStage(null);
  }, []);

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

  // Track shift for orthogonal locking, and space for a temporary pan,
  // without re-rendering the whole tree on every mousemove.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(true);
      // e.repeat filters the held-key autorepeat flood. ownsSpace leaves Space
      // alone wherever it already has a job — typing in a field, pressing a
      // focused button — so a temporary pan never costs a keyboard user the
      // ability to activate anything.
      if (e.code === 'Space' && !e.repeat && !ownsSpace(e.target)) {
        // Otherwise the page scrolls.
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function up(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(false);
      if (e.code === 'Space') setSpaceHeld(false);
    }
    // Alt-tabbing away mid-hold would otherwise leave the canvas stuck
    // believing a key is still down that this window will never see released.
    function blur() {
      setShiftHeld(false);
      setSpaceHeld(false);
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const toleranceMm = useMemo(() => SNAP_PX * mmPerPixel(vp.scale), [vp.scale]);

  const libraryById = useMemo(() => new Map(library.map((i) => [i.id, i])), [library]);

  // Memoized on the room alone: this component re-renders on every mousemove
  // and pan frame, and rebuilding the outline each time just to enable a
  // button is waste.
  const canFit = useMemo(() => (room ? roomPolygon(room).length >= 3 : false), [room]);

  /*
    While panning, the snap marker and the wall draft's rubber band would be
    pinned to a world position that slides away with the view. Drop both the
    moment a pan mode begins, so neither can reappear at a stale spot when it
    ends; the next mousemove after the pan puts them back where the cursor is.
  */
  useEffect(() => {
    if (!panMode) return;
    setSnap(null);
    draftHover(null);
  }, [panMode, draftHover]);

  /*
    Recomputed whenever the items or the room change, which includes every frame
    of a drag. It's O(n^2) over placements, but each test is a handful of
    polygon comparisons on shapes with at most eight vertices — cheap enough
    that live feedback while dragging is worth more than the saved cycles.
  */
  const conflicts = useMemo(
    () => (room && project ? findConflicts(project.items, libraryById, room) : []),
    [project?.items, room, libraryById],
  );

  // Published so the status bar can report the tally without recomputing it.
  useEffect(() => {
    useConflictStore.getState().set(conflicts);
  }, [conflicts]);

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

  /**
   * Arm a pan gesture. Nothing moves until the pointer passes the threshold in
   * the window listener below, so an armed pan that never travels is still
   * just a click — which is what `clearOnClick` decides the meaning of.
   */
  const beginPan = useCallback((evt: MouseEvent, clearOnClick: boolean) => {
    // Read at call time rather than closed over, so this callback — and the
    // mousedown handler that depends on it — isn't rebuilt on every pan frame.
    const { x, y } = useViewport.getState();
    panning.current = {
      startX: evt.clientX,
      startY: evt.clientY,
      originX: x,
      originY: y,
      moved: false,
      clearOnClick,
    };
    // Close the hand once a pan is certain. An explicit pan (pan tool, Space,
    // middle button) is certain on the press; the select tool's implied pan
    // is still just a click until it passes the drag threshold in onMove,
    // and flashing a grab cursor on every deselect-click would be noise.
    if (!clearOnClick) setGrabbing(true);
  }, []);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      /*
        Pressing on the plan means working on the plan. A button still holding
        focus from an earlier mouse click — "New room", say — would otherwise
        take the next Space press as a click instead of a pan, now that Space
        is left alone on focused buttons.
      */
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.blur();
      }

      // Middle button, or space-less right-drag, pans regardless of tool.
      if (e.evt.button === 1 || e.evt.button === 2) {
        e.evt.preventDefault();
        beginPan(e.evt, false);
        return;
      }
      if (e.evt.button !== 0) return;

      // Pan tool, or Space held: drag from anywhere, over anything. A click
      // that goes nowhere does nothing — panning is navigation, not a way to
      // select or deselect.
      if (panMode) {
        beginPan(e.evt, false);
        return;
      }

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

      /*
        Select tool on empty canvas: arm a pan rather than acting immediately.

        Dragging the background is what people reach for to move around, and
        it used to do nothing at all. The click that clears the selection is
        still there — it just can't be decided until mouseup, once it's known
        whether the pointer travelled. Starting on an item is left alone, so
        dragging furniture still moves furniture.
      */
      if (e.target === e.target.getStage()) beginPan(e.evt, true);
    },
    [
      tool,
      panMode,
      draft,
      room,
      settings,
      resolvePointer,
      draftStart,
      draftAdd,
      draftFinish,
      edit,
      beginPan,
      vp,
      toleranceMm,
    ],
  );

  const handleMouseMove = useCallback(() => {
    // Nothing to aim while the pointer is panning. Recording a snap point here
    // would leave it pinned to a world position that the next drag slides out
    // from under the cursor.
    if (panning.current || panMode) return;
    const resolved = resolvePointer();
    if (!resolved) return;
    setSnap(resolved.snapped);
    if (draft) draftHover(resolved.snapped.point);
  }, [panMode, resolvePointer, draft, draftHover]);

  // Panning is tracked on the window so the drag survives leaving the canvas.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const pan = panning.current;
      if (!pan) return;

      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;

      /*
        Hold still until the pointer has actually travelled.

        Without this, the couple of pixels a hand contributes while pressing
        the button would shift the view under every click, and a click meant
        to deselect would register as a drag and never clear anything.
      */
      if (!pan.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        pan.moved = true;
        // For the select tool's implied pan, this is the moment it stops
        // being a click; explicit pans closed the hand on the press already.
        setGrabbing(true);
      }

      useViewport.getState().setPan(pan.originX + dx, pan.originY + dy);
    }
    function onUp() {
      const pan = panning.current;
      panning.current = null;
      setGrabbing(false);
      // A press that never moved was a click all along.
      if (pan && pan.clearOnClick && !pan.moved) useEditor.getState().select([]);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Enter finishes an open chain, Escape steps back, Backspace drops a point.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTextEntry(e.target)) return;

      const state = useEditor.getState();

      if (e.key === 'Escape') {
        state.escape();
        return;
      }
      if (e.key === 'Enter' && state.draft) {
        e.preventDefault();
        state.draftFinish(false);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && state.draft) {
        e.preventDefault();
        state.draftUndoPoint();
        return;
      }

      // Nothing below applies while a wall chain is in progress.
      if (state.draft || state.selection.length === 0) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        state.deleteSelection();
        return;
      }

      // Ctrl/Cmd+D duplicates, offset by one grid step so the copy is visibly
      // its own object rather than hiding exactly behind the original.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const step = state.project?.settings.gridStep || Math.round(MM_PER_INCH);
        const offset = Math.max(step, Math.round(4 * MM_PER_INCH));
        state.duplicateSelection(offset, offset);
        return;
      }

      // Rotate in 15-degree steps, matching the drag handle.
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        state.rotateSelection(e.key === ']' ? 15 : -15);
        return;
      }

      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = nudges[e.key];
      if (direction) {
        e.preventDefault();
        // An inch at a time, or six inches with shift — the two distances you
        // actually want when easing furniture into place.
        const stepMm = e.shiftKey ? Math.round(6 * MM_PER_INCH) : Math.round(MM_PER_INCH);
        state.nudgeSelection(direction[0] * stepMm, direction[1] * stepMm);
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

  /**
   * Drag an item, snapping it to walls first and neighbours second.
   *
   * Wall wins because pushing furniture against a wall is the commonest
   * intent and it also sets the rotation; item-to-item snapping only nudges
   * position, so applying it afterwards can't undo the wall alignment.
   */
  const handleItemDragMove = useCallback(
    (id: string, x: number, y: number) => {
      if (!room || !settings || !project) return;

      const placed = project.items.find((i) => i.id === id);
      const item = placed ? libraryById.get(placed.libraryId) : undefined;
      if (!placed || !item) return;

      let next = { x: Math.round(x), y: Math.round(y), rotation: placed.rotation };

      if (settings.snapToWalls) {
        const wallSnap = snapToWall({ ...placed, ...next }, item, room, toleranceMm * 2);
        if (wallSnap) {
          next = { x: wallSnap.x, y: wallSnap.y, rotation: wallSnap.rotation };
        } else {
          const others = project.items
            .filter((o) => o.id !== id)
            .map((o) => ({ placed: o, item: libraryById.get(o.libraryId) }))
            .filter((o): o is { placed: typeof placed; item: typeof item } => Boolean(o.item));
          const itemSnap = snapToItems({ ...placed, ...next }, item, others, toleranceMm * 1.5);
          if (itemSnap) next = { ...next, ...itemSnap };
        }
      }

      if (settings.snapToGrid && settings.gridStep > 0) {
        const step = settings.gridStep;
        // Only re-grid when nothing stronger already claimed the position.
        if (next.rotation === placed.rotation) {
          next.x = Math.round(next.x / step) * step;
          next.y = Math.round(next.y / step) * step;
        }
      }

      updatePlacement(id, next);
    },
    [room, settings, project, libraryById, toleranceMm, updatePlacement],
  );

  const willClose = useMemo(() => {
    if (!draft || draft.points.length < 3 || !draft.hover) return false;
    const first = draft.points[0]!;
    return distance(draft.hover, first) * vp.scale <= CLOSE_PX;
  }, [draft, vp.scale]);

  /** Drop a library item where it was released, snapped to the grid. */
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const libraryId = e.dataTransfer.getData('application/x-room-item');
      if (!libraryId || !room || !settings) return;

      const host = containerRef.current?.getBoundingClientRect();
      if (!host) return;

      const world = toWorld(
        { x: e.clientX - host.left, y: e.clientY - host.top },
        useViewport.getState(),
      );
      const snapped = snapPoint(world, {
        room,
        gridStep: settings.gridStep,
        snapToGrid: settings.snapToGrid,
        toleranceMm,
      });

      useEditor.getState().placeInRoom(libraryId, snapped.point.x, snapped.point.y);
    },
    [room, settings, toleranceMm],
  );

  if (!project || !room || !settings) return null;

  const cursor = grabbing
    ? 'grabbing'
    : panMode
      ? 'grab'
      : tool === 'wall'
        ? 'crosshair'
        : tool === 'select'
          ? 'default'
          : 'copy';

  return (
    <div
      ref={containerRef}
      className="canvas-host"
      style={{ cursor }}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop entirely.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}
    >
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
          {/* An exported PNG is transparent without this, which reads as black
              in most viewers and hides half the drawing. */}
          {exporting && (
            <Rect
              x={-vp.x / vp.scale}
              y={-vp.y / vp.scale}
              width={vp.width / vp.scale}
              height={vp.height / vp.scale}
              fill="#14161a"
            />
          )}
          {settings.showGrid && !exporting && <GridLayer vp={vp} step={settings.gridStep} />}
          <UnderlayLayer room={room} />
          <FloorLayer room={room} />
        </Layer>

        {/*
          In pan mode the whole interactive layer stops listening, so every
          press lands on the stage and pans. Nothing in here can then be
          clicked, double-clicked or dragged mid-pan — including shapes added
          to this layer later, which is why it's one switch here rather than a
          prop each piece has to remember to honour.
        */}
        <Layer listening={!panMode}>
          <WallLayer
            room={room}
            vp={vp}
            selection={exporting ? [] : selection}
            onWallClick={(wallId, e) => toggleSelect(wallId, e.evt.shiftKey)}
            onWallDblClick={onEditWallLength}
          />
          <OpeningLayer
            room={room}
            vp={vp}
            selection={selection}
            onClick={(id) => select([id])}
          />
          <ItemLayer
            items={project.items}
            library={library}
            selection={exporting ? [] : selection}
            vp={vp}
            units={settings.units}
            renderMode={settings.itemRender}
            onSelect={(id, additive) => toggleSelect(id, additive)}
            onDragStart={(id) => {
              beginGesture();
              if (!selection.includes(id)) select([id]);
            }}
            onDragMove={handleItemDragMove}
            onDragEnd={endGesture}
            onRotateStart={beginGesture}
            onRotate={(id, degrees) => {
              // Shift frees the angle; otherwise land on tidy 15-degree steps.
              const snapped = shiftHeld ? degrees : Math.round(degrees / 15) * 15;
              updatePlacement(id, { rotation: ((snapped % 360) + 360) % 360 });
            }}
            onRotateEnd={endGesture}
            onShapeStart={beginGesture}
            onShape={(id, points) => {
              const placed = project.items.find((i) => i.id === id);
              const item = placed ? libraryById.get(placed.libraryId) : undefined;
              if (!placed || !item) return;
              // Keep the item's own kind: dragging a point turns an L or a rect
              // into a polygon, and that's the only way to edit one by hand.
              updatePlacement(id, { footprint: { kind: 'poly', points } });
            }}
            onShapeEnd={endGesture}
          />
          {tool === 'select' && !exporting && (
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
          <ConflictLayer
            items={project.items}
            library={libraryById}
            room={room}
            conflicts={exporting ? [] : conflicts}
            selection={exporting ? [] : selection}
            showClearances={settings.showClearances && !exporting}
            vp={vp}
            units={settings.units}
          />
          {settings.showDimensions && (
            <DimensionLayer room={room} vp={vp} units={settings.units} />
          )}
          {draft && (
            <DraftLayer
              points={draft.points}
              hover={panMode ? null : draft.hover}
              vp={vp}
              units={settings.units}
              thickness={settings.defaultWallThickness}
              willClose={willClose}
            />
          )}
          {(tool === 'wall' || tool === 'door' || tool === 'window') &&
            !panMode &&
            snap &&
            !exporting && <SnapMarker point={snap.point} vp={vp} kind={snap.kind} />}
        </Layer>
      </Stage>

      {/*
        The hint describes what the pointer is doing right now, so a held
        Space overrides the tool's own hint — the mouse really is panning.
      */}
      {panMode ? (
        <div className="canvas-hint">
          {spaceHeld && tool !== 'pan' ? (
            <>
              Drag to move the view · release <b>Space</b> to carry on
            </>
          ) : (
            <>
              Drag to move the view · <b>M</b> or <b>Esc</b> for the pointer
            </>
          )}
        </div>
      ) : (
        <>
          {tool === 'wall' && (
            <div className="canvas-hint">
              Click to place corners · <b>Shift</b> locks to 90° · click the first point or
              press <b>Enter</b> to finish · <b>Esc</b> cancels
            </div>
          )}
          {(tool === 'door' || tool === 'window') && (
            <div className="canvas-hint">
              Click a wall to place a {tool} · <b>Esc</b> to stop
            </div>
          )}
        </>
      )}

      {/*
        View controls sit on the canvas rather than in a side panel: they act
        on what you're looking at, so they belong next to it.
      */}
      <div className="canvas-toolbar" role="toolbar" aria-label="View controls">
        <button
          className={tool === 'select' ? 'tool active' : 'tool'}
          aria-pressed={tool === 'select'}
          title="Select and move items — M. Esc clears the selection."
          onMouseDown={keepFocus}
          onClick={() => setTool('select')}
        >
          Select <span className="key">M</span>
        </button>
        <button
          className={tool === 'pan' ? 'tool active' : 'tool'}
          aria-pressed={tool === 'pan'}
          title="Move the view — P, or hold Space, or drag an empty part of the plan"
          onMouseDown={keepFocus}
          onClick={() => setTool('pan')}
        >
          Pan <span className="key">P</span>
        </button>

        <span className="toolbar-sep" aria-hidden="true" />

        <button
          className="tool"
          disabled={!canFit}
          title="Frame the whole room in the view"
          onMouseDown={keepFocus}
          onClick={fitRoomToView}
        >
          Fit to view
        </button>
      </div>
    </div>
  );
}

/**
 * Stop a mouse click from focusing a canvas toolbar button.
 *
 * A focused button owns Space, and the next Space after clicking "Pan" should
 * pan rather than click it again. Keyboard users still reach these by Tab —
 * this only affects focus that arrives by mouse.
 */
function keepFocus(e: React.MouseEvent): void {
  e.preventDefault();
}

/** Frame the room in the viewport; exported so the toolbar can call it. */
export function fitRoomToView(): void {
  const project = useEditor.getState().project;
  if (!project) return;
  const polygon = roomPolygon(project.room);
  useViewport.getState().fitTo(polygon);
}
