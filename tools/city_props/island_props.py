"""Island-theme props (same renderer as props.py). Run: python3 island_props.py"""
import json, math, os, sys
import numpy as np
from isopix import box, vcyl, hcyl, blob, Solid, face_uv, rgb, mix, hash2, render, plane_through
from props import cone, flat, solid_hull


def emis(c):
    c = rgb(c)
    return lambda p, n: (c, True)


def leafy(seed, lo="#2f7d46", mid="#4b9e55", hi="#7cc46a"):
    def m(p, n):
        h = hash2(int(p[0] / 1.8), int(p[1] / 1.8) + int(p[2] / 1.8) * 7, seed)
        if h < 0.28:
            return rgb(lo)
        if h > 0.8:
            return rgb(hi)
        return rgb(mid)
    return m


def pine(seed=0, h=34.0):
    """Layered conifer: three stacked cones on a short trunk."""
    m = leafy(seed, "#1f5a3a", "#2e7349", "#4f9a5e")
    S = [vcyl(0, 0, 1.2, 0, 7, flat("#6b4a33"), sides=6)]
    tiers = [(5.0, 7.5, 13.0), (12.0, 6.0, 11.0), (18.5, 4.4, 9.5), (24.0, 2.8, 8.0)]
    for (z0, r, hh) in tiers:
        S.append(cone(0, 0, z0, r * (h / 34.0) ** 0.3, hh, m, sides=10))
    return S


def bush(seed=0, flowers=None):
    m = leafy(seed, "#2f7d46", "#4b9e55", "#6fb35a")

    def fm(p, n):
        if flowers and hash2(int(p[0] * 1.3), int(p[1] * 1.3) + int(p[2] * 1.3) * 5, seed + 3) < 0.16:
            return rgb(flowers)
        return m(p, n)
    return [blob(0, 0, 3.4, 4.2, fm, n=22, squash=0.8, seed=seed),
            blob(3.0, 1.6, 2.6, 3.0, fm, n=16, squash=0.85, seed=seed + 1),
            blob(-2.4, 2.0, 2.4, 2.8, fm, n=16, squash=0.85, seed=seed + 2)]


def boulder(seed=0, big=True):
    def m(p, n):
        f, u, v = face_uv(p, n)
        h = hash2(int(p[0] * 1.2), int(p[1] * 1.2) + int(p[2] * 1.2) * 3, seed)
        if f == "top" and n[2] > 0.75:
            return rgb("#5f9a4c") if h > 0.35 else rgb("#4f8a40")  # moss cap
        return rgb("#9a9890") if h > 0.6 else (rgb("#86847c") if h > 0.2 else rgb("#74726b"))
    r = 4.6 if big else 3.0
    S = [blob(0, 0, r * 0.55, r, m, n=18, squash=0.75, seed=seed)]
    if big:
        S.append(blob(4.0, 2.6, 1.6, 2.2, m, n=14, squash=0.8, seed=seed + 4))
    return S


def palm(seed=0, lean=1.0):
    """Leaning palm: segmented trunk + drooping fronds + coconuts."""
    S = []
    x = y = 0.0
    for k in range(9):
        z0 = k * 3.2
        S.append(vcyl(x, y, 1.15 - k * 0.04, z0, z0 + 3.4,
                      flat("#9c7a52" if k % 2 else "#8a6a46"), sides=6))
        x += 0.55 * lean
        y -= 0.15 * lean
    top = 9 * 3.2
    fr = leafy(seed, "#2e7d3a", "#3f9a48", "#69c35c")
    for a in range(8):
        ang = a * 2 * math.pi / 8 + 0.3
        for k, (dist, dz, rr) in enumerate(((2.6, 0.6, 2.2), (5.2, -1.2, 2.0), (7.6, -3.6, 1.6))):
            fx, fy = x + math.cos(ang) * dist, y + math.sin(ang) * dist
            S.append(blob(fx, fy, top + dz, rr, fr, n=12, squash=0.45, seed=seed + a * 3 + k))
    S.append(blob(x, y, top + 1.0, 2.2, fr, n=12, squash=0.7, seed=seed + 40))
    for (dx, dy) in ((0.9, 0.5), (-0.6, 0.8), (0.2, -0.9)):
        S.append(blob(x + dx, y + dy, top - 1.2, 0.9, flat("#6b4a2b"), n=10))
    return S


