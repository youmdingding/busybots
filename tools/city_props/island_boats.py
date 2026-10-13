"""
Animated boats for the Island theme. Each boat is modelled bow toward +x and exported
in four headings like the City cars: boat_<kind>_x / _xr / _y / _yr.

Run: python3 island_boats.py  -> out/boat_*.png + manifest entries (with fp footprints)
"""
import json, math, os, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, render, plane_through
from props import flat, cone, swap_xy, mirror_x, solid_hull

WHITE, OFF = "#f7f5ef", "#e3dfd4"
NAVY, RED, TEAL, SUN = "#24456b", "#d64535", "#1f9e9a", "#f7c548"


def hull_solid(L, W, top, bottom, mat, bow=5.0, stern=0.8, flare=0.8):
    """Boat hull along x: pointed bow at +x, tapered sides and keel."""
    return box(-L / 2, -W / 2, bottom, L / 2, W / 2, top, mat,
               extra=[plane_through((1, 0, -0.35), (L / 2 - bow, 0, bottom)),
                      plane_through((0.6, 0.8, 0), (L / 2 - bow, W / 2, 0)),
                      plane_through((0.6, -0.8, 0), (L / 2 - bow, -W / 2, 0)),
                      plane_through((-1, 0, -stern), (-L / 2 + 1.0, 0, bottom)),
                      plane_through((0, 1, -flare), (0, W / 2 - 1.2, bottom)),
                      plane_through((0, -1, -flare), (0, -W / 2 + 1.2, bottom))])


def painted_hull(deck, side, stripe=None, boot="#7a2a22", z_stripe=(1.2, 1.9)):
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(deck)
        if p[2] < 0.3:
            return rgb(boot)                         # waterline
        if stripe and z_stripe[0] < p[2] < z_stripe[1]:
            return rgb(stripe)
        return rgb(side)
    return m


def glass():
    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(WHITE)
        return (rgb("#3c6e8f"), False) if int(p[2] * 2) % 3 else (rgb("#8cc6e0"), True)
    return m


