import { useEffect, useState, useCallback } from 'react';
import type { ProjectSummary } from '@room/shared';
import { formatLength } from '@room/shared';
import { api, type Health } from './api.js';
import { useEditor, rememberProject, recallProject, type Tool } from './store/editorStore.js';
import { useViewport } from './canvas/viewport.js';
import PlanCanvas from './canvas/PlanCanvas.js';
import RoomPanel from './panels/RoomPanel.js';

const SAVE_LABEL: Record<string, string> = {
  idle: 'No project',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Select and move (Esc)' },
  { id: 'wall', label: 'Wall', hint: 'Draw walls' },
  { id: 'door', label: 'Door', hint: 'Click a wall to place a door' },
  { id: 'window', label: 'Window', hint: 'Click a wall to place a window' },
];

export default function App() {
  const project = useEditor((s) => s.project);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const loadError = useEditor((s) => s.loadError);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const loadProject = useEditor((s) => s.loadProject);
  const newProject = useEditor((s) => s.newProject);
  const loadLibrary = useEditor((s) => s.loadLibrary);
  const edit = useEditor((s) => s.edit);
  const beginGesture = useEditor((s) => s.beginGesture);
  const endGesture = useEditor((s) => s.endGesture);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const select = useEditor((s) => s.select);
  const scale = useViewport((s) => s.scale);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [health, setHealth] = useState<Health | null>(null);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      console.error('[projects]', err);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setHealth(await api.health());
      } catch {
        setHealth(null);
      }
      await refreshProjects();
      await loadLibrary();

      const last = recallProject();
      if (last) await loadProject(last);
    })();
  }, [refreshProjects, loadLibrary, loadProject]);

  useEffect(() => {
    if (project) rememberProject(project.id);
  }, [project?.id]);

  // Undo/redo and tool shortcuts. Skipped while typing, so Ctrl+Z in a field
  // does what the field expects rather than reverting the plan behind it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          undo();
        } else if ((key === 'z' && event.shiftKey) || key === 'y') {
          event.preventDefault();
          redo();
        }
        return;
      }

      // Single-key tool switches, the way every drawing app does it.
      const shortcuts: Record<string, Tool> = { v: 'select', w: 'wall', d: 'door', n: 'window' };
      const next = shortcuts[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        setTool(next);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setTool]);

  async function handleNew() {
    await newProject(`Room ${projects.length + 1}`);
    await refreshProjects();
  }

  const units = project?.settings.units ?? 'imperial';

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">AI Room Editor</span>

        {project && (
          <input
            value={project.name}
            onChange={(e) =>
              edit((draft) => {
                draft.name = e.target.value;
              })
            }
            // Without the gesture wrapper every keystroke is its own undo entry,
            // so Ctrl+Z after a rename walks back one letter at a time.
            onFocus={beginGesture}
            onBlur={endGesture}
            aria-label="Project name"
            style={{ width: 200 }}
          />
        )}

        {project && (
          <div className="toolgroup" role="toolbar" aria-label="Drawing tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={tool === t.id ? 'tool active' : 'tool'}
                aria-pressed={tool === t.id}
                title={t.hint}
                onClick={() => setTool(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <span className="spacer" />

        <button onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button className="primary" onClick={handleNew}>
          New room
        </button>
      </header>

      <div className="workspace">
        <aside className="panel">
          <h2>Projects</h2>

          {health && !health.anthropicKey && (
            <div className="banner warn">
              No <code>ANTHROPIC_API_KEY</code> set. Drawing and manual entry work
              normally; AI floor plan tracing and product lookup are unavailable
              until you add a key to <code>.env</code> and restart the server.
            </div>
          )}
          {!health && (
            <div className="banner error">
              Can’t reach the API server on <code>:8787</code>. Is <code>npm run dev</code> running?
            </div>
          )}
          {loadError && <div className="banner error">{loadError}</div>}

          <div className="project-list">
            {projects.length === 0 && <span className="muted">No rooms yet.</span>}
            {projects.map((p) => (
              <button
                key={p.id}
                className="project-row"
                aria-current={p.id === project?.id}
                onClick={() => void loadProject(p.id)}
              >
                <span>{p.name}</span>
                <span className="meta">{p.itemCount} items</span>
              </button>
            ))}
          </div>

          <h2>Library</h2>
          <span className="muted">Coming in the next phase.</span>
        </aside>

        <main className="stage">
          {!project ? (
            <div className="empty">
              <h1>No room open</h1>
              <p>
                Create a room to start drawing walls, or open one from the list on
                the left. Everything is stored as JSON on your machine.
              </p>
              <button className="primary" onClick={handleNew} style={{ marginTop: 6 }}>
                New room
              </button>
            </div>
          ) : (
            <>
              <PlanCanvas onEditWallLength={(wallId) => select([wallId])} />
              {project.room.walls.length === 0 && (
                <div className="canvas-empty">
                  <b>Empty plan.</b> Pick the <b>Wall</b> tool and click to place corners, or use{' '}
                  <b>Quick room…</b> on the right for a rectangle.
                </div>
              )}
            </>
          )}
        </main>

        <aside className="panel right">
          <RoomPanel />
        </aside>
      </div>

      <footer className="statusbar">
        <span className="save-dot" data-state={saveState}>
          {saveError ?? SAVE_LABEL[saveState]}
        </span>
        {project && (
          <>
            <span>Units: {units === 'imperial' ? 'ft-in' : 'metric'}</span>
            <span>Grid: {formatLength(project.settings.gridStep, units)}</span>
            <span>Zoom: {Math.round(scale * 1000) / 10}%</span>
            <span className="spacer" />
            <span>{past.length} undo steps</span>
          </>
        )}
      </footer>
    </div>
  );
}
