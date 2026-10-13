# AI Room Editor

A personal planner for one room at a time: draw the room, fill it with real furniture at real sizes, and check that it fits and can be lived in.

## Language

### The room

**Opening**:
A gap in a wall: a door, a window, or an open doorway.
_Avoid_: hole, aperture

**Open doorway**:
An opening you walk through that has no door in it.
_Avoid_: opening (for this kind specifically), archway, pass-through

### Furniture

**Product**:
A real-world piece of furniture sold by a retailer, which AI lookup researches from a link, model number, or photo.
_Avoid_: item (on its own), piece

**Library item**:
The saved definition of a piece of furniture (dimensions, footprint, clearances, variants, price), reusable across rooms.
_Avoid_: product, catalog entry, piece

**Placed item**:
One instance of a library item positioned in a room, which may override its library item's size or clearances.
_Avoid_: piece, placement, instance

### Fit and movement

**Clearance**:
The space a placed item needs at its own faces to be usable, such as the walkway in front of a sofa or room to open a drawer.
_Avoid_: buffer, margin

**Walkway**:
A passable route through the room from a door, wide enough for a person to walk.
A placed item no walkway reaches is **blocked**; one reached only by a walkway below comfortable width is **narrow**.
_Avoid_: circulation, path, aisle

**Conflict**:
A problem the checker finds with an arrangement, either an **error** (it can't physically be that way) or a **warning** (it works, but badly).
_Avoid_: issue, violation, problem

### Looking at the room

**View**:
What the stage shows: the plan, the 3D model, or both side by side.
_Avoid_: mode, tab

**Camera mode**:
How you look around the 3D model: orbiting from outside, looking straight down, or walking through at eye height.
_Avoid_: view, perspective

### Suggestions

**Layout suggestion**:
One complete proposed arrangement of placed items, which you can preview and then apply or discard.
_Avoid_: concept, option, layout (on its own)
