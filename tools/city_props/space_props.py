"""
Space-theme deck props + small craft that fly around the station (ship_<kind>_x/xr/y/yr).

Run: python3 space_props.py [name ...] -> out/space_*.png, out/ship_*.png + manifest entries
"""
import json, math, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, mix, hash2, render, plane_through
from props import flat, cone, solid_hull, swap_xy, mirror_x

CYAN, CYAN_D = "#3ec8e0", "#1f7f92"
HAZ, HAZ_D = "#f2c14e", "#2a2d33"
HULL, HULL_D, HULL_L = "#c9d1da", "#8f99a6", "#e6ebf0"
DARK = "#2a3038"
ORANGE, RED, GREEN, VIOLET = "#ff9f43", "#ff5a5a", "#5ee08f", "#b07cff"


def glow(c):
    return lambda p, n: (rgb(c), True)


def panel_mat(base=HULL, seam=HULL_D, s=6.0):
    def m(p, n):
        f, u, v = face_uv(p, n)
        coord = p[0] if f in ("L", "top") else p[1]
        if coord % s < 0.5 or (f != "top" and p[2] % s < 0.4):
            return rgb(seam)
        return rgb(base) * (1.04 if f == "top" else 1.0)
    return m


# ------------------------------------------------------------------ deck props
def shuttle():
    """Parked shuttle along x (nose +x): fuselage, cockpit glass, swept wings, tail fin, landing legs."""
    S = []
    body = panel_mat()
    S.append(box(-16.0, -5.0, 3.0, 12.0, 5.0, 11.0, body,
                 extra=[plane_through((1, 0, 0.9), (8.0, 0, 11.0)), plane_through((0.5, 0.8, 0), (8.0, 5.0, 0)),
                        plane_through((0.5, -0.8, 0), (8.0, -5.0, 0)), plane_through((0, 0.6, 1), (0, 5.0, 9.0)),
                        plane_through((0, -0.6, 1), (0, -5.0, 9.0))]))
    S.append(box(2.0, -3.4, 8.0, 10.0, 3.4, 11.4, lambda p, n: (rgb("#6fd3ff"), True) if face_uv(p, n)[0] != "bot" else rgb(DARK),
                 extra=[plane_through((1, 0, 1.0), (7.0, 0, 11.4))]))          # cockpit
    for sgn in (-1, 1):
        S.append(box(-14.0, sgn * 5.0 if sgn > 0 else -16.0, 4.0, -2.0, 16.0 if sgn > 0 else -5.0, 5.2, panel_mat(HULL_L),
                     extra=[plane_through((0.8, sgn * 0.6, 0), (-2.0, sgn * 5.0, 0))]))  # wings
        S.append(box(-12.5, sgn * 12.0 - 0.6, 5.2, -9.0, sgn * 12.0 + 0.6, 6.0, glow(RED if sgn < 0 else GREEN)))
    S.append(box(-16.0, -0.8, 11.0, -8.0, 0.8, 19.0, panel_mat(HULL_L),
                 extra=[plane_through((1, 0, 0.8), (-12.0, 0, 19.0))]))        # tail fin
    S.append(box(-15.0, -1.0, 16.0, -12.5, 1.0, 17.0, flat(CYAN)))
    for y in (-2.6, 2.6):
        S.append(hcyl("x", y, 6.8, 1.8, -19.0, -16.0, flat("#5b6573"), sides=8))   # engines
        S.append(hcyl("x", y, 6.8, 1.2, -19.4, -19.0, glow(CYAN), sides=8))
    for (x, y) in ((-10.0, -3.6), (-10.0, 3.6), (6.0, 0.0)):
        S.append(box(x - 0.5, y - 0.5, 0, x + 0.5, y + 0.5, 3.4, flat(DARK)))
        S.append(box(x - 1.4, y - 1.4, 0, x + 1.4, y + 1.4, 0.5, flat(DARK)))
    S.append(box(-6.0, 5.0, 4.0, 0.0, 5.3, 9.0, flat("#5b6573")))             # hatch outline
    S.append(box(-5.4, 5.2, 4.4, -0.6, 5.4, 8.6, flat("#aab4bf")))
    return S


