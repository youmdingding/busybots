"""
Office-theme ground: one storey of an office tower seen as a cut-away — carpet-tile
corridors between the zones with coloured way-finding lines to each zone's door, a
terrazzo lift lobby along the front, a glass curtain wall (city view) on the N and W
back walls, a lift core with two lift doors on the W wall, and the slab edge showing
the lit storey below. Zones are NOT part of this: the board draws them on top.

Run: python3 office_ground.py  -> out/office_ground.png + manifest entry + out/office_spots.json
"""
import json, math
from isopix import box, render, rgb, mix, hash2, face_uv
from interiors import U
from props import solid_hull, flat

GX0, GY0, GX1, GY1 = 0.0, 0.0, 22.0, 16.3
SLAB = 14.0
WALL_H = 46.0
WT = 3.0                      # curtain wall depth (units)
LOBBY_Y = 11.9                # grid y where the lobby terrazzo starts
CORE = (11.7, 16.3)           # lift core along the W wall (grid y range)

ZONES = {
    "specs": (1.0, 0.9, 6.0, 5.3, "#3f8c86"),
    "plan": (7.0, 0.9, 12.0, 5.3, "#3a6ea5"),
    "build": (1.0, 6.0, 6.0, 10.6, "#c27a3a"),
    "review": (7.0, 6.0, 12.0, 10.6, "#7d5bc4"),
    "explore": (12.8, 0.9, 21.0, 5.3, "#c9a227"),
    "idle": (12.8, 6.0, 21.0, 11.4, "#4f9a6a"),
}

# way-finding lines: lift lobby -> main corridor -> each door (grid polylines)
LIFT = (0.9, 13.3)
ROUTES = {"specs": (3.5, 5.3), "build": (3.5, 6.0), "plan": (9.5, 5.3), "review": (9.5, 6.0)}
ORDER = ["specs", "build", "plan", "review", "explore", "idle"]


def route_pts(zid):
    o = (ORDER.index(zid) - 2.5) * 0.13                 # parallel lanes
    pts = [(LIFT[0], 13.3 + o), (6.5 + o, 13.3 + o), (6.5 + o, 5.65 + o * 0.6)]
    if zid == "idle":
        pts += [(12.4 + o * 0.6, 5.65 + o * 0.6), (12.4 + o * 0.6, 8.7), (12.8, 8.7)]
    elif zid == "explore":
        pts += [(16.9, 5.65 + o * 0.6), (16.9, 5.3)]
    else:
        x, y = ROUTES[zid]
        pts += [(x, 5.65 + o * 0.6), (x, y)]
    return pts

LINES = {z: route_pts(z) for z in ORDER}


