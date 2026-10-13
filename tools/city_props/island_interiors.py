"""
Zone interiors for the Island theme (tropical resort). Same conventions as
interiors.py: world origin = zone footprint NW corner at floor level, x along gx,
y along gy, z up, U units per grid cell; only the N and W back walls are built.

Run: python3 island_interiors.py [zone ...]  -> out/island_interior_<zone>.png + manifest
"""
import json, math, os, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, mix, hash2, render
from props import cone, flat
from interiors import (U, WALL_T, text7, emis, room_shell, doormat, entrance_steps,
                       door_frame_x, door_frame_y, DOOR_HALF, INTERIORS as CITY_INTERIORS)

# ------------------------------------------------------------------ resort palette
TEAK, TEAK_D, TEAK_L = "#8a5a32", "#5e3b20", "#b07a48"
STRAW, STRAW_D, STRAW_L = "#d9b26a", "#b48a46", "#ecd08e"
PLASTER, PLASTER_D = "#f4eee1", "#e8e0cf"
LAGOON, LAGOON_D = "#2bb3b1", "#1a7f86"
CORAL, HIBISCUS, SUN = "#f06e5a", "#e8436a", "#f7c548"
STONE, STONE_D = "#cdb68e", "#a8906a"


def leafy(seed, lo="#2e7d3a", mid="#3f9a48", hi="#69c35c"):
    def m(p, n):
        h = hash2(int(p[0] / 1.4), int(p[1] / 1.4) + int(p[2] / 1.4) * 7, seed)
        return rgb(lo) if h < 0.3 else (rgb(hi) if h > 0.78 else rgb(mid))
    return m


