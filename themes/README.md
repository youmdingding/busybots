# Board environment themes

Themes only change **visuals** (sky, base, floors, walls, props, signs).
Layout, slots, packing, bubbles, chips, and panel behaviour are unchanged.

## Files

- `manifest.json` — lists themes (`id`, `label`, `file`) and `default`
- `<id>.json` — one theme definition

## Theme JSON shape

```json
{
  "id": "mytheme",
  "label": "My Theme",
  "ambient": "nature|office|city|space",
  "sky": { "style": "clouds|office|dusk|stars", "alpha": 0.18 },
  "base": { "style": "water|slab|street|void", "yOffset": 18 },
  "sign": { "style": "wood|plaque|street|holo" },
  "pond": true,
  "page": { "bg": "#hex", "accent": "#hex" },
  "art": { "skyTop": "...", "grassA": "...", "pathA": "...", "waterTop": "..." },
  "zones": {
    "specs": { "a": "...", "floor": "...", "wall": "...", "edge": "rgba(...)", "ring": "..." }
  },
  "props": {
    "specs": { "prop": "proc_whiteboard|prop_bench|...", "motif": "motif_compass" }
  },
  "ambientSpots": [ { "gx": 1, "gy": 1, "type": "proc_lamp" } ]
}
```

`art` keys merge onto the Island `ART` palette. `zones` merge onto room floors.
`prop` may be an existing `tiles/prop_*.png` or a built-in `proc_*` procedural prop
(desk, whiteboard, sofa, building, car, console, holo, scanner, dome, …).

## Glass walls

A ground sprite can leave its glass transparent (the Office curtain wall) and the board
paints the view behind it: sky that follows the local time of day, drifting clouds, a
skyline whose windows light up in the evening, stars and the odd plane.

```json
"ground": {
  "sprite": "office_ground",
  "fitSprite": true,
  "windows": [{ "from": [0, 0.128], "to": [22, 0.128], "z": [6, 70], "seed": 7 }]
}
```

`from`/`to` = where the glass meets the floor (grid), `z` = glass bottom and top in
sprite units, `seed` = a different skyline and clouds per wall. `fitSprite` makes the
camera fit the whole sprite (tall walls included), not just the floor. Add `?hour=19.5`
to the board URL to preview another time of day.

## Wall clocks

`"clocks": [{ "at": [0.128, 13.95], "face": "R", "z": 46, "r": 9 }]` inside `ground` paints
a clock showing the local time on the sprite's wall: `at` = the clock centre on the wall at
floor level (grid), `face` = which way the wall faces (`"R"` toward +x, `"L"` toward +y),
`z` = centre height and `r` = radius in sprite units.

## Live props

Room sprites can come with a map of their live parts (`<sprite>_live.png`): the art
generators tag them with `liven()` (`tools/city_props/isopix.py`). While an agent is working
in a room, those parts animate. Office: code scrolls, documents get written, the CI board
runs, rack LEDs blink, the roadmap's today line moves, the diff scrolls. City: blueprints
get drawn, the conveyor runs, the stack light cycles, the crane beacon blinks, the mixer
turns. Island: the sea shimmers, the tour route is traced, fish swim, burners flicker,
steam rises. Space: holo screens scroll and drift, consoles blink, the reactor flows,
bubbles rise in the specimen tubes. The kinds live in `web/board/livescreens.js`. Nothing to
set in the theme: the manifest entry's `live` key turns it on.

A room can also have moving machinery (`rig` on its manifest entry, `web/board/rigs.js`):
the City building site's tower crane swings, lowers its load to the floor and lifts it
again while an agent works there, and goes back to rest when the room is quiet. The
generator (`crane_rig()` in `tools/city_props/interiors.py`) keeps only the mast in the
room sprite and renders the turning head and the hook load at 32 headings.

## Roamers

Themes with a ground sprite can have little robots that drive a route on the floor
(the Office robot vacuum). Sprites come from `tiles/city_v2/` (one per heading:
`<sprite>_x`, `_xr`, `_y`, `_yr`):

```json
"roamers": [{
  "sprite": "office_vacuum",
  "dock": { "sprite": "office_vacuum_dock", "at": [6.2, 13.0] },
  "loop": [[6.2, 13.45], [12.6, 13.45], [12.6, 15.6], [6.2, 15.6]],
  "speed": 0.5, "turn": 0.8, "laps": 2, "rest": 20, "firstRest": 3
}]
```

It leaves the dock, drives the loop `laps` times (straight legs along x or y, pausing
`turn` seconds at each corner), goes back to charge for `rest` seconds, then starts
again. It waits while an agent is in its way.

## Add a theme

1. Create `themes/mytheme.json` (copy `office.json` and edit colours/props).
2. Add `{ "id": "mytheme", "label": "My Theme", "file": "mytheme.json" }` to `manifest.json`.
3. Add a chip in `index.html` (`#theme-chips`) and allow the id in `THEME_IDS` in `web/board/constants.js`.
4. Hard-refresh. Optional: `?theme=mytheme`.

No restart needed: the server reads theme files on every request.
