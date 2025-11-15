# GitHub Release Guide - v1.0.0

Step-by-step guide to creating the v1.0.0 release on GitHub.

---

## Prerequisites

✅ **Completed**:
- [x] Phase 1-6 development complete
- [x] Auto-updater configured
- [x] Build succeeds with no errors
- [x] Security vulnerabilities fixed (0 production)
- [x] Documentation complete

⏳ **In Progress**:
- [ ] Production build completed
- [ ] Release notes finalized
- [ ] GitHub release created

---

## Step 1: Verify Build Artifacts

After `npm run tauri build` completes, verify the following files exist:

### **Windows** (if built on Windows)
```
src-tauri/target/release/bundle/msi/hadron-desktop_1.0.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/hadron-desktop_1.0.0_x64-setup.exe (optional)
```

### **macOS** (if built on macOS)
```
src-tauri/target/release/bundle/dmg/hadron-desktop_1.0.0_x64.dmg (Intel)
src-tauri/target/release/bundle/dmg/hadron-desktop_1.0.0_aarch64.dmg (Apple Silicon)
```

### **Linux** (if built on Linux)
```
src-tauri/target/release/bundle/deb/hadron-desktop_1.0.0_amd64.deb
src-tauri/target/release/bundle/appimage/hadron-desktop_1.0.0_amd64.AppImage
```

**Note**: You'll only have artifacts for the platform you built on. For multi-platform releases, use GitHub Actions CI/CD (see AUTO-UPDATER-SETUP.md).

---

## Step 2: Create GitHub Repository (If Not Exists)

1. Go to https://github.com/new
2. **Repository name**: `hadron-desktop`
3. **Description**: "Smalltalk Crash Analyzer - AI-powered desktop application"
4. **Visibility**: Public (or Private for internal use)
5. Click **Create repository**

---

## Step 3: Push Code to GitHub

```bash
# Initialize git (if not already done)
git init

# Add remote
git remote add origin https://github.com/hadron-team/hadron-desktop.git

# Add all files
git add .

# Create initial commit
git commit -m "$(cat <<'EOF'
feat: Hadron Desktop v1.0.0 - Initial Release

Complete Smalltalk crash analyzer with AI-powered analysis:

Core Features:
- Multi-provider AI support (OpenAI, Anthropic, Z.ai)
- Drag & drop crash log analysis
- SQLite database with FTS5 search
- Dark mode UI with syntax highlighting
- Export to Markdown/PDF

Production Features (Phases 4-6):
- Circuit breaker pattern (automatic failover)
- Encrypted API key storage (OS-level)
- Structured logging (Rust + Python)
- Auto-updater with GitHub releases

Tech Stack:
- Frontend: React 18 + TypeScript + Tailwind CSS
- Backend: Tauri 2 (Rust)
- Analysis: Python + OpenAI/Anthropic SDK
- Database: SQLite with FTS5

Development Time: ~5.5 days (Phases 1-6)
Build Status: Production-ready ✅

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 4: Create GitHub Release

### **Via GitHub Web UI**

1. Go to your repository: `https://github.com/hadron-team/hadron-desktop`
2. Click **Releases** (right sidebar)
3. Click **Draft a new release**

**Tag version**:
```
v1.0.0
```
- Click "Create new tag: v1.0.0 on publish"

**Release title**:
```
Hadron Desktop v1.0.0 - Initial Release
```

**Description** (copy from RELEASE-v1.0.0.md or use this):

```markdown
## 🎉 Hadron Desktop v1.0.0

AI-powered **Smalltalk crash log analyzer** for developers.

### ✨ Features

- **Multi-provider AI**: OpenAI, Anthropic Claude, Z.ai support
- **Intelligent Analysis**: Root cause, stack trace explanation, fix suggestions
- **Full-text Search**: SQLite with FTS5 for fast history search
- **Auto-updater**: One-click updates for future releases
- **Encrypted Storage**: OS-level API key encryption
- **Dark Mode**: Eye-friendly interface

### 📥 Download

Choose the installer for your platform:

- **Windows**: `hadron-desktop_1.0.0_x64_en-US.msi`
- **macOS (Intel)**: `hadron-desktop_1.0.0_x64.dmg`
- **macOS (Apple Silicon)**: `hadron-desktop_1.0.0_aarch64.dmg`
- **Linux**: `hadron-desktop_1.0.0_amd64.deb` or `.AppImage`

### 🚀 Quick Start

1. Download installer for your platform
2. Install and launch Hadron
3. Open Settings and add your AI provider API key
4. Drag & drop a crash log file to analyze

### 📚 Documentation

- [README.md](https://github.com/hadron-team/hadron-desktop/blob/main/README.md) - Overview
- [RELEASE-v1.0.0.md](https://github.com/hadron-team/hadron-desktop/blob/main/RELEASE-v1.0.0.md) - Full release notes
- [AUTO-UPDATER-SETUP.md](https://github.com/hadron-team/hadron-desktop/blob/main/AUTO-UPDATER-SETUP.md) - Update system

### 🐛 Known Issues

- Unsigned builds may trigger security warnings (right-click → Open to approve)
- Code signing will be added in future builds

### 🙏 Feedback

Found a bug? [Report it here](https://github.com/hadron-team/hadron-desktop/issues)

---

**Full Changelog**: Initial release
```

