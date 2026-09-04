# AI Room Editor

A local, personal-use room and furniture planner.

Draw a floor plan by hand, type exact dimensions, or drop in a photo of a floor
plan and let AI trace it. Build a furniture library by pasting a product URL,
model number, or photo — an AI searches the live web for real dimensions and
specs, and you confirm or correct everything before it's saved. Then drag those
pieces into a scaled plan with wall snapping, collision detection, and clearance
checking, with a 3D preview for a spatial sanity check.

Runs entirely on your machine. No accounts, no cloud storage.

## Status

🚧 Under construction — see [the build plan](#roadmap) below.

## Setup

```bash
npm install
cp .env.example .env       # add a GEMINI_API_KEY — see .env.example
npm run dev                # client on :5173, server on :8787
```

Drawing, manual entry, and placement all work without a key; only the AI lookup
and floor plan tracing need one.

## Roadmap

- [x] **0** — Repo + tooling
- [x] **1** — Foundation: workspaces, shared types, units, file storage, undo/redo
- [x] **2** — Floor plan editor: walls, dimensions, doors, windows
- [x] **3** — Furniture library + manual entry
- [x] **4** — AI ingestion: product URL / model number / photo, floor plan tracing
- [x] **5** — Placement engine: snapping, collision, clearance zones
- [x] **6** — Properties panel: variants, custom shapes, per-item options
- [ ] **7** — 3D preview
- [ ] **8** — AI layout suggestions, cost rollup, exports

Freeform polygon footprints are stored and rendered, but editing their points
needs on-canvas handles and is still to come.

## Architecture

| | |
|---|---|
| `client/` | React + TypeScript + Vite. 2D plan on react-konva, 3D preview on react-three-fiber. |
| `server/` | Express on `:8787`. Proxies whichever AI provider is configured (Gemini or Anthropic), fetches and caches product images, reads/writes project files. |
| `shared/` | Types plus pure logic used by both sides: unit parsing/formatting, geometry, collision, the furniture taxonomy. |
| `data/` | Your projects, library, and cached images. Gitignored — stays on your machine. |

All dimensions are stored internally as integer **millimeters**; imperial or
metric is purely a display and input concern.

The server exists for three reasons: browsers can't fetch arbitrary product
pages (CORS), the API key must not ship to the client, and something has to
touch the filesystem.

## Development

```bash
npm test         # shared/ logic: units, geometry, placement, taxonomy
npm run typecheck
```
