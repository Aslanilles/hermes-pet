"""hermes-pet 素材工具：检查 oneko 精灵表 + 生成应用/托盘图标。

用法（宿主或容器内均可，需要 pillow）：
    uv run --with pillow python tools/make_icons.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
SPRITES.mkdir(parents=True, exist_ok=True)

# 设计文档 4.2 主色板
DEEP_BLUE = (45, 55, 72)      # #2D3748 深空蓝
STAR_GOLD = (236, 201, 75)    # #ECC94B 星光金
NIGHT_BLUE = (26, 32, 44)     # #1A202C 夜间主色


def describe_gif(path: Path) -> dict:
    """读出 GIF 的帧尺寸/帧数/帧时长，供实现方确定精灵表布局。"""
    im = Image.open(path)
    frames = []
    try:
        i = 0
        while True:
            im.seek(i)
            frames.append(im.info.get("duration", 0))
            i += 1
    except EOFError:
        pass
    return {
        "file": path.name,
        "sheet_size": list(Image.open(path).size),
        "frame_size": list(im.size),
        "frame_count": len(frames),
        "durations_ms": frames,
        "note": "frame_size 即单帧尺寸；帧按 GIF 逐帧播放，可用 canvas drawImage 按索引取帧",
    }


def draw_cat(size: int, bg: str | None = None, eye_color=STAR_GOLD, body=DEEP_BLUE) -> Image.Image:
    """画一只几何化的猫头（透明背景），呼应设计文档 4.7 角色形态建议。"""
    scale = size / 256.0
    img = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def s(v: float) -> float:
        return v * scale

    # 耳朵（三角形）
    d.polygon([(s(58), s(96)), (s(78), s(30)), (s(112), s(74))], fill=body)
    d.polygon([(s(198), s(96)), (s(178), s(30)), (s(144), s(74))], fill=body)
    # 内耳（金色）
    d.polygon([(s(72), s(84)), (s(84), s(46)), (s(102), s(74))], fill=eye_color)
    d.polygon([(s(184), s(84)), (s(172), s(46)), (s(154), s(74))], fill=eye_color)
    # 头（圆角方）
    d.rounded_rectangle([s(40), s(70), s(216), s(214)], radius=s(64), fill=body)
    # 眼睛
    d.ellipse([s(88), s(128), s(120), s(164)], fill=eye_color)
    d.ellipse([s(136), s(128), s(168), s(164)], fill=eye_color)
    d.ellipse([s(99), s(138), s(111), s(156)], fill=(20, 24, 33, 255))
    d.ellipse([s(147), s(138), s(159), s(156)], fill=(20, 24, 33, 255))
    # 鼻子 + 嘴
    d.polygon([(s(122), s(172)), (s(134), s(172)), (s(128), s(180))], fill=eye_color)
    d.arc([s(108), s(172), s(128), s(192)], start=0, end=90, fill=eye_color, width=max(2, int(s(5))))
    d.arc([s(128), s(172), s(148), s(192)], start=90, end=180, fill=eye_color, width=max(2, int(s(5))))
    return img


def main() -> None:
    report: dict = {}

    # 1. oneko 精灵表（若已下载）
    for name in ("oneko.gif",):
        p = SPRITES / name
        if p.exists():
            report[name] = describe_gif(p)

    # 2. 应用图标（256 / 128 / 64 / 32）
    for px in (256, 128, 64, 32):
        draw_cat(px).save(SPRITES / f"icon-{px}.png")
    # 3. 托盘图标：小尺寸要更简单才看得清（用金色描边增强对比）
    tray = draw_cat(32)
    d = ImageDraw.Draw(tray)
    d.rounded_rectangle([1, 1, 30, 30], radius=8, outline=STAR_GOLD, width=1)
    tray.save(SPRITES / "tray.png")
    # 4. 夜间版应用图标
    draw_cat(256, body=NIGHT_BLUE).save(SPRITES / "icon-night.png")

    report["generated"] = [p.name for p in sorted(SPRITES.glob("*.png"))]
    out = ROOT / "docs" / "_asset-report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