**Upload Binaries**:
1. Click **Attach binaries by dropping them here or selecting them**
2. Drag & drop the installer files:
   - `hadron-desktop_1.0.0_x64_en-US.msi` (Windows)
   - `hadron-desktop_1.0.0_x64.dmg` (macOS Intel)
   - `hadron-desktop_1.0.0_aarch64.dmg` (macOS Apple Silicon)
   - `hadron-desktop_1.0.0_amd64.deb` (Linux)
   - `hadron-desktop_1.0.0_amd64.AppImage` (Linux)

**Options**:
- ✅ Check "Set as the latest release"
- ✅ Check "Create a discussion for this release" (optional)

**Publish**:
1. Click **Publish release**
2. Wait for upload to complete

---

## Step 5: Create `latest.json` for Auto-Updater

For the auto-updater to work, you need to upload a `latest.json` file to the release.

### **Create `latest.json`**

Create a file named `latest.json` with this content:

```json
{
  "version": "1.0.0",
  "notes": "Initial release of Hadron Desktop - AI-powered Smalltalk crash analyzer",
  "pub_date": "2025-11-13T08:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.0/hadron-desktop_1.0.0_x64_en-US.msi"
    },
    "darwin-x86_64": {
      "signature": "",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.0/hadron-desktop_1.0.0_x64.dmg"
    },
    "darwin-aarch64": {
      "signature": "",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.0/hadron-desktop_1.0.0_aarch64.dmg"
    },
    "linux-x86_64": {
      "signature": "",
      "url": "https://github.com/hadron-team/hadron-desktop/releases/download/v1.0.0/hadron-desktop_1.0.0_amd64.deb"
    }
  }
}
```

**Note**: `signature` is empty for now (unsigned builds). For production signed builds, see AUTO-UPDATER-SETUP.md.

### **Upload `latest.json`**

1. Go to your release: `https://github.com/hadron-team/hadron-desktop/releases/tag/v1.0.0`
2. Click **Edit release**
3. Drag & drop `latest.json` to the binaries section
4. Click **Update release**

---

## Step 6: Verify Auto-Updater

### **Test Update Check**

1. Launch Hadron Desktop v1.0.0
2. Open Settings
3. Scroll to "Software Updates"
4. Click "Check for Updates"
5. Should show: "✅ You're running the latest version!"

### **Test Update Flow (for v1.0.1+)**

When you release v1.0.1:
1. Update `latest.json` with v1.0.1 details
2. Upload new installers
3. Launch v1.0.0 → should detect update automatically
4. Tauri shows update dialog with release notes

---

## Step 7: Announce Release

### **GitHub Discussion** (if enabled)
- Post in Discussions → Announcements
- Share download links and key features

### **Social Media** (optional)
- Twitter/X: "Just released Hadron Desktop v1.0.0 - AI-powered Smalltalk crash analyzer! 🎉"
- LinkedIn: Share release notes
- Reddit: r/programming, r/smalltalk

### **Internal Team** (if applicable)
- Email team with download links
- Slack/Teams announcement
- Demo session

---

## Troubleshooting

### **Release upload fails**
- Check file size limits (GitHub: 2GB per file)
- Ensure you're logged in with correct permissions
- Try uploading fewer files at once

### **Auto-updater can't find latest.json**
- Verify `latest.json` is uploaded to the same release
- Check URL in tauri.conf.json matches GitHub release
- Ensure release is published (not draft)

### **Security warnings on download**
- Expected for unsigned builds
- Users: Right-click → Open to bypass
- Future: Add code signing (see AUTO-UPDATER-SETUP.md)

---

## Next Steps

After v1.0.0 release:

1. **Monitor Issues**: Respond to bug reports quickly
2. **Gather Feedback**: Users in GitHub Discussions
3. **Plan v1.1**: Prioritize features based on user requests
4. **Add Code Signing**: Set up GitHub Actions for signed builds
5. **E2E Testing**: Add Playwright tests for critical paths

---

## CI/CD Automation (Future)

For automated multi-platform releases, see AUTO-UPDATER-SETUP.md for GitHub Actions workflow.

**Benefits**:
- Build for all platforms simultaneously
- Automatic code signing
- Auto-generate release notes
- Upload binaries automatically

---

## Quick Checklist

- [ ] Code pushed to GitHub
- [ ] Git tag `v1.0.0` created
- [ ] GitHub release created
- [ ] Installers uploaded
- [ ] `latest.json` uploaded
- [ ] Release published (not draft)
- [ ] Auto-updater tested
- [ ] Announcement posted

---

**Status**: Ready to create GitHub release when build completes! 🚀
