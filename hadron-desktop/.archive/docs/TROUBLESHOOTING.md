# Hadron Desktop - Troubleshooting Guide

**Last Updated**: 2025-11-12

---

## Quick Fixes

### 🔴 Error: "Cannot find native binding"

**Symptom**:
```
Error: Cannot find native binding. npm has a bug related to optional dependencies
```

**Cause**: npm has issues with optional dependencies on Windows

**Fix**:
```powershell
# In Windows PowerShell (not WSL):
cd C:\Projects\Hadron_v3\hadron-desktop
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install
```

**Important**: Must run from **Windows PowerShell**, not WSL or Git Bash.

---

### 🔴 Error: "Platform not supported"

**Symptom**:
```
npm error notsup Unsupported platform for @rollup/rollup-win32-x64-msvc
npm error notsup Valid os: win32
npm error notsup Actual os: linux
```

**Cause**: Running npm install from WSL/Linux instead of Windows

**Fix**: Run all npm commands from **Windows PowerShell**:
```powershell
cd C:\Projects\Hadron_v3\hadron-desktop
npm install
```

---

### 🔴 Error: "tauri.conf.json error"

**Symptom**:
```
Error `tauri.conf.json` error: "identifier" is a required property
Error `tauri.conf.json` error on `build`: Additional properties are not allowed
```

**Cause**: Configuration file was for Tauri v1, but v2 was installed

**Fix**: Already fixed! The project now uses Tauri v2 configuration. See `TAURI-V2-MIGRATION.md`.

---

### 🔴 Error: "Failed to parse version"

**Symptom**:
```
Error Failed to parse version `2` for crate `tauri`
```

**Cause**: Invalid semantic versioning in Cargo.toml

**Fix**: Already fixed! Changed `version = "2"` to `version = "2.0"`.

---

### 🟡 Warning: Icon files missing

**Symptom**:
```
warning: icon files not found
```

**Impact**: Low - only affects production builds

**Fix**: Generate icons for production:
```powershell
npm install --save-dev @tauri-apps/cli
npm run tauri icon path/to/icon.png
```

**For Development**: Can safely ignore this warning.

---

### 🟡 Warning: npm audit vulnerabilities

**Symptom**:
```
5 moderate severity vulnerabilities
```

**Impact**: Low - vulnerabilities are in dev dependencies

**Fix** (optional):
```powershell
npm audit fix
```

**For Development**: Can safely ignore.

---

## Environment Issues

### Python Not Found

**Symptom**:
```
Error: Failed to run Python: No such file or directory
```

**Fix**:
1. Install Python 3.10+ from https://python.org
2. Add Python to PATH
3. Verify: `python --version` or `python3 --version`
4. Install requirements:
   ```powershell
   cd python
   pip install -r requirements.txt
   ```

---

### Rust Not Found

**Symptom**:
```
error: failed to run custom build command for `tauri`
```

**Fix**:
1. Install Rust from https://rustup.rs
2. Restart terminal
3. Verify: `rustc --version`

---

### Node.js Version Issues

**Symptom**:
```
error: Unsupported engine
```

**Requirements**: Node.js v18+

**Fix**:
1. Check version: `node --version`
2. If < v18, download from https://nodejs.org
3. Install latest LTS version
4. Restart terminal

---

## Build Issues

### First Build Takes Forever

**Symptom**: `npm run tauri dev` runs for 2-5 minutes

**Cause**: Normal - Rust compiling dependencies for first time

**Not a Problem**: Subsequent builds take ~10 seconds

---

### Vite Build Errors

**Symptom**:
```
Error: Could not resolve entry module
```

**Fix**:
```powershell
# Clean build
Remove-Item -Recurse -Force dist, node_modules
npm install
npm run tauri dev
```

---

### Cargo Build Errors

**Symptom**:
```
error: could not compile `hadron-desktop`
```

**Fix**:
```powershell
# Clean Rust build
cd src-tauri
cargo clean
cd ..
npm run tauri dev
```

---

## Runtime Issues

