# Production Code Signing Setup

Complete guide to setting up code signing for production releases of Hadron Desktop.

---

## Why Code Signing?

### **Security**
- **Tamper Protection**: Prevents malicious modification of installers
- **Authenticity**: Verifies updates come from official source
- **Trust**: Users can verify publisher identity

### **Platform Requirements**
- **macOS**: Required for distribution (Gatekeeper enforcement)
- **Windows**: Recommended (SmartScreen trust)
- **Linux**: Optional (AppImage supports signing)

### **Auto-Updater**
- **Signature Verification**: Ensures update integrity
- **Prevents Attacks**: Man-in-the-middle protection
- **Required**: Auto-updater won't work without signatures (if `pubkey` is set)

---

## Local Development Setup

### **Step 1: Generate Signing Keypair**

Run once to create your signing keys:

```bash
# Install Tauri CLI if not already installed
cargo install tauri-cli

# Generate keypair (will prompt for password)
npm run tauri signer generate -- -w ~/.tauri/hadron.key

# Output:
# Your keypair has been generated successfully
# Private key: ~/.tauri/hadron.key (KEEP SECRET!)
# Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1Ymxp...
```

**Important**:
- ⚠️ **Never commit** `~/.tauri/hadron.key` to version control
- ⚠️ **Backup securely** - if lost, can't sign future updates
- ✅ **Use password protection** for extra security

### **Step 2: Update `tauri.conf.json`**

Copy the public key from the output and add to `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/hadron-team/hadron-desktop/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhEQUFFOThFQkMyOENBNjkKUldSV1pOa...",
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### **Step 3: Build Signed Installer**

```bash
# Set environment variables
export TAURI_PRIVATE_KEY="$(cat ~/.tauri/hadron.key)"
export TAURI_KEY_PASSWORD="your-password-if-set"

# Build with signing
npm run tauri build

# Output includes .sig files:
# Windows: hadron-desktop_1.0.0_x64_en-US.msi.sig
# macOS: hadron-desktop_1.0.0_x64.dmg.sig
# Linux: hadron-desktop_1.0.0_amd64.deb.sig
```

**Verify signatures exist**:
```bash
ls -la src-tauri/target/release/bundle/**/*.sig

# Example output:
# -rw-r--r-- 1 user user  228 Nov 13 08:00 hadron-desktop_1.0.0_x64_en-US.msi.sig
```

### **Step 4: Extract Signatures for `latest.json`**

```bash
# Windows signature
cat src-tauri/target/release/bundle/msi/hadron-desktop_1.0.0_x64_en-US.msi.sig

# macOS signature
cat src-tauri/target/release/bundle/dmg/hadron-desktop_1.0.0_x64.dmg.sig

# Linux signature
cat src-tauri/target/release/bundle/deb/hadron-desktop_1.0.0_amd64.deb.sig
```

Copy these signatures into `latest.json`:

```json
{
  "version": "1.0.0",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUV1p...",
      "url": "https://github.com/.../hadron-desktop_1.0.0_x64_en-US.msi"
    }
  }
}
```

---

## CI/CD Setup (GitHub Actions)

For production, use CI/CD to build and sign for all platforms automatically.

### **Step 1: Add Secrets to GitHub**

1. Go to: `https://github.com/hadron-team/hadron-desktop/settings/secrets/actions`
2. Click **New repository secret**
3. Add the following secrets:

| Secret Name | Value |
|-------------|-------|
| `TAURI_PRIVATE_KEY` | Contents of `~/.tauri/hadron.key` |
| `TAURI_KEY_PASSWORD` | Password (if set, otherwise empty) |

**How to get key content**:
```bash
cat ~/.tauri/hadron.key
# Copy entire output including header/footer
```

