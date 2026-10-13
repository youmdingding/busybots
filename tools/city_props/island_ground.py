"""
Island-theme ground: a hand-shaped floating island rendered as a pixel heightfield
(1 sprite unit = 1 cell) — lush grass, layered cliffs on the back/right, a sandy
beach on the front-left, a pond + stream that falls off the right cliff, dirt
paths along the agents' walking routes, shallow/deep sea with foam, and a small
rock islet for the lighthouse. Zones are NOT part of this: the board still draws
the zone tiles/walls on top.

Run: python3 island_ground.py  -> out/island_ground.png + manifest entry
"""
import json, math
import numpy as np
from PIL import Image

U = 23.45                                   # sprite units per grid cell (same as the city)
GX0, GY0, GX1, GY1 = -7.0, -6.0, 33.0, 27.0         # sea runs past the canvas edges
WATER_Z = -20.0                             # sea level (units below the island top)
SLAB = 11.0                                 # thickness of the sea slab edge
CX, CY, RX, RY = 11.0, 6.55, 11.9, 8.1      # island superellipse (grid)
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ noise
def value_noise(nx, ny, cell, seed):
    r = np.random.default_rng(seed)
    gx, gy = nx // cell + 2, ny // cell + 2
    g = r.random((gy, gx))
    ys = np.arange(ny) / cell
    xs = np.arange(nx) / cell
    x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int)
    tx = xs - x0; ty = ys - y0
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]; d = g[np.ix_(y0 + 1, x0 + 1)]
    top = a * (1 - tx) + b * tx
    bot = c * (1 - tx) + d * tx
    return top * (1 - ty[:, None]) + bot * ty[:, None]


def fbm(nx, ny, base, seed, oct=4):
    out = np.zeros((ny, nx)); amp = 1.0; tot = 0
    for k in range(oct):
        out += amp * value_noise(nx, ny, max(2, int(base / (2 ** k))), seed + k)
        tot += amp; amp *= 0.5
    return out / tot


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def poly_dist(px, py, pts):
    d = np.full(px.shape, 1e9)
    for (a, b) in zip(pts, pts[1:]):
        d = np.minimum(d, seg_dist(px, py, a[0], a[1], b[0], b[1]))
    return d


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


# ------------------------------------------------------------------ build the field
NX = int(round((GX1 - GX0) * U))
NY = int(round((GY1 - GY0) * U))
I, J = np.meshgrid(np.arange(NX), np.arange(NY))          # J rows (y), I cols (x)
GXg = GX0 + (I + 0.5) / U
GYg = GY0 + (J + 0.5) / U

n_shape = fbm(NX, NY, 70, 1) - 0.5
dx, dy = (GXg - CX) / RX, (GYg - CY) / RY
r = (np.abs(dx) ** 5 + np.abs(dy) ** 5) ** 0.2
sdf = (r - 1.0) * min(RX, RY) + n_shape * 0.9               # grid units, <0 inside
vlen = np.hypot(dx, dy) + 1e-9
vx, vy = dx / vlen, dy / vlen
beach_w = np.clip((vy - 0.62) / 0.18, 0, 1) * np.clip((0.72 - vx) / 0.25, 0, 1)

# heights: cliff islands drop at sdf=0 ; beaches slope out to sdf=+1.1
h_cliff = np.where(sdf < 0, 0.0, WATER_Z - 4)
t = np.clip((sdf + 0.35) / 1.45, 0, 1)
h_beach = np.where(sdf < -0.35, 0.0, np.where(t < 1, -t ** 1.3 * (-WATER_Z + 1.5), WATER_Z - 4))
H = beach_w * h_beach + (1 - beach_w) * h_cliff
land = H > WATER_Z + 0.01

# rock islet for the lighthouse
ISLET = (21.6, 15.6, 1.1)
d_isl = np.hypot(GXg - ISLET[0], (GYg - ISLET[1]) * 1.15) + (fbm(NX, NY, 30, 9) - 0.5) * 0.35
islet = d_isl < ISLET[2]
H = np.where(islet, np.maximum(H, -8.0 - np.clip((d_isl - 0.6) * 18, 0, 10)), H)
land = H > WATER_Z + 0.01

# paths (agents' routes + trail to the beach/dock)
PATHS = [
    [(0.6, 5.65), (12.6, 5.65)],                 # gap between the zone rows
    [(12.4, 5.65), (12.4, 6.3), (12.9, 6.3)],    # to the Idle door
    [(6.5, 5.65), (6.5, 11.6)],                  # corridor between the zone columns
    [(6.5, 11.6), (6.3, 12.6), (5.6, 13.4), (5.2, 14.4)],   # down to the dock
    [(6.5, 11.9), (9.0, 12.4), (12.6, 12.5), (15.4, 12.9)], # along the meadow to the pond
]
pd = np.full(H.shape, 1e9)
for pts in PATHS:
    pd = np.minimum(pd, poly_dist(GXg, GYg, pts))
