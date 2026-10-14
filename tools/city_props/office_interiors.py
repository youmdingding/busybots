"""
Zone interiors for the Office theme (modern tech company floor). Same conventions as
interiors.py: origin = zone footprint NW corner at floor level, only N and W back walls.

Run: python3 office_interiors.py [zone ...] -> out/office_interior_<zone>.png + manifest
"""
import json, math, os, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, mix, hash2, render, plane_through, Solid, LIVE, liven, save_live
from props import cone, flat, save_room
from interiors import (U, WALL_T, text7, room_shell, doormat, entrance_steps, door_frame_x, door_frame_y,
                       DOOR_HALF, desk, monitor, keyboard, office_chair, bookshelf, mug, paper_stack,
                       potted_plant, INTERIORS as CITY_INTERIORS)

WHITE, OFFWHITE = "#f4f5f2", "#e8eae6"
INK, STEEL = "#2d3238", "#b9c1c9"
OAK, OAK_D, OAK_L = "#c9a37a", "#9c7a55", "#dcbf98"
CORAL, MUSTARD, MINT, SKY = "#e07a5f", "#e0b04a", "#7bc6a4", "#6fa8dc"

def carpet_floor(rug=None, rug_fn=None, a="#c4c6c4", b="#bcbebc"):
    def floor(p):
        x, y = p[0], p[1]
        if rug and rug[0] <= x <= rug[2] and rug[1] <= y <= rug[3]:
            return rug_fn(x, y)
        t = U / 4
        i, j = int(x // t), int(y // t)
        c = rgb(a) if (i + j) % 2 else rgb(b)
        s = (x if (i + j) % 2 else y) % 1.8
        if s < 0.45:
            c = c * 0.97
        return c
    return floor


def feature_wall(accent, z_split=13.0, top=30.0):
    def wall(which, u, z):
        if z < 1.2:
            return rgb("#8a9098")                      # skirting
        if which == "N" and z > z_split:
            if z > top - 1.0:
                return rgb(WHITE)
            return rgb(accent) * (0.97 if int(u // 11.7) % 2 else 1.0)
        return rgb(WHITE) if hash2(int(u * 1.2), int(z * 1.2), 201) > 0.1 else rgb(OFFWHITE)
    return wall


def raised_letters_x(text, x0, y, z0, col=WHITE, depth=1.2, px=1.0):
    """3D letters standing proud of the N wall (each 'on' glyph pixel is a small box)."""
    from interiors import FONT7
    S = []
    m = lambda p, n: (rgb(col), True) if face_uv(p, n)[0] in ("L", "top") else rgb(col) * 0.8
    for ci, ch in enumerate(text):
        g = FONT7.get(ch, FONT7[" "])
        for r, row in enumerate(g):
            run = None
            for c in range(6):
                on = c < 5 and row[c] == "1"
                if on and run is None:
                    run = c
                if not on and run is not None:
                    xa = x0 + (ci * 6 + run) * px * 2
                    xb = x0 + (ci * 6 + c) * px * 2
                    za = z0 + (6 - r) * px * 2
                    S.append(box(xa, y, za, xb, y + depth, za + px * 2, m))
                    run = None
    return S


def story_wall_x(x0, x1, y, z0, z1, seed=3):
    """Kanban of user-story cards on the N wall: TO DO / DOING / DONE columns."""
    w, h = x1 - x0, z1 - z0
    heads = (CORAL, MUSTARD, MINT)

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#9aa3ad")
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.8 or uu > w - 0.8 or vv < 0.8 or vv > h - 0.8:
            return rgb("#b9c2ca")
        col = min(2, int(uu // (w / 3)))
        cu = uu - col * (w / 3)
        if abs(cu) < 0.3 and col:
            return rgb("#9aa3ad")
        if vv > h - 2.6:
            return (rgb(heads[col]), True) if 1.0 < cu < w / 3 - 1.0 else rgb("#fbfdfd")
        # cards: 2 per row
        k = int((cu - 1.0) // 6.0)
        r = int((h - 3.4 - vv) // 3.6)
        if k < 2 and r < 3 - (col == 1) and hash2(k, r + col * 7, seed) > 0.2:
            ku, kv = (cu - 1.0) % 6.0, (h - 3.4 - vv) % 3.6
            if ku < 5.0 and kv < 2.8:
                if kv < 0.6:
                    return rgb(heads[col])
                if 0.9 < kv < 2.4 and int(kv * 1.6) % 2 == 0 and ku < 4.2 - hash2(k, r, seed) * 2:
                    return rgb("#8a95a0")
                return rgb("#fffdf5")
        return rgb("#fbfdfd")
    return [box(x0, y, z0, x1, y + 0.8, z1, m)]


def persona_board_y(x, y0, y1, z0, z1):
    """Three persona cards on the W wall (face R): avatar, name bar, quote lines."""
    w, h = y1 - y0, z1 - z0
    shirts = (CORAL, SKY, MUSTARD)

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#9aa3ad")
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 0.8 or uu > w - 0.8 or vv < 0.8 or vv > h - 0.8:
            return rgb("#b9c2ca")
        cw = (w - 1.6) / 3
        k = min(2, int((uu - 0.8) // cw))
        cu = (uu - 0.8) - k * cw
        if cu < 0.5 or cu > cw - 0.5:
            return rgb("#dfe4e8")
        cx = cw / 2
        # avatar: head + shoulders
        if math.hypot(cu - cx, vv - (h - 4.2)) < 1.7:
            return rgb(("#f1c7a5", "#c68e63", "#8d5a3b")[k])
        if abs(cu - cx) < 2.8 - max(0, (h - 6.4) - vv) * 0.0 and h - 7.6 < vv < h - 5.9:
            return rgb(shirts[k])
        if abs(vv - (h - 9.0)) < 0.5 and cu < cw - 1.4:
            return rgb(INK)                              # name
        if vv < h - 10.2 and vv > 1.6 and int(vv * 1.5) % 2 == 0 and cu < cw - 1.2 - hash2(k, int(vv), 5) * 2:
            return rgb("#9aa3ad")
        return rgb("#ffffff")
    return [box(x, y0, z0, x + 0.8, y1, z1, m)]


def flow_tv_y(x, y0, y1, z0, z1):
    """Wall TV (face R) showing a user-flow diagram."""
    w, h = y1 - y0, z1 - z0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(INK)
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 0.7 or uu > w - 0.7 or vv < 0.7 or vv > h - 0.7:
            return rgb("#1d2025")
        boxes = ((2.0, 6.2, 5.5, 8.6, SKY), (7.5, 6.2, 11.0, 8.6, MINT), (13.0, 6.2, 16.5, 8.6, MUSTARD),
                 (7.5, 1.8, 11.0, 4.2, CORAL))
        for (a, b, c, d, col) in boxes:
            if a <= uu <= c and b <= vv <= d:
                return (rgb(col), True)
        if abs(vv - 7.4) < 0.25 and (5.5 < uu < 7.5 or 11.0 < uu < 13.0):
            return (rgb("#e9eef2"), True)
        if abs(uu - 9.25) < 0.25 and 4.2 < vv < 6.2:
            return (rgb("#e9eef2"), True)
        return (rgb("#26313b"), True)
    return [box(x, y0, z0, x + 0.9, y1, z1, m)]


def standing_desk(x0, y0, x1, y1, h=11.0, top=OAK_L):
    S = [box(x0, y0, h - 1.0, x1, y1, h, flat(top))]
    for x in (x0 + 1.5, x1 - 2.5):
        S.append(box(x, (y0 + y1) / 2 - 0.6, 0, x + 1.0, (y0 + y1) / 2 + 0.6, h - 1.0, flat("#3a4048")))
        S.append(box(x - 0.5, y0 + 0.6, 0, x + 1.5, y1 - 0.6, 0.6, flat("#3a4048")))
    return S


def laptop(cx, cy, z, facing="L"):
    S = [box(cx - 2.4, cy - 1.6, z, cx + 2.4, cy + 1.6, z + 0.4, flat("#c9ced4"))]
    S.append(box(cx - 2.4, cy - 1.8, z + 0.4, cx + 2.4, cy - 1.4, z + 3.4,
                 lambda p, n: (rgb("#6fa8dc"), True) if face_uv(p, n)[0] == "L" else rgb("#9aa3ad")))
    return S


def stool(cx, cy, col=CORAL):
    return [vcyl(cx, cy, 1.2, 0, 0.4, flat("#3a4048"), sides=6),
            vcyl(cx, cy, 0.4, 0.4, 7.6, flat("#3a4048"), sides=6),
            vcyl(cx, cy, 2.0, 7.6, 8.6, flat(col), sides=10)]


def sofa_y(x0, y0, y1, col="#5a8aa0"):
    c = rgb(col)

    def cush(p, n):
        f, u, v = face_uv(p, n)
        k = int((p[1] - y0) // ((y1 - y0) / 2))
        return c * (1.06 if f == "top" else 1.0) * (0.96 if k % 2 else 1.0)
    return [box(x0, y0, 0, x0 + 9.0, y1, 4.6, cush),
            box(x0, y0, 4.6, x0 + 3.0, y1, 10.0, flat(c * 0.9)),
            box(x0, y0 - 2.0, 0, x0 + 9.0, y0, 7.0, flat(c * 0.84)),
            box(x0, y1, 0, x0 + 9.0, y1 + 2.0, 7.0, flat(c * 0.84))]


def beanbag(cx, cy, col=MUSTARD):
    return [blob(cx, cy, 2.6, 3.6, flat(col), n=20, squash=0.7),
            blob(cx - 1.4, cy - 0.6, 4.6, 2.4, flat(rgb(col) * 0.92), n=14, squash=0.8)]


def credenza_y(x, y0, y1, h=7.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(OAK)
        if f == "R":
            k = (p[1] - y0) % ((y1 - y0) / 3)
            if k < 0.4:
                return rgb(OAK_D)
            if abs(p[2] - h * 0.6) < 0.35 and abs(k - (y1 - y0) / 6) < 1.4:
                return rgb(INK)
        return rgb(WHITE)
    return [box(x, y0, 0, x + 5.5, y1, h, m)]


def tall_plant(cx, cy, h=24.0, seed=4):
    S = [box(cx - 3.2, cy - 3.2, 0, cx + 3.2, cy + 3.2, 7.0, flat("#e9eae6")),
         vcyl(cx, cy, 0.5, 7.0, h * 0.7, flat("#6b5440"), sides=6)]
    def lf(p, n):
        k = hash2(int(p[0] / 1.5), int(p[1] / 1.5) + int(p[2] / 1.5) * 7, seed)
        return rgb("#2f6d3a") if k < 0.3 else (rgb("#6cb45a") if k > 0.8 else rgb("#3f8c48"))
    for i, (dx, dy, dz, r) in enumerate(((0, 0, h, 3.6), (-2.4, 1.4, h * 0.8, 3.0), (2.0, -1.2, h * 0.86, 3.0))):
        S.append(blob(cx + dx, cy + dy, dz, r, lf, n=20, seed=seed + i))
    return S


def glass_door_x(x, y, h, accent, out=1):
    S = door_frame_x(x, y, h, "#3a4048", canopy=None, out=out)
    # accent strip on the lintel
    S.append(box(x - DOOR_HALF - 1.2, y - 0.7, h + 1.6, x + DOOR_HALF + 1.2, y + 0.7, h + 2.4, flat(accent)))
    return S


# ------------------------------------------------------------------ SPECS: product team pod
def interior_specs(W, D, slab):
    teal = "#3f8c86"
    rug = (1.05 * U + 2, 1.15 * U - 2, W - 1.05 * U - 3, 3.05 * U + 4)

    def rug_fn(x, y):
        edge = min(x - rug[0], rug[2] - x, y - rug[1], rug[3] - y)
        if edge < 1.4:
            return rgb("#2c6e6a")
        c = rgb("#9cc9c2") if int((x + y) // 4.0) % 2 else rgb("#93c1ba")
        return c

    S = room_shell(W, D, slab, carpet_floor(rug, rug_fn), feature_wall(teal),
                   trim="#e9ecef", side="#5b636d", side_dark="#4a525c",
                   name="SPECS", plate="#2c6e6a", ink="#f7fbfa", plate_edge="#9cc9c2")
    T = WALL_T
    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#5b636d", edge=teal)
    S += glass_door_x(dx, D - 0.6, 22.0, teal)
    S += entrance_steps("S", (dx, D), slab, col="#c9ced4")

    # --- N wall: raised SPECS letters on the teal band, story wall on the right
    S += raised_letters_x("SPECS", 12.0, T, 18.0, col=WHITE, px=0.8)
    S += story_wall_x(72.0, 112.0, T, 11.5, 27.0)

    # --- standing-desk bench along the N wall (left), dual monitors + stools
    S += standing_desk(8.0, T + 0.4, 36.0, T + 8.0)
    S += standing_desk(38.0, T + 0.4, 66.0, T + 8.0)
    for i, mx in enumerate((15.0, 29.0, 45.0)):
        S += liven(monitor(mx, T + 2.6, 11.0, "L", w=7.6, seed=i * 3, doc=(i != 1)), 0, "doc" if i != 1 else "code", "L")
    S += liven(laptop(58.0, T + 4.4, 11.0), 1, "glint", "L")
    S += mug(22.0, T + 6.4, 11.0, col=CORAL)
    S += mug(52.0, T + 6.0, 11.0, col=teal)
    S += paper_stack(33.0, T + 4.6, 11.0)
    for (sx, col) in ((15.0, CORAL), (29.0, MUSTARD), (45.0, teal), (58.0, CORAL)):
        S += stool(sx, T + 13.0, col=col)

    # --- story-wall side: a tall plant in the NE corner
    S += tall_plant(W - 6.0, T + 9.0, h=24.0, seed=6)

    # --- W wall: persona board over a credenza; TV with the user flow over a sofa
    S += persona_board_y(T, 20.0, 50.0, 12.0, 26.0)
    S += credenza_y(T + 0.2, 21.0, 49.0)
    S += [box(T + 1.0, 24.0, 7.0, T + 4.6, 30.0, 9.6, flat(SKY)),           # stacked notebooks
          box(T + 1.0, 24.4, 9.6, T + 4.6, 29.6, 10.6, flat(CORAL))]
    S += [s_ for s_ in potted_plant(T + 3.2, 44.0, r=2.6, h=7.0, seed=8, big=False)]
    S += liven(flow_tv_y(T, 60.0, 80.0, 12.0, 23.0), 0, "glint", "R")
    S += sofa_y(T + 0.4, 58.0, 82.0, col="#5a8aa0")

    # --- front: beanbags (left), mobile whiteboard (right)
    S += beanbag(14.0, D - 10.0, col=MUSTARD)
    S += beanbag(24.0, D - 8.0, col=CORAL)
    from office_props import whiteboard
    S += translate(whiteboard(), W - 16.0, D - 9.0)
    S += potted_plant(W - 5.5, D - 6.5, r=3.6, h=10, seed=9)
    return S


def translate(solids, dx, dy, dz=0.0):
    out = []
    for s_ in solids:
        planes = [(tuple(float(v) for v in nrm), d + nrm[0] * dx + nrm[1] * dy + nrm[2] * dz) for (nrm, d) in s_.planes]
        b = s_.aabb
        m0 = s_.mat
        out.append(Solid(planes, (b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz),
                         _shift_mat(m0, dx, dy, dz), cast=s_.cast))
    return out


def _shift_mat(m0, dx, dy, dz):
    import numpy as np
    def m(p, n):
        return m0(np.array([p[0] - dx, p[1] - dy, p[2] - dz]), n)
    return m


# ------------------------------------------------------------------ PLAN: glass meeting room
def roadmap_screen_x(x0, x1, y, z0, z1, seed=11):
    """Big wall display (face L) showing a quarterly roadmap: lanes of bars + milestones."""
    w, h = x1 - x0, z1 - z0
    bars = (SKY, MINT, MUSTARD, CORAL)

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(INK)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.9 or uu > w - 0.9 or vv < 0.9 or vv > h - 0.9:
            return rgb("#1d2025")
        if vv > h - 2.6:                                    # quarter header
            q = int((uu - 0.9) // ((w - 1.8) / 4))
            return (rgb("#e9eef2"), True) if int(uu) % 2 and (uu - 0.9) % ((w - 1.8) / 4) > 1.2 else (rgb("#33404c"), True)
        if (uu - 0.9) % ((w - 1.8) / 4) < 0.3:
            return (rgb("#3c4a57"), True)
        lane = int((h - 2.6 - vv) // 2.3)
        lv = (h - 2.6 - vv) % 2.3
        if lane < 4 and 0.5 < lv < 1.7:
            a = 2.0 + hash2(lane, 1, seed) * (w * 0.45)
            b = a + 6.0 + hash2(lane, 2, seed) * (w * 0.35)
            if a < uu < min(b, w - 2.0):
                return (rgb(bars[lane]), True)
        if abs(uu - w * 0.62) < 0.3:
            return (rgb("#ff5a5a"), True)                   # today line
        return (rgb("#26313b"), True)
    return [box(x0, y, z0, x1, y + 0.9, z1, m)]


def wall_calendar_x(x0, x1, y, z0, z1):
    w, h = x1 - x0, z1 - z0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#9aa3ad")
        uu, vv = p[0] - x0, p[2] - z0
        if vv > h - 2.2:
            return rgb(CORAL)
        if uu < 0.6 or uu > w - 0.6 or vv < 0.6:
            return rgb("#dfe4e8")
        if (uu - 0.6) % (w / 5) < 0.3 or (h - 2.2 - vv) % 2.2 < 0.3:
            return rgb("#c9d0d6")
        c, r = int((uu - 0.6) // (w / 5)), int((h - 2.2 - vv) // 2.2)
        if hash2(c, r, 13) > 0.78:
            return rgb((SKY, MINT, MUSTARD)[(c + r) % 3])
        return rgb("#ffffff")
    return [box(x0, y, z0, x1, y + 0.6, z1, m)]


def meeting_table_x(x0, x1, y0, y1, h=7.6):
    S = [box(x0, y0, h - 1.0, x1, y1, h, flat(OAK_L))]
    for x in (x0 + 4.0, x1 - 5.0):
        S.append(box(x, y0 + 1.5, 0, x + 1.0, y1 - 1.5, h - 1.0, flat("#3a4048")))
    return S


def meeting_chair(cx, cy, facing="N", col="#3a6ea5"):
    c = rgb(col)
    S = [vcyl(cx, cy, 2.0, 0, 0.5, flat("#30353b"), sides=5),
         vcyl(cx, cy, 0.4, 0.5, 4.0, flat("#4a5058"), sides=6),
         box(cx - 2.4, cy - 2.4, 4.0, cx + 2.4, cy + 2.4, 5.2, flat(c))]
    if facing == "N":
        S.append(box(cx - 2.2, cy + 1.6, 5.2, cx + 2.2, cy + 2.6, 10.0, flat(c * 0.9)))
    elif facing == "S":
        S.append(box(cx - 2.2, cy - 2.6, 5.2, cx + 2.2, cy - 1.6, 10.0, flat(c * 0.9)))
    elif facing == "E":
        S.append(box(cx - 2.6, cy - 2.2, 5.2, cx - 1.6, cy + 2.2, 10.0, flat(c * 0.9)))
    else:
        S.append(box(cx + 1.6, cy - 2.2, 5.2, cx + 2.6, cy + 2.2, 10.0, flat(c * 0.9)))
    return S


def speakerphone(cx, cy, z):
    return [vcyl(cx, cy, 2.2, z, z + 0.7, flat(INK), sides=3, rot=0.3),
            vcyl(cx, cy, 0.6, z + 0.7, z + 0.8, lambda p, n: (rgb("#6fd3ff"), True), sides=6)]


def bottle(cx, cy, z):
    return [vcyl(cx, cy, 0.7, z, z + 2.6, lambda p, n: (rgb("#bfe3f2"), False), sides=6),
            vcyl(cx, cy, 0.45, z + 2.6, z + 3.1, flat(SKY), sides=6)]


def glass_partition_mat(notes=None):
    """Glass partition (R face) with a frosted band and an affinity map of sticky notes."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3a4048")
        z = p[2]
        if z < 1.0:
            return rgb("#3a4048")
        if notes:
            for (y0, y1, z0, z1, col) in notes:
                if y0 <= p[1] <= y1 and z0 <= z <= z1:
                    return rgb(col)
        if 6.0 < z < 7.4:
            return rgb("#e3eef3") if int(p[1] // 1.2) % 2 else rgb("#d3e3ea")   # frosted band
        if int(p[1] + z * 0.8) % 9 == 0:
            return (rgb("#f2fbff"), True)                  # glint
        return rgb("#b4d4e2") if f == "R" else rgb("#a3c6d6")
    return m


def flipchart(cx, cy):
    def pad(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#c9ced4")
        uu, zz = p[0] - cx + 4.0, p[2] - 9.0
        if 1.0 < uu < 7.0 and abs(zz - 9.0) < 0.5:
            return rgb(CORAL)
        if 1.0 < uu < 6.0 and zz < 7.6 and zz > 1.4 and int(zz * 1.2) % 2 == 0:
            return rgb(SKY) if zz > 4 else rgb("#6b7280")
        return rgb("#ffffff")
    S = [box(cx - 4.0, cy - 0.4, 9.0, cx + 4.0, cy + 0.4, 20.0, pad),
         box(cx - 4.2, cy - 0.6, 19.6, cx + 4.2, cy + 0.6, 20.6, flat(INK))]
    for (dx, dy) in ((-3.6, 0.0), (3.6, 0.0), (0.0, -4.0)):
        S.append(box(cx + dx - 0.4, cy + dy - 0.4, 0, cx + dx + 0.4, cy + dy + 0.4, 9.0, flat("#9aa3ad")))
    return S


def interior_plan(W, D, slab):
    blue = "#3a6ea5"
    rug = (1.05 * U + 1, 1.1 * U - 4, W - 1.05 * U - 2, 2.95 * U + 6)

    def rug_fn(x, y):
        edge = min(x - rug[0], rug[2] - x, y - rug[1], rug[3] - y)
        if edge < 1.4:
            return rgb("#23466f")
        return rgb("#a9c2dc") if int((x - y) // 4.0) % 2 else rgb("#a1bad5")

    base_wall = feature_wall(blue)

    def wall(which, u, z):
        if which == "W":
            return rgb("#b4d4e2")                          # (glass drawn as its own solid)
        return base_wall(which, u, z)

    S = room_shell(W, D, slab, carpet_floor(rug, rug_fn), wall,
                   trim="#e9ecef", side="#5b636d", side_dark="#4a525c",
                   name="PLAN", plate="#23466f", ink="#f2f7fc", plate_edge="#a9c2dc",
                   wall_h_w=1.0)
    T = WALL_T
    # glass W partition (low, so Specs stays visible) with an affinity map of notes
    notes = []
    for cl, (yc, colr) in enumerate(((22.0, "#fff07a"), (44.0, "#ffb3c1"), (66.0, "#9be3c7"), (86.0, "#a9d1ff"))):
        for i in range(6):
            if hash2(i, cl, 3) < 0.15:
                continue
            y0 = yc + (i % 3) * 4.0 - 6.0
            z0 = 3.6 + (i // 3) * 3.8
            notes.append((y0, y0 + 3.2, z0, z0 + 3.2, colr))
    S.append(box(0.0, T, 0, 1.0, D, 12.0, glass_partition_mat(notes)))
    S.append(box(0.0, T, 12.0, 1.2, D, 12.8, flat("#3a4048")))
    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#5b636d", edge=blue)
    S += glass_door_x(dx, D - 0.6, 22.0, blue)
    S += entrance_steps("S", (dx, D), slab, col="#c9ced4")

    # --- N wall: PLAN letters, roadmap screen, calendar
    S += raised_letters_x("PLAN", 6.0, T, 18.0, col=WHITE, px=0.8)
    S += liven(roadmap_screen_x(48.0, 92.0, T, 11.0, 26.0), 0, "roadmap", "L")
    S += wall_calendar_x(96.0, 112.0, T, 12.0, 25.0)

    # --- long meeting table along the N wall, chairs on the near side + ends
    S += meeting_table_x(30.0, 104.0, T + 6.0, T + 15.0)
    for i, cx in enumerate((40.0, 54.0, 68.0, 82.0, 96.0)):
        S += meeting_chair(cx, T + 19.0, "N", col=(blue, "#5a8aa0")[i % 2])
    S += meeting_chair(26.0, T + 10.5, "E", col=blue)
    S += liven(laptop(42.0, T + 11.0, 7.6), 1, "glint", "L")
    S += liven(laptop(70.0, T + 10.6, 7.6), 1, "glint", "L")
    S += speakerphone(60.0, T + 10.5, 7.6)
    S += bottle(50.0, T + 9.0, 7.6)
    S += bottle(86.0, T + 9.4, 7.6)
    S += paper_stack(92.0, T + 9.6, 7.6)
    S += mug(78.0, T + 12.0, 7.6, col=CORAL)

    # --- NW corner plant; W side credenza with water jug + glasses
    S += tall_plant(9.0, T + 8.5, h=22.0, seed=12)
    S += credenza_y(1.4, 40.0, 70.0, h=6.6)
    S += [vcyl(4.2, 50.0, 1.4, 6.6, 10.6, lambda p, n: (rgb("#cde9f5"), False), sides=8),
          vcyl(4.0, 55.0, 0.7, 6.6, 8.6, lambda p, n: (rgb("#e3f3fa"), False), sides=6),
          vcyl(4.0, 58.0, 0.7, 6.6, 8.6, lambda p, n: (rgb("#e3f3fa"), False), sides=6)]

    # --- front: flipchart (right), plant (left)
    S += flipchart(W - 14.0, D - 10.0)
    S += potted_plant(6.5, D - 7.0, r=3.8, h=11, seed=13)
    return S


# ------------------------------------------------------------------ BUILD: engineering bullpen
def code_monitor_bank(cx, cy, z, n_=3, facing="L", seed=0):
    """Two or three monitors on an arm (code views)."""
    S = []
    w = 6.4
    for i in range(n_):
        off = (i - (n_ - 1) / 2) * (w + 0.4)
        if facing == "L":
            S += liven(monitor(cx + off, cy, z, "L", w=w, h=4.8, seed=seed + i, doc=False), 0, "code", "L")
        else:
            S += liven(monitor(cx, cy - off, z, "R", w=w, h=4.8, seed=seed + i, doc=False), 0, "code", "R")
    return S


def server_rack(x0, y0, w=8.0, d=8.0, h=24.0, seed=21):
    """Rack cabinet (front faces +y) with blinking status LEDs."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#2b2f35")
        if f != "L":
            return rgb("#30353b")
        uu, zz = p[0] - x0, p[2]
        if uu < 0.8 or uu > w - 0.8 or zz < 1.2 or zz > h - 0.8:
            return rgb("#1f2328")
        unit = int((zz - 1.2) // 1.6)
        r = (zz - 1.2) % 1.6
        if r < 0.3:
            return rgb("#14171b")
        if 1.0 < uu < 2.4 and 0.5 < r < 1.1:
            k = hash2(unit, 1, seed)
            return (rgb("#3ddc97") if k > 0.3 else (rgb("#ffb347") if k > 0.12 else rgb("#ff5a5a")), True)
        if 3.0 < uu < w - 1.2 and 0.5 < r < 1.1 and int(uu * 1.5) % 2 == 0:
            return rgb("#4a525c")
        return rgb("#2a2f35")
    return [box(x0, y0, 0, x0 + w, y0 + d, h, m)]


def ci_monitor(cx, cy, h=17.0):
    """Floor-stand CI dashboard (screen faces +y): pipeline stages + big green PASS bar."""
    def scr(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(INK)
        uu, zz = p[0] - (cx - 7.0), p[2] - h
        if uu < 0.7 or uu > 13.3 or zz < 0.7 or zz > 8.3:
            return rgb("#1d2025")
        if zz > 5.4:                                         # pipeline: 4 stage pills
            k = int((uu - 0.7) // 3.15)
            if (uu - 0.7) % 3.15 < 2.5 and 5.9 < zz < 7.6:
                return (rgb("#3ddc97") if k < 3 else rgb("#ffb347"), True)
            return (rgb("#26313b"), True)
        if 1.4 < zz < 4.6 and 1.4 < uu < 12.6:
            return (rgb("#2fbf71"), True) if not (abs(zz - 3.0) < 0.4 and 3.0 < uu < 11.0) else (rgb("#e9fff3"), True)
        return (rgb("#26313b"), True)
    return [box(cx - 7.0, cy - 0.6, h, cx + 7.0, cy + 0.4, h + 9.0, scr),
            box(cx - 0.6, cy - 0.5, 0.6, cx + 0.6, cy + 0.5, h, flat("#4a5058")),
            box(cx - 3.0, cy - 2.6, 0, cx + 3.0, cy + 2.6, 0.6, flat("#4a5058"))]


def cable_tray_x(x0, x1, y, z):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(("#3a86c8", "#e0b04a", "#2fbf71", "#e07a5f")[int(p[1] * 2) % 4]) if int(p[0] // 3) % 2 else rgb("#5a636d")
        return rgb("#8c959e")
    S = [box(x0, y, z, x1, y + 3.0, z + 1.2, m)]
    for x in range(int(x0) + 4, int(x1), 16):
        S.append(box(x, y + 1.2, z + 1.2, x + 0.5, y + 1.8, z + 6.0, flat("#8c959e")))
    return S


def deploy_button(cx, cy):
    return [box(cx - 2.2, cy - 2.2, 0, cx + 2.2, cy + 2.2, 7.0, flat("#3a4048")),
            box(cx - 2.6, cy - 2.6, 7.0, cx + 2.6, cy + 2.6, 7.6, flat("#e0b04a")),
            blob(cx, cy, 7.8, 1.6, lambda p, n: (rgb("#ff4a3d"), True), n=14, squash=0.6)]


def rubber_duck(cx, cy, z):
    y = flat("#f7d23e")
    return [blob(cx, cy, z + 1.0, 1.1, y, n=12, squash=0.8), blob(cx + 0.7, cy, z + 2.1, 0.7, y, n=10),
            box(cx + 1.2, cy - 0.25, z + 1.9, cx + 1.8, cy + 0.25, z + 2.2, flat("#f28c28"))]


def hw_boxes(x0, y0):
    S = []
    for (dx, dy, dz, w, d, h, c) in ((0, 0, 0, 7, 5, 4, "#c79a62"), (7.5, 0.5, 0, 5, 4, 3, "#b88a55"),
                                     (1.0, 0.6, 4, 5, 4, 3, "#d4a872")):
        S.append(box(x0 + dx, y0 + dy, dz, x0 + dx + w, y0 + dy + d, dz + h, flat(c)))
    S.append(hcyl("y", x0 + 16.0, 3.0, 3.0, y0, y0 + 2.6, flat("#3a86c8"), sides=10))  # cable spool
    S.append(hcyl("y", x0 + 16.0, 3.0, 1.0, y0 - 0.2, y0 + 2.8, flat("#c9ced4"), sides=8))
    return S


def led_signboard_y(x, y0, y1, name, h0=3.0, h1=13.0, col="#ffb347"):
    """Dark LED board on two posts along the E edge (face R) with glowing letters."""
    tw = len(name) * 6 - 1

    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#2b2f35")
        uu, zz = y1 - p[1], p[2] - h0
        w, h = y1 - y0, h1 - h0
        if uu < 0.8 or uu > w - 0.8 or zz < 0.8 or zz > h - 0.8:
            return rgb("#4a525c")
        u0 = round(w / 2 - tw / 2)
        if text7(name, uu, zz, u0, h / 2 + 3.5, slope=-1):
            return (rgb(col), True)
        if int(uu) % 2 == 0 and int(zz) % 2 == 0:
            return rgb("#262a30")
        return rgb("#1d2025")
    S = [box(x - 0.5, y0, h0, x + 0.4, y1, h1, board)]
    for y in (y0 + 2.0, y1 - 3.0):
        S.append(box(x - 0.4, y, 0, x + 0.4, y + 1.0, h0 + 0.5, flat("#5a5f66")))
    return S


def interior_build(W, D, slab):
    orange = "#c27a3a"
    pad = (1.05 * U - 1, 1.1 * U - 4, W - 1.05 * U + 1, 3.15 * U + 5)

    def floor(p):
        x, y = p[0], p[1]
        if pad[0] <= x <= pad[2] and pad[1] <= y <= pad[3]:
            edge = min(x - pad[0], pad[2] - x, y - pad[1], pad[3] - y)
            if edge < 1.4:
                return rgb(orange)
            return rgb("#e9d6bf") if int((x + y) // 4.0) % 2 else rgb("#e2cdb3")
        # polished concrete with a faint trowel pattern
        h = hash2(int(x / 3), int(y / 3), 211)
        c = rgb("#a9adb1") if h > 0.5 else rgb("#a3a7ab")
        if hash2(int(x), int(y), 212) < 0.04:
            c = c * 1.05
        return c

    def panel(which, u, z):
        # acoustic partition: felt panels in burnt orange with a white top rail
        if z < 1.0:
            return rgb("#3a4048")
        if z > 11.6:
            return rgb(WHITE)
        k = u % 9.0
        if k < 0.4:
            return rgb("#8a4f22")
        return rgb("#e0924a") if int(u // 9.0) % 2 else rgb("#d6863d")

    S = room_shell(W, D, slab, floor, panel, trim=WHITE, side="#5b636d", side_dark="#4a525c",
                   wall_h=12.5, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    S += door_frame_x(dx, 0.6, 18.0, "#3a4048", canopy=None, out=-1)
    S.append(box(dx - DOOR_HALF - 1.2, -0.1, 19.6, dx + DOOR_HALF + 1.2, 1.3, 20.4, flat(orange)))
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col="#5b636d", edge=orange)
    S += entrance_steps("N", (dx, 0), slab, col="#c9ced4")

    # --- N side, left of the door: two standing desks with triple code monitors
    S += standing_desk(6.0, T + 0.6, 30.0, T + 8.0)
    S += standing_desk(31.0, T + 0.6, dx - DOOR_HALF - 1.0, T + 8.0)
    S += code_monitor_bank(18.0, T + 2.6, 11.0, n_=3, seed=2)
    S += code_monitor_bank(41.0, T + 2.6, 11.0, n_=2, seed=7)
    S += rubber_duck(26.5, T + 6.0, 11.0)
    S += mug(36.0, T + 6.2, 11.0, col=orange)
    S += keyboard(14.0, T + 5.2, 22.0, T + 7.2, 11.0)
    S += keyboard(37.0, T + 5.2, 45.0, T + 7.2, 11.0)

    # --- N side, right of the door: CI build monitor + server racks in the NE corner
    S += liven(ci_monitor(dx + 18.0, T + 4.0), 0, "ci", "L")
    S += liven(server_rack(W - 20.0, T + 0.4), 0, "leds", "L")
    S += liven(server_rack(W - 11.5, T + 0.4, seed=27), 0, "leds", "L")
    S += cable_tray_x(W - 21.0, W - 2.0, T + 1.0, 24.6)

    # --- W side: desk facing the partition with dual monitors, chair, plant
    S += desk(T + 0.4, 22.0, T + 9.5, 48.0)
    S += code_monitor_bank(T + 2.8, 35.0, 8.0, n_=2, facing="R", seed=11)
    S += keyboard(T + 5.6, 31.5, T + 7.6, 38.5, 8.0)
    S += office_chair(T + 13.0, 35.0, "W", col="#3a4048")
    S += tall_plant(T + 5.0, 58.0, h=18.0, seed=14)

    # --- front: hardware boxes + cable spool (left), big red deploy button, LED sign (E edge)
    S += hw_boxes(8.0, D - 12.0)
    S += deploy_button(W - 24.0, D - 10.0)
    S += led_signboard_y(W - 2.2, 26.0, 68.0, "BUILD")
    return S


# ------------------------------------------------------------------ REVIEW: QA & demo room
def device_shelf_x(x0, x1, y0, h=12.0, seed=31):
    """Open shelf of test phones/tablets on charging stands (front faces +y)."""
    w = x1 - x0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(WHITE)
        if f != "L":
            return rgb("#dcdcd6")
        uu, zz = p[0] - x0, p[2]
        if uu < 0.8 or uu > w - 0.8 or zz < 0.8:
            return rgb(WHITE)
        lvl = int((zz - 0.8) // 3.7)
        r = (zz - 0.8) % 3.7
        if r < 0.6:
            return rgb("#c9ced4")
        k = int(uu // 2.6)
        cu = uu % 2.6
        tablet = hash2(k // 2, lvl, seed) > 0.75
        if (cu < 2.0 or tablet) and r < 3.2:
            if cu < 0.3 or r < 0.9 or r > 3.0:
                return rgb(INK)
            st = hash2(k, lvl, seed + 1)
            c = (rgb("#6fa8dc") if st > 0.4 else (rgb("#7bc6a4") if st > 0.15 else rgb("#e07a5f")))
            return (c, True)
        return rgb("#eef0ee")
    return [box(x0, y0, 0, x1, y0 + 5.0, h, m)]


def diff_screen_y(x, y0, y1, z0, z1, name="REVIEW"):
    """Big review display on a stand along the E edge (face R): name header + code diff."""
    w, h = y1 - y0, z1 - z0
    tw = len(name) * 6 - 1

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(INK)
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 0.8 or uu > w - 0.8 or vv < 0.8 or vv > h - 0.8:
            return rgb("#1d2025")
        if vv > h - 10.0:                                   # header with the zone name
            if text7(name, uu, vv, round(w / 2 - tw / 2), h - 1.6, slope=-1):
                return (rgb("#ffffff"), True)
            return (rgb("#7d5bc4"), True)
        row = int((h - 10.0 - vv) // 1.4)
        rv = (h - 10.0 - vv) % 1.4
        kind = hash2(row, 1, 41)
        bg = rgb("#3b2328") if kind < 0.25 else (rgb("#1f3a2c") if kind > 0.7 else rgb("#22272e"))
        if rv < 0.7 and 3.0 < uu < w - 2.0 - hash2(row, 2, 41) * (w * 0.4):
            fg = rgb("#ff8a8a") if kind < 0.25 else (rgb("#7ee2a8") if kind > 0.7 else rgb("#aab4bf"))
            return (fg, True)
        if uu < 2.4:
            return (rgb("#3a414a"), True)                   # line numbers gutter
        return (bg, True)
    S = [box(x - 0.5, y0, z0, x + 0.4, y1, z1, m)]
    for y in (y0 + 3.0, y1 - 4.0):
        S.append(box(x - 0.6, y, 0, x + 0.6, y + 1.2, z0, flat("#4a5058")))
        S.append(box(x - 3.0, y - 1.0, 0, x + 1.0, y + 2.2, 0.6, flat("#4a5058")))
    return S


def signoff_board_y(x, y0, y1, z0, z1):
    """Sign-off checklist (face R): rows with ticks / crosses + a signature line."""
    w, h = y1 - y0, z1 - z0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#9aa3ad")
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 0.8 or uu > w - 0.8 or vv < 0.8 or vv > h - 0.8:
            return rgb("#b9c2ca")
        row = int((h - 1.6 - vv) // 1.8)
        rv = (h - 1.6 - vv) % 1.8
        if row < 5 and rv < 1.1:
            if 1.6 < uu < 2.8:
                ok = hash2(row, 3, 51) > 0.2
                return rgb("#2fbf71") if ok else rgb("#e5484d")
            if 3.6 < uu < w - 2.0 - hash2(row, 4, 51) * 6:
                return rgb("#8a95a0")
        if row >= 5 and abs(vv - 1.8) < 0.3 and uu > 3:
            return rgb(INK)
        return rgb("#ffffff")
    return [box(x, y0, z0, x + 0.8, y1, z1, m)]


def stamp_table(x0, y0, w=16.0, d=8.0, h=7.6):
    S = [box(x0, y0, h - 1.0, x0 + w, y0 + d, h, flat(OAK_L))]
    for (dx, dy) in ((0.8, 0.8), (w - 1.8, 0.8), (0.8, d - 1.8), (w - 1.8, d - 1.8)):
        S.append(box(x0 + dx, y0 + dy, 0, x0 + dx + 1.0, y0 + dy + 1.0, h - 1.0, flat("#3a4048")))

    def doc(stampc):
        def m(p, n):
            f, u, v = face_uv(p, n)
            if f == "top":
                if math.hypot(p[0] - (x0 + 4.0), p[1] - (y0 + 3.6)) < 1.4 and stampc:
                    return rgb(stampc)
                return rgb("#fbfbf6")
            return rgb("#e3e3da")
        return m
    S.append(box(x0 + 1.5, y0 + 1.5, h, x0 + 6.5, y0 + 6.0, h + 0.3, doc("#2fbf71")))
    S.append(box(x0 + 7.5, y0 + 1.8, h, x0 + 12.0, y0 + 6.2, h + 0.3, doc(None)))
    for (cx, c) in ((x0 + 13.4, "#2fbf71"), (x0 + 14.8, "#e5484d")):     # stamps
        S.append(box(cx - 0.6, y0 + 2.4, h, cx + 0.6, y0 + 3.6, h + 0.8, flat(c)))
        S.append(vcyl(cx, y0 + 3.0, 0.35, h + 0.8, h + 2.2, flat(OAK_D), sides=6))
    return S


def device_cart(x0, y0):
    S = [box(x0, y0, 7.0, x0 + 10.0, y0 + 6.0, 7.8, flat(WHITE)),
         box(x0, y0, 2.0, x0 + 10.0, y0 + 6.0, 2.6, flat(WHITE))]
    for (dx, dy) in ((0.4, 0.4), (9.0, 0.4), (0.4, 5.0), (9.0, 5.0)):
        S.append(box(x0 + dx, y0 + dy, 0.8, x0 + dx + 0.6, y0 + dy + 0.6, 7.0, flat("#9aa3ad")))
        S.append(vcyl(x0 + dx + 0.3, y0 + dy + 0.3, 0.6, 0, 0.8, flat(INK), sides=6))
    for k in range(4):
        S.append(box(x0 + 0.8 + k * 2.3, y0 + 1.0, 7.8, x0 + 2.6 + k * 2.3, y0 + 4.6, 8.2,
                     lambda p, n: (rgb("#6fa8dc"), True) if face_uv(p, n)[0] == "top" else rgb(INK)))
    S.append(box(x0 + 1.0, y0 + 1.0, 2.6, x0 + 9.0, y0 + 5.0, 4.2, flat("#c79a62")))
    return S


def interior_review(W, D, slab):
    purple = "#7d5bc4"
    zone = (1.05 * U - 2, 1.1 * U - 5, W - 1.05 * U + 2, 3.15 * U + 5)

    def floor(p):
        x, y = p[0], p[1]
        if zone[0] <= x <= zone[2] and zone[1] <= y <= zone[3]:
            edge = min(x - zone[0], zone[2] - x, y - zone[1], zone[3] - y)
            if edge < 1.4:
                return rgb(purple)
            return rgb("#d9cfee") if int((x + y) // 4.0) % 2 else rgb("#d1c6e8")
        return carpet_floor(a="#c2c0c8", b="#bab8c0")(p)

    def wall(which, u, z):
        if z < 1.0:
            return rgb("#4a3a78")
        if z > 12.2:
            return rgb(WHITE)
        if 4.0 < z < 5.0:
            return rgb(purple)
        return rgb(WHITE) if int(u // 12) % 2 else rgb(OFFWHITE)

    S = room_shell(W, D, slab, floor, wall, trim=WHITE, side="#5b636d", side_dark="#4a525c",
                   wall_h=13.0, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    S += door_frame_x(dx, 0.6, 18.0, "#3a4048", canopy=None, out=-1)
    S.append(box(dx - DOOR_HALF - 1.2, -0.1, 19.6, dx + DOOR_HALF + 1.2, 1.3, 20.4, flat(purple)))
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col="#5b636d", edge=purple)
    S += entrance_steps("N", (dx, 0), slab, col="#c9ced4")

    # --- N side: device-testing shelves (right of the door), demo desk (left)
    S += liven(device_shelf_x(dx + DOOR_HALF + 2.0, W - 3.0, T + 0.4), 0, "devices", "L")
    S += desk(6.0, T + 0.6, dx - DOOR_HALF - 2.0, T + 9.0, top=OAK_L)
    S += liven(monitor(18.0, T + 2.8, 8.0, "L", w=7.6, seed=31, doc=False), 0, "code", "L")
    S += liven(monitor(28.0, T + 2.8, 8.0, "L", w=7.6, seed=32, doc=True), 0, "doc", "L")
    S += liven(laptop(40.0, T + 5.0, 8.0), 1, "glint", "L")
    S += office_chair(23.0, T + 13.0, "N", col="#4a3a78")

    # --- W side: sign-off board over the stamp table, test devices on a cart
    S += signoff_board_y(T, 18.0, 40.0, 2.0, 12.0)
    S += stamp_table(T + 0.6, 44.0, w=9.0, d=18.0) if False else []
    S += stamp_table(T + 6.0, 46.0)
    S += office_chair(T + 14.0, 62.0, "N", col="#4a3a78")
    S += device_cart(T + 4.0, D - 14.0)

    # --- E edge: big review display with the diff (carries the zone name)
    S += liven(diff_screen_y(W - 2.2, 22.0, 70.0, 9.0, 31.0), 0, "diff", "R")
    S += potted_plant(W - 6.0, D - 6.5, r=3.8, h=10, seed=17)
    return S


# ------------------------------------------------------------------ IDLE: staff kitchen & break room
from interiors import cafe_table, bar_stool, coffee_cup, espresso_machine, banquette_y


def kitchen_run_x(x0, x1, y0, d=7.0, h=9.0):
    """Base cabinets (white, oak top) + tiled splashback + upper cabinets on the N wall."""
    def base(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e9e6df")
        if p[2] < 1.0:
            return rgb(INK)
        if f == "L":
            k = (p[0] - x0) % 7.0
            if k < 0.35:
                return rgb("#c9ccc8")
            if abs(p[2] - (h - 2.0)) < 0.3 and 2.5 < k < 4.5:
                return rgb("#5a626c")                   # handles
        return rgb(WHITE)

    def splash(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(WHITE)
        if (p[0] % 2.4) < 0.25 or (p[2] % 1.2) < 0.25:
            return rgb("#d6ddd9")
        return rgb("#9fd3bf") if int(p[0] // 2.4 + p[2] // 1.2) % 5 else rgb("#7bc6a4")

    def upper(p, n):
        f, u, v = face_uv(p, n)
        if f == "L":
            k = (p[0] - x0) % 9.0
            if k < 0.35:
                return rgb("#9c7a55")
            if abs(p[2] - 19.0) < 0.3 and 3.5 < k < 5.5:
                return rgb("#5a626c")
        return rgb(OAK)
    return [box(x0, y0, 0, x1, y0 + d, h, base),
            box(x0, y0, h, x1, y0 + 0.4, h + 8.0, splash),
            box(x0, y0, h + 8.0, x1, y0 + 4.0, h + 15.0, upper)]


def sink(cx, y0, z):
    return [box(cx - 4.0, y0 + 1.2, z - 0.4, cx + 4.0, y0 + 5.4, z + 0.05, flat("#9aa3ad")),
            vcyl(cx, y0 + 1.0, 0.4, z, z + 4.0, flat(STEEL), sides=6),
            box(cx - 0.4, y0 + 1.0, z + 3.6, cx + 0.4, y0 + 3.4, z + 4.0, flat(STEEL))]


def fridge_tall(x0, y0, w=9.0, d=7.0, h=26.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#c9ced4")
        if f == "L":
            if abs(p[2] - 16.0) < 0.3:
                return rgb("#8c959e")
            if abs(p[0] - (x0 + w - 1.6)) < 0.35 and (10.0 < p[2] < 14.5 or 17.5 < p[2] < 22.0):
                return rgb("#5a626c")
            # magnets / notes
            for (mx, mz, c) in ((x0 + 2.4, 20.0, CORAL), (x0 + 4.2, 21.4, "#fff07a"), (x0 + 3.0, 12.0, SKY)):
                if abs(p[0] - mx) < 0.9 and abs(p[2] - mz) < 0.9:
                    return rgb(c)
        return rgb("#e3e7ea") if f == "L" else rgb("#cfd4d8")
    return [box(x0, y0, 0, x0 + w, y0 + d, h, m)]


def microwave(x0, y0, z):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "L":
            if p[0] - x0 < 5.0 and z + 0.6 < p[2] < z + 3.4:
                return rgb("#2b2f35")
            if p[0] - x0 > 5.6 and z + 2.2 < p[2] < z + 3.0:
                return (rgb("#6fd3ff"), True)
        return rgb("#3a4048")
    return [box(x0, y0, z, x0 + 7.0, y0 + 4.5, z + 4.0, m)]


def foosball(cx, cy):
    """Foosball table along x (low), green pitch, rods with little red/blue men."""
    def pitch(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            if abs(p[0] - cx) < 0.25 or abs(abs(p[1] - cy) - 4.2) < 0.25:
                return rgb("#ffffff")
            return rgb("#3f9a5a")
        return rgb(OAK_D)
    S = [box(cx - 9.0, cy - 5.0, 5.4, cx + 9.0, cy + 5.0, 6.2, pitch),
         box(cx - 9.6, cy - 5.6, 6.2, cx + 9.6, cy - 5.0, 8.0, flat(OAK)),
         box(cx - 9.6, cy + 5.0, 6.2, cx + 9.6, cy + 5.6, 8.0, flat(OAK)),
         box(cx - 9.6, cy - 5.0, 6.2, cx - 9.0, cy + 5.0, 8.0, flat(OAK)),
         box(cx + 9.0, cy - 5.0, 6.2, cx + 9.6, cy + 5.0, 8.0, flat(OAK))]
    for (dx, dy) in ((-8.6, -4.6), (8.0, -4.6), (-8.6, 4.0), (8.0, 4.0)):
        S.append(box(cx + dx, cy + dy, 0, cx + dx + 1.2, cy + dy + 1.2, 5.4, flat(OAK_D)))
    for i, rx in enumerate((-6.0, -2.0, 2.0, 6.0)):
        S.append(hcyl("y", cx + rx, 7.2, 0.25, cy - 8.0, cy + 8.0, flat(STEEL), sides=6))
        for my in (-2.6, 0.0, 2.6):
            S.append(box(cx + rx - 0.5, cy + my - 0.4, 6.2, cx + rx + 0.5, cy + my + 0.4, 7.8,
                         flat("#e5484d" if i % 2 else "#3a86c8")))
    return S


def bookcase_y(x, y0, y1, h=9.0, seed=7):
    return bookshelf(x, y0, x + 4.6, y1, h, seed=seed, wood=OAK, along="y")


def idle_banner_x(x0, y, z0, name="IDLE"):
    S = [box(x0, y, z0 - 2.0, x0 + 4 * 6 * 1.6 + 4.0, y + 0.6, z0 + 13.0, flat("#4f9a6a"))]
    S += raised_letters_x(name, x0 + 2.4, y + 0.6, z0, col=WHITE, px=0.8)
    return S


def interior_idle(W, D, slab):
    green = "#4f9a6a"

    def floor(p):
        x, y = p[0], p[1]
        rx0, ry0, rx1, ry1 = 1.5 * U, 1.6 * U, W - 1.5 * U, D - 2.1 * U
        if rx0 <= x <= rx1 and ry0 <= y <= ry1:
            edge = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
            if edge < 1.4:
                return rgb("#2f6a4a")
            return rgb("#a8d3b5") if int((x - y) // 5.0) % 2 else rgb("#a0cbad")
        # light oak floorboards
        board = int(x // 3.6)
        c = rgb("#d8b98e") if board % 2 else rgb("#d1b186")
        if x % 3.6 < 0.3 or (y + board * 13.3) % 31.0 < 0.3:
            c = rgb("#b8976c")
        return c

    def wall(which, u, z):
        if which == "W":
            if z < 1.0:
                return rgb(INK)
            if z > 8.6:
                return rgb(OAK)
            return rgb(WHITE) if int(u // 6) % 2 else rgb(OFFWHITE)
        return feature_wall(green, z_split=26.0)(which, u, z)

    door_y = (6.3 - 1.2) * U
    S = room_shell(W, D, slab, floor, wall, trim="#e9ecef", side="#5b636d", side_dark="#4a525c",
                   wall_h_w=9.6, door_w=(door_y - DOOR_HALF, door_y + DOOR_HALF))
    T = WALL_T
    S += door_frame_y(0.6, door_y, 18.0, "#3a4048", canopy=None)
    S.append(box(-0.1, door_y - DOOR_HALF - 1.2, 19.6, 1.3, door_y + DOOR_HALF + 1.2, 20.4, flat(green)))
    S += doormat(T + 0.4, door_y - 6.5, T + 7.0, door_y + 6.5, col="#5b636d", edge=green)
    S += entrance_steps("W", (door_y, 0), slab, n_steps=1, col="#c9ced4")

    # --- N wall: kitchen run with fridge, sink, coffee machine, microwave; IDLE banner above
    S += fridge_tall(14.0, T + 0.2)
    S += kitchen_run_x(24.0, 104.0, T + 0.2)
    S += sink(46.0, T + 0.2, 9.0)
    S += espresso_machine(60.0, T + 1.0, 9.0)
    S += microwave(86.0, T + 1.0, 9.0)
    S += [box(96.0, T + 1.6, 9.0, 100.0, T + 4.6, 10.4, flat("#c9ced4")),            # fruit bowl
          blob(97.0, T + 3.0, 10.8, 0.9, flat("#e9b44c"), n=8), blob(98.8, T + 3.2, 10.8, 0.9, flat("#e85d3a"), n=8)]
    S += [vcyl(32.0, T + 3.0, 1.1, 9.0, 11.6, flat(CORAL), sides=8)]                    # kettle
    S += idle_banner_x(110.0, T, 15.0)
    # kitchen island with stools in front of the run
    S += [box(40.0, T + 14.0, 0, 90.0, T + 20.0, 9.0, flat(WHITE)),
          box(39.0, T + 13.4, 9.0, 91.0, T + 20.6, 10.0, flat(OAK_L))]
    for i, sx in enumerate((46.0, 56.0, 66.0, 76.0, 86.0)):
        S += bar_stool(sx, T + 25.0, col=(green, CORAL)[i % 2])
    S += coffee_cup(52.0, T + 17.0, 10.0, col=CORAL)
    S += coffee_cup(70.0, T + 16.2, 10.0)
    S += laptop(80.0, T + 17.0, 10.0)

    # --- NE: arcade-style snack fridge? -> tall plant + window seat; E side: foosball + beanbags
    S += tall_plant(W - 7.0, T + 8.0, h=24.0, seed=21)
    S += foosball(W - 22.0, 70.0)
    S += beanbag(W - 12.0, 120.0, col=MUSTARD)
    S += beanbag(W - 20.0, 132.0, col=CORAL)
    S += beanbag(W - 10.0, 142.0, col=SKY)

    # --- W side: banquette + tables (seats face +x), bookcase near the front
    S += banquette_y(T + 0.2, 34.0, door_y - DOOR_HALF - 4.0)
    for ty in (44.0, 70.0, 94.0):
        S += cafe_table(T + 12.5, ty, r=3.0)
        S += coffee_cup(T + 12.0, ty - 0.8, 7.3)
    S += bookcase_y(T + 0.2, door_y + DOOR_HALF + 6.0, door_y + DOOR_HALF + 40.0)
    S += sofa_y(T + 0.4, door_y + DOOR_HALF + 48.0, door_y + DOOR_HALF + 76.0, col="#5a8aa0")

    # --- front: lounge corner + plants (low)
    S += potted_plant(T + 6.0, D - 8.0, r=4.6, h=12, seed=33)
    S += potted_plant(W - 7.0, D - 8.0, r=4.6, h=12, seed=35)
    S += [box(40.0, D - 26.0, 0, 70.0, D - 18.0, 4.6, flat(OAK_L))]                    # low coffee table
    S += beanbag(36.0, D - 12.0, col=green)
    S += beanbag(74.0, D - 12.0, col=MUSTARD)
    return S


OFFICE_INTERIORS = {
    "specs": (interior_specs,) + tuple(CITY_INTERIORS["specs"][1:]),
    "plan": (interior_plan,) + tuple(CITY_INTERIORS["plan"][1:]),
    "build": (interior_build,) + tuple(CITY_INTERIORS["build"][1:]),
    "review": (interior_review,) + tuple(CITY_INTERIORS["review"][1:]),
    "idle": (interior_idle,) + tuple(CITY_INTERIORS["idle"][1:]),
}


def build(zid):
    fn, gw, gh, elev_px = OFFICE_INTERIORS[zid]
    return fn(gw * U, gh * U, elev_px / 2.0)


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    for zid in (sys.argv[1:] or OFFICE_INTERIORS):
        LIVE.clear()
        S = build(zid)
        im, anchor = render(S, ground_shadow=0)
        name = f"office_interior_{zid}"
        save_room(im, anchor, S, name, man, U)
        print(name, im.size, anchor, f"{len(LIVE)} live screens" if LIVE else "")
    json.dump(man, open("out/manifest.json", "w"), indent=1)