### **Step 2: Create GitHub Actions Workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'  # Trigger on version tags (v1.0.0, v1.0.1, etc.)

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        platform:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc

    runs-on: ${{ matrix.platform.os }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          target: ${{ matrix.platform.target }}

      - name: Install dependencies (Ubuntu)
        if: matrix.platform.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install frontend dependencies
        run: npm install

      - name: Install Python dependencies
        run: |
          cd python
          pip install -r requirements.txt

      - name: Build Tauri app
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
        run: npm run tauri build -- --target ${{ matrix.platform.target }}

      - name: Upload Release Assets
        uses: softprops/action-gh-release@v1
        with:
          files: |
            src-tauri/target/${{ matrix.platform.target }}/release/bundle/**/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate latest.json
        if: matrix.platform.os == 'ubuntu-latest'
        run: |
          # Extract signatures and create latest.json
          # (Custom script needed - see AUTO-UPDATER-SETUP.md)
          node scripts/generate-latest-json.js

      - name: Upload latest.json
        if: matrix.platform.os == 'ubuntu-latest'
        uses: softprops/action-gh-release@v1
        with:
          files: latest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### **Step 3: Trigger Release**

```bash
# Create and push a version tag
git tag v1.0.1
git push origin v1.0.1

# GitHub Actions will:
# 1. Build for all platforms (Windows, macOS Intel, macOS ARM, Linux)
# 2. Sign all installers
# 3. Create GitHub release
# 4. Upload signed installers
# 5. Generate and upload latest.json
```

---

## Platform-Specific Signing

### **macOS App Signing** (Optional but Recommended)

For distribution outside App Store, you need:
1. **Apple Developer Account** ($99/year)
2. **Developer ID Certificate** (for Gatekeeper)
3. **Notarization** (submit to Apple for scanning)

**Setup**:
```bash
# Install certificate from Apple Developer portal
# Add to Keychain Access

# Configure in tauri.conf.json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)"
    }
  }
}

# Build with signing
npm run tauri build

# Notarize (required for macOS 10.15+)
xcrun notarytool submit \
  src-tauri/target/release/bundle/dmg/hadron-desktop_1.0.0_x64.dmg \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password"

# Staple notarization ticket
xcrun stapler staple \
  src-tauri/target/release/bundle/dmg/hadron-desktop_1.0.0_x64.dmg
```

### **Windows Code Signing** (Optional)

For trusted Windows installers:
1. **Code Signing Certificate** (from DigiCert, Sectigo, etc.)
2. **signtool.exe** (Windows SDK)

**Setup**:
```powershell
# Sign MSI installer
signtool sign /f certificate.pfx /p password /t http://timestamp.digicert.com hadron-desktop_1.0.0_x64_en-US.msi

# Or configure in CI/CD
env:
  WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
  WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
```

---

## Verification

### **Verify Tauri Signature**

Users can verify downloads before installing:

```bash
# Install minisign (if not already)
brew install minisign  # macOS
sudo apt install minisign  # Linux

# Verify installer signature
minisign -Vm hadron-desktop_1.0.0_x64_en-US.msi -P <PUBLIC_KEY>

# If valid:
# Signature and comment signature verified
# Trusted comment: timestamp:1699876543
```

### **Verify in Auto-Updater**

The Tauri updater automatically verifies signatures if `pubkey` is set in config. Invalid signatures are rejected:

```
Update signature verification failed: Invalid signature
```

---

## Security Best Practices

### **Key Management**
1. ✅ **Never commit** private keys to version control
2. ✅ **Use GitHub Secrets** for CI/CD keys
3. ✅ **Rotate keys** if compromised
4. ✅ **Password protect** private keys
5. ✅ **Backup securely** (encrypted cloud storage, hardware key)

### **Signing Process**
1. ✅ **Sign in CI/CD** - not on developer machines
2. ✅ **Audit trail** - log all signing operations
3. ✅ **Time-stamp signatures** - ensures long-term validity
4. ✅ **Verify after signing** - automated checks

### **Distribution**
1. ✅ **HTTPS only** - for update endpoints
2. ✅ **Verify checksums** - SHA256 hashes in release notes
3. ✅ **Monitor releases** - watch for unauthorized releases
4. ✅ **Revoke compromised keys** - update public key in config

---

## Troubleshooting

### **"Signature verification failed"**

**Causes**:
- Public key in `tauri.conf.json` doesn't match signing keypair
- `.sig` file not uploaded to release
- Private key changed between releases

**Fix**:
```bash
# Regenerate signature with correct private key
export TAURI_PRIVATE_KEY="$(cat ~/.tauri/hadron.key)"
npm run tauri build

# Upload new .sig files to release
```

### **"Private key not found"**

**Causes**:
- `TAURI_PRIVATE_KEY` environment variable not set
- Key file path incorrect

**Fix**:
```bash
# Check key exists
ls -la ~/.tauri/hadron.key

# Set environment variable
export TAURI_PRIVATE_KEY="$(cat ~/.tauri/hadron.key)"
```

### **"Password required but not provided"**

**Causes**:
- Private key has password protection
- `TAURI_KEY_PASSWORD` not set

**Fix**:
```bash
export TAURI_KEY_PASSWORD="your-password"
```

---

## Migration from Unsigned to Signed

If you already released unsigned builds:

1. **Generate keypair** (see Step 1 above)
2. **Update `tauri.conf.json`** with public key
3. **Release next version signed** (v1.0.1+)
4. **Update `latest.json`** with signatures
5. **Users upgrade normally** (first signed update)

**Note**: Users on v1.0.0 (unsigned) can update to v1.0.1 (signed). Future updates require signature verification.

---

## Summary

### **Development (Local Builds)**
```bash
# One-time setup
npm run tauri signer generate -- -w ~/.tauri/hadron.key
# Update tauri.conf.json with public key

# Every build
export TAURI_PRIVATE_KEY="$(cat ~/.tauri/hadron.key)"
npm run tauri build
```

### **Production (CI/CD)**
```bash
# One-time setup
1. Generate keypair
2. Add TAURI_PRIVATE_KEY to GitHub Secrets
3. Create .github/workflows/release.yml
4. Update tauri.conf.json with public key

# Every release
git tag v1.0.1
git push origin v1.0.1
# GitHub Actions handles the rest
```

---

## Resources

- [Tauri Updater Signing Docs](https://v2.tauri.app/distribute/sign/)
- [Minisign Project](https://jedisct1.github.io/minisign/)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Windows Code Signing](https://docs.microsoft.com/en-us/windows/win32/seccrypto/cryptography-tools)

---

**Status**: ✅ Documented - Ready to implement when moving to production

**Next Steps**: Set up GitHub Actions workflow for automated signed releases
