import { useEffect, useMemo, useState } from 'react';
import { Group, Line, Rect, Text, Circle, Arc, Image as KonvaImage } from 'react-konva';
import type { ItemRenderMode, LibraryItem, PlacedItem } from '@room/shared';
import { LAYER_ORDER, effectiveSize, formatLength, localFootprint } from '@room/shared';
import type { UnitSystem } from '@room/shared';
import { assetUrl } from '../api.js';
import { glyphFor, type Stroke } from './furnitureIcons.js';
import type { ViewportState } from './viewport.js';

const SELECTED = '#5b9dff';
const MISSING = '#ff6b6b';

/** Render one glyph stroke, mapped from 0..1 space onto the item's box. */
function GlyphStroke({
  stroke,
  w,
  d,
  color,
  width,
  index,
}: {
  stroke: Stroke;
  w: number;
  d: number;
  color: string;
  width: number;
  index: number;
}) {
  // Glyph y=0 is the front (local -Y), y=1 the back (local +Y).
  const mapX = (nx: number) => nx * w - w / 2;
  const mapY = (ny: number) => ny * d - d / 2;
  const common = { stroke: color, strokeWidth: width, listening: false, perfectDrawEnabled: false };

  switch (stroke.kind) {
    case 'line':
      return (
        <Line
          key={index}
          {...common}
          points={stroke.points.flatMap((v, i) => (i % 2 === 0 ? mapX(v) : mapY(v)))}
        />
      );
    case 'rect':
      return (
        <Rect
          key={index}
          {...common}
          x={mapX(stroke.x)}
          y={mapY(stroke.y)}
          width={stroke.w * w}
          height={stroke.h * d}
          cornerRadius={(stroke.round ?? 0) * Math.min(w, d)}
        />
      );
    case 'circle':
      return (
        <Circle
          key={index}
          {...common}
          x={mapX(stroke.x)}
          y={mapY(stroke.y)}
          radius={stroke.r * Math.min(w, d)}
        />
      );
    case 'arc':
      return (
        <Arc
          key={index}
          {...common}
          x={mapX(stroke.x)}
          y={mapY(stroke.y)}
          innerRadius={stroke.r * Math.min(w, d)}
          outerRadius={stroke.r * Math.min(w, d)}
          rotation={stroke.from}
          angle={stroke.to - stroke.from}
        />
      );
    default:
      return null;
  }
}

/** Load a cached asset into an HTMLImageElement for Konva. */
function useAssetImage(assetId: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!assetId) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.src = assetUrl(assetId);
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setImage(null);
    };
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return image;
}

interface ItemProps {
  placed: PlacedItem;
  item: LibraryItem | undefined;
  selected: boolean;
  vp: ViewportState;
  units: UnitSystem;
  renderMode: ItemRenderMode;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
  onRotateStart: () => void;
  onRotate: (id: string, degrees: number) => void;
  onRotateEnd: () => void;
}

