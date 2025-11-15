# Tauri Icons

Placeholder icons for development.

For production, generate proper icons using:
```bash
npm install --save-dev @tauri-apps/cli
npm run tauri icon path/to/icon.png
```

This will generate all required icon sizes:
- 32x32.png
- 128x128.png
- 128x128@2x.png
- icon.icns (macOS)
- icon.ico (Windows)

For now, Tauri will use default icons during development.
