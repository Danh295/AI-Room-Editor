import { useState } from 'react';
import {
  MM_PER_FOOT,
  formatArea,
  formatLength,
  rectangularRoom,
  lShapedRoom,
  roomArea,
  roomPolygon,
  wallLength,
  setWallLength,
  deleteWall,
  deleteOpening,
  resizeOpening,
  defaultGridStep,
} from '@room/shared';
import { useEditor, idKind } from '../store/editorStore.js';
import LengthInput from '../components/LengthInput.js';
import { fitRoomToView } from '../canvas/PlanCanvas.js';
import FloorplanDialog from './FloorplanDialog.js';

/** Quick-room dialog: width x length, optionally with a notch. */
function QuickRoom({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const units = project?.settings.units ?? 'imperial';

  const [shape, setShape] = useState<'rect' | 'L'>('rect');
  const [width, setWidth] = useState(Math.round(12 * MM_PER_FOOT));
  const [depth, setDepth] = useState(Math.round(10 * MM_PER_FOOT));
  const [notchW, setNotchW] = useState(Math.round(4 * MM_PER_FOOT));
  const [notchD, setNotchD] = useState(Math.round(3 * MM_PER_FOOT));

  const existing = project ? project.room.walls.length > 0 : false;

  function create() {
    if (!project) return;
    const thickness = project.settings.defaultWallThickness;
    edit((d) => {
      d.room = {
        ...d.room,
        ...(shape === 'rect'
          ? rectangularRoom(width, depth, thickness)
          : lShapedRoom(width, depth, notchW, notchD, thickness)),
        ceilingHeight: d.room.ceilingHeight,
      };
      // The old outline is gone, so openings that referenced it must go too.
      d.room.openings = [];
    });
    setTimeout(fitRoomToView, 0);
    onClose();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>New room shape</h3>

        {existing && (
          <div className="banner warn">
            This replaces the walls you already have. Undo with{' '}
            <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> if it isn’t what you
            wanted.
          </div>
        )}

        <div className="field-row">
          <label>Shape</label>
          <select value={shape} onChange={(e) => setShape(e.target.value as 'rect' | 'L')}>
            <option value="rect">Rectangular</option>
            <option value="L">L-shaped</option>
          </select>
        </div>

        <div className="field-row">
          <label>Width</label>
          <LengthInput value={width} units={units} onCommit={setWidth} aria-label="Room width" />
        </div>
        <div className="field-row">
          <label>Length</label>
          <LengthInput value={depth} units={units} onCommit={setDepth} aria-label="Room length" />
        </div>

        {shape === 'L' && (
          <>
            <div className="field-row">
              <label>Notch width</label>
              <LengthInput
                value={notchW}
                units={units}
                onCommit={setNotchW}
                aria-label="Notch width"
              />
            </div>
            <div className="field-row">
              <label>Notch depth</label>
              <LengthInput
                value={notchD}
                units={units}
                onCommit={setNotchD}
                aria-label="Notch depth"
              />
            </div>
          </>
        )}

        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoomPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const edit = useEditor((s) => s.edit);
  const updateSettings = useEditor((s) => s.updateSettings);
  const select = useEditor((s) => s.select);
  const [quickOpen, setQuickOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  if (!project) return <span className="muted">No room open.</span>;

  const { room, settings } = project;
  const units = settings.units;
  const polygon = roomPolygon(room);

  const selectedWall = selection.map(idKind).includes('wall')
    ? room.walls.find((w) => w.id === selection.find((id) => idKind(id) === 'wall'))
    : undefined;

  const selectedOpening = room.openings.find(
    (o) => o.id === selection.find((id) => idKind(id) === 'opening'),
  );

  return (
    <>
      <h2>Room</h2>

      <div className="stat-grid">
        <span>Walls</span>
        <b>{room.walls.length}</b>
        <span>Area</span>
        <b>{polygon.length >= 3 ? formatArea(roomArea(room), units) : '—'}</b>
        <span>Ceiling</span>
        <b>{formatLength(room.ceilingHeight, units)}</b>
      </div>

      <div className="button-row">
        <button onClick={() => setQuickOpen(true)}>Quick room…</button>
        <button onClick={() => setTraceOpen(true)}>Trace a plan…</button>
        <button onClick={fitRoomToView} disabled={polygon.length === 0}>
          Fit to view
        </button>
      </div>

      {selectedWall && (
        <>
          <h2>Selected wall</h2>
          <div className="field-row">
            <label>Length</label>
            <LengthInput
              value={Math.round(wallLength(room, selectedWall))}
              units={units}
              autoFocus
              aria-label="Wall length"
              onCommit={(mm) =>
                edit((d) => {
                  setWallLength(d.room, selectedWall.id, mm);
                })
              }
            />
          </div>
          <div className="field-row">
            <label>Thickness</label>
            <LengthInput
              value={selectedWall.thickness}
              units={units}
              aria-label="Wall thickness"
              onCommit={(mm) =>
                edit((d) => {
                  const w = d.room.walls.find((x) => x.id === selectedWall.id);
                  if (w && mm > 0) w.thickness = mm;
                })
              }
            />
          </div>
          <div className="button-row">
            <button
              className="danger"
              onClick={() => {
                edit((d) => deleteWall(d.room, selectedWall.id));
                select([]);
              }}
            >
              Delete wall
            </button>
          </div>
        </>
      )}

      {selectedOpening && (
        <>
          <h2>Selected {selectedOpening.kind}</h2>
          <div className="field-row">
            <label>Width</label>
            <LengthInput
              value={selectedOpening.width}
              units={units}
              autoFocus
              aria-label="Opening width"
              onCommit={(mm) =>
                edit((d) => {
                  resizeOpening(d.room, selectedOpening.id, mm);
                })
              }
            />
          </div>
          {selectedOpening.kind === 'door' && selectedOpening.swing && (
            <div className="button-row">
              <button
                onClick={() =>
                  edit((d) => {
                    const o = d.room.openings.find((x) => x.id === selectedOpening.id);
                    if (o?.swing) o.swing.hinge = o.swing.hinge === 'a' ? 'b' : 'a';
                  })
                }
              >
                Flip hinge
              </button>
              <button
                onClick={() =>
                  edit((d) => {
                    const o = d.room.openings.find((x) => x.id === selectedOpening.id);
                    if (o?.swing) o.swing.into = o.swing.into === 'in' ? 'out' : 'in';
                  })
                }
              >
                Flip swing
              </button>
            </div>
          )}
          <div className="button-row">
            <button
              className="danger"
              onClick={() => {
                edit((d) => deleteOpening(d.room, selectedOpening.id));
                select([]);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      <h2>Display</h2>
      <div className="field-row">
        <label>Units</label>
        <select
          value={units}
          onChange={(e) => {
            const next = e.target.value as 'imperial' | 'metric';
            // Re-base the grid on the new system, so an imperial project
            // doesn't keep snapping to a 10mm grid it can't express cleanly.
            updateSettings({ units: next, gridStep: defaultGridStep(next) });
          }}
        >
          <option value="imperial">Feet &amp; inches</option>
          <option value="metric">Metric</option>
        </select>
      </div>

      <div className="field-row">
        <label>Grid</label>
        <LengthInput
          value={settings.gridStep}
          units={units}
          aria-label="Grid step"
          onCommit={(mm) => mm > 0 && updateSettings({ gridStep: mm })}
        />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.showGrid}
          onChange={(e) => updateSettings({ showGrid: e.target.checked })}
        />
        Show grid
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.snapToGrid}
          onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
        />
        Snap to grid
      </label>
      {room.underlay && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={room.underlay.visible}
            onChange={(e) =>
              edit((d) => {
                if (d.room.underlay) d.room.underlay.visible = e.target.checked;
              })
            }
          />
          Show traced image
        </label>
      )}

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.showDimensions}
          onChange={(e) => updateSettings({ showDimensions: e.target.checked })}
        />
        Show dimensions
      </label>

      {quickOpen && <QuickRoom onClose={() => setQuickOpen(false)} />}
      {traceOpen && <FloorplanDialog units={units} onClose={() => setTraceOpen(false)} />}
    </>
  );
}
