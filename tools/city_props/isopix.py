"""
isopix — tiny orthographic 2:1 isometric pixel-art renderer.

World units: 1 unit = 1 screen pixel along x.  One board grid cell = 22 units.
Projection: sx = x - y,  sy = (x + y)/2 - z.   (+x = right face, +y = left face)
Every primitive is a convex solid (intersection of half-spaces n.p <= c), so
boxes, wedges, chamfered car bodies and n-gon cylinders all use one ray test.
"""
import math
import numpy as np
from PIL import Image

VIEW = np.array([1.0, 1.0, 1.0])            # toward the viewer
LIGHT = np.array([-0.32, 0.5, 1.0])          # toward the sun (upper-left)
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def _n(v):
    v = np.array(v, float)
    return v / np.linalg.norm(v)


class Solid:
    def __init__(self, planes, aabb, mat, cast=True, name=""):
        self.planes = [(_n(n), float(c) / np.linalg.norm(n)) for n, c in planes]
        self.aabb = aabb  # (x0,y0,z0,x1,y1,z1)
        self.mat = mat
        self.cast = cast
        self.name = name


# ---------------------------------------------------------------- primitives
def box(x0, y0, z0, x1, y1, z1, mat, extra=(), **kw):
    pl = [((1, 0, 0), x1), ((-1, 0, 0), -x0), ((0, 1, 0), y1),
          ((0, -1, 0), -y0), ((0, 0, 1), z1), ((0, 0, -1), -z0)]
    pl += list(extra)
    return Solid(pl, (x0, y0, z0, x1, y1, z1), mat, **kw)


def plane_through(normal, point):
    n = np.array(normal, float)
    return (tuple(n), float(np.dot(n, point)))


def vcyl(cx, cy, r, z0, z1, mat, sides=8, rot=None, **kw):
    rot = math.pi / sides if rot is None else rot
    pl = [((0, 0, 1), z1), ((0, 0, -1), -z0)]
    for i in range(sides):
        a = rot + 2 * math.pi * i / sides
        n = (math.cos(a), math.sin(a), 0)
        pl.append((n, n[0] * cx + n[1] * cy + r))
    return Solid(pl, (cx - r, cy - r, z0, cx + r, cy + r, z1), mat, **kw)


def hcyl(axis, c1, c2, r, a0, a1, mat, sides=8, **kw):
    """Cylinder along 'x' or 'y'. c1,c2 = centre in the other horizontal axis and z."""
    pl = []
    rot = math.pi / sides
    for i in range(sides):
        a = rot + 2 * math.pi * i / sides
        h, z = math.cos(a), math.sin(a)
        if axis == "y":
            n = (h, 0, z)
            pl.append((n, h * c1 + z * c2 + r))
        else:
            n = (0, h, z)
            pl.append((n, h * c1 + z * c2 + r))
    if axis == "y":
        pl += [((0, 1, 0), a1), ((0, -1, 0), -a0)]
        aabb = (c1 - r, a0, c2 - r, c1 + r, a1, c2 + r)
    else:
        pl += [((1, 0, 0), a1), ((-1, 0, 0), -a0)]
        aabb = (a0, c1 - r, c2 - r, a1, c1 + r, c2 + r)
    return Solid(pl, aabb, mat, **kw)


def blob(cx, cy, cz, r, mat, n=26, squash=1.0, seed=0, **kw):
    """Faceted sphere (fibonacci plane set) — tree canopies, bushes."""
    pl = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        y = 1 - 2 * (i + 0.5) / n
        rr = math.sqrt(1 - y * y)
        th = ga * i + seed
        nx, ny, nz = math.cos(th) * rr, math.sin(th) * rr, y
        nz2 = nz / squash
        L = math.sqrt(nx * nx + ny * ny + nz2 * nz2)
        nv = (nx / L, ny / L, nz2 / L)
        # support of ellipsoid along nv
        sup = r * math.sqrt(nv[0] ** 2 + nv[1] ** 2 + (nv[2] * squash) ** 2)
        pl.append((nv, nv[0] * cx + nv[1] * cy + nv[2] * cz + sup))
    rz = r * squash
    return Solid(pl, (cx - r, cy - r, cz - rz, cx + r, cy + r, cz + rz), mat, **kw)


# ---------------------------------------------------------------- helpers
def face_uv(p, n):
    """Return (face, u, v). u runs screen-left→right on vertical faces."""
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    if az >= ax and az >= ay:
        return ("top" if n[2] > 0 else "bot"), p[0], p[1]
    if ax >= ay:
        return ("R" if n[0] > 0 else "R-"), -p[1], p[2]
    return ("L" if n[1] > 0 else "L-"), p[0], p[2]


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def mix(a, b, t):
    return a * (1 - t) + b * t


