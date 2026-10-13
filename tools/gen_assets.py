#!/usr/bin/env python3
"""Generate the Island theme's pixel-art decor tiles (trees, rocks, signs, props) with Pillow."""
from __future__ import annotations
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
TILES = os.path.join(ROOT, "tiles")
os.makedirs(TILES, exist_ok=True)

TRANSPARENT = (0, 0, 0, 0)

def new(w, h):
    return Image.new("RGBA", (w, h), TRANSPARENT)

def save(img, folder, name):
    path = os.path.join(folder, name)
    img.save(path, "PNG")
    print("wrote", path)

def px(draw, x, y, c):
    if isinstance(c, tuple) and len(c) == 3:
        c = (*c, 255)
    draw.point((x, y), fill=c)

def fill(draw, x0, y0, x1, y1, c):
    if isinstance(c, tuple) and len(c) == 3:
        c = (*c, 255)
    draw.rectangle([x0, y0, x1 - 1, y1 - 1], fill=c)

def rect_outline(draw, x0, y0, x1, y1, c):
    if isinstance(c, tuple) and len(c) == 3:
        c = (*c, 255)
    draw.rectangle([x0, y0, x1 - 1, y1 - 1], outline=c)

# ---------------------------------------------------------------------------
# Bot characters — 48×48 distinct silhouettes
# ---------------------------------------------------------------------------

def draw_shadow(draw, cx=24, cy=44, rx=12, ry=4):
    # soft elliptical ground hint baked into sprite (board also draws live shadow)
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.0:
                a = 40 if abs(dx) + abs(dy) < rx else 22
                px(draw, cx + dx, cy + dy, (0, 0, 0, a))


# ---------------------------------------------------------------------------
# Decor sprites
# ---------------------------------------------------------------------------

def make_pine(variant=0):
    """Tall frosted pine like Mockup_1 (teal/blue-green)."""
    w, h = 32, 48
    img = new(w, h)
    d = ImageDraw.Draw(img)
    # trunk
    fill(d, 14, 36, 18, 46, (90, 60, 40))
    fill(d, 15, 36, 17, 45, (120, 85, 55))
    # foliage layers — soft teal
    palettes = [
        [(70, 130, 120), (100, 170, 155), (140, 200, 185), (50, 90, 85)],
        [(60, 120, 140), (90, 160, 170), (130, 195, 200), (40, 80, 95)],
        [(80, 140, 100), (110, 175, 130), (150, 205, 160), (55, 100, 70)],
    ]
    dark, mid, lit, outline = palettes[variant % 3]
    layers = [
        (8, 28, 24, 38),
        (10, 20, 22, 30),
        (12, 12, 20, 22),
        (13, 6, 19, 14),
    ]
    for i, (x0, y0, x1, y1) in enumerate(layers):
        # triangle-ish diamond foliage
        cx = (x0 + x1) // 2
        for y in range(y0, y1):
            t = (y - y0) / max(1, y1 - y0 - 1)
            half = int((1 - t * 0.15) * (x1 - x0) / 2 * (0.4 + 0.6 * t))
            for x in range(cx - half, cx + half + 1):
                c = mid if (x + y) % 3 else lit
                if x == cx - half or x == cx + half:
                    c = outline
                px(d, x, y, c)
        # darker underside
        for x in range(x0 + 1, x1):
            px(d, x, y1 - 1, dark)
    # tip highlight
    px(d, 15, 5, lit)
    px(d, 16, 4, lit)
    px(d, 16, 5, mid)
    return img


def make_bush():
    img = new(24, 18)
    d = ImageDraw.Draw(img)
    dark, mid, lit = (40, 100, 55), (70, 140, 75), (120, 180, 110)
    blobs = [(6, 8, 7), (12, 6, 8), (18, 9, 6), (10, 11, 6)]
    for cx, cy, r in blobs:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    c = lit if y < cy - 1 else (mid if y < cy + 2 else dark)
                    if (x + y) % 5 == 0:
                        c = dark
                    px(d, x, y, c)
    return img


def make_rock(variant=0):
    img = new(20, 14)
    d = ImageDraw.Draw(img)
    if variant == 0:
        cols = [(110, 115, 120), (150, 155, 160), (80, 85, 90), (190, 195, 200)]
    else:
        cols = [(120, 100, 80), (160, 135, 100), (90, 70, 55), (190, 170, 140)]
    mid, lit, dark, hi = cols
    # blob rock
    for y in range(3, 13):
        for x in range(2, 18):
            # elliptical-ish
            nx = (x - 10) / 8
            ny = (y - 8) / 5
            if nx * nx + ny * ny <= 1:
                c = mid
                if x < 7:
                    c = dark
                elif x > 13:
                    c = lit
                if y < 6 and x > 8:
                    c = hi
                px(d, x, y, c)
    return img


