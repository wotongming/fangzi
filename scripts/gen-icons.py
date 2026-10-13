#!/usr/bin/env python3
"""生成方子 PWA 与浏览器插件所需的全部 PNG 图标（4 倍超采样抗锯齿）。"""
import os
from PIL import Image, ImageDraw, ImageFont

BRAND = (63, 125, 94, 255)  # #3f7d5e
WHITE = (255, 255, 255, 255)
FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
GLYPH = "方"
SS = 4  # 超采样倍数

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def centered_text(draw, size, fraction, font_index=0):
    font_size = int(size * fraction)
    font = ImageFont.truetype(FONT_PATH, font_size, index=font_index)
    bbox = draw.textbbox((0, 0), GLYPH, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1] - size * 0.02  # 视觉居中微调
    draw.text((x, y), GLYPH, font=font, fill=WHITE)


def rounded_icon(size, radius_ratio, glyph_fraction):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(big * radius_ratio)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=BRAND)
    centered_text(d, big, glyph_fraction)
    return img.resize((size, size), Image.LANCZOS)


def maskable_icon(size):
    big = size * SS
    img = Image.new("RGBA", (big, big), BRAND)  # 满幅出血
    d = ImageDraw.Draw(img)
    centered_text(d, big, 0.5)  # 文字落在中心安全区
    return img.resize((size, size), Image.LANCZOS)


def main():
    targets = [
        ("public/icons/icon-192.png", 192, "rounded", 0.58),
        ("public/icons/icon-512.png", 512, "rounded", 0.58),
        ("public/icons/apple-touch-icon.png", 180, "rounded", 0.58),
        ("plugins-src/fangzi-companion/icons/icon16.png", 16, "rounded", 0.6),
        ("plugins-src/fangzi-companion/icons/icon48.png", 48, "rounded", 0.6),
        ("plugins-src/fangzi-companion/icons/icon128.png", 128, "rounded", 0.6),
    ]
    for rel, size, _, frac in targets:
        img = rounded_icon(size, 0.21, frac)
        out = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        img.save(out)
        print("wrote", rel, size)

    m = maskable_icon(512)
    m.save(os.path.join(ROOT, "public/icons/icon-512-maskable.png"))
    print("wrote public/icons/icon-512-maskable.png 512 (maskable)")


if __name__ == "__main__":
    main()
