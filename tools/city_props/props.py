"""City prop library built on isopix. Run: python3 props.py  -> out/*.png + manifest."""
import math, json, os, sys
import numpy as np
from isopix import (box, vcyl, hcyl, blob, Solid, face_uv, rgb, mix, text_hit,
                    hash2, render, plane_through)

G = 22  # units per board grid cell


def cone(cx, cy, z0, r, h, mat, sides=10, **kw):
    pl = [((0, 0, -1), -z0)]
    for i in range(sides):
        a = math.pi / sides + 2 * math.pi * i / sides
        n = np.array([math.cos(a) * h, math.sin(a) * h, r])
        p = np.array([cx + r * math.cos(a), cy + r * math.sin(a), z0])
        pl.append((tuple(n), float(n @ p)))
    return Solid(pl, (cx - r, cy - r, z0, cx + r, cy + r, z0 + h), mat, **kw)


def flat(c):
    c = rgb(c) if isinstance(c, str) else c
    return lambda p, n: c


# ------------------------------------------------------------ shared materials
def glass_px(u, v, base="#5f9fc8", hi="#bfe6f7", lo="#2e5a80", t=0.5, streak=True):
    col = mix(rgb(lo), rgb(base), min(1, t * 1.4))
    if streak:
        s = (u * 0.6 + v) % 19
        if s < 2.2:
            col = mix(col, rgb(hi), 0.75)
        elif s < 3.2:
            col = mix(col, rgb(hi), 0.35)
    return col


def roof_mat(c="#9aa1aa", grit="#868d97"):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return mix(rgb(c), rgb(grit), 1.0) if hash2(u, v, 3) < 0.12 else rgb(c)
        return rgb(c) * 0.9
    return m


