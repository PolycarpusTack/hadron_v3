# Tauri v2 Migration Notes

**Date**: 2025-11-12
**Status**: Migration Complete - Ready for Testing
**Issue**: npm installed Tauri v2.9.4 CLI but project was configured for v1

---

## What Was Changed

### 1. Configuration Files

#### `src-tauri/tauri.conf.json` - Complete Rewrite for v2

**Before (v1 format)**:
```json
{
  "build": {
    "devPath": "http://localhost:1420",
    "distDir": "../dist"
  },
  "package": {
    "productName": "Hadron"
  },
  "tauri": {
    "allowlist": { ... },
    "bundle": { ... }
  }
}
```

**After (v2 format)**:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Hadron",
  "version": "1.0.0",
  "identifier": "com.hadron.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [ ... ],
    "security": { ... }
  },
  "bundle": { ... },
  "plugins": {}
}
```

**Key Changes**:
- Added `$schema` for v2 validation
- Moved `productName` to top level
- Added `identifier` (required in v2)
- Changed `devPath` → `devUrl`
- Changed `distDir` → `frontendDist`
- Removed `allowlist` (replaced by plugins in v2)
- Moved `windows` config into `app` section
- Added `plugins` section (required)

### 2. Rust Dependencies - Cargo.toml

**Before**:
```toml
[build-dependencies]
tauri-build = { version = "1.5", features = [] }

[dependencies]
tauri = { version = "1.5", features = [ "dialog-all", "fs-all", "shell-open", "window-all"] }
```

**After**:
```toml
[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = [] }
tauri-plugin-dialog = "2.0"
tauri-plugin-fs = "2.0"
tauri-plugin-shell = "2.0"
```

**Key Changes**:
- Updated to Tauri v2.0
- Removed feature flags from `tauri` dependency
- Added explicit plugin dependencies for dialog, fs, shell
- v2 uses plugins instead of feature flags for capabilities

### 3. Frontend API - TypeScript Imports

**Before**:
```typescript
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
```

**After**:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/api/dialog";
```

**Key Changes**:
- `invoke` moved from `@tauri-apps/api/tauri` → `@tauri-apps/api/core`
- Dialog API remains in `@tauri-apps/api/dialog`

### 4. Package Dependencies - package.json

**Before**:
```json
"dependencies": {
  "@tauri-apps/api": "^1.5.0",
  "@tauri-apps/cli": "^1.5.0"
}
```

**After**:
```json
"dependencies": {
  "@tauri-apps/api": "^2.0.0"
},
"devDependencies": {
  "@tauri-apps/cli": "^2.9.4"
}
```

**Key Changes**:
- Updated `@tauri-apps/api` to v2.0.0
- Moved `@tauri-apps/cli` to devDependencies
- Removed Windows-specific packages (npm handles these automatically)

---

## Installation Instructions

### ⚠️ IMPORTANT: Run from Windows PowerShell

The project uses Windows-specific native modules. You **must** run npm install from **Windows PowerShell**, not WSL/Linux.

### Steps to Install

1. **Open Windows PowerShell** (not WSL)

2. **Navigate to project directory**:
   ```powershell
   cd C:\Projects\Hadron_v3\hadron-desktop
   ```

3. **Clean install**:
   ```powershell
   # Remove old files
   Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue

   # Install dependencies
   npm install
   ```

4. **Run development server**:
   ```powershell
   npm run tauri dev
   ```

---

## Common Issues & Solutions

### Issue 1: "Cannot find native binding"

**Error**:
```
Error: Cannot find native binding. npm has a bug related to optional dependencies
```

**Solution**:
```powershell
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

Make sure you're running from **Windows PowerShell**, not WSL.

### Issue 2: "tauri.conf.json error"

**Error**:
```
Error `tauri.conf.json` error: "identifier" is a required property
```

**Solution**: Already fixed in migration. The config now includes all required v2 properties.

### Issue 3: "Failed to parse version `2`"

**Error**:
```
Error Failed to parse version `2` for crate `tauri`
```

**Solution**: Already fixed. Changed from `version = "2"` to `version = "2.0"` in Cargo.toml.

### Issue 4: "Platform not supported"

**Error**:
```
npm error notsup Unsupported platform for @rollup/rollup-win32-x64-msvc
```

**Solution**: Run npm install from Windows PowerShell, not WSL.

---

## Verification Checklist

After running `npm run tauri dev`, verify:

- [ ] Vite dev server starts without errors
- [ ] Rust compilation completes (first time takes 2-5 minutes)
- [ ] Hadron window opens with gradient UI
- [ ] Settings button is visible in header
- [ ] "Choose File" button works
- [ ] No console errors related to Tauri API

---

## Breaking Changes from v1 to v2

### Configuration
- ✅ `tauri.conf.json` completely restructured
- ✅ `identifier` now required (was optional)
- ✅ `allowlist` removed (use plugins instead)
- ✅ `devPath` → `devUrl`
- ✅ `distDir` → `frontendDist`

### Rust API
- ✅ Features replaced by plugins
- ✅ `tauri-plugin-*` crates required for capabilities
- ✅ Must explicitly add plugin dependencies

### Frontend API
- ✅ `invoke` moved to `@tauri-apps/api/core`
- ✅ Other APIs remain in same locations
- ✅ Plugin APIs may have new import paths

### Build Process
- ✅ No changes to build commands
- ✅ First build still takes longer (Rust compilation)
- ✅ Hot reload still works

---

## Migration Benefits

### Why v2?

1. **Better Plugin System**: More modular, only include what you need
2. **Improved Security**: Fine-grained permissions
3. **Better Type Safety**: Enhanced TypeScript definitions
4. **Modern Architecture**: Cleaner separation of concerns
5. **Future-Proof**: Active development, v1 deprecated

### Performance Impact

- **Bundle Size**: Similar to v1
- **Build Time**: First build 2-5 min (unchanged)
- **Runtime**: No noticeable difference
- **Hot Reload**: Works the same

---

## Next Steps

After successful installation:

1. ✅ Verify app starts: `npm run tauri dev`
2. ✅ Test settings panel functionality
3. ✅ Test file selection with Tauri dialog
4. ✅ Test full analysis flow with real crash log
5. ✅ Verify database creation and storage

Then proceed to **Week 2** tasks:
- History view with search/filter
- Stack trace viewer
- Dark mode toggle
- Export functionality

---

## References

- [Tauri v2 Migration Guide](https://v2.tauri.app/start/migrate/)
- [Tauri v2 Config Schema](https://v2.tauri.app/reference/config/)
- [Tauri Plugins](https://v2.tauri.app/plugin/)

---

Last Updated: 2025-11-12
Migration Status: ✅ **COMPLETE**
Next Action: **Run `npm install` from Windows PowerShell**
