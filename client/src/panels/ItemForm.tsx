import { useState } from 'react';
import type { Confidence, LibraryItem, ProductDraft, UnitSystem, Variant } from '@room/shared';
import {
  TAXONOMY,
  createLibraryItem,
  defaultClearances,
  defaultFootprint,
  findSubcategory,
  newId,
  MM_PER_INCH,
} from '@room/shared';
import LengthInput from '../components/LengthInput.js';
import { api, assetUrl } from '../api.js';

const SWATCHES = [
  '#8d99ae', '#4a4e69', '#2b2d42', '#d6ccc2',
  '#b08968', '#7f5539', '#344e41', '#588157',
  '#9d4edd', '#e07a5f', '#f2cc8f', '#e6e8ec',
];

export interface ItemFormProps {
  /** Editing an existing item, or null to create a new one. */
  existing: LibraryItem | null;
  units: UnitSystem;
  onSave: (item: LibraryItem) => void;
  onClose: () => void;
  /** An AI lookup result to pre-fill from. Every field stays editable. */
  draft?: ProductDraft | null;
  /** Sources the lookup used, shown so a number can be checked. */
  research?: { text: string; citations: { title: string; url: string }[]; model: string } | null;
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'from the manufacturer or a major retailer',
  medium: 'from a secondary source, or sources disagreed',
  low: 'typical for the type, not measured',
  manual: 'entered by hand',
};

/** A small confidence chip next to a pre-filled field. */
function Conf({ level }: { level?: Confidence }) {
  if (!level || level === 'manual') return null;
  return (
    <span className={`conf conf-${level}`} title={CONFIDENCE_LABEL[level]}>
      {level}
    </span>
  );
}

/**
 * Manual entry and editing for a library item.
 *
 * This ships before the AI ingestion path deliberately: it's the fallback when
 * a lookup fails, and the AI's review card is this same form pre-filled, so
 * there's exactly one place where a product's fields are defined and validated.
 */