def make_flower(color):
    img = new(12, 12)
    d = ImageDraw.Draw(img)
    # stem
    fill(d, 5, 7, 7, 12, (50, 120, 60))
    # petals
    cx, cy = 5, 4
    for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, -1), (-1, 1), (1, 1)]:
        px(d, cx + dx, cy + dy, color)
        px(d, cx + dx + 1, cy + dy, color)
    px(d, cx, cy, (255, 240, 120))
    px(d, cx + 1, cy, (255, 240, 120))
    return img


def make_sign():
    """Wooden sign post for zone labels (label text drawn ON plaque face in canvas).
    Geometry: 72×52; plaque face ~x=4..67, y=2..28; face centre (36, 15.5).
    """
    img = new(72, 52)
    d = ImageDraw.Draw(img)
    # post
    fill(d, 33, 26, 39, 52, (100, 68, 40))
    fill(d, 34, 26, 38, 51, (130, 92, 55))
    fill(d, 35, 26, 37, 50, (150, 108, 65))
    # board outer
    fill(d, 2, 1, 70, 30, (90, 58, 32))
    fill(d, 3, 2, 69, 29, (155, 115, 68))
    fill(d, 4, 3, 68, 28, (198, 158, 100))  # light face for dark text
    for x in range(4, 68):
        px(d, x, 3, (220, 185, 130))
        px(d, x, 27, (120, 80, 45))
    for y in range(3, 28):
        px(d, 4, y, (210, 175, 120))
        px(d, 67, y, (130, 88, 50))
    for y in (8, 14, 20):
        for x in range(7, 66, 4):
            px(d, x, y, (175, 138, 82))
    for nx, ny in ((8, 6), (63, 6), (8, 24), (63, 24)):
        px(d, nx, ny, (80, 55, 30))
    return img


def make_stone_plaque():
    """Light name-plate under bot labels (high contrast)."""
    img = new(64, 18)
    d = ImageDraw.Draw(img)
    fill(d, 1, 1, 63, 17, (70, 50, 28))
    fill(d, 2, 2, 62, 16, (245, 236, 210))
    fill(d, 3, 3, 61, 15, (252, 246, 225))
    for x in range(2, 62):
        px(d, x, 2, (210, 190, 150))
        px(d, x, 15, (180, 155, 110))
    return img


# pine variants
for i in range(3):
    save(make_pine(i), TILES, f"pine_{i}.png")
save(make_bush(), TILES, "bush.png")
save(make_rock(0), TILES, "rock_grey.png")
save(make_rock(1), TILES, "rock_brown.png")
save(make_flower((220, 60, 70)), TILES, "flower_red.png")
save(make_flower((255, 140, 50)), TILES, "flower_orange.png")
save(make_flower((180, 90, 220)), TILES, "flower_purple.png")
save(make_sign(), TILES, "sign.png")
save(make_stone_plaque(), TILES, "plaque.png")

# Tiny grass speckles sheet (used optionally)
grass = new(16, 16)
gd = ImageDraw.Draw(grass)
for y in range(16):
    for x in range(16):
        # base green noise
        n = (x * 7 + y * 13) % 5
        if n == 0:
            px(gd, x, y, (70, 140, 70))
        elif n == 1:
            px(gd, x, y, (110, 180, 90))
        elif n == 2:
            px(gd, x, y, (90, 160, 80))
        else:
            px(gd, x, y, (0, 0, 0, 0))
save(grass, TILES, "grass_speckle.png")

print("done — assets generated")

# ---------------------------------------------------------------------------
# Zone props (larger) + motif icons (small, for chips / near signs)
# ---------------------------------------------------------------------------

def make_prop_podium():
    """Pitch: podium + paper stack."""
    img = new(32, 28)
    d = ImageDraw.Draw(img)
    # podium body
    fill(d, 6, 14, 26, 26, (120, 85, 50))
    fill(d, 7, 15, 25, 25, (160, 120, 70))
    fill(d, 8, 16, 24, 18, (200, 165, 100))
    # paper on top
    fill(d, 10, 6, 22, 15, (245, 240, 220))
    rect_outline(d, 10, 6, 22, 15, (90, 70, 40))
    fill(d, 12, 8, 20, 9, (180, 160, 120))
    fill(d, 12, 11, 18, 12, (180, 160, 120))
    return img


