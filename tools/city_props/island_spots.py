"""Prop placements for the Island ground (heights sampled from island_height.npy)."""
import json, numpy as np
from island_ground import GX0, GY0, U, WATER_Z
H = np.load("out/island_height.npy")


def z_at(gx, gy):
    i = int((gx - GX0) * U); j = int((gy - GY0) * U)
    return float(H[j, i]) * 2.0          # px (board draws sprites at 2x)


def shore_y(gx, y0=12.0):
    y = y0
    while z_at(gx, y) > (WATER_Z + 1.0) * 2 and y < 22:
        y += 0.05
    return y


S = []
def add(t, x, y, z=None):
    S.append({"type": "city_" + t, "gx": round(x, 2), "gy": round(y, 2), "z": round(z_at(x, y) if z is None else z, 1)})

SEA = WATER_Z * 2
# meadow in front of the zones
for (t, x, y) in (("pine_0", 2.0, 12.4), ("pine_2", 3.3, 13.3), ("pine_1", 1.0, 13.6),
                  ("tree_big", 10.4, 13.7), ("tree_small", 13.5, 13.5), ("tree_small", 12.2, 14.4),
                  ("bush_1", 8.1, 12.8), ("bush_2", 11.4, 12.2), ("bush_0", 15.6, 12.1),
                  ("boulder_big", 14.6, 14.2), ("boulder_small", 9.2, 14.3), ("boulder_small", 18.6, 13.8),
                  ("flower_patch_0", 7.7, 13.7), ("flower_patch_1", 12.1, 13.1), ("flower_patch_0", 16.0, 14.0),
                  ("lantern_post", 6.15, 12.8), ("lantern_post", 5.35, 13.9), ("signpost", 6.95, 12.0),
                  ("bush_1", 18.2, 14.2), ("fence_x", 14.9, 12.5)):
    add(t, x, y)
# beach: palms, campfire
add("palm_0", 1.6, shore_y(1.6) - 0.9)
add("palm_1", 9.6, shore_y(9.6) - 0.8)
add("campfire", 7.6, shore_y(7.6) - 0.75)
# dock + boats at sea level
dx = 4.5
sy = shore_y(dx)
add("dock", dx, sy - 0.55, SEA)
add("rowboat", dx + 1.1, sy + 1.4, SEA)
add("sailboat", 13.8, 18.4, SEA)
add("sailboat", -2.6, 8.6, SEA)
# lighthouse on its islet
add("lighthouse", 21.6, 15.55, -16.0)
# island edges (the zone keep-out drops any that would sit over a zone)
for (t, x, y) in (("pine_1", 0.1, 2.6), ("pine_0", -0.3, 6.2), ("pine_2", 0.2, 9.8),
                  ("pine_0", 3.0, -0.6), ("pine_2", 9.4, -0.7), ("pine_1", 15.8, 0.1), ("pine_0", 19.6, 0.3),
                  ("pine_2", 22.2, 3.6), ("pine_1", 22.4, 7.4), ("boulder_big", 22.3, 10.2),
                  ("bush_2", -0.4, 11.6), ("palm_0", 21.4, 13.0)):
    add(t, x, y)
json.dump(S, open("out/island_spots.json", "w"), indent=1)
print(len(S), "spots; shore at x=4.5:", round(sy, 2))
