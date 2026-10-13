"""
Space-theme ground: the main deck of an orbital station floating in the void —
riveted metal deck plates, grated corridors with glowing cyan guide lines to each
zone's door, a hazard-striped landing pad at the front, hull bulkheads with big
viewports (stars + planet limb) on the N and W walls, an airlock on the W wall,
and the station hull below the deck edge with lit portholes and running lights.

Run: python3 space_ground.py -> out/space_ground.png + manifest entry + out/space_spots.json
"""
import json, math
from isopix import box, render, rgb, mix, hash2, face_uv
from interiors import U
from props import solid_hull, flat

GX0, GY0, GX1, GY1 = 0.0, 0.0, 22.0, 16.3
HULL = 20.0
WALL_H = 46.0
WT = 3.0
PAD = (17.6, 14.0, 1.75)                # landing pad centre (grid) + radius
LOCK = (11.7, 16.3)                     # airlock module along the W wall (grid y)
CYAN, CYAN_D = "#3ec8e0", "#1f7f92"
HAZ, HAZ_D = "#f2c14e", "#2a2d33"

ZONES = {
    "specs": (1.0, 0.9, 6.0, 5.3, "#3ec8e0"),
    "plan": (7.0, 0.9, 12.0, 5.3, "#5b8cff"),
    "build": (1.0, 6.0, 6.0, 10.6, "#ff9f43"),
    "review": (7.0, 6.0, 12.0, 10.6, "#b07cff"),
    "explore": (12.8, 0.9, 21.0, 5.3, "#ffd84a"),
    "idle": (12.8, 6.0, 21.0, 11.4, "#5ee08f"),
}
LOCKPT = (0.9, 13.3)
ROUTES = {"specs": (3.5, 5.3), "build": (3.5, 6.0), "plan": (9.5, 5.3), "review": (9.5, 6.0)}
ORDER = ["specs", "build", "plan", "review", "explore", "idle"]


def route_pts(zid):
    o = (ORDER.index(zid) - 2.5) * 0.13                 # parallel lanes
    pts = [(LOCKPT[0], 13.3 + o), (6.5 + o, 13.3 + o), (6.5 + o, 5.65 + o * 0.6)]
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
    return any(x0 - pad <= x <= x1 + pad and y0 - pad <= y <= y1 + pad for (x0, y0, x1, y1, c) in ZONES.values())