def weave(u, z, light=STRAW, dark=STRAW_D, s=1.3):
    """Basket weave for rattan / woven panels."""
    a, b = int(u // s), int(z // s)
    horiz = (a // 2 + b // 2) % 2
    c = rgb(light) if (a + b) % 2 == horiz else rgb(dark)
    return c


def potted_palm(cx, cy, h=17.0, spread=5.6, seed=0, pot=CORAL, lean=0.35):
    """Indoor palm in a terracotta pot."""
    S = [vcyl(cx, cy, 3.0, 0, 4.6, flat(pot), sides=8),
         vcyl(cx, cy, 3.4, 4.0, 5.2, flat(rgb(pot) * 0.86), sides=8),
         vcyl(cx, cy, 2.7, 5.2, 5.4, flat("#5d4330"), sides=8)]
    x, y = cx, cy
    n = 6
    seg = (h - 5.4) / n
    for k in range(n):
        z0 = 5.4 + k * seg
        S.append(vcyl(x, y, 0.85 - k * 0.05, z0, z0 + seg + 0.2,
                      flat("#9c7a52" if k % 2 else "#83613f"), sides=6))
        x += 0.3 * lean
        y -= 0.15 * lean
    fr = leafy(seed)
    for a in range(7):
        ang = a * 2 * math.pi / 7 + 0.4 + seed
        for k, (dist, dz, rr) in enumerate(((spread * 0.35, 0.4, 1.7), (spread * 0.7, -1.0, 1.5), (spread, -2.8, 1.2))):
            S.append(blob(x + math.cos(ang) * dist, y + math.sin(ang) * dist, h + dz, rr, fr,
                          n=12, squash=0.45, seed=seed + a * 3 + k))
    S.append(blob(x, y, h + 0.8, 1.7, fr, n=12, squash=0.7, seed=seed + 40))
    return S


def flower_box_x(x0, x1, y0, d=5.0, h=5.0, seed=0):
    def planter(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#5d4330")
        return weave(p[0], p[2], TEAK_L, TEAK, 1.1)
    S = [box(x0, y0, 0, x1, y0 + d, h, planter)]
    k = 0
    x = x0 + 2.5
    while x < x1 - 2:
        S.append(blob(x, y0 + d / 2 + (0.6 if k % 2 else -0.6), h + 1.6, 2.4, leafy(seed + k), n=16, seed=seed + k))
        col = (HIBISCUS, SUN, CORAL, "#ffffff")[k % 4]
        S.append(blob(x + 0.8, y0 + d / 2 + 1.2, h + 3.1, 0.8, flat(col), n=10))
        S.append(blob(x - 1.1, y0 + d / 2 - 0.4, h + 2.8, 0.7, flat(col), n=10))
        x += 4.3
        k += 1
    return S


def rattan_sofa_y(x0, y0, y1, cushion="#efe3c8", pillow=LAGOON):
    """Rattan two-seater, back against the W wall, seat faces +x."""
    def frame(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(STRAW_L)
        return weave(u, p[2], STRAW, STRAW_D, 1.0)

    def cush(p, n):
        f, u, v = face_uv(p, n)
        k = int((p[1] - y0) // ((y1 - y0) / 2))
        return rgb(cushion) * (1.04 if f == "top" else 0.97) * (0.96 if k % 2 else 1.0)
    S = [box(x0, y0, 0, x0 + 9.5, y1, 3.6, frame),
         box(x0 + 0.5, y0 + 0.3, 3.6, x0 + 9.2, y1 - 0.3, 5.0, cush),
         box(x0, y0, 3.6, x0 + 2.6, y1, 11.0, frame),
         box(x0 + 2.6, y0 + 0.6, 5.0, x0 + 4.0, y1 - 0.6, 9.6, cush),
         box(x0, y0 - 2.0, 0, x0 + 9.5, y0, 7.5, frame),
         box(x0, y1, 0, x0 + 9.5, y1 + 2.0, 7.5, frame)]
    for (py, col) in ((y0 + 3.2, pillow), (y1 - 3.2, CORAL)):
        S.append(box(x0 + 3.6, py - 2.2, 5.0, x0 + 5.4, py + 2.2, 8.6, flat(col)))
    return S


# ------------------------------------------------------------------ SPECS: concierge desk
def concierge_counter(x0, x1, y0, y1, h=9.5):
    def front(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(TEAK)
        if p[2] < 1.0:
            return rgb(TEAK_D)
        if p[2] > h - 1.2:
            return rgb(TEAK_L)
        # framed rattan panels
        if f == "L":
            k = (p[0] - x0) % 10.0
            if k < 1.1:
                return rgb(TEAK)
            return weave(p[0], p[2], STRAW, STRAW_D, 1.1)
        return weave(-p[1], p[2], STRAW, STRAW_D, 1.1) * 0.95

    def top(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            g = int(p[1] * 1.3) % 3
            return rgb(TEAK_L) * (0.95 if g == 0 else 1.0)
        return rgb(TEAK_D)
    return [box(x0, y0, 0, x1, y1, h, front),
            box(x0 - 0.8, y0 - 0.5, h, x1 + 0.8, y1 + 0.9, h + 1.0, top)]


def typewriter(x0, y0, z):
    body = flat("#2f6b5a")

    def keys(p, n):
        f, u, v = face_uv(p, n)
        if f == "top" or f == "L":
            if int(p[0] * 1.6) % 2 and int(p[1] * 1.6) % 2:
                return rgb("#f4efe2")
            return rgb("#1e2a26")
        return rgb("#244f43")

    def paper(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and 0.8 < (p[0] - x0 - 1.4) < 3.6 and int(p[2] * 1.4) % 2 == 0 and p[2] > z + 4:
            return rgb("#8a8f96")
        return rgb("#fbfaf4")
    return [box(x0, y0, z, x0 + 7.0, y0 + 5.0, z + 1.8, body),
            box(x0 + 0.6, y0 + 2.2, z + 1.8, x0 + 6.4, y0 + 4.6, z + 2.4, keys),
            hcyl("x", y0 + 1.3, z + 2.6, 1.0, x0 - 0.4, x0 + 7.4, flat("#1e2a26"), sides=8),
            box(x0 + 1.4, y0 + 0.9, z + 3.0, x0 + 5.6, y0 + 1.3, z + 7.2, paper)]


def service_bell(cx, cy, z):
    gold = flat("#e2b84a")
    return [vcyl(cx, cy, 1.5, z, z + 0.5, flat("#7a5a2a"), sides=10),
            blob(cx, cy, z + 0.6, 1.25, gold, n=18, squash=0.85),
            vcyl(cx, cy, 0.3, z + 1.6, z + 2.3, gold, sides=6)]


def guest_book(x0, y0, z):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            if abs(p[0] - (x0 + 4.0)) < 0.35:
                return rgb("#c8beaa")
            if abs(p[0] - (x0 + 5.4)) < 0.4 and p[1] > y0 + 2.0:
                return rgb(HIBISCUS)        # ribbon
            if int((p[1] - y0) * 1.5) % 2 == 0 and 0.8 < (p[0] - x0) % 4.0 < 3.4:
                return rgb("#9aa0a8")
            return rgb("#fbf7ec")
        return rgb("#7a2e3a")
    return [box(x0, y0, z, x0 + 8.0, y0 + 4.8, z + 0.7, m),
            box(x0 + 9.0, y0 + 1.2, z, x0 + 9.5, y0 + 4.2, z + 0.5, flat("#2b2b2b"))]


def flower_vase(cx, cy, z):
    S = [vcyl(cx, cy, 0.9, z, z + 2.8, flat(LAGOON), sides=8)]
    for (dx, dy, dz, col) in ((0, 0, 4.0, HIBISCUS), (0.9, 0.4, 3.4, SUN), (-0.8, 0.5, 3.5, HIBISCUS)):
        S.append(blob(cx + dx, cy + dy, z + dz, 0.85, flat(col), n=10))
    S.append(blob(cx - 0.2, cy - 0.6, z + 3.0, 1.0, leafy(5), n=10, squash=0.6))
    return S


def key_cubbies(x0, x1, y, z0, z1, cols=7, rows=3, seed=3):
    """Pigeonhole key rack on the N wall (face L)."""
    cw, rh = (x1 - x0) / cols, (z1 - z0) / rows

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(TEAK_D)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.9 or uu > (x1 - x0) - 0.9 or vv < 0.9 or vv > (z1 - z0) - 0.9:
            return rgb(TEAK)
        c, r = int(uu // cw), int(vv // rh)
        cu, cv = uu - c * cw, vv - r * rh
        if cu < 0.6 or cv < 0.6:
            return rgb(TEAK_L)
        has_key = hash2(c, r, seed) > 0.3
        has_mail = hash2(c, r, seed + 9) > 0.72
        if has_mail and cv < rh * 0.55 and 0.9 < cu < cw - 0.4:
            return rgb("#f6f1e2") if cv < rh * 0.45 else rgb("#d8cfb8")
        if has_key and abs(cu - cw / 2) < 0.5 and rh * 0.25 < cv < rh * 0.8:
            return rgb("#f2c94c") if cv > rh * 0.6 else rgb("#d9a93a")
        return rgb("#3b2616")
    return [box(x0, y, z0, x1, y + 1.6, z1, m)]


def carved_sign_x(x0, x1, y, z0, z1, name, icon="bell"):
    """Carved teak name board on the N wall (face L) with a gold icon + cream letters."""
    tw = len(name) * 6 - 1
    tx = x0 + (x1 - x0 - tw) / 2 + 3.5
    zt = z0 + (z1 - z0) / 2 + 3.5

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(TEAK_L)
        if f != "L":
            return rgb(TEAK_D)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.9 or uu > (x1 - x0) - 0.9 or vv < 0.9 or vv > (z1 - z0) - 0.9:
            return rgb("#d6a35a")
        if icon == "bell":
            ic, iz = 4.6, (z1 - z0) / 2
            dx, dz = uu - ic, vv - iz
            if -2.4 <= dz <= -1.6 and abs(dx) < 2.6:
                return (rgb("#f2c94c"), True)
            if -1.6 < dz < 1.6 and dx * dx + (dz + 1.6) ** 2 < 2.4 ** 2:
                return (rgb("#f2c94c"), True)
            if 1.6 <= dz < 2.6 and abs(dx) < 0.5:
                return (rgb("#f2c94c"), True)
        if icon == "drink":                      # cocktail glass with umbrella
            ic, iz = 4.6, (z1 - z0) / 2
            dx, dz = uu - ic, vv - iz
            if 0.0 < dz < 2.6 and abs(dx) < 2.6 - (2.6 - dz) * 0.9:
                return (rgb("#fbf1d6"), True)
            if -2.4 < dz <= 0.0 and abs(dx) < 0.45:
                return (rgb("#fbf1d6"), True)
            if -2.8 < dz <= -2.2 and abs(dx) < 1.6:
                return (rgb("#fbf1d6"), True)
            if 2.6 < dz < 3.6 and 0.4 < dx < 3.0:
                return (rgb(HIBISCUS), True)
        if icon == "compass":
            ic, iz = 4.6, (z1 - z0) / 2
            dx, dz = uu - ic, vv - iz
            r = math.hypot(dx, dz)
            if 2.3 < r < 3.1:
                return (rgb("#f2c94c"), True)
            if abs(dx) * 2.2 + abs(dz) < 2.3:
                return (rgb("#e8553f"), True) if dz > 0 else (rgb("#fbf1d6"), True)
        if text7(name, p[0], p[2], tx, zt, slope=1):
            return (rgb("#fbf1d6"), True)
        g = hash2(int(p[0] * 0.8), int(p[2] * 3), 17)
        return rgb("#6e4425") * (0.94 if g < 0.3 else 1.0)
    S = [box(x0, y, z0, x1, y + 1.2, z1, m)]
    # two rope hangers up to the wall top
    for hx in (x0 + 3, x1 - 3):
        S.append(box(hx - 0.3, y + 0.2, z1, hx + 0.3, y + 0.8, z1 + 3.0, flat("#c9a26a")))
    return S


def request_board_y(x, y0, y1, z0, z1, seed=4):
    """Cork pinboard of guest-request cards on the W wall (face R)."""
    W_ = y1 - y0
    cards = [(1.6, 6.6, 7.0, 11.6, "#fff3b0"), (8.0, 7.2, 13.6, 11.9, "#bde0fe"),
             (14.6, 6.4, 20.4, 11.4, "#ffd1dc"), (2.4, 1.4, 8.6, 5.6, "#caffbf"),
             (9.6, 1.2, 15.0, 6.0, "#ffffff"), (16.0, 1.6, 21.6, 5.4, "#fff3b0")]

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(TEAK_D)
        uu, vv = y1 - p[1], p[2] - z0
        if uu < 1.0 or uu > W_ - 1.0 or vv < 1.0 or vv > (z1 - z0) - 1.0:
            return rgb(TEAK)
        for i, (u0, v0, u1, v1, col) in enumerate(cards):
            if u0 <= uu <= u1 and v0 <= vv <= v1:
                if abs(uu - (u0 + u1) / 2) < 0.5 and vv > v1 - 1.0:
                    return rgb("#d63c3c")            # pin
                if vv < v1 - 1.4 and (v1 - 1.4 - vv) % 1.3 < 0.55 and u0 + 0.8 < uu < u1 - 0.8 - (i % 3):
                    return rgb("#6b7280")            # handwriting
                if i == 1 and u0 + 0.8 < uu < u0 + 1.8 and vv < v1 - 1.4 and (v1 - 1.4 - vv) % 1.3 < 0.55:
                    return rgb("#2bb07f")            # tick
                return rgb(col)
        h = hash2(int(uu * 1.5), int(vv * 1.5), seed)
        return rgb("#c79a62") if h > 0.25 else rgb("#b5874f")
    return [box(x, y0, z0, x + 0.9, y1, z1, m)]


def brochure_rack_y(x, y0, y1):
    S = [box(x, y0, 0, x + 1.4, y1, 14.0, flat(TEAK_D)),
         box(x, y0 - 0.8, 0, x + 5.0, y0, 14.0, flat(TEAK)),
         box(x, y1, 0, x + 5.0, y1 + 0.8, 14.0, flat(TEAK))]
    cols = [(LAGOON, "#ffffff"), (CORAL, SUN), (SUN, LAGOON_D), ("#6cc070", "#ffffff"),
            (HIBISCUS, "#ffe9a8"), ("#3a86c8", SUN)]
    k = 0
    for i, z in enumerate((1.0, 5.4, 9.8)):
        S.append(box(x + 1.4, y0, z, x + 5.0, y1, z + 0.6, flat(TEAK_L)))
        S.append(box(x + 4.2, y0, z + 0.6, x + 5.0, y1, z + 1.8, flat(TEAK_L)))
        n_ = 3
        bw = (y1 - y0) / n_
        for j in range(n_):
            a, b = cols[k % len(cols)]
            k += 1
            ya, yb = y0 + j * bw + 0.5, y0 + (j + 1) * bw - 0.5

            def bro(p, n, a=a, b=b, z=z):
                f, u, v = face_uv(p, n)
                if f == "R" and z + 2.0 < p[2] < z + 2.9:
                    return rgb(b)
                return rgb(a)
            S.append(box(x + 2.4, ya, z + 0.6, x + 3.5, yb, z + 4.2, bro))
    return S


def sunset_painting_y(x, y0, y1, z0, z1):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(TEAK_D)
        uu, vv = y1 - p[1], p[2] - z0
        w, h = y1 - y0, z1 - z0
        if uu < 1.0 or uu > w - 1.0 or vv < 1.0 or vv > h - 1.0:
            return rgb("#d6a35a")
        t = vv / h
        if vv < h * 0.42:
            c = mix(rgb("#1a6f8a"), rgb("#2bb3b1"), vv / (h * 0.42))
            if abs(uu - w * 0.62) < 1.6 - (h * 0.42 - vv) * 0.15 and int(vv * 2) % 2 == 0:
                return rgb("#ffd27a")               # sun glitter on the sea
            return c
        if math.hypot(uu - w * 0.62, vv - h * 0.48) < 2.3:
            return rgb("#ffe08a")
        # palm silhouette on the left
        if abs(uu - (3.2 + (vv - h * 0.42) * 0.25)) < 0.5 and vv < h * 0.86:
            return rgb("#2d2238")
        if vv > h * 0.8 and abs(uu - 4.8) < 2.6 - abs(vv - h * 0.86) * 1.2:
            return rgb("#2d2238")
        return mix(rgb("#ff9a62"), rgb("#b85a9c"), (t - 0.42) / 0.58)
    return [box(x, y0, z0, x + 0.8, y1, z1, m)]


def ocean_window_x(x0, x1, y, z0, z1):
    """Open window with louvred shutters looking out to sea (N wall, face L)."""
    def glass(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(PLASTER)
        if f != "L":
            return rgb(PLASTER_D)
        uu, vv = p[0] - x0, p[2] - z0
        w, h = x1 - x0, z1 - z0
        if uu < 1.0 or uu > w - 1.0 or vv < 1.0 or vv > h - 1.0:
            return rgb(TEAK)
        if abs(uu - w / 2) < 0.45:
            return rgb(TEAK)
        hz = h * 0.42
        if vv < hz:
            c = mix(rgb("#14798a"), rgb("#36c3c0"), vv / hz)
            if hash2(int(p[0] * 1.2), int(vv * 1.6), 31) < 0.08:
                return (rgb("#d9fbf6"), True)
            # small sail on the horizon
            if abs(uu - w * 0.72) < 0.6 and hz - 2.6 < vv < hz + 1.8:
                return (rgb("#ffffff"), True)
            return (c, True)
        if vv < hz + 0.5:
            return (rgb("#b8ecef"), True)
        t = (vv - hz) / (h - hz)
        c = mix(rgb("#bfeaf6"), rgb("#7fc9ec"), t)
        if 3 < uu < 9 and abs(vv - (h * 0.75)) < 0.9 - abs(uu - 6) * 0.15:
            return (rgb("#ffffff"), True)          # cloud
        return (c, True)

    def louvre(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(LAGOON_D)
        return rgb(LAGOON) if int(p[2] * 1.4) % 2 else rgb(LAGOON_D)
    S = [box(x0, y - 0.1, z0, x1, y + 0.3, z1, glass),
         box(x0, y, z0 - 1.0, x1, y + 2.4, z0, flat(TEAK_L))]   # sill
    # shutters hinged open against the wall on both sides
    S.append(box(x0 - 5.2, y, z0, x0 - 0.4, y + 0.8, z1, louvre))
    S.append(box(x1 + 0.4, y, z0, x1 + 5.2, y + 0.8, z1, louvre))
    return S


def luggage_cart(x0, y0):
    brass = flat("#d8aa45")
    S = [box(x0, y0, 1.6, x0 + 13.0, y0 + 8.0, 2.6, flat("#8e2b35")),   # carpeted deck
         box(x0 - 0.3, y0 - 0.3, 1.2, x0 + 13.3, y0 + 8.3, 1.6, brass)]
    for (wx, wy) in ((x0 + 1.2, y0 + 1.0), (x0 + 11.8, y0 + 1.0), (x0 + 1.2, y0 + 7.0), (x0 + 11.8, y0 + 7.0)):
        S.append(vcyl(wx, wy, 0.9, 0, 1.2, flat("#2b2b2b"), sides=6))
    for px in (x0 + 0.6, x0 + 12.4):
        S.append(vcyl(px, y0 + 4.0, 0.45, 2.6, 18.0, brass, sides=6))
    S.append(hcyl("x", y0 + 4.0, 18.0, 0.55, x0 + 0.2, x0 + 12.8, brass, sides=6))

    def case(col, strap):
        def m(p, n):
            f, u, v = face_uv(p, n)
            if f in ("L", "R") and abs(p[2] - strap) < 0.5:
                return rgb("#5e3b20")
            return rgb(col) * (1.06 if f == "top" else 1.0)
        return m
    S.append(box(x0 + 1.2, y0 + 1.0, 2.6, x0 + 6.8, y0 + 7.0, 10.0, case(LAGOON_D, 6.3)))
    S.append(box(x0 + 7.4, y0 + 1.6, 2.6, x0 + 11.8, y0 + 6.6, 7.6, case(CORAL, 5.1)))
    S.append(box(x0 + 2.0, y0 + 2.0, 10.0, x0 + 6.0, y0 + 6.0, 13.0, case("#e3c58f", 11.5)))
    S.append(box(x0 + 3.4, y0 + 3.6, 13.0, x0 + 4.6, y0 + 4.4, 13.8, flat("#5e3b20")))
    return S


def thatch_eave_x(x0, x1, y0, depth, z, drop=3.2):
    def m(p, n):
        f, u, v = face_uv(p, n)
        k = hash2(int(p[0] * 1.6), int(p[2] * 2.2), 51)
        if f == "top":
            return rgb(STRAW_L) if k > 0.3 else rgb(STRAW)
        base = rgb(STRAW) if (int(p[0] * 1.3) % 3) else rgb(STRAW_D)
        if p[2] < z - drop + 0.8:
            return rgb(STRAW_D) * 0.9      # ragged fringe
        return base * (0.95 if k < 0.25 else 1.0)
    return [box(x0, y0, z - drop, x1, y0 + depth, z + 1.4, m)]


def thatch_eave_y(x0, y0, y1, depth, z, drop=3.2):
    def m(p, n):
        f, u, v = face_uv(p, n)
        k = hash2(int(p[1] * 1.6), int(p[2] * 2.2), 52)
        if f == "top":
            return rgb(STRAW_L) if k > 0.3 else rgb(STRAW)
        base = rgb(STRAW) if (int(p[1] * 1.3) % 3) else rgb(STRAW_D)
        if p[2] < z - drop + 0.8:
            return rgb(STRAW_D) * 0.9
        return base * (0.95 if k < 0.25 else 1.0)
    return [box(x0, y0, z - drop, x0 + depth, y1, z + 1.4, m)]


def resort_floor_planks(rug=None, rug_fn=None):
    def floor(p):
        x, y = p[0], p[1]
        if rug and rug[0] <= x <= rug[2] and rug[1] <= y <= rug[3]:
            return rug_fn(x, y)
        row = int(y // 3.9)
        off = (row * 7.3) % 18.0
        seg = int((x + off) // 18.0)
        if y % 3.9 < 0.4 or (x + off) % 18.0 < 0.4:
            return rgb("#7a4e2a")
        h = hash2(seg, row, 61)
        c = rgb("#c08a52") if h > 0.66 else (rgb("#b47e48") if h > 0.33 else rgb("#c9955c"))
        if hash2(int(x * 1.1), row, 62) < 0.08:
            c = c * 0.93                          # grain
        return c
    return floor


def resort_wall(z_wains=10.0, wall_top=30.0):
    def wall(which, u, z):
        if z < 1.2:
            return rgb(TEAK_D)
        if z < z_wains:
            # vertical bamboo poles with node rings
            k = u % 2.4
            if k < 0.35:
                return rgb("#8c6a34")
            c = rgb("#d4b06a") if int(u // 2.4) % 2 else rgb("#c9a45e")
            if abs((z + int(u // 2.4) * 1.7) % 4.2 - 2.1) < 0.3:
                return c * 0.8
            if k > 1.9:
                return c * 0.9
            return c
        if z < z_wains + 0.9:
            return rgb(TEAK)
        if z > wall_top - 1.0:
            return rgb(TEAK)
        h = hash2(int(u * 1.3), int(z * 1.3), 63)
        return rgb(PLASTER) if h > 0.12 else rgb(PLASTER_D)
    return wall


def interior_specs(W, D, slab):
    # woven seagrass rug where the agents gather
    rug = (1.05 * U + 2, 1.15 * U - 2, W - 1.05 * U - 3, 3.05 * U + 4)

    def rug_fn(x, y):
        rx0, ry0, rx1, ry1 = rug
        edge = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
        if edge < 1.3:
            return rgb(LAGOON_D)
        if edge < 2.4:
            return rgb("#e9dcb8")
        if 3.4 < edge < 4.2:
            return rgb(LAGOON)
        return weave(x + y, x - y, "#d8c48f", "#c4ad74", 1.4)

    S = room_shell(W, D, slab, resort_floor_planks(rug, rug_fn), resort_wall(),
                   trim=TEAK, side=STONE, side_dark=STONE_D,
                   name="SPECS", plate=TEAK_D, ink="#fbf1d6", plate_edge="#d6a35a")
    T = WALL_T
    S += thatch_eave_x(0, W, 0, T + 2.6, 30.0, drop=2.4)
    S += thatch_eave_y(0, T + 2.6, D, T + 2.6, 30.0, drop=2.4)

    # --- entrance (S edge, centre): bamboo frame + thatched canopy, woven mat, stone steps
    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#c9a86a", edge=LAGOON_D)
    S += door_frame_x(dx, D - 0.6, 22.0, "#a87f45", canopy=STRAW, out=1)
    S += entrance_steps("S", (dx, D), slab, col="#e2d3b0")

    # --- N wall: name board + key cubbies behind the concierge counter
    S += carved_sign_x(29.0, 65.0, T, 16.8, 26.0, "SPECS")
    S += key_cubbies(33.0, 61.0, T, 10.0, 16.0, cols=6, rows=2)
    S += concierge_counter(24.0, 70.0, 12.5, 19.0)
    S += typewriter(28.0, 13.6, 10.5)
    S += guest_book(41.0, 13.4, 10.5)
    S += service_bell(61.5, 16.6, 10.5)
    S += flower_vase(66.8, 14.6, 10.5)
    S += [box(54.0, 13.6, 10.5, 57.0, 15.6, 11.2, flat("#fbf7ec"))]   # note pad

    # --- N wall right: two sea-view windows over a flower box
    S += ocean_window_x(79.0, 94.0, T, 11.5, 25.0)
    S += ocean_window_x(103.0, 112.0, T, 11.5, 25.0)
    S += flower_box_x(76.0, 113.0, T + 0.2, d=5.0, h=5.0, seed=7)

    # --- NW corner palm
    S += potted_palm(9.0, 9.5, h=19.0, spread=6.0, seed=1)

    # --- W wall: guest-request pinboard, brochure rack, rattan sofa under a sunset painting
    S += request_board_y(T, 24.0, 47.0, 11.0, 24.5)
    S += brochure_rack_y(T + 0.2, 51.0, 61.0)
    S += sunset_painting_y(T, 69.0, 89.0, 14.0, 24.5)
    S += rattan_sofa_y(T + 0.4, 68.0, 90.0)

    # --- front corners: luggage cart (left), palm (right)
    S += luggage_cart(T + 3.0, D - 13.0)
    S += potted_palm(W - 7.0, D - 7.5, h=16.0, spread=5.2, seed=4, pot="#e0ddd2")
    S += potted_palm(W - 7.0, T + 11.5, h=14.0, spread=4.6, seed=6)
    return S


# ------------------------------------------------------------------ PLAN: excursions desk
def island_map_x(x0, x1, y, z0, z1):
    """Parchment island map pinned to the N wall (face L): island, reef, dotted tour route."""
    w, h = x1 - x0, z1 - z0
    pins = [(0.28, 0.62, CORAL), (0.5, 0.36, SUN), (0.7, 0.58, LAGOON_D), (0.8, 0.3, HIBISCUS)]

    def island(uu, vv):
        a, b = (uu - w * 0.5) / (w * 0.36), (vv - h * 0.5) / (h * 0.4)
        wob = 0.12 * math.sin(uu * 0.55) + 0.1 * math.cos(vv * 0.9 + uu * 0.2)
        return abs(a) ** 2.4 + abs(b) ** 2.4 - (1 + wob)

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(TEAK_D)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 1.0 or uu > w - 1.0 or vv < 1.0 or vv > h - 1.0:
            return rgb(TEAK)                            # frame
        if uu < 1.8 or uu > w - 1.8 or vv < 1.8 or vv > h - 1.8:
            return rgb("#b98a4e")                       # burnt edge
        for (pu, pv, col) in pins:
            if abs(uu - pu * w) < 0.9 and abs(vv - pv * h) < 0.8:
                return rgb(col)
            if abs(uu - pu * w) < 0.25 and pv * h - 1.6 < vv < pv * h:
                return rgb("#5e3b20")
        # dotted route between the pins
        for (a, b) in zip(pins, pins[1:]):
            ax, az, bx, bz = a[0] * w, a[1] * h, b[0] * w, b[1] * h
            L = math.hypot(bx - ax, bz - az)
            t = ((uu - ax) * (bx - ax) + (vv - az) * (bz - az)) / (L * L)
            if 0.08 < t < 0.92:
                d = abs((uu - ax) * (bz - az) - (vv - az) * (bx - ax)) / L
                if d < 0.6 and int(t * L / 1.4) % 2 == 0:
                    return rgb("#c0392b")
        # compass rose bottom-left
        cu, cv = uu - 4.2, vv - 3.6
        if math.hypot(cu, cv) < 2.8 and (abs(cu) < 0.35 or abs(cv) < 0.35):
            return rgb("#5e3b20")
        k = island(uu, vv)
        if k < -0.25:
            g = hash2(int(uu * 0.9), int(vv * 0.9), 41)
            return rgb("#7fae6a") if g > 0.3 else rgb("#6d9c5b")
        if k < 0.0:
            return rgb("#e6cf94")                      # beach
        if k < 0.35:
            return rgb("#b4e0d6")                      # shallows
        base = rgb("#8fc9c4") if hash2(int(uu * 0.7), int(vv * 0.7), 42) > 0.2 else rgb("#84bdb8")
        if abs(vv - h * 0.5 - 1.5 * math.sin(uu * 0.4)) < 0.25 and k > 0.8:
            return rgb("#c9ecea")                      # wave lines
        return base
    S = [box(x0, y, z0, x1, y + 0.8, z1, m)]
    for px in (x0 + 1.5, x1 - 1.5):
        S.append(box(px - 0.5, y + 0.6, z1 - 1.4, px + 0.5, y + 1.2, z1 - 0.4, flat("#c0392b")))
    return S


def schedule_board_x(x0, x1, y, z0, z1, seed=8):
    """Chalk tour-schedule board (face L): time column + coloured tour tags."""
    w, h = x1 - x0, z1 - z0
    tags = (LAGOON, CORAL, SUN, "#7bd389")

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(TEAK_D)
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.9 or uu > w - 0.9 or vv < 0.9 or vv > h - 0.9:
            return rgb(TEAK)
        row = int((h - 0.9 - vv) // 1.4)
        rv = (h - 0.9 - vv) % 1.4
        if rv < 0.75 and row < 4:
            if 1.8 < uu < 4.6:
                return rgb("#e9efe6")                  # times
            L = 8 + hash2(row, 1, seed) * (w - 14)
            if 6.0 < uu < 6.0 + L:
                return rgb(tags[row % 4])
            if 6.0 + L + 1 < uu < 6.0 + L + 2 and hash2(row, 2, seed) > 0.4:
                return rgb("#e9efe6")                  # tick
        return rgb("#2f4a3c") if hash2(int(uu * 1.2), int(vv * 1.2), seed) > 0.1 else rgb("#3a5848")
    return [box(x0, y, z0, x1, y + 0.8, z1, m)]


def tour_desk(x0, x1, y0, y1, h=9.0):
    def front(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(TEAK)
        if p[2] < 1.0:
            return rgb(TEAK_D)
        # vertical bamboo cladding
        coord = p[0] if f == "L" else -p[1]
        k = coord % 2.2
        if k < 0.35:
            return rgb("#8c6a34")
        c = rgb("#d4b06a") if int(coord // 2.2) % 2 else rgb("#c9a45e")
        if abs((p[2] + int(coord // 2.2) * 1.3) % 4.0 - 2.0) < 0.3:
            c = c * 0.8
        return c * (0.92 if f != "L" else 1.0)

    def top(p, n):
        f, u, v = face_uv(p, n)
        return rgb(TEAK_L) if f == "top" else rgb(TEAK_D)
    return [box(x0, y0, 0, x1, y1, h, front),
            box(x0 - 0.8, y0 - 0.5, h, x1 + 0.8, y1 + 0.9, h + 1.0, top)]


def desk_globe(cx, cy, z, r=2.4):
    def g(p, n):
        lat = (p[2] - (z + 3.4)) / r
        lon = math.atan2(p[1] - cy, p[0] - cx)
        land = math.sin(lon * 3 + lat * 2.2) + math.cos(lat * 4 - lon) > 0.9
        return rgb("#6cbf6a") if land else rgb("#3a86c8")
    return [vcyl(cx, cy, 1.4, z, z + 0.5, flat(TEAK_D), sides=8),
            vcyl(cx, cy, 0.3, z + 0.5, z + 1.2, flat("#d8aa45"), sides=6),
            blob(cx, cy, z + 1.2 + r, r, g, n=26)]


def floor_globe(cx, cy):
    S = [box(cx - 3.6, cy - 0.5, 0, cx + 3.6, cy + 0.5, 1.0, flat(TEAK_D)),
         box(cx - 0.5, cy - 3.6, 0, cx + 0.5, cy + 3.6, 1.0, flat(TEAK_D)),
         vcyl(cx, cy, 0.7, 1.0, 6.5, flat(TEAK), sides=8),
         vcyl(cx, cy, 4.2, 6.5, 7.3, flat("#d8aa45"), sides=14)]
    S += desk_globe(cx, cy, 7.3, r=3.6)[2:]
    return S


def rotary_phone(cx, cy, z):
    return [box(cx - 1.6, cy - 1.3, z, cx + 1.6, cy + 1.3, z + 1.4, flat("#2b2b2b")),
            hcyl("x", cy, z + 2.0, 0.6, cx - 1.8, cx + 1.8, flat("#1d1d1d"), sides=6),
            vcyl(cx, cy + 0.2, 0.9, z + 1.4, z + 1.6, flat("#e9e2cf"), sides=10)]


def ticket_stack(x0, y0, z, cols=(LAGOON, CORAL, SUN)):
    S = []
    for i, c in enumerate(cols):
        S.append(box(x0 + i * 0.3, y0 + i * 0.2, z + i * 0.35, x0 + 3.2 + i * 0.3, y0 + 1.8 + i * 0.2, z + (i + 1) * 0.35, flat(c)))
    return S


def kayak_x(x0, x1, y, z, r=2.0, col=SUN):
    m = flat(col)
    return [hcyl("x", y, z, r, x0 + 2, x1 - 2, m, sides=8),
            blob(x0 + 2.0, y, z, r * 0.95, m, n=14, squash=0.9),
            blob(x1 - 2.0, y, z, r * 0.95, m, n=14, squash=0.9),
            box((x0 + x1) / 2 - 2.5, y - 1.0, z + r * 0.6, (x0 + x1) / 2 + 2.5, y + 1.0, z + r + 0.2, flat("#2b2b2b"))]


def wall_bracket(x, y, z):
    return [box(x - 0.6, y, z - 3.0, x + 0.6, y + 5.0, z - 2.2, flat(TEAK_D)),
            box(x - 0.6, y + 4.2, z - 2.2, x + 0.6, y + 5.0, z - 0.6, flat(TEAK_D))]


def snorkel_crate(x0, y0, w=11.0, d=6.5, h=5.0, seed=0):
    def crate(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3b2616")
        coord = p[0] if f == "L" else -p[1]
        if int(p[2] // 1.7) != int((p[2] + 0.35) // 1.7):
            return rgb(TEAK_D)
        return rgb(TEAK_L) if int(coord // 4.0) % 2 else rgb(TEAK)
    S = [box(x0, y0, 0, x0 + w, y0 + d, h, crate)]
    cols = (LAGOON, SUN, CORAL, "#3a86c8")
    for i in range(4):
        fx = x0 + 1.4 + i * (w - 2.8) / 3.5
        c = cols[(i + seed) % 4]
        S.append(box(fx, y0 + 1.2 + (i % 2), h, fx + 1.8, y0 + 1.9 + (i % 2), h + 4.2 + (i % 2) * 0.8, flat(c)))
    S.append(blob(x0 + w * 0.7, y0 + d * 0.6, h + 0.8, 1.4, flat("#1d6fa5"), n=12, squash=0.6))   # mask
    return S


def life_vest_rack_y(x, y0, y1, n_=4):
    S = [box(x, y0, 0, x + 1.2, y0 + 1.2, 12.0, flat(TEAK_D)),
         box(x, y1 - 1.2, 0, x + 1.2, y1, 12.0, flat(TEAK_D)),
         box(x, y0, 11.0, x + 1.6, y1, 12.0, flat(TEAK))]
    step = (y1 - y0 - 2.4) / n_

    def vest(p, n):
        f, u, v = face_uv(p, n)
        if f == "R" and abs(p[2] - 7.2) < 0.45:
            return rgb("#f4f1ea")       # reflective strap
        return rgb("#f27a1a") if f != "top" else rgb("#f79a44")
    for i in range(n_):
        ya = y0 + 1.2 + i * step + 0.5
        S.append(box(x + 0.6, ya, 4.0, x + 3.2, ya + step - 1.0, 10.8, vest))
    return S


def tour_aframe(cx, cy):
    """A-frame chalk sign facing the room's front (+y), wave + sun doodles."""
    def face(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(TEAK)
        uu, vv = p[0] - (cx - 3.4), p[2]
        if uu < 0.7 or uu > 6.1 or vv < 0.8 or vv > 9.4:
            return rgb(TEAK)
        if math.hypot(uu - 4.4, vv - 7.2) < 1.2:
            return rgb(SUN)
        if abs(vv - 4.2 - 0.6 * math.sin(uu * 1.6)) < 0.35:
            return rgb(LAGOON)
        if abs(vv - 2.6 - 0.6 * math.sin(uu * 1.6 + 1)) < 0.35:
            return rgb("#e9efe6")
        return rgb("#2f4a3c")
    from isopix import plane_through
    S = [box(cx - 3.4, cy - 2.4, 0, cx + 3.4, cy + 1.2, 10.0, face,
             extra=[plane_through((0, 1, 0.33), (cx, cy + 1.2, 0)), plane_through((0, -1, 0.33), (cx, cy - 2.4, 0))])]
    return S


def interior_plan(W, D, slab):
    rug = (1.05 * U + 1, 1.1 * U - 4, W - 1.05 * U - 2, 2.95 * U + 6)
    rcx, rcy = (rug[0] + rug[2]) / 2, (rug[1] + rug[3]) / 2

    def rug_fn(x, y):
        rx0, ry0, rx1, ry1 = rug
        edge = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
        if edge < 1.2:
            return rgb(TEAK_D)
        if edge < 2.2:
            return rgb("#e9dcb8")
        dx, dy = x - rcx, y - rcy
        r = math.hypot(dx, dy)
        # compass rose: 4 long points + 4 short diagonals + ring
        ax, ay = abs(dx), abs(dy)
        if (ax * 4.0 + ay < 22 and ay < 22) or (ay * 4.0 + ax < 22 and ax < 22):
            north = dy < 0 and ax * 4.0 + ay < 22
            if north:
                return rgb("#c0392b") if dx < 0 else rgb("#e8553f")
            return rgb(LAGOON_D) if (dx > 0) == (dy > 0) else rgb(LAGOON)
        u_, v_ = (dx + dy) * 0.7071, (dx - dy) * 0.7071
        if abs(u_) * 3.5 + abs(v_) < 12 or abs(v_) * 3.5 + abs(u_) < 12:
            return rgb(SUN)
        if 23.0 < r < 24.4:
            return rgb(LAGOON_D)
        return weave(x + y, x - y, "#d8c48f", "#c4ad74", 1.4)

    def wall(which, u, z):
        if which == "W":            # low rattan half-wall (keeps Specs visible behind it)
            if z < 1.0:
                return rgb(TEAK_D)
            if z > 11.0:
                return rgb(TEAK)
            return weave(u, z, STRAW, STRAW_D, 1.2)
        return resort_wall()(which, u, z)

    S = room_shell(W, D, slab, resort_floor_planks(rug, rug_fn), wall,
                   trim=TEAK, side=STONE, side_dark=STONE_D,
                   name="PLAN", plate=TEAK_D, ink="#fbf1d6", plate_edge="#d6a35a",
                   wall_h_w=12.0)
    T = WALL_T
    S += thatch_eave_x(0, W, 0, T + 2.6, 30.0, drop=2.4)

    dx = 2.5 * U
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#c9a86a", edge=LAGOON_D)
    S += door_frame_x(dx, D - 0.6, 22.0, "#a87f45", canopy=STRAW, out=1)
    S += entrance_steps("S", (dx, D), slab, col="#e2d3b0")

    # --- N wall: big island map, PLAN board over the tour schedule, excursions desk
    S += island_map_x(5.0, 51.0, T, 11.0, 25.5)
    S += carved_sign_x(56.0, 90.0, T, 17.4, 26.0, "PLAN", icon="compass")
    S += schedule_board_x(58.0, 88.0, T, 10.6, 16.9)
    S += tour_desk(57.0, 89.0, 11.0, 17.5)
    S += desk_globe(61.0, 14.2, 10.0)
    S += ticket_stack(68.0, 13.4, 10.0)
    S += guest_book(73.0, 13.0, 10.0)
    S += rotary_phone(86.0, 14.0, 10.0)

    # --- NE: kayaks racked on the wall over a crate of snorkel gear
    for bx in (96.0, 110.0):
        S += wall_bracket(bx, T, 13.0)
        S += wall_bracket(bx, T, 20.5)
    S += kayak_x(92.0, 114.5, T + 3.0, 14.6, col=SUN)
    S += kayak_x(92.0, 114.5, T + 3.0, 22.1, col=CORAL)
    S += snorkel_crate(94.0, T + 0.4, seed=1)
    S += snorkel_crate(W - 8.5, 16.0, w=6.5, d=9.0, seed=2)

    # --- W half-wall: life-vest rack, snorkel crate, palm at the front
    S += life_vest_rack_y(T + 0.2, 12.0, 40.0)
    S += snorkel_crate(T + 0.4, 46.0, w=6.5, d=11.0, h=4.6, seed=3)
    S += brochure_rack_y(T + 0.2, 62.0, 71.0)
    S += potted_palm(T + 6.0, D - 8.0, h=13.0, spread=4.4, seed=13)

    # --- front: A-frame tour sign by the door, floor globe in the right corner
    S += tour_aframe(dx + 16.0, D - 7.0)
    S += floor_globe(W - 11.0, D - 11.0)
    return S


# ------------------------------------------------------------------ BUILD: bungalow going up
from isopix import Solid
from interiors import wheelbarrow, sand_pile


def bamboo_mat(seed=0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e0c27a")
        node = (p[2] + seed * 1.7) % 4.4 if f in ("L", "R") else 9
        if node < 0.45:
            return rgb("#8c6a34")
        return rgb("#d4b06a") if f == "L" else rgb("#c19a55")
    return m


def pole_z(cx, cy, z0, z1, r=0.8, seed=0):
    return vcyl(cx, cy, r, z0, z1, bamboo_mat(seed), sides=6)


def pole_x(x0, x1, y, z, r=0.6, seed=0):
    return hcyl("x", y, z, r, x0, x1, bamboo_mat(seed), sides=6)


def pole_y(y0, y1, x, z, r=0.6, seed=0):
    return hcyl("y", x, z, r, y0, y1, bamboo_mat(seed), sides=6)


def slab_between(x0, x1, y0, y1, k_top, k_bot, sgn, mat, z_lo=-1, z_hi=None):
    """Sloped plank between planes  z + sgn*x <= k_top  and  z + sgn*x >= k_bot."""
    if z_hi is None:   # tightest top: max of k_top - sgn*x over the x range
        z_hi = max(k_top - sgn * x0, k_top - sgn * x1) + 0.5
    pl = [((1, 0, 0), x1), ((-1, 0, 0), -x0), ((0, 1, 0), y1), ((0, -1, 0), -y0),
          ((0, 0, 1), z_hi), ((0, 0, -1), -z_lo)]
    r = math.sqrt(2)
    pl.append(((sgn / r, 0, 1 / r), k_top / r))
    pl.append(((-sgn / r, 0, -1 / r), -k_bot / r))
    return Solid(pl, (x0, y0, z_lo, x1, y1, z_hi), mat)


def thatch_mat(seed=0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        k = hash2(int(p[1] * 1.4), int((p[2] - p[0]) * 1.8), 53 + seed)
        stripe = int((p[2] + p[0]) * 0.9) % 3
        c = rgb(STRAW_L) if stripe == 0 else (rgb(STRAW) if stripe == 1 else rgb(STRAW_D))
        return c * (0.92 if k < 0.2 else 1.0)
    return m


def bungalow_frame(x0, x1, y0, y1, eave=22.0, thatch_from=None):
    """Bamboo post-and-beam frame with an A roof: rafters all along, thatch on the
    front part (y >= thatch_from) of the east-facing slope only — work in progress."""
    S = []
    xm = (x0 + x1) / 2
    ridge = eave + (xm - x0)
    ys = [y0 + i * (y1 - y0) / 3 for i in range(4)]
    for i, y in enumerate(ys):
        S.append(pole_z(x0 + 0.8, y, 0, eave, r=0.9, seed=i))
        S.append(pole_z(x1 - 0.8, y, 0, eave, r=0.9, seed=i + 4))
    S.append(pole_y(y0 - 1.0, y1 + 1.0, x0 + 0.8, eave - 0.6, r=0.7))
    S.append(pole_y(y0 - 1.0, y1 + 1.0, x1 - 0.8, eave - 0.6, r=0.7))
    S.append(pole_y(y0 - 2.0, y1 + 2.0, xm, ridge, r=0.7, seed=3))
    # raised plank floor on the stilts
    def plat(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#c98f55") if int(p[1] // 3.2) % 2 else rgb("#d39a5e")
        return rgb(TEAK_D)
    S.append(box(x0, y0 - 1.0, 3.6, x1 + 0.6, y1 + 1.0, 4.8, plat))
    # woven palm-mat wall panels: full W side at the back half, N gable end
    def mat_(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(STRAW_D)
        return weave(u, p[2], STRAW_L, STRAW, 1.2)
    S.append(box(x0 + 0.2, y0, 4.8, x0 + 1.2, y0 + (y1 - y0) * 0.6, eave - 1.0, mat_))
    S.append(box(x0 + 1.2, y0 - 0.2, 4.8, x1 - 1.6, y0 + 0.8, eave - 1.0, mat_))
    S.append(box(x1 - 1.6, y0 - 0.2, 4.8, x1 - 0.2, y0 + 0.8, 12.0, mat_))
    # rafters (pairs) — left slope rises with x, right slope falls with x
    raf = bamboo_mat(7)
    yy = y0 - 1.0
    while yy <= y1 + 1.0:
        S.append(slab_between(x0 - 1.5, xm, yy - 0.45, yy + 0.45, eave - x0 + 0.9, eave - x0, -1, raf, z_lo=eave - 2))
        S.append(slab_between(xm, x1 + 1.5, yy - 0.45, yy + 0.45, ridge + xm + 0.9, ridge + xm, 1, raf, z_lo=eave - 2))
        yy += 3.0
    # purlins across the bare part of the east slope
    for d in (2.5, 5.5):
        S.append(pole_y(y0 - 1.0, (thatch_from or y1) + 0.5, xm + d, ridge - d + 1.1, r=0.4, seed=9))
    if thatch_from is not None:
        S.append(slab_between(xm - 0.3, x1 + 2.2, thatch_from, y1 + 2.0, ridge + xm + 2.6, ridge + xm + 0.9, 1,
                              thatch_mat(), z_lo=eave - 3.5))
        S.append(slab_between(x0 - 2.2, xm + 0.3, thatch_from, y1 + 2.0, eave - x0 + 2.6, eave - x0 + 0.9, -1,
                              thatch_mat(1), z_lo=eave - 3.5))
    return S


def bamboo_ladder(x, y0, y1, h=20.0, lean=4.0):
    """Ladder along y leaning against something at +x... rails are upright poles tilted toward -x."""
    S = []
    for y in (y0, y1):
        S.append(slab_between(x - lean - 0.5, x + 0.5, y - 0.45, y + 0.45, 1e3, -1e3, 0, bamboo_mat(), 0, h))
    # (simple vertical rails; rungs every 3)
    S = [pole_z(x, y0, 0, h, r=0.5), pole_z(x, y1, 0, h, r=0.5)]
    z = 2.5
    while z < h - 1:
        S.append(pole_y(y0, y1, x, z, r=0.35, seed=2))
        z += 3.0
    return S


def pole_bundle_x(x0, x1, y0, rows=3, seed=0):
    S = []
    for r in range(rows):
        for k in range(rows - r + 1):
            S.append(pole_x(x0 + (r * 1.3), x1 - (k % 2) * 1.6, y0 + 0.8 + k * 1.5 + r * 0.75, 0.75 + r * 1.3, r=0.7, seed=seed + k))
    return S


def leaf_bundle(cx, cy, seed=0, n_=3):
    S = []
    for i in range(n_):
        S.append(blob(cx + i * 2.6, cy + (i % 2) * 1.2, 1.2 + (i % 2) * 0.6, 2.4, leafy(seed + i, "#4f7d2e", "#6b9a3a", "#93b84f"),
                      n=14, squash=0.4, seed=seed + i))
    S.append(box(cx - 1.0, cy - 0.3, 0, cx + 2 * 2.6 + 1.0, cy + 0.3, 1.9, flat("#c9a26a")))   # twine
    return S


def sawhorse_x(x0, x1, cy, h=6.0, plank=True):
    S = []
    for x in (x0 + 1.0, x1 - 1.0):
        S.append(box(x - 0.5, cy - 2.2, 0, x + 0.5, cy - 1.4, h, flat(TEAK)))
        S.append(box(x - 0.5, cy + 1.4, 0, x + 0.5, cy + 2.2, h, flat(TEAK)))
        S.append(box(x - 0.7, cy - 2.2, h - 0.8, x + 0.7, cy + 2.2, h, flat(TEAK_D)))
    if plank:
        S.append(box(x0 - 2.0, cy - 1.8, h, x1 + 2.0, cy + 1.8, h + 0.9, flat(TEAK_L)))
    return S


def workbench_x(x0, x1, y0, d=6.0, h=8.0):
    S = [box(x0, y0, h - 1.2, x1, y0 + d, h, flat(TEAK_L))]
    for (x, y) in ((x0 + 0.8, y0 + 0.8), (x1 - 0.8, y0 + 0.8), (x0 + 0.8, y0 + d - 0.8), (x1 - 0.8, y0 + d - 0.8)):
        S.append(box(x - 0.6, y - 0.6, 0, x + 0.6, y + 0.6, h - 1.2, flat(TEAK)))
    S.append(box(x0 + 0.8, y0 + 0.8, 2.0, x1 - 0.8, y0 + d - 0.8, 2.6, flat(TEAK)))      # low shelf
    # tools: saw, hammer, mallet, coil of rope
    S.append(box(x0 + 2.0, y0 + 1.5, h, x0 + 9.0, y0 + 3.0, h + 0.3, flat("#c9ced4")))
    S.append(box(x0 + 1.0, y0 + 1.6, h, x0 + 2.4, y0 + 2.9, h + 0.9, flat(TEAK_D)))
    S.append(box(x0 + 11.0, y0 + 3.6, h, x0 + 15.0, y0 + 4.2, h + 0.6, flat(TEAK_D)))
    S.append(box(x0 + 14.6, y0 + 2.9, h, x0 + 15.8, y0 + 4.9, h + 1.2, flat("#5a5f66")))
    S.append(vcyl(x1 - 3.5, y0 + 3.0, 2.0, h, h + 1.2, flat("#c9a26a"), sides=10))
    S.append(vcyl(x1 - 3.5, y0 + 3.0, 0.9, h + 1.1, h + 1.25, flat("#8a6a3c"), sides=8))
    # wood shavings box on the shelf
    S.append(box(x0 + 3.0, y0 + 1.5, 2.6, x0 + 9.0, y0 + 4.5, 4.6, flat("#e0c27a")))
    return S


def derrick(cx, cy, h=26.0, spread=6.0):
    """Bamboo A-frame hoist with a rope and a hanging bundle of planks (along x)."""
    S = []
    top = (cx, cy, h)
    for (bx, by) in ((cx - spread, cy - spread * 0.6), (cx - spread, cy + spread * 0.6)):
        # approximate the leaning legs with stacked short segments
        n_ = 7
        for i in range(n_):
            t0, t1 = i / n_, (i + 1) / n_
            x0_, y0_, z0_ = bx + (cx - bx) * t0, by + (cy - by) * t0, h * t0
            S.append(vcyl(x0_, y0_, 0.7, z0_, h * t1 + 0.3, bamboo_mat(i), sides=6))
    S.append(pole_x(cx - 1.0, cx + 9.0, cy, h - 0.6, r=0.6, seed=4))       # boom
    S.append(vcyl(cx + 8.4, cy, 0.25, h - 11.0, h - 0.6, flat("#c9a26a"), sides=4))   # rope
    S.append(vcyl(cx + 8.4, cy, 0.9, h - 1.6, h - 0.2, flat(TEAK_D), sides=8))         # pulley
    for k in range(3):
        S.append(box(cx + 5.0, cy - 1.8 + k * 1.3, h - 13.4 + (k % 2) * 0.9, cx + 11.8, cy - 0.7 + k * 1.3,
                     h - 12.4 + (k % 2) * 0.9, flat(TEAK_L if k % 2 else TEAK)))
    return S


def hoist_y(x, y0, y1, h=22.0):
    """Bamboo gallows hoist: two posts, a crossbar along y, pulley + rope + a bundle of planks."""
    ym = (y0 + y1) / 2
    S = [pole_z(x, y0, 0, h, r=1.0, seed=1), pole_z(x, y1, 0, h, r=1.0, seed=2),
         pole_y(y0 - 1.5, y1 + 1.5, x, h - 0.8, r=0.8, seed=3)]
    for (yy, sg) in ((y0, 1), (y1, -1)):                          # corner braces
        S.append(pole_y(min(yy, yy + sg * 4), max(yy, yy + sg * 4), x, h - 4.0, r=0.45, seed=4))
    S.append(vcyl(x, ym, 1.1, h - 2.6, h - 0.4, flat(TEAK_D), sides=8))      # pulley
    S.append(vcyl(x, ym, 0.25, h - 11.5, h - 2.4, flat("#c9a26a"), sides=4))  # rope
    for k in range(3):
        S.append(box(x - 2.0 + k * 1.3, ym - 6.0, h - 14.2 + (k % 2) * 0.8, x - 0.7 + k * 1.3, ym + 6.0,
                     h - 13.0 + (k % 2) * 0.8, flat(TEAK_L if k % 2 else TEAK)))
    S.append(box(x - 2.2, ym - 0.4, h - 13.2, x + 2.2, ym + 0.4, h - 11.4, flat("#c9a26a")))  # sling
    return S


def tar_bucket(cx, cy):
    return [vcyl(cx, cy, 1.8, 0, 3.4, flat("#5a5f66"), sides=8),
            vcyl(cx, cy, 1.5, 3.3, 3.45, flat("#1d1d1f"), sides=8)]


def wood_signboard_y(x, y0, y1, name, h0=3.5, h1=13.0, icon="hammer"):
    """Carved teak signboard on two bamboo posts along the E edge (face R)."""
    tw = len(name) * 6 - 1

    def board(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(TEAK_L)
        if f != "R":
            return rgb(TEAK_D)
        uu, zz = y1 - p[1], p[2] - h0
        w, h = y1 - y0, h1 - h0
        if uu < 0.9 or uu > w - 0.9 or zz < 0.9 or zz > h - 0.9:
            return rgb("#d6a35a")
        if icon == "hammer":
            if 2.2 < uu < 6.4 and h / 2 + 1.0 < zz < h / 2 + 2.8:
                return (rgb("#c9ced4"), True)
            if 3.8 < uu < 4.8 and h / 2 - 3.0 < zz <= h / 2 + 1.0:
                return (rgb("#f2c94c"), True)
        if icon == "magnifier":
            d = math.hypot(uu - 4.6, zz - (h / 2 + 0.8))
            if 1.5 < d < 2.4:
                return (rgb("#f2c94c"), True)
            if abs((uu - 4.6) + (zz - (h / 2 + 0.8))) < 0.7 and 2.0 < (uu - 4.6) < 4.2 and zz < h / 2:
                return (rgb("#f2c94c"), True)
        u0 = round(w / 2 - tw / 2) + 3
        if text7(name, uu, zz, u0, h / 2 + 3.5, slope=-1):
            return (rgb("#fbf1d6"), True)
        g = hash2(int(uu * 0.8), int(zz * 3), 18)
        return rgb("#6e4425") * (0.94 if g < 0.3 else 1.0)
    S = [box(x - 0.5, y0, h0, x + 0.4, y1, h1, board)]
    for y in (y0 + 2.5, y1 - 2.5):
        S.append(pole_z(x - 0.2, y, 0, h1 + 1.2, r=0.6, seed=int(y)))
    return S


def interior_build(W, D, slab):
    pad = (1.05 * U - 1, 1.1 * U - 4, W - 1.05 * U + 1, 3.15 * U + 5)   # new bungalow deck under the agents
    deck_h = 1.4

    def floor(p):
        x, y = p[0], p[1]
        # sand with wood shavings and footprints
        h = hash2(int(x / 1.1), int(y / 1.1), 71)
        c = rgb("#e6cf98")
        if h < 0.1:
            c = rgb("#d6bd84")
        elif h > 0.93:
            c = rgb("#f2dfb0")
        if hash2(int(x / 0.8), int(y / 0.8), 72) < 0.025:
            c = rgb("#c99a5a")
        return c

    def fence(which, u, z):
        # lashed bamboo fence: vertical poles + two rope ties
        k = u % 2.0
        if abs(z - 3.0) < 0.5 or abs(z - 9.0) < 0.5:
            return rgb("#8a6a3c")
        if k < 0.3:
            return rgb("#7a5a2c")
        c = rgb("#d4b06a") if int(u // 2.0) % 2 else rgb("#c9a45e")
        if z > 11.6:
            return rgb("#b8934c")
        if abs((z + int(u // 2.0) * 1.9) % 5.0 - 2.5) < 0.3:
            c = c * 0.8
        return c

    S = room_shell(W, D, slab, floor, fence, trim="#b8934c", side=STONE, side_dark=STONE_D,
                   wall_h=12.5, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U

    # --- the new deck (agents' pad): planks with the last row still open to the joists
    px0, py0, px1, py1 = pad

    def deck(p, n):
        f, u, v = face_uv(p, n)
        if f != "top":
            return rgb(TEAK) if p[2] > deck_h - 0.4 else rgb(TEAK_D)
        row = int((p[1] - py0) // 3.9)
        if (p[1] - py0) % 3.9 < 0.35:
            return rgb("#7a4e2a")
        hh = hash2(int((p[0] + row * 5.3) // 14), row, 73)
        return rgb("#d39a5e") if hh > 0.5 else rgb("#c98f55")
    S.append(box(px0, py0, 0, px1, py1 - 9.0, deck_h, deck))
    for jx in range(int(px0) + 2, int(px1), 8):                  # exposed joists at the front
        S.append(box(jx, py1 - 9.0, 0, jx + 1.2, py1, deck_h - 0.2, flat(TEAK)))
    S.append(box(px0, py1 - 1.2, 0, px1, py1, deck_h - 0.2, flat(TEAK_D)))
    for k in range(3):                                          # loose planks waiting to go down
        S.append(box(px1 - 30.0 + k * 0.6, py1 - 7.6 + k * 2.2, deck_h - 0.2 + k * 0.5, px1 - 6.0 + k * 0.6,
                     py1 - 5.8 + k * 2.2, deck_h + 0.3 + k * 0.5, flat(TEAK_L if k % 2 else "#d39a5e")))

    # --- gate in the N fence: bamboo posts + lintel with a palm-frond tuft, steps to the path
    for sgn in (-1, 1):
        S.append(pole_z(dx + sgn * (DOOR_HALF + 0.7), 0.6, 0, 17.0, r=0.9, seed=sgn + 2))
    S.append(pole_x(dx - DOOR_HALF - 2.0, dx + DOOR_HALF + 2.0, 0.6, 16.4, r=0.8, seed=5))
    S.append(blob(dx - DOOR_HALF - 0.7, 0.6, 18.0, 1.9, leafy(3), n=12, squash=0.6, seed=3))
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col="#c9a86a", edge=LAGOON_D)
    S += entrance_steps("N", (dx, 0), slab, col="#e2d3b0")

    # --- W side: the bungalow frame, half thatched, with a ladder against it
    S += bungalow_frame(T + 1.0, T + 19.0, 22.0, 66.0, eave=20.0, thatch_from=46.0)
    S += bamboo_ladder(T + 21.0, 28.0, 32.0, h=19.0)

    # --- N fence (kept low: Specs sits behind it): bamboo poles, frond bundles, sawhorses
    S += pole_bundle_x(6.0, 40.0, T + 0.6, rows=3)
    S += leaf_bundle(72.0, T + 3.0, seed=2)
    S += leaf_bundle(72.0, T + 7.4, seed=5, n_=2)
    S += sawhorse_x(84.0, 98.0, T + 12.0)

    # --- NE corner: carpenter's workbench
    S += workbench_x(W - 24.0, W - 3.0, T + 0.6)

    # --- front: rope hoist (SW), sand, barrow, tar bucket, signboard on the E edge
    S += hoist_y(9.0, D - 20.0, D - 6.0, h=22.0)
    S += sand_pile(36.0, D - 9.0, r=5.5, h=5.0)
    S += wheelbarrow(W - 30.0, D - 8.0)
    S += tar_bucket(W - 14.0, D - 6.0)
    S += leaf_bundle(W - 22.0, D - 16.0, seed=8, n_=2)
    S += wood_signboard_y(W - 2.2, 28.0, 70.0, "BUILD")
    return S


# ------------------------------------------------------------------ REVIEW: chef's open kitchen
STEEL, STEEL_D, STEEL_L = "#b9c1c9", "#8c959e", "#dfe5ea"


def steel_counter(x0, y0, x1, y1, h=8.0, front="L"):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(STEEL_L) if hash2(int(p[0] * 0.7), int(p[1] * 0.7), 81) > 0.15 else rgb(STEEL)
        if p[2] < 0.8:
            return rgb("#4a5058")
        if p[2] > h - 1.0:
            return rgb(STEEL_L)
        coord = p[0] if f == "L" else -p[1]
        if coord % 9.0 < 0.4:
            return rgb(STEEL_D)                     # cabinet seams
        if abs(p[2] - (h - 2.4)) < 0.3:
            return rgb("#6b737c")                   # handles
        return rgb(STEEL) if f == "L" else rgb(STEEL_D)
    return [box(x0, y0, 0, x1, y1, h, m)]


def range_top(x0, y0, x1, y1, z):
    """Four gas burners + a flat-top on a steel counter."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "top":
            return rgb("#3a3f46")
        bw = (x1 - x0) / 4
        for i in range(4):
            cx = x0 + bw * (i + 0.5)
            for cy in (y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.72):
                d = math.hypot(p[0] - cx, p[1] - cy)
                if d < 1.0:
                    return rgb("#f07a2a") if (i + int(cy)) % 3 else rgb("#2a2d33")
                if 1.6 < d < 2.1:
                    return rgb("#1d2025")
        return rgb("#2d3238")
    return [box(x0, y0, z, x1, y1, z + 0.5, m)]


def pot(cx, cy, z, r=1.8, h=2.6, col="#c9ced4", steam=False):
    S = [vcyl(cx, cy, r, z, z + h, flat(col), sides=10),
         vcyl(cx, cy, r * 0.85, z + h - 0.1, z + h + 0.05, flat("#e7d39a") if steam else flat("#5a5f66"), sides=10),
         box(cx + r - 0.2, cy - 0.3, z + h - 1.0, cx + r + 1.6, cy + 0.3, z + h - 0.5, flat("#2b2b2b"))]
    if steam:
        for k in range(3):
            S.append(blob(cx + (k - 1) * 0.6, cy - 0.3 * k, z + h + 1.4 + k * 1.5, 0.75 - k * 0.12,
                          lambda p, n: (rgb("#ffffff"), True), n=10))
    return S


def plate(cx, cy, z, food=("#e8553f", "#6cbf6a", "#f7c548"), r=1.9):
    S = [vcyl(cx, cy, r, z, z + 0.4, flat("#fbfbf7"), sides=12)]
    for i, c in enumerate(food):
        a = i * 2.1
        S.append(blob(cx + math.cos(a) * 0.65, cy + math.sin(a) * 0.65, z + 0.6, 0.62, flat(c), n=10, squash=0.7))
    return S


def heat_lamp(cx, cy, z):
    return [vcyl(cx, cy, 0.15, z + 1.4, z + 4.0, flat("#2b2b2b"), sides=4),
            cone(cx, cy, z, 1.6, 1.6, flat("#c9302c"), sides=8),
            vcyl(cx, cy, 1.1, z - 0.15, z + 0.05, lambda p, n: (rgb("#ffb347"), True), sides=8)]


def ticket_rail_y(x, y0, y1, z, seed=5):
    """Order-ticket rail on the pass gantry (face R) with a row of tickets."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(STEEL_D)
        uu = y1 - p[1]
        k = int(uu // 3.2)
        cu = uu % 3.2
        if p[2] > z + 2.8:
            return rgb(STEEL)
        if cu < 0.5 or hash2(k, 0, seed) < 0.15:
            return rgb("#c9ced4") if p[2] > z + 2.4 else rgb("#5d636b")
        if (z + 2.4 - p[2]) % 0.9 < 0.35 and 0.9 < cu < 2.7 - (k % 2) * 0.6:
            return rgb("#6b7280")
        if p[2] < z + 0.7 and k % 3 == 0:
            return rgb("#e8553f")                    # flagged ticket
        return rgb("#fbfaf4")
    return [box(x - 0.3, y0, z, x + 0.3, y1, z + 3.4, m)]


def order_bell(cx, cy, z):
    return service_bell(cx, cy, z)


def tasting_spoons(cx, cy, z):
    S = [vcyl(cx, cy, 1.0, z, z + 2.4, flat("#2bb3b1"), sides=8)]
    for (dx, dy) in ((-0.3, 0.2), (0.3, -0.1), (0.0, 0.4)):
        S.append(box(cx + dx - 0.15, cy + dy - 0.15, z + 1.6, cx + dx + 0.15, cy + dy + 0.15, z + 4.0, flat(STEEL_L)))
    return S


def fish_tray(x0, y0, z, w=9.0, d=5.0):
    def ice(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#eaf6fb") if hash2(int(p[0] * 2), int(p[1] * 2), 83) > 0.3 else rgb("#cfe9f4")
        return rgb(STEEL)
    S = [box(x0, y0, z, x0 + w, y0 + d, z + 1.0, ice)]
    for i, col in enumerate(("#5c8fb8", "#e8836b", "#6aa0c4")):
        fx = x0 + 1.0 + i * 2.7
        S.append(box(fx, y0 + 0.8, z + 1.0, fx + 1.6, y0 + d - 1.4, z + 1.7, flat(col)))
        S.append(box(fx + 0.3, y0 + d - 1.4, z + 1.0, fx + 1.3, y0 + d - 0.6, z + 1.5, flat(col)))   # tail
    S.append(blob(x0 + w - 1.2, y0 + 1.2, z + 1.4, 0.7, flat("#f7e14b"), n=8))  # lemon
    return S


def produce_crate(x0, y0, kind, w=8.0, d=6.0, h=4.0):
    def crate(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3b2616")
        if int(p[2] // 1.4) != int((p[2] + 0.35) // 1.4):
            return rgb(TEAK_D)
        return rgb("#c9955c")
    S = [box(x0, y0, 0, x0 + w, y0 + d, h, crate)]
    if kind == "pineapple":
        for (dx, dy) in ((2.0, 1.8), (5.8, 2.0), (3.8, 4.2)):
            S.append(vcyl(x0 + dx, y0 + dy, 1.3, h - 0.5, h + 2.2, flat("#e0a530"), sides=8))
            S.append(cone(x0 + dx, y0 + dy, h + 2.2, 1.1, 2.2, flat("#4a9a3a"), sides=6))
    elif kind == "coconut":
        for (dx, dy) in ((1.8, 1.8), (4.2, 1.6), (6.4, 2.0), (2.8, 4.2), (5.4, 4.3), (4.0, 3.0)):
            S.append(blob(x0 + dx, y0 + dy, h + 0.6 + (0.9 if (dx, dy) == (4.0, 3.0) else 0), 1.2, flat("#6b4a2b"), n=12))
    elif kind == "mango":
        for i in range(7):
            S.append(blob(x0 + 1.4 + (i % 4) * 1.8, y0 + 1.5 + (i // 4) * 2.4, h + 0.5 + (i // 4) * 0.4, 0.95,
                          flat("#f2a43a" if i % 2 else "#e85d3a"), n=10))
    elif kind == "banana":
        for i in range(3):
            S.append(hcyl("x", y0 + 1.6 + i * 1.4, h + 0.7, 0.6, x0 + 1.0, x0 + w - 1.0, flat("#f2d14b"), sides=6))
        S.append(box(x0 + w / 2 - 0.4, y0 + 1.0, h + 0.4, x0 + w / 2 + 0.4, y0 + d - 1.2, h + 1.6, flat("#6b8a3a")))
    return S


def herb_box_y(x, y0, y1, h=4.0, seed=0):
    def planter(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#4a3424")
        return rgb(CORAL) if int((-p[1]) // 6) % 2 else rgb("#d9604f")
    S = [box(x, y0, 6.0, x + 4.2, y1, 6.0 + h, planter),
         box(x, y0, 0, x + 1.0, y0 + 1.0, 6.0, flat(TEAK)), box(x, y1 - 1.0, 0, x + 1.0, y1, 6.0, flat(TEAK))]
    yy = y0 + 2.2
    k = 0
    while yy < y1 - 1.5:
        hi = ("#69c35c", "#8fd36a", "#4b9e55", "#a2d86a")[k % 4]
        S.append(blob(x + 2.1, yy, 6.0 + h + 1.2, 1.6, leafy(seed + k, "#2e7d3a", "#4b9e55", hi), n=12, seed=seed + k))
        if k % 3 == 1:
            S.append(blob(x + 2.6, yy + 0.5, 6.0 + h + 2.4, 0.5, flat("#e8436a"), n=8))   # chilli
        yy += 3.6
        k += 1
    return S


def fridge(x0, y0, x1, y1, h=15.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(STEEL)
        if f == "R":
            if abs(p[1] - (y0 + y1) / 2) < 0.25:
                return rgb(STEEL_D)                  # door split
            if abs(p[1] - (y0 + y1) / 2 - 1.2) < 0.35 and 6 < p[2] < 11:
                return rgb("#4a5058")                # handle
            if abs(p[1] - (y0 + y1) / 2 + 1.2) < 0.35 and 6 < p[2] < 11:
                return rgb("#4a5058")
            if 12.0 < p[2] < 13.2 and abs(p[1] - y0 - 2.0) < 1.0:
                return (rgb("#3ddc97"), True)        # temp display
        return rgb(STEEL_L) if f == "R" else rgb(STEEL)
    return [box(x0, y0, 0, x1, y1, h, m)]


def interior_review(W, D, slab):
    mat_ = (1.05 * U - 2, 1.1 * U - 5, W - 1.05 * U + 2, 3.15 * U + 5)   # anti-fatigue mat under the agents

    def floor(p):
        x, y = p[0], p[1]
        mx0, my0, mx1, my1 = mat_
        if mx0 <= x <= mx1 and my0 <= y <= my1:
            edge = min(x - mx0, mx1 - x, y - my0, my1 - y)
            if edge < 1.3:
                return rgb(LAGOON_D)
            if edge < 2.3:
                return rgb("#e9dcb8")
            return weave(x + y, x - y, "#d8c48f", "#c4ad74", 1.4)
        # terracotta kitchen tiles
        t = 5.86
        if x % t < 0.4 or y % t < 0.4:
            return rgb("#e9dcc6")
        h = hash2(int(x // t), int(y // t), 84)
        return rgb("#d0703f") if h > 0.6 else (rgb("#c4653a") if h > 0.25 else rgb("#d97b48"))

    def wall(which, u, z):
        # white tile splashback with a lagoon band, teak cap
        if z < 1.0:
            return rgb(TEAK_D)
        if z > 12.0:
            return rgb(TEAK)
        if 5.0 < z < 6.2:
            return rgb(LAGOON) if int(u // 2.0) % 2 else rgb(LAGOON_D)
        if u % 3.0 < 0.3 or z % 2.4 < 0.3:
            return rgb("#d8dfe2")
        return rgb("#f7f8f6")

    S = room_shell(W, D, slab, floor, wall, trim=TEAK, side=STONE, side_dark=STONE_D,
                   wall_h=13.0, wall_t=1.2, door_n=(2.5 * U - DOOR_HALF, 2.5 * U + DOOR_HALF))
    T = 1.2
    dx = 2.5 * U
    S += door_frame_x(dx, 0.6, 18.0, "#a87f45", canopy=STRAW, out=-1)
    S += doormat(dx - 6.5, T + 0.4, dx + 6.5, T + 7.0, col="#c9a86a", edge=LAGOON_D)
    S += entrance_steps("N", (dx, 0), slab, col="#e2d3b0")

    # --- N line, left of the door: range with pots, prep counter
    S += steel_counter(T + 12.0, T + 0.4, 32.0, T + 8.0)
    S += range_top(T + 12.4, T + 0.8, 31.6, T + 7.6, 8.0)
    S += pot(T + 15.0, T + 3.0, 8.5, steam=True)
    S += pot(T + 22.0, T + 5.4, 8.5, r=1.5, h=2.0, col="#3a3f46")
    S += pot(T + 27.0, T + 3.0, 8.5, r=2.1, h=3.2, steam=True)
    S += steel_counter(32.5, T + 0.4, dx - DOOR_HALF - 1.5, T + 8.0)
    S += [box(35.0, T + 2.0, 8.0, 43.0, T + 6.4, 8.6, flat("#c9955c"))]          # chopping board
    S += [blob(37.0, T + 4.0, 9.1, 0.8, flat("#e8553f"), n=8), blob(39.5, T + 3.6, 9.0, 0.7, flat("#6cbf6a"), n=8),
          blob(41.2, T + 4.6, 9.0, 0.7, flat("#f7c548"), n=8)]
    S += [box(44.0, T + 3.0, 8.0, 48.0, T + 3.8, 8.3, flat(STEEL_L))]               # knife

    # --- N line, right of the door: sink + catch-of-the-day tray
    S += steel_counter(dx + DOOR_HALF + 1.5, T + 0.4, 96.0, T + 8.0)
    S += [box(dx + DOOR_HALF + 4.0, T + 1.6, 7.6, dx + DOOR_HALF + 13.0, T + 6.8, 8.1, flat("#7d8790")),
          vcyl(dx + DOOR_HALF + 8.5, T + 1.4, 0.4, 8.0, 11.5, flat(STEEL_L), sides=6),
          box(dx + DOOR_HALF + 8.1, T + 1.4, 11.0, dx + DOOR_HALF + 8.9, T + 3.6, 11.5, flat(STEEL_L))]
    S += fish_tray(82.0, T + 1.6, 8.0)

    # --- NW corner fridge, W wall herb boxes, produce crates at the front-left
    S += fridge(T + 0.4, T + 0.4, T + 9.0, T + 11.0)
    S += herb_box_y(T + 0.4, 20.0, 52.0, seed=3)
    S += produce_crate(T + 1.0, 60.0, "pineapple")
    S += produce_crate(T + 1.0, 67.0, "coconut")
    S += produce_crate(T + 10.0, D - 14.0, "mango")
    S += produce_crate(T + 19.0, D - 12.0, "banana", w=8.0, d=5.0)
    S += [vcyl(T + 5.0, D - 7.0, 3.0, 0, 6.0, flat("#e2d3b0"), sides=8),             # rice sack
          blob(T + 5.0, D - 7.0, 6.2, 2.4, flat("#d6c59c"), n=12, squash=0.6)]

    # --- E edge: the PASS — steel counter, plates under heat lamps, ticket rail, REVIEW board
    px0, px1 = W - 10.0, W - 2.0
    py0, py1 = 18.0, 72.0
    S += steel_counter(px0, py0, px1 - 0.6, py1, h=10.4)
    for i, yy in enumerate((24.0, 31.0, 38.0, 45.0, 52.0, 59.0, 66.0)):
        if i in (2, 5):
            continue
        foods = (("#e8553f", "#6cbf6a", "#f7c548"), ("#f2a43a", "#ffffff", "#4b9e55"),
                 ("#5c8fb8", "#f7e14b", "#69c35c"), ("#e8436a", "#fbf1d6", "#6cbf6a"))[i % 4]
        S += plate(px0 + 4.0, yy, 10.4, food=foods)
    S += order_bell(px0 + 4.2, 38.0, 10.4)
    S += tasting_spoons(px0 + 4.0, 59.0, 10.4)
    for yy in (py0 + 1.0, py1 - 1.0):
        S.append(box(px1 - 1.4, yy - 0.6, 10.4, px1 - 0.2, yy + 0.6, 22.0, flat(STEEL_D)))
    S.append(box(px1 - 1.6, py0, 17.6, px1, py1, 18.6, flat(STEEL)))
    for yy in (27.5, 41.5, 55.5, 66.0):
        S += heat_lamp(px0 + 4.0, yy, 14.2)
        S.append(box(px0 + 4.0 - 0.15, yy - 0.15, 17.6, px1 - 1.0, yy + 0.15, 17.8, flat("#2b2b2b")))
    S += ticket_rail_y(px1 - 0.8, py0 + 1.0, py0 + 15.0, 13.8)
    S += wood_signboard_y(px1 + 0.2, py0 + 3.0, py1 - 3.0, "REVIEW", h0=-0.2, h1=10.6, icon="magnifier")[:1]

    # --- front-right: potted palm
    S += potted_palm(W - 7.0, D - 7.0, h=13.0, spread=4.4, seed=17)
    return S


# ------------------------------------------------------------------ IDLE: pool bar
def slab_yslope(x0, x1, y0, y1, z_at_y0, z_at_y1, thick, mat):
    """Thin sloped slab spanning y0..y1 whose top falls linearly from z_at_y0 to z_at_y1."""
    k = (z_at_y1 - z_at_y0) / (y1 - y0)          # dz/dy
    nrm = math.sqrt(1 + k * k)
    # top: z - k*y <= z_at_y0 - k*y0 ; bottom: z - k*y >= that - thick
    c = z_at_y0 - k * y0
    pl = [((1, 0, 0), x1), ((-1, 0, 0), -x0), ((0, 1, 0), y1), ((0, -1, 0), -y0),
          ((0, -k / nrm, 1 / nrm), c / nrm), ((0, k / nrm, -1 / nrm), -(c - thick) / nrm)]
    zl, zh = min(z_at_y0, z_at_y1) - thick - 0.5, max(z_at_y0, z_at_y1) + 0.5
    pl += [((0, 0, 1), zh), ((0, 0, -1), -zl)]
    return Solid(pl, (x0, y0, zl, x1, y1, zh), mat)


def back_bar_bottles(x0, x1, y0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(TEAK_D)
        z = p[2]
        lvl = int((z - 11.0) // 4.2)
        r = (z - 11.0) % 4.2
        if r < 0.7:
            return rgb(TEAK)                         # bamboo shelf
        k = int((p[0] - x0) // 1.8)
        hgt = 2.0 + hash2(k, lvl, 91) * 1.4
        if r - 0.7 < hgt and (p[0] - x0) % 1.8 < 1.2:
            pal = [LAGOON, CORAL, SUN, "#7bd389", HIBISCUS, "#fbf1d6", "#c97b2e", "#3a86c8"]
            c = rgb(pal[int(hash2(k, lvl, 92) * 8) % 8])
            if r - 0.7 > hgt - 0.6 and (p[0] - x0) % 1.8 > 0.4:
                return rgb("#2b2b2b")                # cap
            return (c, True) if hash2(k, lvl, 93) > 0.7 else c
        return rgb("#3b2616")
    return [box(x0, y0, 11.0, x1, y0 + 2.6, 23.6, m)]


def coconut_drink(cx, cy, z, umb=HIBISCUS):
    return [blob(cx, cy, z + 1.0, 1.0, flat("#6b4a2b"), n=10),
            box(cx - 0.1, cy - 0.1, z + 1.6, cx + 0.1, cy + 0.1, z + 3.2, flat("#fbf1d6")),
            cone(cx + 0.3, cy, z + 3.0, 1.1, 0.7, flat(umb), sides=6)]


def cocktail(cx, cy, z, col=CORAL):
    return [vcyl(cx, cy, 0.7, z, z + 2.2, lambda p, n: (rgb(col), True), sides=6),
            blob(cx + 0.6, cy, z + 2.3, 0.4, flat("#7bd389"), n=8)]


def tiki_counter_x(x0, x1, y0, d=7.0, h=9.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(TEAK_L) if int(p[0] // 5) % 2 else rgb("#c08a52")
        if p[2] < 0.8:
            return rgb(TEAK_D)
        if p[2] > h - 1.0:
            return rgb(TEAK)
        coord = p[0] if f == "L" else -p[1]
        k = coord % 2.2
        if k < 0.35:
            return rgb("#8c6a34")
        # tiki mask panels every 22 units
        if f == "L":
            mk = (p[0] - x0) % 22.0
            if 8.0 < mk < 14.0 and 1.6 < p[2] < h - 1.6:
                mu, mz = mk - 11.0, p[2] - 4.6
                if abs(mz - 1.2) < 0.5 and 0.6 < abs(mu) < 2.0:
                    return rgb(SUN)                  # eyes
                if abs(mz + 1.4) < 0.5 and abs(mu) < 1.8:
                    return rgb("#f2f2ee")            # teeth
                return rgb("#7a4e2a")
        c = rgb("#d4b06a") if int(coord // 2.2) % 2 else rgb("#c9a45e")
        return c * (0.92 if f != "L" else 1.0)
    return [box(x0, y0, 0, x1, y0 + d, h, m),
            box(x0 - 0.8, y0 - 0.4, h, x1 + 0.8, y0 + d + 1.0, h + 1.0, flat(TEAK))]


def bamboo_stool(cx, cy, col=LAGOON):
    return [vcyl(cx, cy, 0.5, 0, 6.5, bamboo_mat(int(cx)), sides=6),
            vcyl(cx, cy, 1.5, 0, 0.4, flat(TEAK_D), sides=6),
            vcyl(cx, cy, 1.9, 6.5, 7.5, flat(col), sides=10)]


def surfboard_upright(cx, y, h=24.0, w=4.2, col=SUN, stripe=LAGOON):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if abs(p[0] - cx) < 0.5 and f in ("L", "top"):
            return rgb(stripe)
        if abs(p[2] - h * 0.7) < 0.7 and f == "L":
            return rgb(stripe)
        return rgb(col)
    S = [box(cx - w / 2, y, 1.0, cx + w / 2, y + 1.0, h - w / 2, m),
         blob(cx, y + 0.5, h - w / 2, w / 2, m, n=14, squash=1.0),
         blob(cx, y + 0.5, 1.0 + w / 2.6, w / 2.2, m, n=12, squash=1.0)]
    return S


def sun_lounger_x(x0, cy, col="#fbf1d6", stripe=LAGOON, length=15.0):
    """Lounger along x, backrest raised at the +x end (sitter looks toward -x... the pool side)."""
    def cushion(p, n):
        f, u, v = face_uv(p, n)
        return rgb(stripe) if int((p[1] - cy + 3) // 1.5) % 2 else rgb(col)
    S = [box(x0, cy - 3.0, 2.0, x0 + length - 4.0, cy + 3.0, 3.2, cushion),
         slab_between(x0 + length - 5.0, x0 + length, cy - 3.0, cy + 3.0, 3.2 - (x0 + length - 5.0) + 1.0 + 6.0,
                      3.2 - (x0 + length - 5.0) - 0.6 + 6.0, -1, cushion, z_lo=2.0)]
    for (lx, ly) in ((x0 + 0.8, cy - 2.6), (x0 + 0.8, cy + 2.2), (x0 + length - 1.6, cy - 2.6), (x0 + length - 1.6, cy + 2.2)):
        S.append(box(lx, ly, 0, lx + 0.6, ly + 0.6, 2.0, flat(TEAK)))
    return S


def beach_umbrella(cx, cy, h=17.0, r=8.0, cols=(CORAL, "#fbf1d6")):
    def canopy(p, n):
        a = math.atan2(p[1] - cy, p[0] - cx)
        return rgb(cols[int((a + math.pi) / (2 * math.pi) * 8) % 2])
    return [vcyl(cx, cy, 0.4, 0, h, flat("#fbf1d6"), sides=6),
            cone(cx, cy, h - 2.6, r, 3.2, canopy, sides=8),
            vcyl(cx, cy, 0.6, h + 0.5, h + 1.2, flat(TEAK), sides=6)]


def hammock_y(x, y0, y1, h=11.0, col=CORAL):
    """Two palm-trunk posts with a sagging striped hammock between them (along y)."""
    S = [pole_z(x, y0, 0, h + 3.0, r=1.0, seed=1), pole_z(x, y1, 0, h + 3.0, r=1.0, seed=2)]
    n_ = 10
    for i in range(n_):
        t0, t1 = i / n_, (i + 1) / n_
        ya, yb = y0 + 1.0 + (y1 - y0 - 2.0) * t0, y0 + 1.0 + (y1 - y0 - 2.0) * t1
        tm = (t0 + t1) / 2
        z = h - 6.5 * math.sin(math.pi * tm)

        def m(p, n, i=i):
            return rgb(col) if int((p[0] - x + 3) // 1.2) % 2 else rgb("#fbf1d6")
        S.append(box(x - 2.6, ya, z - 0.5, x + 2.6, yb, z + 0.3, m))
    S.append(box(x - 0.15, y0, h - 0.3, x + 0.15, y0 + 1.6, h + 0.2, flat("#c9a26a")))
    S.append(box(x - 0.15, y1 - 1.6, h - 0.3, x + 0.15, y1, h + 0.2, flat("#c9a26a")))
    return S


def tiki_torch(cx, cy, h=14.0):
    return [pole_z(cx, cy, 0, h, r=0.5, seed=3),
            vcyl(cx, cy, 1.0, h - 1.5, h, flat("#5e3b20"), sides=6),
            blob(cx, cy, h + 1.0, 0.95, lambda p, n: (rgb("#ffb347"), True), n=10, squash=1.4),
            blob(cx, cy, h + 1.9, 0.5, lambda p, n: (rgb("#fff1a8"), True), n=8)]


def flamingo_ring(cx, cy, z):
    pink = flat("#f48fb1")
    S = []
    for i in range(10):
        a = i * 2 * math.pi / 10
        S.append(blob(cx + math.cos(a) * 3.0, cy + math.sin(a) * 3.0, z + 0.8, 1.2, pink, n=10))
    S.append(vcyl(cx + 3.0, cy, 0.6, z + 1.2, z + 5.6, pink, sides=6))
    S.append(blob(cx + 3.6, cy, z + 5.9, 1.0, pink, n=10))
    S.append(blob(cx + 4.6, cy, z + 5.6, 0.45, flat("#2b2b2b"), n=8))
    return S


def beach_ball(cx, cy, z):
    def m(p, n):
        a = math.atan2(p[1] - cy, p[0] - cx)
        return rgb((CORAL, "#fbf1d6", SUN, LAGOON)[int((a + math.pi) / (math.pi / 2)) % 4])
    return [blob(cx, cy, z + 1.4, 1.4, m, n=14)]


def pool_ladder(x, y, z):
    S = []
    for dx in (-1.6, 1.6):
        S.append(vcyl(x + dx, y + 1.6, 0.3, z, z + 4.6, flat(STEEL_L), sides=6))
        S.append(hcyl("y", x + dx, z + 4.6, 0.3, y - 0.2, y + 1.8, flat(STEEL_L), sides=6))
    return S


def interior_idle(W, D, slab):
    T = WALL_T
    pool = (26.0, D - 42.0, W - 30.0, D - 9.0)                # front pool, clear of the agents
    deck = (1.5 * U - 4, 1.6 * U - 2, W - 1.5 * U + 4, D - 2.1 * U + 2)

    def floor(p):
        x, y = p[0], p[1]
        px0, py0, px1, py1 = pool
        if px0 <= x <= px1 and py0 <= y <= py1:
            edge = min(x - px0, px1 - x, y - py0, py1 - y)
            if edge < 2.2:
                return rgb("#f4efe2")                 # coping
            if edge < 3.0:
                return rgb("#6fd3d6")                 # tile band
            depth = min(1.0, (y - py0) / (py1 - py0) * 0.8 + 0.2)
            c = mix(rgb("#58d0d6"), rgb("#2aa3b8"), depth)
            # caustics
            w = math.sin(x * 0.55 + math.sin(y * 0.4) * 2.0) + math.sin(y * 0.7 - x * 0.2)
            if w > 1.55:
                return (rgb("#c8f5f2"), True)
            if abs(x - (px0 + px1) / 2) < 0.4 and edge > 4 and int(y) % 3 == 0:
                return c * 0.9                        # lane line
            return (c, True) if w > 1.3 else c
        dx0, dy0, dx1, dy1 = deck
        if dx0 <= x <= dx1 and dy0 <= y <= dy1:
            edge = min(x - dx0, dx1 - x, y - dy0, dy1 - y)
            if edge < 1.0:
                return rgb(TEAK_D)
            if 3.0 < edge < 4.2:
                return rgb(LAGOON_D)                  # inlay border
            board = int(x // 3.6)
            if x % 3.6 < 0.35 or (y + board * 13.3) % 31.0 < 0.35:
                return rgb("#8a5a32")
            hh = hash2(board, int(y / 2), 94)
            return rgb("#c99a62") if hh > 0.5 else rgb("#c19058")
        # pale sandstone pool-deck pavers
        t = 7.8
        if x % t < 0.45 or y % t < 0.45:
            return rgb("#d9cdb2")
        h = hash2(int(x // t), int(y // t), 95)
        return rgb("#efe5cc") if h > 0.5 else (rgb("#e8dcc0") if h > 0.2 else rgb("#f4ead3"))

    def wall(which, u, z):
        if which == "W":            # low bamboo screen
            if z < 1.0:
                return rgb(TEAK_D)
            if z > 8.6:
                return rgb(TEAK)
            k = u % 2.0
            if k < 0.3:
                return rgb("#8c6a34")
            return rgb("#d4b06a") if int(u // 2.0) % 2 else rgb("#c9a45e")
        return resort_wall()(which, u, z)

    door_y = (6.3 - 1.2) * U
    S = room_shell(W, D, slab, floor, wall, trim=TEAK, side=STONE, side_dark=STONE_D,
                   wall_h_w=9.6, door_w=(door_y - DOOR_HALF, door_y + DOOR_HALF))
    S += thatch_eave_x(0, W, 0, T + 2.6, 30.0, drop=2.4)
    S += door_frame_y(0.6, door_y, 18.0, "#a87f45", canopy=(STRAW, STRAW_L))
    S += doormat(T + 0.4, door_y - 6.5, T + 7.0, door_y + 6.5, col="#c9a86a", edge=LAGOON_D)
    S += entrance_steps("W", (door_y, 0), slab, n_steps=1, col="#e2d3b0")

    # --- tiki bar along the N wall: bottle shelves, IDLE board, thatched awning, counter, stools
    S += back_bar_bottles(24.0, 92.0, T)
    S += carved_sign_x(50.0, 84.0, T + 14.4, 21.6, 31.0, "IDLE", icon="drink")
    S.append(slab_yslope(20.0, 116.0, T, T + 15.0, 26.5, 20.5, 1.6, thatch_mat(2)))
    for px in (22.0, 114.0):
        S.append(pole_z(px, T + 14.0, 0, 20.5, r=0.8, seed=int(px)))
    cy0 = T + 10.0
    S += tiki_counter_x(24.0, 112.0, cy0)
    S += [box(30.0, cy0 + 1.4, 10.0, 34.0, cy0 + 4.4, 15.0, flat("#e9eef2")),          # blender
          box(30.4, cy0 + 1.8, 15.0, 33.6, cy0 + 4.0, 15.6, flat("#2b2b2b"))]
    S += coconut_drink(42.0, cy0 + 4.0, 10.0)
    S += coconut_drink(47.0, cy0 + 3.2, 10.0, umb=SUN)
    S += cocktail(56.0, cy0 + 4.0, 10.0, col=CORAL)
    S += cocktail(60.0, cy0 + 3.0, 10.0, col=LAGOON)
    S += [blob(70.0, cy0 + 3.6, 11.0, 2.0, flat("#e0a530"), n=12, squash=0.7),        # fruit bowl
          blob(69.0, cy0 + 3.0, 12.4, 0.9, flat("#e8553f"), n=8), blob(71.2, cy0 + 4.2, 12.4, 0.9, flat("#7bd389"), n=8)]
    S += coconut_drink(84.0, cy0 + 3.6, 10.0, umb=LAGOON)
    S += cocktail(96.0, cy0 + 3.4, 10.0, col=SUN)
    S += service_bell(105.0, cy0 + 3.6, 10.0)
    for i, sxp in enumerate((32.0, 44.0, 56.0, 68.0, 80.0, 92.0, 104.0)):
        S += bamboo_stool(sxp, cy0 + 11.0, col=(LAGOON, CORAL, SUN)[i % 3])

    S += schedule_board_x(118.0, 131.0, T, 10.5, 24.5, seed=12)       # cocktail menu
    # --- N wall right: surfboards against the wall + a sea-view window
    for i, (sx, col, st) in enumerate(((136.0, SUN, LAGOON), (143.0, LAGOON, "#fbf1d6"), (150.0, CORAL, SUN))):
        S += surfboard_upright(sx, T + 0.2 + i * 0.3, h=24.0 - i * 2.0, col=col, stripe=st)
    S += ocean_window_x(163.0, W - 9.0, T, 11.5, 25.0)

    # --- NW corner palm, W side: hammock + tiki torches along the bamboo screen
    S += potted_palm(T + 8.0, T + 8.0, h=20.0, spread=6.4, seed=21)
    S += hammock_y(T + 7.0, door_y + DOOR_HALF + 14.0, door_y + DOOR_HALF + 56.0)
    for ty in (40.0, door_y - DOOR_HALF - 3.0, door_y + DOOR_HALF + 3.0):
        S += tiki_torch(T + 2.5, ty)

    # --- E side (open): loungers under umbrellas, facing the pool
    for ly, cols in ((52.0, (CORAL, "#fbf1d6")), (98.0, (LAGOON, "#fbf1d6")), (144.0, (SUN, "#fbf1d6"))):
        S += sun_lounger_x(W - 19.0, ly, stripe=cols[0])
        S += beach_umbrella(W - 8.5, ly - 8.5, cols=cols)

    # --- front: the pool with a ladder, flamingo ring + beach ball; palms on the front corners
    px0, py0, px1, py1 = pool
    S.append(box(px0, py0, 0, px1, py0 + 2.2, 0.8, flat("#f4efe2")))     # raised coping lip (back edge)
    S += pool_ladder(px0 + 12.0, py0 + 0.4, 0.0)
    S += flamingo_ring((px0 + px1) / 2 + 14.0, (py0 + py1) / 2 + 2.0, -0.4)
    S += beach_ball(px0 + 30.0, py0 + 12.0, -0.6)
    from island_props import palm
    for (cx, cy, lean, seed) in ((12.0, D - 14.0, 0.8, 3), (W - 12.0, D - 12.0, -0.6, 5)):
        S += translate(palm(seed=seed, lean=lean), cx, cy)
    return S


def translate(solids, dx, dy, dz=0.0):
    """Shift solids built around the origin (palm() etc.) to (dx, dy, dz)."""
    out = []
    for s_ in solids:
        planes = []
        for (nrm, d) in s_.planes:
            nrm = tuple(float(v) for v in nrm)
            planes.append((nrm, d + nrm[0] * dx + nrm[1] * dy + nrm[2] * dz))
        b = s_.aabb
        out.append(Solid(planes, (b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz), s_.mat,
                         cast=getattr(s_, "cast", True)))
    return out


ISLAND_INTERIORS = {
    "specs": (interior_specs,) + tuple(CITY_INTERIORS["specs"][1:]),
    "plan": (interior_plan,) + tuple(CITY_INTERIORS["plan"][1:]),
    "build": (interior_build,) + tuple(CITY_INTERIORS["build"][1:]),
    "review": (interior_review,) + tuple(CITY_INTERIORS["review"][1:]),
    "idle": (interior_idle,) + tuple(CITY_INTERIORS["idle"][1:]),
}


def build(zid):
    fn, gw, gh, elev_px = ISLAND_INTERIORS[zid]
    return fn(gw * U, gh * U, elev_px / 2.0)


if __name__ == "__main__":
    from props import solid_hull
    os.makedirs("out", exist_ok=True)
    man = json.load(open("out/manifest.json")) if os.path.exists("out/manifest.json") else {}
    for zid in (sys.argv[1:] or ISLAND_INTERIORS):
        S = build(zid)
        im, anchor = render(S, ground_shadow=0)
        name = f"island_interior_{zid}"
        im.save(f"out/{name}.png")
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1], unitsPerGrid=U,
                         hull=solid_hull(S, anchor))
        print(name, im.size, anchor)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
