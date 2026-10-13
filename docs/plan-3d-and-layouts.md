# Plan: 3D preview, AI layouts, and a new editor shell

Covers roadmap items **8** (3D preview) and **9** (AI layout suggestions), plus
the frontend changes both need. Nothing here is built yet. Terms follow
[`CONTEXT.md`](../CONTEXT.md).

## Build order

1. **Schema v2.** Every opening gets a height, every window a sill height;
   the `'opening'` kind becomes `'doorway'`. See
   [ADR 0001](adr/0001-opening-heights-in-the-saved-file.md).
2. **M2 — 3D, read only.** Pure scene model in `shared/`, rendered with
   react-three-fiber, lazy-loaded, behind a plain Plan/3D toggle in today's
   top bar. Orbit and Top camera modes with a cut-down front wall; the 2D
   selection is highlighted.
3. **M3 — 3D interaction.** Click to select (same store selection as the
   plan), Walk camera mode, PNG and GLB export of the 3D view.
4. **M1 — Shell.** Plan / Split / 3D switcher replaces the toggle, tools on a
   left rail, projects in a top-bar menu, inspector tabs on the right.
5. **Walkway check.** Room-level reachability from the doors, shown live in
   2D, and conflict severity.
6. **M4 — Layout engine.** Server route, anchored placement schema, resolver,
   repair pass and scorer. Fully tested with a fake provider; no UI.
7. **M5 — Layout UI.** Brief + item picker, three layout suggestions, ghost
   preview on the plan and in 3D, apply as one undo step.
8. **M6 — Polish.** Category proxy meshes (sofa with back and arms, not a box),
   Anthropic provider, light theme.

3D goes first: the data model already carries nearly everything it needs
(`Room.ceilingHeight`, `PlacedItem.z`, `Variant.hex`, `Layer`, and opening
heights after schema v2), it costs nothing per use, and layout suggestions are
much easier to judge in 3D. It also goes before the shell: it's the riskiest
new capability (WebGL, bundle size, scene correctness), and the shell is
better designed after living with a 3D view than before.

Each step gets its own spec when its turn comes; the first spec covers schema
v2, M2 and M3.

## Schema v2

A `1 → 2` step in `migrateProject()` (`shared/src/validate.ts`):

| Opening kind  | `height`      | `sillHeight` |
| ------------- | ------------- | ------------ |
| door, doorway | 2032 mm (80″) | —            |
| window        | 1118 mm (44″) | 914 mm (36″) |

`height` becomes required on `Opening`, `sillHeight` required for windows. New
openings get the same defaults. The selected-opening section of the Room panel
gains Height (and Sill, for windows) next to Width. The rename reaches the
type union, the validator, the floor plan tracer's response schema, and
`FloorplanDialog`.

## 3D preview (M2–M3)

**Dependencies:** `three`, `@react-three/fiber`, `@react-three/drei`. Loaded with
`React.lazy` so the 2D editor's bundle doesn't grow. A CI step reads Vite's
build manifest, fails if `three` reaches the entry chunk, and prints the 3D
chunk's size.

**Store state.** `view: 'plan' | '3d'` (gains `'split'` in M1) and
`cameraMode: 'orbit' | 'top' | 'walk'`. Both are UI preferences in
`localStorage`, not in the project file.

**Scene model.** `shared/src/scene3d.ts` exports
`buildScene(project, library): SceneModel`, a plain description (prisms,
slabs, materials) with no three.js import. It is unit-tested in Node like
the rest of `shared/`. The client only turns it into meshes.

**Coordinate mapping**

| Plan (mm, +Y down, clockwise °) | three.js (m, Y up)              |
| ------------------------------- | ------------------------------- |
| `x`                             | `X = x / 1000`                  |
| `y`                             | `Z = y / 1000` (no flip needed) |
| `PlacedItem.z`, `h`             | `Y` base and height             |
| `rotation` θ                    | `rotation.y = −θ` in radians    |
| `flipX`                         | `scale.x = −1`                  |

**Walls.** Each wall is the mitred quadrilateral between its interior and
exterior faces, taken from `interiorPolygon()` / `exteriorPolygon()` so
corners are right at any angle. It is split along its length at its openings
— full-height pieces between openings, a sill piece under each window, a
lintel piece over each door, doorway and window — and each piece is extruded
to its height. No CSG library, no overlapping boxes. A room whose walls don't
close into a loop falls back to square-ended pieces per wall.

**Floor** from `interiorPolygon()`. **Ceiling** drawn in Walk mode only.
**Items** are the footprint from `localFootprint()` extruded to `h` at `z`,
coloured by the active variant; rugs are a 10 mm slab. An item moved to the
`ceiling` layer gets `z = ceilingHeight − h`; `z` always means height off the
floor.

**Rendering.** `THREE.NeutralToneMapping` (Khronos PBR Neutral) so materials
match their `Variant.hex` swatches rather than r3f's default ACES Filmic look;
`frameloop="demand"`; a hemisphere light plus one directional light, and
drei `ContactShadows` under items. If WebGL is unavailable, the 3D view says
so in plain text.

**Camera modes.** Orbit (walls between the camera and the room are cut down
to ~300 mm so the outline and door positions stay visible), Top, and Walk
(eye height 1600 mm; WASD or arrow keys with pointer lock; the camera stays
inside `interiorPolygon()` but passes through furniture; Esc releases the
pointer, and an on-screen hint says so).

