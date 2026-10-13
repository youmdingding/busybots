"""
City-theme ground: one pixel-art slab covering the board (grid x -3..25, y -3..16)
with streets between the zones, sidewalks + curbs, yellow centre dashes, zebra
crossings, a wide front avenue and a ring road on the other three sides. Also writes the matching prop placements
(ground_spots.json) so trees sit in their pits, cars in their lanes, etc.

Run: python3 ground.py  -> out/city_ground.png + manifest entry + ground_spots.json
"""
import json, math, os
from isopix import box, render, rgb, mix, hash2, face_uv
from interiors import U
from props import solid_hull

GX0, GY0, GX1, GY1 = -2.2, -2.2, 24.1, 16.3
SLAB = 11.0  # board island sits 22 px above its base; drawn at 2x

# zone footprints (runtimeLayout in board.js)
ZONES = {
    "specs": (1.0, 0.9, 6.0, 5.3),
    "plan": (7.0, 0.9, 12.0, 5.3),
    "build": (1.0, 6.0, 6.0, 10.6),
    "review": (7.0, 6.0, 12.0, 10.6),
    "explore": (12.8, 0.9, 21.0, 5.3),
    "idle": (12.8, 6.0, 21.0, 11.4),
}

# streets (grid units). Each: (axis, centre, half_width_of_road, start, end)
#   axis "x": road runs along x at y=centre ; axis "y": runs along y at x=centre
AVE_Y0, AVE_Y1 = 13.6, 15.6                     # front avenue (two-way, one lane each way)
# Ring road on the back and right sides, same width and markings as the avenue.
# Each: (axis, centre, half width) — axis "x" runs along x at y=centre.
RING = [
    ("x", -1.2, 0.8),                            # back-right side (behind Specs / Plan / Explore)
    ("y", -1.2, 0.8),                            # back-left side (behind Specs / Build)
    ("y", 23.1, 0.8),                            # front-right side (beside Explore / Idle)
]
WIDE = [("x", (AVE_Y0 + AVE_Y1) / 2, (AVE_Y1 - AVE_Y0) / 2)] + RING
STREETS = [
    ("y", 6.5, 0.36, -0.4, AVE_Y0),              # between Specs/Build and Plan/Review (meets the ring road)
    ("y", 12.4, 0.29, -0.4, AVE_Y0),             # between Plan/Review and Idle
    ("x", 5.65, 0.24, -0.4, 22.3),               # between the two zone rows, ring road to ring road
]
CROSSINGS = [
    # (x0, y0, x1, y1, bars_along) — bars_along = direction of the bars (= traffic direction)
    (6.14, 12.75, 6.86, 13.45, "y"),             # mouth of the left side street
    (12.11, 12.75, 12.69, 13.45, "y"),           # mouth of the right side street
    (5.25, AVE_Y0, 5.85, AVE_Y1, "x"),           # across the avenue
    (13.0, AVE_Y0, 13.6, AVE_Y1, "x"),
]
TREE_PITS = [(0.7, 13.3), (7.4, 13.3), (14.8, 13.3), (18.9, 13.3), (21.4, 13.3)]


def in_rect(x, y, r, pad=0.0):
    return r[0] - pad <= x <= r[2] + pad and r[1] - pad <= y <= r[3] + pad


def classify(x, y):
    """Return ('road'|'sidewalk'|'zone', extra) for a grid point."""
    for z in ZONES.values():
        if in_rect(x, y, z):
            return "zone", None
    hits = [w for w in WIDE if abs((y if w[0] == "x" else x) - w[1]) <= w[2]]
    if len(hits) > 1:
        return "road", ("junction", 0, 0)        # two wide roads cross: plain asphalt
    if hits:
        return "road", hits[0]
    for (ax, c, hw, a0, a1) in STREETS:
        if ax == "y" and abs(x - c) <= hw and a0 <= y <= a1:
            return "road", ("y", c, hw)
        if ax == "x" and abs(y - c) <= hw and a0 <= x <= a1:
            return "road", ("x", c, hw)
    return "sidewalk", None


