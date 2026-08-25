import { Group, Line, Shape } from 'react-konva';
import type { LibraryItem, PlacedItem, Room, UnitSystem } from '@room/shared';
import { clearanceZones, doorSwingPolygon, footprintPolygon, type Conflict } from '@room/shared';
import type { ViewportState } from './viewport.js';

const OVERLAP = '#ff6b6b';
const CLEARANCE = '#e8b046';

/**
 * Diagonal hatching, drawn with a clip so it fills exactly the polygon.
 *
 * A flat translucent wash reads as "selected"; hatching reads as "wrong",
 * which is the distinction the eye needs when a plan is otherwise full of
 * coloured rectangles.
 */
function Hatch({
  polygon,
  color,
  vp,
  spacingPx = 7,
}: {
  polygon: { x: number; y: number }[];
  color: string;
  vp: ViewportState;
  spacingPx?: number;
}) {
  if (polygon.length < 3) return null;
  const inv = 1 / vp.scale;
  const spacing = spacingPx * inv;

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of polygon) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }

        ctx.save();
        ctx.beginPath();
        polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.clip();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1 * inv;
        ctx.globalAlpha = 0.85;

        // 45-degree lines across the bounding box; the clip trims them.
        const span = maxX - minX + (maxY - minY);
        for (let offset = 0; offset <= span; offset += spacing) {
          ctx.beginPath();
          ctx.moveTo(minX + offset, minY);
          ctx.lineTo(minX + offset - (maxY - minY), maxY);
          ctx.stroke();
        }
        ctx.restore();
      }}
    />
  );
}

export interface ConflictLayerProps {
  items: PlacedItem[];
  library: Map<string, LibraryItem>;
  room: Room;
  conflicts: Conflict[];
  selection: string[];
  showClearances: boolean;
  vp: ViewportState;
  units: UnitSystem;
}

/**
 * Clearance zones and conflict marks.
 *
 * Clearance zones are drawn only for the selected item unless something is
 * actually wrong with them. Showing every zone at once turns a furnished room
 * into a wash of overlapping amber rectangles that nobody can read.
 */
export default function ConflictLayer({
  items,
  library,
  room,
  conflicts,
  selection,
  showClearances,
  vp,
}: ConflictLayerProps) {
  const inv = 1 / vp.scale;

  const blockedItems = new Set(
    conflicts.filter((c) => c.kind === 'clearance').flatMap((c) => c.itemIds),
  );
  const overlapping = new Set(
    conflicts.filter((c) => c.kind === 'overlap' || c.kind === 'outside' || c.kind === 'door')
      .flatMap((c) => c.itemIds),
  );

  return (
    <Group listening={false}>
      {/* Door swings, so it's obvious why a piece near a door is flagged. */}
      {room.openings.map((opening) => {
        const swing = doorSwingPolygon(room, opening);
        if (swing.length < 3) return null;
        return (
          <Line
            key={opening.id}
            points={swing.flatMap((p) => [p.x, p.y])}
            closed
            fill="rgba(232, 176, 70, 0.07)"
            perfectDrawEnabled={false}
          />
        );
      })}

      {items.map((placed) => {
        const item = library.get(placed.libraryId);
        if (!item) return null;

        const isSelected = selection.includes(placed.id);
        const isBlocked = blockedItems.has(placed.id);
        if (!showClearances || (!isSelected && !isBlocked)) return null;

        return (
          <Group key={placed.id}>
            {clearanceZones(placed, item).map((zone) => {
              // Amber hatch only where this zone is genuinely obstructed.
              const obstructed = conflicts.some(
                (c) =>
                  c.kind === 'clearance' &&
                  c.side === zone.side &&
                  c.itemIds[0] === placed.id,
              );

              return (
                <Group key={zone.side}>
                  <Line
                    points={zone.polygon.flatMap((p) => [p.x, p.y])}
                    closed
                    fill={obstructed ? 'rgba(232,176,70,0.12)' : 'rgba(120,132,150,0.10)'}
                    stroke={obstructed ? CLEARANCE : 'rgba(148,154,166,0.5)'}
                    strokeWidth={1 * inv}
                    dash={[5 * inv, 4 * inv]}
                    perfectDrawEnabled={false}
                  />
                  {obstructed && <Hatch polygon={zone.polygon} color={CLEARANCE} vp={vp} />}
                </Group>
              );
            })}
          </Group>
        );
      })}

      {/* Hard collisions: red hatch over the offending footprint. */}
      {items.map((placed) => {
        if (!overlapping.has(placed.id)) return null;
        const item = library.get(placed.libraryId);
        if (!item) return null;
        const polygon = footprintPolygon(placed, item);
        return (
          <Group key={`x-${placed.id}`}>
            <Hatch polygon={polygon} color={OVERLAP} vp={vp} spacingPx={6} />
            <Line
              points={polygon.flatMap((p) => [p.x, p.y])}
              closed
              stroke={OVERLAP}
              strokeWidth={1.8 * inv}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}
