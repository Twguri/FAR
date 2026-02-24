from __future__ import annotations
import os
from pathlib import Path
from PIL import Image

# 输入：你现有的 tif 图片目录
IN_DIR = Path("public/patterns")

# 输出：新建一个文件夹，不覆盖原文件
OUT_DIR = Path("public/patterns_png")

# 是否跳过已存在的输出文件
SKIP_EXISTING = True

def convert_one(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)

    # Pillow 读取 TIFF，保存为 PNG
    with Image.open(src) as im:
        # 有些 TIFF 是 P mode / 带 alpha / 或多页
        # 这里只取第一页（最常见），并转成 RGB 以避免保存报错
        try:
            im.seek(0)
        except Exception:
            pass

        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")

        im.save(dst, format="PNG", optimize=True)

def main():
    if not IN_DIR.exists():
        raise SystemExit(f"[ERROR] Input dir not found: {IN_DIR.resolve()}")

    count_total = 0
    count_done = 0
    count_skipped = 0
    count_failed = 0

    for src in IN_DIR.rglob("*"):
        if not src.is_file():
            continue
        if src.suffix.lower() not in (".tif", ".tiff"):
            continue

        count_total += 1

        # 保持子目录结构：public/patterns/... -> public/patterns_png/...
        rel = src.relative_to(IN_DIR)
        dst = OUT_DIR / rel.with_suffix(".png")

        if SKIP_EXISTING and dst.exists():
            count_skipped += 1
            continue

        try:
            convert_one(src, dst)
            count_done += 1
        except Exception as e:
            count_failed += 1
            print(f"[FAIL] {src} -> {dst} | {e}")

    print("=== TIFF -> PNG Done ===")
    print(f"Input dir : {IN_DIR.resolve()}")
    print(f"Output dir: {OUT_DIR.resolve()}")
    print(f"Total TIFF: {count_total}")
    print(f"Converted : {count_done}")
    print(f"Skipped   : {count_skipped}")
    print(f"Failed    : {count_failed}")

if __name__ == "__main__":
    main()