# Plan: 3D preview, AI layouts, and a new editor shell

Covers roadmap items **8** (3D preview) and **9** (AI layout suggestions), plus
the frontend changes both need. Nothing here is built yet.

## Build order

1. **M1 — Shell.** Plan / Split / 3D switcher in the top bar, tools on a left
   rail, projects in a top-bar menu, inspector tabs on the right.
2. **M2 — 3D, read only.** Pure scene model in `shared/`, rendered with
   react-three-fiber, lazy-loaded. Orbit camera with front-wall cutaway.
3. **M3 — 3D interaction.** Click to select (same store selection as the
   plan), walk mode at eye height, PNG export of the 3D view.
4. **M4 — Layout engine.** Server route, anchored placement schema, resolver,
   repair pass and scorer. Fully tested with a fake provider; no UI.
5. **M5 — Layout UI.** Brief + item picker, three option cards, ghost preview
   on the plan and in 3D, apply as one undo step.
6. **M6 — Polish.** Category proxy meshes (sofa with back and arms, not a box),
   Anthropic provider, light theme.

3D goes first: the data model already carries what it needs
(`Room.ceilingHeight`, `Opening.height`/`sillHeight`, `PlacedItem.z`,
`Variant.hex`, `Layer`), it costs nothing per use, and AI suggestions are much
easier to judge in 3D.

## Frontend shell (M1)

Today: top bar with tools, left aside with the project list and library, plan
in the middle, Room/Item panel on the right, status bar.

Proposed:

| Area        | Holds                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Top bar     | Project menu (replaces the sidebar list) · Plan/Split/3D · Suggest layout · undo/redo · save state |
| Left rail   | Select, Pan, Wall, Door, Window, Measure — icons with key hints                                    |
| Left drawer | Library: search, category chips, AI lookup. Collapsible                                            |
| Stage       | Plan, 3D, or both side by side (split ratio remembered per project)                                |
| Inspector   | Tabs: Room · Item · Layouts. Item tab auto-opens on selection                                      |
| Status bar  | Unchanged: save dot, units, grid, zoom, conflict chip                                              |

New store state: `view: 'plan' | 'split' | '3d'`, `inspectorTab`. View is a UI
preference, kept in `localStorage`, not in the project file.

## 3D preview (M2–M3)

**Dependencies:** `three`, `@react-three/fiber`, `@react-three/drei`. Loaded with
`React.lazy` so the 2D editor's bundle doesn't grow.

**Scene model.** `shared/src/scene3d.ts` exports
`buildScene(project, library): SceneModel`, a plain description (boxes,
extrusions, materials) with no three.js import. It is unit-tested in Node like
the rest of `shared/`. The client only turns it into meshes.

**Coordinate mapping**

| Plan (mm, +Y down, clockwise °) | three.js (m, Y up)              |
| ------------------------------- | ------------------------------- |
| `x`                             | `X = x / 1000`                  |
| `y`                             | `Z = y / 1000` (no flip needed) |
| `PlacedItem.z`, `h`             | `Y` base and height             |
| `rotation` θ                    | `rotation.y = −θ` in radians    |
| `flipX`                         | `scale.x = −1`                  |

**Walls.** Each wall is split along its length at its openings: full-height
pieces between openings, a sill box under each window, a lintel box over each
door and window. Boxes only, no CSG library. Corners are filled by extending
each piece by half the wall thickness at a shared vertex.

**Floor** from `roomPolygon()` as a `ShapeGeometry`. **Items** are the footprint
from `localFootprint()` extruded to `h`, coloured by the active variant; rugs
are a 10 mm slab.

**Views.** Orbit (dollhouse — walls whose inward normal faces the camera are
hidden), Top, and Walk (eye height 1600 mm, WASD + pointer lock).

**Tests.** Scene model: wall split around a door and a window, rotation sign,
L and poly footprints. One Playwright screenshot smoke test of the 3D view.

## AI layout suggestions (M4–M5)

**Principle: the model proposes, the geometry code decides.** Models are poor at
raw coordinates and good at "against the long wall, facing the window", so the
schema is anchored and the server turns anchors into coordinates.

```ts
type Anchor =
  | { kind: 'wall'; wallId: string; along: number /* mm from wall a */; gap?: number }
  | { kind: 'facing'; targetId: string; distance: number }
  | { kind: 'free'; x: number; y: number; rotation: number };

interface ProposedPlacement {
  itemId: string;
  anchor: Anchor;
  why: string;
}
```

**Pipeline** (`server/src/routes/layout.ts`, logic in `shared/src/layout/`):

1. **Describe** the room in words and numbers: walls labelled by id with
   compass side and length, openings with offsets, door swing zones, locked
   items as fixed, items to place with size and clearances.
2. **Ask** for three distinct concepts via `provider.extract()` with a JSON
   schema. No web search.
3. **Resolve** anchors to `x, y, rotation`, reusing `rotationForWall()` and
   `wallInwardNormal()`.
4. **Repair** with `findConflicts()` and a small local search (slide along the
   wall, rotate 90°/180°, nudge). If conflicts remain, send them back to the
   model once. At most two model calls per request.
5. **Score** each option: hard conflicts, clearance shortfall, a walkway check
   (grid flood fill at 100 mm from each door, person width 600 mm), facing
   pairs, and how much of each wall-type item touches a wall.
6. **Return** `LayoutSuggestion[]` (extend the existing type with `name`,
   `score` and `breakdown`).

Rate limited like `/api/ingest`. Only geometry and item names leave the
machine.

**UI.** Layouts tab: free-text brief, item chips (locked items shown and
respected), "Suggest 3 layouts". Each option card shows its name, score,
conflicts and walkway width. Hovering or selecting a card draws a ghost of the
proposed positions over the plan (dashed outlines, arrows from current
positions) and in the 3D pane. **Apply** commits the whole option through
`edit()`, so a single undo reverts it.

## Risks

- **Bundle size** — three.js is about 600 KB; lazy-load it and check the build.
- **WebGL in tests** — jsdom has none; keep logic in the pure scene model and
  use one Playwright screenshot for rendering.
- **Model spatial reasoning** — mitigated by anchors, deterministic repair and
  scoring, and by never applying anything without a preview.
- **Quota** — at most two model calls per request; the same rate limiter as
  ingestion.
