"""
Explore rooms (new) + resized Idle rooms for all four themes, after Idle was split:
  explore: gx 12.8, gy 0.9, 8.2 x 4.4 cells, floor 22 px, door S (back row, tall walls)
  idle:    gx 12.8, gy 6.0, 8.2 x 5.4 cells, floor  6 px, door W (front row, LOW walls so
           Explore behind it stays visible)

Run: python3 explore_rooms.py [sprite ...] -> out/<sprite>.png + manifest entries
"""
import json, math, sys
from isopix import box, vcyl, hcyl, blob, face_uv, rgb, mix, hash2, render, plane_through, Solid
from props import flat, cone, planter_mat, solid_hull
import interiors as CI
from interiors import (U, WALL_T, text7, room_shell, doormat, entrance_steps, door_frame_x, door_frame_y,
                       DOOR_HALF, bookshelf, desk, monitor, keyboard, potted_plant, filing_cabinet)

EW, ED, EELEV = 8.2 * U, 4.4 * U, 22
IW, ID, IELEV = 8.2 * U, 5.4 * U, 6
I_DOOR_Y = 2.7 * U                       # W door: middle of the W edge (board gy 8.7)
I_WALL = 12.0                            # low walls for the new Idle rooms


def glow(c):
    c = rgb(c) if isinstance(c, str) else c
    return lambda p, n: (c, True)