function PlacedFurniture({
  placed,
  item,
  selected,
  vp,
  units,
  renderMode,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRotateStart,
  onRotate,
  onRotateEnd,
}: ItemProps) {
  const inv = 1 / vp.scale;
  const image = useAssetImage(
    renderMode !== 'icon'
      ? item?.variants.find((v) => v.id === placed.variantId)?.imageAssetId ?? item?.imageAssetId
      : undefined,
  );

  // A placement whose library entry was deleted still has to render, or the
  // user has an invisible object they can't select to remove.
  if (!item) {
    return (
      <Group
        x={placed.x}
        y={placed.y}
        rotation={placed.rotation}
        onClick={(e) => onSelect(placed.id, e.evt.shiftKey)}
      >
        <Rect
          x={-300}
          y={-300}
          width={600}
          height={600}
          stroke={MISSING}
          strokeWidth={2 * inv}
          dash={[8 * inv, 6 * inv]}
        />
        {/*
          Counter-rotate the label so it stays horizontal. Without this it
          inherits the placement's rotation and a piece dropped at 90 degrees
          gets a label reading top-to-bottom.
        */}
        <Text
          text="missing item"
          fontSize={11 * inv}
          fill={MISSING}
          align="center"
          width={900}
          offsetX={450}
          y={-300 - 20 * inv}
          rotation={-placed.rotation}
          listening={false}
          perfectDrawEnabled={false}
        />
      </Group>
    );
  }

  const { w, d } = effectiveSize(placed, item);
  const footprint = placed.footprint ?? item.footprint;
  const outline = localFootprint(footprint, w, d);
  // Fall back to the first variant, so placements saved before `placeItem`
  // started setting variantId — and any whose variant was later deleted from
  // the library entry — still render in the item's colour rather than grey.
  const variant = item.variants.find((v) => v.id === placed.variantId) ?? item.variants[0];
  const fill = variant?.hex ?? '#5a6270';
  const glyph = glyphFor(item.subcategoryId);

  const showPhoto = (renderMode === 'photo' || renderMode === 'both') && image;
  const showIcon = renderMode === 'icon' || renderMode === 'both' || !image;

  return (
    <Group
      x={placed.x}
      y={placed.y}
      rotation={placed.rotation}
      scaleX={placed.flipX ? -1 : 1}
      opacity={placed.locked ? 0.75 : 1}
      // A locked item stays selectable but refuses to move, which is the whole
      // point of locking it.
      draggable={!placed.locked}
      onClick={(e) => onSelect(placed.id, e.evt.shiftKey)}
      onTap={(e) => onSelect(placed.id, (e.evt as unknown as MouseEvent).shiftKey)}
      onDragStart={() => onDragStart(placed.id)}
      onDragMove={(e) => onDragMove(placed.id, e.target.x(), e.target.y())}
      onDragEnd={onDragEnd}
    >
      <Line
        points={outline.flatMap((p) => [p.x, p.y])}
        closed
        fill={fill}
        opacity={showPhoto ? 0.25 : 0.55}
        stroke={selected ? SELECTED : '#0d0f13'}
        strokeWidth={(selected ? 2.5 : 1.2) * inv}
        perfectDrawEnabled={false}
      />

      {showPhoto && image && (
        <Group
          clipFunc={(ctx) => {
            ctx.beginPath();
            outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.closePath();
          }}
          listening={false}
        >
          <KonvaImage image={image} x={-w / 2} y={-d / 2} width={w} height={d} opacity={0.85} />
        </Group>
      )}

      {showIcon &&
        glyph?.strokes.map((s, i) => (
          <GlyphStroke
            key={i}
            index={i}
            stroke={s}
            w={w}
            d={d}
            color={selected ? SELECTED : '#0d0f13'}
            width={1.4 * inv}
          />
        ))}

      {selected && !placed.locked && (
        <Group>
          {/* Stem and knob standing off the front, so which way it faces is
              never ambiguous once rotated. */}
          <Line
            points={[0, -d / 2, 0, -d / 2 - 34 * inv]}
            stroke={SELECTED}
            strokeWidth={1.4 * inv}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Circle
            x={0}
            y={-d / 2 - 34 * inv}
            radius={6 * inv}
            fill="#11141a"
            stroke={SELECTED}
            strokeWidth={2 * inv}
            hitStrokeWidth={18 * inv}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              onRotateStart();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              // Angle from the item's centre to the pointer, in world space.
              const stage = e.target.getStage();
              const pointer = stage?.getRelativePointerPosition();
              if (!pointer) return;
              const deg =
                (Math.atan2(pointer.y - placed.y, pointer.x - placed.x) * 180) / Math.PI;
              // The handle sits on the front (-Y), which is -90 degrees from +X.
              onRotate(placed.id, deg + 90);
              // Snap the knob back to its stem; rotation moves the whole group.
              e.target.position({ x: 0, y: -d / 2 - 34 * inv });
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              e.target.position({ x: 0, y: -d / 2 - 34 * inv });
              onRotateEnd();
            }}
          />
        </Group>
      )}

      {placed.locked && (
        <Circle x={0} y={0} radius={5 * inv} fill="#0d0f13" stroke="#949aa6" strokeWidth={1 * inv} />
      )}

      {/* Name and size, counter-rotated so they stay readable at any angle. */}
      {selected && (
        <Text
          text={`${item.name}\n${formatLength(w, units)} × ${formatLength(d, units)}`}
          fontSize={11 * inv}
          lineHeight={1.3}
          fill="#e6e8ec"
          align="center"
          width={Math.max(w, 1200)}
          offsetX={Math.max(w, 1200) / 2}
          y={d / 2 + 8 * inv}
          rotation={-placed.rotation}
          scaleX={placed.flipX ? -1 : 1}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}

export interface ItemLayerProps {
  items: PlacedItem[];
  library: LibraryItem[];
  selection: string[];
  vp: ViewportState;
  units: UnitSystem;
  renderMode: ItemRenderMode;
  onSelect: (id: string, additive: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
  onRotateStart: () => void;
  onRotate: (id: string, degrees: number) => void;
  onRotateEnd: () => void;
}

export default function ItemLayer({
  items,
  library,
  selection,
  vp,
  units,
  renderMode,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRotateStart,
  onRotate,
  onRotateEnd,
}: ItemLayerProps) {
  const byId = useMemo(() => new Map(library.map((i) => [i.id, i])), [library]);

  // A rug has to render under the coffee table standing on it, so paint order
  // follows the layer rank rather than insertion order.
  const ordered = useMemo(
    () => [...items].sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]),
    [items],
  );

  return (
    <Group>
      {ordered.map((placed) => (
        <PlacedFurniture
          key={placed.id}
          placed={placed}
          item={byId.get(placed.libraryId)}
          selected={selection.includes(placed.id)}
          vp={vp}
          units={units}
          renderMode={renderMode}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onRotateStart={onRotateStart}
          onRotate={onRotate}
          onRotateEnd={onRotateEnd}
        />
      ))}
    </Group>
  );
}