def make_prop_easel():
    """Design: easel + palette."""
    img = new(32, 30)
    d = ImageDraw.Draw(img)
    # easel legs
    fill(d, 8, 10, 10, 28, (110, 75, 45))
    fill(d, 22, 10, 24, 28, (110, 75, 45))
    fill(d, 14, 18, 16, 28, (90, 60, 35))
    # canvas
    fill(d, 6, 4, 26, 18, (80, 60, 40))
    fill(d, 7, 5, 25, 17, (230, 240, 235))
    fill(d, 9, 7, 14, 12, (70, 160, 150))
    fill(d, 15, 8, 20, 14, (140, 200, 180))
    fill(d, 18, 10, 23, 15, (200, 230, 160))
    # palette blob bottom-left
    fill(d, 2, 20, 12, 28, (200, 170, 120))
    px(d, 4, 22, (220, 80, 80))
    px(d, 7, 22, (80, 160, 220))
    px(d, 5, 25, (240, 200, 60))
    px(d, 8, 25, (90, 180, 100))
    return img


def make_prop_desk():
    """Content: desk + scroll."""
    img = new(32, 26)
    d = ImageDraw.Draw(img)
    # desk top
    fill(d, 2, 14, 30, 18, (140, 100, 60))
    fill(d, 3, 15, 29, 17, (180, 135, 80))
    # legs
    fill(d, 4, 18, 7, 25, (100, 70, 40))
    fill(d, 25, 18, 28, 25, (100, 70, 40))
    # scroll
    fill(d, 10, 4, 24, 14, (235, 225, 190))
    fill(d, 9, 4, 11, 14, (210, 190, 140))
    fill(d, 23, 4, 25, 14, (210, 190, 140))
    fill(d, 12, 6, 21, 7, (120, 100, 70))
    fill(d, 12, 9, 20, 10, (120, 100, 70))
    fill(d, 12, 12, 18, 13, (120, 100, 70))
    return img


def make_prop_laptop():
    """Demo: laptop + cable."""
    img = new(32, 24)
    d = ImageDraw.Draw(img)
    # screen
    fill(d, 6, 2, 26, 14, (50, 65, 80))
    fill(d, 7, 3, 25, 13, (90, 160, 180))
    fill(d, 9, 5, 15, 7, (200, 240, 250))
    fill(d, 9, 8, 20, 9, (60, 100, 120))
    fill(d, 9, 10, 18, 11, (60, 100, 120))
    # base
    fill(d, 4, 14, 28, 18, (70, 85, 100))
    fill(d, 5, 15, 27, 17, (110, 125, 140))
    # cable
    for i, (x, y) in enumerate([(28, 16), (29, 18), (30, 20), (29, 22), (27, 23)]):
        px(d, x, y, (60, 70, 80))
        px(d, x, y + 1, (90, 100, 110))
    return img


def make_prop_checklist():
    """Review: checklist stand."""
    img = new(28, 30)
    d = ImageDraw.Draw(img)
    # stand post
    fill(d, 12, 18, 16, 30, (100, 75, 50))
    fill(d, 13, 18, 15, 29, (140, 105, 70))
    # board
    fill(d, 2, 2, 26, 20, (90, 70, 50))
    fill(d, 3, 3, 25, 19, (245, 242, 230))
    # checklist rows
    for i, y in enumerate((5, 9, 13)):
        fill(d, 5, y, 8, y + 3, (120, 160, 130) if i < 2 else (200, 200, 190))
        if i < 2:
            px(d, 6, y + 1, (40, 100, 60))
            px(d, 7, y + 2, (40, 100, 60))
        fill(d, 10, y + 1, 22, y + 2, (160, 150, 130))
    return img


def make_prop_bench():
    """Idle: bench."""
    img = new(32, 20)
    d = ImageDraw.Draw(img)
    # seat
    fill(d, 2, 8, 30, 12, (110, 85, 55))
    fill(d, 3, 9, 29, 11, (150, 120, 80))
    # back
    fill(d, 2, 2, 30, 7, (100, 78, 50))
    fill(d, 3, 3, 29, 6, (140, 110, 72))
    # legs
    fill(d, 4, 12, 7, 19, (80, 60, 40))
    fill(d, 25, 12, 28, 19, (80, 60, 40))
    return img


def make_prop_lookout():
    """Overview: lookout / spyglass tower."""
    img = new(28, 36)
    d = ImageDraw.Draw(img)
    # pole
    fill(d, 12, 10, 16, 34, (100, 75, 45))
    fill(d, 13, 10, 15, 33, (150, 115, 70))
    # platform
    fill(d, 4, 12, 24, 16, (120, 90, 55))
    fill(d, 5, 13, 23, 15, (180, 145, 90))
    # railing
    fill(d, 4, 8, 6, 13, (90, 70, 40))
    fill(d, 22, 8, 24, 13, (90, 70, 40))
    fill(d, 4, 8, 24, 10, (130, 100, 60))
    # spyglass / flag
    fill(d, 14, 2, 18, 10, (70, 140, 120))
    fill(d, 18, 3, 24, 7, (200, 80, 70))
    px(d, 15, 1, (255, 220, 100))
    return img


