import { Fragment, useEffect, useState } from 'react';
import { Group, Line, Circle, Rect, Text, Shape, Arc, Image as KonvaImage } from 'react-konva';
import type { Opening, Pt, Room, UnitSystem, Wall } from '@room/shared';
import {
  add,
  angleOf,
  cross,
  distance,
  formatLength,
  normalize,
  perpendicular,
  roomPolygon,
  rotate,
  scale as vscale,
  sub,
  wallInwardNormal,
  wallSegment,
} from '@room/shared';
import { visibleWorldRect, type ViewportState } from './viewport.js';
import { assetUrl } from '../api.js';

const COLORS = {
  gridMinor: '#20242c',
  gridMajor: '#2b313b',
  axis: '#3a4250',
  floor: '#171a1f',
  wall: '#c7ccd6',
  wallSelected: '#5b9dff',
  draft: '#5b9dff',
  vertex: '#8a94a6',
  vertexActive: '#5b9dff',
  dimension: '#7f8896',
  dimensionText: '#aab2c0',
  door: '#e8b046',
  window: '#63c2ff',
  openingSelected: '#5b9dff',
};

/** Text and hairlines must not scale with zoom, so they get an inverse scale. */
function inverse(scaleValue: number): number {
  return 1 / scaleValue;
}

// ------------------------------------------------------------------- grid ---

interface GridProps {
  vp: ViewportState;
  step: number;
}

/**
 * Drawn as one custom Shape rather than a Line per gridline: at a whole-house
 * zoom a naive grid is tens of thousands of nodes, and Konva keeps a JS object
 * for every one of them.
 */
export function GridLayer({ vp, step }: GridProps) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        const rect = visibleWorldRect(vp);

        // Coarsen the step until lines are at least ~7px apart, so zooming out
        // thins the grid instead of turning it into a solid fill.
        let effective = step;
        while (effective * vp.scale < 7) effective *= 5;

        const majorEvery = 10;
        const startX = Math.floor(rect.minX / effective) * effective;
        const startY = Math.floor(rect.minY / effective) * effective;

        ctx.lineWidth = inverse(vp.scale);

        for (let x = startX; x <= rect.maxX; x += effective) {
          const isMajor = Math.round(x / effective) % majorEvery === 0;
          ctx.beginPath();
          ctx.strokeStyle = x === 0 ? COLORS.axis : isMajor ? COLORS.gridMajor : COLORS.gridMinor;
          ctx.moveTo(x, rect.minY);
          ctx.lineTo(x, rect.maxY);
          ctx.stroke();
        }

        for (let y = startY; y <= rect.maxY; y += effective) {
          const isMajor = Math.round(y / effective) % majorEvery === 0;
          ctx.beginPath();
          ctx.strokeStyle = y === 0 ? COLORS.axis : isMajor ? COLORS.gridMajor : COLORS.gridMinor;
          ctx.moveTo(rect.minX, y);
          ctx.lineTo(rect.maxX, y);
          ctx.stroke();
        }
      }}
    />
  );
}

// --------------------------------------------------------------- underlay ---

/**
 * The traced source image, drawn behind the plan at the scale the trace
 * established. Its whole purpose is to be visibly wrong: you drag corners onto
 * it until the walls line up with the drawing.
 */
