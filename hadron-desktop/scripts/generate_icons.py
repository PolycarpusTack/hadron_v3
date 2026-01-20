#!/usr/bin/env python3
"""
Generate app icons from the high-resolution source icon.
Creates all required sizes for Tauri (Windows, macOS, Linux).
"""

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
SOURCE_ICON = PROJECT_DIR / "docs" / "logo" / "HadronV35_Icon.png"
SOURCE_LOGO = PROJECT_DIR / "docs" / "logo" / "HadronV35_Logo.png"
ICONS_DIR = PROJECT_DIR / "src-tauri" / "icons"
PUBLIC_DIR = PROJECT_DIR / "public"

# Icon sizes needed for Tauri
ICON_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,  # For Linux
}

# Additional sizes for Windows ICO
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

def create_high_quality_resize(img: Image.Image, size: int) -> Image.Image:
    """Resize image with high quality using Lanczos resampling."""
    # Convert to RGBA if needed
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Use LANCZOS for high-quality downsampling
    return img.resize((size, size), Image.Resampling.LANCZOS)

def generate_png_icons(source_path: Path, output_dir: Path):
    """Generate PNG icons in all required sizes."""
    print(f"Loading source icon: {source_path}")

    with Image.open(source_path) as img:
        print(f"  Source size: {img.size}, Mode: {img.mode}")

        for filename, size in ICON_SIZES.items():
            output_path = output_dir / filename
            resized = create_high_quality_resize(img, size)
            resized.save(output_path, "PNG", optimize=True)
            print(f"  Created: {filename} ({size}x{size})")

def generate_ico(source_path: Path, output_path: Path):
    """Generate Windows ICO file with multiple sizes."""
    print(f"Generating Windows ICO: {output_path}")

    with Image.open(source_path) as img:
        # For Pillow ICO, we need to save with the target icon directly
        # Create a high-quality 256x256 image and let Pillow generate the ICO
        icon_256 = create_high_quality_resize(img, 256)

        # Save with multiple sizes - Pillow will include requested sizes
        icon_256.save(
            output_path,
            format='ICO',
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        )
        print(f"  Created ICO with sizes: {ICO_SIZES}")

def generate_icns(source_path: Path, output_path: Path):
    """Generate macOS ICNS file."""
    print(f"Generating macOS ICNS: {output_path}")

    # ICNS requires specific sizes
    icns_sizes = [16, 32, 64, 128, 256, 512, 1024]

    with Image.open(source_path) as img:
        # For ICNS, we need to save the largest size and let the system handle it
        # or use a proper ICNS library. For now, save as PNG and note the limitation.
        resized = create_high_quality_resize(img, 512)

        # Try to save as ICNS (may not work on all systems)
        try:
            resized.save(output_path, format='ICNS')
            print(f"  Created ICNS")
        except Exception as e:
            # Fallback: save as PNG and rename
            png_path = output_path.with_suffix('.png')
            resized.save(png_path, "PNG", optimize=True)
            print(f"  Note: ICNS format not supported, saved as PNG: {png_path}")
            print(f"  You may need to convert manually using iconutil on macOS")

def generate_favicon(source_path: Path, output_dir: Path):
    """Generate favicon for web."""
    print(f"Generating favicon...")

    with Image.open(source_path) as img:
        # Generate multiple favicon sizes
        favicon_sizes = [16, 32, 48, 64, 128, 180, 192, 512]

        for size in favicon_sizes:
            resized = create_high_quality_resize(img, size)
            output_path = output_dir / f"favicon-{size}x{size}.png"
            resized.save(output_path, "PNG", optimize=True)
            print(f"  Created: favicon-{size}x{size}.png")

        # Create standard favicon.ico with multiple sizes
        ico_path = output_dir / "favicon.ico"
        favicon_base = create_high_quality_resize(img, 48)
        favicon_base.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
        print(f"  Created: favicon.ico")

        # Create apple-touch-icon
        apple_icon = create_high_quality_resize(img, 180)
        apple_icon.save(output_dir / "apple-touch-icon.png", "PNG", optimize=True)
        print(f"  Created: apple-touch-icon.png")

def copy_logo_for_splash(source_path: Path, output_dir: Path):
    """Copy and optimize logo for splashscreen."""
    print(f"Preparing logo for splashscreen...")

    with Image.open(source_path) as img:
        # Keep high quality but reasonable size for splash
        # Original is probably very large, resize to max 800px width
        max_width = 800
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (int(img.width * ratio), int(img.height * ratio))
            resized = img.resize(new_size, Image.Resampling.LANCZOS)
        else:
            resized = img.copy()

        output_path = output_dir / "logo.png"
        resized.save(output_path, "PNG", optimize=True)
        print(f"  Created: logo.png ({resized.size[0]}x{resized.size[1]})")

def main():
    """Main function to generate all icons."""
    print("=" * 50)
    print("Hadron Icon Generator")
    print("=" * 50)

    # Ensure directories exist
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    # Check source files exist
    if not SOURCE_ICON.exists():
        print(f"ERROR: Source icon not found: {SOURCE_ICON}")
        sys.exit(1)

    print(f"\nSource icon: {SOURCE_ICON}")
    print(f"Icons output: {ICONS_DIR}")
    print(f"Public output: {PUBLIC_DIR}")
    print()

    # Generate Tauri icons
    print("Generating Tauri icons...")
    generate_png_icons(SOURCE_ICON, ICONS_DIR)
    generate_ico(SOURCE_ICON, ICONS_DIR / "icon.ico")
    generate_icns(SOURCE_ICON, ICONS_DIR / "icon.icns")
    print()

    # Generate web favicons
    print("Generating web favicons...")
    generate_favicon(SOURCE_ICON, PUBLIC_DIR)
    print()

    # Copy logo for splash
    if SOURCE_LOGO.exists():
        print("Preparing splashscreen assets...")
        copy_logo_for_splash(SOURCE_LOGO, PUBLIC_DIR)
    else:
        print(f"Note: Logo not found at {SOURCE_LOGO}, skipping splash assets")

    print()
    print("=" * 50)
    print("Icon generation complete!")
    print("=" * 50)

if __name__ == "__main__":
    main()
