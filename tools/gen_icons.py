#!/usr/bin/env python3
"""Generate agent avatar icons (96x96 RGBA).

Original characters, one silhouette per agent type, colour varies per agent:
  - claude-*.png    — "sprout": gumdrop body with a two-leaf sprout
  - codex-*.png     — "cube": rounded box with an antenna
  - conductor-*.png — "capsule": tall pill with a little hat
  - gemini-*.png    — "drop": upward teardrop
  - opencode-*.png  — "dome": wide dome with a round top
  - cursor-*.png    — "tv": squat screen with two antennas

Every icon gets two punched-out horizontal oval eyes and a dark outline.
The silhouettes deliberately don't imitate any product's logo.

Requires Pillow.
"""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

SIZE = 96
SCALE = 4  # supersample masks + eyes for smooth edges

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def soft_fill(size: int, color: tuple[int, int, int], lighten: int = 14) -> Image.Image:
    """Near-flat fill with subtle top lighten (sidebar lighting)."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = im.load()
    r0, g0, b0 = color
    rt, gt, bt = min(255, r0 + lighten), min(255, g0 + lighten), min(255, b0 + lighten)
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(rt * (1 - t) + r0 * t)
        g = int(gt * (1 - t) + g0 * t)
        b = int(bt * (1 - t) + b0 * t)
        for x in range(size):
            px[x, y] = (r, g, b, 255)
    return im


def aa_mask(draw_fn) -> Image.Image:
    big = SIZE * SCALE
    m = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(m)
    draw_fn(d, SCALE)
    return m.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def _feet(d, s, y=84, xs=(34, 62), r=7):
    for x in xs:
        d.ellipse([(x - r) * s, (y - r * 0.8) * s, (x + r) * s, (y + r * 0.8) * s], fill=255)

def sprout(d, s):
    # gumdrop body + two-leaf sprout
    d.rounded_rectangle([16 * s, 30 * s, 80 * s, 84 * s], radius=26 * s, fill=255)
    d.ellipse([16 * s, 26 * s, 80 * s, 70 * s], fill=255)
    d.line([(48 * s, 30 * s), (48 * s, 16 * s)], fill=255, width=5 * s)
    d.ellipse([30 * s, 6 * s, 48 * s, 20 * s], fill=255)   # left leaf
    d.ellipse([48 * s, 4 * s, 68 * s, 18 * s], fill=255)   # right leaf
    _feet(d, s, y=86)

def cube(d, s):
    d.rounded_rectangle([14 * s, 26 * s, 82 * s, 84 * s], radius=14 * s, fill=255)
    d.line([(48 * s, 26 * s), (48 * s, 12 * s)], fill=255, width=5 * s)
    d.ellipse([41 * s, 4 * s, 55 * s, 18 * s], fill=255)    # antenna ball
    _feet(d, s, y=86)

def capsule(d, s):
    d.rounded_rectangle([24 * s, 20 * s, 72 * s, 86 * s], radius=24 * s, fill=255)
    d.rounded_rectangle([16 * s, 18 * s, 80 * s, 26 * s], radius=4 * s, fill=255)   # cap brim
    d.rounded_rectangle([30 * s, 6 * s, 66 * s, 22 * s], radius=6 * s, fill=255)    # cap crown
    _feet(d, s, y=88, xs=(38, 58), r=6)


def drop(d, s):
    # upward teardrop body with a curled tip
    d.ellipse([16 * s, 30 * s, 80 * s, 86 * s], fill=255)
    d.polygon([(22 * s, 46 * s), (48 * s, 6 * s), (74 * s, 46 * s)], fill=255)
    _feet(d, s, y=88)


def dome(d, s):
    # wide half-dome with a little round window "hat"
    d.pieslice([8 * s, 22 * s, 88 * s, 102 * s], 180, 360, fill=255)
    d.rounded_rectangle([8 * s, 58 * s, 88 * s, 82 * s], radius=10 * s, fill=255)
    d.ellipse([40 * s, 10 * s, 56 * s, 26 * s], fill=255)
    _feet(d, s, y=86, xs=(28, 68), r=8)


def tv(d, s):
    # squat screen-shaped body with two angled antennas
    d.rounded_rectangle([10 * s, 30 * s, 86 * s, 80 * s], radius=12 * s, fill=255)
    d.line([(36 * s, 30 * s), (26 * s, 10 * s)], fill=255, width=5 * s)
    d.line([(60 * s, 30 * s), (70 * s, 10 * s)], fill=255, width=5 * s)
    d.ellipse([20 * s, 4 * s, 32 * s, 16 * s], fill=255)
    d.ellipse([64 * s, 4 * s, 76 * s, 16 * s], fill=255)
    _feet(d, s, y=84, xs=(30, 66))


DRAW = {
    "sprout": sprout,
    "cube": cube,
    "capsule": capsule,
    "drop": drop,
    "dome": dome,
    "tv": tv,
}


def apply_mask(base: Image.Image, mask: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bp, mp, op = base.load(), mask.load(), out.load()
    for y in range(SIZE):
        for x in range(SIZE):
            a = mp[x, y]
            if a:
                r, g, b, _ = bp[x, y]
                op[x, y] = (r, g, b, a)
    return out


def punch_eyes(
    im: Image.Image, cx: float, cy: float, gap: float, rx: float, ry: float
) -> Image.Image:
    """Punch two horizontal oval holes through the shape (destination-out)."""
    big = SIZE * SCALE
    eye = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(eye)
    for sign in (-1, 1):
        ex = (cx + sign * (gap / 2)) * SCALE
        ey = cy * SCALE
        rcx, rcy = rx * SCALE, ry * SCALE
        d.ellipse([ex - rcx, ey - rcy, ex + rcx, ey + rcy], fill=255)
    eye = eye.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    op, ep = im.load(), eye.load()
    for y in range(SIZE):
        for x in range(SIZE):
            ea = ep[x, y]
            if ea:
                r, g, b, a = op[x, y]
                op[x, y] = (r, g, b, max(0, a - ea))
    return im


def add_silhouette_outline(
    im: Image.Image, *, color: tuple[int, int, int] = (0x11, 0x11, 0x11), radius: int = 4
) -> Image.Image:
    """Crisp black outline that follows the alpha silhouette (not a square box).

    Dilates the alpha mask by ``radius`` px, paints that ring, then redraws the
    original icon on top so punched eyes stay clear and fills stay bright.
    """
    if radius < 1:
        return im
    alpha = im.split()[3]
    # Circular dilation via repeated 3x3 max (smoother than a square MaxFilter)
    dil = alpha
    steps = max(1, radius)
    for _ in range(steps):
        dil = dil.filter(ImageFilter.MaxFilter(3))
    outline = Image.new("RGBA", im.size, (0, 0, 0, 0))
    op = outline.load()
    dp = dil.load()
    r, g, b = color
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            a = dp[x, y]
            if a:
                op[x, y] = (r, g, b, a)
    # Composite: outline underneath, original (with eye holes) on top
    out = Image.alpha_composite(outline, im)
    return out


def make_icon(
    shape: str,
    color: str,
    ecx: float,
    ecy: float,
    gap: float,
    rx: float,
    ry: float,
    *,
    outline: bool = False,
    outline_radius: int = 4,
) -> Image.Image:
    base = soft_fill(SIZE, hex_rgb(color))
    mask = aa_mask(DRAW[shape])
    im = apply_mask(base, mask)
    # Outline from solid silhouette first, then punch eyes through outline+fill
    if outline:
        im = add_silhouette_outline(im, color=(0x11, 0x11, 0x11), radius=outline_radius)
    im = punch_eyes(im, ecx, ecy, gap, rx, ry)
    return im


# Bright fills shared by all brand pools
BRIGHT_PALETTE = [
    "#FF781C",  # orange
    "#1CC3B0",  # cyan
    "#A97EFE",  # violet
    "#2A92FE",  # blue
    "#E85D75",  # rose
    "#3DDC97",  # mint
    "#F4A261",  # sand
    "#7B68EE",  # medium slate blue
    "#2EC4B6",  # teal
    "#FF9F1C",  # amber
    "#5C7CFA",  # indigo
    "#959595",  # soft grey accent (still readable, not charcoal)
]
CLAUDE_PALETTE = BRIGHT_PALETTE
CODEX_PALETTE = BRIGHT_PALETTE
CONDUCTOR_PALETTE = BRIGHT_PALETTE


def generate_brand_pool(
    prefix: str,
    shape: str,
    palette: list[str],
    *,
    ecx: float,
    ecy: float,
    gap: float,
    rx: float,
    ry: float,
    out_dir: str = OUT,
    count: int | None = None,
    outline: bool = True,
    outline_radius: int = 4,
) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    n = count or len(palette)
    paths = []
    for i in range(n):
        color = palette[i % len(palette)]
        name = f"{prefix}-{i:02d}.png"
        im = make_icon(
            shape, color, ecx, ecy, gap, rx, ry,
            outline=outline, outline_radius=outline_radius,
        )
        path = os.path.join(out_dir, name)
        im.save(path, "PNG")
        print("wrote", path)
        paths.append(f"icons/{name}")
    return paths


EYES = dict(gap=18, rx=6.5, ry=4.8)


def generate_claude(out_dir: str = OUT) -> list[str]:
    return generate_brand_pool("claude", "sprout", CLAUDE_PALETTE, ecx=48, ecy=52, out_dir=out_dir, **EYES)


def generate_codex(out_dir: str = OUT) -> list[str]:
    return generate_brand_pool("codex", "cube", CODEX_PALETTE, ecx=48, ecy=50, out_dir=out_dir, **EYES)


def generate_conductor(out_dir: str = OUT) -> list[str]:
    return generate_brand_pool("conductor", "capsule", CONDUCTOR_PALETTE, ecx=48, ecy=48, out_dir=out_dir, **EYES)


def generate_gemini(out_dir: str = OUT) -> list[str]:
    return generate_brand_pool("gemini", "drop", BRIGHT_PALETTE, ecx=48, ecy=58, out_dir=out_dir, **EYES)


def generate_opencode(out_dir: str = OUT) -> list[str]:
    return generate_brand_pool("opencode", "dome", BRIGHT_PALETTE, ecx=48, ecy=60, out_dir=out_dir, **EYES)


def generate_cursor(out_dir: str = OUT) -> list[str]:
    return generate_brand_pool("cursor", "tv", BRIGHT_PALETTE, ecx=48, ecy=55, out_dir=out_dir, **EYES)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or "claude" in args:
        generate_claude()
    if not args or "codex" in args:
        generate_codex()
    if not args or "conductor" in args:
        generate_conductor()
    if not args or "gemini" in args:
        generate_gemini()
    if not args or "opencode" in args:
        generate_opencode()
    if not args or "cursor" in args:
        generate_cursor()
    print("done")
