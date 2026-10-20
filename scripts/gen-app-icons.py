#!/usr/bin/env python3
"""
方子应用图标生成器（Pillow，纯本地、不加运行时依赖）。

用途：从一张「绿色圆角方块 + 白字『方』+ 橙尖绿叶」的源图自动检测绿色包围盒、
紧贴裁剪去白底与右下水印，生成全套 PWA / maskable / apple-touch / favicon 图标，
输出到 public/icons/ 与 public/favicon.svg。

用法（源图不入库、不进 bundle，仅本机一次性处理）：
    FANGZI_ICON_SRC=/path/to/source.webp python3 scripts/gen-app-icons.py

产物：
    public/icons/icon-192.png        PWA any 192
    public/icons/icon-512.png        PWA any 512
    public/icons/icon-512-maskable.png  maskable 512（绿底满幅，核心居中于 80% 安全区）
    public/icons/apple-touch-icon.png   iOS 180×180 满幅不透明（iOS 自裁圆角）
    public/icons/favicon-32.png / favicon-16.png  浏览器标签小图标
    public/favicon.svg                内嵌裁剪图的矢量外壳（兼容只认 svg 的环境）

注意：源图（带水印的 2048 原图）绝不提交进仓库；本脚本不被 build 打进产物。
"""
import base64
import collections
import io
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "public", "icons")
FAVICON_SVG = os.path.join(ROOT, "public", "favicon.svg")
GREEN = (63, 125, 94)  # 与 theme_color #3f7d5e 一致


def load_source() -> Image.Image:
    src = os.environ.get("FANGZI_ICON_SRC")
    if not src or not os.path.exists(src):
        raise SystemExit("请先设置环境变量 FANGZI_ICON_SRC 指向本地源图（源图不入库）")
    return Image.open(src).convert("RGB")


def square_crop(im: Image.Image) -> Image.Image:
    """按高饱和绿掩码取包围盒，居中裁成正方形（绿叶略伸出方块也纳入）。"""
    a = np.asarray(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mask = (g > r + 12) & (g > b + 4) & (g > 60) & (r < 160)
    ys, xs = np.where(mask)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    side = max(x1 - x0, y1 - y0) + 4
    half = side // 2
    box = (max(0, cx - half), max(0, cy - half), min(im.width, cx + half), min(im.height, cy + half))
    crop = im.crop(box)
    s = crop.size[0]
    master = Image.new("RGBA", (s, s), GREEN + (255,))
    master.paste(crop, ((s - crop.size[0]) // 2, (s - crop.size[1]) // 2))
    return strip_exterior_white(master)


def strip_exterior_white(master: Image.Image) -> Image.Image:
    """从四周边缘洪水填充，把外缘近白（白底/抗描边）置透明，保留内部白字。"""
    arr = np.asarray(master).copy()
    white = (arr[..., 0] > 232) & (arr[..., 1] > 232) & (arr[..., 2] > 232)
    h, w = white.shape
    seen = np.zeros_like(white, bool)
    dq = collections.deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    arr[seen, 3] = 0
    return Image.fromarray(arr, "RGBA")


def rounded(im: Image.Image, frac: float = 0.18) -> Image.Image:
    im = im.convert("RGBA")
    m = Image.new("L", im.size, 0)
    d = ImageDraw.Draw(m)
    radius = int(im.size[0] * frac)
    d.rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=radius, fill=255)
    im.putalpha(m)
    return im


def main() -> None:
    master = square_crop(load_source())

    def any_icon(size: int) -> Image.Image:
        return rounded(master.resize((size, size), Image.LANCZOS))

    os.makedirs(ICON_DIR, exist_ok=True)
    any_icon(192).save(os.path.join(ICON_DIR, "icon-192.png"))
    any_icon(512).save(os.path.join(ICON_DIR, "icon-512.png"))

    # maskable：绿底满幅，核心缩到 64% 居中，落在 80% 安全区
    m = Image.new("RGBA", (512, 512), GREEN + (255,))
    core = master.resize((int(512 * 0.64), int(512 * 0.64)), Image.LANCZOS)
    m.alpha_composite(core, ((512 - core.size[0]) // 2, (512 - core.size[1]) // 2))
    m.save(os.path.join(ICON_DIR, "icon-512-maskable.png"))

    # apple-touch：180 满幅不透明绿底，核心 72% 居中（iOS 自裁圆角）
    ap = Image.new("RGBA", (180, 180), GREEN + (255,))
    ac = master.resize((int(180 * 0.72), int(180 * 0.72)), Image.LANCZOS)
    ap.alpha_composite(ac, ((180 - ac.size[0]) // 2, (180 - ac.size[1]) // 2))
    ap.save(os.path.join(ICON_DIR, "apple-touch-icon.png"))

    any_icon(32).save(os.path.join(ICON_DIR, "favicon-32.png"))
    any_icon(16).save(os.path.join(ICON_DIR, "favicon-16.png"))

    buf = io.BytesIO()
    master.resize((128, 128), Image.LANCZOS).save(buf, "PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        '<defs><clipPath id="r"><rect x="6" y="6" width="116" height="116" rx="28"/></clipPath></defs>'
        '<rect x="6" y="6" width="116" height="116" rx="28" fill="#3f7d5e"/>'
        f'<image href="data:image/png;base64,{b64}" width="128" height="128" '
        'clip-path="url(#r)" preserveAspectRatio="xMidYMid meet"/></svg>'
    )
    with open(FAVICON_SVG, "w", encoding="utf-8") as f:
        f.write(svg)
    print("icons written to", ICON_DIR)


if __name__ == "__main__":
    main()