def make_motif_megaphone():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    # cone
    for y in range(3, 11):
        t = (y - 3) / 7
        half = int(1 + t * 4)
        for x in range(3, 3 + half + 1):
            px(d, x, y, (220, 170, 60) if x > 3 else (180, 130, 40))
    fill(d, 2, 5, 4, 9, (90, 70, 50))
    # handle
    fill(d, 1, 8, 3, 12, (70, 55, 40))
    # sound lines
    px(d, 10, 4, (200, 150, 50))
    px(d, 12, 6, (200, 150, 50))
    px(d, 10, 9, (200, 150, 50))
    return img


def make_motif_eyedropper():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    # bulb
    fill(d, 3, 1, 8, 5, (90, 180, 170))
    fill(d, 4, 2, 7, 4, (140, 220, 210))
    # stem
    fill(d, 5, 5, 7, 11, (80, 100, 110))
    fill(d, 5, 11, 7, 13, (200, 80, 100))
    # frame hint
    rect_outline(d, 9, 3, 13, 9, (70, 140, 130))
    px(d, 10, 5, (140, 200, 180))
    return img


def make_motif_quill():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    # feather
    for i in range(8):
        px(d, 4 + i // 2, 2 + i, (230, 220, 190))
        px(d, 5 + i // 2, 2 + i, (200, 190, 150))
    fill(d, 3, 9, 5, 13, (60, 50, 40))
    # Aa mark
    fill(d, 9, 8, 13, 9, (60, 110, 70))
    fill(d, 10, 10, 12, 12, (60, 110, 70))
    return img


def make_motif_gear():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    cx, cy, r = 6, 7, 4
    for y in range(14):
        for x in range(14):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            ang = abs((dx + dy) % 3)
            if 2.2 <= dist <= 5.2 and ang != 0:
                px(d, x, y, (90, 120, 140))
            elif dist <= 2.0:
                px(d, x, y, (50, 70, 85))
            elif dist <= 2.8:
                px(d, x, y, (70, 100, 120))
    # terminal cursor
    px(d, 11, 3, (100, 220, 180))
    px(d, 12, 3, (100, 220, 180))
    return img


def make_motif_tick():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    # badge circle
    for y in range(14):
        for x in range(14):
            if (x - 7) ** 2 + (y - 7) ** 2 <= 36:
                px(d, x, y, (120, 100, 150) if (x - 7) ** 2 + (y - 7) ** 2 > 25 else (200, 190, 230))
    # tick
    for i in range(4):
        px(d, 4 + i, 7 + i, (50, 120, 70))
        px(d, 5 + i, 7 + i, (50, 120, 70))
    for i in range(5):
        px(d, 7 + i, 10 - i, (40, 140, 70))
        px(d, 8 + i, 10 - i, (40, 140, 70))
    return img


def make_motif_moon():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    for y in range(14):
        for x in range(14):
            if (x - 7) ** 2 + (y - 7) ** 2 <= 25:
                if (x - 10) ** 2 + (y - 5) ** 2 > 16:
                    px(d, x, y, (220, 210, 160) if y < 7 else (190, 180, 130))
    # zzz
    px(d, 11, 2, (120, 130, 110))
    px(d, 12, 3, (120, 130, 110))
    px(d, 11, 4, (120, 130, 110))
    return img


def make_motif_compass():
    img = new(14, 14)
    d = ImageDraw.Draw(img)
    for y in range(14):
        for x in range(14):
            if (x - 7) ** 2 + (y - 7) ** 2 <= 36:
                px(d, x, y, (80, 120, 70) if (x - 7) ** 2 + (y - 7) ** 2 > 25 else (200, 220, 150))
    # N needle
    for i in range(5):
        px(d, 7, 3 + i, (200, 60, 50))
        px(d, 7, 8 + i, (60, 70, 90))
    px(d, 6, 4, (200, 60, 50))
    px(d, 8, 4, (200, 60, 50))
    return img


# Zone props
save(make_prop_podium(), TILES, "prop_podium.png")
save(make_prop_easel(), TILES, "prop_easel.png")
save(make_prop_desk(), TILES, "prop_desk.png")
save(make_prop_laptop(), TILES, "prop_laptop.png")
save(make_prop_checklist(), TILES, "prop_checklist.png")
save(make_prop_bench(), TILES, "prop_bench.png")
save(make_prop_lookout(), TILES, "prop_lookout.png")

# Motifs
save(make_motif_megaphone(), TILES, "motif_megaphone.png")
save(make_motif_eyedropper(), TILES, "motif_eyedropper.png")
save(make_motif_quill(), TILES, "motif_quill.png")
save(make_motif_gear(), TILES, "motif_gear.png")
save(make_motif_tick(), TILES, "motif_tick.png")
save(make_motif_moon(), TILES, "motif_moon.png")
save(make_motif_compass(), TILES, "motif_compass.png")

print("done — zone props + motifs")