def name_board_x(x0, x1, y, z0, z1, name, bg, ink, edge, icon=None):
    """Backlit name board on a N wall (face L) with an optional compass icon."""
    tw = len(name) * 6 - 1
    tx = x0 + (x1 - x0 - tw) / 2 + (4.0 if icon else 0.0)
    zt = z0 + (z1 - z0) / 2 + 3.5

    def m(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(bg) * 0.85
        uu, vv = p[0] - x0, p[2] - z0
        if uu < 0.8 or uu > (x1 - x0) - 0.8 or vv < 0.8 or vv > (z1 - z0) - 0.8:
            return (rgb(edge), True)
        if icon == "compass":
            dx, dz = uu - 5.0, vv - (z1 - z0) / 2
            r = math.hypot(dx, dz)
            if 2.4 < r < 3.2:
                return (rgb(ink), True)
            if abs(dx) * 2.2 + abs(dz) < 2.4:
                return (rgb("#e8553f"), True) if dz > 0 else (rgb(ink), True)
        if text7(name, p[0], p[2], tx, zt, slope=1):
            return (rgb(ink), True)
        return rgb(bg)
    return [box(x0, y, z0, x1, y + 0.9, z1, m)]


def globe_stand(cx, cy, r=3.2, h=8.0):
    def g(p, n):
        lat = (p[2] - (h + r)) / r
        lon = math.atan2(p[1] - cy, p[0] - cx)
        land = math.sin(lon * 3 + lat * 2.2) + math.cos(lat * 4 - lon) > 0.9
        return rgb("#6cbf6a") if land else rgb("#3a86c8")
    return [box(cx - 3.0, cy - 0.5, 0, cx + 3.0, cy + 0.5, 0.8, flat("#5e3b20")),
            box(cx - 0.5, cy - 3.0, 0, cx + 0.5, cy + 3.0, 0.8, flat("#5e3b20")),
            vcyl(cx, cy, 0.6, 0.8, h, flat("#7a5236"), sides=8),
            vcyl(cx, cy, r + 0.6, h - 0.2, h + 0.4, flat("#d8aa45"), sides=14),
            blob(cx, cy, h + r, r, g, n=26)]


# =================================================================== CITY
def city_explore(W, D, slab):
    """Public library & map room: tall shelves, rolling ladder, card catalogue, city map, reading tables."""
    rug = (1.2 * U, 1.15 * U, W - 1.2 * U, 3.0 * U + 4)

    def floor(p):
        x, y = p[0], p[1]
        if rug[0] <= x <= rug[2] and rug[1] <= y <= rug[3]:
            e = min(x - rug[0], rug[2] - x, y - rug[1], rug[3] - y)
            if e < 1.2:
                return rgb("#5e2a22")
            if e < 2.4:
                return rgb("#d9b46a")
            c = rgb("#8a3b2e") if int((x - rug[0]) // 6) % 2 == int((y - rug[1]) // 6) % 2 else rgb("#7f3529")
            return c
        board = int(y // 3.4)
        c = rgb("#9c6a42") if board % 2 else rgb("#94633d")
        if y % 3.4 < 0.3 or (x + board * 11.0) % 28.0 < 0.3:
            c = rgb("#7a5032")
        return c

    def wall(which, u, z):
        if z < 1.2:
            return rgb("#3b2a20")
        if z < 9.0:
            return rgb("#6b4a33") if int(u // 7) % 2 else rgb("#634430")
        if z < 9.8:
            return rgb("#d9b46a")
        if z > CI.WALL_H - 1.2:
            return rgb("#5e3b20")
        return rgb("#ecdcc0") if int(z) % 7 else rgb("#e2d0b0")

    S = room_shell(W, D, slab, floor, wall, trim="#5e3b20", side="#6b4a33", side_dark="#563b28",
                   name="EXPLORE", plate="#3b2a20", ink="#f6ecd6", plate_edge="#d9b46a", plate_at=0.35)
    T = WALL_T
    dx = W / 2
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#5e2a22", edge="#d9b46a")
    S += door_frame_x(dx, D - 0.6, 22.0, "#5e3b20", canopy="#2f6a4a", out=1)
    S += entrance_steps("S", (dx, D), slab)

    # N wall: long run of tall bookshelves with a rolling ladder, name board, arched window
    S += bookshelf(T + 0.2, T + 0.2, 82.0, T + 6.0, 26.0, seed=31, wood="#6b4a33", along="x")
    for xx in (40.0, 43.6):                                       # ladder rails leaning on the shelves
        S.append(box(xx - 0.4, T + 6.0, 0, xx + 0.4, T + 7.0, 25.0, flat("#3b2a20")))
    for z in range(3, 25, 3):
        S.append(box(40.0, T + 6.2, z, 43.6, T + 6.8, z + 0.5, flat("#3b2a20")))
    S += name_board_x(84.0, 136.0, T, 15.0, 25.5, "EXPLORE", "#2f6a4a", "#f6ecd6", "#d9b46a", icon="compass")

    def win(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb("#ecdcc0")
        x0w, x1w = 140.0, W - 6.0
        uu, vv = p[0] - x0w, p[2] - 10.0
        w = x1w - x0w
        if uu < 0.9 or uu > w - 0.9 or vv < 0.9 or abs(uu - w / 2) < 0.45 or abs(uu - w / 4) < 0.3 or abs(uu - 3 * w / 4) < 0.3:
            return rgb("#3b2a20")
        if vv > 15.0:
            return rgb("#3b2a20")
        t = vv / 15.0
        k = int(p[0] // 2.3)
        if vv < 2 + hash2(k, 9, 41) * 7:
            return (rgb("#ffd98a"), True) if hash2(int(p[0] * 1.3), int(vv * 1.2), 9) < 0.1 else (rgb("#3d4a6b"), True)
        return (mix(rgb("#f0a878"), rgb("#7a7fb8"), t), True)
    S.append(box(140.0, T - 0.1, 10.0, W - 6.0, T + 0.25, 26.0, win))

    # card catalogue + globe under the window
    def cat(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#7a5236")
        if f == "L":
            if (p[0] % 3.0) < 0.3 or (p[2] % 2.2) < 0.3:
                return rgb("#4a3020")
            if abs(p[0] % 3.0 - 1.5) < 0.4 and abs(p[2] % 2.2 - 1.2) < 0.3:
                return rgb("#d8aa45")
        return rgb("#8a5c3c")
    S.append(box(144.0, T + 0.4, 0, 166.0, T + 7.0, 10.0, cat))
    S += globe_stand(W - 14.0, T + 9.0)

    # W wall: framed city map + a reading table with green banker's lamps
    def citymap(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb("#3b2a20")
        uu, zz = 60.0 - p[1], p[2] - 11.0
        if uu < 1.0 or uu > 39.0 or zz < 1.0 or zz > 13.0:
            return rgb("#5e3b20")
        if (uu % 6.0) < 0.6 or (zz % 3.0) < 0.5:
            return rgb("#f4f1ea")                      # streets
        if math.hypot(uu - 26.0, zz - 7.0) < 3.0:
            return rgb("#7fbf7a")                      # park
        if abs(uu - zz * 2.4 - 3) < 0.9:
            return rgb("#7fb6d9")                      # river
        for (pu, pz, c) in ((9.0, 9.0, "#e8553f"), (20.0, 4.0, "#3a86c8"), (33.0, 10.5, "#f2c14e")):
            if abs(uu - pu) < 0.8 and abs(zz - pz) < 0.8:
                return rgb(c)
        return rgb("#e6dccb") if hash2(int(uu // 6), int(zz // 3), 43) > 0.3 else rgb("#d9cdb6")
    S.append(box(T, 20.0, 11.0, T + 0.8, 60.0, 25.0, citymap))
    S += desk(T + 0.4, 64.0, T + 10.0, 92.0, top="#7a5236", leg="#3b2a20", h=7.6)
    for yy in (70.0, 86.0):
        S += [vcyl(T + 3.0, yy, 0.9, 7.6, 8.0, flat("#d8aa45"), sides=8),
              vcyl(T + 3.0, yy, 0.25, 8.0, 10.6, flat("#d8aa45"), sides=6),
              box(T + 1.8, yy - 2.0, 10.4, T + 5.0, yy + 2.0, 11.6, glow("#2f9a6a"))]
    S += [box(T + 5.0, 76.0, 7.6, T + 8.6, 80.5, 8.4, flat("#c0392b")),              # open atlas
          box(T + 5.2, 76.2, 8.4, T + 8.4, 80.3, 8.6, flat("#f4f1ea"))]

    # front-right: computer kiosk + plant; front-left: armchair
    S += [box(W - 22.0, D - 16.0, 0, W - 16.0, D - 12.0, 8.0, flat("#4a5058"))]
    S += monitor(W - 19.0, D - 15.0, 8.0, "L", w=7.0, seed=41, doc=True)
    S += potted_plant(W - 6.5, D - 7.0, r=4.0, h=11, seed=45)
    S += CI.armchair(14.0, D - 14.0, col="#2f6a4a", facing="N")
    return S


def city_idle(W, D, slab):
    """Smaller café with LOW walls (Explore is behind it)."""
    rug = (1.5 * U, 1.0 * U, W - 1.1 * U, D - 1.3 * U)

    def floor(p):
        x, y = p[0], p[1]
        if rug[0] <= x <= rug[2] and rug[1] <= y <= rug[3]:
            e = min(x - rug[0], rug[2] - x, y - rug[1], rug[3] - y)
            if e < 1.4:
                return rgb("#1f4a33")
            if e < 3.2:
                return rgb("#d9b46a") if int((x + y) // 2.0) % 2 else rgb("#2f6a4a")
            return rgb("#3b7a58") if int((x - rug[0]) // 9) % 2 == int((y - rug[1]) // 9) % 2 else rgb("#367253")
        board = int(x // 3.6)
        c = rgb("#a8774f") if board % 2 else rgb("#a2714a")
        if x % 3.6 < 0.3 or (y + board * 13.3) % 31.0 < 0.3:
            c = rgb("#8a5e3c")
        return c

    def wall(which, u, z):
        if z < 1.0:
            return rgb("#2d3238")
        if z > I_WALL - 1.2:
            return rgb("#2f7a4f")
        if which == "N":
            tx, tz = u % 3.0, z % 1.5
            if tx < 0.3 or tz < 0.3:
                return rgb("#e9e4d6")
            return rgb("#3b8a5c")
        return rgb("#b8875a") if int(u // 4) % 2 else rgb("#ad7e52")

    S = room_shell(W, D, slab, floor, wall, trim="#2f7a4f", side="#2f7a4f", side_dark="#24603e",
                   wall_h=I_WALL, wall_h_w=9.6, door_w=(I_DOOR_Y - DOOR_HALF, I_DOOR_Y + DOOR_HALF))
    T = WALL_T
    S += door_frame_y(0.6, I_DOOR_Y, 18.0, "#6b4a33", canopy=("#2f7a4f", "#f6ecd6"))
    S += doormat(T + 0.4, I_DOOR_Y - 6.5, T + 7.0, I_DOOR_Y + 6.5, col="#7a3b2e", edge="#d9b46a")
    S += entrance_steps("W", (I_DOOR_Y, 0), slab, n_steps=1)
    # planters along the top of the low N wall
    for px in (10.0, 60.0, 110.0, 160.0):
        S.append(box(px, 0.0, I_WALL, px + 22.0, T + 0.4, I_WALL + 1.6, flat("#6b4a33")))
        S.append(box(px + 0.4, 0.1, I_WALL + 1.6, px + 21.6, T + 0.3, I_WALL + 3.8, planter_mat(int(px))))
    # coffee counter along the N wall
    cy0 = T + 2.0
    S += CI.coffee_counter_x(24.0, 128.0, cy0)
    S += CI.espresso_machine(30.0, cy0 + 1.0, 9.0)
    S += CI.pastry_case(58.0, cy0 + 0.5, 9.0, w=18.0)
    S += [box(84.0, cy0 + 1.5, 9.0, 90.0, cy0 + 5.5, 12.0, flat("#2d3238")),
          box(84.6, cy0 + 4.6, 12.0, 89.4, cy0 + 5.2, 15.0, glow("#7fd1c7"))]
    S += CI.coffee_cup(98.0, cy0 + 4.0, 9.0, col="#c0392b")
    S += CI.coffee_cup(104.0, cy0 + 3.2, 9.0)
    for sxp in (34.0, 46.0, 58.0, 70.0, 82.0, 94.0, 106.0, 118.0):
        S += CI.bar_stool(sxp, cy0 + 10.5)
    S += [box(W - 14.0, T + 1.0, 0, W - 8.0, T + 6.0, 5.0, CI.sack_mat()),
          box(W - 13.0, T + 6.5, 0, W - 7.0, T + 11.0, 4.0, CI.sack_mat())]
    # W side: banquettes either side of the door, small tables
    S += CI.banquette_y(T + 0.2, 26.0, I_DOOR_Y - DOOR_HALF - 4.0)
    S += CI.banquette_y(T + 0.2, I_DOOR_Y + DOOR_HALF + 4.0, D - 14.0)
    for ty in (36.0, 88.0, 106.0):
        S += CI.cafe_table(T + 12.5, ty, r=3.0)
        S += CI.coffee_cup(T + 12.0, ty - 0.8, 7.3)
        S += CI.cafe_chair(T + 19.0, ty, "W")
    # E side: window tables; front: armchairs, plants, IDLE sign
    for ty in (40.0, 76.0):
        S += CI.cafe_table(W - 10.0, ty, r=3.2)
        S += CI.cafe_chair(W - 10.0, ty - 6.0, "S")
        S += CI.cafe_chair(W - 10.0, ty + 6.0, "N")
    S += CI.armchair(60.0, D - 10.0, col="#2f7a4f", facing="N")
    S += CI.armchair(78.0, D - 10.0, col="#c0392b", facing="N")
    S += potted_plant(T + 6.0, D - 7.0, r=4.2, h=11, seed=33)
    S += potted_plant(W - 7.0, D - 7.0, r=4.2, h=11, seed=35)
    S += CI.cafe_sign_y(W - 2.2, D - 44.0, D - 12.0, "IDLE")
    return S


# =================================================================== ISLAND
def island_explore(W, D, slab):
    """Dive & discovery centre: aquarium wall, wetsuits, tanks, reef chart, shell display."""
    import island_interiors as II
    rug = (1.2 * U, 1.15 * U - 2, W - 1.2 * U, 3.05 * U + 4)

    def rug_fn(x, y):
        e = min(x - rug[0], rug[2] - x, y - rug[1], rug[3] - y)
        if e < 1.3:
            return rgb(II.LAGOON_D)
        if e < 2.4:
            return rgb("#e9dcb8")
        return II.weave(x + y, x - y, "#d8c48f", "#c4ad74", 1.4)

    S = room_shell(W, D, slab, II.resort_floor_planks(rug, rug_fn), II.resort_wall(),
                   trim=II.TEAK, side=II.STONE, side_dark=II.STONE_D,
                   name="EXPLORE", plate=II.TEAK_D, ink="#fbf1d6", plate_edge="#d6a35a", plate_at=0.35)
    T = WALL_T
    S += II.thatch_eave_x(0, W, 0, T + 2.6, 30.0, drop=2.4)
    S += II.thatch_eave_y(0, T + 2.6, D, T + 2.6, 30.0, drop=2.4)
    dx = W / 2
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#c9a86a", edge=II.LAGOON_D)
    S += door_frame_x(dx, D - 0.6, 22.0, "#a87f45", canopy=II.STRAW, out=1)
    S += entrance_steps("S", (dx, D), slab, col="#e2d3b0")

    # N wall: big aquarium (left), EXPLORE board, wetsuit rail + tanks (right)
    def aqua(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb(II.TEAK)
        if f != "L":
            return rgb(II.TEAK_D)
        uu, vv = p[0] - 6.0, p[2] - 6.0
        w, h = 70.0, 18.0
        if uu < 1.2 or uu > w - 1.2 or vv < 1.2 or vv > h - 1.2:
            return rgb(II.TEAK)
        if vv < 3.0:
            return (rgb("#e6cf94") if hash2(int(uu), int(vv * 2), 3) > 0.3 else rgb("#d6bd84"), True)   # sand
        for k in range(7):                          # fish
            fx = 6.0 + k * 9.3 + (k % 2) * 3.0
            fz = 6.0 + (k * 5) % 9
            if abs(uu - fx) < 1.6 - abs(vv - fz) * 0.8 and abs(vv - fz) < 0.9:
                return (rgb(("#ff8c42", "#f7c548", "#ff5a7a", "#7fd1ff")[k % 4]), True)
            if abs(uu - (fx - 2.0)) < 0.5 and abs(vv - fz) < 0.9 - abs(uu - (fx - 2.0)):
                return (rgb(("#ff8c42", "#f7c548", "#ff5a7a", "#7fd1ff")[k % 4]), True)
        for k in range(5):                          # coral + weed
            cx = 4.0 + k * 14.0
            if abs(uu - cx) < 1.4 and vv < 3.0 + 4.0 + math.sin(uu * 2 + k) * 0.8:
                return (rgb(("#ff6f61", "#4fc06a", "#c86bfa")[k % 3]), True)
        if hash2(int(uu * 1.4), int(vv * 1.4), 7) > 0.97:
            return (rgb("#e9fbff"), True)           # bubbles
        return (mix(rgb("#1a7f9a"), rgb("#57d3e0"), vv / h), True)
    S.append(box(6.0, T, 6.0, 76.0, T + 2.4, 24.0, aqua))
    S.append(box(5.0, T, 0, 77.0, T + 3.4, 6.0, flat(II.TEAK_D)))           # stand
    S += II.carved_sign_x(82.0, 126.0, T, 16.8, 26.0, "EXPLORE", icon="compass")
    S.append(box(130.0, T + 3.0, 20.5, 186.0, T + 3.6, 21.2, flat("#8c959e")))   # wetsuit rail
    for i, x in enumerate(range(134, 184, 8)):
        c = ("#2b3138", "#1d5f7a", "#2b3138", "#c0392b", "#2b3138", "#1d5f7a")[i % 6]
        S.append(box(x, T + 2.0, 8.0, x + 5.0, T + 4.6, 20.4, flat(c)))
        S.append(box(x + 1.4, T + 2.4, 20.0, x + 3.6, T + 4.2, 20.6, flat("#1d2025")))
    for i, x in enumerate((136.0, 142.0, 148.0, 154.0)):
        S.append(vcyl(x, T + 10.0, 2.1, 0, 12.0, flat(("#f7c548", "#e8553f")[i % 2]), sides=10))
        S.append(vcyl(x, T + 10.0, 0.9, 12.0, 13.6, flat("#c9ced4"), sides=8))
    S += II.potted_palm(W - 9.0, T + 9.5, h=18.0, spread=5.6, seed=21)

    # W wall: reef chart + shell display shelf + snorkel crate
    def reef(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(II.TEAK_D)
        uu, zz = 52.0 - p[1], p[2] - 11.0
        if uu < 1.0 or uu > 31.0 or zz < 1.0 or zz > 13.0:
            return rgb(II.TEAK)
        d = math.hypot((uu - 16.0) / 12.0, (zz - 7.0) / 4.5)
        if d < 0.55:
            return rgb("#e6cf94")
        if d < 0.75:
            return rgb("#7fdcc9")
        if 0.9 < d < 1.05:
            return rgb("#ff8a6a") if int(uu * 2) % 2 else rgb("#b4e0d6")   # reef ring
        for (pu, pz) in ((8.0, 4.0), (24.0, 10.0), (27.0, 3.0)):
            if abs(uu - pu) < 0.8 and abs(zz - pz) < 0.8:
                return rgb("#e8553f")
        return mix(rgb("#2a9db8"), rgb("#7fd3e8"), zz / 14.0)
    S.append(box(T, 20.0, 11.0, T + 0.8, 52.0, 25.0, reef))

    def shelf(p, n):
        f, u, v = face_uv(p, n)
        if f != "R":
            return rgb(II.TEAK)
        zz = p[2] % 4.0
        if zz < 0.6:
            return rgb(II.TEAK_D)
        k = int(p[1] // 3.0)
        if zz < 2.6 and (p[1] % 3.0) < 2.2:
            return rgb(("#f6e3c8", "#f2b8a0", "#ffffff", "#e9c46a", "#c9a7e8")[k % 5])
        return rgb("#3b2616")
    S.append(box(T + 0.2, 58.0, 0, T + 4.6, 78.0, 12.0, shelf))
    S += II.snorkel_crate(T + 0.4, 84.0, w=6.5, d=11.0, h=4.6, seed=2)
    # front: binocular stand (left), floor globe (right)
    S += [vcyl(16.0, D - 12.0, 0.4, 0, 12.0, flat("#5e3b20"), sides=6),
          hcyl("x", D - 12.0, 13.0, 1.0, 13.5, 18.5, flat("#2b3138"), sides=8),
          vcyl(16.0, D - 12.0, 2.0, 0, 0.6, flat("#5e3b20"), sides=6)]
    S += II.floor_globe(W - 14.0, D - 12.0)
    return S


def island_idle(W, D, slab):
    """Smaller pool bar with LOW walls (Explore is behind it)."""
    import island_interiors as II
    T = WALL_T
    pool = (34.0, D - 38.0, W - 30.0, D - 8.0)
    deck = (1.5 * U - 4, 1.0 * U, W - 1.2 * U, D - 1.85 * U)

    def floor(p):
        x, y = p[0], p[1]
        px0, py0, px1, py1 = pool
        if px0 <= x <= px1 and py0 <= y <= py1:
            e = min(x - px0, px1 - x, y - py0, py1 - y)
            if e < 2.2:
                return rgb("#f4efe2")
            if e < 3.0:
                return rgb("#6fd3d6")
            depth = min(1.0, (y - py0) / (py1 - py0) * 0.8 + 0.2)
            c = mix(rgb("#58d0d6"), rgb("#2aa3b8"), depth)
            w = math.sin(x * 0.55 + math.sin(y * 0.4) * 2.0) + math.sin(y * 0.7 - x * 0.2)
            if w > 1.55:
                return (rgb("#c8f5f2"), True)
            return (c, True) if w > 1.3 else c
        dx0, dy0, dx1, dy1 = deck
        if dx0 <= x <= dx1 and dy0 <= y <= dy1:
            e = min(x - dx0, dx1 - x, y - dy0, dy1 - y)
            if e < 1.0:
                return rgb(II.TEAK_D)
            if 3.0 < e < 4.2:
                return rgb(II.LAGOON_D)
            board = int(x // 3.6)
            if x % 3.6 < 0.35 or (y + board * 13.3) % 31.0 < 0.35:
                return rgb("#8a5a32")
            return rgb("#c99a62") if hash2(board, int(y / 2), 94) > 0.5 else rgb("#c19058")
        t = 7.8
        if x % t < 0.45 or y % t < 0.45:
            return rgb("#d9cdb2")
        h = hash2(int(x // t), int(y // t), 95)
        return rgb("#efe5cc") if h > 0.5 else (rgb("#e8dcc0") if h > 0.2 else rgb("#f4ead3"))

    def wall(which, u, z):
        if z < 1.0:
            return rgb(II.TEAK_D)
        if z > I_WALL - 1.2:
            return rgb(II.TEAK)
        k = u % 2.0
        if k < 0.3:
            return rgb("#8c6a34")
        return rgb("#d4b06a") if int(u // 2.0) % 2 else rgb("#c9a45e")

    S = room_shell(W, D, slab, floor, wall, trim=II.TEAK, side=II.STONE, side_dark=II.STONE_D,
                   wall_h=I_WALL, wall_h_w=9.6, door_w=(I_DOOR_Y - DOOR_HALF, I_DOOR_Y + DOOR_HALF))
    S += door_frame_y(0.6, I_DOOR_Y, 18.0, "#a87f45", canopy=(II.STRAW, II.STRAW_L))
    S += doormat(T + 0.4, I_DOOR_Y - 6.5, T + 7.0, I_DOOR_Y + 6.5, col="#c9a86a", edge=II.LAGOON_D)
    S += entrance_steps("W", (I_DOOR_Y, 0), slab, n_steps=1, col="#e2d3b0")
    # low tiki bar along the N wall (no awning: keeps Explore visible)
    cy0 = T + 2.0
    S += II.tiki_counter_x(24.0, 124.0, cy0)
    S += [box(30.0, cy0 + 1.4, 10.0, 34.0, cy0 + 4.4, 15.0, flat("#e9eef2")),
          box(30.4, cy0 + 1.8, 15.0, 33.6, cy0 + 4.0, 15.6, flat("#2b2b2b"))]
    S += II.coconut_drink(44.0, cy0 + 4.0, 10.0)
    S += II.coconut_drink(50.0, cy0 + 3.2, 10.0, umb=II.SUN)
    S += II.cocktail(60.0, cy0 + 4.0, 10.0, col=II.CORAL)
    S += II.cocktail(66.0, cy0 + 3.0, 10.0, col=II.LAGOON)
    S += [blob(78.0, cy0 + 3.6, 11.0, 2.0, flat("#e0a530"), n=12, squash=0.7),
          blob(77.0, cy0 + 3.0, 12.4, 0.9, flat("#e8553f"), n=8), blob(79.2, cy0 + 4.2, 12.4, 0.9, flat("#7bd389"), n=8)]
    S += II.coconut_drink(96.0, cy0 + 3.6, 10.0, umb=II.LAGOON)
    S += II.service_bell(116.0, cy0 + 3.6, 10.0)
    for i, sxp in enumerate((32.0, 44.0, 56.0, 68.0, 80.0, 92.0, 104.0, 116.0)):
        S += II.bamboo_stool(sxp, cy0 + 11.0, col=(II.LAGOON, II.CORAL, II.SUN)[i % 3])
    for tx in (14.0, 132.0):
        S += II.tiki_torch(tx, T + 3.0)
    S += II.wood_signboard_y(W - 2.2, 18.0, 58.0, "IDLE", h0=3.0, h1=13.0, icon=None)
    # E side loungers + umbrellas; W side hammock (south of the door); pool with toys
    for ly, cols in ((50.0, (II.CORAL, "#fbf1d6")), (80.0, (II.LAGOON, "#fbf1d6"))):
        S += II.sun_lounger_x(W - 19.0, ly, stripe=cols[0])
        S += II.beach_umbrella(W - 8.5, ly - 8.5, cols=cols)
    S += II.hammock_y(T + 7.0, I_DOOR_Y + DOOR_HALF + 8.0, D - 44.0)
    px0, py0, px1, py1 = pool
    S.append(box(px0, py0, 0, px1, py0 + 2.2, 0.8, flat("#f4efe2")))
    S += II.pool_ladder(px0 + 12.0, py0 + 0.4, 0.0)
    S += II.flamingo_ring((px0 + px1) / 2 + 14.0, (py0 + py1) / 2 + 2.0, -0.4)
    S += II.beach_ball(px0 + 30.0, py0 + 12.0, -0.6)
    from island_props import palm
    S += II.translate(palm(seed=3, lean=0.8), 14.0, D - 12.0)
    S += II.translate(palm(seed=5, lean=-0.6), W - 12.0, D - 10.0)
    return S


# =================================================================== OFFICE
def office_explore(W, D, slab):
    """Research library: shelves, reading lounge, data dashboard, research table, gold accents."""
    import office_interiors as OI
    gold = "#c9a227"
    rug = (1.2 * U, 1.15 * U - 2, W - 1.2 * U, 3.05 * U + 4)

    def rug_fn(x, y):
        e = min(x - rug[0], rug[2] - x, y - rug[1], rug[3] - y)
        if e < 1.4:
            return rgb("#8a6d16")
        return rgb("#e8d9a6") if int((x + y) // 4.0) % 2 else rgb("#e0d09a")

    S = room_shell(W, D, slab, OI.carpet_floor(rug, rug_fn), OI.feature_wall(gold),
                   trim="#e9ecef", side="#5b636d", side_dark="#4a525c",
                   name="EXPLORE", plate="#5e4a10", ink="#fff6d8", plate_edge="#e8d9a6", plate_at=0.35)
    T = WALL_T
    dx = W / 2
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col="#5b636d", edge=gold)
    S += OI.glass_door_x(dx, D - 0.6, 22.0, gold)
    S += entrance_steps("S", (dx, D), slab, col="#c9ced4")
    # N wall: EXPLORE letters, data dashboard, long low bookcase
    S += OI.raised_letters_x("EXPLORE", 6.0, T, 18.0, col=WHITE_, px=0.8)
    def dash(p, n):
        f, u, v = face_uv(p, n)
        if f != "L":
            return rgb(OI.INK)
        uu, vv = p[0] - 76.0, p[2] - 11.0
        w, h = 60.0, 15.0
        if uu < 0.8 or uu > w - 0.8 or vv < 0.8 or vv > h - 0.8:
            return rgb("#1d2025")
        if uu < w * 0.45:                                  # bar chart
            k = int((uu - 2.0) // 3.0)
            if (uu - 2.0) % 3.0 < 2.0 and vv < 2.0 + 10.0 * hash2(k, 1, 51):
                return (rgb((OI.SKY, OI.MINT, OI.MUSTARD, OI.CORAL)[k % 4]), True)
        else:                                              # line chart + dots
            yv = h * 0.45 + math.sin(uu * 0.35) * 3.0 + (uu - w * 0.45) * 0.08
            if abs(vv - yv) < 0.45:
                return (rgb(gold), True)
            if hash2(int(uu * 0.8), int(vv * 0.8), 52) > 0.96:
                return (rgb(OI.SKY), True)
        return (rgb("#26313b"), True)
    S += OI.liven([box(76.0, T, 11.0, 136.0, T + 0.9, 26.0, dash)], 0, "dash", "L")
    S += bookshelf(140.0, T + 0.2, W - 3.0, T + 6.0, 24.0, seed=61, wood=OI.OAK, along="x")
    # research table in front of the dashboard with laptops + stools
    S += OI.standing_desk(80.0, T + 6.0, 132.0, T + 13.0, h=10.0)
    S += OI.liven(OI.laptop(90.0, T + 9.4, 10.0), 1, "glint", "L")
    S += OI.liven(OI.laptop(116.0, T + 9.0, 10.0), 1, "glint", "L")
    S += [box(100.0, T + 8.0, 10.0, 108.0, T + 11.5, 10.6, flat("#fbfbf6")),
          box(101.0, T + 8.4, 10.6, 107.0, T + 11.0, 11.0, flat("#e3e3da"))]
    for sx, col in ((90.0, OI.CORAL), (106.0, gold), (122.0, OI.SKY)):
        S += OI.stool(sx, T + 18.0, col=col)
    # W wall: tall bookcase + reading lounge with lamps
    S += bookshelf(T + 0.2, 16.0, T + 6.0, 56.0, 22.0, seed=62, wood=OI.OAK, along="y")
    from office_props import floor_lamp
    S += OI.sofa_y(T + 0.4, 62.0, 86.0, col="#7a8f5a")
    S += OI.translate(floor_lamp(), T + 4.0, 92.0)
    # corners
    S += potted_plant(W - 6.0, D - 6.5, r=3.8, h=10, seed=64)
    S += OI.beanbag(18.0, D - 10.0, col=gold)
    return S


WHITE_ = "#f4f5f2"


def office_idle(W, D, slab):
    """Smaller staff kitchen & break room with LOW walls."""
    import office_interiors as OI
    green = "#4f9a6a"

    def floor(p):
        x, y = p[0], p[1]
        rx0, ry0, rx1, ry1 = 1.5 * U, 1.0 * U, W - 1.1 * U, D - 1.3 * U
        if rx0 <= x <= rx1 and ry0 <= y <= ry1:
            e = min(x - rx0, rx1 - x, y - ry0, ry1 - y)
            if e < 1.4:
                return rgb("#2f6a4a")
            return rgb("#a8d3b5") if int((x - y) // 5.0) % 2 else rgb("#a0cbad")
        board = int(x // 3.6)
        c = rgb("#d8b98e") if board % 2 else rgb("#d1b186")
        if x % 3.6 < 0.3 or (y + board * 13.3) % 31.0 < 0.3:
            c = rgb("#b8976c")
        return c

    def wall(which, u, z):
        if z < 1.0:
            return rgb(OI.INK)
        if z > I_WALL - 1.0:
            return rgb(OI.OAK)
        if which == "N":
            if (u % 2.4) < 0.25 or (z % 1.2) < 0.25:
                return rgb("#d6ddd9")
            return rgb("#9fd3bf") if int(u // 2.4 + z // 1.2) % 5 else rgb("#7bc6a4")
        return rgb(OI.WHITE) if int(u // 6) % 2 else rgb(OI.OFFWHITE)

    S = room_shell(W, D, slab, floor, wall, trim="#e9ecef", side="#5b636d", side_dark="#4a525c",
                   wall_h=I_WALL, wall_h_w=9.6, door_w=(I_DOOR_Y - DOOR_HALF, I_DOOR_Y + DOOR_HALF))
    T = WALL_T
    S += door_frame_y(0.6, I_DOOR_Y, 18.0, "#3a4048", canopy=None)
    S.append(box(-0.1, I_DOOR_Y - DOOR_HALF - 1.2, 19.6, 1.3, I_DOOR_Y + DOOR_HALF + 1.2, 20.4, flat(green)))
    S += doormat(T + 0.4, I_DOOR_Y - 6.5, T + 7.0, I_DOOR_Y + 6.5, col="#5b636d", edge=green)
    S += entrance_steps("W", (I_DOOR_Y, 0), slab, n_steps=1, col="#c9ced4")
    # base kitchen run along the low N wall (no uppers), under-counter fridge
    def base(p, n):
        f, u, v = face_uv(p, n)
        if f == "top":
            return rgb("#e9e6df")
        if p[2] < 1.0:
            return rgb(OI.INK)
        if f == "L" and (p[0] - 20.0) % 7.0 < 0.35:
            return rgb("#c9ccc8")
        return rgb(OI.WHITE)
    S.append(box(20.0, T + 0.2, 0, 132.0, T + 7.2, 9.0, base))
    S += OI.sink(44.0, T + 0.2, 9.0)
    from interiors import espresso_machine, coffee_cup, bar_stool, cafe_table
    S += espresso_machine(60.0, T + 1.0, 9.0)
    S += OI.microwave(86.0, T + 1.0, 9.0)
    S += [vcyl(30.0, T + 3.0, 1.1, 9.0, 11.6, flat(OI.CORAL), sides=8),
          box(100.0, T + 1.6, 9.0, 104.0, T + 4.6, 10.4, flat("#c9ced4")),
          blob(101.0, T + 3.0, 10.8, 0.9, flat("#e9b44c"), n=8), blob(102.8, T + 3.2, 10.8, 0.9, flat("#e85d3a"), n=8)]
    def ufridge(p, n):
        f, u, v = face_uv(p, n)
        if f == "L" and abs(p[2] - 6.0) < 0.35:
            return rgb("#8c959e")
        return rgb("#dfe5ea")
    S.append(box(112.0, T + 0.4, 0, 124.0, T + 7.0, 8.6, ufridge))
    # kitchen island + stools
    S += [box(44.0, T + 16.0, 0, 96.0, T + 22.0, 9.0, flat(OI.WHITE)),
          box(43.0, T + 15.4, 9.0, 97.0, T + 22.6, 10.0, flat(OI.OAK_L))]
    for i, sx in enumerate((50.0, 60.0, 70.0, 80.0, 90.0)):
        S += bar_stool(sx, T + 27.0, col=(green, OI.CORAL)[i % 2])
    S += coffee_cup(56.0, T + 19.0, 10.0, col=OI.CORAL)
    S += OI.laptop(80.0, T + 19.0, 10.0)
    # W side: booth + tables; E side: foosball + beanbags; front: sofa, plants, sign
    S += CI.banquette_y(T + 0.2, 26.0, I_DOOR_Y - DOOR_HALF - 4.0)
    S += CI.banquette_y(T + 0.2, I_DOOR_Y + DOOR_HALF + 4.0, D - 16.0)
    for ty in (36.0, 92.0):
        S += cafe_table(T + 12.5, ty, r=3.0)
        S += coffee_cup(T + 12.0, ty - 0.8, 7.3)
    S += OI.foosball(W - 22.0, 48.0)
    S += OI.beanbag(W - 12.0, 84.0, col=OI.MUSTARD)
    S += OI.beanbag(W - 20.0, 96.0, col=OI.CORAL)
    S += OI.tall_plant(W - 7.0, T + 8.0, h=14.0, seed=21)
    S += potted_plant(T + 6.0, D - 8.0, r=4.2, h=11, seed=33)
    S += potted_plant(W - 7.0, D - 8.0, r=4.2, h=11, seed=35)
    S += OI.led_signboard_y(W - 2.2, D - 44.0, D - 12.0, "IDLE", col="#7bc6a4")
    return S


# =================================================================== SPACE
def space_explore(W, D, slab):
    """Observatory / sensor deck: big telescope, star-chart screen, sensor consoles, probe rack."""
    import space_interiors as SI
    acc = "#ffd84a"
    area = (1.2 * U, 1.15 * U - 2, W - 1.2 * U, 3.05 * U + 4)
    S = room_shell(W, D, slab, SI.deck_floor(acc, area), SI.bulkhead_wall(acc),
                   trim=SI.METAL_L, side="#434b57", side_dark="#363d48",
                   name="EXPLORE", plate="#0b1a24", ink="#fff3b0", plate_edge=acc, plate_at=0.35)
    T = WALL_T
    dx = W / 2
    S += doormat(dx - 6.5, D - 6.0, dx + 6.5, D - 0.4, col=SI.METAL_D, edge=acc)
    S += SI.airlock_door_x(dx, D - 0.6, 22.0, acc)
    S += entrance_steps("S", (dx, D), slab, col="#6b7584")
    S += SI.raised_letters_x("EXPLORE", 6.0, T, 18.0, col=acc, px=0.8)
    S += SI.holo_screen_x(66.0, 118.0, T, 10.5, 27.5, acc, content="starmap", seed=71)
    S += SI.viewport_x(122.0, 160.0, T, 10.0, 27.0, planet=True, seed=72)
    S += SI.console_x(66.0, 118.0, T + 1.0, acc, h=7.0, seed=73)
    for cx in (76.0, 92.0, 108.0):
        S += SI.crew_seat(cx, T + 12.0, "N", col="#d9c98a")
    # the big telescope in the NE corner
    tx, ty = W - 14.0, T + 14.0
    S += [vcyl(tx, ty, 5.0, 0, 2.0, flat(SI.METAL), sides=12),
          vcyl(tx, ty, 2.0, 2.0, 12.0, flat(SI.METAL_L), sides=10),
          box(tx - 2.4, ty - 2.4, 12.0, tx + 2.4, ty + 2.4, 14.0, flat(SI.METAL_D))]
    for k in range(6):                                   # tilted tube pointing up at the viewport
        S.append(vcyl(tx - k * 1.6, ty - k * 1.4, 2.6 - k * 0.12, 14.0 + k * 2.4, 16.8 + k * 2.4, flat("#e9eef2" if k % 2 else "#c9d1da"), sides=10))
    S.append(vcyl(tx - 9.6, ty - 8.4, 2.2, 28.4, 29.2, glow("#9ad8ff"), sides=10))
    # W wall: sensor readouts + probe drones racked + crates
    S += SI.holo_screen_y(T, 18.0, 44.0, 10.0, 22.0, acc, content="graph", seed=74)
    from space_props import drone
    for i, yy in enumerate((54.0, 66.0)):
        S.append(box(T + 0.2, yy - 5.0, 0, T + 9.0, yy + 5.0, 1.2, flat(SI.METAL_D)))
        S += SI.translate(drone(), T + 5.0, yy, -8.0) if hasattr(SI, "translate") else []
    S += SI.storage_crate(T + 1.0, 78.0, w=7.0, d=8.0, col="#7a6a3c")
    S += SI.potted_alien_plant(T + 6.0, D - 8.0, seed=9)
    S += SI.holo_table(W - 16.0, D - 14.0, r=5.0, accent=acc, kind="planet")
    return S


def space_idle(W, D, slab):
    """Smaller crew lounge with LOW walls: low hydro beds, dispensers, dining, sofas, arcade on the E side."""
    import space_interiors as SI
    acc = "#5ee08f"
    area = (1.5 * U, 1.0 * U, W - 1.1 * U, D - 1.3 * U)

    def wall(which, u, z):
        return SI.bulkhead_wall(acc, low=True)(which, u, z) if z < I_WALL else rgb(SI.METAL_L)
    S = room_shell(W, D, slab, SI.deck_floor(acc, area, a="#36404a", b="#323b45"), wall,
                   trim=SI.METAL_L, side="#434b57", side_dark="#363d48",
                   wall_h=I_WALL, wall_h_w=9.6, door_w=(I_DOOR_Y - DOOR_HALF, I_DOOR_Y + DOOR_HALF))
    T = WALL_T
    S += SI.airlock_door_y(0.6, I_DOOR_Y, 18.0, acc)
    S += doormat(T + 0.4, I_DOOR_Y - 6.5, T + 7.0, I_DOOR_Y + 6.5, col=SI.METAL_D, edge=acc)
    S += entrance_steps("W", (I_DOOR_Y, 0), slab, n_steps=1, col="#6b7584")
    # low hydroponic beds along the N wall
    S.append(box(8.0, T + 0.2, 0, 92.0, T + 6.0, 5.0, flat(SI.METAL)))
    S.append(box(8.0, T + 0.2, 5.0, 92.0, T + 6.0, 5.4, glow("#8a5cff")))
    x = 11.0
    k = 0
    while x < 90.0:
        S.append(blob(x, T + 3.0, 7.0 + (k % 2) * 0.8, 2.0, flat(("#4fc06a", "#3a9a52", "#6fd47e")[k % 3]), n=12, seed=k))
        if k % 4 == 1:
            S.append(blob(x + 0.8, T + 4.2, 8.4, 0.6, flat("#ff5a5a"), n=8))
        x += 4.2
        k += 1
    # compact food dispensers (low) + round tables with pod chairs
    def disp(x0):
        def m(p, n):
            f, u, v = face_uv(p, n)
            if f == "L" and 4.0 < p[2] < 9.0 and x0 + 1.5 < p[0] < x0 + 8.5:
                kk = int((p[2] - 4.0) // 1.7)
                return (rgb(("#f2c14e", acc, "#ff5a5a")[kk % 3]), True) if (p[0] - x0) % 3.5 < 2.8 else (rgb("#0b1a24"), True)
            return rgb(SI.METAL_L) if f == "L" else rgb(SI.METAL)
        return [box(x0, T + 0.4, 0, x0 + 10.0, T + 6.0, 11.0, m)]
    S += disp(98.0) + disp(110.0)
    for tx in (60.0, 100.0):
        S += SI.round_table(tx, T + 20.0)
        S += SI.pod_chair(tx - 6.0, T + 20.0)
        S += SI.pod_chair(tx + 6.0, T + 20.0)
    S += SI.arcade(W - 11.0, 30.0)
    S += SI.led_signboard_y(W - 2.2, D - 44.0, D - 12.0, "IDLE", acc)
    # W side sofas; E side hydro pods; front sofa + table + plants
    S += SI.translate(SI._side_sofa(), T + 0.4, 22.0) if hasattr(SI, "translate") else []
    S += SI.translate(SI._side_sofa(), T + 0.4, I_DOOR_Y + DOOR_HALF + 8.0) if hasattr(SI, "translate") else []
    from space_props import hydro_pod
    S += SI.translate(hydro_pod(), W - 10.0, 62.0)
    S += SI.lounge_sofa_x(70.0, D - 10.0, col="#3a7a6a")
    S += [box(60.0, D - 23.0, 0, 80.0, D - 17.0, 4.0, flat(SI.METAL_L)),
          box(61.0, D - 22.4, 4.0, 79.0, D - 17.6, 4.2, glow(acc))]
    S += SI.potted_alien_plant(T + 6.0, D - 8.0, seed=5)
    S += SI.potted_alien_plant(W - 7.0, D - 8.0, seed=8)
    return S


ROOMS = {
    "interior_explore": (city_explore, EW, ED, EELEV),
    "interior_idle": (city_idle, IW, ID, IELEV),
    "island_interior_explore": (island_explore, EW, ED, EELEV),
    "island_interior_idle": (island_idle, IW, ID, IELEV),
    "office_interior_explore": (office_explore, EW, ED, EELEV),
    "office_interior_idle": (office_idle, IW, ID, IELEV),
    "space_interior_explore": (space_explore, EW, ED, EELEV),
    "space_interior_idle": (space_idle, IW, ID, IELEV),
}


if __name__ == "__main__":
    man = json.load(open("out/manifest.json"))
    for name in (sys.argv[1:] or ROOMS):
        import office_interiors as OI
        OI.LIVE.clear()  # live screens (office rooms tag theirs, see office_interiors.liven)
        fn, W, D, elev = ROOMS[name]
        S = fn(W, D, elev / 2.0)
        im, anchor = render(S, ground_shadow=0)
        OI.save_room(im, anchor, S, name, man)
        print(name, im.size, anchor, flush=True)
    json.dump(man, open("out/manifest.json", "w"), indent=1)
