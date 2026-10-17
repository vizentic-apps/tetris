#!/usr/bin/env python3
"""Génère les icônes PNG de la PWA (Pillow). Usage : python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (11, 15, 23)
COL = {"T": (179, 136, 235), "Z": (239, 71, 111), "O": (249, 199, 79)}
PATTERN = ["..T..", ".TTT.", "ZZ.OO", ".ZZOO"]


def shade(c, a):
    return tuple(int(v + (255 - v) * a) if a > 0 else int(v * (1 + a)) for v in c)


def render(size, rounded, ss=4):
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG + (255,))
    else:
        d.rectangle([0, 0, S, S], fill=BG + (255,))
    b = S * 0.12
    x0 = (S - 5 * b) / 2
    y0 = (S - 4 * b) / 2
    bev = b * 0.14
    for r, row in enumerate(PATTERN):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            base = COL[ch]
            x, y = x0 + c * b, y0 + r * b
            d.rounded_rectangle([x + 1, y + 1, x + b - 1, y + b - 1], radius=b * 0.12, fill=base)
            d.rectangle([x + 1, y + 1, x + b - 1, y + 1 + bev], fill=shade(base, 0.35))
            d.rectangle([x + 1, y + b - 1 - bev, x + b - 1, y + b - 1], fill=shade(base, -0.35))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
render(192, True).save(OUT / "icon-192.png")
render(512, True).save(OUT / "icon-512.png")
render(512, False).save(OUT / "maskable-512.png")
render(180, False).save(OUT / "apple-touch-icon.png")
print("ok", sorted(p.name for p in OUT.iterdir()))