def lighthouse():
    """Red/white striped tower with gallery, glowing lantern room and red cap."""
    def stripes(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e9e4dc")
        return rgb("#d8443c") if int(p[2] // 8) % 2 else rgb("#f4f1ea")
    S = [vcyl(0, 0, 6.2, 0, 4.0, flat("#8c8a84"), sides=12)]            # stone footing
    for k in range(6):
        z0 = 4 + k * 8
        r = 4.8 - k * 0.42
        S.append(vcyl(0, 0, r, z0, z0 + 8.2, stripes, sides=12))
    zt = 4 + 6 * 8
    S += [vcyl(0, 0, 4.4, zt, zt + 1.2, flat("#2d3238"), sides=12),       # gallery deck
          vcyl(0, 0, 4.2, zt + 1.2, zt + 2.4, flat("#3a4048"), sides=12),  # railing band
          vcyl(0, 0, 2.6, zt + 1.2, zt + 7.2, emis("#fff2a8"), sides=10),   # lantern glass
          vcyl(0, 0, 2.9, zt + 7.2, zt + 8.0, flat("#2d3238"), sides=10),
          cone(0, 0, zt + 8.0, 3.0, 4.2, flat("#c0392b"), sides=10),
          vcyl(0, 0, 0.4, zt + 12.2, zt + 14.0, flat("#2d3238"), sides=6)]
    # door + window
    def door(p, n):
        return rgb("#3a2a20")
    S.append(box(-1.2, 4.6, 4.0, 1.2, 4.9, 10.0, door))
    S.append(box(4.0, -1.0, 24.0, 4.3, 1.0, 27.0, emis("#ffe39a")))
    return S


def dock(length=64.0, w=11.0, deck=3.2):
    """Wooden pier running along +y from the beach (origin at the shore end, water level)."""
    def planks(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            k = int(p[1] // 2.6)
            c = rgb("#b98a5a") if k % 2 else rgb("#a97c4f")
            if p[1] % 2.6 < 0.35:
                c = rgb("#7a5a3a")
            return c
        return rgb("#8a6440")
    S = [box(-w / 2, 0, deck, w / 2, length, deck + 1.0, planks)]
    for y in np.arange(4.0, length, 12.0):
        for x in (-w / 2 + 0.6, w / 2 - 1.6):
            S.append(box(x, y, -3.0, x + 1.0, y + 1.0, deck + 2.6, flat("#6b4a2b")))
    # rails along the last bit + a lamp at the end
    S.append(box(w / 2 - 0.8, length - 20, deck + 1.0, w / 2 - 0.2, length, deck + 4.2, flat("#7a5a3a")))
    S.append(box(-w / 2 + 0.2, length - 1.2, deck + 1.0, -w / 2 + 1.0, length - 0.4, deck + 12.0, flat("#3a3027")))
    S.append(box(-w / 2 - 0.4, length - 1.6, deck + 10.4, -w / 2 + 1.6, length, deck + 12.6, emis("#ffd98a")))
    return S


def rowboat(along="x"):
    def hull(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#6b4a2b") if abs(p[1]) < 2.2 else rgb("#8a6440")
        return rgb("#c0392b") if p[2] < 1.0 else rgb("#f2efe6")
    L, W = 16.0, 6.4
    S = [box(-L / 2, -W / 2, -1.0, L / 2, W / 2, 2.6, hull,
             extra=[plane_through((1, 0, -0.9), (L / 2 - 2.5, 0, -1.0)),
                    plane_through((-1, 0, -0.9), (-L / 2 + 2.5, 0, -1.0)),
                    plane_through((0, 1, -1.0), (0, W / 2 - 1.2, -1.0)),
                    plane_through((0, -1, -1.0), (0, -W / 2 + 1.2, -1.0))])]
    S.append(box(-1.0, -W / 2 + 1.0, 1.4, 1.0, W / 2 - 1.0, 2.0, flat("#a97c4f")))  # seat
    S.append(box(-0.3, -W / 2 - 3.0, 2.0, 0.3, W / 2 + 3.0, 2.4, flat("#c9a77c")))  # oars
    return S


def sailboat():
    def hull(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#b98a5a")
        return rgb("#2f6db5") if p[2] < 1.4 else rgb("#f4f1ea")
    L, W = 22.0, 8.0
    S = [box(-L / 2, -W / 2, -1.0, L / 2, W / 2, 3.2, hull,
             extra=[plane_through((1, 0, -0.5), (L / 2 - 4.0, 0, -1.0)),
                    plane_through((0, 1, -0.9), (0, W / 2 - 1.4, -1.0)),
                    plane_through((0, -1, -0.9), (0, -W / 2 + 1.4, -1.0))])]
    S.append(vcyl(1.0, 0, 0.45, 3.2, 30.0, flat("#6b4a2b"), sides=6))
    # mainsail: thin slab cut to a triangle (taller at the mast)
    def sail(p, n):
        return rgb("#fbfaf6") if int(p[2] // 6) % 4 else rgb("#e6e2d8")
    S.append(box(-9.0, -0.25, 5.0, 0.6, 0.25, 29.0, sail,
                 extra=[plane_through((-0.8, 0, 1), (0.6, 0, 29.0))]))
    S.append(box(1.4, -0.25, 5.0, 8.5, 0.25, 24.0, flat("#f4f1ea"),
                 extra=[plane_through((0.9, 0, 1), (1.4, 0, 24.0))]))
    return S


def campfire():
    def stones(p, n):
        return rgb("#8c8a84") if hash2(int(p[0] * 2), int(p[1] * 2), 4) > 0.3 else rgb("#6f6d67")
    S = []
    for k in range(9):
        a = k * 2 * math.pi / 9
        S.append(blob(math.cos(a) * 3.6, math.sin(a) * 3.6, 0.7, 1.1, stones, n=10, seed=k))
    S.append(box(-3.0, -0.6, 0.0, 3.0, 0.6, 1.2, flat("#6b4a33")))
    S.append(box(-0.6, -3.0, 0.4, 0.6, 3.0, 1.6, flat("#7a5a3a")))
    S.append(cone(0, 0, 1.2, 2.2, 4.8, emis("#ff9f2e"), sides=8))
    S.append(cone(0.3, 0.2, 1.4, 1.2, 3.0, emis("#ffe27a"), sides=8))
    # log seats
    S.append(hcyl("x", 8.0, 1.4, 1.4, -5.0, 5.0, flat("#8a6440"), sides=8))
    S.append(hcyl("y", 8.0, 1.4, 1.4, -5.0, 5.0, flat("#7a5a3a"), sides=8))
    return S


def lantern_post():
    return [box(-0.6, -0.6, 0, 0.6, 0.6, 15.0, flat("#5a4330")),
            box(-0.4, -0.4, 14.4, 3.6, 0.4, 15.2, flat("#5a4330")),
            box(2.4, -1.0, 10.6, 4.4, 1.0, 13.6, emis("#ffd98a")),
            box(2.2, -1.2, 13.6, 4.6, 1.2, 14.4, flat("#3a3027"))]


def signpost():
    def board(p, n):
        return rgb("#c9a77c") if face_uv(p, n)[0] != "top" else rgb("#b8946a")
    return [box(-0.5, -0.5, 0, 0.5, 0.5, 13.0, flat("#6b4a33")),
            box(0.5, -0.4, 9.0, 8.0, 0.4, 11.6, board,
                extra=[plane_through((1, 0.0, 0.0), (8.0, 0, 0))]),
            box(-7.0, -0.4, 5.8, -0.5, 0.4, 8.2, board)]


def fence_x(length=20.0):
    S = []
    for x in np.arange(0, length + 0.1, 5.0):
        S.append(box(x - 0.5, -0.5, 0, x + 0.5, 0.5, 6.0, flat("#8a6440")))
    S.append(box(0, -0.3, 3.4, length, 0.3, 4.4, flat("#a97c4f")))
    S.append(box(0, -0.3, 1.2, length, 0.3, 2.2, flat("#a97c4f")))
    return S


def flower_patch(seed=0):
    cols = ["#ff8fab", "#ffd166", "#ffffff", "#b28dff", "#ff6b6b"]
    S = []
    r = np.random.default_rng(seed)
    for k in range(9):
        x, y = r.uniform(-4, 4), r.uniform(-4, 4)
        S.append(box(x - 0.2, y - 0.2, 0, x + 0.2, y + 0.2, 1.8, flat("#3f8f4a")))
        S.append(blob(x, y, 2.2, 0.85, flat(cols[k % len(cols)]), n=8))
    return S


def catalogue():
    cat = {}
    for v in range(3):
        cat[f"pine_{v}"] = (pine(v * 5, 30 + v * 6), dict(gs=10))
    for v, fl in enumerate((None, "#ff8fab", "#ffd166")):
        cat[f"bush_{v}"] = (bush(v * 3, fl), dict(gs=6))
    cat["boulder_big"] = (boulder(2, True), dict(gs=6))
    cat["boulder_small"] = (boulder(7, False), dict(gs=4))
    cat["palm_0"] = (palm(1, 1.0), dict(gs=10))
    cat["palm_1"] = (palm(4, -0.8), dict(gs=10))
    cat["lighthouse"] = (lighthouse(), dict(gs=14))
    cat["dock"] = (dock(), dict(gs=4))
    cat["rowboat"] = (rowboat(), dict(gs=0))
    cat["sailboat"] = (sailboat(), dict(gs=0))
    cat["campfire"] = (campfire(), dict(gs=4))
    cat["lantern_post"] = (lantern_post(), dict(gs=8))
    cat["signpost"] = (signpost(), dict(gs=6))
    cat["fence_x"] = (fence_x(), dict(gs=4))
    cat["flower_patch_0"] = (flower_patch(1), dict(gs=0))
    cat["flower_patch_1"] = (flower_patch(5), dict(gs=0))
    return cat


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    only = sys.argv[1:]
    for name, (solids, opt) in catalogue().items():
        if only and not any(o in name for o in only):
            continue
        im, anchor = render(solids, ground_shadow=opt.get("gs", 8))
        im.save(f"out/{name}.png")
        fx0 = min(s.aabb[0] for s in solids); fy0 = min(s.aabb[1] for s in solids)
        fx1 = max(s.aabb[3] for s in solids); fy1 = max(s.aabb[4] for s in solids)
        man[name] = dict(w=im.width, h=im.height, ax=anchor[0], ay=anchor[1],
                         hull=solid_hull(solids, anchor), fp=[round(fx0, 2), round(fy0, 2), round(fx1, 2), round(fy1, 2)])
        print(name, im.size)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