def ground_mat(p, n):
    f, u, v = face_uv(p, n)
    ux, uy = p[0], p[1]
    x, y = GX0 + ux / U, GY0 + uy / U
    if f != "top":
        # slab sides: kerb-coloured lip, then layered concrete
        z = p[2]
        if z > -1.4:
            return rgb("#c9c6bf")
        if z > -3.0:
            return rgb("#5b6068")
        c = rgb("#4a4f58") if f == "L" else rgb("#3c4048")
        return c * (0.92 if int(z) % 3 == 0 else 1.0)

    kind, info = classify(x, y)
    # zebra crossings first (they sit on road)
    for (cx0, cy0, cx1, cy1, along) in CROSSINGS:
        if cx0 <= x <= cx1 and cy0 <= y <= cy1:
            if kind == "road" or (cy1 - cy0) < 1.2:
                t = (uy if along == "x" else ux)
                if t % 4.0 < 2.2:
                    return rgb("#ecebe6")
                return asphalt(ux, uy)
    if kind == "road":
        ax, c, hw = info
        if ax == "junction":
            return asphalt(ux, uy)
        d_c = (y - c) if ax == "x" else (x - c)              # signed offset from centre (grid)
        along = ux if ax == "x" else uy
        edge = hw - abs(d_c)                                 # distance to road edge (grid)
        # avenue: white edge lines + yellow double centre; side streets: dashed centre
        if hw >= 0.75:  # avenue and ring road
            if edge * U < 1.6 and edge * U > 0.8:
                return rgb("#e6e6e0")
            if abs(abs(d_c * U) - 0.7) < 0.45 and not near_crossing(x, y):
                return rgb("#f0c43a")  # solid double yellow: two-way traffic
            # manhole covers
            for (mx, my) in ((3.4, 14.1), (10.5, 15.1), (19.6, 14.1), (9.0, -1.6), (-0.8, 9.5), (23.5, 4.0)):
                if math.hypot(x - mx, y - my) * U < 2.3:
                    rr = math.hypot(x - mx, y - my) * U
                    return rgb("#2a2d33") if rr > 1.8 or int(ux + uy) % 2 else rgb("#4b5059")
        else:
            if abs(d_c * U) < 0.5 and (along % 8.0) < 4.5 and not near_intersection(x, y):
                return rgb("#f0c43a")
        return asphalt(ux, uy)
    if kind == "sidewalk":
        # tree pits
        for (tx, ty) in TREE_PITS:
            if abs(x - tx) * U < 3.6 and abs(y - ty) * U < 3.6:
                if abs(x - tx) * U > 2.8 or abs(y - ty) * U > 2.8:
                    return rgb("#8f8b84")
                return rgb("#5d4a36") if hash2(int(ux * 2), int(uy * 2), 70) > 0.3 else rgb("#4a6b3a")
        # curb: last 1.3 units before a road (check one step toward neighbours)
        for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k2, _ = classify(x + dx * 1.3 / U, y + dy * 1.3 / U)
            if k2 == "road":
                k3, _ = classify(x + dx * 0.55 / U, y + dy * 0.55 / U)
                return rgb("#8f8b84") if k3 == "road" else rgb("#dcd9d2")
        return pavers(ux, uy)
    # under the zones (hidden) — keep it neutral
    return pavers(ux, uy)


def near_crossing(x, y):
    for (cx0, cy0, cx1, cy1, along) in CROSSINGS:
        if cx0 - 0.25 <= x <= cx1 + 0.25 and cy0 - 0.25 <= y <= cy1 + 0.25:
            return True
    return False


def near_intersection(x, y):
    # skip centre dashes where streets meet
    for (ax, c, hw, a0, a1) in STREETS:
        if ax == "y" and abs(x - c) <= hw + 0.05 and abs(y - 5.65) < 0.5:
            return True
    if y > AVE_Y0 - 0.3 or y < -0.2 or x < -0.2 or x > 22.1:   # where side streets meet the wide roads
        return True
    return near_crossing(x, y)


