import { useState } from 'react';
import type {
  Clearances,
  Footprint,
  Layer,
  LibraryItem,
  PlacedItem,
  UnitSystem,
} from '@room/shared';
import {
  LAYER_ORDER,
  effectiveClearances,
  effectiveSize,
  findSubcategory,
  formatLength,
} from '@room/shared';
import { useEditor, idKind } from '../store/editorStore.js';
import LengthInput from '../components/LengthInput.js';
import ItemForm from './ItemForm.js';

const LAYER_LABEL: Record<Layer, string> = {
  rug: 'Rug (under everything)',
  floor: 'On the floor',
  onTop: 'On top of something',
  wall: 'Wall-mounted',
  ceiling: 'Ceiling-mounted',
};

const CORNERS: { id: 'nw' | 'ne' | 'sw' | 'se'; label: string }[] = [
  { id: 'nw', label: '◤' },
  { id: 'ne', label: '◥' },
  { id: 'sw', label: '◣' },
  { id: 'se', label: '◢' },
];

const SIDES: (keyof Clearances)[] = ['front', 'back', 'left', 'right'];

/**
 * A length field that shows the effective value and, when the placement
 * overrides the catalog, a revert control beside the label. Overrides are how
 * "I trimmed two inches off this one shelf" stays out of the entry every other
 * placement shares, so which state you're in has to be visible rather than
 * inferred from a remembered edit.
 *
 * Omit `onRevert` for fields that have no catalog value to fall back to.
 */
function LengthRow({
  label,
  value,
  overridden,
  units,
  disabled,
  onCommit,
  onRevert,
}: {
  label: string;
  value: number;
  overridden?: boolean;
  units: UnitSystem;
  disabled: boolean;
  onCommit: (mm: number) => void;
  onRevert?: () => void;
}) {
  return (
    <div className="field-row">
      <label>
        {label}
        {overridden && onRevert && (
          <button
            className="linky"
            type="button"
            onClick={onRevert}
            disabled={disabled}
            title="Go back to the library item's value"
          >
            revert
          </button>
        )}
      </label>
      <LengthInput
        value={value}
        units={units}
        disabled={disabled}
        onCommit={onCommit}
        aria-label={label}
      />
    </div>
  );
}

/** Controls that apply sensibly to a whole multi-selection. */
function MultiSelection({ ids }: { ids: string[] }) {
  const rotateSelection = useEditor((s) => s.rotateSelection);
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const updatePlacement = useEditor((s) => s.updatePlacement);
  const beginGesture = useEditor((s) => s.beginGesture);
  const endGesture = useEditor((s) => s.endGesture);
  const items = useEditor((s) => s.project?.items ?? []);

  const selected = items.filter((i) => ids.includes(i.id));
  const allLocked = selected.length > 0 && selected.every((i) => i.locked);

  /**
   * Patch every selected item as one undo entry. Without the gesture wrapper,
   * "lock all" on six pieces takes six Ctrl+Z presses to walk back.
   */
  function patchAll(patch: Partial<PlacedItem>) {
    beginGesture();
    selected.forEach((i) => updatePlacement(i.id, patch));
    endGesture();
  }

  return (
    <>
      <h2>{ids.length} items selected</h2>
      <p className="hint">
        Per-item dimensions need a single selection. These apply to everything selected.
      </p>

      <div className="button-row">
        <button onClick={() => rotateSelection(-90)}>Rotate −90°</button>
        <button onClick={() => rotateSelection(90)}>Rotate +90°</button>
      </div>

      <div className="button-row">
        <button onClick={() => patchAll({ locked: !allLocked })}>
          {allLocked ? 'Unlock all' : 'Lock all'}
        </button>
      </div>

      <h2>Layer</h2>
      <div className="field-row">
        <label>Set all to</label>
        <select
          value=""
          aria-label="Set layer for all selected"
          onChange={(e) => {
            const layer = e.target.value as Layer;
            if (layer) patchAll({ layer });
          }}
        >
          <option value="">Choose…</option>
          {(Object.keys(LAYER_ORDER) as Layer[]).map((l) => (
            <option key={l} value={l}>
              {LAYER_LABEL[l]}
            </option>
          ))}
        </select>
      </div>

      <div className="button-row">
        <button className="danger" onClick={deleteSelection} disabled={allLocked}>
          Delete {ids.length} items
        </button>
      </div>
      {allLocked && <p className="hint">Locked items can’t be deleted — unlock them first.</p>}
    </>
  );
}

