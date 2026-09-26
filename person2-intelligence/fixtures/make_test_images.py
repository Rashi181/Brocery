"""Draw fake product packages with readable labels, so you can test Muse Spark
vision tonight without a real shelf. Swap in real phone photos once the team
buys the demo products (better test, same filenames).

    python fixtures/make_test_images.py   ->  fixtures/images/*.jpg
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "images"

PRODUCTS = {
    "oat_milk_sweetened": ("#f2e6c9", ["PLANET OAT", "Oat Milk", "ORIGINAL", "Sweetened", "$4.29"]),
    "oat_milk_unsweetened": ("#dfe9f5", ["OATLY", "Oat Milk", "UNSWEETENED", "0g sugar", "$4.79"]),
    "almond_milk": ("#e8f0dc", ["SILK", "Almond Milk", "Unsweetened", "$3.99"]),
    "pasta_whole_wheat": ("#c9a36b", ["BARILLA", "WHOLE WHEAT", "Penne", "$2.19"]),
    "pasta_regular": ("#2d5aa6", ["BARILLA", "Rigatoni", "Classic Blue Box", "$1.99"]),
    "eggs_caged": ("#f7f4ee", ["VALUE FARMS", "12 Large Eggs", "Grade A", "$3.49"]),
    "eggs_pasture": ("#e6d8b8", ["VITAL FARMS", "Pasture-Raised", "12 Large Eggs", "$6.99"]),
}


def font(size: int):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/Library/Fonts/Arial Bold.ttf",
              "C:/Windows/Fonts/arialbd.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size=size)


def carton(bg: str, lines: list[str], w=420, h=620) -> Image.Image:
    img = Image.new("RGB", (w, h), "#777")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([30, 30, w - 30, h - 30], radius=24, fill=bg, outline="#222", width=4)
    y = 90
    for i, text in enumerate(lines):
        f = font(46 if i == 0 else 34)
        tw = d.textlength(text, font=f)
        colour = "#b00020" if text.startswith("$") else "#111"
        d.text(((w - tw) / 2, y), text, fill=colour, font=f)
        y += 90
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    tiles = []
    for name, (bg, lines) in PRODUCTS.items():
        img = carton(bg, lines)
        img.save(OUT / f"{name}.jpg", quality=85)
        tiles.append(img)
    # a "shelf" with the three milks side by side
    shelf = Image.new("RGB", (420 * 3 + 40, 660), "#5b4636")
    for i, name in enumerate(["oat_milk_sweetened", "oat_milk_unsweetened", "almond_milk"]):
        shelf.paste(Image.open(OUT / f"{name}.jpg"), (10 + i * 430, 20))
    shelf.save(OUT / "shelf_milk.jpg", quality=85)
    print(f"wrote {len(PRODUCTS) + 1} images to {OUT}")


if __name__ == "__main__":
    main()