def asphalt(ux, uy):
    h = hash2(int(ux), int(uy), 71)
    if h < 0.06:
        return rgb("#454b55")
    if h > 0.95:
        return rgb("#30343b")
    # occasional repair patches
    if hash2(int(ux // 14), int(uy // 10), 72) < 0.05:
        return rgb("#353a42")
    return rgb("#3a3f48")


def pavers(ux, uy):
    px, py = ux / 4.69, uy / 4.69
    if (ux % 4.69) < 0.45 or (uy % 4.69) < 0.45:
        return rgb("#a9a59e")
    h = hash2(int(px), int(py), 73)
    return rgb("#bdb9b1") if h > 0.25 else (rgb("#b5b1a9") if h > 0.08 else rgb("#c6c2ba"))


def spots():
    """Prop placements that match the ground layout (grid coords)."""
    S = []
    add = lambda t, x, y: S.append({"type": "city_" + t, "gx": x, "gy": y})
    SHOP_Y = 12.95  # shop sidewalk between the zones and the avenue; storefronts face the avenue
    # shop sidewalk
    for (tx, ty) in TREE_PITS:
        add("tree_big" if int(tx * 10) % 3 == 0 else "tree_small", tx, ty)
    add("shop1_bakery", 2.15, SHOP_Y)
    add("shop1_books", 4.1, SHOP_Y)
    add("shop1_flowers", 8.85, SHOP_Y)
    add("shop1_cafe", 10.95, SHOP_Y)
    add("lamp", 14.5, 13.3)
    add("bus_stop", 16.3, 12.95)
    add("bench", 17.85, 13.0)
    add("newsstand", 20.1, 12.95)
    add("lamp", 11.95, 13.35)
    # cars are animated by the board (see traffic()), not placed here
    # thin front sidewalk: lamps + a hydrant
    for lx in (2.6, 9.6, 16.4, 20.4):
        add("lamp", lx, AVE_Y1 + 0.34)
    add("hydrant", 11.4, AVE_Y1 + 0.36)
    # ring-road sidewalks: lamps and a few trees between the rooms and the road
    for lx in (3.6, 9.6, 15.4, 19.8):
        add("lamp", lx, -0.15)
    for ly in (3.2, 8.4, 12.0):
        add("lamp", -0.15, ly)
    for ly in (2.6, 7.6, 11.6):
        add("lamp", 22.0, ly)
    for (tx, ty) in ((0.2, 0.15), (21.7, 0.15), (21.7, 12.6)):
        add("tree_small", tx, ty)
    # traffic lights on both kerbs of each avenue crossing (signal id → board cycles them)
    for (x, y, sid) in ((5.0, AVE_Y1 + 0.34, 0), (5.05, 13.35, 0), (13.9, AVE_Y1 + 0.34, 1), (13.8, 13.35, 1)):
        S.append({"type": "city_traffic_light", "gx": x, "gy": y, "signal": sid})
    return S


def traffic():
    """Lanes / signals for the board's animated traffic (theme.traffic)."""
    far, near = AVE_Y0 + 0.5, AVE_Y1 - 0.5
    (bx, bc, _), (lx, lc, _), (rx, rc, _) = RING
    ring = lambda axis, at, d, a, b, sp, cars: {"axis": axis, "dir": d, "at": at, "from": a, "to": b,
                                                "speed": sp, "fade": 1.0, "cars": cars}
    return {
        "cycle": 15, "green": 8, "amber": 1.6,
        "signals": [
            {"id": 0, "axis": "x", "at": [CROSSINGS[2][0], CROSSINGS[2][2]], "offset": 0},
            {"id": 1, "axis": "x", "at": [CROSSINGS[3][0], CROSSINGS[3][2]], "offset": 7.5},
        ],
        "lanes": [
            {"axis": "x", "dir": -1, "at": far, "from": 0.2, "to": 21.8, "speed": 1.5, "fade": 1.0, "signals": True,
             "cars": ["taxi", "sedan_blue", "van", "sedan_white"]},
            {"axis": "x", "dir": 1, "at": near, "from": 0.2, "to": 21.8, "speed": 1.7, "fade": 1.0, "signals": True,
             "cars": ["sedan_red", "hatch_green", "taxi", "van", "sedan_blue"]},
            # ring road: cars fade in and out before the corners, like the boats around the island
            ring("x", bc - 0.4, -1, -0.4, 22.4, 1.4, ["van", "sedan_white", "taxi"]),
            ring("x", bc + 0.4, 1, -0.4, 22.4, 1.6, ["sedan_blue", "hatch_green", "sedan_red"]),
            ring("y", lc - 0.4, -1, -0.4, 13.4, 1.3, ["taxi", "sedan_red"]),
            ring("y", lc + 0.4, 1, -0.4, 13.4, 1.5, ["sedan_white", "van", "hatch_green"]),
            ring("y", rc - 0.4, -1, -0.4, 13.4, 1.4, ["sedan_blue", "taxi"]),
            ring("y", rc + 0.4, 1, -0.4, 13.4, 1.6, ["hatch_green", "van", "sedan_white"]),
        ],
    }


if __name__ == "__main__":
    W, D = (GX1 - GX0) * U, (GY1 - GY0) * U
    S = [box(0, 0, -SLAB, W, D, 0, ground_mat, cast=False)]
    im, anchor = render(S, ground_shadow=0)
    im.save("out/city_ground.png")
    man = json.load(open("out/manifest.json"))
    man["city_ground"] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1], unitsPerGrid=U,
                              gx0=GX0, gy0=GY0, hull=solid_hull(S, anchor))
    json.dump(man, open("out/manifest.json", "w"), indent=1)
    json.dump(spots(), open("out/ground_spots.json", "w"), indent=1)
    json.dump(traffic(), open("out/traffic.json", "w"), indent=1)
    print("city_ground", im.size, anchor)
