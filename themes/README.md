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

## Add a theme

1. Create `themes/mytheme.json` (copy `office.json` and edit colours/props).
2. Add `{ "id": "mytheme", "label": "My Theme", "file": "mytheme.json" }` to `manifest.json`.
3. Add a chip in `index.html` (`#theme-chips`) and allow the id in `THEME_IDS` in `board.js`.
4. Hard-refresh. Optional: `?theme=mytheme`.

No restart needed: the server reads theme files on every request.