def crates():
    S = []
    def crate(col):
        def m(p, n):
            f, u, v = face_uv(p, n)
            if f == "top":
                return rgb(col) * 1.05
            coord = p[0] if f == "L" else p[1]
            if abs(p[2] % 6.0 - 3.0) < 0.5:
                return rgb(HAZ) if int(coord // 1.5) % 2 else rgb(HAZ_D)
            return rgb(col)
        return m
    S.append(box(-6.0, -4.0, 0, 2.0, 4.0, 6.0, crate("#5b6573")))
    S.append(box(2.6, -3.0, 0, 8.6, 3.0, 6.0, crate("#3f6e8c")))
    S.append(box(-5.0, -3.4, 6.0, 1.0, 2.6, 12.0, crate("#7a5a3c")))
    S.append(box(-4.0, -1.6, 12.0, -0.4, 1.6, 12.4, glow(CYAN)))
    return S


def canisters():
    S = []
    for i, (x, y, c) in enumerate(((-3.0, -2.0, ORANGE), (0.8, -2.4, "#d9dee4"), (-1.2, 1.6, ORANGE), (2.6, 1.4, "#d9dee4"))):
        S.append(vcyl(x, y, 1.6, 0, 9.0, flat(c), sides=8))
        S.append(vcyl(x, y, 1.65, 6.0, 6.8, flat(DARK), sides=8))
        S.append(vcyl(x, y, 0.6, 9.0, 10.0, flat("#5b6573"), sides=6))
    return S


def bot():
    """Little maintenance robot on treads with a glowing eye."""
    S = [box(-3.0, -2.6, 0, 3.0, 2.6, 1.6, flat(DARK)),
         box(-2.4, -2.0, 1.6, 2.4, 2.0, 6.0, panel_mat(HULL, HULL_D, 4.0)),
         box(-1.8, -1.6, 6.0, 1.8, 1.6, 8.6, flat(HULL_L)),
         box(1.8, -1.0, 6.8, 1.95, 1.0, 7.8, glow(CYAN)),
         vcyl(-0.8, 0, 0.15, 8.6, 11.0, flat(DARK), sides=4),
         blob(-0.8, 0, 11.2, 0.4, glow(RED), n=8)]
    S.append(box(-0.5, 2.0, 3.0, 0.5, 4.2, 3.8, flat("#8f99a6")))               # arm
    return S


def console():
    """Deck terminal (screen faces +y) on a pedestal."""
    def scr(p, n):
        f, u, v = face_uv(p, n)
        if f in ("L", "top") and p[2] > 8.3:
            uu = p[0] + 6.0
            if int(p[2] * 2) % 3 == 0 and uu % 4.0 < 3.0:
                return (rgb(CYAN), True)
            return (rgb("#0f2a33"), True)
        return rgb("#4a5361")
    S = [box(-3.0, -2.0, 0, 3.0, 2.0, 7.0, panel_mat("#4a5361", DARK, 3.5)),
         box(-6.0, -3.0, 7.0, 6.0, 3.0, 12.0, scr, extra=[plane_through((0, 1, 1.2), (0, 3.0, 8.5))])]
    return S


def holo_beacon():
    S = [vcyl(0, 0, 2.6, 0, 1.6, flat("#4a5361"), sides=10),
         vcyl(0, 0, 1.8, 1.6, 2.2, glow(CYAN), sides=10)]
    for k in range(4):
        S.append(vcyl(0, 0, 1.8 - k * 0.35, 4.0 + k * 3.0, 4.4 + k * 3.0, lambda p, n: (mix(rgb(CYAN), rgb("#ffffff"), 0.3), True), sides=10))
    S.append(blob(0, 0, 17.0, 1.4, glow("#bff6ff"), n=12))
    return S


def tank():
    S = [vcyl(0, 0, 4.0, 0, 18.0, panel_mat(HULL, HULL_D, 4.5), sides=12),
         vcyl(0, 0, 4.1, 3.0, 4.0, flat(HAZ), sides=12),
         vcyl(0, 0, 3.0, 18.0, 19.0, flat("#5b6573"), sides=10),
         box(3.6, -0.8, 8.0, 4.6, 0.8, 12.0, glow(GREEN))]
    return S


def hydro_pod():
    """Glass-domed hydroponics pod with plants inside."""
    S = [vcyl(0, 0, 4.4, 0, 3.0, flat("#4a5361"), sides=12),
         vcyl(0, 0, 4.0, 3.0, 3.4, glow("#8a5cff"), sides=12)]
    for k, (dx, dy) in enumerate(((0, 0), (-1.8, 1.0), (1.6, -1.2), (1.2, 1.8))):
        S.append(blob(dx, dy, 5.6 + (k == 0) * 1.4, 1.8, flat("#4fc06a" if k % 2 else "#3a9a52"), n=12, seed=k))
    for k in range(6):                                         # glass ribs of an open dome frame
        ang = k * math.pi / 3
        S.append(box(math.cos(ang) * 3.8 - 0.3, math.sin(ang) * 3.8 - 0.3, 3.4, math.cos(ang) * 3.8 + 0.3,
                     math.sin(ang) * 3.8 + 0.3, 9.0, flat("#9ad8ea")))
    for k in range(6):
        a0 = k * math.pi / 3
        S.append(box(math.cos(a0) * 3.6 - 1.2, math.sin(a0) * 3.6 - 1.2, 9.0, math.cos(a0) * 3.6 + 1.2,
                     math.sin(a0) * 3.6 + 1.2, 9.6, flat("#9ad8ea")))
    return S


def drone():
    S = [box(-2.6, -2.6, 9.0, 2.6, 2.6, 11.0, panel_mat(HULL, HULL_D, 3.0)),
         box(-1.2, -1.2, 8.2, 1.2, 1.2, 9.0, glow(CYAN))]
    S.append(box(-4.0, -0.3, 10.2, 4.0, 0.3, 10.6, flat(DARK)))
    S.append(box(-0.3, -4.0, 10.2, 0.3, 4.0, 10.6, flat(DARK)))
    for (x, y) in ((-4.0, 0.0), (4.0, 0.0), (0.0, -4.0), (0.0, 4.0)):
        S.append(vcyl(x, y, 2.0, 11.0, 11.3, flat("#aab4bf"), sides=10))
    S.append(blob(0, 0, 0.6, 2.2, lambda p, n: (rgb("#0b0f16"), False), n=12, squash=0.2))   # shadow disk
    return S


def floor_light():
    return [vcyl(0, 0, 1.4, 0, 1.2, flat("#4a5361"), sides=8),
            vcyl(0, 0, 0.9, 1.2, 2.4, glow(CYAN), sides=8)]


# ------------------------------------------------------------------ flying craft (nose +x)
def ship_shuttle(col=HULL, stripe=CYAN):
    S = [box(-9.0, -3.0, -1.5, 8.0, 3.0, 3.5, panel_mat(col, HULL_D, 4.0),
             extra=[plane_through((1, 0, 0.8), (5.0, 0, 3.5)), plane_through((0.6, 0.8, 0), (5.0, 3.0, 0)),
                    plane_through((0.6, -0.8, 0), (5.0, -3.0, 0))])]
    S.append(box(1.0, -2.0, 2.0, 6.0, 2.0, 4.6, glow("#6fd3ff"), extra=[plane_through((1, 0, 1.0), (4.0, 0, 4.6))]))
    for sgn in (-1, 1):
        S.append(box(-8.0, -9.0 if sgn < 0 else 3.0, 0.0, -1.0, -3.0 if sgn < 0 else 9.0, 0.8, flat(HULL_L),
                     extra=[plane_through((0.8, sgn * 0.6, 0), (-1.0, sgn * 3.0, 0))]))
    S.append(box(-8.5, -3.1, 0.6, -2.0, 3.1, 1.4, flat(stripe)))
    S.append(hcyl("x", 0, 1.0, 1.5, -10.5, -9.0, glow(CYAN), sides=8))
    return S


def ship_hauler():
    """Boxy cargo hauler: cab + container train."""
    S = [box(4.0, -3.4, -2.0, 11.0, 3.4, 4.0, panel_mat(HULL, HULL_D, 4.0),
             extra=[plane_through((1, 0, 0.7), (9.0, 0, 4.0))]),
         box(8.0, -2.6, 1.5, 10.6, 2.6, 3.6, glow("#6fd3ff"))]
    for i, c in enumerate((ORANGE, "#3f6e8c", HAZ)):
        x0 = 3.0 - (i + 1) * 7.0
        S.append(box(x0, -3.0, -2.0, x0 + 6.4, 3.0, 3.4, panel_mat(c, DARK, 3.2)))
    S.append(box(-19.0, -0.6, -0.6, 4.0, 0.6, 0.6, flat(DARK)))
    for y in (-2.0, 2.0):
        S.append(hcyl("x", y, 0.6, 1.2, -20.5, -18.6, glow(ORANGE), sides=8))
    return S


def ship_pod():
    """Little round courier pod with ring fins."""
    S = [blob(0, 0, 0.8, 3.4, panel_mat(HULL_L, HULL_D, 3.0), n=24, squash=0.75),
         blob(1.6, 0, 1.8, 1.6, glow("#6fd3ff"), n=12),
         vcyl(0, 0, 4.6, 0.2, 0.9, flat(VIOLET), sides=12),
         hcyl("x", 0, 0.8, 1.0, -4.4, -3.0, glow(VIOLET), sides=8)]
    return S


def ship_fighter():
    S = [box(-6.0, -1.6, -0.8, 8.0, 1.6, 2.2, panel_mat("#d9dee4", HULL_D, 3.0),
             extra=[plane_through((1, 0, 0.6), (5.0, 0, 2.2)), plane_through((0.7, 0.7, 0), (4.0, 1.6, 0)),
                    plane_through((0.7, -0.7, 0), (4.0, -1.6, 0))])]
    for sgn in (-1, 1):
        S.append(box(-6.0, -10.0 if sgn < 0 else 1.6, 0.0, 0.0, -1.6 if sgn < 0 else 10.0, 0.6, flat(RED),
                     extra=[plane_through((0.9, sgn * 0.5, 0), (0.0, sgn * 1.6, 0))]))
    S.append(box(0.0, -1.0, 2.0, 4.0, 1.0, 3.2, glow("#6fd3ff")))
    S.append(hcyl("x", 0, 0.6, 1.0, -7.4, -6.0, glow(RED), sides=8))
    return S


SHIPS = {"shuttle": ship_shuttle, "shuttle_orange": lambda: ship_shuttle(HULL, ORANGE),
         "hauler": ship_hauler, "pod": ship_pod, "fighter": ship_fighter}


def catalogue():
    cat = {
        "space_shuttle": (shuttle(), 8), "space_crates": (crates(), 6), "space_canisters": (canisters(), 6),
        "space_bot": (bot(), 4), "space_console": (console(), 6), "space_holo_beacon": (holo_beacon(), 0),
        "space_tank": (tank(), 10), "space_hydro_pod": (hydro_pod(), 6), "space_drone": (drone(), 0),
        "space_floor_light": (floor_light(), 0),
    }
    for k, fn in SHIPS.items():
        m = fn()
        cat[f"ship_{k}_x"] = (m, 0)
        cat[f"ship_{k}_y"] = (swap_xy(m), 0)
        cat[f"ship_{k}_xr"] = (mirror_x(m), 0)
        cat[f"ship_{k}_yr"] = (swap_xy(mirror_x(m)), 0)
    return cat


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    only = sys.argv[1:]
    for name, (solids, gs) in catalogue().items():
        if only and not any(o in name for o in only):
            continue
        im, anchor = render(solids, ground_shadow=gs)
        im.save(f"out/{name}.png")
        fx0 = min(s.aabb[0] for s in solids); fy0 = min(s.aabb[1] for s in solids)
        fx1 = max(s.aabb[3] for s in solids); fy1 = max(s.aabb[4] for s in solids)
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1],
                         hull=solid_hull(solids, anchor), fp=[round(fx0, 2), round(fy0, 2), round(fx1, 2), round(fy1, 2)])
        print(name, im.size, flush=True)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