path_w = 0.30 + (fbm(NX, NY, 20, 3) - 0.5) * 0.12
on_path = (pd < path_w) & land & (H > -1)

# pond + stream → waterfall off the right cliff
POND = (16.8, 13.15, 0.85, 0.6)
pond = (((GXg - POND[0]) / POND[2]) ** 2 + ((GYg - POND[1]) / POND[3]) ** 2) < 1.0
STREAM = [(17.5, 12.9), (18.8, 12.45), (20.2, 12.15), (21.6, 11.95), (23.4, 11.8)]
sd = poly_dist(GXg, GYg, STREAM)
stream = (sd < 0.17) & land & (H > -1)
water_in = pond | stream
H = np.where(pond & land, -2.2, H)
H = np.where(stream & ~pond, -1.4, H)
on_path &= ~water_in

# ------------------------------------------------------------------ colours
grass_n = fbm(NX, NY, 24, 11)
grass_n2 = fbm(NX, NY, 6, 12)
sand_n = fbm(NX, NY, 5, 13)
TOP = np.zeros(H.shape + (3,))
g_lo, g_mid, g_hi = hexc("#4f9e4a"), hexc("#64b356"), hexc("#86c96a")
gm = np.clip((grass_n - 0.35) * 2.2, 0, 1)[..., None]
grass = g_lo * (1 - gm) + g_mid * gm
grass = np.where((grass_n2 > 0.72)[..., None], g_hi, grass)
grass = np.where((grass_n2 < 0.22)[..., None], hexc("#468f43"), grass)
# flower specks
fl = rng.random(H.shape)
fcol = np.stack([hexc(c) for c in ("#ffffff", "#ffd166", "#ff8fab", "#b28dff")])
fidx = rng.integers(0, 4, H.shape)
flowers = (fl < 0.006) & (grass_n > 0.45)
grass = np.where(flowers[..., None], fcol[fidx], grass)
sand = np.where((sand_n > 0.6)[..., None], hexc("#f1dca6"), hexc("#e8cf92"))
sand = np.where((sand_n < 0.3)[..., None], hexc("#dcc285"), sand)
wet = (H < WATER_Z + 3.5)
sand = np.where(wet[..., None], hexc("#c9ac72"), sand)
is_sand = land & (beach_w > 0.35) & (sdf > -0.55) & ~islet
TOP = np.where(is_sand[..., None], sand, grass)
# soft transition grass->sand
edge_mix = np.clip((sdf + 0.55) / 0.25, 0, 1) * (beach_w > 0.35)
TOP = np.where((land & ~islet)[..., None], TOP * 1, TOP)
# path
pn = fbm(NX, NY, 4, 14)
pathc = np.where((pn > 0.62)[..., None], hexc("#d6b98a"), hexc("#c8a674"))
pathc = np.where((pn < 0.25)[..., None], hexc("#b8956a"), pathc)
pedge = on_path & (pd > path_w - 0.07)
TOP = np.where(on_path[..., None], pathc, TOP)
TOP = np.where(pedge[..., None], hexc("#9c7c52"), TOP)
# islet rock
rock_n = fbm(NX, NY, 6, 15)
rockc = np.where((rock_n > 0.55)[..., None], hexc("#9a9a94"), hexc("#85847e"))
TOP = np.where((islet & ~is_sand)[..., None], np.where((rock_n > 0.7)[..., None], hexc("#6f9a55"), rockc), TOP)

# sea: shallow near land, deep further out, foam ring, sparkles
dist_land = np.clip(sdf, 0, 9)
dist_land = np.minimum(dist_land, np.clip(d_isl - ISLET[2], 0, 9))
sea_t = np.clip(dist_land / 2.4, 0, 1)[..., None]
sea = hexc("#62cdd6") * (1 - sea_t) + hexc("#2f86bf") * sea_t
wave_n = fbm(NX, NY, 9, 16)
sea = np.where(((wave_n > 0.68) & (dist_land > 0.6))[..., None], sea * 1.12, sea)
foam = (dist_land > 0.02) & (dist_land < 0.16 + (wave_n - 0.5) * 0.12)
sea = np.where(foam[..., None], hexc("#e9f8fa"), sea)
spark = (rng.random(H.shape) < 0.0025) & (dist_land > 0.8)
sea = np.where(spark[..., None], hexc("#d9f4fb"), sea)
TOP = np.where(land[..., None], TOP, sea)
# inland water
iw = np.where(pond[..., None], hexc("#4fb9d3"), hexc("#5cc6dc"))
iw = np.where((wave_n > 0.66)[..., None], hexc("#8fe0ec"), iw)
TOP = np.where((water_in & land)[..., None], iw, TOP)
H = np.where(land, H, WATER_Z)

