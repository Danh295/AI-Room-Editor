# AI Room Editor

A local, personal-use room and furniture planner.

Draw a floor plan by hand, type exact dimensions, or drop in a photo of a floor
plan and let AI trace it. Build a furniture library by pasting a product URL,
model number, or photo — an AI searches the live web for real dimensions and
specs, and you confirm or correct everything before it's saved. Then drag those
pieces into a scaled plan with wall snapping, collision detection, and clearance
checking.

Runs entirely on your machine. No accounts, no cloud storage.

## Status

Usable end to end in 2D: draw or trace a room, place furniture from a starter
library, catch overlaps and blocked walkways, and export the plan. The 3D
preview and AI layout suggestions are not built — see [Roadmap](#roadmap).

## Setup

```bash
npm install
cp .env.example .env       # optional: add a GEMINI_API_KEY — see .env.example
npm run dev                # client on :5173, server on :8787
```

Drawing, manual entry, placement, and export all work without a key; only the
AI product lookup and floor plan tracing need one.

The first run copies a small starter furniture library into `data/library/` so
there's something to place. Replace it with your own pieces whenever you like —
it's only copied when no library file exists.

## Running it for real

```bash
npm run build              # typecheck, bundle the server, build the client
npm start                  # one process on http://127.0.0.1:8787
```

In production the server serves the built client from the same origin, so Vite
isn't involved and there's nothing to proxy.

Or with Docker:

```bash
docker compose up --build  # http://127.0.0.1:8787, data in ./data
```

Both bind to loopback on purpose. **This app has no authentication of any
kind** — anyone who can reach the port can read and overwrite every project.
Set `HOST=0.0.0.0` only behind something that asks who you are.

| Variable         | Default       | What it does                             |
| ---------------- | ------------- | ---------------------------------------- |
| `GEMINI_API_KEY` | —             | Enables AI lookup and floor plan tracing |
| `PORT`           | `8787`        | Port to listen on                        |
| `HOST`           | `127.0.0.1`   | Interface to bind                        |
| `ROOM_DATA_DIR`  | `<repo>/data` | Where projects, library, and images live |

## Roadmap

- [x] **0** — Repo + tooling
- [x] **1** — Foundation: workspaces, shared types, units, file storage, undo/redo
- [x] **2** — Floor plan editor: walls, dimensions, doors, windows
- [x] **3** — Furniture library + manual entry
- [x] **4** — AI ingestion: product URL / model number / photo, floor plan tracing
- [x] **5** — Placement engine: snapping, collision, clearance zones
- [x] **6** — Properties panel: variants, custom shapes, per-item options
- [x] **7** — Exports: plan PNG, cost rollup CSV, print
- [ ] **8** — 3D preview
- [ ] **9** — AI layout suggestions

Freeform polygon footprints can be created and reshaped by dragging their points
on the plan. `LayoutSuggestion` exists as a type with nothing behind it yet.
An Anthropic provider is sketched in the provider interface but not implemented;
`GEMINI_API_KEY` is the only key that does anything today.

## Architecture

|           |                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/` | React + TypeScript + Vite. 2D plan on react-konva.                                                                                            |
| `server/` | Express on `:8787`. Proxies Gemini, fetches and caches product images, reads/writes project files, and serves the built client in production. |
| `shared/` | Types plus pure logic used by both sides: unit parsing/formatting, geometry, collision, cost rollup, the furniture taxonomy.                  |
| `data/`   | Your projects, library, and cached images. Gitignored, apart from the starter library in `data/seed/`.                                        |

All dimensions are stored internally as integer **millimeters**; imperial or
metric is purely a display and input concern.

The server exists for four reasons: browsers can't fetch arbitrary product
pages (CORS), the API key must not ship to the client, something has to touch
the filesystem, and in production it serves the client too.

Every URL the server fetches comes from either model output or a paste, so
none of it is trusted: each redirect hop is re-checked and every resolved
address is refused if it's private or loopback.

## Development

```bash
npm test         # shared logic, server routes, client store
npm run typecheck
npm run lint     # oxlint; catches rules-of-hooks, which tsc can't see
npm run format   # prettier (the tree isn't formatted yet — expect a big diff)
```

CI runs typecheck, lint, tests, a production build, and a smoke test that the
built server really serves the built client.

### Notes for future work

- **Multi-user would be a rewrite of the storage layer, not a config change.**
  `PUT /api/projects/:id` is unauthenticated and writes straight to a file
  named by the caller; hosting this for more than one person means auth on
  every route plus per-user scoping in `server/src/storage.ts`.
- Prettier is configured but has never been run across the tree. Doing it is
  one commit, best taken on its own.
