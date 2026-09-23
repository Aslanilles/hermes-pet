"""分析 oneko 精灵表的每一格：不透明像素占比 + ASCII 预览，用于确定状态→帧映射。

用法：
    uv run --with pillow python tools/analyze_sprites.py
输出：
    D:\\Jiayi\\Projects\\hermes-pet\\docs\\_sprite-tiles.txt
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "data" / "sprites" / "oneko.gif"
OUT = ROOT / "docs" / "_sprite-tiles.txt"
CELL = 32
RAMP = " .:-=+*#%@"


def tile_ascii(tile: Image.Image, w: int = 22, h: int = 11) -> list[str]:
    small = tile.resize((w, h))
    rows = []
    for y in range(h):
        line = ""
        for x in range(w):
            r, g, b, a = small.getpixel((x, y))
            if a < 60:
                line += " "
            else:
                lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
                line += RAMP[min(len(RAMP) - 1, int(lum * (len(RAMP) - 1)))]
        rows.append(line)
    return rows


def main() -> None:
    sheet = Image.open(SHEET).convert("RGBA")
    cols, rows = sheet.size[0] // CELL, sheet.size[1] // CELL
    lines: list[str] = []
    lines.append(f"sheet={sheet.size[0]}x{sheet.size[1]} cols={cols} rows={rows} cell={CELL}x{CELL}")
    lines.append("")

    counts: dict[tuple[int, int], float] = {}
    for r in range(rows):
        for c in range(cols):
            tile = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
            alpha = tile.getchannel("A")
            opaque = sum(1 for v in alpha.getdata() if v > 60)
            counts[(r, c)] = opaque / (CELL * CELL)

    lines.append("不透明像素占比矩阵 (row x col):")
    header = "      " + "".join(f"col{c:<6}" for c in range(cols))
    lines.append(header)
    for r in range(rows):
        line = f"row{r}  "
        for c in range(cols):
            line += f"{counts[(r, c)] * 100:5.1f}% "
        lines.append(line)
    lines.append("")

    for r in range(rows):
        for c in range(cols):
            if counts[(r, c)] == 0:
                continue
            tile = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
            lines.append(f"--- row{r} col{c}  opaque={counts[(r, c)] * 100:.0f}% ---")
            lines.extend(tile_ascii(tile))
            lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:14]))
    print(f"... wrote {OUT}")


if __name__ == "__main__":
    main()
