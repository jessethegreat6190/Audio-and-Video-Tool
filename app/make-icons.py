"""Generate Android launcher + splash images from the project logo."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
LOGO = ROOT.parent / "assets" / "images" / "logo.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

logo = Image.open(LOGO).convert("RGBA")


def fitted(size, pad=0):
    """Square RGBA logo fitted into size with optional padding."""
    box = size - 2 * pad
    img = logo.copy()
    img.thumbnail((box, box), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


def circular(img):
    """Apply a circular transparent mask."""
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


for density, size in DENSITIES.items():
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = fitted(size)
    icon.save(folder / "ic_launcher.png")
    circular(icon).save(folder / "ic_launcher_round.png")

    # Adaptive foreground: 108dp viewport; keep the logo inside the safe zone.
    fg_size = int(size * 108 / 48)
    fitted(fg_size, pad=int(fg_size * 0.18)).save(folder / "ic_launcher_foreground.png")

# Splash screens: 200dp logo on a dark background, one per density folder.
SPLASH = {
    "drawable-mdpi": 200,
    "drawable-hdpi": 300,
    "drawable-xhdpi": 400,
    "drawable-xxhdpi": 600,
    "drawable-xxxhdpi": 800,
}
for folder_name, size in SPLASH.items():
    folder = RES / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (size, size), (20, 20, 20))
    mark = fitted(size, pad=int(size * 0.2))
    canvas.paste(mark, (0, 0), mark)
    canvas.save(folder / "splash.png")

# Portrait/landscape splash variants reuse the matching density artwork.
for folder in list(RES.glob("drawable-land-*")) + list(RES.glob("drawable-port-*")) + [RES / "drawable"]:
    if not folder.exists():
        continue
    density = folder.name.replace("drawable-land-", "").replace("drawable-port-", "")
    src = RES / (density if density != "drawable" else "drawable") / "splash.png"
    if not src.exists():
        src = RES / "drawable-mdpi" / "splash.png"
    if src.exists():
        Image.open(src).save(folder / "splash.png")

print("Android icons and splash images generated.")
