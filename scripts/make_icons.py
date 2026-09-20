#!/usr/bin/env python3
"""Generate the PWA app icons (flat, professional, no text).

Creates:
  public/icon-192.png          (rounded, transparent corners)
  public/icon-512.png          (rounded, transparent corners)
  public/icon-maskable-512.png (full bleed, art inside the safe zone)
  public/apple-touch-icon.png  (180, full bleed)
  app/favicon.ico              (16/32/48)

Pure flat design: cream background, dark charcoal cup + straw + base.
Uses 4x supersampling for smooth edges. Run: python3 scripts/make_icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
BG = (247, 245, 240, 255)      # cream
INK = (41, 37, 36, 255)        # dark charcoal
SS = 4                          # supersample factor
BASE = 512


def art_size(full_bleed: bool) -> float:
    # Scale of the 512-design-space artwork inside the final square.
    return 0.72 if full_bleed else 0.62


def draw(size: int, full_bleed: bool, rounded_radius: int) -> Image.Image:
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(rounded_radius * SS)
    if full_bleed:
        d.rectangle([0, 0, S - 1, S - 1], fill=BG)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=BG)

    # Map a point from the 512 design space into the icon.
    scale = art_size(full_bleed)
    off = (S - BASE * SS * scale) / 2

    def T(v: float) -> float:
        return off + v * SS * scale

    cup_top, cup_bot = 170, 352
    cup_top_w, cup_bot_w = 80, 58
    cx = 256

    # Straw (drawn first; the cup covers its lower end)
    p1 = (T(298), T(84))
    p2 = (T(262), T(182))
    w = int(22 * SS * scale)
    d.line([p1, p2], fill=INK, width=w, joint="curve")
    d.ellipse([p1[0] - w / 2, p1[1] - w / 2, p1[0] + w / 2, p1[1] + w / 2], fill=INK)

    # Cup (trapezoid)
    d.polygon(
        [
            (T(cx - cup_top_w), T(cup_top)),
            (T(cx + cup_top_w), T(cup_top)),
            (T(cx + cup_bot_w), T(cup_bot)),
            (T(cx - cup_bot_w), T(cup_bot)),
        ],
        fill=INK,
    )

    # Base
    d.rounded_rectangle(
        [T(196), T(368), T(316), T(390)],
        radius=int(10 * SS * scale),
        fill=INK,
    )

    return img.resize((size, size), Image.LANCZOS)


def main():
    pub = os.path.join(ROOT, "public")
    app = os.path.join(ROOT, "app")
    os.makedirs(pub, exist_ok=True)
    os.makedirs(app, exist_ok=True)

    i192 = draw(192, full_bleed=False, rounded_radius=43)
    i512 = draw(512, full_bleed=False, rounded_radius=115)
    imask = draw(512, full_bleed=True, rounded_radius=0)
    iapple = draw(180, full_bleed=True, rounded_radius=0)

    i192.save(os.path.join(pub, "icon-192.png"))
    i512.save(os.path.join(pub, "icon-512.png"))
    imask.save(os.path.join(pub, "icon-maskable-512.png"))
    iapple.save(os.path.join(pub, "apple-touch-icon.png"))

    ico = draw(48, full_bleed=False, rounded_radius=11)
    ico.save(
        os.path.join(app, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("Icons generated in public/ and app/favicon.ico")


if __name__ == "__main__":
    main()
