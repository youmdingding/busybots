"""
Office-theme corridor / lobby props (the zones are separate).  Origin = the spot's
grid point at floor level; footprints (fp) are written to the manifest for the
board's depth sort.

Run: python3 office_props.py [name ...]  -> out/office_*.png + manifest entries
(copy tiles/city_v2/manifest.json to out/ first, and the results back after)
"""
import json, math, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, mix, hash2, render, plane_through
from props import flat, cone, solid_hull, swap_xy, mirror_x
from interiors import water_cooler, printer, office_chair

WOOD, WOOD_D, WOOD_L = "#a8774f", "#7a5236", "#c99a6a"
STEEL, STEEL_D, STEEL_L = "#b9c1c9", "#8c959e", "#dfe5ea"
INK, WHITE = "#2d3238", "#f4f5f2"
NAVY, TEAL, CORAL, MUSTARD = "#2f4858", "#2a8a84", "#e07a5f", "#e0b04a"


def leaf(seed, lo="#2f6d3a", mid="#3f8c48", hi="#6cb45a"):
    def m(p, n):
        h = hash2(int(p[0] / 1.5), int(p[1] / 1.5) + int(p[2] / 1.5) * 7, seed)
        return rgb(lo) if h < 0.3 else (rgb(hi) if h > 0.8 else rgb(mid))
    return m


def fig(big=True, seed=1):
    """Fiddle-leaf fig in a tall white planter."""
    h = 34.0 if big else 22.0
    r = 4.2 if big else 3.2
    S = [box(-r, -r, 0, r, r, h * 0.3, flat("#eceae4")),
         box(-r + 0.6, -r + 0.6, h * 0.3, r - 0.6, r - 0.6, h * 0.3 + 0.4, flat("#4a3a2c")),
         vcyl(0, 0, 0.6, h * 0.3, h * 0.75, flat("#6b5440"), sides=6)]
    lf = leaf(seed)
    for k, (dx, dy, dz, rr) in enumerate(((0, 0, h * 0.92, r * 0.9), (-r * 0.6, r * 0.4, h * 0.74, r * 0.75),
                                          (r * 0.55, -r * 0.3, h * 0.8, r * 0.75), (r * 0.2, r * 0.7, h * 0.62, r * 0.6))):
        S.append(blob(dx, dy, dz, rr, lf, n=22, squash=1.05, seed=seed + k))
    return S


def bench():
    """Lobby bench along y (seat faces +x)."""
    S = [box(-2.6, -12.0, 4.0, 2.6, 12.0, 5.6, flat(WOOD_L))]
    for y in (-10.5, 10.5):
        S.append(box(-2.2, y - 0.8, 0, 2.2, y + 0.8, 4.0, flat(INK)))
    return S