def deck_plate(ux, uy):
    t = U / 2
    a, b = int(ux // t), int(uy // t)
    cu, cv = ux % t, uy % t
    if cu < 0.6 or cv < 0.6:
        return rgb("#1e242c")                        # seams
    if (abs(cu - 1.6) < 0.45 or abs(cu - t + 1.6) < 0.45) and (abs(cv - 1.6) < 0.45 or abs(cv - t + 1.6) < 0.45):
        return rgb("#5b6573")                        # rivets
    h = hash2(a, b, 301)
    c = rgb("#343c47") if h > 0.5 else rgb("#2f3640")
    if hash2(int(ux), int(uy), 302) < 0.03:
        c = c * 1.08
    return c


def grating(ux, uy):
    if (ux + uy) % 2.4 < 0.8 or (ux - uy) % 2.4 < 0.8:
        return rgb("#262c34")
    return rgb("#3b434e")


def floor_top(x, y, ux, uy):
    for zid, pts in LINES.items():
        for a, b in zip(pts, pts[1:]):
            d = seg_d(x, y, a, b) * U
            if d < 1.6 and not in_zone(x, y, -0.05):
                if d < 0.7:
                    return (rgb(ZONES[zid][4]), True)
                return rgb("#1b2a33")
    # landing pad: hazard ring, deck circle, H mark
    dx, dy = x - PAD[0], (y - PAD[1]) * 1.0
    r = math.hypot(dx, dy)
    if r < PAD[2]:
        if r > PAD[2] - 0.16:
            return (rgb(CYAN), True) if int(math.atan2(dy, dx) * 6) % 2 else rgb(CYAN_D)
        if r > PAD[2] - 0.42:
            return rgb(HAZ) if int((ux + uy) // 2.5) % 2 else rgb(HAZ_D)
        if (abs(dx) < 0.55 and abs(dy) < 0.08) or (abs(abs(dx) - 0.5) < 0.08 and abs(dy) < 0.6):
            return rgb("#e9eef2")
        return rgb("#2a3038") if int((ux - uy) // 3) % 2 else rgb("#2d343d")
    # airlock apron: hazard chevrons in front of the airlock door
    if x < 2.4 and LOCK[0] + 0.6 <= y <= LOCK[1] - 0.8:
        if x > 2.2 or y < LOCK[0] + 0.75 or y > LOCK[1] - 0.95:
            return rgb(HAZ)
        return rgb(HAZ) if int((ux + uy) // 3.0) % 2 else rgb(HAZ_D)
    # corridors between zones: grating; elsewhere plates
    corridor = (abs(x - 6.5) < 0.42 and y < 12.0) or (abs(x - 12.4) < 0.38 and y < 12.0) or \
               (abs(y - 5.65) < 0.3 and x < 12.8) or (11.45 < y < 12.05)
    if corridor:
        return grating(ux, uy)
    # front deck edge: hazard band
    if y > GY1 - 0.18 or x > GX1 - 0.18:
        return rgb(HAZ) if int((ux + uy) // 3.0) % 2 else rgb(HAZ_D)
    return deck_plate(ux, uy)


def space_view(u, z, seed, planet=False):
    """Viewport: starfield, a faint nebula band and (N wall) the limb of a blue planet."""
    zz = (z - 6.0) / (WALL_H - 10.0)
    c = mix(rgb("#05070d"), rgb("#0c1426"), zz)
    neb = math.sin(u * 0.035 + seed) * 0.5 + 0.5
    if abs(zz - 0.55 - 0.15 * math.sin(u * 0.02)) < 0.12:
        c = mix(c, rgb("#3a2a5e"), 0.35 * neb)
    if planet:
        R = 260.0
        cx, cz = 330.0, -205.0
        d = math.hypot(u - cx, (z - cz) * 1.0)
        if d < R:
            k = (R - d) / 40.0
            base = mix(rgb("#3f8fd0"), rgb("#1c4f8a"), min(1.0, k))
            cl = math.sin(u * 0.09 + z * 0.35) + math.sin(u * 0.033 - z * 0.6 + 1.3)
            if cl > 1.2:
                base = mix(base, rgb("#e9f2f8"), 0.55)          # cloud bands
            elif hash2(int(u // 9), int(z // 4), seed + 5) > 0.85:
                base = mix(base, rgb("#5aa86a"), 0.5)           # land
            if d > R - 2.2:
                return (rgb("#8fe0ff"), True)                     # atmosphere glow
            return (base, True)
    h = hash2(int(u), int(z), seed)
    if h > 0.992:
        return (rgb("#ffffff"), True)
    if h > 0.982:
        return (rgb("#9fb8ff"), True)
    return (c, True)


def bulkhead(which):
    def m(p, n):
        f, u, v = face_uv(p, n)
        coord = p[0] if which == "N" else p[1]
        z = p[2]
        inner = (f == "L" and which == "N") or (f == "R" and which == "W")
        if f == "top":
            return rgb("#3b434e")
        if not inner:
            return rgb("#4a5361")
        if z < 3.0:
            return rgb(HAZ) if int((coord + z) // 2.0) % 2 else rgb(HAZ_D)   # hazard skirting
        if z < 7.0:
            if abs(z - 5.0) < 0.6:
                return rgb("#8a939c")                    # pipe
            return rgb("#3b434e")
        if z > WALL_H - 5.0:
            if abs(z - (WALL_H - 3.0)) < 0.5:
                return (rgb(CYAN), True)                 # light strip
            return rgb("#3b434e")
        # viewport frames: heavy ribs every 2 grid
        if coord % (2 * U) < 2.4:
            return rgb("#5b6573") if coord % (2 * U) > 0.6 else rgb("#2a3038")
        if z < 9.0 or z > WALL_H - 7.0:
            return rgb("#5b6573")
        return space_view(coord + (500 if which == "W" else 0), z, 11 if which == "N" else 13, planet=(which == "N"))
    return m


def airlock():
    y0, y1 = LOCK[0] * U, LOCK[1] * U
    a, b = y0 + 1.1 * U, y0 + 3.4 * U

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#3b434e")
        if f != "R":
            return rgb("#4a5361")
        y, z = p[1], p[2]
        if a - 2.0 <= y <= b + 2.0 and z < 28.0:
            if y < a or y > b or z > 26.0:
                return rgb(HAZ) if int((y + z) // 2.0) % 2 else rgb(HAZ_D)   # striped frame
            mid = (a + b) / 2
            if abs(y - mid) < 0.4:
                return rgb("#1e242c")
            if abs(z - 13.0) < 3.0 and abs(y - mid) < 6.0 and math.hypot(y - mid, (z - 13.0) * 2) < 6.0:
                return (rgb("#8fe0ff"), True) if math.hypot(y - mid, (z - 13.0) * 2) < 4.6 else rgb("#2a3038")  # porthole
            return rgb("#7d8794") if int((y - a) // 3) % 2 else rgb("#727c89")
        if b + 3.5 < y < b + 6.5 and 10.0 < z < 15.0:
            return (rgb("#5ee08f"), True) if z > 12.6 else (rgb("#ff5a5a"), True)   # lock status
        if a + 2 < y < b - 2 and 30.0 < z < 33.0:
            return (rgb(CYAN), True) if int((y - a) // 2.2) % 2 else rgb("#2a3038")
        k = int(y // 6.0)
        return rgb("#5b6573") if (y % 6.0) > 0.5 else rgb("#2a3038")
    return box(0, y0, 0, WT, y1, WALL_H - 4.0, m)


def hull_mat(p, n):
    f, u, v = face_uv(p, n)
    ux, uy = p[0], p[1]
    x, y = GX0 + ux / U, GY0 + uy / U
    if f != "top":
        z = p[2]
        coord = ux if f == "L" else uy
        if z > -1.6:
            return rgb(HAZ) if int((coord - z) // 2.5) % 2 else rgb(HAZ_D)
        if z > -3.0:
            return rgb("#5b6573")
        # hull panels with portholes and a running-light strip
        if abs(z + 9.0) < 2.0 and coord % (U * 0.75) > U * 0.75 - 4.0:
            return (rgb("#ffe7a8"), True) if hash2(int(coord // (U * 0.75)), 1, 303) > 0.35 else rgb("#1e242c")
        if abs(z + 15.5) < 0.5:
            k = int(coord // 12)
            return (rgb("#ff5a5a") if k % 5 == 0 else rgb(CYAN), True) if coord % 12 < 1.5 else rgb("#2a3038")
        if coord % 23.45 < 0.6 or abs(z + 12.5) < 0.3:
            return rgb("#2a3038")
        c = rgb("#4f5866") if f == "L" else rgb("#434b57")
        if hash2(int(coord // 23.45), int(z // 6), 304) > 0.8:
            c = c * 0.9
        return c
    return floor_top(x, y, ux, uy)


def solids():
    W, D = (GX1 - GX0) * U, (GY1 - GY0) * U
    S = [box(0, 0, -HULL, W, D, 0, hull_mat, cast=False)]
    S.append(box(0, 0, 0, W, WT, WALL_H, bulkhead("N"), cast=False))
    S.append(box(0, WT, 0, WT, LOCK[0] * U, WALL_H, bulkhead("W"), cast=False))
    S.append(airlock())
    S.append(box(0, LOCK[0] * U, WALL_H - 4.0, WT, D, WALL_H, flat("#3b434e"), cast=False))
    # structural ribs standing proud of the bulkheads
    for gx in (2.0, 6.0, 10.0, 14.0, 18.0):
        S.append(box(gx * U - 2.6, 0, 0, gx * U + 2.6, WT + 2.8, WALL_H, flat("#5b6573"), cast=False))
    for gy in (4.0, 8.0):
        S.append(box(0, gy * U - 2.6, 0, WT + 2.8, gy * U + 2.6, WALL_H, flat("#5b6573"), cast=False))
    return S


def spots():
    S = []
    add = lambda t, x, y, **kw: S.append(dict({"type": "city_" + t, "gx": x, "gy": y}, **kw))
    add("space_shuttle", PAD[0], PAD[1])
    add("space_crates", 3.4, 13.9)
    add("space_canisters", 0.6, 11.35)
    add("space_bot", 5.2, 15.2)
    add("space_console", 9.3, 14.4)
    add("space_crates", 11.0, 15.6)
    add("space_holo_beacon", 7.3, 12.5)
    add("space_tank", 12.4, 12.4)
    add("space_hydro_pod", 14.4, 12.5)
    add("space_drone", 20.9, 11.95)
    add("space_canisters", 14.6, 15.6)
    add("space_floor_light", 2.9, 12.3)
    add("space_floor_light", 21.6, 15.8)
    return S


if __name__ == "__main__":
    S = solids()
    im, anchor = render(S, ground_shadow=0)
    im.save("out/space_ground.png")
    man = json.load(open("out/manifest.json"))
    man["space_ground"] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1], unitsPerGrid=U,
                               gx0=GX0, gy0=GY0, hull=solid_hull(S[:1], anchor))
    json.dump(man, open("out/manifest.json", "w"), indent=1)
    json.dump(spots(), open("out/space_spots.json", "w"), indent=1)
    print("space_ground", im.size, anchor)