/** Everything about one placed item. */
function SingleItem({ placed, item }: { placed: PlacedItem; item: LibraryItem | undefined }) {
  const project = useEditor((s) => s.project);
  const updatePlacement = useEditor((s) => s.updatePlacement);
  const removePlacement = useEditor((s) => s.removePlacement);
  const saveLibraryItem = useEditor((s) => s.saveLibraryItem);
  const [editProduct, setEditProduct] = useState(false);

  const units = project?.settings.units ?? 'imperial';

  // A placement whose library entry was deleted still has to be reachable, or
  // the user has an object on the plan they can select but never remove.
  if (!item) {
    return (
      <>
        <h2>Missing item</h2>
        <div className="banner error">
          The library entry this placement points to is gone. Delete it, or re-add the
          product to the library with the same id.
        </div>
        <div className="button-row">
          <button className="danger" onClick={() => removePlacement(placed.id)}>
            Delete placement
          </button>
        </div>
      </>
    );
  }

  const size = effectiveSize(placed, item);
  const clear = effectiveClearances(placed, item);
  const footprint: Footprint = placed.footprint ?? item.footprint;
  const category = findSubcategory(item.subcategoryId);
  const locked = placed.locked;

  /** Wrap into [0,360) the way `rotateSelection` does. */
  function rotateBy(deltaDeg: number) {
    updatePlacement(placed.id, { rotation: (((placed.rotation + deltaDeg) % 360) + 360) % 360 });
  }

  /** Patch one clearance side, leaving the other overrides alone. */
  function setClearance(side: keyof Clearances, mm: number) {
    updatePlacement(placed.id, { clearances: { ...placed.clearances, [side]: mm } });
  }

  function revertClearance(side: keyof Clearances) {
    const next = { ...placed.clearances };
    delete next[side];
    updatePlacement(placed.id, { clearances: next });
  }

  return (
    <>
      <h2>{item.name}</h2>
      <div className="stat-grid">
        <span>Category</span>
        <b>{category?.subcategory.label ?? item.subcategoryId}</b>
        {item.brand && (
          <>
            <span>Brand</span>
            <b>{item.brand}</b>
          </>
        )}
        <span>Catalog size</span>
        <b>
          {formatLength(item.w, units)} × {formatLength(item.d, units)}
        </b>
      </div>

      <div className="button-row">
        <button onClick={() => setEditProduct(true)}>Edit product…</button>
      </div>
      <p className="hint">
        “Edit product” changes the library entry and every placement of it. The fields
        below change only this one.
      </p>

      {locked && (
        <div className="banner warn">
          Locked. Unlock below to move, resize, or delete this piece.
        </div>
      )}

      <h2>Position</h2>
      <div className="field-row">
        <label>Across (X)</label>
        <LengthInput
          value={placed.x}
          units={units}
          disabled={locked}
          onCommit={(mm) => updatePlacement(placed.id, { x: mm })}
          aria-label="X position"
        />
      </div>
      <div className="field-row">
        <label>Down (Y)</label>
        <LengthInput
          value={placed.y}
          units={units}
          disabled={locked}
          onCommit={(mm) => updatePlacement(placed.id, { y: mm })}
          aria-label="Y position"
        />
      </div>
      <div className="field-row">
        <label>Height off floor</label>
        <LengthInput
          value={placed.z}
          units={units}
          disabled={locked}
          onCommit={(mm) => updatePlacement(placed.id, { z: mm })}
          aria-label="Height off floor"
        />
      </div>

      <div className="field-row">
        <label>Rotation</label>
        <input
          type="number"
          value={Math.round(placed.rotation)}
          disabled={locked}
          aria-label="Rotation in degrees"
          onChange={(e) => {
            const deg = Number(e.target.value);
            if (Number.isFinite(deg)) {
              updatePlacement(placed.id, { rotation: ((deg % 360) + 360) % 360 });
            }
          }}
        />
      </div>
      <div className="button-row">
        {/*
          Rotate this placement by id rather than via `rotateSelection`. The
          selection can hold a wall alongside this item, and these buttons say
          they act on the piece named at the top of the panel.
        */}
        <button onClick={() => rotateBy(-90)} disabled={locked}>
          −90°
        </button>
        <button onClick={() => rotateBy(90)} disabled={locked}>
          +90°
        </button>
        <button
          onClick={() => updatePlacement(placed.id, { flipX: !placed.flipX })}
          disabled={locked}
          title="Mirror left-to-right — a chaise on the other end of a sectional"
        >
          {placed.flipX ? 'Unflip' : 'Flip'}
        </button>
      </div>

      <h2>Size</h2>
      <LengthRow
        label="Width"
        value={size.w}
        overridden={placed.w !== undefined}
        units={units}
        disabled={locked}
        onCommit={(mm) => updatePlacement(placed.id, { w: mm })}
        onRevert={() => updatePlacement(placed.id, { w: undefined })}
      />
      <LengthRow
        label="Depth"
        value={size.d}
        overridden={placed.d !== undefined}
        units={units}
        disabled={locked}
        onCommit={(mm) => updatePlacement(placed.id, { d: mm })}
        onRevert={() => updatePlacement(placed.id, { d: undefined })}
      />
      <LengthRow
        label="Height"
        value={size.h}
        overridden={placed.h !== undefined}
        units={units}
        disabled={locked}
        onCommit={(mm) => updatePlacement(placed.id, { h: mm })}
        onRevert={() => updatePlacement(placed.id, { h: undefined })}
      />

      <h2>Clearances</h2>
      <p className="hint">
        {category?.subcategory.clearanceNote ??
          'Space this piece needs around it to be usable.'}
      </p>
      {SIDES.map((side) => (
        <LengthRow
          key={side}
          label={side[0]!.toUpperCase() + side.slice(1)}
          value={clear[side]}
          overridden={placed.clearances?.[side] !== undefined}
          units={units}
          disabled={locked}
          onCommit={(mm) => setClearance(side, mm)}
          onRevert={() => revertClearance(side)}
        />
      ))}

      {item.variants.length > 0 && (
        <>
          <h2>Colour</h2>
          <div className="swatch-row">
            {item.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={
                  (placed.variantId ?? item.variants[0]?.id) === v.id ? 'swatch active' : 'swatch'
                }
                style={{ background: v.hex }}
                disabled={locked}
                title={v.label}
                aria-label={`Colour ${v.label}`}
                onClick={() => updatePlacement(placed.id, { variantId: v.id })}
              />
            ))}
          </div>
        </>
      )}

      <h2>Shape</h2>
      <div className="field-row">
        <label>Footprint</label>
        <select
          value={footprint.kind}
          disabled={locked || footprint.kind === 'poly'}
          aria-label="Footprint shape"
          onChange={(e) => {
            const kind = e.target.value;
            updatePlacement(placed.id, {
              footprint:
                kind === 'L'
                  ? { kind: 'L', notchW: 0.4, notchD: 0.4, corner: 'ne' }
                  : { kind: 'rect' },
            });
          }}
        >
          <option value="rect">Rectangle</option>
          <option value="L">L-shaped</option>
          {footprint.kind === 'poly' && <option value="poly">Custom outline</option>}
        </select>
      </div>

      {footprint.kind === 'poly' && (
        <p className="hint">
          This item has a custom outline. Editing its points isn’t supported yet — switch
          the library item to a rectangle or L-shape to change it here.
        </p>
      )}

      {footprint.kind === 'L' && (
        <>
          {/*
            The notch is stored as a 0..1 fraction of the bounding box so it
            survives a resize, but nobody thinks in fractions of a sofa — show
            and accept real lengths, and convert at the boundary.
          */}
          <LengthRow
            label="Notch width"
            value={Math.round(footprint.notchW * size.w)}
            overridden={false}
            units={units}
            disabled={locked}
            onCommit={(mm) =>
              updatePlacement(placed.id, {
                footprint: { ...footprint, notchW: Math.min(Math.max(mm / size.w, 0.01), 0.99) },
              })
            }
            onRevert={() => undefined}
          />
          <LengthRow
            label="Notch depth"
            value={Math.round(footprint.notchD * size.d)}
            overridden={false}
            units={units}
            disabled={locked}
            onCommit={(mm) =>
              updatePlacement(placed.id, {
                footprint: { ...footprint, notchD: Math.min(Math.max(mm / size.d, 0.01), 0.99) },
              })
            }
            onRevert={() => undefined}
          />
          <div className="field-row">
            <label>Cut corner</label>
            <div className="button-row" style={{ margin: 0 }}>
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  className={footprint.corner === c.id ? 'tool active' : 'tool'}
                  disabled={locked}
                  aria-pressed={footprint.corner === c.id}
                  aria-label={`Notch the ${c.id} corner`}
                  onClick={() =>
                    updatePlacement(placed.id, { footprint: { ...footprint, corner: c.id } })
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <h2>Layer</h2>
      <div className="field-row">
        <label>Draws on</label>
        <select
          value={placed.layer}
          disabled={locked}
          aria-label="Layer"
          onChange={(e) => updatePlacement(placed.id, { layer: e.target.value as Layer })}
        >
          {(Object.keys(LAYER_ORDER) as Layer[]).map((l) => (
            <option key={l} value={l}>
              {LAYER_LABEL[l]}
            </option>
          ))}
        </select>
      </div>

      <h2>Notes</h2>
      <div className="field-row">
        <label>Note</label>
        <input
          value={placed.notes ?? ''}
          disabled={locked}
          aria-label="Placement note"
          placeholder="Swap with the armchair?"
          onChange={(e) => updatePlacement(placed.id, { notes: e.target.value || undefined })}
        />
      </div>
      <div className="field-row">
        <label>Tags</label>
        <input
          value={placed.tags.join(', ')}
          disabled={locked}
          aria-label="Tags"
          placeholder="keep, phase-2"
          onChange={(e) =>
            updatePlacement(placed.id, {
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => updatePlacement(placed.id, { locked: e.target.checked })}
        />
        Lock in place
      </label>

      <div className="button-row">
        <button
          className="danger"
          disabled={locked}
          onClick={() => removePlacement(placed.id)}
          title={locked ? 'Unlock it first' : 'Remove this piece from the plan'}
        >
          Remove from plan
        </button>
      </div>

      {editProduct && (
        <ItemForm
          existing={item}
          units={units}
          onSave={(next) => void saveLibraryItem(next)}
          onClose={() => setEditProduct(false)}
        />
      )}
    </>
  );
}

/**
 * The right-hand panel when furniture is selected.
 *
 * Everything here writes per-placement overrides through `updatePlacement`;
 * the catalog entry is only touched by the explicit "Edit product" path.
 */
export default function ItemPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const library = useEditor((s) => s.library);

  const ids = selection.filter((id) => idKind(id) === 'item');
  if (!project || ids.length === 0) return null;

  if (ids.length > 1) return <MultiSelection ids={ids} />;

  const placed = project.items.find((i) => i.id === ids[0]);
  if (!placed) return null;

  return <SingleItem placed={placed} item={library.find((i) => i.id === placed.libraryId)} />;
}