# ------------------------------------------------------------ BUILDINGS
def tower_glass(seed=1):
    W, D, Hh = 40, 34, 112
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    concrete = rgb("#e4e2dc")
    band = rgb("#c9c6bf")
    mull = rgb("#3d4a5c")

    def facade(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#8e959e")
        # corner pilasters
        uu = u - (x0 if f == "L" else -y1)
        span = (W if f == "L" else D)
        if uu < 2 or uu > span - 2:
            return concrete
        if v < 11:  # lobby
            if v > 9.5:
                return band
            mid = span / 2
            if f == "L" and abs(uu - mid) < 4 and v < 8:
                return rgb("#2a3442") if abs(uu - mid) < 0.6 else glass_px(u, v, base="#7fb3cf", t=v / 8)
            if (uu - 2) % 6 < 1:
                return mull
            return glass_px(u, v, base="#6aa4c6", t=v / 10)
        vv = v - 11
        fl = int(vv // 7)
        r = vv % 7
        if r < 1.6:
            return band
        cell = int((uu - 2) // 4)
        if (uu - 2) % 4 < 0.9:
            return mull
        h = hash2(cell + (0 if f == "L" else 50), fl, seed)
        t = (r - 1.6) / 5.4
        if h < 0.10:
            return (mix(rgb("#ffd77a"), rgb("#ffefb0"), t), True)
        if h < 0.17:
            return rgb("#d9e2ea") if int(r * 2) % 2 else rgb("#b8c6d2")  # blinds
        return glass_px(u, v, t=t)

    S = [box(x0, y0, 0, x1, y1, Hh, facade, name="body")]
    # lobby canopy
    S.append(box(-9, y1, 9.5, 9, y1 + 4, 11, flat("#d8d6d0")))
    # parapet
    par = flat("#cfccc5")
    S += [box(x0, y0, Hh, x1, y0 + 1.5, Hh + 3, par), box(x0, y1 - 1.5, Hh, x1, y1, Hh + 3, par),
          box(x0, y0, Hh, x0 + 1.5, y1, Hh + 3, par), box(x1 - 1.5, y0, Hh, x1, y1, Hh + 3, par)]
    # rooftop plant + tank + antenna
    S.append(box(-12, -10, Hh, 2, 2, Hh + 9, roof_unit("#b9bec6")))
    S.append(vcyl(10, 7, 4.5, Hh, Hh + 8, tank_mat(), sides=10))
    S.append(box(8, -12, Hh, 14, -6, Hh + 4, fan_mat()))
    S.append(vcyl(-5, -4, 0.8, Hh + 9, Hh + 26, flat("#d0d4da"), sides=6))
    S.append(box(-5.6, -4.6, Hh + 26, -4.4, -3.4, Hh + 27.5, lambda p, n: (rgb("#ff5a4a"), True)))
    return S


def roof_unit(c):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(c) * (1.06 if int(u) % 4 == 0 else 1.0)
        if f in ("L", "R") and 2 < v - p[2] + p[2] and int(u) % 3 == 0:
            return rgb(c) * 0.82
        return rgb(c)
    return m


def tank_mat():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#c8ccd2")
        return rgb("#b0b6be") if int(p[2]) % 3 else rgb("#9aa0a8")
    return m


def fan_mat():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            cx, cy = 11, -9
            d = math.hypot(p[0] - cx, p[1] - cy)
            if d < 2.4:
                return rgb("#3a4048") if (math.atan2(p[1] - cy, p[0] - cx) * 3 // 1) % 2 else rgb("#5a626c")
            return rgb("#aab0b8")
        return rgb("#959ba4")
    return m


def tower_brick(seed=2):
    W, D, Hh = 38, 30, 80
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    brick = rgb("#b5603f")
    brick2 = rgb("#a4553a")
    trim = rgb("#efe3cf")

    def facade(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#8d8f93")
        span = W if f == "L" else D
        uu = u - (x0 if f == "L" else -y1)
        base = brick2 if (int(v) % 2 == 0 and (int(uu + (v // 2) * 2) % 5 == 0)) else brick
        if v < 13:  # shopfront level
            if v > 11:
                return trim
            if uu < 1.5 or uu > span - 1.5:
                return trim * 0.95
            seg = (uu - 1.5) % 12
            if seg < 1.5:
                return trim * 0.9
            if f == "L" and 4 < seg < 8 and v < 8 and int((uu - 1.5) // 12) == 1:
                return rgb("#3b2a20") if seg > 5.5 else rgb("#5a3e2c")
            if v < 1.5:
                return rgb("#6d6f73")
            t = v / 11
            g = glass_px(u, v, base="#73a9c4", t=t)
            if v < 4 and hash2(int(uu // 2), 0, seed) < 0.5:  # goods in window
                g = rgb(["#f2c14e", "#e86a5c", "#7cc47a", "#f6efe2"][int(uu) % 4])
            return g
        vv = v - 13
        fl, r = int(vv // 10), vv % 10
        cell, cu = int((uu - 2) // 7), (uu - 2) % 7
        if cu > 1.5 and cu < 6 and 2 < r < 8 and uu > 2 and uu < span - 2:
            if r < 2.8:
                return trim  # sill
            if cu < 2.3 or cu > 5.2 or r > 7.2:
                return trim
            if abs(r - 5.2) < 0.4:
                return trim * 0.92  # transom
            h = hash2(cell + (0 if f == "L" else 30), fl, seed)
            if h < 0.14:
                return (rgb("#ffd98a"), True)
            g = glass_px(u, v, base="#4f7f9f", lo="#22384d", t=(r - 2.8) / 4.4, streak=False)
            if cu < 3.1 and r > 6:
                g = mix(g, rgb("#cfeaf6"), 0.6)
            if h > 0.85:
                g = rgb("#f0e6d8") if r > 5.6 else g  # curtain
            return g
        return base

    S = [box(x0, y0, 0, x1, y1, Hh, facade)]
    # cornice
    cor = flat("#e8dcc6")
    S.append(box(x0 - 1, y0 - 1, Hh - 1, x1 + 1, y1 + 1, Hh + 2, cor))
    S.append(box(x0, y0, Hh + 2, x1, y1, Hh + 3, flat("#d6c9b2")))
    # awnings over shopfront (left face)
    for k, colr in enumerate(["#2f7d5b", "#2f7d5b", "#2f7d5b"]):
        ax0 = x0 + 2 + k * 12
        S.append(awning(ax0 + 1, ax0 + 11, y1, 10.5, 4, ["#2f7d5b", "#f2efe6"], axis="x"))
    # water tower
    legs = flat("#5b4636")
    for dx, dy in ((-3, -3), (3, -3), (-3, 3), (3, 3)):
        S.append(box(6 + dx - 0.6, -2 + dy - 0.6, Hh + 3, 6 + dx + 0.6, -2 + dy + 0.6, Hh + 10, legs))
    S.append(vcyl(6, -2, 5, Hh + 10, Hh + 21, wood_tank(), sides=12))
    S.append(cone(6, -2, Hh + 21, 5.4, 4, flat("#4a3a2e"), sides=12))
    S.append(box(-14, 2, Hh + 3, -6, 10, Hh + 8, roof_unit("#b7bcc3")))
    return S


def wood_tank():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#8a6a4c")
        c = rgb("#8f6b4b")
        if int(p[2]) % 4 == 0:
            return rgb("#4b4a4c")
        a = math.atan2(p[1] + 2, p[0] - 6)
        return c * (0.92 if int(a * 8) % 2 else 1.0)
    return m


def awning(a0, a1, wall, z_top, depth, cols, axis="x", drop=3.0, thick=1.0):
    """Sloped striped awning projecting from a wall plane (y=wall if axis=='x')."""
    s = drop / depth
    if axis == "x":
        n_top = (0, s, 1)
        pt = np.array([0, wall, z_top])
        pl = [((1, 0, 0), a1), ((-1, 0, 0), -a0), ((0, 1, 0), wall + depth), ((0, -1, 0), -wall)]
        pl.append((n_top, float(np.dot(n_top, pt))))
        nb = (0, -s, -1)
        pl.append((nb, float(np.dot(nb, pt - np.array([0, 0, thick])))))
        aabb = (a0, wall, z_top - drop - thick, a1, wall + depth, z_top)

        def m(p, n):
            k = int((p[0] - a0) // 2.5) % 2
            c = rgb(cols[k])
            d = (p[1] - wall) / depth
            if d > 0.9:
                c = c * 0.9
            return c
    else:
        n_top = (s, 0, 1)
        pt = np.array([wall, 0, z_top])
        pl = [((0, 1, 0), a1), ((0, -1, 0), -a0), ((1, 0, 0), wall + depth), ((-1, 0, 0), -wall)]
        pl.append((n_top, float(np.dot(n_top, pt))))
        nb = (-s, 0, -1)
        pl.append((nb, float(np.dot(nb, pt - np.array([0, 0, thick])))))
        aabb = (wall, a0, z_top - drop - thick, wall + depth, a1, z_top)

        def m(p, n):
            k = int((p[1] - a0) // 2.5) % 2
            return rgb(cols[k])
    return Solid(pl, aabb, m)


def tower_deco(seed=3):
    S = []
    sand, sand2 = rgb("#e9d9b6"), rgb("#d8c59d")
    gl = "#3f8f96"

    def tier(W, D, z0, z1, crown=False):
        x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2

        def m(p, n):
            f, u, v = face_uv(p, n)
            if f == "top":
                return rgb("#a8a196")
            span = W if f == "L" else D
            uu = u - (x0 if f == "L" else -y1)
            if uu < 2.5 or uu > span - 2.5:
                return sand2
            cu = (uu - 2.5) % 5
            if cu < 1.6:
                return sand  # vertical piers
            r = (p[2] - z0) % 6
            if z0 == 0 and p[2] < 10:
                if f == "L" and abs(uu - span / 2) < 4:
                    return rgb("#2a2f33") if p[2] < 7 else rgb("#c9a45a")
                if p[2] < 1.5:
                    return rgb("#8f877a")
                return glass_px(u, v, base="#5fa6aa", t=p[2] / 10)
            if r < 1.2:
                return rgb("#b98d4a") if crown else sand2  # spandrel
            h = hash2(int((uu - 2.5) // 5) + (0 if f == "L" else 40), int((p[2] - z0) // 6), seed)
            if h < 0.12:
                return (rgb("#ffe08f"), True)
            return glass_px(u, v, base=gl, lo="#1e4d55", hi="#bfeeee", t=(r - 1.2) / 4.8)
        S.append(box(x0, y0, z0, x1, y1, z1, m))
        # ledge
        S.append(box(x0 - 0.8, y0 - 0.8, z1 - 0.2, x1 + 0.8, y1 + 0.8, z1 + 1.5, flat("#f3e7cc")))

    tier(40, 34, 0, 58)
    tier(30, 25, 59.5, 92)
    tier(19, 16, 93.5, 112, crown=True)
    S.append(box(-6, -5, 113.5, 6, 5, 120, flat("#c9a45a")))
    S.append(vcyl(0, 0, 1.6, 120, 126, flat("#d9b866"), sides=8))
    S.append(cone(0, 0, 126, 1.6, 14, flat("#e8cc7a"), sides=8))
    return S


# ------------------------------------------------------------ SHOPS
SHOPS = [
    dict(name="BAKERY", body="#f1b5b8", trim="#fff4ea", awn=["#d9475a", "#fff4ea"], sign="#7a2333", ink="#fff4ea", goods=["#e8b56a", "#c4834a", "#f7e3c0"]),
    dict(name="BOOKS", body="#5b8fb8", trim="#eef3f6", awn=["#264b73", "#eef3f6"], sign="#1f2f45", ink="#f7d36b", goods=["#e05a4f", "#3f8f6b", "#f2c14e", "#6b5ba8"]),
    dict(name="FLOWERS", body="#f2d27a", trim="#fffaf0", awn=["#3f8f5a", "#fffaf0"], sign="#2f6a45", ink="#fffaf0", goods=["#e85a8a", "#f39a3c", "#ffffff", "#9b6bd8"]),
    dict(name="PHARMACY", body="#e8eef0", trim="#ffffff", awn=["#2aa77a", "#ffffff"], sign="#1f8a64", ink="#ffffff", goods=["#ffffff", "#7fd0e0", "#f2a0a0"]),
    dict(name="CAFE", body="#7a5a46", trim="#f3e6d3", awn=["#c8553d", "#f3e6d3"], sign="#2e211a", ink="#f3d08a", goods=["#f3e6d3", "#c8a27a"]),
    dict(name="DELI", body="#9cc79a", trim="#fbfaf2", awn=["#e0a33a", "#fbfaf2"], sign="#3e5f3c", ink="#fbfaf2", goods=["#e0a33a", "#d26b4a", "#f4e3b5"]),
]


def shop(i, one=False):
    c = SHOPS[i % len(SHOPS)]
    W, D, Hh = 38, 20, (22.5 if one else 37)
    SF = 15.0      # storefront top
    FA = 21.0      # fascia top
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    body, trim = rgb(c["body"]), rgb(c["trim"])
    seed = 10 + i
    door0, door1 = W - 10.5, W - 4.0   # in uu coords on the L face

    def facade(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#9a9ea4") if hash2(u, v, 5) > 0.1 else rgb("#8a8e94")
        span = W if f == "L" else D
        uu = u - (x0 if f == "L" else -y1)
        if f == "L":
            if v < SF:
                if v < 1.2:
                    return rgb("#5d6066")
                if uu < 1.5 or uu > span - 1.5:
                    return trim * 0.94  # pilasters
                if door0 < uu < door1:
                    if uu < door0 + 0.8 or uu > door1 - 0.8 or v > 12.4:
                        return trim * 0.9
                    if v < 11.4 and abs(uu - (door0 + door1) / 2) < 0.45:
                        return trim * 0.72
                    if abs(v - 6.5) < 0.4 and uu > (door0 + door1) / 2 + 0.6 and uu < (door0 + door1) / 2 + 1.8:
                        return rgb("#d8c070")
                    return glass_px(u, v, base="#6aa0bd", t=v / 12, streak=False) * 0.9
                if uu > door0 - 1.5:
                    return trim * 0.94
                if v < 3.0 or v > SF - 1.6:
                    return trim * 0.94
                if abs(uu - (door0 - 1.5) / 2 - 0.75) < 0.45:
                    return trim * 0.86  # mullion
                if v < 6.8:
                    g = c["goods"]
                    k = int(uu // 2)
                    if hash2(k, int(v // 2), seed) < 0.78:
                        return rgb(g[(k + int(v // 2)) % len(g)])
                    return rgb("#4b3b33")
                if v < 7.6:
                    return rgb("#4b3b33")
                return glass_px(u, v, base="#6aa7c4", t=(v - 7.5) / 6)
            if v < FA:
                return rgb(c["sign"])  # hidden behind fascia anyway
            if v > Hh - 2.5:
                return trim
            vv = v - FA
            cell = int((uu - 2.5) // 11)
            cu = (uu - 2.5) % 11
            if 1.8 < cu < 9.2 and 2.6 < vv < 12.2 and uu < span - 2:
                if vv < 3.8 or cu < 2.7 or cu > 8.3 or vv > 11.3:
                    return trim
                if abs(cu - 5.5) < 0.45:
                    return trim * 0.95
                h = hash2(cell, 1, seed)
                g = glass_px(u, v, base="#5e8fae", lo="#2b4a63", t=(vv - 3.8) / 7.5, streak=False)
                if cu < 3.9 and vv > 9.2:
                    g = mix(g, rgb("#d5eef8"), 0.6)
                if h < 0.35 and vv > 8.5:
                    g = rgb("#f6efe4")
                if h > 0.8:
                    return (rgb("#ffdb8a"), True)
                return g
            return body
        # side face
        if span - 2.6 < uu < span - 1.8:
            return rgb("#8c9096")
        if v < 1.2:
            return rgb("#5d6066")
        if 6 < uu < 13 and FA + 2 < v < Hh - 4:
            if 6.8 < uu < 12.2 and FA + 3 < v < Hh - 5:
                return glass_px(u, v, base="#5e8fae", lo="#2b4a63", t=(v - FA - 3) / 8, streak=False)
            return trim
        if v > Hh - 2.5:
            return trim
        return body * (0.96 if int(v) % 5 == 0 else 1.0)

    S = [box(x0, y0, 0, x1, y1, Hh, facade)]
    S.append(box(x0 - 0.8, y0 - 0.8, Hh, x1 + 0.8, y1 + 0.8, Hh + 1.6, flat(c["trim"])))
    # fascia sign, full width of storefront
    name = c["name"]
    tw = len(name) * 4 - 1
    sx0, sx1 = x0 + 0.5, x1 - 0.5
    tx = (sx0 + sx1) / 2 - tw / 2
    sign_bg, ink = rgb(c["sign"]), rgb(c["ink"])

    def signm(p, n):
        f, u, v = face_uv(p, n)
        if f == "L":
            if text_hit(name, u, v, round(tx), SF + 4.8):
                return (ink, True)
            if v > FA - 0.8 or v < SF + 0.6:
                return ink * 0.8
            return sign_bg
        if f == "top":
            return trim
        return sign_bg * 0.9
    S.append(box(sx0, y1, SF, sx1, y1 + 1.4, FA, signm))
    # awning over window (under fascia)
    S.append(awning(x0 + 1.5, x0 + door0 - 1.0, y1 + 1.4, SF - 1.2, 4.2, c["awn"], axis="x", drop=3.0))
    # step + door lamp
    S.append(box(x0 + door0 - 0.5, y1, 0, x0 + door1 + 0.5, y1 + 2, 0.9, flat("#b9bcc1")))
    S.append(box(x0 + (door0 + door1) / 2 - 0.7, y1 + 1.4, 13.4, x0 + (door0 + door1) / 2 + 0.7, y1 + 3.0, 14.6,
                 lambda p, n: (rgb("#ffe7a0"), True)))
    # flower boxes under upper windows
    for k in range(0 if one else 3):
        bx = x0 + 2.5 + k * 11 + 1.8
        if bx + 7.4 > x1 - 1:
            break
        S.append(box(bx, y1, FA + 1.6, bx + 7.4, y1 + 1.8, FA + 3.0, flat("#6b4a36")))
        S.append(box(bx + 0.3, y1 + 0.2, FA + 3.0, bx + 7.1, y1 + 1.6, FA + 4.4, planter_mat(seed + k)))
    S.append(box(-6, -6, Hh + 1.6, 2, -1, Hh + 6, roof_unit("#c3c7cd")))
    return S


def planter_mat(seed):
    def m(p, n):
        h = hash2(int(p[0] * 1.5), int(p[2] * 1.5), seed)
        if h < 0.22:
            return rgb(["#ff6b8a", "#ffd166", "#ffffff"][int(h * 13) % 3])
        return rgb("#3f8f4a") if h < 0.7 else rgb("#2e6e3a")
    return m


# ------------------------------------------------------------ CARS
CARS = {
    "sedan_red": dict(kind="sedan", paint="#d8443c"),
    "sedan_blue": dict(kind="sedan", paint="#3c6fd8"),
    "sedan_white": dict(kind="sedan", paint="#e9edf0"),
    "hatch_green": dict(kind="hatch", paint="#4fb38a"),
    "taxi": dict(kind="taxi", paint="#f4c430"),
    "van": dict(kind="van", paint="#f2f2ee"),
}


def car(spec):
    paint = rgb(spec["paint"])
    kind = spec["kind"]
    L = {"sedan": 28, "taxi": 28, "hatch": 24, "van": 31}[kind]
    Wd = 13 if kind != "van" else 14
    hx, hy = L / 2, Wd / 2
    zb0, zb1 = 2.4, 9.0
    glass_c = rgb("#24394a")
    wr = 3.1
    wxs = [-hx + 6.0, hx - 6.0] if kind != "hatch" else [-hx + 5.0, hx - 5.0]

    def near_wheel(x, z):
        return min(math.hypot(x - w, z - wr) for w in wxs)

    def body_m(p, n):
        f, u, v = face_uv(p, n)
        c = paint.copy()
        if f == "L":  # visible side
            if near_wheel(p[0], p[2]) < wr + 1.0:
                return rgb("#17181b")  # wheel arch
            if abs(p[0] - (-1.5 if kind != "hatch" else 0)) < 0.4 and p[2] > 3.4:
                return c * 0.62  # door seam
            if abs(p[0] - (1.0 if kind != "hatch" else 2.5)) < 0.6 and abs(p[2] - 7.0) < 0.4:
                return rgb("#e8e8e8")  # handle
            if p[2] < 4.2:
                return c * 0.74
            if p[2] > 8.0:
                return mix(c, rgb("#ffffff"), 0.22)  # shoulder highlight
            if kind == "taxi" and 5.4 < p[2] < 6.8:
                return rgb("#1d1d1f") if int((p[0] + 20) // 1.5) % 2 else rgb("#f7f7f2")
            return c
        if f == "R-":  # rear (visible when the car is mirrored to drive toward -x)
            yy = p[1]
            if p[2] < 4.0:
                return rgb("#2b2e33")
            if abs(yy) > hy - 3.0 and 5.6 < p[2] < 7.4:
                return (rgb("#ff3b30"), True)  # tail lights
            if abs(yy) < 2.6 and 4.4 < p[2] < 5.6:
                return rgb("#f2f2ea")  # number plate
            return c * 0.96
        if f == "R":  # front
            yy = p[1]
            if p[2] < 4.0:
                return rgb("#2b2e33")  # bumper
            if abs(yy) > hy - 3.2 and 5.4 < p[2] < 7.6:
                return (rgb("#fff6d0"), True)  # headlights
            if abs(yy) < hy - 4.2 and 4.8 < p[2] < 7.6:
                return rgb("#1f2226") if int(p[2] * 2) % 2 else rgb("#555a62")  # grille
            return c * 1.0
        if f == "top":
            if n[2] < 0.97:
                return mix(c, rgb("#ffffff"), 0.1)
            return c
        return c

    zc1 = 15.0
    if kind == "hatch":
        cx0, cx1 = -hx + 1.5, 4.0
    else:
        cx0, cx1 = -7.5, 4.5
    cab_mid = (cx0 + cx1) / 2 - 0.5

    def glass_m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top" and n[2] > 0.97:
            return paint if kind == "taxi" else mix(paint, rgb("#ffffff"), 0.12)
        if f == "L" and (abs(p[0] - cab_mid) < 0.7 or p[2] > zc1 - 0.8 or p[2] < zb1 + 0.6):
            return paint * 0.9
        s = (p[0] * 0.7 - p[2] * 1.0 + p[1] * 0.3) % 10
        g = glass_c
        if s < 1.5:
            g = mix(g, rgb("#c4ecf6"), 0.75)
        elif s < 2.6:
            g = mix(g, rgb("#c4ecf6"), 0.35)
        return g

    def tyre_m(p, n):
        f, u, v = face_uv(p, n)
        if f.startswith("L"):
            w = min(wxs, key=lambda w: abs(w - p[0]))
            d = math.hypot(p[0] - w, p[2] - wr)
            if d < 1.6:
                return rgb("#d2d7dc") if d > 0.7 else rgb("#7d848c")
            return rgb("#1e1f23")
        return rgb("#2a2b30")

    S = []
    if kind == "van":
        zt = 19
        S.append(box(-hx, -hy, zb0, hx - 7, hy, zt, van_body(paint, -hx, hx - 7, zt, near_wheel, wr),
                     extra=[plane_through((0.6, 0, 1), (hx - 7, 0, zt - 0.6))]))
        S.append(box(hx - 7, -hy, zb0, hx, hy, 15, body_m,
                     extra=[plane_through((1, 0, 0.5), (hx, 0, 9.0))]))
        S.append(box(hx - 7.3, -hy + 0.5, 9.0, hx - 1.0, hy - 0.5, 15.6, glass_m,
                     extra=[plane_through((1, 0, 0.6), (hx - 2.2, 0, 9.6))]))
    else:
        ex = [plane_through((1, 0, 1.1), (hx, 0, 7.6)),
              plane_through((-1, 0, 1.1), (-hx, 0, 7.6)),
              plane_through((0, 1, 1.0), (0, hy, 8.0)),
              plane_through((0, -1, 1.0), (0, -hy, 8.0))]
        S.append(box(-hx, -hy, zb0, hx, hy, zb1, body_m, extra=ex))
        cex = [plane_through((1, 0, 0.8), (cx1 + 3.5, 0, zb1)),
               plane_through((-1, 0, 0.8 if kind != "hatch" else 3.0), (cx0 - 2.5, 0, zb1)),
               plane_through((0, 1, 0.35), (0, hy - 0.8, zb1)),
               plane_through((0, -1, 0.35), (0, -hy + 0.8, zb1))]
        S.append(box(cx0 - 4, -hy + 0.6, zb1 - 0.3, cx1 + 5, hy - 0.6, zc1, glass_m, extra=cex))
        if kind == "taxi":
            def ts(p, n):
                f, u, v = face_uv(p, n)
                if f == "top":
                    return rgb("#ffe680")
                if f == "L" and text_hit("TAXI", p[0], p[2], -6.5, 17.6):
                    return rgb("#1d1d1f")
                return (rgb("#fff3b0"), True)
            S.append(box(-6.5, -2.4, zc1, 2.0, 2.4, zc1 + 3.0, ts))
        S.append(box(cx1 + 2.6, hy - 0.4, 9.2, cx1 + 3.8, hy + 1.0, 10.6, flat(paint * 0.85)))
    for wx in wxs:
        S.append(hcyl("y", wx, wr, wr, hy - 2.2, hy + 0.25, tyre_m, sides=12))
        S.append(hcyl("y", wx, wr, wr, -hy - 0.25, -hy + 2.2, tyre_m, sides=12))
    return S


def van_body(paint, xa, xb, zt, near_wheel=None, wr=3):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "R-":  # rear doors + tail lights
            if p[2] < 3.6:
                return rgb("#2b2e33")
            if abs(p[1]) > 4.6 and 5.0 < p[2] < 8.0:
                return (rgb("#ff3b30"), True)
            if abs(p[1]) < 0.3:
                return paint * 0.75
            return paint * 0.97
        if f == "L":
            if near_wheel and near_wheel(p[0], p[2]) < wr + 1.0:
                return rgb("#17181b")
            if p[2] < 3.6:
                return paint * 0.8
            if abs(p[0] - (xa + xb) / 2 - 3) < 0.35 and p[2] < zt - 2:
                return paint * 0.75
            if 8.5 < p[2] < 14.5 and abs(p[0] - (xa + xb) / 2) < 4.5:
                # simple parcel emblem
                dx, dz = abs(p[0] - (xa + xb) / 2), abs(p[2] - 11.5)
                if dx < 3.2 and dz < 2.4:
                    if dx < 0.5 or dz < 0.4:
                        return rgb("#f2e6c8")
                    return rgb("#c98a3e")
                return paint
            if 5.8 < p[2] < 7.2:
                return rgb("#d9443a")
            if 7.2 < p[2] < 7.8:
                return rgb("#f2b233")
        if f == "top":
            return paint * (1.02 if int(p[0]) % 5 else 0.94)
        return paint
    return m


def glass_mv(paint, g):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top" and n[2] > 0.95:
            return paint
        s = (p[0] * 0.8 + p[1] * 0.3 + p[2]) % 11
        return mix(g, rgb("#bfe7f2"), 0.7) if s < 1.6 else g
    return m


# ------------------------------------------------------------ STREET FURNITURE
def street_lamp():
    pole = flat("#3c4652")
    S = [box(-1.6, -1.6, 0, 1.6, 1.6, 2, flat("#56606c")),
         vcyl(0, 0, 0.75, 2, 30, pole, sides=6),
         box(-0.5, -0.5, 29, 0.5, 6.5, 30.2, pole),
         box(-1.6, 4.6, 27.6, 1.6, 8.6, 30.6, lamp_head())]
    return S


def lamp_head():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if p[2] < 28.6:
            return (rgb("#fff1b8"), True)
        return rgb("#46525e")
    return m


def tree(seed=0, big=True):
    trunk = flat("#6b4a33")
    r = 9 if big else 7

    def leaf(p, n):
        h = hash2(int(p[0] / 2.2), int(p[1] / 2.2) + int(p[2] / 2.2) * 7, seed)
        base = rgb("#4f9e4a")
        if h < 0.25:
            return rgb("#3a7d3c")
        if h > 0.82:
            return rgb("#79c160")
        return base
    S = [vcyl(0, 0, 1.3, 0, 12, trunk, sides=6),
         blob(0, 0, 16, r, leaf, n=30, squash=0.85, seed=seed),
         blob(-3, 2.5, 21, r * 0.62, leaf, n=22, squash=0.9, seed=seed + 1),
         blob(3.5, -1.5, 19.5, r * 0.6, leaf, n=22, squash=0.9, seed=seed + 2)]
    # tree grate
    S.insert(0, box(-3.5, -3.5, 0, 3.5, 3.5, 0.6, flat("#5a5f66"), cast=False))
    return S


def bench():
    wood, iron = rgb("#b07a4a"), flat("#363b42")

    def slat(p, n):
        f, u, v = face_uv(p, n)
        return wood * (0.86 if int(p[1] * 1.2) % 2 else 1.0) if f == "top" else wood * (0.86 if int(p[2] * 1.5) % 2 else 1)
    S = []
    for x in (-8, 7):
        S.append(box(x, -2.5, 0, x + 1, 2.5, 4, iron))
        S.append(box(x, -2.5, 4, x + 1, -1.5, 9, iron))
    S.append(box(-9, -2.5, 4, 9, 2.6, 5, slat))
    S.append(box(-9, -2.6, 5.5, 9, -1.6, 9, slat))
    return S


def hydrant():
    red = rgb("#d23a32")
    m = lambda p, n: red * (1.1 if face_uv(p, n)[0] == "top" else 1.0)
    return [vcyl(0, 0, 1.8, 0, 1, flat("#a82c26"), sides=8),
            vcyl(0, 0, 1.4, 1, 6.5, m, sides=8),
            cone(0, 0, 6.5, 1.6, 1.5, flat("#b8322b"), sides=8),
            hcyl("y", 0, 4.4, 0.7, -0.2, 2.4, flat("#e8c840"), sides=6),
            hcyl("x", 0, 4.4, 0.7, -0.2, 2.4, flat("#e8c840"), sides=6)]


def traffic_light(lit="r"):
    pole = flat("#3a414a")

    def head(p, n):
        f, u, v = face_uv(p, n)
        if f == "L":
            for zc, col, on in ((27.5, "#ff4a3d", lit == "r"), (24.5, "#ffc23d", lit == "a"), (21.5, "#3ddc7a", lit == "g")):
                if math.hypot(p[0] - 0, p[2] - zc) < 1.15:
                    return (rgb(col), True) if on else rgb(col) * 0.35
        return rgb("#262b31")
    return [box(-1.5, -1.5, 0, 1.5, 1.5, 1.5, flat("#56606c")),
            vcyl(0, 0, 0.7, 1.5, 20, pole, sides=6),
            box(-2, -1, 19.5, 2, 1.8, 29.5, head),
            box(-2.6, 1.8, 28.8, 2.6, 2.6, 29.5, flat("#262b31"))]


def bus_stop():
    frame = flat("#3d4753")

    def glass(p, n):
        return (rgb("#a9d8ea") * 0.9 + 20) if int(p[2]) % 7 else rgb("#d6eef7")

    def adm(p, n):
        f, u, v = face_uv(p, n)
        if f == "R" and 4 < p[2] < 14:
            return mix(rgb("#ff8a5c"), rgb("#ffd36a"), (p[2] - 4) / 10) if abs(p[1]) < 2.5 else rgb("#f5f5f5")
        return rgb("#3d4753")
    S = [box(-12, -4, 0, 12, 4, 0.5, flat("#a8adb4"), cast=False),
         box(-12, -4, 0, -11, -3, 16, frame), box(11, -4, 0, 12, -3, 16, frame),
         box(-12, 3, 0, -11, 4, 16, frame), box(11, 3, 0, 12, 4, 16, frame),
         box(-11, -4, 3, 11, -3.4, 15, glass),
         box(11, -3, 2, 11.6, 3, 15, adm),
         box(-13, -5, 16, 13, 5, 17.4, flat("#d9443a")),
         box(-9, -3, 4, 9, -1, 5, flat("#9aa2ad"))]
    return S


def newsstand():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and 3 < p[2] < 11:
            row = int((p[2] - 3) // 2.6)
            k = int((p[0] + 20) // 2.2)
            h = hash2(k, row, 7)
            cols = ["#e85a5a", "#f2c14e", "#4f8fd8", "#f6f2ea", "#58b36a", "#d86ab8"]
            if (p[2] - 3) % 2.6 < 0.5:
                return rgb("#5a3d2b")
            return rgb(cols[int(h * 6)])
        if f == "R" and 3 < p[2] < 11 and abs(p[1]) < 3:
            return glass_px(u, v, base="#6aa0bd", t=(p[2] - 3) / 8)
        return rgb("#2f6f5e")

    def roofm(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and text_hit("NEWS", u, v, -7.5, 16.6):
            return (rgb("#ffe08a"), True)
        return rgb("#245a4c")
    return [box(-10, -6, 0, 10, 6, 13, m),
            box(-11.5, -7.5, 13, 11.5, 7.5, 17.5, roofm),
            box(-9, 6, 0, 9, 8, 4, flat("#6b4a36"))]


def cafe_umbrella_set(cols=("#c8553d", "#f3e6d3")):
    def can(p, n):
        a = math.atan2(p[1], p[0])
        return rgb(cols[int((a + math.pi) / (2 * math.pi) * 8) % 2])
    S = [vcyl(0, 0, 3.6, 0, 0.8, flat("#4a4f57"), sides=8),
         vcyl(0, 0, 0.5, 0.8, 7.2, flat("#4a4f57"), sides=6),
         vcyl(0, 0, 4.2, 7.2, 8.0, flat("#f3efe8"), sides=10),
         vcyl(0, 0, 0.45, 8, 17, flat("#d8d8d8"), sides=6),
         cone(0, 0, 15, 9, 4.2, can, sides=16)]
    for dx, dy in ((-6.5, 0), (6.5, 0), (0, 6.5)):
        S.append(box(dx - 1.6, dy - 1.6, 0, dx + 1.6, dy + 1.6, 4.5, flat("#7a5a46")))
        S.append(box(dx - 1.6, dy - 1.6 + (0 if dy else 0), 4.5, dx - 1.0, dy + 1.6, 8, flat("#7a5a46")) if dx < 0 else
                 box(dx - 1.6, dy - 1.6, 4.5, dx + 1.6, dy - 1.0, 8, flat("#7a5a46")))
    return S


# ------------------------------------------------------------ orientation
def swap_xy(solids):
    out = []
    for s in solids:
        pl = [((n[1], n[0], n[2]), c) for n, c in s.planes]
        x0, y0, z0, x1, y1, z1 = s.aabb
        m0 = s.mat

        def m(p, n, m0=m0):
            return m0(np.array([p[1], p[0], p[2]]), np.array([n[1], n[0], n[2]]))
        ns = Solid(pl, (y0, x0, z0, y1, x1, z1), m, cast=s.cast)
        ns.planes = pl
        out.append(ns)
    return out


def mirror_x(solids):
    """Reflect across x=0 (car facing the other way). Materials see mirrored coords."""
    out = []
    for s in solids:
        pl = [((-n[0], n[1], n[2]), c) for n, c in s.planes]
        x0, y0, z0, x1, y1, z1 = s.aabb
        m0 = s.mat

        def m(p, n, m0=m0):
            return m0(np.array([-p[0], p[1], p[2]]), np.array([-n[0], n[1], n[2]]))
        ns = Solid([((0, 0, 1), 0)], (-x1, y0, z0, -x0, y1, z1), m, cast=s.cast)
        ns.planes = pl
        out.append(ns)
    return out


def rotate_z(solids, deg, cx, cy):
    """Turn solids by `deg` degrees about the vertical axis through (cx, cy) (counter-
    clockwise seen from above: +x toward +y). Materials see the unturned coordinates."""
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    rot = lambda v: np.array([ca * v[0] - sa * v[1], sa * v[0] + ca * v[1], v[2]])
    unrot = lambda v: np.array([ca * v[0] + sa * v[1], -sa * v[0] + ca * v[1], v[2]])
    C = np.array([cx, cy, 0.0])
    out = []
    for s in solids:
        pl = []
        for n, c in s.planes:
            n2 = rot(n)
            pl.append((tuple(n2), c - float(np.dot(n, C)) + float(np.dot(n2, C))))
        x0, y0, z0, x1, y1, z1 = s.aabb
        pts = [rot(np.array([x, y, 0.0]) - C) + C for x in (x0, x1) for y in (y0, y1)]
        aabb = (min(q[0] for q in pts), min(q[1] for q in pts), z0, max(q[0] for q in pts), max(q[1] for q in pts), z1)
        m0 = s.mat

        def m(p, n, m0=m0):
            return m0(unrot(np.array(p) - C) + C, unrot(n))
        out.append(Solid(pl, aabb, m, cast=s.cast))
    return out


# ------------------------------------------------------------ build all
def catalogue():
    cat = {}
    cat["tower_glass"] = (tower_glass(), dict(gs=14))
    cat["tower_brick"] = (tower_brick(), dict(gs=14))
    cat["tower_deco"] = (tower_deco(), dict(gs=14))
    for i, s in enumerate(SHOPS):
        cat["shop_" + s["name"].lower()] = (shop(i), dict(gs=10))
        cat["shop1_" + s["name"].lower()] = (shop(i, one=True), dict(gs=8))
    for k, spec in CARS.items():
        m = car(spec)
        cat[f"car_{k}_x"] = (m, dict(gs=10))           # drives toward +x (screen down-right)
        cat[f"car_{k}_y"] = (swap_xy(m), dict(gs=10))  # drives toward +y (screen down-left)
        cat[f"car_{k}_xr"] = (mirror_x(m), dict(gs=10))  # drives toward -x (screen up-left)
        cat[f"car_{k}_yr"] = (swap_xy(mirror_x(m)), dict(gs=10))  # drives toward -y (screen up-right)
    cat["lamp"] = (street_lamp(), dict(gs=14))
    cat["tree_big"] = (tree(1, True), dict(gs=12))
    cat["tree_small"] = (tree(5, False), dict(gs=10))
    cat["bench"] = (bench(), dict(gs=6))
    cat["hydrant"] = (hydrant(), dict(gs=5))
    cat["traffic_light"] = (traffic_light(), dict(gs=12))
    for lit in ("r", "a", "g"):
        cat["traffic_light_" + lit] = (traffic_light(lit), dict(gs=12))
    cat["bus_stop"] = (bus_stop(), dict(gs=10))
    cat["newsstand"] = (newsstand(), dict(gs=8))
    cat["cafe_table"] = (cafe_umbrella_set(), dict(gs=8))
    return cat


def solid_hull(solids, anchor):
    """Convex hull (sprite px) of every solid's AABB corners: the opaque silhouette bound."""
    pts = []
    for so in solids:
        x0, y0, z0, x1, y1, z1 = so.aabb
        for x in (x0, x1):
            for y in (y0, y1):
                for z in (z0, z1):
                    pts.append((round(x - y + anchor[0], 1), round((x + y) / 2 - z + anchor[1], 1)))
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return [list(p) for p in lo[:-1] + hi[:-1]]



def save_room(im, anchor, solids, name, man, units=23.45):
    """Write a room sprite (+ its live-screen map) and its manifest entry."""
    im.save(f"out/{name}.png")
    man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1], unitsPerGrid=units,
                     hull=solid_hull(solids, anchor))
    from isopix import LIVE, save_live
    if LIVE and save_live(f"out/{name}_live.png"):
        man[name]["live"] = {str(k): v for k, v in LIVE.items()}


if __name__ == "__main__":
    only = sys.argv[1:]
    os.makedirs("out", exist_ok=True)
    man = {}
    if os.path.exists("out/manifest.json"):
        man = json.load(open("out/manifest.json"))
    for name, (solids, opt) in catalogue().items():
        if only and not any(o in name for o in only):
            continue
        im, anchor = render(solids, ground_shadow=opt.get("gs", 10))
        im.save(f"out/{name}.png")
        fx0 = min(so.aabb[0] for so in solids); fy0 = min(so.aabb[1] for so in solids)
        fx1 = max(so.aabb[3] for so in solids); fy1 = max(so.aabb[4] for so in solids)
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1],
                         hull=solid_hull(solids, anchor), fp=[round(fx0, 2), round(fy0, 2), round(fx1, 2), round(fy1, 2)])
        print(name, im.size, anchor, flush=True)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