FONT = {
    "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
    "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
    "G": ["011", "100", "101", "101", "011"], "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"], "J": ["001", "001", "001", "101", "010"],
    "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"], "N": ["110", "101", "101", "101", "101"],
    "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
    "Q": ["010", "101", "101", "110", "011"], "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"], "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
    " ": ["000"] * 5, "+": ["000", "010", "111", "010", "000"],
    "&": ["010", "101", "010", "101", "011"], "'": ["010", "010", "000", "000", "000"],
}


def text_hit(text, u, v, u0, v_top):
    """Is (u,v) on a lit pixel of `text` whose top-left is (u0, v_top)? v grows up."""
    col = math.floor(u - u0)
    row = math.floor(v_top - v)
    if row < 0 or row > 4 or col < 0:
        return False
    ci, cx = divmod(col, 4)
    if ci >= len(text) or cx == 3:
        return False
    g = FONT.get(text[ci].upper(), FONT[" "])
    return g[row][cx] == "1"


def hash2(a, b, s=0):
    h = (int(a) * 73856093) ^ (int(b) * 19349663) ^ (s * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


# ---------------------------------------------------------------- renderer
def _ray(solid, P0, d):
    """Vectorised convex-solid ray test. Returns (hit, t_front, plane_idx)."""
    shp = P0.shape[:-1]
    lo = np.full(shp, -1e9)
    hi = np.full(shp, 1e9)
    idx = np.full(shp, -1, int)
    valid = np.ones(shp, bool)
    for k, (n, c) in enumerate(solid.planes):
        nd = float(np.dot(n, d))
        npp = P0 @ n
        if abs(nd) < 1e-9:
            valid &= npp <= c + 1e-9
        elif nd > 0:
            t = (c - npp) / nd
            m = t < hi
            hi = np.where(m, t, hi)
            idx = np.where(m, k, idx)
        else:
            t = (c - npp) / nd
            lo = np.maximum(lo, t)
    hit = valid & (hi >= lo)
    return hit, hi, idx, lo


def _occluded(solids, P, skip_self=None):
    """Shadow test toward LIGHT for points P (N,3)."""
    occ = np.zeros(P.shape[0], bool)
    for s in solids:
        if not s.cast:
            continue
        hit, hi, idx, lo = _ray(s, P, LIGHT)
        occ |= hit & (hi > 0.35) & (np.maximum(lo, 0.35) <= hi)
    return occ


def shade(col, n, shadowed=False, emissive=False):
    if emissive:
        return np.clip(col, 0, 255)
    nx, ny, nz = n
    b = 0.0
    b += nz * nz * (1.0 if nz > 0 else 0.5)
    b += ny * ny * (0.82 if ny > 0 else 0.55)
    b += nx * nx * (0.63 if nx > 0 else 0.55)
    out = col * b + (1 - b) * np.array([-10.0, -4.0, 14.0])
    if shadowed:
        out = out * 0.66 + np.array([-4.0, 0.0, 16.0])
    return np.clip(out, 0, 255)


def render(solids, ground_shadow=12.0, outline=True, pad=2, shadow_alpha=95,
           ao=True):
    # ---- frame from AABB corners (+ projected shadows)
    xs, ys = [], []
    for s in solids:
        x0, y0, z0, x1, y1, z1 = s.aabb
        for x in (x0, x1):
            for y in (y0, y1):
                for z in (z0, z1):
                    xs.append(x - y)
                    ys.append((x + y) / 2 - z)
                    if ground_shadow > 0:
                        g = np.array([x, y, z]) - LIGHT * (z / LIGHT[2])
                        xs.append(g[0] - g[1])
                        ys.append((g[0] + g[1]) / 2)
    sx0 = math.floor(min(xs)) - pad
    sx1 = math.ceil(max(xs)) + pad
    sy0 = math.floor(min(ys)) - pad
    sy1 = math.ceil(max(ys)) + pad
    W, H = sx1 - sx0, sy1 - sy0
    SX = sx0 + np.arange(W) + 0.5
    SY = sy0 + np.arange(H) + 0.5
    SXg, SYg = np.meshgrid(SX, SY)
    P0 = np.stack([SYg + SXg / 2, SYg - SXg / 2, np.zeros_like(SXg)], -1)

    best_t = np.full((H, W), -1e9)
    best_s = np.full((H, W), -1, int)
    best_k = np.full((H, W), -1, int)
    for si, s in enumerate(solids):
        hit, t, k, _ = _ray(s, P0, VIEW)
        m = hit & (t > best_t)
        best_t = np.where(m, t, best_t)
        best_s = np.where(m, si, best_s)
        best_k = np.where(m, k, best_k)

    img = np.zeros((H, W, 4), float)
    hitmask = best_s >= 0
    ii, jj = np.nonzero(hitmask)
    pts = P0[ii, jj] + best_t[ii, jj, None] * VIEW
    normals = np.array([solids[best_s[i, j]].planes[best_k[i, j]][0] for i, j in zip(ii, jj)]) if len(ii) else np.zeros((0, 3))
    shadowed = _occluded(solids, pts + normals * 0.3) if len(ii) else np.zeros(0, bool)
    if len(ii):
        # faces turned away from the sun are already dark via shade(); don't speckle them
        shadowed &= (normals @ LIGHT) > 0.05
    # direct facing light also matters: faces away from light are "in shadow" already by shade()
    face_code = np.full((H, W), -1, int)
    for q, (i, j) in enumerate(zip(ii, jj)):
        s = solids[best_s[i, j]]
        n = normals[q]
        p = pts[q]
        res = s.mat(p, n)
        emis = False
        if isinstance(res, tuple):
            res, emis = res
        col = shade(np.array(res, float), n, bool(shadowed[q]) and not emis, emis)
        img[i, j, :3] = col
        img[i, j, 3] = 255
        f = face_uv(p, n)[0]
        face_code[i, j] = best_s[i, j] * 16 + {"top": 0, "R": 1, "L": 2}.get(f, 3 + best_k[i, j] % 10)

    # ---- ground shadow
    if ground_shadow > 0:
        gi, gj = np.nonzero(~hitmask)
        if len(gi):
            G = P0[gi, gj].copy()
            # distance limit from union footprint
            near = np.zeros(len(gi), bool)
            for s in solids:
                x0, y0, z0, x1, y1, z1 = s.aabb
                if z0 > 0.5 and not s.cast:
                    continue
                dx = np.maximum(0, np.maximum(x0 - G[:, 0], G[:, 0] - x1))
                dy = np.maximum(0, np.maximum(y0 - G[:, 1], G[:, 1] - y1))
                near |= np.hypot(dx, dy) <= ground_shadow
            occ = np.zeros(len(gi), bool)
            occ[near] = _occluded(solids, G[near] + np.array([0, 0, 0.05]))
            # soft contact shadow (AO) right at the base
            for q in np.nonzero(occ)[0]:
                img[gi[q], gj[q]] = [16, 20, 40, shadow_alpha]
            if ao:
                for s in solids:
                    x0, y0, z0, x1, y1, z1 = s.aabb
                    if z0 > 0.5 or (z1 - z0) < 3:
                        continue
                    dx = np.maximum(0, np.maximum(x0 - G[:, 0], G[:, 0] - x1))
                    dy = np.maximum(0, np.maximum(y0 - G[:, 1], G[:, 1] - y1))
                    d = np.hypot(dx, dy)
                    m = (d <= 1.6) & (img[gi, gj, 3] == 0)
                    for q in np.nonzero(m)[0]:
                        img[gi[q], gj[q]] = [16, 20, 40, shadow_alpha * 0.7]

    # ---- outline / edge accents
    if outline:
        src = img.copy()
        op = src[:, :, 3] == 255
        for i in range(H):
            for j in range(W):
                if not op[i, j]:
                    continue
                c = src[i, j, :3]
                fc = face_code[i, j]
                edge_out = False
                depth_edge = False
                for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    a, b = i + di, j + dj
                    if a < 0 or b < 0 or a >= H or b >= W or not op[a, b]:
                        edge_out = True
                        break
                    if best_s[a, b] != best_s[i, j] and best_t[i, j] > best_t[a, b] + 2.5:
                        depth_edge = True
                if edge_out:
                    img[i, j, :3] = c * 0.42 + np.array([4, 4, 14])
                    continue
                if depth_edge:
                    img[i, j, :3] = c * 0.72 + np.array([2, 2, 8])
                    continue
                # convex corner highlight: top pixel sitting above a side face of same solid
                if fc % 16 == 0 and i + 1 < H and op[i + 1, j] and face_code[i + 1, j] // 16 == fc // 16 and face_code[i + 1, j] % 16 in (1, 2):
                    img[i, j, :3] = np.minimum(255, c * 1.12 + 10)
                elif fc % 16 == 2 and j + 1 < W and op[i, j + 1] and face_code[i, j + 1] // 16 == fc // 16 and face_code[i, j + 1] % 16 == 1:
                    img[i, j, :3] = np.minimum(255, c * 1.1 + 6)
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGBA")
    anchor = (-sx0, -sy0)  # pixel where world (0,0,0) lands
    return out, anchor
