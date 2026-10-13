"""
Zone interiors for the City theme — one sprite per zone: floor slab, the two back
walls (N and W), furniture and the zone's name sign.  The front (S, E) walls are
left out so the room reads as an isometric cut-away.

Coordinates: world origin = the zone footprint's NW corner at floor level.
x runs along the board's gx axis, y along gy, z up. U units = one grid cell.
Agents stand in the middle of the floor (see claudeRoomInset in board.js), so
tall furniture hugs the back walls and the centre stays clear.

Run: python3 interiors.py  -> out/interior_<zone>.png + manifest entries
"""
import json, math, os, sys
import numpy as np
from isopix import box, vcyl, hcyl, blob, Solid, face_uv, rgb, mix, hash2, render, plane_through
from props import cone, flat, glass_px, planter_mat

# Board camera: TILE_W * worldScale / 2 screen px per grid step; drawing at 2x
# means one grid = 90 * 1.0421 / 4 ≈ 23.45 sprite units.
U = 23.45
WALL_H = 30.0
WALL_T = 2.0

FONT7 = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    " ": ["00000"] * 7,
}


def text7(text, u, v, u0, v_top, slope=0):
    """5x7 glyph test on a wall face. slope=+1 on L faces, -1 on R faces: the face
    rises half a pixel per column, so glyph rows step every two columns (2:1)."""
    col = math.floor(u - u0)
    if slope:
        v = v - slope * 0.5 * (col % 2)
    row = math.floor(v_top - v)
    if row < 0 or row > 6 or col < 0:
        return False
    ci, cx = divmod(col, 6)
    if ci >= len(text) or cx == 5:
        return False
    return FONT7.get(text[ci], FONT7[" "])[row][cx] == "1"


def emis(c):
    c = rgb(c) if isinstance(c, str) else c
    return lambda p, n: (c, True)


