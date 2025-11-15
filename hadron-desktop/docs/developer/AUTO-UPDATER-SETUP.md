# Auto-Updater Setup Guide

**Phase 6 - Quality & Distribution**

This document explains how to configure and deploy the auto-updater for Hadron Desktop.

---

## Overview

Hadron uses **tauri-plugin-updater** for automatic software updates:

- **Update Check**: On app startup + manual check in Settings
- **Distribution**: GitHub Releases (recommended)
- **Dialog**: Built-in Tauri update UI
- **Installation**: Automatic download and install (user confirmation required)

---

## Configuration

### 1. Tauri Configuration

The updater is configured in `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/hadron-team/hadron-desktop/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "pubkey": "",
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

**Configuration Options:**

- `active`: Enable/disable auto-updater
- `endpoints`: Array of URLs to check for updates
- `dialog`: Show built-in update dialog (recommended: `true`)
- `pubkey`: Public key for signature verification (required for production)
- `windows.installMode`: `"passive"` (silent) or `"basicUi"` (interactive)

### 2. Frontend Integration

Update checking is integrated in two places:

**Settings Panel** (`src/components/SettingsPanel.tsx`):
- Manual "Check for Updates" button
- Displays current version and update status

**Update Service** (`src/services/updater.ts`):
- `checkForUpdates()` - Check for available updates
- `downloadAndInstall()` - Download and install update
- `restartApp()` - Restart after update
- `checkAndUpdate()` - Convenience function (shows Tauri dialog automatically)

---

## GitHub Releases Setup

### Step 1: Create a Release

1. Build your application:
   ```bash
   npm run tauri build
   ```

2. Create a GitHub release:
   - Go to: `https://github.com/hadron-team/hadron-desktop/releases/new`
   - Tag version: `v1.0.0` (must start with `v`)
   - Release title: `Hadron v1.0.0`
   - Upload build artifacts from `src-tauri/target/release/bundle/`

3. Attach the following files to the release:
   - **Windows**: `hadron-desktop_1.0.0_x64_en-US.msi` + `.sig` file
   - **macOS**: `hadron-desktop_1.0.0_x64.dmg` + `.sig` file (or `.app.tar.gz` for Apple Silicon)
   - **Linux**: `hadron-desktop_1.0.0_amd64.deb` + `.sig` file

### Step 2: Create `latest.json`

The `latest.json` file tells the updater about available versions.

**Example `latest.json`:**

```json
{
  "version": "1.0.1",
  "notes": "- Bug fixes\n- Performance improvements\n- New feature: Auto-updater",
  "pub_date": "2025-11-13T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUV1p...",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.1/hadron-desktop_1.0.1_x64_en-US.msi"
    },
    "darwin-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUV1p...",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.1/hadron-desktop_1.0.1_x64.dmg"
    },
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUV1p...",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.1/hadron-desktop_1.0.1_aarch64.dmg"
    },
    "linux-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUV1p...",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.1/hadron-desktop_1.0.1_amd64.deb"
    }
  }
}
```

**Fields:**

- `version`: New version number (without `v` prefix)
- `notes`: Release notes (supports Markdown)
- `pub_date`: Publication date (ISO 8601 format)
- `platforms`: Platform-specific download URLs and signatures

**Upload `latest.json`:**

Attach `latest.json` to the **same release** as the installers.

---

## Code Signing (Production Required)

### Why Code Signing?

- **Security**: Prevents tampering with updates
- **Trust**: Verifies updates come from the official source
- **Required**: macOS and Windows installers must be signed for distribution

### Generate Signing Keys

1. **Generate keypair** (run once):
   ```bash
   # Install Tauri CLI if not already installed
   cargo install tauri-cli

   # Generate signing keypair
   npm run tauri signer generate -- -w ~/.tauri/hadron.key
   ```

   This creates:
   - **Private key**: `~/.tauri/hadron.key` (keep secret!)
   - **Public key**: Printed to console (copy to `tauri.conf.json`)

2. **Update `tauri.conf.json`** with the public key:
   ```json
   {
     "plugins": {
       "updater": {
         "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhEQUFFOThFQkMyOENBNjkKUldSV1pOa..."
       }
     }
   }
   ```

3. **Sign the installer** (during build):
   ```bash
   # Set environment variable with private key path
   export TAURI_PRIVATE_KEY="$(cat ~/.tauri/hadron.key)"
   export TAURI_KEY_PASSWORD=""  # If you set a password

   # Build with signing
   npm run tauri build
   ```

   This generates `.sig` files alongside installers.

4. **Extract signatures** for `latest.json`:
   ```bash
   # Windows
   cat src-tauri/target/release/bundle/msi/hadron-desktop_1.0.0_x64_en-US.msi.sig

   # macOS
   cat src-tauri/target/release/bundle/dmg/hadron-desktop_1.0.0_x64.dmg.sig

   # Linux
   cat src-tauri/target/release/bundle/deb/hadron-desktop_1.0.0_amd64.deb.sig
   ```

   Copy these signatures into the `latest.json` file.

---

## Testing Updates Locally

