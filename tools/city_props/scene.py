"""Compose a demo city block from the generated sprites (out/*.png)."""
import json, math
import numpy as np
from PIL import Image
from isopix import box, render, rgb, mix, hash2, face_uv

G = 22
N = 12                       # 12x12 tile diorama
ROAD_X = (5, 6)              # road tiles along y (gx in 5..6)
ROAD_Y = (5, 6)              # road tiles along x (gy in 5..6)
man = json.load(open("out/manifest.json"))


def tile_kind(gx, gy):
    rx = ROAD_X[0] <= gx <= ROAD_X[1]
    ry = ROAD_Y[0] <= gy <= ROAD_Y[1]
    if rx or ry:
        return "road"
    if gx >= 7 and gy >= 7 and 8 <= gx <= 11 and 8 <= gy <= 11 and False:
        return "grass"
    if gx <= 4 and gy >= 7:
        return "park"
    return "lot"


def ground_mat(p, n):
    f, u, v = face_uv(p, n)
    x, y = p[0], p[1]
    if f != "top":
        # diorama slab sides: asphalt/earth layers
        z = p[2]
        if z > -2:
            return rgb("#8b9098")
        return rgb("#4a4f58") if int(z) % 3 else rgb("#41464e")
    gx, gy = x / G, y / G
    ix, iy = int(math.floor(gx)), int(math.floor(gy))
    k = tile_kind(ix, iy)
    fx, fy = gx - ix, gy - iy
    if k == "road":
        c = rgb("#3a3f48") if hash2(int(x), int(y), 9) > 0.08 else rgb("#444a54")
        inter = ROAD_X[0] <= ix <= ROAD_X[1] and ROAD_Y[0] <= iy <= ROAD_Y[1]
        cx = (ROAD_X[1] + 1) * G  # centre line between the two lanes
        cy = (ROAD_Y[1] + 1) * G
        if not inter:
            # centre dashes
            if ROAD_X[0] <= ix <= ROAD_X[1] and abs(x - cx) < 0.7 and int(y // 6) % 2 == 0:
                return rgb("#f0d060")
            if ROAD_Y[0] <= iy <= ROAD_Y[1] and abs(y - cy) < 0.7 and int(x // 6) % 2 == 0:
                return rgb("#f0d060")
            # crosswalks next to the intersection
            if ROAD_X[0] <= ix <= ROAD_X[1] and iy in (ROAD_Y[0] - 1, ROAD_Y[1] + 1):
                d = (y - ROAD_Y[0] * G) if iy < ROAD_Y[0] else (y - (ROAD_Y[1] + 1) * G)
                if abs(d) < 8 and int(x // 2.5) % 2 == 0:
                    return rgb("#e8ebee")
            if ROAD_Y[0] <= iy <= ROAD_Y[1] and ix in (ROAD_X[0] - 1, ROAD_X[1] + 1):
                d = (x - ROAD_X[0] * G) if ix < ROAD_X[0] else (x - (ROAD_X[1] + 1) * G)
                if abs(d) < 8 and int(y // 2.5) % 2 == 0:
                    return rgb("#e8ebee")
        return c
    # sidewalk ring (outer 3 units of a lot block touching roads)
    near_road = False
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if 0 <= ix + dx < N and 0 <= iy + dy < N and tile_kind(ix + dx, iy + dy) == "road":
            if (dx == 1 and fx > 0.82) or (dx == -1 and fx < 0.18) or (dy == 1 and fy > 0.82) or (dy == -1 and fy < 0.18):
                near_road = True
    if near_road:
        edge = min(fx if ix + 1 == ROAD_X[0] or ix - 1 == ROAD_X[1] else 1, 1)
        c = rgb("#c9ccd0")
        if int(x) % 6 == 0 or int(y) % 6 == 0:
            c = rgb("#b4b8be")
        # curb
        if (ix + 1 == ROAD_X[0] and fx > 0.95) or (ix - 1 == ROAD_X[1] and fx < 0.05) or \
           (iy + 1 == ROAD_Y[0] and fy > 0.95) or (iy - 1 == ROAD_Y[1] and fy < 0.05):
            c = rgb("#e6e8ea")
        return c
    if k == "park":
        h = hash2(int(x / 1.5), int(y / 1.5), 4)
        if 0.3 < fx < 0.7 and iy == 9 or (0.35 < fy < 0.65 and ix == 2):
            return rgb("#d8c9a0") if h > 0.1 else rgb("#c8b98e")  # gravel path
        return rgb("#6fb35a") if h > 0.18 else (rgb("#5ea24c") if h > 0.06 else rgb("#8ccc6c"))
    # lot: paved plaza
    c = rgb("#b8bcc2")
    if int(x) % 11 == 0 or int(y) % 11 == 0:
        c = rgb("#a7acb3")
    return c


def build_ground():
    S = [box(0, 0, -7, N * G, N * G, 0, ground_mat)]
    im, anc = render(S, ground_shadow=0, outline=True)
    return im, anc


# sprite placements: (name, world x, world y) in tile units (centre of footprint)
P = [
    # NW block
    ("tower_glass", 2.0, 1.8), ("shop_bakery", 1.4, 4.0), ("shop_books", 3.6, 4.0),
    # NE block
    ("tower_brick", 8.2, 1.6), ("tower_deco", 10.4, 2.0), ("shop_pharmacy", 8.0, 4.0), ("shop_flowers", 10.4, 4.0),
    # SE block: low-rise so it doesn't hide the street
    ("shop_cafe", 8.0, 7.6), ("shop_deli", 10.4, 7.6), ("cafe_table", 7.9, 8.9), ("cafe_table", 9.3, 9.1),
    ("tree_big", 10.6, 9.6), ("tree_small", 8.3, 10.7), ("bench", 9.8, 10.9), ("tree_small", 11.2, 11.0),
    # SW park
    ("tree_big", 0.9, 8.0), ("tree_big", 3.6, 10.8), ("tree_small", 0.8, 10.6), ("tree_small", 3.8, 8.0),
    ("bench", 1.4, 9.15), ("bench", 3.4, 9.15), ("newsstand", 2.0, 11.2), ("hydrant", 4.6, 7.3),
    ("bus_stop", 2.4, 7.25),
    # street furniture
    ("traffic_light", 4.82, 4.82), ("traffic_light", 7.18, 7.18), ("lamp", 4.8, 2.0), ("lamp", 7.2, 2.6),
    ("lamp", 7.2, 9.8), ("lamp", 4.8, 9.6), ("tree_small", 11.4, 4.85), ("tree_small", 0.6, 4.85),
    # cars
    ("car_sedan_red_x", 2.2, 5.5), ("car_taxi_x", 9.3, 5.5), ("car_sedan_white_x", 11.0, 6.5),
    ("car_van_y", 5.5, 9.4), ("car_sedan_blue_y", 6.5, 3.0), ("car_hatch_green_y", 5.5, 0.9), ("car_taxi_y", 6.5, 10.9),
]


def compose(scale=3):
    gim, ganc = build_ground()
    W, H = gim.width, gim.height + 170
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    oy = 170
    canvas.alpha_composite(gim, (0, oy))
    ox0, oy0 = ganc[0], ganc[1] + oy   # pixel of world origin
    items = sorted(P, key=lambda t: t[1] + t[2])
    for name, tx, ty in items:
        m = man[name]
        sp = Image.open(f"out/{name}.png")
        wx, wy = tx * G, ty * G
        sx = ox0 + (wx - wy) - m["ax"]
        sy = oy0 + (wx + wy) / 2 - m["ay"]
        canvas.alpha_composite(sp, (int(round(sx)), int(round(sy))))
    bb = canvas.getbbox()
    canvas = canvas.crop((bb[0] - 6, bb[1] - 6, bb[2] + 6, bb[3] + 6))
    # dusk-ish sky backdrop like the board's city theme
    bg = Image.new("RGBA", canvas.size)
    top, bot = rgb("#4a5a88"), rgb("#e8a878")
    arr = np.zeros((canvas.height, canvas.width, 4), np.uint8)
    for i in range(canvas.height):
        t = i / canvas.height
        c = mix(top, mix(rgb("#8a7aaa"), bot, max(0, t * 2 - 1)), min(1, t * 2)) if t < 0.5 else mix(rgb("#8a7aaa"), bot, t * 2 - 1)
        arr[i, :, :3] = c
        arr[i, :, 3] = 255
    bg = Image.fromarray(arr, "RGBA")
    bg.alpha_composite(canvas)
    big = bg.resize((bg.width * scale, bg.height * scale), Image.NEAREST)
    big.save("scene.png")
    bg.save("scene_1x.png")
    print(big.size)


if __name__ == "__main__":
    compose()