# ------------------------------------------------------------------ shared room shell
def room_shell(W, D, slab, floor_fn, wall_fn, trim="#1f6a66", side="#2a7a76", side_dark="#1d5c59",
               name=None, plate="#17504d", ink="#f7fbfa", plate_edge="#7fd1c7", plate_at=0.3,
               wall_h=None, wall_t=None, wall_h_w=None, door_n=None, door_w=None):
    """Floor slab + N and W back walls (+ zone name plate on the slab front). Returns solids."""
    tw = len(name) * 6 - 1 if name else 0
    # Plate on the slab's front-RIGHT face (x = W), which looks onto the open
    # corridor; the front-left face is usually hidden by the zone in front.
    pc = D * plate_at
    py0, py1 = pc - tw / 2 - 4, pc + tw / 2 + 4

    def slab_m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return floor_fn(p)
        if name and f == "R" and py0 <= p[1] <= py1 and -slab + 1.0 <= p[2] <= -1.6:
            uu, vv = py1 - p[1], p[2] + slab - 1.0
            hgt = slab - 2.6
            if uu < 0.8 or uu > (py1 - py0) - 0.8 or vv < 0.8 or vv > hgt - 0.8:
                return rgb(plate_edge)
            if text7(name, -p[1], p[2], -py1 + 4, -1.6 - (hgt - 7) / 2 - 0.3, slope=-1):
                return (rgb(ink), True)
            return rgb(plate)
        # slab sides: lighter band at the top edge (floor lip), darker below
        if p[2] > -1.4:
            return rgb("#e9ecef")
        c = rgb(side) if f == "L" else rgb(side_dark)
        return c * (0.94 if int(p[2]) % 4 == 0 else 1.0)

    S = [box(0, 0, -slab, W, D, 0, slab_m, cast=False)]

    def wallN(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(trim)
        if f == "R":  # exposed end of the wall
            return rgb(trim) * 1.05
        return wall_fn("N", p[0], p[2])

    def wallW(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(trim)
        if f == "L":  # exposed end
            return rgb(trim) * 1.1
        return wall_fn("W", p[1], p[2])

    wh = WALL_H if wall_h is None else wall_h
    wt = WALL_T if wall_t is None else wall_t
    whw = wh if wall_h_w is None else wall_h_w
    # N wall (split around a doorway if door_n=(x0, x1))
    if door_n:
        S.append(box(0, 0, 0, door_n[0], wt, wh, wallN))
        S.append(box(door_n[1], 0, 0, W, wt, wh, wallN))
    else:
        S.append(box(0, 0, 0, W, wt, wh, wallN))
    if door_w:
        S.append(box(0, wt, 0, wt, door_w[0], whw, wallW))
        S.append(box(0, door_w[1], 0, wt, D, whw, wallW))
    else:
        S.append(box(0, wt, 0, wt, D, whw, wallW))
    return S


# ------------------------------------------------------------------ entrances
DOOR_HALF = 7.5   # half-width of every doorway (units)


def doormat(x0, y0, x1, y1, col="#3a3f48", edge="#c9a77c"):
    def m(p, n):
        e = min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1])
        if e < 0.7:
            return rgb(edge)
        return rgb(col) if int((p[0] + p[1]) // 1.2) % 2 else rgb(col) * 1.12
    return [box(x0, y0, 0, x1, y1, 0.25, m, cast=False)]


def entrance_steps(side, c, slab, depth=1.6, n_steps=None, col="#c9c6bf"):
    """Steps from the floor (z=0) down to the street (z=-slab) outside a doorway.
    side: 'S' (+y edge at y=c[1]), 'N' (-y edge at y=0), 'W' (-x edge at x=0). c = (x or y centre, edge)."""
    k = n_steps or max(1, int(round(slab / 3.7)))
    S = []
    for i in range(k):
        top = -slab * (i + 1) / (k + 1) if i else -slab / (k + 1)
        top = -slab * (i + 1) / (k + 1)
        m = lambda p, n, top=top: rgb(col) if face_uv(p, n)[0] == "top" else rgb(col) * 0.82
        if side == "S":
            x, edge = c
            S.append(box(x - DOOR_HALF, edge + i * depth, -slab, x + DOOR_HALF, edge + (i + 1) * depth, top, m, cast=False))
        elif side == "N":
            x, edge = c
            S.append(box(x - DOOR_HALF, -(i + 1) * depth, -slab, x + DOOR_HALF, -i * depth, top, m, cast=False))
        else:
            y, edge = c
            S.append(box(-(i + 1) * depth, y - DOOR_HALF, -slab, -i * depth, y + DOOR_HALF, top, m, cast=False))
    return S


def door_frame_x(x, y, h, col, canopy=None, out=1):
    """Two posts + lintel across a doorway that runs along x (S or N edge).
    canopy: colour of a small awning projecting outward (out=+1 → +y, -1 → -y)."""
    c = flat(col)
    S = [box(x - DOOR_HALF - 1.2, y - 0.6, 0, x - DOOR_HALF, y + 0.6, h, c),
         box(x + DOOR_HALF, y - 0.6, 0, x + DOOR_HALF + 1.2, y + 0.6, h, c),
         box(x - DOOR_HALF - 1.2, y - 0.6, h, x + DOOR_HALF + 1.2, y + 0.6, h + 1.6, c)]
    if canopy:
        y0, y1 = (y, y + 4.5) if out > 0 else (y - 4.5, y)
        S.append(box(x - DOOR_HALF - 2.0, y0, h + 1.6, x + DOOR_HALF + 2.0, y1, h + 2.6, flat(canopy)))
    return S


def door_frame_y(x, y, h, col, canopy=None):
    """Posts + lintel across a doorway that runs along y (W edge); canopy projects to -x."""
    c = flat(col)
    S = [box(x - 0.6, y - DOOR_HALF - 1.2, 0, x + 0.6, y - DOOR_HALF, h, c),
         box(x - 0.6, y + DOOR_HALF, 0, x + 0.6, y + DOOR_HALF + 1.2, h, c),
         box(x - 0.6, y - DOOR_HALF - 1.2, h, x + 0.6, y + DOOR_HALF + 1.2, h + 1.6, c)]
    if canopy:
        def stripes(p, n):
            k = int((p[1] - y) // 2.5) % 2
            return rgb(canopy[0]) if k else rgb(canopy[1])
        S.append(box(x - 5.0, y - DOOR_HALF - 2.0, h + 1.6, x, y + DOOR_HALF + 2.0, h + 2.6, stripes))
    return S


# ------------------------------------------------------------------ furniture kit
def desk(x0, y0, x1, y1, top="#d9c3a0", leg="#5b6470", h=8.0):
    """Simple office desk: top slab + two side panels + modesty panel."""
    S = [box(x0, y0, h - 1.2, x1, y1, h, flat(top))]
    S.append(box(x0 + 0.4, y0 + 0.4, 0, x0 + 1.4, y1 - 0.4, h - 1.2, flat(leg)))
    S.append(box(x1 - 1.4, y0 + 0.4, 0, x1 - 0.4, y1 - 0.4, h - 1.2, flat(leg)))
    return S


def monitor(cx, cy, z, facing="L", w=8.0, h=5.6, seed=0, doc=True):
    """Monitor on a stand. facing 'L' = screen toward +y, 'R' = toward +x."""
    S = []
    bez = rgb("#22272e")
    if facing == "L":
        x0, x1 = cx - w / 2, cx + w / 2
        y0, y1 = cy - 0.6, cy + 0.4
    else:
        x0, x1 = cx - 0.6, cx + 0.4
        y0, y1 = cy - w / 2, cy + w / 2
    zs0, zs1 = z + 2.2, z + 2.2 + h

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != facing:
            return bez
        uu = (p[0] - x0) if facing == "L" else (y1 - p[1])
        vv = p[2] - zs0
        span = w
        if uu < 0.6 or uu > span - 0.6 or vv < 0.6 or vv > h - 0.6:
            return bez
        # screen content: header bar + text lines + a small diagram block
        if vv > h - 1.7:
            return (rgb("#2a9d8f"), True)
        row = int((h - 1.7 - vv) // 1.0)
        if doc:
            if (h - 1.7 - vv) % 1.0 < 0.55 and uu < span - 1.2 - (hash2(row, seed, 3) * 3):
                return (rgb("#8fa3b3"), True)
            return (rgb("#f2f7fa"), True)
        # code view
        if (h - 1.7 - vv) % 1.0 < 0.55 and 1.2 + hash2(row, seed) * 2 < uu < span - 1 - hash2(row, seed, 2) * 3:
            return (rgb(["#7fd1c7", "#f2c14e", "#e88a7a"][row % 3]), True)
        return (rgb("#1c2a33"), True)
    S.append(box(x0, y0, zs0, x1, y1, zs1, m))
    # stand
    if facing == "L":
        S.append(box(cx - 0.5, cy - 0.5, z, cx + 0.5, cy + 0.2, zs0, flat("#3a4048")))
        S.append(box(cx - 2.0, cy - 1.4, z, cx + 2.0, cy + 1.0, z + 0.5, flat("#3a4048")))
    else:
        S.append(box(cx - 0.5, cy - 0.5, z, cx + 0.2, cy + 0.5, zs0, flat("#3a4048")))
        S.append(box(cx - 1.4, cy - 2.0, z, cx + 1.0, cy + 2.0, z + 0.5, flat("#3a4048")))
    return S


def keyboard(x0, y0, x1, y1, z):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e7eaee") if int(p[0] * 1.2 + p[1] * 1.2) % 2 else rgb("#cfd5db")
        return rgb("#9aa3ad")
    return [box(x0, y0, z, x1, y1, z + 0.6, m)]


def office_chair(cx, cy, facing="N", col="#2f4858"):
    """Swivel chair. facing = direction the sitter looks (N = toward -y, W = toward -x)."""
    c = rgb(col)
    S = [vcyl(cx, cy, 2.4, 0, 0.6, flat("#30353b"), sides=5),
         vcyl(cx, cy, 0.5, 0.6, 4.2, flat("#4a5058"), sides=6),
         box(cx - 2.6, cy - 2.6, 4.2, cx + 2.6, cy + 2.6, 5.6, flat(c))]
    if facing == "N":
        S.append(box(cx - 2.4, cy + 1.8, 5.6, cx + 2.4, cy + 2.8, 11.5, flat(c * 0.92)))
    else:
        S.append(box(cx + 1.8, cy - 2.4, 5.6, cx + 2.8, cy + 2.4, 11.5, flat(c * 0.92)))
    return S


def bookshelf(x0, y0, x1, y1, h, seed=1, wood="#8a6a4c", along="x"):
    """Open shelf against a wall; books visible on the room-facing side."""
    shelves = 4
    cols = ["#d9534f", "#f0ad4e", "#5bc0de", "#5cb85c", "#3a6ea5", "#e8e1d0", "#8e6cc2", "#2a9d8f"]

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(wood) * 1.08
        front = (f == "L" and along == "x") or (f == "R" and along == "y")
        if not front:
            return rgb(wood)
        uu = (p[0] - x0) if along == "x" else (y1 - p[1])
        span = (x1 - x0) if along == "x" else (y1 - y0)
        zz = p[2]
        if uu < 0.9 or uu > span - 0.9 or zz < 0.9 or zz > h - 0.9:
            return rgb(wood)
        level_h = (h - 1.8) / shelves
        r = (zz - 0.9) % level_h
        lvl = int((zz - 0.9) // level_h)
        if r < 0.8:
            return rgb(wood) * 0.92  # shelf board
        k = int(uu // 1.3)
        hb = hash2(k, lvl, seed)
        top_of_book = 0.8 + (level_h - 1.4) * (0.6 + 0.4 * hash2(k, lvl, seed + 9))
        if hb < 0.12 or r > top_of_book:
            return rgb("#3b2d24")  # gap / shadow behind books
        c = rgb(cols[int(hb * 97) % len(cols)])
        return c * (0.88 if int(uu * 1.3) % 2 else 1.0)
    return [box(x0, y0, 0, x1, y1, h, m)]


def filing_cabinet(x0, y0, x1, y1, h, col="#b8c0c8", along="x"):
    def m(p, n):
        f, u, v = face_uv(p, n)
        c = rgb(col)
        if f == "top":
            return c * 1.06
        front = (f == "L" and along == "x") or (f == "R" and along == "y")
        if front:
            d = (p[2]) % (h / 3)
            if d < 0.5:
                return c * 0.7  # drawer gaps
            uu = (p[0] - (x0 + x1) / 2) if along == "x" else (p[1] - (y0 + y1) / 2)
            if abs(uu) < 1.2 and abs(d - h / 3 * 0.7) < 0.4:
                return rgb("#5a626c")  # handle
        return c
    return [box(x0, y0, 0, x1, y1, h, m)]


def potted_plant(cx, cy, r=4.0, h=10, pot="#e7e2d8", seed=3, big=True):
    def leaf(p, n):
        hh = hash2(int(p[0] / 1.6), int(p[1] / 1.6) + int(p[2] / 1.6) * 7, seed)
        if hh < 0.28:
            return rgb("#2f7d46")
        if hh > 0.8:
            return rgb("#7cc46a")
        return rgb("#4b9e55")
    S = [vcyl(cx, cy, r * 0.62, 0, h * 0.42, flat(pot), sides=8),
         vcyl(cx, cy, r * 0.7, h * 0.36, h * 0.46, flat(rgb(pot) * 0.9), sides=8),
         blob(cx, cy, h * 0.72, r, leaf, n=24, squash=1.1 if big else 0.9, seed=seed)]
    if big:
        S.append(blob(cx - r * 0.45, cy + r * 0.3, h * 1.02, r * 0.7, leaf, n=18, seed=seed + 1))
        S.append(blob(cx + r * 0.4, cy - r * 0.35, h * 0.95, r * 0.65, leaf, n=18, seed=seed + 2))
    return S


def water_cooler(cx, cy):
    def body(p, n):
        f, u, v = face_uv(p, n)
        if f in ("L", "R") and 7.2 < p[2] < 8.4:
            return rgb("#3b82c4")  # tap panel
        return rgb("#eef1f4") if f != "top" else rgb("#dfe4e9")

    def bottle(p, n):
        return (mix(rgb("#8fd3f5"), rgb("#d8f1fb"), 0.5 if int(p[2] * 2) % 3 else 0.0), False)
    return [box(cx - 2.6, cy - 2.6, 0, cx + 2.6, cy + 2.6, 10, body),
            vcyl(cx, cy, 2.2, 10, 15.5, bottle, sides=10),
            vcyl(cx, cy, 0.9, 15.5, 16.5, flat("#6fb6d9"), sides=8)]


def printer(x0, y0, x1, y1, z):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            if (p[0] - x0) < (x1 - x0) * 0.45:
                return rgb("#f7f7f2")  # paper tray
            return rgb("#d5d9de")
        if p[2] < z + 1.4:
            return rgb("#9aa2ab")
        if f == "R" and abs(p[1] - (y0 + y1) / 2) < 1.2 and p[2] > z + 3:
            return (rgb("#3ddc97"), True)
        return rgb("#c6cbd1")
    return [box(x0, y0, z, x1, y1, z + 5, m)]


def mug(cx, cy, z, col="#e76f51"):
    return [vcyl(cx, cy, 0.8, z, z + 1.6, flat(col), sides=6)]


def paper_stack(x0, y0, z, w=3.0, d=2.2, h=1.2):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#fbfbf6")
        return rgb("#e3e3da") if int(p[2] * 3) % 2 else rgb("#f4f4ee")
    return [box(x0, y0, z, x0 + w, y0 + d, z + h, m)]


def desk_lamp(cx, cy, z, col="#f2c14e"):
    return [vcyl(cx, cy, 1.0, z, z + 0.4, flat("#2d3238"), sides=6),
            box(cx - 0.25, cy - 0.25, z + 0.4, cx + 0.25, cy + 0.25, z + 4.5, flat("#2d3238")),
            box(cx - 0.3, cy - 0.3, z + 4.2, cx + 2.4, cy + 0.6, z + 5.2, flat(col)),
            box(cx + 1.2, cy - 0.2, z + 3.7, cx + 2.3, cy + 0.5, z + 4.2, emis("#fff3c4"))]


# ------------------------------------------------------------------ SPECS: open-plan office
def interior_specs(W, D, slab):
    teal_d, teal = "#1f6a66", "#2a8a84"

    # carpet tiles in muted teal + a light rug where the agents gather
    rug = (1.05 * U + 2, 1.1 * U - 4, W - 1.05 * U - 3, 2.95 * U + 6)  # x0,y0,x1,y1

    def floor(p):
        x, y = p[0], p[1]
        rx0, ry0, rx1, ry1 = rug
        if rx0 <= x <= rx1 and ry0 <= y <= ry1:
            edge = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
            if edge < 1.2:
                return rgb("#2c6e6a")
            if edge < 2.2:
                return rgb("#a9cbc4")
            c = rgb("#8dbab2")
            if hash2(int(x / 1.5), int(y / 1.5), 21) < 0.1:
                c = rgb("#82b0a8")
            if int((x - rx0) // 6 + (y - ry0) // 6) % 2 == 0 and edge > 4:
                c = c * 1.03
            return c
        tile = (int(x // 7.8) + int(y // 7.8)) % 2
        c = rgb("#4f8f8a") if tile else rgb("#478580")
        if hash2(int(x), int(y), 4) < 0.07:
            c = c * 0.93
        if x % 7.8 < 0.45 or y % 7.8 < 0.45:
            c = c * 0.9
        return c

    def wall(which, u, z):
        # wainscot + skirting, painted upper wall, crown trim
        if z < 1.2:
            return rgb("#2b3a3f")
        if z < 9:
            c = rgb("#3f8c86")
            return c * (0.94 if int(u) % 6 == 0 else 1.0)
        if z < 9.8:
            return rgb("#e9f1ef")
        if z > WALL_H - 1.2:
            return rgb("#e9f1ef")
        return rgb("#dfe9e6") if int(z) % 7 else rgb("#d7e2df")

    S = room_shell(W, D, slab, floor, wall, name="SPECS")
    T = WALL_T
    dx = 2.5 * U  # door centre (board door point: middle of the S edge)
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#1f6a66", edge="#7fd1c7")
    S += door_frame_x(dx, D - 0.6, 22.0, "#1f6a66", canopy="#17504d", out=1)
    S += entrance_steps("S", (dx, D), slab)

    # --- windows on the N wall (city at dusk behind glass), right half
    def win_mat(x0, x1, z0, z1):
        def m(p, n):
            f, u, v = face_uv(p, n)
            if f == "top":
                return rgb("#e9f1ef")
            if f != "L":
                return rgb("#c9d6d3")
            uu, vv = p[0] - x0, p[2] - z0
            if uu < 0.9 or uu > (x1 - x0) - 0.9 or vv < 0.9 or vv > (z1 - z0) - 0.9:
                return rgb("#f4f8f7")  # frame
            if abs(uu - (x1 - x0) / 2) < 0.45:
                return rgb("#f4f8f7")  # mullion
            t = vv / (z1 - z0)
            sky = mix(rgb("#f0a878"), rgb("#7a7fb8"), t)
            # distant skyline silhouettes
            k = int((p[0]) // 2.3)
            hgt = 2 + hash2(k, 7, 11) * 6
            if vv < hgt:
                c = rgb("#3d4a6b")
                if hash2(int(p[0] * 1.3), int(vv * 1.2), 5) < 0.12:
                    return (rgb("#ffd98a"), True)
                return (c, True)
            return (sky, True)
        return m
    for wx0 in (70.0, 92.0):
        S.append(box(wx0, T - 0.1, 12.5, wx0 + 18, T + 0.25, 26.5, win_mat(wx0, wx0 + 18, 12.5, 26.5)))

    # --- SPECS name sign on the N wall (backlit panel + doc icon)
    sx0, sx1, sz0, sz1 = 24.0, 62.0, 14.0, 25.0
    name = "SPECS"
    tw = len(name) * 6 - 1
    tx = sx0 + 9.5

    def sign(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(teal_d)
        if f != "L":
            return rgb(teal_d) * 0.9
        uu, vv = p[0] - sx0, p[2] - sz0
        if uu < 0.8 or uu > (sx1 - sx0) - 0.8 or vv < 0.8 or vv > (sz1 - sz0) - 0.8:
            return rgb("#7fd1c7")
        # document icon
        if 2.2 < uu < 7.2 and 2.0 < vv < 9.0:
            if uu > 5.8 and vv > 7.6:
                return rgb("#1f6a66")  # folded corner
            if 2.8 < uu < 6.6 and (vv - 2.0) % 1.6 < 0.6 and vv < 7.2:
                return (rgb("#2a9d8f"), True)
            return (rgb("#f7fbfa"), True)
        if text7(name, p[0], p[2], tx, sz0 + 8.5, slope=1):
            return (rgb("#f7fbfa"), True)
        return rgb("#17504d")
    S.append(box(sx0, T, sz0, sx1, T + 0.9, sz1, sign))

    # --- row of desks along the N wall
    y_d0, y_d1 = T + 0.2, T + 9.5
    for i, (dx0, dx1) in enumerate(((24.0, 46.0), (48.0, 70.0), (72.0, 94.0))):
        S += desk(dx0, y_d0, dx1, y_d1)
        mx = (dx0 + dx1) / 2
        S += monitor(mx - 4.4, y_d0 + 2.4, 8.0, "L", w=7.6, seed=i * 2, doc=(i != 1))
        S += monitor(mx + 4.4, y_d0 + 2.4, 8.0, "L", w=7.6, seed=i * 2 + 1, doc=True)
        S += keyboard(mx - 3.2, y_d0 + 5.6, mx + 3.2, y_d0 + 7.6, 8.0)
        S += office_chair(mx, y_d1 + 3.4, "N", col=["#4f7d95", "#5a8aa0", "#4f7d95"][i])
    S += mug(28.0, y_d0 + 6.5, 8.0)
    S += paper_stack(40.5, y_d0 + 4.8, 8.0)
    S += desk_lamp(51.0, y_d0 + 1.6, 8.0)
    S += mug(90.5, y_d0 + 6.8, 8.0, col="#2a9d8f")
    S += paper_stack(74.5, y_d0 + 5.2, 8.0, h=2.0)

    # --- NW corner: tall bookshelf + filing cabinets
    S += bookshelf(T + 0.2, T + 0.2, 20.0, T + 6.0, 24.0, seed=2, along="x")
    S += filing_cabinet(T + 0.2, T + 7.0, T + 6.5, T + 15.0, 12.0, along="y")

    # --- W wall: a desk facing the wall, corkboard above, printer, plant
    S += desk(T + 0.2, 24.0, T + 9.5, 46.0)
    S += monitor(T + 2.6, 30.4, 8.0, "R", w=7.6, seed=7, doc=False)
    S += monitor(T + 2.6, 39.6, 8.0, "R", w=7.6, seed=8, doc=True)
    S += keyboard(T + 5.6, 31.8, T + 7.6, 38.2, 8.0)
    S += office_chair(T + 12.8, 35.0, "W", col="#5a8aa0")

    def whiteboard(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#9aa4ad")
        uu, zz = 46.0 - p[1], p[2] - 12.0      # uu runs left->right on screen
        if uu < 0.8 or uu > 21.2 or zz < 0.8 or zz > 11.2:
            return rgb("#b9c2ca")  # aluminium frame
        if zz < 1.6:
            return rgb("#9aa4ad")  # marker tray
        # spec diagram: three boxes joined by arrows + a checklist
        boxes = ((2.0, 6.5, 7.0, 10.0, "#2a9d8f"), (9.0, 6.5, 14.0, 10.0, "#e76f51"), (5.5, 2.4, 10.5, 5.4, "#3a6ea5"))
        for (u0, z0, u1, z1, col) in boxes:
            if u0 <= uu <= u1 and z0 <= zz <= z1:
                if uu < u0 + 0.6 or uu > u1 - 0.6 or zz < z0 + 0.6 or zz > z1 - 0.6:
                    return rgb(col)
                if abs(zz - (z0 + z1) / 2) < 0.3 and u0 + 1.2 < uu < u1 - 1.2:
                    return rgb(col) * 1.1
                return rgb("#fbfdfd")
        if 7.0 < uu < 9.0 and abs(zz - 8.2) < 0.3:
            return rgb("#4a5560")  # arrow
        if abs(uu - 8.0) < 0.3 and 5.4 < zz < 6.5:
            return rgb("#4a5560")
        if 16.0 < uu < 20.4 and 2.4 < zz < 10.4:
            r = (zz - 2.4) % 2.0
            if r < 0.7:
                if uu < 17.0:
                    return rgb("#3ddc97") if zz > 4.4 else rgb("#e9eef2")
                if uu < 20.0:
                    return rgb("#8a95a0")
        return rgb("#fbfdfd")
    S.append(box(T, 24.0, 12.0, T + 0.8, 46.0, 24.0, whiteboard))

    # wall clock above the corkboard edge (on W wall)
    def clock(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#2d3238")
        d = math.hypot(p[1] - 52.0, p[2] - 21.0)
        if d > 2.9:
            return rgb("#2d3238")
        a = math.atan2(p[2] - 21.0, p[1] - 52.0)
        if d < 2.2 and (abs(p[2] - 21.0) < 0.35 and p[1] < 52.0 + 0.3 and p[1] > 50.4):
            return rgb("#1d2227")
        if d < 2.2 and (abs(p[1] - 52.0) < 0.35 and 21.0 < p[2] < 22.9):
            return rgb("#1d2227")
        return rgb("#f7f7f2")
    S.append(box(T, 48.5, 17.5, T + 0.6, 55.5, 24.5, clock))

    S += filing_cabinet(T + 0.2, 50.0, T + 7.0, 60.0, 7.0, col="#c3cad1", along="y")
    S += printer(T + 0.8, 50.8, T + 6.4, 59.2, 7.0)
    # lounge: sofa along the W wall + small meeting table in the front-left corner
    S += sofa_y(T + 0.4, 66.0, 88.0, col="#5a8aa0")
    S += potted_plant(T + 5.0, D - 7.5, r=4.0, h=11, seed=5)

    # --- front-right corner plant + water cooler at the N wall's open end
    S += water_cooler(W - 6.5, T + 4.5)
    S += potted_plant(W - 6.0, D - 7.0, r=4.2, h=11, seed=9)
    # little bin by the W desk
    S.append(vcyl(T + 13.0, 47.5, 1.4, 0, 3.2, flat("#5a6470"), sides=8))
    return S


def sofa_y(x0, y0, y1, col="#5a8aa0"):
    """Two-seat sofa with its back against the W wall (seat faces +x)."""
    c = rgb(col)

    def cush(p, n):
        f, u, v = face_uv(p, n)
        k = int((p[1] - y0) // ((y1 - y0) / 2))
        return c * (1.06 if f == "top" else 1.0) * (0.96 if k % 2 else 1.0)
    return [box(x0, y0, 0, x0 + 9.0, y1, 4.6, cush),
            box(x0, y0, 4.6, x0 + 3.0, y1, 10.0, flat(c * 0.9)),
            box(x0, y0 - 2.0, 0, x0 + 9.0, y0, 7.0, flat(c * 0.84)),
            box(x0, y1, 0, x0 + 9.0, y1 + 2.0, 7.0, flat(c * 0.84))]


def round_table(cx, cy, r, top="#e8dcc8"):
    return [vcyl(cx, cy, 2.0, 0, 0.6, flat("#3a4048"), sides=8),
            vcyl(cx, cy, 0.6, 0.6, 6.2, flat("#3a4048"), sides=6),
            vcyl(cx, cy, r, 6.2, 7.0, flat(top), sides=12)]



# ------------------------------------------------------------------ BUILD: construction site
def cone_marker(cx, cy, h=4.2):
    def m(p, n):
        z = p[2]
        if 1.6 < z < 2.4:
            return rgb("#f7f7f2")  # reflective band
        return rgb("#f26b1d")
    return [box(cx - 1.6, cy - 1.6, 0, cx + 1.6, cy + 1.6, 0.6, flat("#2d2d2d")),
            cone(cx, cy, 0.6, 1.3, h, m, sides=8)]


def barrier_x(x0, x1, cy, h=4.6):
    """Striped plastic/steel barrier running along x."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#f2f2ee")
        k = int((p[0] - p[2]) // 2.2) % 2
        return rgb("#e63b2e") if k else rgb("#f7f7f2")
    S = [box(x0, cy - 0.5, h - 2.0, x1, cy + 0.5, h, m)]
    for x in (x0 + 0.6, x1 - 1.6):
        S.append(box(x, cy - 0.4, 0, x + 1.0, cy + 0.4, h - 2.0, flat("#5a5f66")))
        S.append(box(x - 0.6, cy - 1.4, 0, x + 1.6, cy + 1.4, 0.5, flat("#3a3e44")))
    return S


def pallet_bricks(x0, y0, w=7.0, d=5.0, rows=4):
    def bricks(p, n):
        f, u, v = face_uv(p, n)
        z = p[2] - 1.2
        row = int(z // 1.1)
        off = 1.0 if row % 2 else 0.0
        a = (p[0] if f in ("L", "top") else p[1]) + off
        if z % 1.1 < 0.25 or a % 2.0 < 0.25:
            return rgb("#c9b9a6")  # mortar-ish gaps
        return rgb("#b4553a") if hash2(int(a // 2), row, 3) > 0.3 else rgb("#9d4a33")
    return [box(x0, y0, 0, x0 + w, y0 + d, 1.2, wood_mat("#a77b4f")),
            box(x0 + 0.3, y0 + 0.3, 1.2, x0 + w - 0.3, y0 + d - 0.3, 1.2 + rows * 1.1, bricks)]


def wood_mat(c="#b8875a"):
    def m(p, n):
        f, u, v = face_uv(p, n)
        base = rgb(c)
        if f == "top":
            return base * (1.08 if int(p[1] * 1.3) % 3 else 0.94)
        return base * (0.9 if int(p[2] * 2) % 2 else 1.0)
    return m


def timber_stack(x0, y0, length=16.0, d=6.0, layers=4, along="x"):
    S = []
    for k in range(layers):
        z0 = k * 1.4
        if along == "x":
            S.append(box(x0, y0, z0, x0 + length, y0 + d, z0 + 1.2, wood_mat("#c8975f" if k % 2 else "#b8875a")))
        else:
            S.append(box(x0, y0, z0, x0 + d, y0 + length, z0 + 1.2, wood_mat("#c8975f" if k % 2 else "#b8875a")))
    return S


def rebar_bundle(x0, y0, length=18.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#7a4a30") if int(p[1] * 2.5) % 2 else rgb("#5a3624")
        return rgb("#6b3f29")
    return [box(x0, y0, 0.6, x0 + length, y0 + 3.0, 2.2, m),
            box(x0 + 2, y0 - 0.2, 0, x0 + 3, y0 + 3.2, 0.6, flat("#8a6a4c")),
            box(x0 + length - 3, y0 - 0.2, 0, x0 + length - 2, y0 + 3.2, 0.6, flat("#8a6a4c"))]


def cement_bags(x0, y0, n_=3):
    S = []
    for k in range(n_):
        z0 = k * 1.4
        dx = (k % 2) * 0.8
        S.append(box(x0 + dx, y0, z0, x0 + dx + 5.0, y0 + 3.0, z0 + 1.4,
                     lambda p, n: rgb("#e8e0c8") if face_uv(p, n)[0] != "L" or abs(p[2] % 1.4 - 0.7) > 0.3 else rgb("#2a6fb5")))
    return S


def wheelbarrow(cx, cy):
    """Green barrow tipped toward +x (wheel end), handles toward -x."""
    def tub(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#8a8f96") if abs(p[1] - cy) < 1.6 and abs(p[0] - cx) < 2.4 else rgb("#2f8f4e")
        return rgb("#2f8f4e")
    return [box(cx - 3.0, cy - 2.4, 2.2, cx + 3.0, cy + 2.4, 5.2, tub,
                extra=[plane_through((1, 0, 0.8), (cx + 3.0, cy, 3.2))]),
            hcyl("y", cx + 3.4, 1.5, 1.5, cy - 0.5, cy + 0.5, flat("#26272b"), sides=8),
            box(cx - 6.5, cy - 2.2, 3.0, cx - 2.6, cy - 1.6, 3.6, flat("#6b4a33")),
            box(cx - 6.5, cy + 1.6, 3.0, cx - 2.6, cy + 2.2, 3.6, flat("#6b4a33")),
            box(cx - 2.4, cy - 2.0, 0, cx - 1.8, cy - 1.4, 2.4, flat("#3a3e44")),
            box(cx - 2.4, cy + 1.4, 0, cx - 1.8, cy + 2.0, 2.4, flat("#3a3e44"))]


def site_cabin(x0, y0, x1, y1, h=12.5):
    """Blue portable site office (along x), door + window facing +y."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#c9cdd2")
        c = rgb("#2f6fb0")
        rib = (p[0] if f == "L" else p[1]) % 2.0 < 0.5
        if f == "L":
            if x0 + 3 < p[0] < x0 + 8.5 and 3.5 < p[2] < 9.5:  # window
                if x0 + 3.6 < p[0] < x0 + 7.9 and 4.1 < p[2] < 8.9:
                    return glass_px(p[0], p[2], base="#7fb3cf", t=(p[2] - 4) / 5)
                return rgb("#e9eef2")
            if x1 - 6.5 < p[0] < x1 - 2.5 and p[2] < 10:
                if abs(p[0] - (x1 - 3.4)) < 0.4 and abs(p[2] - 5) < 0.5:
                    return rgb("#e9e9e9")
                return rgb("#e9eef2") if (p[0] < x1 - 6.0 or p[0] > x1 - 3.0 or p[2] > 9.5) else rgb("#d8dde2")
        if p[2] < 1.0 or p[2] > h - 1.0:
            return rgb("#e9eef2")
        return c * (0.88 if rib else 1.0)
    return [box(x0, y0, 0, x1, y1, h, m),
            box(x1 - 7.2, y1, 0, x1 - 1.8, y1 + 2.4, 1.2, flat("#7a7f86"))]


def scaffold_x(x0, x1, y0, depth, levels, lvl_h=9.0):
    """Tube scaffold with plank decks along x (in front of a wall at y0)."""
    S = []
    pole = flat("#9aa3ad")
    xs = [x0 + i * (x1 - x0) / 3 for i in range(4)]
    for x in xs:
        for y in (y0 + 0.2, y0 + depth - 0.8):
            S.append(box(x, y, 0, x + 0.6, y + 0.6, levels * lvl_h + 4, pole))
    for k in range(1, levels + 1):
        z = k * lvl_h
        S.append(box(x0, y0, z, x1 + 0.6, y0 + depth, z + 0.8, wood_mat("#c8975f")))
        S.append(box(x0, y0 + depth - 0.8, z + 3.6, x1 + 0.6, y0 + depth - 0.3, z + 4.1, pole))  # guard rail
        # toe board in safety orange
        S.append(box(x0, y0 + depth - 0.7, z + 0.8, x1 + 0.6, y0 + depth - 0.4, z + 1.8, flat("#f28c28")))
    # ladder
    lx = xs[1] + 3
    for z in range(1, int(levels * lvl_h), 2):
        S.append(box(lx, y0 + depth - 0.5, z, lx + 2.4, y0 + depth - 0.1, z + 0.35, flat("#e2b13c")))
    S.append(box(lx - 0.3, y0 + depth - 0.6, 0, lx, y0 + depth, levels * lvl_h + 2, flat("#e2b13c")))
    S.append(box(lx + 2.4, y0 + depth - 0.6, 0, lx + 2.7, y0 + depth, levels * lvl_h + 2, flat("#e2b13c")))
    return S


def brick_wall_x(x0, x1, y0, y1, h, seed=4):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#b8664a")
        z = p[2]
        row = int(z // 1.2)
        a = (p[0] if f == "L" else p[1]) + (1.1 if row % 2 else 0)
        if z % 1.2 < 0.25 or a % 2.2 < 0.25:
            return rgb("#d8cbb8")
        return rgb("#b4553a") if hash2(int(a // 2.2), row, seed) > 0.25 else rgb("#a24a34")
    # stepped top = unfinished wall
    S = []
    steps = 4
    for k in range(steps):
        sx0 = x0 + (x1 - x0) * k / steps
        sx1 = x0 + (x1 - x0) * (k + 1) / steps
        S.append(box(sx0, y0, 0, sx1, y1, h * (1 - 0.18 * k), m))
    return S


def tower_crane(mx, my, H=74.0, jib=46.0, counter=14.0):
    """Lattice tower crane: mast at (mx,my); jib along -x, counter-jib along +x."""
    yel, dark = rgb("#f2b705"), rgb("#7a5a00")

    def lattice(axis_len_coord):
        def m(p, n):
            f, u, v = face_uv(p, n)
            a = p[axis_len_coord]
            b = p[2] if axis_len_coord != 2 else (p[0] if f != "R" else p[1])
            if f == "top" and axis_len_coord == 2:
                return yel
            t = (a + b) % 3.0
            t2 = (a - b) % 3.0
            if t < 0.55 or t2 < 0.55:
                return yel
            return dark * 0.6
        return m
    S = [box(mx - 3.5, my - 3.5, 0, mx + 3.5, my + 3.5, 2.0, flat("#9a9c9e")),   # concrete base
         box(mx - 1.6, my - 1.6, 2.0, mx + 1.6, my + 1.6, H, lattice(2)),      # mast
         box(mx - 2.4, my - 2.4, H, mx + 2.4, my + 2.4, H + 2.4, flat(yel)),   # slewing unit
         box(mx + 0.2, my - 2.2, H - 4.0, mx + 3.6, my + 2.2, H, cab_mat()),  # cab
         box(mx - jib, my - 1.0, H + 2.4, mx - 1.6, my + 1.0, H + 4.4, lattice(0)),
         box(mx + 1.6, my - 1.0, H + 2.4, mx + counter, my + 1.0, H + 4.0, lattice(0)),
         box(mx + counter - 5, my - 1.8, H + 0.2, mx + counter - 0.5, my + 1.8, H + 3.6, flat("#8e9196")),  # counterweight
         box(mx - 0.8, my - 0.8, H + 4.4, mx + 0.8, my + 0.8, H + 11.0, flat(yel)),  # apex
         box(mx - 0.3, my - 0.3, H + 11.0, mx + 0.3, my + 0.3, H + 12.0, emis("#ff4a3d"))]
    # trolley, cable and a steel beam load hanging over the street
    tx = mx - jib * 0.72
    S.append(box(tx - 1.2, my - 1.4, H + 1.6, tx + 1.2, my + 1.4, H + 2.4, flat("#4a4f57")))
    S.append(box(tx - 0.15, my - 0.15, H - 30.0, tx + 0.15, my + 0.15, H + 1.6, flat("#2d3238")))
    S.append(box(tx - 0.8, my - 0.8, H - 31.2, tx + 0.8, my + 0.8, H - 30.0, flat("#e2b13c")))
    S.append(box(tx - 6.0, my - 1.0, H - 33.4, tx + 6.0, my + 1.0, H - 31.2, flat("#c0392b")))
    return S


def cab_mat():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f in ("L", "R") and p[2] > 72.0:
            return glass_px(u, p[2], base="#8fc6e0", t=0.6, streak=False)
        return rgb("#f2b705")
    return m


def cement_mixer(cx, cy):
    def drum(p, n):
        k = int((p[0] - cx) * 1.2) % 3
        return rgb("#f28c28") if k else rgb("#d8721a")
    return [box(cx - 3.5, cy - 2.4, 0, cx + 3.5, cy - 1.8, 4.0, flat("#3a3e44")),
            box(cx - 3.5, cy + 1.8, 0, cx + 3.5, cy + 2.4, 4.0, flat("#3a3e44")),
            hcyl("y", cx - 4.2, 1.3, 1.3, cy - 2.6, cy - 1.8, flat("#26272b"), sides=8),
            hcyl("x", cy, 7.0, 3.2, cx - 3.0, cx + 2.2, drum, sides=10),
            cone(cx + 2.2, cy, 7.0, 1.0, 0.1, flat("#f28c28"), sides=6) if False else
            hcyl("x", cy, 7.0, 1.8, cx + 2.2, cx + 4.0, flat("#d8721a"), sides=8)]


def sand_pile(cx, cy, r=7.0, h=4.2):
    def m(p, n):
        return rgb("#e2c48a") if hash2(int(p[0] * 1.5), int(p[1] * 1.5) + int(p[2] * 3), 8) > 0.15 else rgb("#cfae72")
    return [cone(cx, cy, 0, r, h, m, sides=14)]


def interior_build(W, D, slab):
    U_ = U
    pad = (1.05 * U_ - 1, 1.1 * U_ - 4, W - 1.05 * U_ + 1, 3.15 * U_ + 5)  # concrete pad under agents

    def floor(p):
        x, y = p[0], p[1]
        px0, py0, px1, py1 = pad
        if px0 <= x <= px1 and py0 <= y <= py1:
            edge = min(x - px0, px1 - x, y - py0, py1 - y)
            if edge < 1.4:
                return rgb("#a77b4f")  # timber formwork edge
            c = rgb("#b9bcbf")
            if (x - px0) % 15 < 0.4 or (y - py0) % 15 < 0.4:
                c = rgb("#9fa3a7")  # expansion joints
            elif hash2(int(x), int(y), 12) < 0.06:
                c = rgb("#a9adb1")
            return c
        # compacted dirt with gravel + tyre tracks
        h = hash2(int(x / 1.2), int(y / 1.2), 13)
        c = rgb("#9a7a55")
        if h < 0.12:
            c = rgb("#86684a")
        elif h > 0.9:
            c = rgb("#b8a080")
        if (int(y) in (int(D - 14), int(D - 13), int(D - 8), int(D - 7))) and x > 20:
            c = c * 0.85  # tracks
        return c

    def hoarding(which, u, z):
        # plywood site fence: hazard band at the bottom, white top rail, panels every 8 units
        if z < 2.0:
            k = int((u - z) // 2.0) % 2
            return rgb("#1d1d1f") if k else rgb("#f2b705")
        if z > 11.6:
            return rgb("#f4f1ea")
        if u % 8.0 < 0.5:
            return rgb("#b9925f")
        return rgb("#d9b47c") if hash2(int(u // 8), int(z // 3), 14) > 0.15 else rgb("#cfa86f")

    S = room_shell(W, D, slab, floor, hoarding, trim="#f4f1ea", side="#7a6248", side_dark="#5f4b37",
                   wall_h=12.5, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    # site gate: tall posts + open chain-link leaves swung inward, steps down to the street
    for sgn in (-1, 1):
        px = dx + sgn * (DOOR_HALF + 0.6)
        S.append(box(px - 0.7, -0.2, 0, px + 0.7, 1.4, 16.0, flat("#f2b705")))
        lx0, lx1 = (px - 0.4, px + 0.4)
        S.append(box(lx0, 1.4, 0.6, lx1, 9.0, 12.0, chainlink()))
    S.append(box(dx - DOOR_HALF - 1.3, -0.2, 16.0, dx + DOOR_HALF + 1.3, 1.4, 17.4, flat("#1d1d1f")))
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col="#7a7f86", edge="#f2b705")
    S += entrance_steps("N", (dx, 0), slab)

    # big BUILD sign panel on the N fence (painted hoarding banner)
    sx0, sx1 = 4.0, 44.0

    def banner(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#1d1d1f")
        uu, zz = p[0] - sx0, p[2] - 3.0
        if uu < 0.8 or uu > (sx1 - sx0) - 0.8 or zz < 0.8 or zz > 8.2:
            return rgb("#1d1d1f")
        # hard-hat icon
        if 2.0 < uu < 7.0 and 2.0 < zz < 6.6:
            d = math.hypot(uu - 4.5, (zz - 3.0) * 1.2)
            if zz < 3.0 and abs(uu - 4.5) < 2.6:
                return rgb("#1d1d1f")
            if d < 2.6:
                return rgb("#1d1d1f")
        if text7("BUILD", p[0], p[2], sx0 + 8.5, 3.0 + 7.6, slope=1):
            return (rgb("#1d1d1f"), True)
        return (rgb("#ffc81a"), True)
    S.append(box(sx0, T, 3.0, sx1, T + 0.6, 12.0, banner))

    # NE corner: site office cabin; materials along the N fence
    S += site_cabin(W - 26.0, T + 1.0, W - 3.0, T + 11.0)
    S += pallet_bricks(70.0, T + 9.0)
    S += pallet_bricks(78.0, T + 9.0, rows=3)
    S += timber_stack(70.0, T + 2.0, length=19.0, d=5.0, layers=4)
    S += cement_bags(44.0, T + 2.0)
    S += cone_marker(dx - 10.0, T + 9.5)
    S += cone_marker(dx + 10.0, T + 9.5)

    # W side: half-built brick wall with scaffolding in front of it
    S += brick_wall_y(T + 0.2, T + 4.0, 24.0, 64.0, 22.0)
    S += scaffold_y(T + 4.0, 24.0, 64.0, 6.0, 2)
    S += rebar_bundle_y(T + 12.0, 10.0, 16.0)

    # SW corner: tower crane (jib swings out over the street on the left)
    S += tower_crane(10.0, D - 14.0)
    # front: mixer, sand pile, barrier + cones (all low)
    S += cement_mixer(30.0, D - 9.0)
    S += sand_pile(W - 14.0, D - 12.0, r=6.0, h=6.5)
    S += wheelbarrow(W - 28.0, D - 8.0)
    S += site_signboard(W - 2.2, 26.0, 68.0, "BUILD")
    S += cone_marker(W - 5.0, D - 22.0)
    S += cone_marker(W - 5.0, D - 4.0)
    S += cone_marker(W - 7.0, 74.0)
    return S


def chainlink():
    def m(p, n):
        a = (p[1] + p[2]) % 1.6
        b = (p[1] - p[2]) % 1.6
        if a < 0.35 or b < 0.35 or p[2] > 11.4 or p[2] < 1.2:
            return rgb("#9aa3ad")
        return rgb("#5f656d")
    return m


def site_signboard(x, y0, y1, name, h0=3.5, h1=13.5):
    """Yellow site board on two posts along the E edge, readable from the front-right."""
    tw = len(name) * 6 - 1

    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#c99a04")
        uu, zz = y1 - p[1], p[2] - h0
        ink, bg = (rgb("#1d1d1f"), True), (rgb("#ffc81a"), True)
        if uu < 0.8 or uu > (y1 - y0) - 0.8 or zz < 0.8 or zz > (h1 - h0) - 0.8:
            return ink
        # hazard chevrons at both ends
        if uu < 3.6 or uu > (y1 - y0) - 3.6:
            return ink if int((uu + zz) // 1.6) % 2 else bg
        u0 = round((y1 - y0) / 2 - tw / 2)
        if text7(name, uu, zz, u0, (h1 - h0) / 2 + 3.5, slope=-1):
            return ink
        return bg
    S = [box(x - 0.5, y0, h0, x + 0.3, y1, h1, board)]
    for y in (y0 + 2.0, y1 - 3.0):
        S.append(box(x - 0.4, y, 0, x + 0.4, y + 1.0, h0 + 0.5, flat("#5a5f66")))
    return S


def brick_wall_y(x0, x1, y0, y1, h, seed=4):
    """Unfinished brick wall along y (stepped top)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#b8664a")
        z = p[2]
        row = int(z // 1.2)
        a = (p[1] if f == "R" else p[0]) + (1.1 if row % 2 else 0)
        if z % 1.2 < 0.25 or a % 2.2 < 0.25:
            return rgb("#d8cbb8")
        return rgb("#b4553a") if hash2(int(a // 2.2), row, seed) > 0.25 else rgb("#a24a34")
    S = []
    steps = 4
    for k in range(steps):
        sy0 = y0 + (y1 - y0) * k / steps
        sy1 = y0 + (y1 - y0) * (k + 1) / steps
        S.append(box(x0, sy0, 0, x1, sy1, h * (1 - 0.17 * k), m))
    return S


def scaffold_y(x0, y0, y1, depth, levels, lvl_h=9.0):
    """Tube scaffold along y, standing in front (+x) of a wall at x0."""
    S = []
    pole = flat("#9aa3ad")
    ys = [y0 + i * (y1 - y0) / 3 for i in range(4)]
    for y in ys:
        for x in (x0 + 0.2, x0 + depth - 0.8):
            S.append(box(x, y, 0, x + 0.6, y + 0.6, levels * lvl_h + 4, pole))
    for k in range(1, levels + 1):
        z = k * lvl_h
        S.append(box(x0, y0, z, x0 + depth, y1 + 0.6, z + 0.8, wood_mat("#c8975f")))
        S.append(box(x0 + depth - 0.8, y0, z + 3.6, x0 + depth - 0.3, y1 + 0.6, z + 4.1, pole))
        S.append(box(x0 + depth - 0.7, y0, z + 0.8, x0 + depth - 0.4, y1 + 0.6, z + 1.8, flat("#f28c28")))
    ly = ys[2] + 3
    for z in range(1, int(levels * lvl_h), 2):
        S.append(box(x0 + depth - 0.5, ly, z, x0 + depth - 0.1, ly + 2.4, z + 0.35, flat("#e2b13c")))
    S.append(box(x0 + depth - 0.6, ly - 0.3, 0, x0 + depth, ly, levels * lvl_h + 2, flat("#e2b13c")))
    S.append(box(x0 + depth - 0.6, ly + 2.4, 0, x0 + depth, ly + 2.7, levels * lvl_h + 2, flat("#e2b13c")))
    return S


def rebar_bundle_y(x0, y0, length=16.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#7a4a30") if int(p[0] * 2.5) % 2 else rgb("#5a3624")
        return rgb("#6b3f29")
    return [box(x0, y0, 0.6, x0 + 3.0, y0 + length, 2.2, m),
            box(x0 - 0.2, y0 + 2, 0, x0 + 3.2, y0 + 3, 0.6, flat("#8a6a4c")),
            box(x0 - 0.2, y0 + length - 3, 0, x0 + 3.2, y0 + length - 2, 0.6, flat("#8a6a4c"))]


# ------------------------------------------------------------------ PLAN: architect's studio
def drafting_table(x0, y0, w=14.0, d=9.0, seed=0):
    """Drafting table against the N wall: board tilted up toward the wall (faces +y)."""
    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "top":
            return rgb("#e9e4d8") if f == "L" else rgb("#cfc8b8")
        # blueprint sheet pinned on the board
        bx, by = p[0] - x0, p[1] - y0
        if 1.6 < bx < w - 1.6 and 1.4 < by < d - 1.4:
            if (bx - 1.6) % 2.8 < 0.35 or (by - 1.4) % 2.4 < 0.35:
                return (rgb("#cfe6ff"), True)
            if 5.0 < bx < 9.5 and 2.6 < by < 5.6 and (abs(bx - 5.0) < 0.4 or abs(bx - 9.5) < 0.4 or abs(by - 2.6) < 0.4 or abs(by - 5.6) < 0.4):
                return (rgb("#ffffff"), True)
            return (rgb("#2f6db5"), True)
        return rgb("#f4f1ea")
    zt = 10.0
    # board rises toward the wall: top plane z = zt + 0.5*(y0+d - y)
    S = [box(x0, y0, zt - 3.0, x0 + w, y0 + d, zt + 6.0, board,
             extra=[plane_through((0, 0.5, 1), (0, y0 + d, zt)),
                    plane_through((0, -0.5, -1), (0, y0 + d, zt - 1.0))])]
    for lx in (x0 + 1.0, x0 + w - 2.0):
        S.append(box(lx, y0 + 1.0, 0, lx + 1.0, y0 + 2.0, zt + 1.0, flat("#3a4048")))
        S.append(box(lx, y0 + d - 2.0, 0, lx + 1.0, y0 + d - 1.0, zt - 2.0, flat("#3a4048")))
    S.append(box(x0 + 1.0, y0 + 1.0, 3.0, x0 + w - 1.0, y0 + d - 1.0, 3.6, flat("#4a5058")))  # foot rail shelf
    return S


def stool(cx, cy, col="#2f6db5"):
    return [vcyl(cx, cy, 2.0, 0, 0.5, flat("#3a4048"), sides=6),
            vcyl(cx, cy, 0.45, 0.5, 7.0, flat("#9aa3ad"), sides=6),
            vcyl(cx, cy, 2.2, 7.0, 8.0, flat(col), sides=10)]


def arch_lamp(x, y, z, reach=4.0):
    """Clamp-on architect lamp leaning out over a table (+y)."""
    return [box(x - 0.3, y - 0.3, z, x + 0.3, y + 0.3, z + 7.0, flat("#2d3238")),
            box(x - 0.3, y - 0.3, z + 6.6, x + 0.3, y + reach, z + 7.2, flat("#2d3238")),
            box(x - 1.2, y + reach - 1.0, z + 4.8, x + 1.2, y + reach + 1.0, z + 6.8, flat("#e85d3a")),
            box(x - 0.9, y + reach - 0.7, z + 4.4, x + 0.9, y + reach + 0.7, z + 4.8, emis("#fff3c4"))]


def plan_chest_y(x0, y0, y1, h=9.0, col="#e8e4dc"):
    """Low flat-file cabinet along the W partition, drawers facing +x."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        c = rgb(col)
        if f == "top":
            return rgb("#c9a77c")  # oak top
        if f == "R":
            if p[2] % 1.8 < 0.35:
                return c * 0.72
            if abs((p[1] - y0) % 12.0 - 6.0) < 1.6 and abs(p[2] % 1.8 - 1.0) < 0.25:
                return rgb("#7a828c")  # drawer pulls
        return c
    return [box(x0, y0, 0, x0 + 9.0, y1, h, m)]


def plan_rolls(x0, y0, y1, z, n_=4):
    S = []
    cols = ["#dbe9f7", "#f4f1ea", "#2f6db5", "#cfe6ff", "#f4f1ea"]
    for k in range(n_):
        cx = x0 + 1.4 + (k % 3) * 2.4
        cz = z + 1.2 + (k // 3) * 2.2
        S.append(hcyl("y", cx, cz, 1.1, y0 + k * 1.2, y1 - (k % 2) * 3.0, flat(cols[k % len(cols)]), sides=8))
    return S


def roll_bin(cx, cy):
    S = [vcyl(cx, cy, 2.6, 0, 6.0, flat("#4a5058"), sides=10)]
    for k, (dx, dy, h, c) in enumerate(((-1.0, -0.6, 13.0, "#f4f1ea"), (0.8, -0.8, 11.0, "#cfe6ff"),
                                        (-0.4, 1.0, 14.5, "#dbe9f7"), (1.2, 0.8, 12.0, "#2f6db5"))):
        S.append(vcyl(cx + dx, cy + dy, 0.75, 1.0, h, flat(c), sides=6))
    return S


def plotter(x0, y0, w=16.0):
    """Large-format plotter (along x) with a blueprint feeding out toward +y."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3a4048") if (p[1] - y0) < 1.6 else rgb("#d5d9de")
        if f == "L" and p[2] > 8.0 and abs(p[0] - (x0 + w - 2.5)) < 1.0:
            return (rgb("#3ddc97"), True)
        return rgb("#2d3238") if p[2] < 6.0 else rgb("#c6cbd1")
    S = [box(x0, y0, 6.0, x0 + w, y0 + 4.0, 10.0, m)]
    for lx in (x0 + 1.0, x0 + w - 2.0):
        S.append(box(lx, y0 + 1.0, 0, lx + 1.0, y0 + 3.0, 6.0, flat("#2d3238")))
    def sheet(p, n):
        bx = p[0] - x0
        if (bx - 2.0) % 2.5 < 0.35 or (p[2] % 2.0) < 0.3:
            return (rgb("#cfe6ff"), True)
        return (rgb("#2f6db5"), True)
    S.append(box(x0 + 2.0, y0 + 4.0, 3.0, x0 + w - 2.0, y0 + 4.4, 8.0, sheet))
    return S


def scale_model(x0, y0, w=18.0, d=16.0):
    """White architectural model on a plinth: blocks, a tower, tiny trees."""
    S = [box(x0, y0, 0, x0 + w, y0 + d, 7.5, lambda p, n: rgb("#f4f4f2") if face_uv(p, n)[0] != "top" else rgb("#d8e4cf"))]
    z = 7.5
    white = lambda p, n: rgb("#fbfbfa") if face_uv(p, n)[0] != "R" else rgb("#e6e8ea")
    S.append(box(x0 + 2.0, y0 + 2.0, z, x0 + 7.0, y0 + 7.0, z + 11.0, glassy_model()))
    S.append(box(x0 + 8.5, y0 + 2.0, z, x0 + 15.5, y0 + 6.0, z + 4.5, white))
    S.append(box(x0 + 9.5, y0 + 8.5, z, x0 + 15.5, y0 + 13.5, z + 6.5, white))
    S.append(box(x0 + 2.0, y0 + 9.0, z, x0 + 6.5, y0 + 14.0, z + 3.0, white))
    for (tx, ty) in ((x0 + 7.8, y0 + 12.0), (x0 + 16.6, y0 + 14.4), (x0 + 1.4, y0 + 15.0)):
        S.append(blob(tx, ty, z + 1.4, 1.2, flat("#6fae5a"), n=12))
    return S


def glassy_model():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#fbfbfa")
        if (p[2] - 7.5) % 2.0 < 0.5:
            return rgb("#fbfbfa")
        return rgb("#bcd6ee")
    return m


def interior_plan(W, D, slab):
    rug = (1.05 * U + 1, 1.1 * U - 4, W - 1.05 * U - 2, 2.95 * U + 6)

    def floor(p):
        x, y = p[0], p[1]
        rx0, ry0, rx1, ry1 = rug
        if rx0 <= x <= rx1 and ry0 <= y <= ry1:
            edge = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
            if edge < 1.0:
                return rgb("#23466f")
            c = rgb("#3f6f9f")
            if int((x - rx0) // 3.0) % 2 == 0 and edge > 2.5:
                c = rgb("#46779f")  # woven stripe
            return c
        # light oak floorboards running along x, staggered joints
        board = int(y // 3.2)
        c = rgb("#cfae84") if board % 2 else rgb("#c6a57a")
        if y % 3.2 < 0.35:
            c = rgb("#a8875d")
        joint = (x + board * 9.7) % 26.0
        if joint < 0.35:
            c = rgb("#a8875d")
        if hash2(int(x / 2), board, 31) < 0.08:
            c = c * 0.96
        return c

    def wall(which, u, z):
        if which == "W":  # low partition: blue-grey panels
            if z < 1.0:
                return rgb("#2b3a4a")
            return rgb("#5f86ad") if int(u // 10) % 2 else rgb("#5980a7")
        # N wall: whitewashed brick
        if z < 1.0:
            return rgb("#2b3a4a")
        if z > WALL_H - 1.2:
            return rgb("#e9eef3")
        row = int(z // 1.4)
        a = u + (1.3 if row % 2 else 0)
        if z % 1.4 < 0.3 or a % 2.6 < 0.3:
            return rgb("#cfd6dd")
        return rgb("#eef1f4") if hash2(int(a // 2.6), row, 17) > 0.2 else rgb("#e2e7ec")

    S = room_shell(W, D, slab, floor, wall, trim="#23466f", side="#2f5f8f", side_dark="#244d75",
                   name="PLAN", plate="#173a5e", ink="#f2f7fc", plate_edge="#8fbfe8",
                   wall_h_w=12.0)
    T = WALL_T
    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#23466f", edge="#8fbfe8")
    S += door_frame_x(dx, D - 0.6, 22.0, "#23466f", canopy="#173a5e", out=1)
    S += entrance_steps("S", (dx, D), slab)

    # --- pin-up wall: blueprints + sticky-note planning grid on the N wall
    def pinup(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#c9a77c")
        x, z = p[0], p[2]
        # cork strip frame
        if z < 12.8 or z > 26.2:
            return rgb("#c9a77c")
        # three blueprint sheets
        for bx0 in (6.0, 18.0):
            if bx0 <= x <= bx0 + 10.0 and 14.0 <= z <= 25.0:
                bx, bz = x - bx0, z - 14.0
                if bx < 0.5 or bx > 9.5 or bz < 0.5 or bz > 10.5:
                    return rgb("#dbe9f7")
                if bx % 2.4 < 0.3 or bz % 2.2 < 0.3:
                    return rgb("#8fbfe8")
                if (abs(bx - 3) < 0.35 and 2 < bz < 8) or (abs(bz - 6) < 0.35 and 3 < bx < 8):
                    return rgb("#ffffff")
                return rgb("#2f6db5")
        # sticky notes grid
        if 31.0 <= x <= 47.0 and 14.0 <= z <= 25.0:
            cx, cz = (x - 31.0) % 3.2, (z - 14.0) % 2.8
            k = (int((x - 31.0) // 3.2), int((z - 14.0) // 2.8))
            if cx < 2.5 and cz < 2.2 and hash2(k[0], k[1], 5) > 0.18:
                return rgb(["#fff07a", "#ffb3c1", "#9be3c7", "#a9d1ff", "#ffcf8a"][(k[0] * 3 + k[1]) % 5])
            return rgb("#c9a77c") if hash2(int(x * 1.5), int(z * 1.5), 9) > 0.2 else rgb("#b8946a")
        return rgb("#c9a77c") if hash2(int(x * 1.5), int(z * 1.5), 9) > 0.2 else rgb("#b8946a")
    S.append(box(4.0, T, 12.0, 49.0, T + 0.7, 27.0, pinup))

    # --- PLAN backlit sign (right of the pin-up wall)
    sx0, sx1, sz0, sz1 = 51.5, 88.5, 15.0, 26.0
    name = "PLAN"

    def sign(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#173a5e")
        uu, vv = p[0] - sx0, p[2] - sz0
        if uu < 0.8 or uu > (sx1 - sx0) - 0.8 or vv < 0.8 or vv > (sz1 - sz0) - 0.8:
            return (rgb("#8fbfe8"), True)
        # set-square icon: right triangle outline
        if 2.4 < uu < 9.0 and 2.0 < vv < 9.0:
            a, b = uu - 2.4, vv - 2.0
            if (a < 0.9 or b < 0.9 or abs(a + b - 6.6) < 0.6) and a + b < 7.2:
                return (rgb("#f2f7fc"), True)
        if text7(name, p[0], p[2], sx0 + 12.0, sz0 + 9.0, slope=1):
            return (rgb("#f2f7fc"), True)
        return rgb("#173a5e")
    S.append(box(sx0, T, sz0, sx1, T + 0.9, sz1, sign))

    # big studio window at the right end of the N wall
    def win(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#e9eef3")
        x0w, x1w = 90.0, W - 3.0
        uu, vv = p[0] - x0w, p[2] - 10.0
        if uu < 0.9 or uu > (x1w - x0w) - 0.9 or vv < 0.9 or vv > 17.1 or abs(uu - (x1w - x0w) / 2) < 0.45 or abs(vv - 9.0) < 0.4:
            return rgb("#2b3a4a")
        t = vv / 18
        sky = mix(rgb("#f0a878"), rgb("#7a7fb8"), t)
        k = int(p[0] // 2.3)
        if vv < 2 + hash2(k, 3, 19) * 7:
            return (rgb("#ffd98a"), True) if hash2(int(p[0] * 1.3), int(vv * 1.2), 7) < 0.1 else (rgb("#3d4a6b"), True)
        return (sky, True)
    S.append(box(90.0, T - 0.1, 10.0, W - 3.0, T + 0.25, 28.0, win))

    # --- drafting tables along the N wall with stools + lamps
    for i, dx in enumerate((24.0, 44.0, 64.0)):
        S += drafting_table(dx, T + 0.8, w=15.0, d=9.5, seed=i)
        S += stool(dx + 7.5, T + 14.5, col=["#2f6db5", "#e85d3a", "#2f6db5"][i])
        S += arch_lamp(dx + 13.5, T + 1.4, 10.0, reach=4.0)
    S += roll_bin(W - 8.0, T + 6.0)
    S += plotter(84.5, T + 0.6, w=16.0) if False else []

    # --- NW corner: tall shelf of binders & material samples
    S += bookshelf(T + 0.2, T + 0.2, 18.0, T + 6.0, 26.0, seed=11, wood="#e8e4dc", along="x")

    # --- W partition: plan chest with rolled drawings, plotter at the front end
    S += plan_chest_y(T + 0.2, 12.0, 44.0)
    S += plan_rolls(T + 0.6, 14.0, 42.0, 9.0, n_=5)
    S += plotter_y(T + 0.4, 50.0, 66.0)
    S += potted_plant(T + 5.0, D - 8.0, r=4.2, h=12, seed=13)

    # --- front-right corner: the scale model on its plinth
    S += scale_model(W - 22.0, D - 20.0)
    return S


def plotter_y(x0, y0, y1):
    """Large-format plotter along the W partition (paper feeds toward +x)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3a4048") if (p[0] - x0) < 1.6 else rgb("#d5d9de")
        if f == "R" and p[2] > 8.0 and abs(p[1] - (y0 + 2.5)) < 1.0:
            return (rgb("#3ddc97"), True)
        return rgb("#2d3238") if p[2] < 6.0 else rgb("#c6cbd1")
    S = [box(x0, y0, 6.0, x0 + 4.0, y1, 10.0, m)]
    for ly in (y0 + 1.0, y1 - 2.0):
        S.append(box(x0 + 1.0, ly, 0, x0 + 3.0, ly + 1.0, 6.0, flat("#2d3238")))

    def sheet(p, n):
        by = p[1] - y0
        if (by - 2.0) % 2.5 < 0.35 or (p[2] % 2.0) < 0.3:
            return (rgb("#cfe6ff"), True)
        return (rgb("#2f6db5"), True)
    S.append(box(x0 + 4.0, y0 + 2.0, 2.5, x0 + 4.4, y1 - 2.0, 8.0, sheet))
    return S


# ------------------------------------------------------------------ REVIEW: quality inspection lab
def parcel(x0, y0, z0, w=4.0, d=4.0, h=3.4, mark=None, col="#c79a62"):
    """Cardboard box; mark = 'ok' (green tick) / 'x' (red cross) on its +y face."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        c = rgb(col)
        if f == "top":
            if abs(p[0] - (x0 + w / 2)) < 0.35:
                return rgb("#e9d9b8")  # tape
            return c * 1.06
        if f == "L" and mark:
            a, b = p[0] - x0 - w / 2, p[2] - z0 - h / 2
            if abs(a) < 1.4 and abs(b) < 1.2:
                if mark == "ok" and (abs(b + a * 0.9 - 0.2) < 0.45 and a > -0.4 or abs(b - a * 1.2 + 0.1) < 0.45 and a < 0.1):
                    return (rgb("#2fbf71"), True)
                if mark == "x" and (abs(a - b) < 0.45 or abs(a + b) < 0.45):
                    return (rgb("#e5484d"), True)
                return rgb("#f4f1ea")
        return c * (0.92 if f == "R" else 1.0)
    return [box(x0, y0, z0, x0 + w, y0 + d, z0 + h, m)]


def conveyor_x(x0, x1, y0, d=6.0, h=6.5):
    """Roller conveyor along x with side rails."""
    def belt(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#2d3238") if int(p[0] // 1.5) % 2 else rgb("#3a4048")
        if p[2] > h - 1.2:
            return rgb("#9aa3ad")
        return rgb("#6b7480")
    S = [box(x0, y0, h - 2.0, x1, y0 + d, h, belt)]
    for x in (x0 + 1, (x0 + x1) / 2, x1 - 2):
        for y in (y0 + 0.5, y0 + d - 1.3):
            S.append(box(x, y, 0, x + 0.8, y + 0.8, h - 2.0, flat("#5a626c")))
    S.append(box(x0, y0 - 0.4, h, x1, y0 + 0.2, h + 1.0, flat("#b9c2ca")))
    S.append(box(x0, y0 + d - 0.2, h, x1, y0 + d + 0.4, h + 1.0, flat("#b9c2ca")))
    return S


def scanner_gate(x0, y0, d=6.0, h=6.5):
    """Inspection arch over the conveyor with a green scan light."""
    S = [box(x0, y0 - 1.2, 0, x0 + 3.0, y0, h + 9.0, flat("#e9e6f2")),
         box(x0, y0 + d, 0, x0 + 3.0, y0 + d + 1.2, h + 9.0, flat("#e9e6f2")),
         box(x0 - 0.4, y0 - 1.2, h + 9.0, x0 + 3.4, y0 + d + 1.2, h + 11.0, flat("#7d5bc4")),
         box(x0 + 0.6, y0 - 0.2, h + 6.0, x0 + 2.4, y0 + d + 0.2, h + 6.6, emis("#5dffa8"))]
    return S


def crate_bin(x0, y0, col, label, w=8.0, d=7.0, h=5.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        c = rgb(col)
        if f == "top":
            inner = (x0 + 0.8 < p[0] < x0 + w - 0.8) and (y0 + 0.8 < p[1] < y0 + d - 0.8)
            return rgb("#2b2f35") if inner else c
        if f == "L" and abs(p[2] - h / 2) < 1.6 and x0 + 1.5 < p[0] < x0 + w - 1.5:
            return (rgb("#ffffff"), True) if label == "ok" else (rgb("#ffffff"), True)
        return c * (0.88 if int(p[2]) % 2 else 1.0)
    return [box(x0, y0, 0, x0 + w, y0 + d, h, m)]


def stack_light(cx, cy, h=24.0):
    """Andon tower: green (on) / amber / red segments on a pole."""
    S = [box(cx - 1.4, cy - 1.4, 0, cx + 1.4, cy + 1.4, 0.8, flat("#3a4048")),
         vcyl(cx, cy, 0.45, 0.8, h - 7.5, flat("#9aa3ad"), sides=6),
         vcyl(cx, cy, 1.25, h - 7.5, h - 5.2, emis("#3ddc7a"), sides=8),
         vcyl(cx, cy, 1.25, h - 5.2, h - 2.9, flat(rgb("#f2b705") * 0.45), sides=8),
         vcyl(cx, cy, 1.25, h - 2.9, h - 0.6, flat(rgb("#e5484d") * 0.45), sides=8),
         vcyl(cx, cy, 0.9, h - 0.6, h, flat("#2d3238"), sides=8)]
    return S


def inspection_bench(x0, y0, w=18.0, d=8.0, h=8.0):
    """White lab bench with a ring-light magnifier and a part under inspection."""
    S = desk(x0, y0, x0 + w, y0 + d, top="#f4f2f8", leg="#7d5bc4", h=h)
    mx, my = x0 + 5.0, y0 + 3.0
    S += [box(mx - 0.3, my - 0.3, h, mx + 0.3, my + 0.3, h + 8.0, flat("#2d3238")),
          box(mx - 0.3, my - 0.3, h + 7.6, mx + 0.3, my + 4.0, h + 8.2, flat("#2d3238")),
          vcyl(mx, my + 4.0, 2.4, h + 5.2, h + 6.4, flat("#d8dce2"), sides=12),
          vcyl(mx, my + 4.0, 1.7, h + 5.0, h + 5.2, emis("#eaffff"), sides=12)]
    S += parcel(mx - 1.2, my + 2.8, h, w=2.6, d=2.4, h=1.6, col="#b9c2ca")
    # test instrument with a green waveform screen (faces +y)
    def scope(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and x0 + 11.0 < p[0] < x0 + 16.0 and h + 1.6 < p[2] < h + 4.8:
            t = (p[0] - (x0 + 11.0))
            yv = h + 3.2 + 1.0 * math.sin(t * 2.2)
            return (rgb("#5dffa8"), True) if abs(p[2] - yv) < 0.45 else (rgb("#0f2a1e"), True)
        if f == "top":
            return rgb("#c6cbd1")
        return rgb("#4a5058")
    S.append(box(x0 + 10.4, y0 + 1.0, h, x0 + 17.0, y0 + 5.0, h + 5.6, scope))
    return S


def clipboard_board_y(x, y0, y1, z0, z1):
    """Partition-mounted rail of clipboards with checklists (faces +x)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#7d5bc4")
        yy, zz = y1 - p[1], p[2] - z0
        k = int(yy // 6.0)
        cy = yy - k * 6.0
        if 0.8 < cy < 5.2 and 0.6 < zz < (z1 - z0) - 0.6:
            if zz > (z1 - z0) - 1.6 and 2.0 < cy < 4.0:
                return rgb("#9aa3ad")  # clip
            r = (zz - 0.6) % 1.4
            if r < 0.55 and cy < 4.6:
                if cy < 1.8:
                    return rgb("#2fbf71") if (k + int(zz)) % 4 else rgb("#e5484d")
                return rgb("#8a95a0")
            return rgb("#fbfbf8")
        return rgb("#c79a62")
    return [box(x, y0, z0, x + 0.6, y1, z1, m)]


def lab_sign_y(x, y0, y1, name, h0=3.0, h1=13.0):
    """Free-standing lab sign along the E edge: white panel, purple text."""
    tw = len(name) * 6 - 1

    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#5b3fa0")
        uu, zz = y1 - p[1], p[2] - h0
        ink, bg = (rgb("#5b3fa0"), True), (rgb("#f7f5fc"), True)
        if uu < 0.8 or uu > (y1 - y0) - 0.8 or zz < 0.8 or zz > (h1 - h0) - 0.8:
            return (rgb("#7d5bc4"), True)
        # magnifier icon at the left end
        if uu < 7.0:
            d = math.hypot(uu - 3.4, zz - 5.6)
            if abs(d - 1.9) < 0.6:
                return ink
            if 1.2 < uu < 2.6 and abs((zz - 2.0) - (2.6 - uu) * 0.0) < 3 and abs((uu - 1.9) + (zz - 3.2)) < 0.7 and zz < 4.4:
                return ink
            return bg
        u0 = round(7.0 + ((y1 - y0) - 7.0) / 2 - tw / 2)
        if text7(name, uu, zz, u0, (h1 - h0) / 2 + 3.5, slope=-1):
            return ink
        return bg
    S = [box(x - 0.5, y0, h0, x + 0.3, y1, h1, board)]
    for y in (y0 + 2.0, y1 - 3.0):
        S.append(box(x - 0.4, y, 0, x + 0.4, y + 1.0, h0 + 0.5, flat("#5a5f66")))
    return S


def trolley(x0, y0):
    S = [box(x0, y0, 2.0, x0 + 10.0, y0 + 6.0, 2.8, flat("#9aa3ad")),
         box(x0 + 9.2, y0, 2.8, x0 + 10.0, y0 + 6.0, 10.0, flat("#7d5bc4"))]
    for (wx, wy) in ((x0 + 1.2, y0 + 1.0), (x0 + 8.8, y0 + 1.0), (x0 + 1.2, y0 + 5.0), (x0 + 8.8, y0 + 5.0)):
        S.append(vcyl(wx, wy, 0.9, 0, 2.0, flat("#26272b"), sides=6))
    S += parcel(x0 + 0.8, y0 + 0.8, 2.8, w=4.2, d=4.4, h=3.4)
    S += parcel(x0 + 5.2, y0 + 0.8, 2.8, w=3.6, d=4.4, h=2.6, col="#b88a55")
    S += parcel(x0 + 1.4, y0 + 1.2, 6.2, w=3.2, d=3.4, h=2.4, col="#d4a872")
    return S


def interior_review(W, D, slab):
    zone = (1.05 * U - 2, 1.1 * U - 5, W - 1.05 * U + 2, 3.15 * U + 5)  # safety-taped inspection area

    def floor(p):
        x, y = p[0], p[1]
        zx0, zy0, zx1, zy1 = zone
        # epoxy lab floor, faint grid
        c = rgb("#c9c1dc")
        if x % 11.7 < 0.35 or y % 11.7 < 0.35:
            c = rgb("#b8aed0")
        if hash2(int(x), int(y), 41) < 0.05:
            c = c * 0.97
        if zx0 <= x <= zx1 and zy0 <= y <= zy1:
            edge = min(x - zx0, zx1 - x, y - zy0, zy1 - y)
            if edge < 1.4:
                k = int((x + y) // 2.0) % 2
                return rgb("#f2b705") if k else rgb("#2d2d2d")  # hazard tape border
            return rgb("#dcd6ea") if c[0] > 195 else rgb("#cbc3de")
        return c

    def wall(which, u, z):
        # lab partition: white panels, purple stripe, frosted glass band on top
        if z < 1.0:
            return rgb("#4a3a78")
        if z > 8.0:
            if z > 12.2:
                return rgb("#e9e6f2")
            g = rgb("#cfe3f0") if int(u // 6) % 2 else rgb("#c3dbeb")
            return (g, False) if False else g
        if 4.0 < z < 5.0:
            return rgb("#7d5bc4")
        return rgb("#f4f2f8") if int(u // 12) % 2 else rgb("#eceaf3")

    S = room_shell(W, D, slab, floor, wall, trim="#e9e6f2", side="#5b3fa0", side_dark="#4a3385",
                   wall_h=13.0, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    S += door_frame_x(dx, 0.6, 18.0, "#7d5bc4", canopy="#5b3fa0", out=-1)
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col="#4a3a78", edge="#c3b5ea")
    S += entrance_steps("N", (dx, 0), slab)

    # --- N side, right of the door: conveyor through a scanner gate into PASS / FAIL bins
    S += conveyor_x(dx + 10.0, 104.0, T + 2.0)
    S += scanner_gate(84.0, T + 2.0)
    S += parcel(dx + 12.0, T + 3.0, 6.5, mark=None)
    S += parcel(dx + 20.0, T + 3.0, 6.5, w=4.4, h=3.0, col="#b88a55")
    S += parcel(90.0, T + 3.0, 6.5, mark="ok")
    S += parcel(98.0, T + 3.0, 6.5, mark="x", col="#b88a55")
    S += crate_bin(105.0, T + 1.6, "#2fbf71", "ok", w=5.5)
    S += crate_bin(105.0, T + 9.0, "#e5484d", "x", w=5.5)
    S += parcel(106.0, T + 2.8, 4.2, mark="ok", w=3.2, d=3.2, h=2.2)
    # left of the door: second inspection bench along the N partition
    S += inspection_bench(22.0, T + 0.8, w=dx - DOOR_HALF - 24.0, d=8.0)
    S += stack_light(T + 3.0, T + 3.0)
    S += qa_dashboard(5.0, T + 1.0)
    S += tool_cabinet(T + 0.4, T + 7.0)

    # --- W side: inspection bench, clipboards on the partition, parts shelf
    S += inspection_bench(T + 0.4, 18.0, w=9.0, d=24.0) if False else []
    S += inspection_bench_y(T + 0.4, 16.0, 40.0)
    S += clipboard_board_y(T, 44.0, 70.0, 4.0, 11.0)
    S += bookshelf(T + 0.2, 72.0, T + 6.0, 92.0, 12.0, seed=21, wood="#e9e6f2", along="y")

    # --- front: trolley of incoming parcels, pallet waiting, the REVIEW sign
    S += trolley(10.0, D - 12.0)
    S += parcel(30.0, D - 9.0, 0, w=5.0, d=5.0, h=4.0)
    S += parcel(35.5, D - 8.0, 0, w=4.0, d=4.0, h=3.0, col="#b88a55")
    S += parcel(31.0, D - 8.5, 4.0, w=3.6, d=3.6, h=2.8, col="#d4a872")
    S += lab_sign_y(W - 2.2, 22.0, 70.0, "REVIEW")
    S += potted_plant(W - 6.0, D - 6.5, r=3.8, h=10, seed=17)
    return S


def qa_dashboard(x0, y0, w=13.0):
    """Floor-standing screen (faces +y) showing pass-rate bars."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#2d3238")
        uu, zz = p[0] - x0, p[2] - 9.0
        if uu < 0.7 or uu > w - 0.7 or zz < 0.7 or zz > 8.3:
            return rgb("#2d3238")
        if zz > 6.6:
            return (rgb("#7d5bc4"), True)  # header
        bars = (0.9, 0.75, 0.95, 0.6, 0.85)
        k = int((uu - 1.4) // 2.2)
        if 0 <= k < len(bars) and (uu - 1.4) % 2.2 < 1.4 and zz < 1.0 + bars[k] * 5.0:
            return (rgb("#3ddc7a") if bars[k] > 0.7 else rgb("#f2b705"), True)
        return (rgb("#1b1f2a"), True)
    return [box(x0, y0, 9.0, x0 + w, y0 + 1.0, 18.0, m),
            box(x0 + w / 2 - 0.5, y0 + 0.1, 0, x0 + w / 2 + 0.5, y0 + 0.9, 9.0, flat("#4a5058")),
            box(x0 + w / 2 - 3.0, y0 - 1.0, 0, x0 + w / 2 + 3.0, y0 + 2.0, 0.6, flat("#4a5058"))]


def tool_cabinet(x0, y0):
    """Purple roll cabinet against the W partition (drawers face +x)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3a4048")
        if f == "R":
            if p[2] % 2.0 < 0.35:
                return rgb("#3e2a6e")
            if abs(p[1] - (y0 + 4.0)) < 1.6 and abs(p[2] % 2.0 - 1.2) < 0.25:
                return rgb("#d8dce2")
        return rgb("#7d5bc4")
    return [box(x0, y0, 0, x0 + 6.0, y0 + 8.0, 9.0, m)]


def inspection_bench_y(x0, y0, y1, h=8.0):
    """Bench along the W partition (worker faces -x): ring-light magnifier + waveform scope."""
    S = desk(x0, y0, x0 + 9.0, y1, top="#f4f2f8", leg="#7d5bc4", h=h)
    mx, my = x0 + 3.0, y0 + 6.0
    S += [box(mx - 0.3, my - 0.3, h, mx + 0.3, my + 0.3, h + 8.0, flat("#2d3238")),
          box(mx - 0.3, my - 0.3, h + 7.6, mx + 4.0, my + 0.3, h + 8.2, flat("#2d3238")),
          vcyl(mx + 4.0, my, 2.4, h + 5.2, h + 6.4, flat("#d8dce2"), sides=12),
          vcyl(mx + 4.0, my, 1.7, h + 5.0, h + 5.2, emis("#eaffff"), sides=12)]
    S += parcel(mx + 2.8, my - 1.2, h, w=2.4, d=2.6, h=1.6, col="#b9c2ca")

    def scope(p, n):
        f, u, v = face_uv(p, n)
        if f == "R" and y0 + 13.0 < p[1] < y0 + 19.0 and h + 1.6 < p[2] < h + 5.0:
            t = (y0 + 19.0) - p[1]
            yv = h + 3.3 + 1.1 * math.sin(t * 2.0)
            return (rgb("#5dffa8"), True) if abs(p[2] - yv) < 0.45 else (rgb("#0f2a1e"), True)
        if f == "top":
            return rgb("#c6cbd1")
        return rgb("#4a5058")
    S.append(box(x0 + 1.0, y0 + 12.4, h, x0 + 5.0, y0 + 19.6, h + 5.8, scope))
    S += office_chair(x0 + 12.5, (y0 + y1) / 2, "W", col="#7d5bc4")
    return S


# ------------------------------------------------------------------ IDLE: coffee shop
def cafe_table(cx, cy, r=3.0, top="#e9dcc6"):
    return [vcyl(cx, cy, 1.6, 0, 0.5, flat("#2d3238"), sides=8),
            vcyl(cx, cy, 0.45, 0.5, 6.6, flat("#2d3238"), sides=6),
            vcyl(cx, cy, r, 6.6, 7.3, flat(top), sides=12)]


def cafe_chair(cx, cy, facing="N", col="#2f7a4f"):
    """Bistro chair; 'facing' is where the sitter looks (back on the opposite side)."""
    c = rgb(col)
    S = [box(cx - 1.8, cy - 1.8, 4.0, cx + 1.8, cy + 1.8, 4.8, flat(c))]
    for (dx, dy) in ((-1.5, -1.5), (1.0, -1.5), (-1.5, 1.0), (1.0, 1.0)):
        S.append(box(cx + dx, cy + dy, 0, cx + dx + 0.5, cy + dy + 0.5, 4.0, flat("#2d3238")))
    back = {"N": (cx - 1.8, cy + 1.3, cx + 1.8, cy + 1.8), "S": (cx - 1.8, cy - 1.8, cx + 1.8, cy - 1.3),
            "W": (cx + 1.3, cy - 1.8, cx + 1.8, cy + 1.8), "E": (cx - 1.8, cy - 1.8, cx - 1.3, cy + 1.8)}[facing]
    S.append(box(back[0], back[1], 4.8, back[2], back[3], 9.0, flat(c * 0.9)))
    return S


def coffee_cup(cx, cy, z, col="#f4f1ea"):
    return [vcyl(cx, cy, 0.7, z, z + 1.1, flat(col), sides=6)]


def espresso_machine(x0, y0, z):
    """Chrome espresso machine on the counter (front faces +y)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#2d3238")
        if f == "L":
            if p[2] > z + 6.4:
                return rgb("#c0392b")  # red top band
            if z + 2.0 < p[2] < z + 3.2 and int((p[0] - x0) // 3) % 2 == 0:
                return rgb("#1d1f23")  # group heads
            return rgb("#dfe4ea") if int(p[0] * 1.5) % 4 else rgb("#f4f7fa")
        return rgb("#b8c0c8")
    S = [box(x0, y0, z, x0 + 12.0, y0 + 5.0, z + 7.6, m)]
    for k in range(2):
        S += coffee_cup(x0 + 3.0 + k * 6.0, y0 + 5.6, z, col="#f4f1ea")
    S.append(box(x0 + 13.0, y0 + 1.0, z, x0 + 16.0, y0 + 4.0, z + 6.5, flat("#2d3238")))   # grinder
    S.append(vcyl(x0 + 14.5, y0 + 2.5, 1.4, z + 6.5, z + 9.0, flat("#6b4a33"), sides=8))  # bean hopper
    return S


def pastry_case(x0, y0, z, w=16.0, d=6.0):
    """Glass pastry display on the counter (faces +y)."""
    cols = ["#e8b56a", "#c4834a", "#f7e3c0", "#e86a8a", "#8b5a3c", "#f2c14e"]

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#dff1f7")
        if f == "L":
            if p[2] < z + 0.8 or p[2] > z + 6.4:
                return rgb("#6b4a33")
            shelf = 0 if p[2] < z + 3.4 else 1
            sz = (p[2] - z - 0.8) % 2.8
            k = int((p[0] - x0) // 2.0)
            if sz < 1.5 and (p[0] - x0) % 2.0 < 1.6:
                return rgb(cols[(k + shelf * 2) % len(cols)])
            if sz < 1.9 and sz > 1.5:
                return rgb("#f4f1ea")  # shelf
            return rgb("#cfe7ef")
        return rgb("#bcdbe6")
    return [box(x0, y0, z, x0 + w, y0 + d, z + 7.0, m)]


def coffee_counter_x(x0, x1, y0, d=7.0, h=9.0):
    """Counter along x: green tiled front, wood top."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#8a5a3a") if int(p[0] // 4) % 2 else rgb("#93613f")
        if p[2] < 0.8:
            return rgb("#2d3238")
        if p[2] > h - 1.0:
            return rgb("#6b4a33")
        tx, tz = (p[0] if f == "L" else p[1]) % 2.0, p[2] % 2.0
        if tx < 0.3 or tz < 0.3:
            return rgb("#e9e4d6")
        return rgb("#2f7a4f") if hash2(int(p[0] // 2), int(p[2] // 2), 51) > 0.2 else rgb("#3b8a5c")
    return [box(x0, y0, 0, x1, y0 + d, h, m)]


def bar_stool(cx, cy, col="#2f7a4f"):
    return [vcyl(cx, cy, 1.6, 0, 0.4, flat("#2d3238"), sides=6),
            vcyl(cx, cy, 0.4, 0.4, 6.5, flat("#9aa3ad"), sides=6),
            vcyl(cx, cy, 1.9, 6.5, 7.5, flat(col), sides=10)]


def back_bar_shelves(x0, x1, y0):
    """Wall shelves behind the counter: cups, jars, coffee bags (faces +y)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#6b4a33")
        if f != "L":
            return rgb("#6b4a33")
        z = p[2]
        lvl = int((z - 11.0) // 4.0)
        r = (z - 11.0) % 4.0
        if r < 0.7:
            return rgb("#6b4a33")  # plank
        k = int((p[0] - x0) // 2.2)
        hgt = 1.6 + hash2(k, lvl, 52) * 1.8
        if r - 0.7 < hgt and (p[0] - x0) % 2.2 < 1.8:
            pal = ["#f4f1ea", "#d9c3a0", "#2f7a4f", "#c0392b", "#8b5a3c", "#f2c14e", "#e9e4d6"]
            return rgb(pal[int(hash2(k, lvl, 53) * 7) % 7])
        return rgb("#3b2a20")
    return [box(x0, y0, 11.0, x1, y0 + 3.0, 23.0, m)]


def chalk_menu(x0, x1, y0, z0, z1):
    """Chalkboard menu on the N wall (faces +y)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#6b4a33")
        uu, zz = p[0] - x0, p[2] - z0
        if uu < 0.8 or uu > (x1 - x0) - 0.8 or zz < 0.8 or zz > (z1 - z0) - 0.8:
            return rgb("#8a5a3a")
        r = (zz - 1.4) % 1.6
        if r < 0.5 and 1.6 < uu < (x1 - x0) - 1.6 and zz < (z1 - z0) - 1.6:
            if uu > (x1 - x0) - 4.0:
                return rgb("#f2c14e")  # prices
            if hash2(int(uu // 1.2), int(zz // 1.6), 54) > 0.25:
                return rgb("#e9efe9")
        return rgb("#24312b")
    return [box(x0, y0, z0, x1, y0 + 0.6, z1, m)]


def banquette_y(x0, y0, y1, col="#7a3b2e"):
    """Upholstered bench along the W wall (seat faces +x)."""
    c = rgb(col)

    def seat(p, n):
        f, u, v = face_uv(p, n)
        k = int((p[1] - y0) // 7.0)
        return c * (1.06 if f == "top" else 1.0) * (0.95 if k % 2 else 1.0)

    def back(p, n):
        f, u, v = face_uv(p, n)
        k = int((p[1] - y0) // 3.5)
        return c * (0.88 if k % 2 else 0.95)
    return [box(x0, y0, 0, x0 + 6.0, y1, 4.6, seat),
            box(x0, y0, 4.6, x0 + 2.0, y1, 10.0, back)]


def armchair(cx, cy, col="#2f7a4f", facing="W"):
    c = rgb(col)
    S = [box(cx - 3.2, cy - 3.2, 0, cx + 3.2, cy + 3.2, 4.2, flat(c))]
    if facing == "W":
        S.append(box(cx + 1.6, cy - 3.2, 4.2, cx + 3.2, cy + 3.2, 8.5, flat(c * 0.88)))
    else:
        S.append(box(cx - 3.2, cy + 1.6, 4.2, cx + 3.2, cy + 3.2, 8.5, flat(c * 0.88)))
    S.append(box(cx - 3.2, cy - 3.2, 4.2, cx + 3.2, cy - 2.2, 6.2, flat(c * 0.92)))
    S.append(box(cx - 3.2, cy + 2.2, 4.2, cx + 3.2, cy + 3.2, 6.2, flat(c * 0.92)))
    return S


def cafe_sign_y(x, y0, y1, name, h0=3.0, h1=13.0):
    """Free-standing café sign along the E edge: dark green board, cream letters, cup icon."""
    tw = len(name) * 6 - 1

    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#1f4a33")
        uu, zz = y1 - p[1], p[2] - h0
        ink, bg = (rgb("#f6ecd6"), True), (rgb("#24543a"), True)
        if uu < 0.8 or uu > (y1 - y0) - 0.8 or zz < 0.8 or zz > (h1 - h0) - 0.8:
            return (rgb("#c99a5a"), True)
        if uu < 9.0:  # coffee cup icon
            if 2.0 < uu < 6.4 and 2.2 < zz < 6.4 and not (2.8 < uu < 5.6 and zz > 5.6):
                return ink
            if 6.4 <= uu < 7.8 and 3.2 < zz < 5.6 and not (6.4 <= uu < 7.0 and 3.8 < zz < 5.0):
                return ink
            if (abs(uu - 3.2) < 0.4 or abs(uu - 4.8) < 0.4) and 6.8 < zz < 8.4:
                return ink  # steam
            return bg
        u0 = round(9.0 + ((y1 - y0) - 9.0) / 2 - tw / 2)
        if text7(name, uu, zz, u0, (h1 - h0) / 2 + 3.5, slope=-1):
            return ink
        return bg
    S = [box(x - 0.5, y0, h0, x + 0.3, y1, h1, board)]
    for y in (y0 + 2.0, y1 - 3.0):
        S.append(box(x - 0.4, y, 0, x + 0.4, y + 1.0, h0 + 0.5, flat("#2d3238")))
    return S


def interior_idle(W, D, slab):
    def floor(p):
        x, y = p[0], p[1]
        # warm walnut planks running along y, staggered
        # big rug where most agents stand
        rx0, ry0, rx1, ry1 = 1.5 * U, 1.6 * U, W - 1.5 * U, D - 2.1 * U
        if rx0 <= x <= rx1 and ry0 <= y <= ry1:
            edge = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
            if edge < 1.4:
                return rgb("#1f4a33")
            if edge < 3.2:
                return rgb("#d9b46a") if int((x + y) // 2.0) % 2 else rgb("#2f6a4a")
            c = rgb("#3b7a58")
            if int((x - rx0) // 9) % 2 == int((y - ry0) // 9) % 2:
                c = rgb("#367253")
            return c
        board = int(x // 3.6)
        c = rgb("#a8774f") if board % 2 else rgb("#a2714a")
        if x % 3.6 < 0.3:
            c = rgb("#8a5e3c")
        if (y + board * 13.3) % 31.0 < 0.3:
            c = rgb("#8a5e3c")
        if hash2(board, int(y / 2), 61) < 0.07:
            c = c * 0.96
        return c

    def wall(which, u, z):
        if which == "W":  # low café front: wood panelling + green cap
            if z < 1.0:
                return rgb("#2d3238")
            if z > 8.6:
                return rgb("#2f7a4f")
            return rgb("#b8875a") if int(u // 4) % 2 else rgb("#ad7e52")
        # N wall: green subway tiles below, warm plaster above
        if z < 1.0:
            return rgb("#2d3238")
        if z < 10.0:
            tx, tz = u % 3.0, z % 1.5
            if tx < 0.3 or tz < 0.3:
                return rgb("#e9e4d6")
            return rgb("#3b8a5c")
        if z > WALL_H - 1.2:
            return rgb("#6b4a33")
        return rgb("#efe1c8") if int(z) % 9 else rgb("#e6d6bb")

    door_y = (6.3 - 1.2) * U  # board door point: middle of the W edge (gy 6.3)
    S = room_shell(W, D, slab, floor, wall, trim="#6b4a33", side="#2f7a4f", side_dark="#24603e",
                   wall_h_w=9.6, door_w=(door_y - DOOR_HALF, door_y + DOOR_HALF))
    T = WALL_T
    S += door_frame_y(0.6, door_y, 18.0, "#6b4a33", canopy=("#2f7a4f", "#f6ecd6"))
    S += doormat(T + 0.4, door_y - 6.5, T + 7.0, door_y + 6.5, col="#7a3b2e", edge="#d9b46a")
    S += entrance_steps("W", (door_y, 0), slab, n_steps=1)

    # --- coffee bar along the N wall
    S += back_bar_shelves(26.0, 88.0, T)
    S += chalk_menu(92.0, 122.0, T, 11.0, 25.0)

    # IDLE sign (backlit, with a cup) on the N wall
    sx0, sx1, sz0, sz1 = 126.0, 160.0, 14.0, 25.0
    name = "IDLE"

    def sign(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#1f4a33")
        uu, vv = p[0] - sx0, p[2] - sz0
        if uu < 0.8 or uu > (sx1 - sx0) - 0.8 or vv < 0.8 or vv > (sz1 - sz0) - 0.8:
            return (rgb("#f2c14e"), True)
        if 2.0 < uu < 9.6 and 1.8 < vv < 9.2:  # cup icon
            if 2.4 < uu < 7.0 and 2.4 < vv < 6.8 and not (3.2 < uu < 6.2 and vv > 6.0):
                return (rgb("#f6ecd6"), True)
            if 7.0 <= uu < 8.6 and 3.4 < vv < 6.0 and not (7.0 <= uu < 7.8 and 4.0 < vv < 5.4):
                return (rgb("#f6ecd6"), True)
            if (abs(uu - 3.8) < 0.4 or abs(uu - 5.4) < 0.4) and 7.2 < vv < 8.8:
                return (rgb("#f6ecd6"), True)
        if text7(name, p[0], p[2], sx0 + 12.0, sz0 + 9.0, slope=1):
            return (rgb("#f6ecd6"), True)
        return rgb("#24543a")
    S.append(box(sx0, T, sz0, sx1, T + 0.9, sz1, sign))

    # cafe window at the right end of the N wall
    def win(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#efe1c8")
        x0w, x1w = 165.0, W - 4.0
        uu, vv = p[0] - x0w, p[2] - 10.0
        if uu < 0.9 or uu > (x1w - x0w) - 0.9 or vv < 0.9 or vv > 15.1 or abs(uu - (x1w - x0w) / 2) < 0.45:
            return rgb("#2f7a4f")
        t = vv / 16
        k = int(p[0] // 2.3)
        if vv < 2 + hash2(k, 5, 23) * 6:
            return (rgb("#ffd98a"), True) if hash2(int(p[0] * 1.3), int(vv * 1.2), 8) < 0.1 else (rgb("#3d4a6b"), True)
        return (mix(rgb("#f0a878"), rgb("#7a7fb8"), t), True)
    S.append(box(165.0, T - 0.1, 10.0, W - 4.0, T + 0.25, 26.0, win))

    # counter in front of the back bar, with machine, pastry case, register, stools
    cy0 = T + 9.0
    S += coffee_counter_x(24.0, 112.0, cy0)
    S += espresso_machine(30.0, cy0 + 1.0, 9.0)
    S += pastry_case(56.0, cy0 + 0.5, 9.0, w=18.0)
    S += [box(80.0, cy0 + 1.5, 9.0, 86.0, cy0 + 5.5, 12.0, flat("#2d3238")),          # register
          box(80.6, cy0 + 4.6, 12.0, 85.4, cy0 + 5.2, 15.0, emis("#7fd1c7"))]
    S += coffee_cup(92.0, cy0 + 4.0, 9.0, col="#c0392b")
    S += coffee_cup(96.0, cy0 + 3.2, 9.0)
    S += potted_plant(106.0, cy0 + 3.5, r=2.6, h=7, seed=29, big=False) if False else []
    for sxp in (34.0, 46.0, 58.0, 70.0, 82.0, 94.0, 106.0):
        S += bar_stool(sxp, cy0 + 10.5)
    # NW corner: tall plant; NE: sacks of beans
    S += potted_plant(T + 6.0, T + 7.0, r=5.0, h=14, seed=31)
    S += [box(118.0, T + 1.0, 0, 124.0, T + 6.0, 5.0, sack_mat()),
          box(119.0, T + 6.5, 0, 125.0, T + 11.0, 4.0, sack_mat())]

    # planter boxes along the top of the low café front
    for py in (40.0, 86.0, 142.0, 190.0):
        S.append(box(0.0, py, 9.6, T + 0.4, py + 16.0, 11.2, flat("#6b4a33")))
        S.append(box(0.1, py + 0.4, 11.2, T + 0.3, py + 15.6, 13.4, planter_mat(int(py))))
    # --- W side: banquette with small tables (seats face +x)
    S += banquette_y(T + 0.2, 34.0, door_y - DOOR_HALF - 4.0)
    S += banquette_y(T + 0.2, door_y + DOOR_HALF + 4.0, 196.0)
    for ty in (44.0, 70.0, 94.0, 148.0, 174.0):
        S += cafe_table(T + 12.5, ty, r=3.0)
        S += coffee_cup(T + 12.0, ty - 0.8, 7.3)
        S += cafe_chair(T + 19.0, ty, "W")

    # --- E side (open): window tables
    for ty in (60.0, 110.0, 160.0):
        S += cafe_table(W - 10.0, ty, r=3.2)
        S += cafe_chair(W - 10.0, ty - 6.0, "S")
        S += cafe_chair(W - 10.0, ty + 6.0, "N")
    S += cafe_sign_y(W - 2.2, 70.0, 104.0, "IDLE") if False else []

    # --- front strip: lounge corner + plants, all low
    S += armchair(40.0, D - 14.0, col="#2f7a4f", facing="N")
    S += armchair(58.0, D - 14.0, col="#c0392b", facing="N")
    S += cafe_table(49.0, D - 22.0, r=3.4, top="#d9c3a0")
    S += potted_plant(T + 6.0, D - 8.0, r=4.6, h=12, seed=33)
    S += potted_plant(W - 7.0, D - 8.0, r=4.6, h=12, seed=35)
    S += cafe_sign_y(W - 2.2, D - 52.0, D - 18.0, "IDLE")
    return S


def sack_mat():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and abs(p[2] - 2.5) < 1.0 and int(p[0]) % 3 == 0:
            return rgb("#6b4a33")
        return rgb("#c9a77c") if hash2(int(p[0] * 2), int(p[2] * 2), 62) > 0.2 else rgb("#b8946a")
    return m


INTERIORS = {
    # zone id: (builder, footprint gw, gh in grid cells, floor height above the street in px)
    # Matches runtimeLayout in board.js; the board turns leftover cells into road.
    "specs": (interior_specs, 5.0, 4.4, 22),
    "build": (interior_build, 5.0, 4.6, 14),
    "plan": (interior_plan, 5.0, 4.4, 22),
    "review": (interior_review, 5.0, 4.6, 14),
    "idle": (interior_idle, 8.2, 10.2, 6),
}


def build(zid):
    fn, gw, gh, elev_px = INTERIORS[zid]
    W, D = gw * U, gh * U
    slab = elev_px / 2.0  # board draws at 2x
    return fn(W, D, slab)


if __name__ == "__main__":
    from props import solid_hull
    os.makedirs("out", exist_ok=True)
    man = json.load(open("out/manifest.json")) if os.path.exists("out/manifest.json") else {}
    for zid in (sys.argv[1:] or INTERIORS):
        S = build(zid)
        im, anchor = render(S, ground_shadow=0)
        name = f"interior_{zid}"
        im.save(f"out/{name}.png")
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1], unitsPerGrid=U,
                         hull=solid_hull(S, anchor))
        print(name, im.size, anchor)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
