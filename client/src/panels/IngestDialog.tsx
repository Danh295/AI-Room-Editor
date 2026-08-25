import { useState } from 'react';
import type { LibraryItem, UnitSystem } from '@room/shared';
import { api, type IngestProductInput, type IngestProductResult } from '../api.js';
import ItemForm from './ItemForm.js';

type Mode = 'url' | 'model' | 'query' | 'photo';

const MODES: { id: Mode; label: string; placeholder: string; blurb: string }[] = [
  {
    id: 'url',
    label: 'Product link',
    placeholder: 'https://www.ikea.com/us/en/p/…',
    blurb: 'Paste a product page. Most accurate — the lookup cross-checks the maker’s spec sheet.',
  },
  {
    id: 'model',
    label: 'Model number',
    placeholder: 'Herman Miller Aeron Size B',
    blurb: 'A model number or exact product name. Searches for the official specs.',
  },
  {
    id: 'query',
    label: 'Describe it',
    placeholder: 'west elm Andes 3-seater sofa',
    blurb: 'Rough description. Least precise — check the dimensions carefully.',
  },
  {
    id: 'photo',
    label: 'Photo',
    placeholder: 'optional hint, e.g. “it’s an IKEA sofa”',
    blurb: 'Identifies the piece, then searches for its real dimensions rather than guessing from pixels.',
  },
];

export interface IngestDialogProps {
  units: UnitSystem;
  onSave: (item: LibraryItem) => void;
  onClose: () => void;
}

/**
 * AI product lookup.
 *
 * Two steps, never one: look something up, then confirm it. The confirm step is
 * the ordinary manual entry form pre-filled, so there is one definition of what
 * a library item's fields are, and a failed lookup degrades into that same form
 * rather than a dead end.
 */
export default function IngestDialog({ units, onSave, onClose }: IngestDialogProps) {
  const [mode, setMode] = useState<Mode>('url');
  const [text, setText] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestProductResult | null>(null);
  /** Set when a lookup fails and the user chooses to enter it by hand instead. */
  const [fallbackToManual, setFallbackToManual] = useState(false);

  const active = MODES.find((m) => m.id === mode)!;
  const canSubmit = mode === 'photo' ? imageDataUrl !== null : text.trim() !== '';

  async function readFile(file: File | undefined) {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('could not read that file'));
      reader.readAsDataURL(file);
    });
    setImageDataUrl(dataUrl);
  }

  async function lookup() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);

    try {
      let input: IngestProductInput;
      if (mode === 'photo') {
        const mimeType = imageDataUrl!.slice(5, imageDataUrl!.indexOf(';'));
        input = {
          method: 'photo',
          imageBase64: imageDataUrl!,
          mimeType: mimeType || 'image/jpeg',
          hint: text.trim() || undefined,
        };
      } else if (mode === 'url') {
        input = { method: 'url', url: text.trim() };
      } else if (mode === 'model') {
        input = { method: 'model', modelNumber: text.trim() };
      } else {
        input = { method: 'query', query: text.trim() };
      }

      setResult(await api.ingestProduct(input));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Step two: the ordinary form, pre-filled and annotated.
  if (result) {
    return (
      <ItemForm
        existing={null}
        units={units}
        draft={result.draft}
        research={result.research}
        onSave={onSave}
        onClose={onClose}
      />
    );
  }

  // A failed lookup must not be a dead end.
  if (fallbackToManual) {
    return <ItemForm existing={null} units={units} onSave={onSave} onClose={onClose} />;
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Look up an item</h3>

        <div className="mode-tabs" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? 'tool active' : 'tool'}
              onClick={() => {
                setMode(m.id);
                setError(null);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <p className="hint">{active.blurb}</p>

        {mode === 'photo' && (
          <div className="photo-row" style={{ marginBottom: 10 }}>
            {imageDataUrl ? (
              <img src={imageDataUrl} alt="" className="thumb" />
            ) : (
              <div className="thumb empty">none</div>
            )}
            <input
              type="file"
              accept="image/*"
              aria-label="Furniture photo"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </div>
        )}

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={active.placeholder}
          aria-label={active.label}
          style={{ width: '100%' }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void lookup();
          }}
        />

        {busy && (
          <p className="hint" style={{ marginTop: 10 }}>
            Searching the web and reading spec sheets — this usually takes about ten seconds.
          </p>
        )}

        {error && (
          <div className="banner error" style={{ marginTop: 10 }}>
            {error}
            <div style={{ marginTop: 8 }}>
              <button className="linky" onClick={() => setFallbackToManual(true)}>
                Enter it by hand instead
              </button>
            </div>
          </div>
        )}

        <div className="dialog-actions">
          <button onClick={() => setFallbackToManual(true)}>Enter manually</button>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void lookup()} disabled={!canSubmit || busy}>
            {busy ? 'Looking up…' : 'Look up'}
          </button>
        </div>
      </div>
    </div>
  );
}
