"""
Zone interiors for the Space theme (orbital station modules). Same conventions as
interiors.py: origin = zone footprint NW corner at floor level, only N and W walls.

Run: python3 space_interiors.py [zone ...] -> out/space_interior_<zone>.png + manifest
"""
import json, math, os, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, mix, hash2, render, plane_through, Solid, LIVE, liven
from props import cone, flat, save_room
from interiors import (U, WALL_T, text7, room_shell, doormat, entrance_steps, door_frame_x, door_frame_y,
                       DOOR_HALF, desk, keyboard, INTERIORS as CITY_INTERIORS)
from office_interiors import raised_letters_x, translate

CYAN, CYAN_D = "#3ec8e0", "#1f7f92"
HAZ, HAZ_D = "#f2c14e", "#2a2d33"
METAL, METAL_D, METAL_L = "#4a5361", "#2a3038", "#6b7584"
HULL_L = "#c9d1da"
BLUE, ORANGE, VIOLET, GREEN, RED = "#5b8cff", "#ff9f43", "#b07cff", "#5ee08f", "#ff5a5a"


def glow(c):
    c = rgb(c) if isinstance(c, str) else c
    return lambda p, n: (c, True)


def deck_floor(accent, area, a="#343c47", b="#2f3640"):
    def floor(p):
        x, y = p[0], p[1]
        x0, y0, x1, y1 = area
        t = U / 4
        if x0 <= x <= x1 and y0 <= y <= y1:
            edge = min(x - x0, x1 - x, y - y0, y1 - y)
            if edge < 0.9:
                return (rgb(accent), True)
            if edge < 2.0:
                return rgb(METAL_D)
            c = rgb("#3b4552") if (int(x // t) + int(y // t)) % 2 else rgb("#37404c")
            if x % t < 0.35 or y % t < 0.35:
                return mix(rgb(accent), rgb("#1e242c"), 0.75)
            return c
        i, j = int(x // t), int(y // t)
        if x % t < 0.4 or y % t < 0.4:
            return rgb("#1e242c")
        return rgb(a) if (i + j) % 2 else rgb(b)
    return floor


def bulkhead_wall(accent, top=30.0, low=False):
    def wall(which, u, z):
        if z < 1.4:
            return rgb(HAZ) if int((u + z) // 2.0) % 2 else rgb(HAZ_D)
        if low:
            if z > 10.6:
                return (rgb(accent), True) if z < 11.4 else rgb(METAL_L)
            return rgb(METAL) if int(u // 8) % 2 else rgb("#454e5b")
        if abs(z - (top - 2.0)) < 0.5:
            return (rgb(accent), True)                       # light strip
        if u % 11.7 < 0.6:
            return rgb(METAL_D)
        if abs(z - 9.0) < 0.35:
            return rgb(METAL_D)
        k = hash2(int(u // 11.7), int(z // 9.0), 401)
        return rgb(METAL) if k > 0.3 else rgb("#454e5b")
    return wall


def airlock_door_x(x, y, h, accent, out=1):
    S = door_frame_x(x, y, h, METAL_D, canopy=None, out=out)
    S.append(box(x - DOOR_HALF - 1.2, y - 0.7, h + 1.6, x + DOOR_HALF + 1.2, y + 0.7, h + 2.4, glow(accent)))
    return S


def airlock_door_y(x, y, h, accent):
    S = door_frame_y(x, y, h, METAL_D, canopy=None)
    S.append(box(x - 0.7, y - DOOR_HALF - 1.2, h + 1.6, x + 0.7, y + DOOR_HALF + 1.2, h + 2.4, glow(accent)))
    return S


def holo_screen_x(x0, x1, y, z0, z1, accent, content="list", seed=5, name=None):
    """Wall display (face L) with a glowing frame; content list/map/graph."""
    w, h = x1 - x0, z1 - z0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(METAL_D)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.7 or uu > w - 0.7 or vv < 0.7 or vv > h - 0.7:
            return (rgb(accent), True)
        bg = rgb("#0b1a24")
        if content == "list":
            row = int((h - 1.6 - vv) // 1.7)
            rv = (h - 1.6 - vv) % 1.7
            if rv < 0.8 and row < 6:
                if 1.6 < uu < 2.6:
                    return (rgb(GREEN) if hash2(row, 1, seed) > 0.3 else rgb(HAZ), True)
                if 3.4 < uu < w - 2.0 - hash2(row, 2, seed) * (w * 0.4):
                    return (mix(rgb(accent), rgb("#ffffff"), 0.4), True)
        elif content == "starmap":
            stars = [(0.15, 0.3), (0.3, 0.7), (0.45, 0.45), (0.62, 0.78), (0.78, 0.35), (0.88, 0.62)]
            for i, (a, b) in enumerate(stars):
                if math.hypot(uu - a * w, vv - b * h) < 0.9:
                    return (rgb("#ffffff"), True)
            for (a, b), (c, d) in zip(stars, stars[1:]):
                ax, az, bx, bz = a * w, b * h, c * w, d * h
                L = math.hypot(bx - ax, bz - az)
                t = ((uu - ax) * (bx - ax) + (vv - az) * (bz - az)) / (L * L)
                if 0 < t < 1 and abs((uu - ax) * (bz - az) - (vv - az) * (bx - ax)) / L < 0.3 and int(t * L / 1.2) % 2 == 0:
                    return (rgb(accent), True)
            # trajectory arc
            r = math.hypot(uu - w * 0.5, (vv + h * 0.6) * 1.0)
            if abs(r - h * 1.25) < 0.35:
                return (rgb(HAZ), True)
            if hash2(int(uu * 1.4), int(vv * 1.4), seed) > 0.97:
                return (rgb("#6b7fa0"), True)
        elif content == "graph":
            for k, col in enumerate((GREEN, accent, HAZ)):
                yv = h * (0.3 + 0.18 * k) + math.sin(uu * (0.35 + k * 0.15) + k) * h * 0.12
                if abs(vv - yv) < 0.45:
                    return (rgb(col), True)
            if uu % 4.0 < 0.2 or vv % 3.0 < 0.2:
                return (rgb("#14303c"), True)
        return (bg, True)
    return [box(x0, y, z0, x1, y + 0.8, z1, m)]


def holo_screen_y(x, y0, y1, z0, z1, accent, content="list", seed=7):
    """Same on a W-side wall (face R)."""
    w, h = y1 - y0, z1 - z0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(METAL_D)
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 0.7 or uu > w - 0.7 or vv < 0.7 or vv > h - 0.7:
            return (rgb(accent), True)
        if content == "list":
            row = int((h - 1.6 - vv) // 1.7)
            rv = (h - 1.6 - vv) % 1.7
            if rv < 0.8 and row < 6 and 1.6 < uu < w - 2.0 - hash2(row, 2, seed) * (w * 0.4):
                return (mix(rgb(accent), rgb("#ffffff"), 0.4), True)
        if content == "graph":
            for k, col in enumerate((GREEN, accent)):
                yv = h * (0.35 + 0.25 * k) + math.sin(uu * (0.4 + k * 0.2) + k) * h * 0.12
                if abs(vv - yv) < 0.45:
                    return (rgb(col), True)
        return (rgb("#0b1a24"), True)
    return [box(x, y0, z0, x + 0.8, y1, z1, m)]


def console_x(x0, x1, y0, accent, h=8.0, d=6.0, seed=9):
    """Control console along x (operator side toward +y) with a sloped, glowing panel."""
    def body(p, n):
        f, u, v = face_uv(p, n)
        if f == "top" or (f == "L" and p[2] > h - 3.0):
            k = int((p[0] - x0) // 1.4)
            r = int(p[1] * 1.3)
            if hash2(k, r, seed) > 0.82:
                return (rgb((accent, GREEN, HAZ, RED)[k % 4]), True)
            return (rgb("#0f2a33"), True) if int((p[0] - x0) // 9.0) % 2 else (rgb("#12303a"), True)
        if p[2] < 1.0:
            return rgb(METAL_D)
        return rgb(METAL) if f == "L" else rgb("#3d4552")
    return [box(x0, y0, 0, x1, y0 + d, h, body, extra=[plane_through((0, 1, 1.3), (0, y0 + d, h - 3.0))])]


def crew_seat(cx, cy, facing="N", col=METAL_L):
    c = rgb(col)
    S = [vcyl(cx, cy, 0.6, 0, 4.0, flat(METAL_D), sides=6),
         box(cx - 2.6, cy - 2.6, 4.0, cx + 2.6, cy + 2.6, 5.4, flat(c))]
    if facing == "N":
        S.append(box(cx - 2.6, cy + 1.6, 5.4, cx + 2.6, cy + 2.8, 12.0, flat(c * 0.9)))
        S.append(box(cx - 2.6, cy + 1.4, 11.0, cx + 2.6, cy + 1.6, 11.6, glow(CYAN)))
    else:
        S.append(box(cx + 1.6, cy - 2.6, 5.4, cx + 2.8, cy + 2.6, 12.0, flat(c * 0.9)))
    return S


def holo_table(cx, cy, r=5.0, accent=CYAN, kind="ship"):
    """Round projector table with a floating hologram (ship / planet)."""
    S = [vcyl(cx, cy, r * 0.6, 0, 5.0, flat(METAL), sides=10),
         vcyl(cx, cy, r, 5.0, 6.2, flat(METAL_L), sides=12),
         vcyl(cx, cy, r * 0.8, 6.2, 6.5, glow(accent), sides=12)]
    hc = lambda p, n: (mix(rgb(accent), rgb("#ffffff"), 0.35), True)
    if kind == "planet":
        def pl(p, n):
            lat = (p[2] - (cy * 0 + 11.0)) / 3.2
            band = int((p[2] + math.atan2(p[1] - cy, p[0] - cx) * 2) * 1.2) % 3
            return (rgb(accent) if band else mix(rgb(accent), rgb("#ffffff"), 0.5), True)
        S.append(blob(cx, cy, 11.0, 3.2, pl, n=26))
        S.append(vcyl(cx, cy, 4.6, 10.8, 11.1, hc, sides=16))
    else:
        S.append(box(cx - 3.2, cy - 0.8, 9.0, cx + 3.0, cy + 0.8, 10.4, hc,
                     extra=[plane_through((1, 0, 0.6), (1.6, 0, 10.4))]))
        S.append(box(cx - 2.4, cy - 3.4, 9.4, cx + 0.2, cy + 3.4, 9.8, hc))
    return S


def server_bank_y(x, y0, y1, h=16.0, accent=CYAN, seed=13):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(METAL_D)
        if f != "R":
            return rgb("#3d4552")
        uu, zz = p[1] - y0, p[2]
        if uu % 6.0 < 0.5 or zz < 1.0 or zz > h - 1.0:
            return rgb(METAL_D)
        r = int(zz // 1.5)
        if (zz % 1.5) < 0.6 and (uu % 6.0) < 1.6:
            k = hash2(int(uu // 6), r, seed)
            return (rgb(GREEN) if k > 0.35 else (rgb(accent) if k > 0.12 else rgb(RED)), True)
        return rgb("#2f3640")
    return [box(x, y0, 0, x + 5.0, y1, h, m)]


def storage_crate(x0, y0, w=7.0, d=6.0, h=5.5, col="#5b6573"):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(col) * 1.05
        coord = p[0] if f == "L" else p[1]
        if abs(p[2] - h / 2) < 0.5:
            return rgb(HAZ) if int(coord // 1.5) % 2 else rgb(HAZ_D)
        return rgb(col)
    return [box(x0, y0, 0, x0 + w, y0 + d, h, m)]


def grow_light_rack_x(x0, x1, y0, h=20.0, seed=3):
    """Hydroponic shelves with plants under violet grow lights (front faces +y)."""
    S = [box(x0, y0, 0, x1, y0 + 1.0, h, flat(METAL_D))]
    for lvl, z in enumerate((1.0, 7.5, 14.0)):
        S.append(box(x0, y0, z, x1, y0 + 5.0, z + 0.8, flat(METAL_L)))
        S.append(box(x0, y0 + 0.4, z + 5.4, x1, y0 + 2.4, z + 5.9, glow("#c9a8ff")))
        x = x0 + 2.2
        k = 0
        while x < x1 - 1.5:
            S.append(blob(x, y0 + 2.6, z + 2.4, 1.7, flat(("#4fc06a", "#3a9a52", "#6fd47e")[(k + lvl) % 3]), n=12,
                          squash=0.9, seed=seed + k + lvl * 9))
            if (k + lvl) % 4 == 1:
                S.append(blob(x + 0.6, y0 + 3.6, z + 3.4, 0.6, flat(RED), n=8))       # tomatoes
            x += 4.0
            k += 1
    return S


def viewport_x(x0, x1, y, z0, z1, planet=True, seed=21):
    """Round-cornered viewport on the N wall showing stars (and a planet)."""
    w, h = x1 - x0, z1 - z0

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(METAL_D)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 1.2 or uu > w - 1.2 or vv < 1.2 or vv > h - 1.2:
            return rgb(METAL_L)
        if planet:
            d = math.hypot(uu - w * 0.72, vv + h * 0.9)
            if d < h * 1.25:
                if d > h * 1.25 - 0.9:
                    return (rgb("#8fe0ff"), True)
                cl = math.sin(uu * 0.6 + vv * 0.8) + math.sin(uu * 0.25 - vv)
                return (rgb("#e9f2f8") if cl > 1.2 else rgb("#3f8fd0"), True)
        k = hash2(int(uu * 1.3), int(vv * 1.3), seed)
        if k > 0.965:
            return (rgb("#ffffff"), True)
        return (mix(rgb("#05070d"), rgb("#121a33"), vv / h), True)
    return [box(x0, y, z0, x1, y + 0.6, z1, m)]


def potted_alien_plant(cx, cy, seed=3, h=12.0):
    S = [vcyl(cx, cy, 2.6, 0, 4.0, flat(METAL_L), sides=8),
         vcyl(cx, cy, 2.7, 3.4, 4.0, glow(CYAN), sides=8)]
    for k in range(5):
        ang = k * 2 * math.pi / 5 + seed
        for j in range(3):
            S.append(blob(cx + math.cos(ang) * (0.6 + j * 0.9), cy + math.sin(ang) * (0.6 + j * 0.9),
                          4.6 + j * (h - 5.0) / 3, 0.9 - j * 0.15, flat(("#7b5cff", "#b07cff", "#e0c3ff")[j]), n=8))
    S.append(blob(cx, cy, h, 1.1, glow("#ffe08a"), n=10))
    return S


def led_signboard_y(x, y0, y1, name, col, h0=3.0, h1=13.0):
    tw = len(name) * 6 - 1

    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(METAL_D)
        uu, zz = y1 - p[1], p[2] - h0
        w, h = y1 - y0, h1 - h0
        if uu < 0.8 or uu > w - 0.8 or zz < 0.8 or zz > h - 0.8:
            return (rgb(col), True)
        if text7(name, uu, zz, round(w / 2 - tw / 2), h / 2 + 3.5, slope=-1):
            return (rgb("#ffffff"), True)
        return (rgb("#0b1a24"), True)
    S = [box(x - 0.5, y0, h0, x + 0.4, y1, h1, board)]
    for y in (y0 + 2.0, y1 - 3.0):
        S.append(box(x - 0.4, y, 0, x + 0.4, y + 1.0, h0 + 0.5, flat(METAL_D)))
    return S


# ------------------------------------------------------------------ SPECS: mission briefing room
def interior_specs(W, D, slab):
    acc = CYAN
    area = (1.05 * U + 2, 1.15 * U - 2, W - 1.05 * U - 3, 3.05 * U + 4)
    S = room_shell(W, D, slab, deck_floor(acc, area), bulkhead_wall(acc),
                   trim=METAL_L, side="#434b57", side_dark="#363d48",
                   name="SPECS", plate="#0b1a24", ink="#bff6ff", plate_edge=acc)
    T = WALL_T
    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col=METAL_D, edge=acc)
    S += airlock_door_x(dx, D - 0.6, 22.0, acc)
    S += entrance_steps("S", (dx, D), slab, col="#6b7584")

    S += raised_letters_x("SPECS", 6.0, T, 18.0, col=acc, px=0.8)
    S += liven(holo_screen_x(58.0, 96.0, T, 11.0, 27.0, acc, content="list"), 0, "pan", "L", axis="v", speed=1.5, box=[1, 1, 37, 15])
    S += liven(viewport_x(99.0, 113.0, T, 12.0, 26.0, planet=False), 0, "pan", "L", speed=0.6, box=[1, 1, 13, 13])
    # mission console row with crew seats
    S += liven(console_x(8.0, 52.0, T + 1.0, acc), 0, "blink", "*")
    S += liven(console_x(58.0, 96.0, T + 1.0, acc, h=7.0, seed=12), 0, "blink", "*")
    for cx in (18.0, 34.0, 68.0, 84.0):
        S += crew_seat(cx, T + 12.0, "N")
    # W wall: data racks + mission data panel; holo table in the front-right corner
    S += liven(server_bank_y(T + 0.2, 20.0, 46.0, accent=acc), 0, "blink", "R")
    S += liven(holo_screen_y(T, 52.0, 78.0, 10.0, 22.0, acc, content="graph"), 0, "pan", "R", speed=2, box=[1, 1, 25, 11])
    S += storage_crate(T + 1.0, D - 14.0)
    S += liven(liven(holo_table(W - 14.0, D - 14.0, accent=acc, kind="ship"), [3, 4], "holo", "*"), 2, "pulse", "*")
    S += potted_alien_plant(W - 6.0, T + 9.0, seed=1)
    return S


# ------------------------------------------------------------------ PLAN: navigation room
def interior_plan(W, D, slab):
    acc = BLUE
    area = (1.05 * U + 1, 1.1 * U - 4, W - 1.05 * U - 2, 2.95 * U + 6)
    base = bulkhead_wall(acc)

    def wall(which, u, z):
        if which == "W":
            return base(which, u, z) if z < 1.4 else rgb(METAL)
        return base(which, u, z)
    S = room_shell(W, D, slab, deck_floor(acc, area), wall,
                   trim=METAL_L, side="#434b57", side_dark="#363d48",
                   name="PLAN", plate="#0b1a24", ink="#dbe6ff", plate_edge=acc, wall_h_w=11.0)
    T = WALL_T
    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col=METAL_D, edge=acc)
    S += airlock_door_x(dx, D - 0.6, 22.0, acc)
    S += entrance_steps("S", (dx, D), slab, col="#6b7584")
    # glowing strip along the low W partition
    S.append(box(0, T, 11.0, T + 0.2, D, 11.6, glow(acc)))

    S += raised_letters_x("PLAN", 6.0, T, 18.0, col=acc, px=0.8)
    S += liven(holo_screen_x(46.0, 100.0, T, 10.5, 27.5, acc, content="starmap"), 0, "pan", "L", speed=0.8, box=[1, 1, 53, 16])
    S += liven(viewport_x(103.0, 113.0, T, 12.0, 26.0, planet=True), 0, "pan", "L", speed=0.4, box=[1, 1, 9, 13])
    S += liven(console_x(48.0, 98.0, T + 1.0, acc, h=7.0, seed=31), 0, "blink", "*")
    for cx in (58.0, 74.0, 90.0):
        S += crew_seat(cx, T + 12.0, "N", col="#8fa6d9")
    # planet hologram on a projector in the NW corner, nav charts on the low partition side
    S += liven(liven(holo_table(14.0, 16.0, r=5.4, accent=acc, kind="planet"), [3, 4], "holo", "*"), 2, "pulse", "*")
    S += liven(holo_screen_y(T, 40.0, 66.0, 2.0, 10.0, acc, content="list", seed=33), 0, "pan", "R", axis="v", speed=1.2, box=[1, 1, 25, 7])
    S += storage_crate(T + 1.0, 72.0, w=6.0, d=8.0, h=5.0, col="#3f5a8c")
    S += potted_alien_plant(8.0, D - 8.0, seed=4)
    S += translate(_periscope(), W - 14.0, D - 12.0)
    return S


def _periscope():
    return [vcyl(0, 0, 2.4, 0, 1.0, flat(METAL_D), sides=8),
            vcyl(0, 0, 1.0, 1.0, 14.0, flat(METAL_L), sides=8),
            box(-1.4, -1.4, 12.0, 3.4, 1.4, 15.0, flat(METAL)),
            box(3.4, -1.0, 12.6, 3.6, 1.0, 14.4, glow(BLUE)),
            hcyl("y", -1.2, 10.0, 0.4, -4.0, 4.0, flat(METAL_D), sides=6)]


# ------------------------------------------------------------------ BUILD: engineering bay
def reactor_core(cx, cy, h=26.0, accent=ORANGE):
    S = [vcyl(cx, cy, 6.0, 0, 3.0, flat(METAL), sides=12),
         vcyl(cx, cy, 6.2, 2.4, 3.0, glow(HAZ), sides=12)]

    def core(p, n):
        k = math.sin(p[2] * 1.3) * 0.5 + 0.5
        return (mix(rgb(accent), rgb("#fff1c8"), k * 0.6), True)
    S.append(vcyl(cx, cy, 3.0, 3.0, h - 3.0, core, sides=10))
    for z in (6.0, 11.5, 17.0):
        S.append(vcyl(cx, cy, 4.4, z, z + 1.4, flat(METAL_L), sides=12))
    for (dx, dy) in ((-4.0, 0), (4.0, 0), (0, -4.0), (0, 4.0)):
        S.append(box(cx + dx - 0.5, cy + dy - 0.5, 3.0, cx + dx + 0.5, cy + dy + 0.5, h - 3.0, flat(METAL_D)))
    S.append(vcyl(cx, cy, 5.0, h - 3.0, h, flat(METAL), sides=12))
    S.append(vcyl(cx, cy, 2.0, h, h + 0.6, glow(accent), sides=10))
    return S


def robot_arm(cx, cy, accent=ORANGE):
    """Industrial arm on a base: shoulder, elbow, wrist with a glowing welder tip (reaches +x)."""
    S = [vcyl(cx, cy, 3.4, 0, 2.4, flat(METAL_D), sides=10),
         vcyl(cx, cy, 2.4, 2.4, 5.0, flat(accent), sides=10)]
    pts = [(cx, cy, 5.0), (cx + 2.0, cy, 14.0), (cx + 10.0, cy, 15.5), (cx + 13.0, cy, 10.0)]
    for (a, b) in zip(pts, pts[1:]):
        n_ = 6
        for i in range(n_):
            t0 = i / n_
            x = a[0] + (b[0] - a[0]) * t0
            z = a[2] + (b[2] - a[2]) * t0
            S.append(blob(x, cy, z, 1.2, flat(accent if i % 3 else HAZ_D), n=10))
        S.append(blob(b[0], cy, b[2], 1.6, flat(METAL_D), n=12))
    S.append(blob(cx + 13.4, cy, 8.8, 0.9, glow("#fff6c8"), n=10))
    for k in range(5):
        S.append(blob(cx + 13.6 + (k - 2) * 0.7, cy + (k % 2) * 0.6 - 0.3, 7.6 - k * 0.3, 0.3, glow(HAZ), n=6))
    return S


def fabricator(x0, y0, accent=ORANGE):
    """3D fabricator cabinet (front faces +y) with a glowing build bed and half-printed part."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and 3.0 < p[2] < 11.0 and x0 + 1.0 < p[0] < x0 + 11.0:
            return (rgb("#16262e"), True)
        if f == "L" and 12.0 < p[2] < 13.0:
            return (rgb(accent), True)
        return rgb(METAL_L) if f == "L" else rgb(METAL)
    S = [box(x0, y0, 0, x0 + 12.0, y0 + 8.0, 15.0, m)]
    S.append(box(x0 + 2.0, y0 + 7.6, 3.4, x0 + 10.0, y0 + 8.2, 3.8, glow(accent)))
    S.append(box(x0 + 4.0, y0 + 7.4, 3.8, x0 + 8.0, y0 + 8.0, 7.0, glow("#ffd6a8")))
    return S


def tool_rack_y(x, y0, y1):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(METAL_D)
        uu, zz = y1 - p[1], p[2]
        if int(uu * 1.3) % 2 == 0 and int(zz * 1.3) % 2 == 0:
            return rgb("#3a414c")
        for k, (u0, z0, z1, c) in enumerate(((3, 4, 11, ORANGE), (7, 6, 12, "#c9d1da"), (11, 5, 10, RED),
                                             (15, 7, 12, "#c9d1da"), (19, 4, 9, HAZ))):
            if abs(uu - u0) < 0.6 and z0 < zz < z1:
                return rgb(c)
            if abs(uu - u0) < 1.4 and abs(zz - z1) < 0.8:
                return rgb(c)
        return rgb("#2f3640")
    return [box(x, y0, 2.0, x + 0.8, y1, 13.0, m)]


def parts_bins(x0, y0):
    S = []
    for i in range(4):
        c = (ORANGE, "#3f6e8c", HAZ, "#5b6573")[i]
        S.append(box(x0 + i * 4.4, y0, 0, x0 + i * 4.4 + 4.0, y0 + 5.0, 4.0, flat(c)))
        S.append(box(x0 + i * 4.4 + 0.6, y0 + 0.6, 4.0, x0 + i * 4.4 + 3.4, y0 + 4.4, 4.6, flat("#aab4bf")))
    return S


def interior_build(W, D, slab):
    acc = ORANGE
    area = (1.05 * U - 1, 1.1 * U - 4, W - 1.05 * U + 1, 3.15 * U + 5)
    S = room_shell(W, D, slab, deck_floor(acc, area), bulkhead_wall(acc, low=True),
                   trim=METAL_L, side="#434b57", side_dark="#363d48",
                   wall_h=12.5, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    S += airlock_door_x(dx, 0.6, 18.0, acc, out=-1)
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col=METAL_D, edge=acc)
    S += entrance_steps("N", (dx, 0), slab, col="#6b7584")

    S += liven(console_x(6.0, dx - DOOR_HALF - 2.0, T + 1.0, acc, seed=41), 0, "blink", "*")
    S += liven(fabricator(dx + DOOR_HALF + 3.0, T + 0.6), [1, 2], "pulse", "*")
    S += liven(liven(reactor_core(W - 12.0, 14.0), 2, "pan", "*", axis="v", speed=-5), -1, "pulse", "*")
    S += robot_arm(T + 8.0, 40.0)
    S += tool_rack_y(T, 52.0, 76.0)
    S += parts_bins(8.0, D - 10.0)
    S += storage_crate(30.0, D - 9.0, col="#7a5a3c")
    S += led_signboard_y(W - 2.2, 34.0, 76.0, "BUILD", acc)
    return S


# ------------------------------------------------------------------ REVIEW: science lab
def specimen_tube(cx, cy, h=14.0, liquid=GREEN, seed=0):
    S = [vcyl(cx, cy, 2.6, 0, 2.0, flat(METAL), sides=10),
         vcyl(cx, cy, 2.6, h - 1.4, h, flat(METAL), sides=10)]

    def liq(p, n):
        if hash2(int(p[0] * 2), int(p[2] * 1.5), seed) > 0.93:
            return (rgb("#ffffff"), True)                     # bubbles
        return (mix(rgb(liquid), rgb("#0b1a24"), 0.25), True)
    S.append(vcyl(cx, cy, 2.0, 2.0, h - 1.4, liq, sides=10))
    S.append(blob(cx, cy, h * 0.5, 1.0, flat("#2b4a3a" if liquid == GREEN else "#3a2b4a"), n=10, squash=1.4))
    return S


def microscope_bench(x0, y0, w=18.0, d=7.0):
    S = [box(x0, y0, 6.8, x0 + w, y0 + d, 7.8, flat(METAL_L)),
         box(x0 + 0.5, y0 + 0.5, 0, x0 + 2.0, y0 + d - 0.5, 6.8, flat(METAL_D)),
         box(x0 + w - 2.0, y0 + 0.5, 0, x0 + w - 0.5, y0 + d - 0.5, 6.8, flat(METAL_D))]
    mx = x0 + 5.0
    S += [box(mx - 1.5, y0 + 2.0, 7.8, mx + 1.5, y0 + 4.6, 8.4, flat(METAL_D)),
          box(mx - 0.4, y0 + 2.4, 8.4, mx + 0.4, y0 + 3.2, 13.0, flat(METAL_D)),
          box(mx - 0.5, y0 + 2.6, 12.0, mx + 0.5, y0 + 5.4, 12.8, flat(METAL_L)),
          box(mx - 1.0, y0 + 4.0, 9.4, mx + 1.0, y0 + 5.6, 9.8, glow(VIOLET))]
    for k in range(4):
        S.append(vcyl(x0 + 10.0 + k * 1.8, y0 + 3.4, 0.6, 7.8, 10.0, glow((GREEN, VIOLET, CYAN, HAZ)[k]), sides=6))
    return S


def scanner_arch_x(cx, cy, accent=VIOLET):
    S = [box(cx - 7.0, cy - 1.2, 0, cx - 5.6, cy + 1.2, 16.0, flat(METAL)),
         box(cx + 5.6, cy - 1.2, 0, cx + 7.0, cy + 1.2, 16.0, flat(METAL)),
         box(cx - 7.0, cy - 1.2, 16.0, cx + 7.0, cy + 1.2, 17.6, flat(METAL))]
    S.append(box(cx - 5.6, cy - 0.3, 1.0, cx - 5.2, cy + 0.3, 15.6, glow(accent)))
    S.append(box(cx + 5.2, cy - 0.3, 1.0, cx + 5.6, cy + 0.3, 15.6, glow(accent)))
    S.append(box(cx - 5.2, cy - 0.15, 9.0, cx + 5.2, cy + 0.15, 9.3, glow(accent)))   # scan line
    return S


def review_screen_y(x, y0, y1, z0, z1, accent=VIOLET, name="REVIEW"):
    w, h = y1 - y0, z1 - z0
    tw = len(name) * 6 - 1

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(METAL_D)
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 0.8 or uu > w - 0.8 or vv < 0.8 or vv > h - 0.8:
            return (rgb(accent), True)
        if vv > h - 10.0:
            if text7(name, uu, vv, round(w / 2 - tw / 2), h - 1.6, slope=-1):
                return (rgb("#ffffff"), True)
            return (mix(rgb(accent), rgb("#0b1a24"), 0.45), True)
        # scan result: waveform + pass ticks
        yv = (h - 10.0) * 0.55 + math.sin(uu * 0.7) * 2.0 * math.sin(uu * 0.13)
        if abs(vv - yv) < 0.45:
            return (rgb(GREEN), True)
        if vv < 3.0 and 1.5 < uu < w - 1.5:
            k = int((uu - 1.5) // 4.0)
            if (uu - 1.5) % 4.0 < 2.4 and 1.0 < vv < 2.4:
                return (rgb(GREEN) if hash2(k, 1, 61) > 0.2 else rgb(RED), True)
        return (rgb("#0b1a24"), True)
    S = [box(x - 0.5, y0, z0, x + 0.4, y1, z1, m)]
    for y in (y0 + 3.0, y1 - 4.0):
        S.append(box(x - 0.6, y, 0, x + 0.6, y + 1.2, z0, flat(METAL_D)))
    return S


def interior_review(W, D, slab):
    acc = VIOLET
    area = (1.05 * U - 2, 1.1 * U - 5, W - 1.05 * U + 2, 3.15 * U + 5)
    S = room_shell(W, D, slab, deck_floor(acc, area), bulkhead_wall(acc, low=True),
                   trim=METAL_L, side="#434b57", side_dark="#363d48",
                   wall_h=13.0, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    S += airlock_door_x(dx, 0.6, 18.0, acc, out=-1)
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col=METAL_D, edge=acc)
    S += entrance_steps("N", (dx, 0), slab, col="#6b7584")

    for i, cx in enumerate((dx + DOOR_HALF + 6.0, dx + DOOR_HALF + 13.0, dx + DOOR_HALF + 20.0, dx + DOOR_HALF + 27.0)):
        S += liven(specimen_tube(cx, T + 4.0, liquid=(GREEN, VIOLET, CYAN, GREEN)[i], seed=i), 2, "bubbles", "*")
    S += microscope_bench(8.0, T + 0.6, w=dx - DOOR_HALF - 12.0)
    S += storage_crate(T + 1.0, 30.0, w=6.0, d=7.0, col="#4a3a78")
    S += storage_crate(T + 1.0, 38.0, w=6.0, d=6.0, h=4.0, col="#5b6573")
    S += liven(holo_screen_y(T, 48.0, 72.0, 2.0, 11.0, acc, content="graph", seed=63), 0, "pan", "R", speed=2, box=[1, 1, 23, 8])
    S += liven(review_screen_y(W - 2.2, 22.0, 70.0, 9.0, 31.0, acc), 0, "wave", "R", color=GREEN, box=[1, 10, 47, 19])
    S += potted_alien_plant(T + 6.0, D - 8.0, seed=7)
    S += _sample_cart(W - 30.0, D - 12.0)
    return S


def _sample_cart(x0, y0):
    S = [box(x0, y0, 6.0, x0 + 12.0, y0 + 6.0, 6.8, flat(METAL_L)),
         box(x0, y0, 1.6, x0 + 12.0, y0 + 6.0, 2.2, flat(METAL_L))]
    for (dx, dy) in ((0.4, 0.4), (11.0, 0.4), (0.4, 5.0), (11.0, 5.0)):
        S.append(box(x0 + dx, y0 + dy, 0.6, x0 + dx + 0.6, y0 + dy + 0.6, 6.0, flat(METAL_D)))
    for k in range(5):
        S.append(vcyl(x0 + 1.6 + k * 2.2, y0 + 3.0, 0.7, 6.8, 9.0, glow((GREEN, VIOLET, CYAN, HAZ, GREEN)[k]), sides=6))
    return S


# ------------------------------------------------------------------ IDLE: crew lounge + hydroponics
def food_dispenser(x0, y0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "L":
            if 14.0 < p[2] < 22.0 and x0 + 1.5 < p[0] < x0 + 8.5:
                k = int((p[2] - 14.0) // 2.0)
                return (rgb((HAZ, GREEN, RED, CYAN)[k % 4]), True) if (p[0] - x0) % 3.5 < 2.8 else (rgb("#0b1a24"), True)
            if 6.0 < p[2] < 10.0 and x0 + 2.5 < p[0] < x0 + 7.5:
                return rgb("#0b1a24")
        return rgb(METAL_L) if f == "L" else rgb(METAL)
    return [box(x0, y0, 0, x0 + 10.0, y0 + 6.0, 26.0, m)]


def lounge_sofa_x(cx, cy, w=22.0, col="#3a7a6a"):
    c = rgb(col)
    return [box(cx - w / 2, cy - 4.0, 0, cx + w / 2, cy + 4.0, 4.4, flat(c * 1.04)),
            box(cx - w / 2, cy + 2.0, 4.4, cx + w / 2, cy + 4.0, 9.0, flat(c * 0.9)),
            box(cx - w / 2 - 2.0, cy - 4.0, 0, cx - w / 2, cy + 4.0, 6.4, flat(c * 0.84)),
            box(cx + w / 2, cy - 4.0, 0, cx + w / 2 + 2.0, cy + 4.0, 6.4, flat(c * 0.84)),
            box(cx - w / 2, cy - 4.2, 0.4, cx + w / 2, cy - 4.0, 0.9, glow(GREEN))]


def round_table(cx, cy, r=3.4):
    return [vcyl(cx, cy, 1.0, 0, 6.4, flat(METAL_D), sides=6),
            vcyl(cx, cy, r, 6.4, 7.2, flat(METAL_L), sides=12),
            vcyl(cx, cy, r * 0.9, 7.2, 7.3, glow(GREEN), sides=12)]


def pod_chair(cx, cy, col="#e9eef2"):
    return [vcyl(cx, cy, 0.5, 0, 2.0, flat(METAL_D), sides=6),
            blob(cx, cy, 5.0, 3.0, flat(col), n=18, squash=0.9),
            blob(cx + 0.8, cy + 0.8, 5.4, 2.0, flat("#3a7a6a"), n=12)]


def arcade(x0, y0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "L":
            if 12.0 < p[2] < 18.0 and x0 + 1.0 < p[0] < x0 + 7.0:
                k = int((p[0] - x0) * 1.5) + int(p[2] * 1.5)
                return (rgb((VIOLET, CYAN, HAZ, "#0b1a24")[k % 4]), True)
            if 21.0 < p[2] < 23.0:
                return (rgb(RED), True)
            if 9.0 < p[2] < 10.4:
                return rgb("#1e242c")
        return rgb("#3a2b5e") if f == "L" else rgb("#2c2148")
    S = [box(x0, y0, 0, x0 + 8.0, y0 + 6.0, 24.0, m)]
    S.append(blob(x0 + 3.0, y0 + 6.4, 10.6, 0.6, flat(RED), n=8))
    return S


def interior_idle(W, D, slab):
    acc = GREEN
    area = (1.5 * U, 1.6 * U, W - 1.5 * U, D - 2.1 * U)

    def wall(which, u, z):
        if which == "W":
            return bulkhead_wall(acc, low=True)(which, u, z) if z < 9.6 else rgb(METAL_L)
        return bulkhead_wall(acc)(which, u, z)
    door_y = (6.3 - 1.2) * U
    S = room_shell(W, D, slab, deck_floor(acc, area, a="#36404a", b="#323b45"), wall,
                   trim=METAL_L, side="#434b57", side_dark="#363d48",
                   wall_h_w=9.6, door_w=(door_y - DOOR_HALF, door_y + DOOR_HALF))
    T = WALL_T
    S += airlock_door_y(0.6, door_y, 18.0, acc)
    S += doormat(T + 0.4, door_y - 6.5, T + 7.0, door_y + 6.5, col=METAL_D, edge=acc)
    S += entrance_steps("W", (door_y, 0), slab, n_steps=1, col="#6b7584")

    # N wall: hydroponic garden racks, food dispensers, big viewport, IDLE letters
    S += grow_light_rack_x(6.0, 60.0, T + 0.2)
    S += food_dispenser(64.0, T + 0.4)
    S += food_dispenser(76.0, T + 0.4)
    S += viewport_x(92.0, 142.0, T, 10.0, 27.0, planet=True)
    S += raised_letters_x("IDLE", 148.0, T, 16.0, col=acc, px=0.8)
    S += arcade(W - 11.0, 34.0)
    # dining: round tables with pod chairs along the N side
    for i, tx in enumerate((104.0, 128.0)):
        S += round_table(tx, T + 16.0)
        S += pod_chair(tx - 6.0, T + 16.0)
        S += pod_chair(tx + 6.0, T + 16.0)
    # W side: lounge sofas facing the room, alien plants
    S += potted_alien_plant(T + 6.0, T + 8.0, seed=2, h=14.0)
    S += translate(_side_sofa(), T + 0.4, 40.0)
    S += translate(_side_sofa(), T + 0.4, door_y + DOOR_HALF + 18.0)
    S += potted_alien_plant(T + 6.0, D - 8.0, seed=5)
    # E side: hydro pods + bean pods; front: sofa + low table
    from space_props import hydro_pod
    for (yy, k) in ((70.0, 0), (110.0, 1), (150.0, 2)):
        S += translate(hydro_pod(), W - 10.0, yy)
    S += lounge_sofa_x(56.0, D - 12.0, col="#3a7a6a")
    S += [box(46.0, D - 26.0, 0, 66.0, D - 20.0, 4.0, flat(METAL_L)),
          box(47.0, D - 25.4, 4.0, 65.0, D - 20.6, 4.2, glow(GREEN))]
    S += potted_alien_plant(W - 7.0, D - 8.0, seed=8)
    return S


def _side_sofa():
    c = rgb("#3a7a6a")
    return [box(0, 0, 0, 9.0, 24.0, 4.4, flat(c * 1.04)),
            box(0, 0, 4.4, 3.0, 24.0, 9.4, flat(c * 0.9)),
            box(0, -2.0, 0, 9.0, 0, 6.6, flat(c * 0.84)),
            box(0, 24.0, 0, 9.0, 26.0, 6.6, flat(c * 0.84)),
            box(9.0, 0, 0.4, 9.2, 24.0, 0.9, glow(GREEN))]


SPACE_INTERIORS = {
    z: (fn,) + tuple(CITY_INTERIORS[z][1:])
    for z, fn in (("specs", interior_specs), ("plan", interior_plan), ("build", interior_build),
                  ("review", interior_review), ("idle", interior_idle))
}


def build(zid):
    fn, gw, gh, elev_px = SPACE_INTERIORS[zid]
    return fn(gw * U, gh * U, elev_px / 2.0)


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    for zid in (sys.argv[1:] or SPACE_INTERIORS):
        LIVE.clear()  # parts the board animates while an agent works here (tagged with liven())
        S = build(zid)
        im, anchor = render(S, ground_shadow=0)
        name = f"space_interior_{zid}"
        save_room(im, anchor, S, name, man, U)
        print(name, im.size, anchor, flush=True)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
