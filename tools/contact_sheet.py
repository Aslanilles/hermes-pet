"""把 oneko 精灵表切成 32x32 网格并放大，生成带行列标注的对照图（给人和 codex 看）。

用法：
    uv run --with pillow python tools/contact_sheet.py
输出：
    D:\\Jiayi\\Projects\\hermes-pet\\docs\\_sprite-sheet-check.png
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "data" / "sprites" / "oneko.gif"
OUT = ROOT / "docs" / "_sprite-sheet-check.png"

CELL = 32
ZOOM = 4
PAD = 26
COLS = 8
CHECKER = ((46, 52, 64), (30, 34, 42))


def main() -> None:
    sheet = Image.open(SHEET).convert("RGBA")
    w, h = sheet.size
    cols, rows = w // CELL, h // CELL
    cw, ch = cols * CELL * ZOOM, rows * CELL * ZOOM
    out = Image.new("RGB", (PAD + cw, PAD + ch + 18), (18, 20, 26))
    d = ImageDraw.Draw(out)

    for r in range(rows):
        for c in range(cols):
            tile = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
            tile = tile.resize((CELL * ZOOM, CELL * ZOOM), Image.NEAREST)
            bg = Image.new("RGB", tile.size, CHECKER[(r + c) % 2])
            bg.paste(tile, (0, 0), tile)
            out.paste(bg, (PAD + c * CELL * ZOOM, PAD + r * CELL * ZOOM))

    for c in range(cols):
        d.text((PAD + c * CELL * ZOOM + 2, 8), f"col{c}", fill=(236, 201, 75))
    for r in range(rows):
        d.text((2, PAD + r * CELL * ZOOM + 4), f"row{r}", fill=(236, 201, 75))
    d.text((PAD, PAD + ch + 2), f"oneko.gif {w}x{h}  ->  {cols} cols x {rows} rows of {CELL}x{CELL}",
           fill=(220, 225, 235))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    print(f"wrote {OUT} ({out.size[0]}x{out.size[1]}) cols={cols} rows={rows}")


if __name__ == "__main__":
    main()