def seg_d(px, py, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    L2 = vx * vx + vy * vy
    t = 0 if L2 == 0 else max(0.0, min(1.0, ((px - a[0]) * vx + (py - a[1]) * vy) / L2))
    return math.hypot(px - a[0] - t * vx, py - a[1] - t * vy)


def in_zone(x, y, pad=0.0):
    for (x0, y0, x1, y1, c) in ZONES.values():
        if x0 - pad <= x <= x1 + pad and y0 - pad <= y <= y1 + pad:
            return True
    return False


def carpet(ux, uy):
    t = U / 2
    a, b = int(ux // t), int(uy // t)
    base = rgb("#8c95a0") if (a + b) % 2 else rgb("#848d98")
    # quarter-turn tile texture: fine stripes alternating direction per tile
    s = (ux if (a + b) % 2 else uy) % 2.4
    if s < 0.6:
        base = base * 0.96
    if hash2(int(ux), int(uy), 101) < 0.05:
        base = base * 1.05
    return base


def terrazzo(ux, uy):
    h = hash2(int(ux * 1.3), int(uy * 1.3), 102)
    c = rgb("#e9e5dc")
    if h < 0.02:
        return rgb("#c4bdb0")
    if h > 0.988:
        return rgb("#9aa6b2")
    if h > 0.96:
        return rgb("#ddd4c0")
    return c


def floor_top(x, y, ux, uy):
    # way-finding lines
    for zid, pts in LINES.items():
        col = ZONES[zid][4]
        for a, b in zip(pts, pts[1:]):
            if seg_d(x, y, a, b) * U < 0.9:
                if not in_zone(x, y, -0.05):
                    return rgb(col)
    if y >= LOBBY_Y:
        # lobby: terrazzo with a brass inlay band and a big round rug in the lounge
        if abs(y - LOBBY_Y) * U < 1.2:
            return rgb("#b8985a")
        rx, ry = 17.4, 14.2
        d = math.hypot((x - rx) * 1.0, (y - ry) * 1.25)
        if d < 2.35:
            if d > 2.2:
                return rgb("#2f4858")
            if d > 1.95:
                return rgb("#d9b46a")
            c = rgb("#4f6d7a") if int((ux + uy) // 3) % 2 else rgb("#4a6774")
            return c
        # lift-lobby carpet runner in front of the lift doors
        if x < 2.6 and CORE[0] + 0.5 <= y <= CORE[1] - 0.6:
            if x < 2.45 and CORE[0] + 0.65 <= y <= CORE[1] - 0.75:
                return rgb("#3a4652")
            return rgb("#b8985a")
        return terrazzo(ux, uy)
    return carpet(ux, uy)


def sky_view(u, z, seed):
    """What you see through the curtain wall: afternoon sky + city towers."""
    t = (z - 6.0) / (WALL_H - 10.0)
    sky = mix(rgb("#cfe6f2"), rgb("#8fc2e2"), max(0.0, min(1.0, t)))
    k = int(u // 7.3)
    hgt = 8.0 + hash2(k, 3, seed) * 20.0
    if hash2(k, 4, seed) > 0.8:
        hgt += 10.0
    zz = z - 6.0
    if zz < hgt:
        far = hash2(k, 5, seed) > 0.5
        c = rgb("#7f97ad") if far else rgb("#6a8299")
        if (u % 7.3) < 0.6:
            return c * 0.85
        if int(zz) % 3 == 0 and (u % 1.8) < 1.0:
            return (rgb("#d8ecf5"), True) if hash2(int(u), int(zz), seed) > 0.7 else c * 1.12
        return c
    if hash2(int(u // 9), int(z // 4), seed + 1) > 0.985:
        return rgb("#ffffff")
    return sky


def curtain(which):
    def m(p, n):
        f, u, v = face_uv(p, n)
        coord = p[0] if which == "N" else p[1]
        z = p[2]
        inner = (f == "L" and which == "N") or (f == "R" and which == "W")
        if f == "top":
            return rgb("#4a525c")
        if not inner:
            return rgb("#5b636d")
        if z < 1.4:
            return rgb("#3a4048")                    # skirting
        if z < 6.0:
            return rgb("#5b636d") if z > 5.4 else rgb("#717a85")   # sill / spandrel
        if z > WALL_H - 4.0:
            return rgb("#3e454e") if z < WALL_H - 3.3 else rgb("#d9dde2")  # soffit
        # mullions every half grid, transom
        if coord % (U / 2) < 0.9 or abs(z - 30.0) < 0.5:
            return rgb("#3e454e")
        c = sky_view(coord + (300 if which == "W" else 0), z, 7 if which == "N" else 9)
        if isinstance(c, tuple):
            return (c[0], True)
        return (c, True)
    return m


def lift_core():
    y0, y1 = CORE[0] * U, CORE[1] * U
    doors = [(y0 + 0.9 * U, y0 + 1.95 * U), (y0 + 2.55 * U, y0 + 3.6 * U)]

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#4a525c")
        if f != "R":
            return rgb("#6e5a46")
        y, z = p[1], p[2]
        if z < 1.4:
            return rgb("#3a4048")
        for i, (a, b) in enumerate(doors):
            if a - 1.4 <= y <= b + 1.4 and z <= 25.4:
                if y < a or y > b or z > 24.0:
                    return rgb("#8a939c")            # steel surround
                if abs(y - (a + b) / 2) < 0.3:
                    return rgb("#6b737c")            # door split
                g = int((y - a) * 2) % 3
                return rgb("#c3cad1") if g else rgb("#b5bdc5")
            # call buttons + floor indicator
            if b + 2.6 <= y <= b + 4.0 and 9.0 <= z <= 12.6:
                if abs(z - 10.0) < 0.5 or abs(z - 11.6) < 0.5:
                    return (rgb("#ffcf5a"), True) if (i == 0 and z > 11) else rgb("#e9edf0")
                return rgb("#4a525c")
            if a + 2.0 <= y <= b - 2.0 and 27.0 <= z <= 30.0:
                if 27.6 < z < 29.4 and a + 3.0 < y < b - 3.0:
                    return (rgb("#ff7a4a"), True) if int((y - a) // 1.2) % 3 else rgb("#2b2f35")
                return rgb("#2b2f35")
        # walnut slat cladding
        k = y % 3.0
        if k < 0.5:
            return rgb("#4f3f31")
        return rgb("#7a5f46") if int(y // 3.0) % 2 else rgb("#735a42")
    return box(0, y0, 0, WT, y1, WALL_H - 4.0, m)


def ground_mat(p, n):
    f, u, v = face_uv(p, n)
    ux, uy = p[0], p[1]
    x, y = GX0 + ux / U, GY0 + uy / U
    if f != "top":
        z = p[2]
        if z > -1.8:
            return rgb("#d9dde2")                   # floor edge
        if z > -3.6:
            return rgb("#4a525c")                   # slab
        # storey below: dark glass with lit offices
        coord = ux if f == "L" else uy
        if coord % (U / 2) < 0.9:
            return rgb("#2c333b")
        k = int(coord // (U / 2))
        if hash2(k, 1, 103) > 0.55 and z > -11.5:
            return (rgb("#f3e2b0") if hash2(k, 2, 103) > 0.5 else rgb("#cfe2ee"), True)
        c = rgb("#3a4f63") if f == "L" else rgb("#30424f")
        return c
    return floor_top(x, y, ux, uy)


def solids():
    W, D = (GX1 - GX0) * U, (GY1 - GY0) * U
    S = [box(0, 0, -SLAB, W, D, 0, ground_mat, cast=False)]
    # N curtain wall (full width) and W curtain wall up to the lift core
    S.append(box(0, 0, 0, W, WT, WALL_H, curtain("N"), cast=False))
    S.append(box(0, WT, 0, WT, CORE[0] * U, WALL_H, curtain("W"), cast=False))
    S.append(lift_core())
    S.append(box(0, CORE[0] * U, WALL_H - 4.0, WT, D, WALL_H, flat("#3e454e"), cast=False))
    # concrete columns built into the curtain wall every 4 grid
    for gx in (4.0, 8.0, 12.0, 16.0, 20.0):
        S.append(box(gx * U - 3.0, 0, 0, gx * U + 3.0, WT + 3.2, WALL_H, flat("#c9ced4"), cast=False))
    for gy in (4.0, 8.0):
        S.append(box(0, gy * U - 3.0, 0, WT + 3.2, gy * U + 3.0, WALL_H, flat("#c9ced4"), cast=False))
    return S


def spots():
    S = []
    add = lambda t, x, y, **kw: S.append(dict({"type": "city_" + t, "gx": x, "gy": y}, **kw))
    # lift lobby
    add("office_fig_big", 0.55, 11.35)
    add("office_cooler", 0.45, 10.75)
    add("office_bench", 3.4, 14.0)
    add("office_fig_big", 2.9, 12.35)
    # reception + copier corner
    add("office_reception", 9.2, 14.6)
    add("office_fig_small", 11.4, 14.2)
    add("office_copier", 4.6, 12.55)
    add("office_whiteboard", 7.5, 12.6)
    # coffee point + vending along the corridor edge
    add("office_vending", 10.9, 12.45)
    add("office_bins", 12.35, 11.9)
    add("office_coffee_bar", 14.0, 12.5)
    # lounge on the rug (front-right) + phone pod
    add("office_lounge", 17.4, 14.2)
    add("office_floor_lamp", 19.9, 13.2)
    add("office_fig_small", 15.4, 15.7)
    add("office_phone_booth", 21.3, 15.3)
    return S

if __name__ == "__main__":
    S = solids()
    im, anchor = render(S, ground_shadow=0)
    im.save("out/office_ground.png")
    man = json.load(open("out/manifest.json"))
    man["office_ground"] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1], unitsPerGrid=U,
                                gx0=GX0, gy0=GY0, hull=solid_hull(S[:1], anchor))
    json.dump(man, open("out/manifest.json", "w"), indent=1)
    json.dump(spots(), open("out/office_spots.json", "w"), indent=1)
    print("office_ground", im.size, anchor)