**Keyboard and motion.** Camera-mode buttons are DOM controls; with the 3D
view focused, arrows orbit and +/− zoom. Camera transitions snap instead of
animating under `prefers-reduced-motion`.

**Selection.** M2 highlights the current 2D selection in 3D; M3 adds
clicking in 3D to select.

**Export (M3).** PNG of the current 3D view, and GLB via `GLTFExporter`
(metres, variant colours as materials). USDZ is deferred.

**Tests.**

- Scene model: wall split around a door and a window, mitred corners at
  non-right angles, unclosed rooms, rotation sign, L and poly footprints.
- `@react-three/test-renderer`: the client turns a `SceneModel` into the
  expected mesh tree.
- One Playwright smoke test: the 3D view mounts, logs no WebGL errors, and
  the canvas isn't blank (sampled pixels). No pixel-baseline screenshots —
  headless WebGL differs between CI and a Mac.

## Walkway check

A pure function in `shared/` beside `findConflicts()`, used live by the 2D
conflict layer and by the M4 scorer.

- **Sources:** every door and doorway. Windows don't count.
- **Obstacles:** walls and `floor` / `onTop` placed items. Rugs are walkable;
  `wall` and `ceiling` items are ignored.
- **Reachable:** a placed item with clearances is reachable when any of its
  clearance zones touches floor that a walkway reaches from some door.
- **Blocked** (error): no walkway at least **600 mm** wide reaches it.
  **Narrow** (warning): it is reached only through somewhere under
  **900 mm**. Both are named constants citing their source (900 mm is the
  common residential minimum; ADA's accessible route is 915 mm).
- A room with no door skips the check and says so.

**Severity.** `Conflict` gains `severity: 'error' | 'warning'`. Errors:
overlap, outside, door, blocked walkway. Warnings: clearance, narrow walkway.
The status-bar chip counts the two separately.

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

New store state: `inspectorTab`, and `view` gains `'split'`.

## AI layout suggestions (M4–M5)

**Principle: the model proposes, the geometry code decides.** Models are poor at
raw coordinates and good at "against the long wall, facing the window", so the
schema is anchored and the server turns anchors into coordinates. (This is the
lesson Holodeck, CVPR 2024, drew too: absolute coordinates from an LLM produce
collisions and out-of-bounds placements; relations plus a solver don't.)

```ts
type Anchor =
  | { kind: 'wall'; wallId: string; along: number /* mm from wall a */; gap?: number }
  | { kind: 'facing'; targetId: string; distance: number }
  | { kind: 'center'; of: 'room' | string[] /* placed item ids */ }
  | { kind: 'free'; x: number; y: number; rotation: number };

interface ProposedPlacement {
  itemId: string;
  anchor: Anchor;
  /** Height off the floor; only for `wall` and `ceiling` layer items. */
  z?: number;
  why: string;
}
```

Layout never changes an item's variant.

**Pipeline** (`server/src/routes/layout.ts`, logic in `shared/src/layout/`):

1. **Describe** the room in words and numbers: walls labelled by id with
   compass side and length, openings with offsets, door swing zones, locked
   items as fixed, items to place with size and clearances.
2. **Ask** for three distinct layout suggestions via `provider.extract()` with
   a JSON schema. No web search.
3. **Resolve** anchors to `x, y, rotation`, reusing `rotationForWall()` and
   `wallInwardNormal()`.
4. **Repair** with `findConflicts()` and a small local search (slide along the
   wall, rotate 90°/180°, nudge). If conflicts remain, send them back to the
   model once. At most two model calls per request.
5. **Score** each layout suggestion: errors, warnings, clearance shortfall,
   the walkway check, facing pairs, and how much of each wall-type item
   touches a wall.
6. **Return** `LayoutSuggestion[]` (extend the existing type with `name`,
   `score` and `breakdown`).

Rate limited like `/api/ingest`. Only geometry and item names leave the
machine.

**Evaluation.** 5–8 fixture rooms in `shared/src/layout/fixtures/`: the real
saved projects reduced to geometry and furniture, plus an L-shaped living
room, a narrow bedroom with its door in the long wall, and a studio with two
doors. `npm run eval:layout` runs the real provider against them and prints
scorer results per room. Run by hand when the prompt or model changes, never
in CI.

**UI.** Layouts tab: free-text brief, item chips (locked items shown and
respected), "Suggest 3 layouts". Each card shows its name, score, errors and
warnings, and narrowest walkway. Hovering or selecting a card draws a ghost of
the proposed positions over the plan (dashed outlines, arrows from current
positions) and in the 3D view. **Apply** commits the whole layout suggestion
through `edit()`, so a single undo reverts it.

## Risks

- **Bundle size** — three.js is about 600 KB; lazy-loaded, with the CI
  manifest check above.
- **WebGL in tests** — jsdom has none; keep logic in the pure scene model, test
  the mesh mapping with the r3f test renderer, and smoke-test rendering in
  Playwright without pixel baselines.
- **Model spatial reasoning** — mitigated by anchors, deterministic repair and
  scoring, the evaluation fixtures, and by never applying anything without a
  preview.
- **Quota** — at most two model calls per request; the same rate limiter as
  ingestion.
