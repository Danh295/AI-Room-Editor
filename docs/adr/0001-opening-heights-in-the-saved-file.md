# Opening heights live in the saved file, via schema v2

The 3D view needs a height for every opening and a sill height for every window, but no project saved so far has either: `addOpening` accepts them and nothing ever passes them. We chose to migrate saved projects (schema 1 → 2) so that every opening carries its height (and every window its sill), instead of filling defaults in at render time. The saved file then says what the 3D view shows, the heights become editable next to width, and nothing downstream has to know which values were guessed.

The same migration renames the opening kind `'opening'` to `'doorway'`. In the glossary, "opening" is the umbrella for doors, windows and open doorways, so a kind with the same name meant two things.

## Considered options

- **Defaults at render time.** No file change, but every reader of `Opening` (3D, exports, layout descriptions sent to the model) would have to apply the same defaults, and the UI couldn't show a value the file doesn't hold.

## Consequences

- Defaults written by the migration and used for new openings: doors and open doorways 2032 mm (80″) high; windows 1118 mm (44″) high on a 914 mm (36″) sill, so window heads line up with door heads.
- Migration is one-way: a v2 file is refused by an app that only knows v1 (`migrateProject` already refuses newer schemas).
- Everything that emits the kind string moves with it: the type union and validator in `shared/`, the AI floor plan tracer's response schema in `server/src/routes/ingest.ts`, and the mapping in `FloorplanDialog`.