def reception():
    """Reception desk along x, facing +y: white front with a wood band, raised transaction top."""
    def front(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e9e6df")
        if 3.5 < p[2] < 5.0:
            return rgb(WOOD)
        return rgb(WHITE) if f == "L" else rgb("#dcdcd6")
    S = [box(-26.0, -4.0, 0, 26.0, 4.0, 9.0, front),
         box(-26.5, 2.0, 9.0, 26.5, 5.0, 11.0, flat(WOOD_L)),             # transaction ledge
         box(-26.0, -14.0, 0, -18.0, -4.0, 9.0, front)]                     # return
    # monitors (backs to the visitor) + a bell + flowers
    for x in (-14.0, 4.0):
        S.append(box(x - 3.8, -2.6, 9.0, x + 3.8, -2.0, 14.4, flat(INK)))
        S.append(box(x - 0.5, -2.2, 9.0, x + 0.5, -1.0, 10.6, flat(INK)))
    S.append(vcyl(16.0, 3.4, 1.0, 11.0, 13.6, flat("#5a7a8a"), sides=8))
    for (dx, dy, c) in ((0, 0, CORAL), (0.9, 0.3, MUSTARD), (-0.8, 0.4, "#f4f5f2")):
        S.append(blob(16.0 + dx, 3.4 + dy, 14.6, 0.9, flat(c), n=10))
    S += office_chair(-14.0, -8.0, "S", col=NAVY)
    S += office_chair(4.0, -8.0, "S", col=NAVY)
    return S


def sofa_x(cx, cy, w=22.0, col=TEAL, back_side=-1):
    c = rgb(col)

    def cush(p, n):
        f, u, v = face_uv(p, n)
        k = int((p[0] - cx + w / 2) // (w / 3))
        return c * (1.06 if f == "top" else 1.0) * (0.96 if k % 2 else 1.0)
    yb0, yb1 = (cy - 4.5, cy - 2.0) if back_side < 0 else (cy + 2.0, cy + 4.5)
    return [box(cx - w / 2, cy - 4.5, 0, cx + w / 2, cy + 4.5, 4.4, cush),
            box(cx - w / 2, yb0, 4.4, cx + w / 2, yb1, 9.6, flat(c * 0.9)),
            box(cx - w / 2 - 2.0, cy - 4.5, 0, cx - w / 2, cy + 4.5, 6.8, flat(c * 0.84)),
            box(cx + w / 2, cy - 4.5, 0, cx + w / 2 + 2.0, cy + 4.5, 6.8, flat(c * 0.84))]


def lounge_chair(cx, cy, col=MUSTARD, facing="W"):
    c = rgb(col)
    S = [box(cx - 4.0, cy - 4.0, 1.2, cx + 4.0, cy + 4.0, 4.6, flat(c))]
    if facing == "W":
        S.append(box(cx + 1.8, cy - 4.0, 4.6, cx + 4.0, cy + 4.0, 10.0, flat(c * 0.9)))
    else:
        S.append(box(cx - 4.0, cy - 4.0, 4.6, cx - 1.8, cy + 4.0, 10.0, flat(c * 0.9)))
    for (dx, dy) in ((-3.4, -3.4), (2.8, -3.4), (-3.4, 2.8), (2.8, 2.8)):
        S.append(box(cx + dx, cy + dy, 0, cx + dx + 0.6, cy + dy + 0.6, 1.2, flat(INK)))
    return S


def coffee_table(cx, cy, w=14.0, d=8.0):
    S = [box(cx - w / 2, cy - d / 2, 3.6, cx + w / 2, cy + d / 2, 4.6, flat(WOOD_L))]
    for (dx, dy) in ((-w / 2 + 0.8, -d / 2 + 0.8), (w / 2 - 1.4, -d / 2 + 0.8), (-w / 2 + 0.8, d / 2 - 1.4), (w / 2 - 1.4, d / 2 - 1.4)):
        S.append(box(cx + dx, cy + dy, 0, cx + dx + 0.6, cy + dy + 0.6, 3.6, flat(INK)))
    S.append(box(cx - 4.5, cy - 1.8, 4.6, cx + 0.5, cy + 1.8, 5.0, flat("#c9ced4")))       # laptop base
    S.append(box(cx - 4.5, cy - 1.8, 5.0, cx + 0.5, cy - 1.4, 8.0, flat("#9aa3ad")))       # screen
    S.append(box(cx + 2.0, cy - 2.4, 4.6, cx + 5.4, cy + 0.2, 5.1, flat(CORAL)))           # magazines
    S.append(vcyl(cx + 4.0, cy + 2.2, 0.9, 4.6, 6.2, flat(WHITE), sides=6))               # cup
    return S


def lounge():
    """Lounge group on the rug: sofa (back to the front), two armchairs, coffee table, side plant."""
    S = sofa_x(0, -11.0, w=24.0, col=TEAL, back_side=-1)
    S += lounge_chair(-18.0, 1.0, col=MUSTARD, facing="E")
    S += lounge_chair(18.0, 1.0, col=CORAL, facing="W")
    S += coffee_table(0, 0)
    return S


def floor_lamp():
    return [vcyl(0, 0, 2.0, 0, 0.6, flat(INK), sides=8),
            vcyl(0, 0, 0.35, 0.6, 22.0, flat(INK), sides=6),
            hcyl("x", 0, 22.0, 0.3, -6.0, 0, flat(INK), sides=6),
            cone(-6.0, 0, 17.6, 2.8, 3.6, flat("#f2e3c0"), sides=8),
            vcyl(-6.0, 0, 1.6, 17.4, 17.6, lambda p, n: (rgb("#fff4cf"), True), sides=8)]


def phone_booth():
    """Acoustic phone pod: felt shell, glass door facing -x… shown from the front-right."""
    def shell(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3e4a56")
        if f == "R" and -6.0 < p[1] < 6.0 and 2.0 < p[2] < 26.0:
            if abs(p[1]) > 5.0 or p[2] < 3.0 or p[2] > 25.0:
                return rgb(INK)
            return (rgb("#a9d3e6"), False) if int((p[1] + p[2]) * 0.8) % 7 else (rgb("#e6f4fa"), True)
        if f == "L" and 18.0 < p[2] < 21.0:
            return rgb(TEAL)
        return rgb("#4f6170")
    S = [box(-8.0, -8.0, 0, 8.0, 8.0, 28.0, shell),
         box(-8.4, -8.4, 28.0, 8.4, 8.4, 29.2, flat("#3e4a56"))]
    S.append(box(6.6, 4.0, 11.0, 7.2, 4.6, 15.0, flat(STEEL_L)))            # handle
    return S


def lockers_y():
    """Bank of staff lockers against the W wall (doors face +x)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#7f8a96")
        if f != "R":
            return rgb("#6e7883")
        cell = int((p[1] + 30) // 7.5)
        row = int(p[2] // 8.0)
        cy, cz = (p[1] + 30) % 7.5, p[2] % 8.0
        if cy < 0.5 or cz < 0.5:
            return rgb("#5a636d")
        if 5.6 < cy < 6.4 and 3.5 < cz < 5.0:
            return rgb(STEEL_L)                      # handle
        if 1.0 < cy < 5.0 and 6.0 < cz < 7.0 and int(cz * 3) % 2 == 0:
            return rgb("#5a636d")                    # vents
        col = ("#5d8aa8", "#7fa5bf", "#e0b04a", "#5d8aa8")[(cell + row) % 4]
        return rgb(col)
    return [box(-2.4, -30.0, 0, 3.6, 30.0, 24.0, m)]


def copier():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e3e6ea")
        if p[2] < 1.0:
            return rgb(INK)
        if f == "R" and 4.0 < p[2] < 9.5 and int(p[2] // 2.0) % 2 == 0:
            return rgb("#c9ced4")                    # paper drawers
        return rgb("#eceef1")
    S = [box(-4.0, -6.0, 0, 4.0, 6.0, 11.0, m),
         box(-4.0, -6.0, 11.0, 2.0, 6.0, 13.6, flat("#d9dde2")),
         box(2.0, -4.0, 11.0, 4.4, 2.0, 12.6, lambda p, n: (rgb("#6fd3ff"), True)),
         box(-3.0, -5.0, 13.6, 1.0, 5.0, 14.0, flat("#fbfbf6"))]
    S.append(box(-3.4, 7.0, 0, 3.4, 12.0, 6.0, flat("#3a86c8")))              # recycling box
    S.append(box(-2.8, 7.6, 6.0, 2.8, 11.4, 6.6, flat("#fbfbf6")))
    return S


def cooler():
    return water_cooler(0, 0)


def vending():
    """Snack vending machine against the N wall (front faces +y)."""
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#b8363a")
        if f != "L":
            return rgb("#a12f33")
        if -6.0 < p[0] < 3.0 and 6.0 < p[2] < 25.0:
            row = int((p[2] - 6.0) // 3.8)
            if (p[2] - 6.0) % 3.8 < 0.6:
                return rgb("#c9ced4")                # shelf
            k = int((p[0] + 6.0) // 1.8)
            if (p[0] + 6.0) % 1.8 < 1.3:
                pal = ("#f2c14e", "#e76f51", "#2a9d8f", "#5d8aa8", "#f4f1ea", "#8b5a3c")
                return (rgb(pal[(k + row * 2) % 6]), True)
            return (rgb("#2b2f35"), True)
        if 4.0 < p[0] < 7.0 and 14.0 < p[2] < 20.0:
            return rgb(INK) if int(p[2]) % 2 else rgb("#6fd3ff")   # keypad
        if p[2] < 4.0 and -6.0 < p[0] < 3.0:
            return rgb(INK)                          # pickup slot
        return rgb("#c9383d")
    return [box(-8.0, -3.0, 0, 8.0, 4.0, 28.0, m)]


def coffee_bar():
    """Coffee point against the N wall: counter, machine, cups, fruit bowl (faces +y)."""
    def counter(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e9e6df")
        if p[2] < 1.0:
            return rgb(INK)
        return rgb(WOOD) if int(p[0] // 7.0) % 2 else rgb("#a07048")
    S = [box(-12.0, -3.0, 0, 12.0, 5.0, 9.0, counter)]

    def mach(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and 11.0 < p[2] < 12.6:
            return (rgb("#6fd3ff"), True)
        return rgb("#2f3439") if f != "top" else rgb("#3b4147")
    S.append(box(-9.0, -2.0, 9.0, -2.0, 3.0, 17.0, mach))
    S.append(box(-7.6, 3.0, 9.0, -3.4, 3.6, 10.0, flat(STEEL)))               # drip tray
    for k in range(3):
        S.append(vcyl(1.0 + k * 1.8, 1.8, 0.8, 9.0, 10.4, flat(WHITE), sides=6))
    S.append(blob(8.0, 1.0, 10.0, 2.2, flat("#c9ced4"), n=12, squash=0.5))   # bowl
    for (dx, dy, c) in ((-0.8, 0, "#e9b44c"), (0.7, 0.4, "#7cc46a"), (0.0, -0.6, "#e85d3a")):
        S.append(blob(8.0 + dx, 1.0 + dy, 11.0, 0.9, flat(c), n=8))
    return S


def bins():
    S = []
    for i, (c, lid) in enumerate((("#3a86c8", "#2b6aa0"), ("#4f9a6a", "#3b7a52"), ("#e0b04a", "#b88a2c"))):
        x = -6.0 + i * 6.0
        S.append(box(x - 2.4, -2.4, 0, x + 2.4, 2.4, 8.0, flat(c)))
        S.append(box(x - 2.6, -2.6, 8.0, x + 2.6, 2.6, 8.8, flat(lid)))
        S.append(box(x - 1.2, -1.2, 8.8, x + 1.2, 1.2, 9.0, flat(INK)))
    return S


def whiteboard():
    """Mobile whiteboard (faces +y) with a sprint board of sticky notes."""
    def board(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#b9c2ca")
        uu, zz = p[0] + 11.0, p[2] - 8.0
        if uu < 0.8 or uu > 21.2 or zz < 0.8 or zz > 13.2:
            return rgb("#b9c2ca")
        if abs(uu - 7.3) < 0.25 or abs(uu - 14.6) < 0.25 or abs(zz - 11.0) < 0.25:
            return rgb("#8a95a0")
        col = int(uu // 7.3)
        if zz < 10.4:
            cu, cz = uu % 7.3, zz % 2.6
            k = (col, int(zz // 2.6))
            if 0.8 < cu < 3.2 + (k[1] % 2) * 2.4 and 0.6 < cz < 2.2 and hash2(k[0] + int(cu > 3.4), k[1], 7) > 0.3:
                return rgb(("#fff07a", "#ffb3c1", "#9be3c7")[col])
        return rgb("#fbfdfd")
    S = [box(-11.0, -0.4, 8.0, 11.0, 0.4, 22.0, board)]
    for x in (-10.0, 10.0):
        S.append(box(x - 0.5, -0.5, 1.0, x + 0.5, 0.5, 8.0, flat("#9aa3ad")))
        S.append(box(x - 0.5, -4.0, 0.4, x + 0.5, 4.0, 1.0, flat("#9aa3ad")))
    S.append(box(-10.0, -0.9, 7.6, 10.0, 0.9, 8.2, flat("#9aa3ad")))         # marker tray
    return S


def vacuum():
    """Robot vacuum facing +x: charcoal disc, silver front bumper, lidar turret at the back,
    a cyan status light and two side brushes. props.swap_xy / mirror_x give the other headings."""
    r = 5.0
    body_c, rim_c, bump_c = rgb("#2b2f35"), rgb("#454c55"), rgb("#aab3bb")

    def body(p, n):
        d = math.hypot(p[0], p[1])
        if n[2] > 0.9:  # lid
            if math.hypot(p[0] - 2.5, p[1]) < 0.75:
                return (rgb("#3fe6cf"), True)
            return rim_c if d > r - 0.9 else body_c
        return bump_c if p[0] > r * 0.45 else mix(body_c, rim_c, 0.5)

    S = [vcyl(0, 0, r, 0.5, 2.6, body, sides=16),
         vcyl(-1.7, 0, 1.5, 2.6, 3.7, flat("#1b1e22"), sides=10),
         vcyl(-1.7, 0, 1.6, 3.7, 4.1, flat("#5d6670"), sides=10)]
    for sy in (-1, 1):
        S.append(box(r * 0.62 - 1.0, sy * r * 0.62 - 0.25, 0.1, r * 0.62 + 1.0, sy * r * 0.62 + 0.25, 0.4,
                     flat("#d8dde2"), name="decal"))
    return S


def vacuum_dock():
    """Charging dock the vacuum backs onto (it faces +y; the vacuum rests at the origin)."""
    def shell(p, n):
        if n[1] > 0.9 and abs(p[0]) < 0.8 and 4.2 < p[2] < 5.2:
            return (rgb("#58e07a"), True)  # charging light
        if n[2] > 0.9:
            return rgb("#4b525b")
        return rgb("#30353b")
    return [box(-4.6, -8.6, 0, 4.6, -5.8, 6.4, shell),
            box(-4.2, -5.8, 0, 4.2, -1.0, 0.35, flat("#5a616a"), name="decal"),
            box(-2.6, -5.8, 0.35, -1.6, -4.6, 0.7, flat("#c9b26a"), name="decal"),
            box(1.6, -5.8, 0.35, 2.6, -4.6, 0.7, flat("#c9b26a"), name="decal")]


def catalogue():
    return {
        "office_fig_big": (fig(True, 3), 10),
        "office_fig_small": (fig(False, 7), 8),
        "office_bench": (bench(), 4),
        "office_reception": (reception(), 6),
        "office_lounge": (lounge(), 4),
        "office_floor_lamp": (floor_lamp(), 8),
        "office_phone_booth": (phone_booth(), 10),
        "office_lockers_y": (lockers_y(), 8),
        "office_copier": (copier(), 6),
        "office_cooler": (cooler(), 6),
        "office_vending": (vending(), 8),
        "office_coffee_bar": (coffee_bar(), 6),
        "office_bins": (bins(), 4),
        "office_whiteboard": (whiteboard(), 8),
        "office_vacuum_x": (vacuum(), 3),
        "office_vacuum_y": (swap_xy(vacuum()), 3),
        "office_vacuum_xr": (mirror_x(vacuum()), 3),
        "office_vacuum_yr": (swap_xy(mirror_x(vacuum())), 3),
        "office_vacuum_dock": (vacuum_dock(), 4),
    }


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    only = sys.argv[1:]
    for name, (solids, gs) in catalogue().items():
        if only and not any(o in name for o in only):
            continue
        im, anchor = render(solids, ground_shadow=gs)
        im.save(f"out/{name}.png")
        body = [s for s in solids if s.name != "decal"] or solids  # flat floor decals don't count
        fx0 = min(s.aabb[0] for s in body); fy0 = min(s.aabb[1] for s in body)
        fx1 = max(s.aabb[3] for s in body); fy1 = max(s.aabb[4] for s in body)
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1],
                         hull=solid_hull(solids, anchor), fp=[round(fx0, 2), round(fy0, 2), round(fx1, 2), round(fy1, 2)])
        print(name, im.size, flush=True)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
