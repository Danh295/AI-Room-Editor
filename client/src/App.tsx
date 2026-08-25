import { useEffect, useState, useCallback } from 'react';
import type { ProjectSummary } from '@room/shared';
import { formatLength } from '@room/shared';
import { api, type Health } from './api.js';
import { useEditor, rememberProject, recallProject } from './store/editorStore.js';

const SAVE_LABEL: Record<string, string> = {
  idle: 'No project',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

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

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [health, setHealth] = useState<Health | null>(null);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      console.error('[projects]', err);
    }
  }, []);

  // Boot: check the server, list projects, reopen whatever was last open.
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

  // Undo/redo keybindings. Skipped while typing so Ctrl+Z in a text field does
  // what the field expects rather than reverting the plan behind it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  async function handleNew() {
    await newProject(`Room ${projects.length + 1}`);
    await refreshProjects();
  }

  function handleRename(name: string) {
    edit((draft) => {
      draft.name = name;
    });
  }

  const units = project?.settings.units ?? 'imperial';

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">AI Room Editor</span>

        {project && (
          <input
            value={project.name}
            onChange={(e) => handleRename(e.target.value)}
            // Without the gesture wrapper every keystroke is its own undo entry,
            // so Ctrl+Z after a rename walks back one letter at a time. Focus to
            // blur is the edit the user thinks they made.
            onFocus={beginGesture}
            onBlur={endGesture}
            aria-label="Project name"
            style={{ width: 220 }}
          />
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
            {projects.length === 0 && <span style={{ color: 'var(--muted)' }}>No rooms yet.</span>}
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
          <span style={{ color: 'var(--muted)' }}>Coming in the next phase.</span>
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
            <div className="empty">
              <h1>{project.name}</h1>
              <p>
                {project.room.walls.length === 0
                  ? 'No walls yet. The drawing tools land in the next phase.'
                  : `${project.room.walls.length} walls, ${project.items.length} items.`}
              </p>
              <p style={{ fontSize: 12 }}>
                Press <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> to undo — try
                renaming the room above first.
              </p>
            </div>
          )}
        </main>

        <aside className="panel right">
          <h2>Properties</h2>
          <span style={{ color: 'var(--muted)' }}>Select something to edit it.</span>
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
            <span>Ceiling: {formatLength(project.room.ceilingHeight, units)}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span>{past.length} undo steps</span>
          </>
        )}
      </footer>
    </div>
  );
}
