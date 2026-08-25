import { useState } from 'react';
import type { FloorplanTraceResult, Room, UnitSystem } from '@room/shared';
import {
  addOpeningNearPoint,
  formatLength,
  roomFromPolygon,
  parseLength,
} from '@room/shared';
import { api } from '../api.js';
import { useEditor } from '../store/editorStore.js';
import { fitRoomToView } from '../canvas/PlanCanvas.js';

export interface FloorplanDialogProps {
  units: UnitSystem;
  onClose: () => void;
}

interface Loaded {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Trace a floor plan image into walls.
 *
 * The traced outline is always approximate, so the source image is kept as a
 * canvas underlay and the user corrects corners against it by dragging. That
 * relationship is the point of the feature: the AI does the tedious part
 * (finding the corners and openings at all) and the human does the precise part.
 */
export default function FloorplanDialog({ units, onClose }: FloorplanDialogProps) {
  const edit = useEditor((s) => s.edit);
  const project = useEditor((s) => s.project);

  const [image, setImage] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<FloorplanTraceResult | null>(null);
  /** Manual scale entry, used when the trace couldn't read one. */
  const [knownLength, setKnownLength] = useState('');

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('could not read that file'));
        reader.readAsDataURL(file);
      });

      // Natural size matters: the trace prompt states it, and coordinates come
      // back in that space.
      const { width, height } = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          const img = new window.Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error('that file is not an image'));
          img.src = dataUrl;
        },
      );

      setImage({ dataUrl, width, height });
      setTrace(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runTrace() {
    if (!image || busy) return;
    setBusy(true);
    setError(null);
    try {
      const mimeType = image.dataUrl.slice(5, image.dataUrl.indexOf(';')) || 'image/png';
      setTrace(await api.ingestFloorplan2(image.dataUrl, mimeType, image.width, image.height));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** The scale to apply: the traced one, or one derived from a typed length. */
  function resolveScale(): number | null {
    if (trace?.scaleMmPerPx) return trace.scaleMmPerPx;
    if (!trace || trace.polygonPx.length < 2) return null;

    const mm = parseLength(knownLength, units);
    if (mm === null || mm <= 0) return null;

    // Interpret the typed length as the longest traced wall — the one a plan
    // most often labels, and the least sensitive to a per-corner error.
    let longest = 0;
    for (let i = 0; i < trace.polygonPx.length; i += 1) {
      const a = trace.polygonPx[i]!;
      const b = trace.polygonPx[(i + 1) % trace.polygonPx.length]!;
      longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
    }
    return longest > 0 ? mm / longest : null;
  }

  async function apply() {
    if (!trace || !image || !project) return;
    const scale = resolveScale();
    if (!scale) {
      setError('Set a scale first — type the real length of the longest wall.');
      return;
    }

    setBusy(true);
    try {
      // Cache the source image so it can sit under the plan while you correct it.
      const { assetId } = await api.uploadImage(image.dataUrl);
      const thickness = project.settings.defaultWallThickness;

      const worldPolygon = trace.polygonPx.map((p) => ({ x: p.x * scale, y: p.y * scale }));

      edit((d) => {
        const traced: Room = roomFromPolygon(worldPolygon, thickness);
        d.room.vertices = traced.vertices;
        d.room.walls = traced.walls;
        d.room.openings = [];

        for (const opening of trace.openings) {
          addOpeningNearPoint(
            d.room,
            { x: opening.atPx.x * scale, y: opening.atPx.y * scale },
            {
              kind: opening.kind === 'window' ? 'window' : opening.kind === 'opening' ? 'opening' : 'door',
              width: Math.max(300, Math.round(opening.widthPx * scale)),
            },
            // Generous tolerance: a corner that's a few pixels off shouldn't
            // lose the door attached to that wall.
            Math.max(400, 30 * scale),
          );
        }

        d.room.underlay = {
          assetId,
          scaleMmPerPx: scale,
          origin: { x: 0, y: 0 },
          rotation: 0,
          opacity: 0.35,
          visible: true,
        };
      });

      setTimeout(fitRoomToView, 0);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const scale = trace ? resolveScale() : null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Trace a floor plan</h3>

        <p className="hint">
          Drop in a photo or screenshot of a floor plan. The outline it finds is a
          starting point — the image stays behind your plan so you can drag corners
          onto it.
        </p>

        <input
          type="file"
          accept="image/*"
          aria-label="Floor plan image"
          onChange={(e) => void readFile(e.target.files?.[0])}
        />

        {image && (
          <div className="plan-preview">
            <img src={image.dataUrl} alt="floor plan" />
            <span className="muted">
              {image.width} × {image.height} px
            </span>
          </div>
        )}

        {busy && <p className="hint">Reading the plan…</p>}

        {error && <div className="banner error">{error}</div>}

        {trace && (
          <>
            <div className="stat-grid" style={{ marginTop: 10 }}>
              <span>Corners found</span>
              <b>{trace.polygonPx.length}</b>
              <span>Doors &amp; windows</span>
              <b>{trace.openings.length}</b>
              <span>Confidence</span>
              <b>{trace.confidence}</b>
            </div>

            {trace.readDimensions.length > 0 && (
              <p className="hint">
                Labels read: {trace.readDimensions.map((d) => `“${d}”`).join(', ')}
              </p>
            )}

            {trace.scaleMmPerPx ? (
              <p className="hint">
                Scale: <b>{trace.scaleMmPerPx.toFixed(2)} mm per pixel</b> — the longest
                wall works out to{' '}
                <b>
                  {formatLength(
                    Math.round(
                      Math.max(
                        ...trace.polygonPx.map((p, i) => {
                          const q = trace.polygonPx[(i + 1) % trace.polygonPx.length]!;
                          return Math.hypot(q.x - p.x, q.y - p.y);
                        }),
                      ) * trace.scaleMmPerPx,
                    ),
                    units,
                  )}
                </b>
                . Correct it below if that's wrong.
              </p>
            ) : (
              <p className="hint">
                No scale could be read from the drawing. Type the real length of the
                <b> longest wall</b> to set one.
              </p>
            )}

            <div className="field-row">
              <label>Longest wall</label>
              <input
                value={knownLength}
                onChange={(e) => setKnownLength(e.target.value)}
                placeholder={units === 'imperial' ? `e.g. 16' 0"` : 'e.g. 4877'}
                aria-label="Real length of the longest wall"
              />
            </div>

            {trace.warnings.length > 0 && (
              <div className="banner warn">
                <ul className="warn-list">
                  {trace.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          {!trace ? (
            <button className="primary" onClick={() => void runTrace()} disabled={!image || busy}>
              {busy ? 'Reading…' : 'Trace it'}
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => void apply()}
              disabled={busy || !scale}
              title={!scale ? 'Set a scale first' : ''}
            >
              Replace my walls
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