### Window Doesn't Open

**Checklist**:
1. Did Vite dev server start? (Look for `http://localhost:1420`)
2. Did Rust compilation finish? (Look for "Finished dev")
3. Any errors in terminal?
4. Try: Ctrl+C, then `npm run tauri dev` again

---

### API Key Not Persisting

**Symptom**: API key disappears after restart

**Cause**: localStorage being cleared

**Fix**:
1. Open Settings panel
2. Enter API key
3. Click "Save Settings"
4. Check browser DevTools console for errors

---

### File Selection Not Working

**Symptom**: Clicking "Choose File" does nothing

**Possible Causes**:
1. Tauri dialog plugin not loaded
2. Permissions issue
3. JavaScript error

**Fix**:
1. Check browser console (Ctrl+Shift+I) for errors
2. Verify `tauri-plugin-dialog` in `Cargo.toml`
3. Restart dev server

---

### Database Not Created

**Symptom**: No analyses saved

**Expected Location**:
- Windows: `%APPDATA%\hadron\analyses.db`
- macOS: `~/Library/Application Support/hadron/analyses.db`
- Linux: `~/.local/share/hadron/analyses.db`

**Fix**:
1. Check if directory exists
2. Check file permissions
3. Look for Rust errors in terminal

---

## Development Workflow

### Hot Reload Not Working

**For React Changes**:
- Should reload instantly
- If not, check Vite console for errors

**For Rust Changes**:
- Requires ~10s rebuild
- Look for "Finished dev" in console

**For Python Changes**:
- Restart window: Ctrl+R in Tauri window
- Or restart dev server

---

### DevTools Not Opening

**Fix**: In Tauri window, press `Ctrl+Shift+I` or `F12`

---

## Testing Issues

### Can't Analyze Files

**Checklist**:
1. ✅ API key set in Settings?
2. ✅ File is .txt or .log?
3. ✅ File size < 5MB?
4. ✅ Internet connection working?
5. ✅ OpenAI API key valid?

**Common Errors**:
- "API key required" → Set in Settings
- "Invalid API key" → Check key format (starts with `sk-`)
- "File too large" → Reduce max file size in Settings
- "Network error" → Check internet connection

---

### Analysis Takes Too Long

**Expected Times**:
- Small files (<100KB): 5-10 seconds
- Medium files (100-500KB): 10-30 seconds
- Large files (500KB-2MB): 30-60 seconds

**If Taking Longer**:
1. Check OpenAI API status
2. Check network connection
3. Try smaller file first
4. Check Python console for errors

---

## Getting Help

### Before Reporting Issues

Collect this information:

1. **Environment**:
   ```powershell
   node --version
   npm --version
   rustc --version
   python --version
   ```

2. **Error Output**:
   - Full terminal output
   - Browser console errors (Ctrl+Shift+I)
   - Screenshots if UI issue

3. **Steps to Reproduce**:
   - What did you do?
   - What did you expect?
   - What actually happened?

### Documentation

- `GETTING-STARTED.md` - Detailed setup guide
- `QUICK-START.md` - 5-minute quickstart
- `TAURI-V2-MIGRATION.md` - Migration notes
- `PHASE-1-COMPLETE.md` - Feature overview
- `FINAL-CHECKLIST.md` - Implementation checklist

### External Resources

- Tauri Docs: https://v2.tauri.app
- Vite Docs: https://vitejs.dev
- React Docs: https://react.dev
- Rust Docs: https://doc.rust-lang.org

---

## Clean Slate Reset

If all else fails, start fresh:

```powershell
# Navigate to project
cd C:\Projects\Hadron_v3\hadron-desktop

# Remove all generated files
Remove-Item -Recurse -Force node_modules, package-lock.json, dist
cd src-tauri
cargo clean
cd ..

# Reinstall
npm install

# Run
npm run tauri dev
```

**Expected**: 2-5 minute first build, then window opens.

---

**Status**: Updated for Tauri v2
**Platform**: Windows 10/11
**Node**: v18+
**Rust**: Latest stable