export function UnderlayLayer({ room }: { room: Room }) {
  const underlay = room.underlay;
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!underlay?.assetId) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.src = assetUrl(underlay.assetId);
    img.onload = () => !cancelled && setImage(img);
    img.onerror = () => !cancelled && setImage(null);
    return () => {
      cancelled = true;
    };
  }, [underlay?.assetId]);

  if (!underlay?.visible || !image) return null;

  return (
    <KonvaImage
      image={image}
      x={underlay.origin.x}
      y={underlay.origin.y}
      // Pixels map to world millimetres through the trace's scale, so the
      // image sits exactly where the traced geometry came from.
      width={image.naturalWidth * underlay.scaleMmPerPx}
      height={image.naturalHeight * underlay.scaleMmPerPx}
      rotation={underlay.rotation}
      opacity={underlay.opacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

// ------------------------------------------------------------------ floor ---

export function FloorLayer({ room }: { room: Room }) {
  const polygon = roomPolygon(room);
  if (polygon.length < 3) return null;
  return (
    <Line
      points={polygon.flatMap((p) => [p.x, p.y])}
      closed
      fill={COLORS.floor}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

// ------------------------------------------------------------------ walls ---

interface WallsProps {
  room: Room;
  vp: ViewportState;
  selection: string[];
  onWallClick: (wallId: string, event: { evt: MouseEvent }) => void;
  onWallDblClick: (wallId: string) => void;
}

export function WallLayer({ room, vp, selection, onWallClick, onWallDblClick }: WallsProps) {
  const inv = inverse(vp.scale);

  return (
    <Group>
      {room.walls.map((wall) => {
        const seg = wallSegment(room, wall);
        if (!seg) return null;
        const selected = selection.includes(wall.id);

        return (
          <Fragment key={wall.id}>
            {/* The visible wall, drawn at true thickness in world units. */}
            <Line
              points={[seg.a.x, seg.a.y, seg.b.x, seg.b.y]}
              stroke={selected ? COLORS.wallSelected : COLORS.wall}
              strokeWidth={wall.thickness}
              lineCap="butt"
              perfectDrawEnabled={false}
              listening={false}
            />
            {/*
              A separate invisible line carries the hit test. A thin wall at low
              zoom is a couple of pixels wide and effectively unclickable, so the
              target is widened to a constant ~12px regardless of zoom.
            */}
            <Line
              points={[seg.a.x, seg.a.y, seg.b.x, seg.b.y]}
              stroke="transparent"
              strokeWidth={Math.max(wall.thickness, 12 * inv)}
              lineCap="butt"
              onClick={(e) => onWallClick(wall.id, e as unknown as { evt: MouseEvent })}
              onTap={(e) => onWallClick(wall.id, e as unknown as { evt: MouseEvent })}
              onDblClick={() => onWallDblClick(wall.id)}
              onDblTap={() => onWallDblClick(wall.id)}
            />
          </Fragment>
        );
      })}
    </Group>
  );
}

// --------------------------------------------------------------- vertices ---

interface VertexProps {
  room: Room;
  vp: ViewportState;
  selection: string[];
  onDragStart: () => void;
  onDragMove: (vertexId: string, point: Pt) => void;
  onDragEnd: () => void;
}

export function VertexLayer({ room, vp, selection, onDragStart, onDragMove, onDragEnd }: VertexProps) {
  const inv = inverse(vp.scale);
  const radius = 4.5 * inv;

  return (
    <Group>
      {Object.entries(room.vertices).map(([id, vertex]) => (
        <Circle
          key={id}
          x={vertex.x}
          y={vertex.y}
          radius={radius}
          fill={selection.includes(id) ? COLORS.vertexActive : '#11141a'}
          stroke={selection.includes(id) ? COLORS.vertexActive : COLORS.vertex}
          strokeWidth={1.5 * inv}
          // Corner handles need a forgiving grab area at any zoom.
          hitStrokeWidth={14 * inv}
          draggable
          onDragStart={onDragStart}
          onDragMove={(e) => onDragMove(id, { x: e.target.x(), y: e.target.y() })}
          onDragEnd={onDragEnd}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

// --------------------------------------------------------------- openings ---

interface OpeningProps {
  room: Room;
  vp: ViewportState;
  selection: string[];
  onClick: (openingId: string) => void;
}

/** Geometry for one opening: its endpoints on the wall and the wall's axes. */
function openingFrame(room: Room, opening: Opening) {
  const wall = room.walls.find((w) => w.id === opening.wallId);
  if (!wall) return null;
  const seg = wallSegment(room, wall);
  if (!seg) return null;

  const total = distance(seg.a, seg.b);
  if (total < 1) return null;

  const dir = normalize(sub(seg.b, seg.a));
  const start = add(seg.a, vscale(dir, opening.offset));
  const end = add(seg.a, vscale(dir, opening.offset + opening.width));
  const inward = wallInwardNormal(room, wall);

  return { wall, seg, dir, start, end, inward, normal: perpendicular(dir) };
}

export function OpeningLayer({ room, vp, selection, onClick }: OpeningProps) {
  const inv = inverse(vp.scale);

  return (
    <Group>
      {room.openings.map((opening) => {
        const frame = openingFrame(room, opening);
        if (!frame) return null;

        const { wall, start, end, dir, inward } = frame;
        const selected = selection.includes(opening.id);
        const half = wall.thickness / 2;
        const color = selected
          ? COLORS.openingSelected
          : opening.kind === 'door'
            ? COLORS.door
            : COLORS.window;

        // Punch the opening out of the wall by overdrawing the floor colour,
        // then mark it — cheaper and more robust than splitting the wall line.
        const n = perpendicular(dir);
        const quad = [
          add(start, vscale(n, half)),
          add(end, vscale(n, half)),
          add(end, vscale(n, -half)),
          add(start, vscale(n, -half)),
        ];

        return (
          <Group key={opening.id}>
            <Line
              points={quad.flatMap((p) => [p.x, p.y])}
              closed
              fill={COLORS.floor}
              listening={false}
              perfectDrawEnabled={false}
            />

            {opening.kind === 'window' ? (
              <Line
                points={[start.x, start.y, end.x, end.y]}
                stroke={color}
                strokeWidth={Math.max(wall.thickness * 0.35, 2 * inv)}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : (
              (() => {
                /*
                  A plan-view door is the open leaf plus the arc it sweeps.
                  Both hang off the hinge jamb: the leaf starts along the wall
                  (closed) and rotates `angle` degrees toward the side it opens
                  into.

                  Konva's Arc always sweeps clockwise from `rotation`. Whether
                  the leaf's travel is clockwise depends on the wall's direction
                  and which side is inside, so it's derived from the cross
                  product rather than assumed -- otherwise doors on the far side
                  of the room swing out through the wall.
                */
                const hingeAtA = opening.swing?.hinge !== 'b';
                const hinge = hingeAtA ? start : end;
                const closed = hingeAtA ? dir : vscale(dir, -1);
                const sweep = opening.swing?.angle ?? 90;
                const openSide =
                  opening.swing?.into === 'out' ? vscale(inward, -1) : inward;

                const clockwise = cross(closed, openSide) > 0;
                const rotation = clockwise
                  ? angleOf(closed)
                  : angleOf(closed) - sweep;

                const leafEnd = add(
                  hinge,
                  vscale(rotate(closed, clockwise ? sweep : -sweep), opening.width),
                );

                return (
                  <>
                    <Line
                      points={[hinge.x, hinge.y, leafEnd.x, leafEnd.y]}
                      stroke={color}
                      strokeWidth={2 * inv}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Arc
                      x={hinge.x}
                      y={hinge.y}
                      innerRadius={opening.width}
                      outerRadius={opening.width}
                      angle={sweep}
                      rotation={rotation}
                      stroke={color}
                      strokeWidth={1 * inv}
                      dash={[6 * inv, 5 * inv]}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </>
                );
              })()
            )}

            {/* Hit target sized for fingers and low zoom, not for the graphic. */}
            <Line
              points={[start.x, start.y, end.x, end.y]}
              stroke="transparent"
              strokeWidth={Math.max(wall.thickness, 14 * inv)}
              onClick={() => onClick(opening.id)}
              onTap={() => onClick(opening.id)}
            />
          </Group>
        );
      })}
    </Group>
  );
}

// ------------------------------------------------------------- dimensions ---

interface DimensionProps {
  room: Room;
  vp: ViewportState;
  units: UnitSystem;
}

/**
 * A dimension line offset outside each wall, with the length written on it.
 * Text is counter-scaled so it stays legible at any zoom.
 */
export function DimensionLayer({ room, vp, units }: DimensionProps) {
  const inv = inverse(vp.scale);
  const offset = 26 * inv;
  const tick = 5 * inv;
  const fontSize = 12 * inv;

  return (
    <Group listening={false}>
      {room.walls.map((wall) => {
        const seg = wallSegment(room, wall);
        if (!seg) return null;

        const len = distance(seg.a, seg.b);
        if (len < 1) return null;

        // Push the dimension line to the outside of the room.
        const outward = vscale(wallInwardNormal(room, wall), -1);
        const a = add(seg.a, vscale(outward, offset));
        const b = add(seg.b, vscale(outward, offset));
        const mid = vscale(add(a, b), 0.5);
        const dir = normalize(sub(b, a));
        const n = perpendicular(dir);

        // Keep text upright: flip the label when the wall runs right-to-left.
        let rotation = angleOf(dir);
        if (rotation > 90 && rotation < 270) rotation -= 180;

        const label = formatLength(Math.round(len), units);

        return (
          <Group key={wall.id}>
            <Line
              points={[a.x, a.y, b.x, b.y]}
              stroke={COLORS.dimension}
              strokeWidth={1 * inv}
              perfectDrawEnabled={false}
            />
            {[a, b].map((end, i) => (
              <Line
                key={i}
                points={[
                  end.x + n.x * tick,
                  end.y + n.y * tick,
                  end.x - n.x * tick,
                  end.y - n.y * tick,
                ]}
                stroke={COLORS.dimension}
                strokeWidth={1 * inv}
                perfectDrawEnabled={false}
              />
            ))}
            <Text
              x={mid.x}
              y={mid.y}
              text={label}
              fontSize={fontSize}
              fill={COLORS.dimensionText}
              rotation={rotation}
              offsetX={(label.length * fontSize * 0.28)}
              offsetY={fontSize * 1.4}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}

// ------------------------------------------------------------------ draft ---

interface DraftProps {
  points: Pt[];
  hover: Pt | null;
  vp: ViewportState;
  units: UnitSystem;
  thickness: number;
  /** True when the cursor is over the chain's first point, ready to close. */
  willClose: boolean;
}

export function DraftLayer({ points, hover, vp, units, thickness, willClose }: DraftProps) {
  const inv = inverse(vp.scale);
  if (points.length === 0) return null;

  const chain = hover ? [...points, hover] : points;
  const last = points[points.length - 1]!;

  return (
    <Group listening={false}>
      <Line
        points={chain.flatMap((p) => [p.x, p.y])}
        stroke={COLORS.draft}
        strokeWidth={thickness}
        opacity={0.5}
        lineCap="butt"
        perfectDrawEnabled={false}
      />
      <Line
        points={chain.flatMap((p) => [p.x, p.y])}
        stroke={COLORS.draft}
        strokeWidth={1.5 * inv}
        perfectDrawEnabled={false}
      />

      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={4 * inv}
          fill={i === 0 && willClose ? COLORS.draft : '#11141a'}
          stroke={COLORS.draft}
          strokeWidth={1.5 * inv}
          perfectDrawEnabled={false}
        />
      ))}

      {/* Live length readout on the segment being drawn. */}
      {hover && (
        <Text
          x={(last.x + hover.x) / 2}
          y={(last.y + hover.y) / 2}
          text={formatLength(Math.round(distance(last, hover)), units)}
          fontSize={12 * inv}
          fill="#e6e8ec"
          offsetY={18 * inv}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

// ------------------------------------------------------------ snap marker ---

export function SnapMarker({ point, vp, kind }: { point: Pt | null; vp: ViewportState; kind: string }) {
  if (!point || kind === 'free' || kind === 'grid') return null;
  const inv = inverse(vp.scale);
  const size = 7 * inv;

  return (
    <Rect
      x={point.x - size}
      y={point.y - size}
      width={size * 2}
      height={size * 2}
      stroke={kind === 'vertex' ? '#4ec9a5' : '#e8b046'}
      strokeWidth={1.5 * inv}
      rotation={kind === 'ortho' ? 0 : 45}
      offsetX={0}
      offsetY={0}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

export { COLORS };
