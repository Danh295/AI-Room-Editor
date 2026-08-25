import { useMemo, useState } from 'react';
import type { LibraryItem } from '@room/shared';
import { TAXONOMY, formatLength, findSubcategory } from '@room/shared';
import { useEditor } from '../store/editorStore.js';
import { assetUrl } from '../api.js';
import ItemForm from './ItemForm.js';

/** Case-insensitive match across the fields someone would actually search by. */
function matches(item: LibraryItem, query: string): boolean {
  if (query === '') return true;
  const q = query.toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    (item.brand ?? '').toLowerCase().includes(q) ||
    (item.modelNumber ?? '').toLowerCase().includes(q) ||
    item.tags.some((t) => t.toLowerCase().includes(q)) ||
    (findSubcategory(item.subcategoryId)?.subcategory.label ?? '').toLowerCase().includes(q)
  );
}

export default function LibraryPanel() {
  const library = useEditor((s) => s.library);
  const project = useEditor((s) => s.project);
  const saveLibraryItem = useEditor((s) => s.saveLibraryItem);
  const removeLibraryItem = useEditor((s) => s.removeLibraryItem);
  const placeInRoom = useEditor((s) => s.placeInRoom);

  const [query, setQuery] = useState('');
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [formFor, setFormFor] = useState<LibraryItem | null | undefined>(undefined);

  const units = project?.settings.units ?? 'imperial';

  const filtered = useMemo(() => library.filter((i) => matches(i, query)), [library, query]);

  /** Group into the taxonomy, keeping only categories that have something. */
  const grouped = useMemo(() => {
    const byCategory = new Map<string, LibraryItem[]>();
    for (const item of filtered) {
      const list = byCategory.get(item.categoryId) ?? [];
      list.push(item);
      byCategory.set(item.categoryId, list);
    }
    return TAXONOMY.map((c) => ({ category: c, items: byCategory.get(c.id) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [filtered]);

  // While searching, expand everything — collapsed groups hide the results.
  const searching = query.trim() !== '';

  function placeCentre(item: LibraryItem) {
    if (!project) return;
    const vertices = Object.values(project.room.vertices);
    // Drop it in the middle of the room, or at the origin if there's no room yet.
    const centre = vertices.length
      ? {
          x: Math.round(vertices.reduce((s, v) => s + v.x, 0) / vertices.length),
          y: Math.round(vertices.reduce((s, v) => s + v.y, 0) / vertices.length),
        }
      : { x: 0, y: 0 };
    placeInRoom(item.id, centre.x, centre.y);
  }

  return (
    <>
      <div className="library-head">
        <h2>Library</h2>
        <button className="linky" onClick={() => setFormFor(null)}>
          + Add
        </button>
      </div>

      <input
        className="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search furniture…"
        aria-label="Search library"
      />

      {library.length === 0 && (
        <p className="hint">
          Nothing here yet. <b>+ Add</b> enters a piece by hand — name, category, and
          W×D×H is enough. AI lookup from a URL or photo arrives in the next phase.
        </p>
      )}

      {library.length > 0 && filtered.length === 0 && (
        <p className="hint">No matches for “{query}”.</p>
      )}

      {grouped.map(({ category, items }) => {
        const open = searching || openCategories.has(category.id);
        return (
          <div key={category.id} className="cat-group">
            <button
              className="cat-header"
              aria-expanded={open}
              onClick={() =>
                setOpenCategories((prev) => {
                  const next = new Set(prev);
                  if (next.has(category.id)) next.delete(category.id);
                  else next.add(category.id);
                  return next;
                })
              }
            >
              <span className="caret">{open ? '▾' : '▸'}</span>
              {category.label}
              <span className="count">{items.length}</span>
            </button>

            {open && (
              <div className="card-list">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="item-card"
                    draggable
                    onDragStart={(e) => {
                      // The canvas reads this to place the item where it's dropped.
                      e.dataTransfer.setData('application/x-room-item', item.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title="Drag onto the plan, or double-click to drop it in the middle"
                    onDoubleClick={() => placeCentre(item)}
                  >
                    {item.imageAssetId ? (
                      <img src={assetUrl(item.imageAssetId)} alt="" className="card-thumb" />
                    ) : (
                      <div
                        className="card-thumb swatchy"
                        style={{ background: item.variants[0]?.hex ?? '#5a6270' }}
                      />
                    )}

                    <div className="card-body">
                      <div className="card-name">{item.name}</div>
                      <div className="card-meta">
                        {formatLength(item.w, units)} × {formatLength(item.d, units)}
                        {item.price != null && ` · $${item.price}`}
                      </div>
                    </div>

                    <div className="card-actions">
                      <button
                        className="icon-btn"
                        title="Edit"
                        onClick={() => setFormFor(item)}
                        aria-label={`Edit ${item.name}`}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn danger"
                        title="Delete from library"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => void removeLibraryItem(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {formFor !== undefined && (
        <ItemForm
          existing={formFor}
          units={units}
          onSave={(item) => void saveLibraryItem(item)}
          onClose={() => setFormFor(undefined)}
        />
      )}
    </>
  );
}