### 1. Local HTTP Server

For testing, serve `latest.json` from a local server:

```bash
# In src-tauri/target/release/bundle/
python3 -m http.server 8000
```

### 2. Update `tauri.conf.json` Endpoint

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "http://localhost:8000/latest.json"
      ]
    }
  }
}
```

### 3. Test Update Flow

1. Build v1.0.0 and install it
2. Build v1.0.1 with new features
3. Create `latest.json` pointing to v1.0.1
4. Run v1.0.0 app → should detect update

---

## CI/CD Automation (Recommended)

Automate releases with GitHub Actions:

**`.github/workflows/release.yml`:**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    strategy:
      matrix:
        platform: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable

      - name: Install dependencies
        run: npm install

      - name: Build app
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
        run: npm run tauri build

      - name: Upload Release Assets
        uses: softprops/action-gh-release@v1
        with:
          files: src-tauri/target/release/bundle/**/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Setup:**

1. Add secrets to GitHub repo:
   - `TAURI_PRIVATE_KEY`: Contents of `~/.tauri/hadron.key`
   - `TAURI_KEY_PASSWORD`: Password (if set)

2. Push a tag to trigger release:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. GitHub Actions will:
   - Build for all platforms
   - Sign installers
   - Create GitHub release
   - Upload signed artifacts

---

## Update Flow

### User Experience

1. **App Startup**: Automatic update check (silent)
2. **Update Available**: Tauri shows dialog:
   - "A new version is available: v1.0.1"
   - Release notes
   - "Install Now" / "Later" buttons
3. **Download**: Progress bar
4. **Installation**: Automatic (Windows: passive mode)
5. **Restart**: User prompted to restart

### Manual Check (Settings Panel)

1. User clicks "Check for Updates" in Settings
2. Shows status message:
   - "✨ Update available: v1.0.1"
   - "✅ You're running the latest version!"
   - "❌ Failed to check for updates"
3. Tauri dialog shown if update available

---

## Troubleshooting

### "Update check failed"

**Causes:**
- No internet connection
- GitHub endpoint unreachable
- Invalid `latest.json` format

**Fix:**
- Check network connectivity
- Verify `endpoints` URL in `tauri.conf.json`
- Validate `latest.json` syntax

### "Signature verification failed"

**Causes:**
- Public key mismatch in `tauri.conf.json`
- `.sig` file not uploaded to release
- Private key changed since last release

**Fix:**
- Ensure `pubkey` in config matches signing keypair
- Upload `.sig` files with installers
- Use the same private key for all releases

### "No update dialog shown"

**Causes:**
- `dialog: false` in config
- Update check returned no results
- Current version >= latest version

**Fix:**
- Set `dialog: true` in `tauri.conf.json`
- Verify version numbers (v1.0.0 < v1.0.1)
- Check `latest.json` content

---

## Platform-Specific Notes

### Windows

- **Install Mode**: `"passive"` (silent) recommended
- **Installer Format**: `.msi` (preferred) or `.exe`
- **Permissions**: May require admin for installation

### macOS

- **Code Signing**: Required for distribution (Apple Developer cert)
- **Notarization**: Required for Gatekeeper (submit to Apple)
- **Installer Format**: `.dmg` or `.app.tar.gz`

### Linux

- **Installer Format**: `.deb` (Debian/Ubuntu) or `.AppImage`
- **Permissions**: May require `sudo` for `.deb` installation
- **Auto-Update**: Works best with `.AppImage` (no admin required)

---

## Security Best Practices

1. **Never commit private keys** to version control
2. **Use GitHub secrets** for CI/CD signing
3. **Always sign production builds** (code integrity)
4. **Use HTTPS endpoints** for update checks
5. **Rotate signing keys** if compromised

---

## Development vs. Production

### Development

- **Endpoint**: Local HTTP server or staging URL
- **Signing**: Optional (faster builds)
- **Testing**: Manual update flow verification

### Production

- **Endpoint**: GitHub Releases (official releases)
- **Signing**: **Required** (security + trust)
- **Testing**: Full CI/CD pipeline validation

---

## Quick Reference

### Build Commands

```bash
# Development build (unsigned)
npm run tauri build

# Production build (signed)
export TAURI_PRIVATE_KEY="$(cat ~/.tauri/hadron.key)"
npm run tauri build

# Generate signing keys (once)
npm run tauri signer generate -- -w ~/.tauri/hadron.key
```

### Version Bump Checklist

1. Update `version` in `package.json`
2. Update `version` in `src-tauri/Cargo.toml`
3. Update `version` in `src-tauri/tauri.conf.json`
4. Build and sign installers
5. Create GitHub release with tag `v1.0.1`
6. Upload installers + `.sig` files
7. Create and upload `latest.json`

---

## Resources

- [Tauri Updater Plugin Docs](https://v2.tauri.app/plugin/updater/)
- [Code Signing Guide](https://v2.tauri.app/distribute/sign/)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github)

---

**Status**: ✅ Auto-updater configured and ready for production

**Next Steps**: Set up code signing and GitHub Actions workflow for automated releases
