"""Генератор іконок hakari.

Малює енсо  — незамкнене коло тушшю на небіленому папері.
Рендеримо в 4× і зменшуємо з LANCZOS: PIL не вміє згладжувати дуги,
тож антиаліасинг доводиться робити руками.

    python tools/make_icons.py
"""

from pathlib import Path
from PIL import Image, ImageDraw

KINARI = (244, 241, 234)   # папір
SUMI = (26, 26, 24)        # туш

SS = 4                     # супersampling
OUT = Path(__file__).resolve().parent.parent / "icons"

# Розрив кола: енсо ніколи не домальовують до кінця.
ARC_START, ARC_END = 22, 330


def make(size: int, inset: float, stroke: float) -> Image.Image:
    s = size * SS
    img = Image.new("RGB", (s, s), KINARI)
    d = ImageDraw.Draw(img)

    m = s * inset
    w = max(1, round(s * stroke))
    d.arc([m, m, s - m, s - m], ARC_START, ARC_END, fill=SUMI, width=w)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # звичайні іконки — енсо на весь простір
    for size in (180, 192, 512):
        make(size, inset=0.20, stroke=0.045).save(OUT / f"icon-{size}.png")
        print(f"icons/icon-{size}.png")

    # maskable: система може обрізати іконку до кола, тож тримаємо
    # малюнок усередині безпечної зони (центральні 80%)
    make(512, inset=0.30, stroke=0.038).save(OUT / "icon-maskable-512.png")
    print("icons/icon-maskable-512.png")


if __name__ == "__main__":
    main()