# slope shading on tops (beach slope, islet)
gyH, gxH = np.gradient(H)
shade = 1.0 + np.clip(-gxH * 0.25 - gyH * 0.12, -0.25, 0.18)
TOP = np.clip(TOP * shade[..., None], 0, 255)


# ------------------------------------------------------------------ side colours
def side_color(z, face, kind, col_i, row_j):
    """z: height of the side pixel (units, island top = 0). face 'L' (+y) / 'R' (+x)."""
    k = 0.82 if face == "L" else 0.64
    if kind == "sea":
        return hexc("#1f5f8e") * (1.0 if face == "L" else 0.82)
    if kind == "waterfall":
        return hexc("#e9f8fa") if (row_j + col_i) % 3 else hexc("#9fe3ee")
    if kind == "sand":
        return hexc("#d9bd82") * k
    depth = -z
    if depth < 1.6:
        c = hexc("#5ca84f")          # grass lip
    elif depth < 5.5:
        c = hexc("#8a5d3b")          # soil
    else:
        band = int((depth - 5.5) // 3.2)
        c = [hexc("#8c7a66"), hexc("#7b6a58"), hexc("#958470"), hexc("#6f604f")][band % 4]
        if (col_i * 7 + band * 13) % 23 == 0:
            c = c * 0.85
    if depth > -WATER_Z - 2.5:
        c = c * 0.78                 # wet band at the waterline
    return c * k


# ------------------------------------------------------------------ rasterise (painter, back→front)
PAD = 6
offx = NY + PAD                     # sx = i - j + offx
offy = 2 * PAD + 30                 # room above for nothing (tops at z<=0)
Wpx = NX + NY + 2 * PAD
Hpx = int((NX + NY) / 2 + (-WATER_Z) + SLAB + 4 * PAD + 30)
img = np.zeros((Hpx, Wpx, 4), np.uint8)


def put(xs, ys, cols, a=255):
    m = (xs >= 0) & (xs < Wpx) & (ys >= 0) & (ys < Hpx)
    img[ys[m], xs[m], :3] = np.clip(cols[m], 0, 255).astype(np.uint8)
    img[ys[m], xs[m], 3] = a


Hpad = np.pad(H, ((0, 1), (0, 1)), constant_values=WATER_Z - SLAB)
kind_land = np.where(is_sand, 1, 0)
for d in range(NX + NY - 1):
    i0 = max(0, d - (NY - 1)); i1 = min(NX - 1, d)
    ii = np.arange(i0, i1 + 1); jj = d - ii
    h = H[jj, ii]
    sx = ii - jj + offx
    top_row = np.floor((ii + jj) / 2.0 - h + offy).astype(int)
    cols = TOP[jj, ii]
    # side runs toward the +x (right) and +y (left) neighbours
    h_r = Hpad[jj, ii + 1]
    h_l = Hpad[jj + 1, ii]
    run_l = np.clip(np.ceil(h - h_l + 0.0), 0, 60).astype(int)
    run_r = np.clip(np.ceil(h - h_r + 0.0), 0, 60).astype(int)
    # sea slab edge: the outer water cells drop SLAB
    edge_l = (jj + 1 >= NY)
    edge_r = (ii + 1 >= NX)
    run_l = np.where(edge_l, int(SLAB), run_l)
    run_r = np.where(edge_r, int(SLAB), run_r)
    maxrun = int(max(run_l.max(initial=0), run_r.max(initial=0)))
    for k in range(1, maxrun + 1):
        zk = h - k
        for face, run, xoff in (("L", run_l, -1), ("R", run_r, 0)):
            m = run >= k
            if not m.any():
                continue
            xs = sx[m] + xoff; ys = top_row[m] + k
            iis, jjs, zz = ii[m], jj[m], zk[m]
            out = np.zeros((m.sum(), 3))
            for q in range(len(xs)):
                ci, cj = iis[q], jjs[q]
                if not land[cj, ci]:
                    kind = "sea"
                elif stream[cj, ci] or (water_in[cj, ci]):
                    kind = "waterfall"
                elif is_sand[cj, ci]:
                    kind = "sand"
                else:
                    kind = "rock"
                out[q] = side_color(zz[q], face, kind, ci, cj)
            put(xs, ys, out)
    put(sx - 1, top_row, cols)
    put(sx, top_row, cols)

# waterfall plume + spray at the cliff foot where the stream leaves the island
out = Image.fromarray(img, "RGBA")
ax, ay = offx, offy                 # world (GX0, GY0, z=0) → sprite pixel
out.save("out/island_ground.png")
man = json.load(open("out/manifest.json"))
man["island_ground"] = dict(w=out.width, h=out.height, ax=ax, ay=ay, unitsPerGrid=U, gx0=GX0, gy0=GY0)
json.dump(man, open("out/manifest.json", "w"), indent=1)
np.save("out/island_height.npy", H)
print("island_ground", out.size, (ax, ay), "land cells", int(land.sum()))
