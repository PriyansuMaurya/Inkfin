"""Generate the Inkfin icon set.

Resizes the source artwork (tools/assets/inkfin-icon.png) to every size the
Tauri bundler expects, plus a multi-resolution .ico for the Windows executable
and NSIS installer.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "assets" / "inkfin-icon.png"
OUT = ROOT / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"source icon not found: {SOURCE}")

    master = Image.open(SOURCE).convert("RGBA")

    master.resize((1024, 1024), Image.LANCZOS).save(OUT / "icon.png")
    master.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")
    master.resize((256, 256), Image.LANCZOS).save(OUT / "128x128@2x.png")
    master.resize((128, 128), Image.LANCZOS).save(OUT / "128x128.png")
    master.resize((64, 64), Image.LANCZOS).save(OUT / "64x64.png")
    master.resize((32, 32), Image.LANCZOS).save(OUT / "32x32.png")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.resize((256, 256), Image.LANCZOS).save(
        OUT / "icon.ico", format="ICO", sizes=ico_sizes
    )
    # Tauri's Windows bundler also looks for icon.icns only on macOS, which is
    # out of scope for this MVP.

    print("generated:")
    for path in sorted(OUT.iterdir()):
        print("  ", path.name, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