# ------------------------------------------------------------------ kinds
def sailboat(sail="#fbfaf6", hull_col=NAVY):
    S = [hull_solid(22.0, 8.0, 3.2, -1.0, painted_hull("#b98a5a", WHITE, hull_col), bow=6.0)]
    S.append(box(-7.0, -2.2, 3.2, -2.0, 2.2, 5.0, flat(OFF)))              # cockpit coaming
    S.append(vcyl(1.0, 0, 0.45, 3.2, 30.0, flat("#6b4a2b"), sides=6))
    S.append(hcyl("x", 0, 6.0, 0.35, -9.5, 1.0, flat("#6b4a2b"), sides=6))  # boom

    def sailm(p, n):
        return rgb(sail) if int(p[2] // 6) % 4 else rgb(OFF)
    S.append(box(-9.0, -0.25, 6.4, 0.6, 0.25, 29.0, sailm, extra=[plane_through((-0.8, 0, 1), (0.6, 0, 29.0))]))
    S.append(box(1.4, -0.25, 4.6, 9.0, 0.25, 24.0, flat(sail), extra=[plane_through((0.9, 0, 1), (1.4, 0, 24.0))]))
    return S


def speedboat():
    S = [hull_solid(20.0, 7.6, 3.0, -0.8, painted_hull("#e9e4d8", WHITE, RED), bow=7.0)]
    S.append(box(-3.0, -3.2, 3.0, 2.6, 3.2, 4.0, flat("#d9d2c2")))           # deck step
    S.append(box(1.8, -3.0, 4.0, 2.6, 3.0, 6.6, glass(),
                 extra=[plane_through((1, 0, 0.6), (2.6, 0, 4.0))]))         # raked windscreen
    for y in (-1.6, 1.6):
        S.append(box(-3.0, y - 1.2, 3.0, -0.6, y + 1.2, 5.6, flat(RED)))    # bucket seats
        S.append(box(-3.0, y - 1.2, 5.6, -2.2, y + 1.2, 7.4, flat(RED)))
    S.append(box(-8.4, -2.8, 3.0, -4.6, 2.8, 4.6, flat("#c9a26a")))          # rear bench
    S.append(box(-11.2, -1.2, -0.4, -9.6, 1.2, 5.6, flat("#2b2b2b")))        # outboard
    S.append(box(-11.0, -1.0, 5.6, -9.2, 1.0, 6.8, flat("#3a3f46")))
    return S


def fishing_boat():
    S = [hull_solid(24.0, 9.0, 4.2, -1.2, painted_hull("#9c7a52", "#2f6db5", "#f4f1ea", z_stripe=(3.0, 3.8)), bow=6.0, flare=0.5)]

    def cab(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(RED)
        if 7.4 < p[2] < 9.4 and f in ("L", "R"):
            coord = p[0] if f == "L" else -p[1]
            return (rgb("#8cc6e0"), True) if coord % 3.2 > 0.8 else rgb(WHITE)
        return rgb(WHITE)
    S.append(box(-1.0, -3.4, 4.2, 6.0, 3.4, 10.4, cab))
    S.append(box(-1.4, -3.8, 10.4, 6.4, 3.8, 11.2, flat(RED)))
    S.append(vcyl(2.0, 0, 0.3, 11.2, 15.0, flat("#d9d9d9"), sides=6))       # radar mast
    S.append(box(0.6, -0.3, 14.6, 3.4, 0.3, 15.2, flat("#f4f1ea")))
    S.append(vcyl(-7.0, 0, 0.45, 4.2, 22.0, flat("#6b4a2b"), sides=6))       # gantry mast
    S.append(hcyl("x", 0, 19.0, 0.3, -11.5, -7.0, flat("#6b4a2b"), sides=6))  # boom out over the stern
    S.append(vcyl(-11.2, 0, 0.15, 12.0, 19.0, flat("#c9a26a"), sides=4))
    S.append(blob(-11.2, 0, 11.6, 1.3, flat("#3f7a5a"), n=12, squash=1.3))   # hanging net
    for (x, y, c) in ((-5.0, -3.6, "#f26b1d"), (-3.0, -3.7, SUN), (-9.0, 3.4, "#f26b1d")):
        S.append(blob(x, y, 4.6, 0.9, flat(c), n=10))                        # buoys on the rail
    S.append(box(-9.6, -2.6, 4.2, -5.4, 0.6, 5.8, flat("#5e8fb0")))          # fish crates
    return S


def catamaran(sail="#fbfaf6"):
    S = []
    for y in (-5.0, 5.0):
        S.append(hull_solid(24.0, 4.2, 3.4, -1.0, painted_hull(WHITE, WHITE, TEAL, z_stripe=(1.6, 2.3)), bow=6.0, flare=0.3))
        S[-1] = _shift_y(S[-1], y)

    def tramp(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#2f3b46") if int((p[0] + p[1]) * 1.2) % 2 else rgb("#3d4b57")
        return rgb(WHITE)
    S.append(box(-6.0, -4.0, 3.0, 6.0, 4.0, 3.6, tramp))
    S.append(box(-10.0, -6.5, 3.4, -6.0, 6.5, 5.0, flat(WHITE)))             # rear beam / cabin
    S.append(vcyl(2.0, 0, 0.45, 3.6, 32.0, flat("#cfd4da"), sides=6))
    S.append(box(-8.0, -0.25, 6.0, 1.6, 0.25, 31.0, flat(sail), extra=[plane_through((-0.75, 0, 1), (1.6, 0, 31.0))]))
    S.append(box(2.4, -0.25, 4.2, 11.0, 0.25, 26.0, flat(SUN), extra=[plane_through((0.85, 0, 1), (2.4, 0, 26.0))]))
    return S


def _shift_y(s, dy):
    from isopix import Solid
    pl = [(tuple(float(v) for v in nrm), d + nrm[1] * dy) for (nrm, d) in s.planes]
    a = s.aabb
    return Solid(pl, (a[0], a[1] + dy, a[2], a[3], a[4] + dy, a[5]), s.mat, cast=s.cast)


def yacht():
    S = [hull_solid(30.0, 10.0, 4.4, -1.2, painted_hull("#c9a26a", WHITE, NAVY, z_stripe=(2.6, 3.3)), bow=9.0, flare=0.4)]

    def deck1(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(OFF)
        if 5.6 < p[2] < 7.6:
            return (rgb("#2c3e50"), False) if int((p[0] - p[1]) * 0.6) % 5 else (rgb("#6fa8c7"), True)
        return rgb(WHITE)
    S.append(box(-10.0, -4.0, 4.4, 5.0, 4.0, 8.8, deck1, extra=[plane_through((1, 0, 0.8), (5.0, 0, 4.4))]))

    def deck2(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(WHITE)
        if 9.6 < p[2] < 11.2:
            return rgb("#2c3e50")
        return rgb(WHITE)
    S.append(box(-7.0, -3.2, 8.8, 1.5, 3.2, 12.0, deck2, extra=[plane_through((1, 0, 1.0), (1.5, 0, 8.8))]))
    S.append(box(-6.0, -3.6, 12.0, -1.0, 3.6, 12.6, flat(NAVY)))              # sun canopy
    S.append(vcyl(-3.0, 0, 0.3, 12.6, 16.0, flat("#d9d9d9"), sides=6))
    S.append(box(-3.6, -0.3, 15.4, -2.4, 0.3, 16.6, flat("#d9d9d9")))
    S.append(box(-14.5, -4.0, 4.4, -10.0, 4.0, 5.0, flat("#c9a26a")))        # swim platform
    for y in (-2.2, 2.2):
        S.append(box(-13.0, y - 0.9, 5.0, -11.2, y + 0.9, 5.6, flat(SUN)))   # towels on loungers
    return S


def tour_boat():
    """Glass-bottom tour boat: wide hull, striped canopy on poles, rows of guests' seats."""
    S = [hull_solid(26.0, 10.0, 3.4, -1.0, painted_hull("#c9a26a", SUN, TEAL, z_stripe=(1.4, 2.2)), bow=6.0, flare=0.3)]
    for x in (-8.0, -3.0, 2.0):
        S.append(box(x, -3.6, 3.4, x + 2.2, 3.6, 5.2, flat("#e8553f" if x == -3.0 else TEAL)))
    for (x, y) in ((-10.0, -4.0), (-10.0, 4.0), (4.0, -4.0), (4.0, 4.0)):
        S.append(vcyl(x, y, 0.3, 3.4, 11.0, flat(WHITE), sides=6))

    def canopy(p, n):
        f, u, v = face_uv(p, n)
        return rgb("#e8553f") if int((p[0] + 20) // 2.4) % 2 else rgb(WHITE)
    S.append(box(-11.0, -5.0, 11.0, 5.0, 5.0, 12.0, canopy))
    S.append(box(5.0, -2.0, 3.4, 7.6, 2.0, 7.0, flat(WHITE)))                # helm console
    S.append(box(-12.4, -0.3, 3.4, -11.6, 0.3, 9.0, flat("#d9d9d9")))        # flag staff
    S.append(box(-14.6, -0.15, 7.4, -12.0, 0.15, 9.0, flat(TEAL)))
    return S


def rowboat():
    def hull(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#6b4a2b") if abs(p[1]) < 2.2 else rgb("#8a6440")
        return rgb("#c0392b") if p[2] < 1.0 else rgb("#f2efe6")
    S = [hull_solid(16.0, 6.4, 2.6, -1.0, hull, bow=4.0, flare=1.0)]
    S.append(box(-1.0, -2.2, 1.4, 1.0, 2.2, 2.0, flat("#a97c4f")))
    S.append(hcyl("y", 0, 2.4, 0.3, -6.0, 6.0, flat("#c9a77c"), sides=4))   # oars
    return S


KINDS = {
    "sail_white": lambda: sailboat(),
    "sail_red": lambda: sailboat(sail="#f2d0c4", hull_col=RED),
    "speedboat": speedboat,
    "fishing": fishing_boat,
    "catamaran": catamaran,
    "yacht": yacht,
    "tour": tour_boat,
    "rowboat": rowboat,
}


def catalogue():
    cat = {}
    for k, fn in KINDS.items():
        m = fn()
        cat[f"boat_{k}_x"] = m
        cat[f"boat_{k}_y"] = swap_xy(m)
        cat[f"boat_{k}_xr"] = mirror_x(m)
        cat[f"boat_{k}_yr"] = swap_xy(mirror_x(m))
    return cat


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    only = sys.argv[1:]
    for name, solids in catalogue().items():
        if only and not any(o in name for o in only):
            continue
        im, anchor = render(solids, ground_shadow=0)
        im.save(f"out/{name}.png")
        fx0 = min(s.aabb[0] for s in solids); fy0 = min(s.aabb[1] for s in solids)
        fx1 = max(s.aabb[3] for s in solids); fy1 = max(s.aabb[4] for s in solids)
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1],
                         hull=solid_hull(solids, anchor), fp=[round(fx0, 2), round(fy0, 2), round(fx1, 2), round(fy1, 2)])
        print(name, im.size, flush=True)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