export default function ItemForm({
  existing,
  units,
  onSave,
  onClose,
  draft,
  research,
}: ItemFormProps) {
  const [name, setName] = useState(existing?.name ?? draft?.name.value ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? draft?.brand?.value ?? '');
  const [modelNumber, setModelNumber] = useState(
    existing?.modelNumber ?? draft?.modelNumber?.value ?? '',
  );
  const [subcategoryId, setSubcategoryId] = useState(
    existing?.subcategoryId ?? draft?.subcategoryId.value ?? 'sofa',
  );
  const [w, setW] = useState(existing?.w ?? draft?.w.value ?? Math.round(84 * MM_PER_INCH));
  const [d, setD] = useState(existing?.d ?? draft?.d.value ?? Math.round(38 * MM_PER_INCH));
  const [h, setH] = useState(existing?.h ?? draft?.h.value ?? Math.round(34 * MM_PER_INCH));
  const [price, setPrice] = useState(
    existing?.price != null
      ? String(existing.price)
      : draft?.price?.value != null
        ? String(draft.price.value)
        : '',
  );
  const [sourceUrl, setSourceUrl] = useState(existing?.sourceUrl ?? draft?.sourceUrl ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [variants, setVariants] = useState<Variant[]>(
    existing?.variants.length
      ? existing.variants
      : draft?.variants.length
        ? draft.variants
        : [{ id: newId('var'), label: 'Default', hex: SWATCHES[0]! }],
  );
  const [imageAssetId, setImageAssetId] = useState(existing?.imageAssetId ?? draft?.imageAssetId);
  const [showNotes, setShowNotes] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const found = findSubcategory(subcategoryId);
  const typical = found?.subcategory.typical;
  const nameOk = name.trim().length > 0;
  const dimsOk = w > 0 && d > 0 && h > 0;

  /** Prefill dimensions from the category's typical size — a starting point. */
  function useTypical() {
    if (!typical) return;
    setW(typical.w);
    setD(typical.d);
    setH(typical.h);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('could not read that file'));
        reader.readAsDataURL(file);
      });
      const { assetId } = await api.uploadImage(dataUrl);
      setImageAssetId(assetId);
    } catch (err) {
      setImageError((err as Error).message);
    } finally {
      setImageBusy(false);
    }
  }

  function save() {
    if (!nameOk || !dimsOk) return;

    const parsedPrice = price.trim() === '' ? undefined : Number(price);
    const base = existing
      ? { ...existing }
      : createLibraryItem({ name: name.trim(), subcategoryId, w, d, h });

    const item: LibraryItem = {
      ...base,
      // A confirmed lookup keeps its provenance so a suspicious dimension can
      // be traced back later; anything typed by hand is marked as such.
      confidence: draft ? draft.w.confidence : 'manual',
      provenance: draft
        ? draft.provenance
        : { method: 'manual', citations: [], capturedAt: new Date().toISOString() },
      name: name.trim(),
      brand: brand.trim() || undefined,
      modelNumber: modelNumber.trim() || undefined,
      categoryId: found?.category.id ?? 'other',
      subcategoryId: found?.subcategory.id ?? 'uncategorized',
      w,
      d,
      h,
      // Changing category should bring its footprint and clearances along,
      // unless this item already had them customized.
      footprint:
        existing && existing.subcategoryId === subcategoryId
          ? existing.footprint
          : defaultFootprint(subcategoryId),
      clearances:
        existing && existing.subcategoryId === subcategoryId
          ? existing.clearances
          : defaultClearances(subcategoryId),
      variants,
      price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      imageAssetId,
      notes: notes.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    onSave(item);
    onClose();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{existing ? 'Edit item' : draft ? 'Confirm before adding' : 'Add item manually'}</h3>

        {draft && (
          <div className="review-head">
            <p className="hint" style={{ margin: '0 0 8px' }}>
              Nothing is saved until you press Add. Every field below is editable —
              correct anything that looks wrong.
            </p>

            {draft.warnings.length > 0 && (
              <div className="banner warn">
                <ul className="warn-list">
                  {draft.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {draft.w.citedText && (
              <p className="hint" style={{ margin: '0 0 8px' }}>
                Source stated: <b>{draft.w.citedText}</b>
              </p>
            )}

            {research && research.citations.length > 0 && (
              <p className="hint" style={{ margin: '0 0 4px' }}>
                Sources:{' '}
                {research.citations.map((c, i) => (
                  <span key={c.url}>
                    {i > 0 && ', '}
                    <a href={c.url} target="_blank" rel="noreferrer noopener">
                      {c.title}
                    </a>
                  </span>
                ))}
              </p>
            )}

            {research && (
              <>
                <button className="linky" type="button" onClick={() => setShowNotes((v) => !v)}>
                  {showNotes ? 'Hide' : 'Show'} what the model read
                </button>
                {showNotes && <pre className="research-notes">{research.text}</pre>}
              </>
            )}
          </div>
        )}

        <div className="field-row">
          <label>
            Name * <Conf level={draft?.name.confidence} />
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="KIVIK 3-seat sofa"
            aria-label="Item name"
            autoFocus
          />
        </div>

        <div className="field-row">
          <label>Brand</label>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand" />
        </div>

        <div className="field-row">
          <label>Model no.</label>
          <input
            value={modelNumber}
            onChange={(e) => setModelNumber(e.target.value)}
            aria-label="Model number"
          />
        </div>

        <div className="field-row">
          <label>Category</label>
          <select
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            aria-label="Category"
          >
            {TAXONOMY.map((c) => (
              <optgroup key={c.id} label={c.label}>
                {c.subcategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="dims-row">
          <div>
            <label>
              Width <Conf level={draft?.w.confidence} />
            </label>
            <LengthInput value={w} units={units} onCommit={setW} aria-label="Width" />
          </div>
          <div>
            <label>Depth</label>
            <LengthInput value={d} units={units} onCommit={setD} aria-label="Depth" />
          </div>
          <div>
            <label>Height</label>
            <LengthInput value={h} units={units} onCommit={setH} aria-label="Height" />
          </div>
        </div>

        {typical && (
          <button className="linky" onClick={useTypical} type="button">
            Use typical size for a {found?.subcategory.label.toLowerCase()}
          </button>
        )}

        {found && (
          <p className="hint">
            Clearance: {found.subcategory.clearanceNote ?? 'none needed for this category.'}
          </p>
        )}

        <div className="field-row">
          <label>Price</label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="899"
            inputMode="decimal"
            aria-label="Price"
          />
        </div>

        <div className="field-row">
          <label>Source URL</label>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Source URL"
          />
        </div>

        <h4>Colour</h4>
        <div className="swatch-row">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              className={variants[0]?.hex === hex ? 'swatch active' : 'swatch'}
              style={{ background: hex }}
              aria-label={`Colour ${hex}`}
              onClick={() =>
                setVariants((vs) =>
                  vs.length ? [{ ...vs[0]!, hex }, ...vs.slice(1)] : [{ id: newId('var'), label: 'Default', hex }],
                )
              }
            />
          ))}
        </div>

        <h4>Photo</h4>
        <div className="photo-row">
          {imageAssetId ? (
            <img src={assetUrl(imageAssetId)} alt="" className="thumb" />
          ) : (
            <div className="thumb empty">none</div>
          )}
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              aria-label="Item photo"
            />
            {imageBusy && <span className="muted"> uploading…</span>}
            {imageAssetId && (
              <button className="linky" type="button" onClick={() => setImageAssetId(undefined)}>
                Remove
              </button>
            )}
            {imageError && <div className="banner error">{imageError}</div>}
          </div>
        </div>

        <div className="field-row">
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </div>

        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={save}
            disabled={!nameOk || !dimsOk}
            title={!nameOk ? 'A name is required' : !dimsOk ? 'Dimensions must be positive' : ''}
          >
            {existing ? 'Save changes' : 'Add to library'}
          </button>
        </div>
      </div>
    </div>
  );
}
