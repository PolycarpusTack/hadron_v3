# Hadron Desktop - User Guide

**Version**: 1.0.0
**Last Updated**: 2025-11-13

Complete guide to using Hadron Desktop for Smalltalk crash analysis.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [First-Time Setup](#first-time-setup)
4. [Analyzing Crash Logs](#analyzing-crash-logs)
5. [Managing API Keys](#managing-api-keys)
6. [Search & History](#search--history)
7. [Favorites](#favorites)
8. [Exporting Analyses](#exporting-analyses)
9. [Settings & Preferences](#settings--preferences)
10. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Overview

Hadron Desktop is an **AI-powered Smalltalk crash log analyzer** that helps developers:

- 🔍 **Understand crashes faster** - AI explains root causes in plain English
- 🎯 **Get fix suggestions** - Actionable steps to resolve issues
- 📚 **Build knowledge** - Search and reference past analyses
- ⚡ **Save time** - 10x faster than manual debugging

### Key Features

- **Multi-provider AI**: Choose from OpenAI, Anthropic Claude, or Z.ai
- **Full-text search**: Find past analyses instantly with BM25 ranking
- **Auto-updater**: Stay current with automatic updates
- **Encrypted storage**: API keys secured with OS-level encryption
- **Export**: Share analyses as Markdown or PDF

---

## Installation

### Download

Get the installer for your platform:
- **Windows**: `hadron-desktop_1.0.0_x64_en-US.msi`
- **macOS (Intel)**: `hadron-desktop_1.0.0_x64.dmg`
- **macOS (Apple Silicon)**: `hadron-desktop_1.0.0_aarch64.dmg`
- **Linux (Debian/Ubuntu)**: `hadron-desktop_1.0.0_amd64.deb`
- **Linux (AppImage)**: `hadron-desktop_1.0.0_amd64.AppImage`

Download from: [GitHub Releases](https://github.com/hadron-team/hadron-desktop/releases)

### Install

**Windows**:
1. Double-click `.msi` installer
2. Follow installation wizard
3. Launch from Start Menu

**macOS**:
1. Open `.dmg` file
2. Drag Hadron to Applications folder
3. First launch: Right-click → Open (to bypass Gatekeeper)

**Linux (Debian/Ubuntu)**:
```bash
sudo dpkg -i hadron-desktop_1.0.0_amd64.deb
```

**Linux (AppImage)**:
```bash
chmod +x hadron-desktop_1.0.0_amd64.AppImage
./hadron-desktop_1.0.0_amd64.AppImage
```

---

## First-Time Setup

### Step 1: Launch Hadron

- **Windows**: Start Menu → Hadron
- **macOS**: Applications → Hadron
- **Linux**: Run from command line or applications menu

### Step 2: Choose AI Provider

Click the **Settings** icon (⚙️) in the top-right corner.

You have three options:

| Provider | Cost | Best For |
|----------|------|----------|
| **OpenAI** | $0.01-$0.03/analysis | Occasional use, reliable |
| **Anthropic** | $0.003-$0.015/analysis | Large logs, best reasoning |
| **Z.ai** | $3/month (unlimited) | Daily use, heavy users |

Select your provider and recommended model:
- **OpenAI**: GPT-4 Turbo
- **Anthropic**: Claude 3.5 Sonnet
- **Z.ai**: GLM-4.6

### Step 3: Add API Key

**Get your API key**:
- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com
- **Z.ai**: https://z.ai

Paste your API key into the Settings panel and click **Save Settings**.

✅ **Your API key is encrypted** and stored securely using OS-level encryption.

### Step 4: Analyze Your First Crash Log

Use **Choose File** or **Paste Log Text** to start an analysis.

---

## Analyzing Crash Logs

### Supported File Types

- `.log` - Smalltalk crash logs
- `.txt` - Text files with stack traces
- `.crash` - Crash reports
- Any text file containing error messages

### How to Analyze

**Method 1: Choose File**
1. Click **Choose File**
2. Select a crash log in the file picker
3. Choose **Quick** or **Comprehensive**
4. Wait for analysis

**Method 2: Paste Log Text**
1. Click **Paste Log Text**
2. Paste the crash log content
3. Click **Analyze Pasted Log**

### Understanding Results

Each analysis includes:

1. **Root Cause** 🎯
   - What triggered the crash
   - Which component failed
   - Why it happened

2. **Stack Trace Explanation** 📚
   - Step-by-step breakdown
   - Key methods and line numbers
   - Flow of execution

3. **Suggested Fix** 🔧
   - Code changes needed
   - Configuration updates
   - Workarounds

4. **Prevention Tips** 🛡️
   - How to avoid similar crashes
   - Best practices
   - Testing recommendations

### Analysis Metadata

Each analysis tracks:
- **File name**: Original crash log name
- **AI Provider**: Which AI analyzed it (OpenAI/Anthropic/Z.ai)
- **Model**: Specific AI model used
- **Cost**: Estimated API cost
- **Timestamp**: When analysis was performed

---

## Managing API Keys

### View Current API Key

Settings → Shows masked key: `sk-••••••••••••••••••1234`

### Update API Key

1. Settings → Enter new API key
2. Click **Save Settings**
3. Old key is automatically replaced

### Clear API Key

1. Settings → Click **Clear** button
2. Confirm deletion
3. You'll need to re-enter to analyze files

### Security

- ✅ **Encrypted** - OS-level encryption (Keychain/Credential Manager/Secret Service)
- ✅ **Never transmitted** - Keys stay on your machine
- ✅ **Auto-migration** - Old localStorage keys migrated automatically

---

## Search & History

### View All Analyses

All analyses appear in the sidebar automatically.

**Sorted by**:
- Most recent first
- With file name and timestamp

### Search

Use the search bar at the top to find analyses:

**Search by**:
- File name (`test.log`)
- Error message (`NullPointerException`)
- Class name (`MessageHandler`)
- Method name (`processMessage`)
- Any text in the analysis

**Powered by**: SQLite FTS5 with BM25 ranking (relevance-based)

### Filters

Click **Filters** to narrow results:

- **Provider**: Show only OpenAI/Anthropic/Z.ai analyses
- **Model**: Filter by specific model
- **Date Range**: Last 7 days, 30 days, all time
- **Favorites**: Show only starred analyses

### Re-analyze

Click any past analysis to view it. You can:
- Read the full analysis
- Export to Markdown/PDF
- Star as favorite
- Delete

---

## Favorites

### Star an Analysis

Click the ★ icon on any analysis to mark as favorite.

### View Favorites

Click **Favorites** in the sidebar to see only starred analyses.

**Use cases**:
- Production crashes
- Critical bugs
- Reference examples
- Learning material

### Unstar

Click the filled ★ icon to remove from favorites.

---

## Exporting Analyses

### Export to Markdown

1. Click **Export** button on any analysis
2. Select "Markdown (.md)"
3. Choose save location
4. File includes full analysis with formatting

**Use for**:
- GitHub Issues
- Documentation
- Team sharing
- Version control

### Export to PDF

1. Click **Export** button
2. Select "PDF (.pdf)"
3. Choose save location
4. Formatted PDF with syntax highlighting

**Use for**:
- Reports
- Presentations
- Printing
- Archiving

---

## Settings & Preferences

### AI Provider Settings

**Switch Provider**:
1. Settings → Select new provider
2. Enter API key for new provider
3. Save Settings

**Change Model**:
- Select different model from dropdown
- Each provider has 2-3 models
- Recommended models are marked

### File Size Limit

**Default**: 400 KB

**Adjust**:
- Settings → Max File Size slider (100 KB - 1000 KB)
- Larger files = higher API costs
- Files auto-truncated if over limit

### Theme

**Toggle Dark/Light Mode**:
- Settings → Theme selector
- Default: Dark mode
- Preference saved automatically

### Software Updates

**Check for Updates**:
1. Settings → Software Updates section
2. Click "Check for Updates"
3. If available, Tauri shows update dialog

**Auto-update**:
- Checks on app startup (silent)
- Notifies when update available
- One-click install

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| **Open Settings** | `Ctrl+,` (Windows/Linux) <br> `Cmd+,` (macOS) |
| **Search** | `Ctrl+F` (Windows/Linux) <br> `Cmd+F` (macOS) |
| **Star/Unstar** | `Ctrl+D` (Windows/Linux) <br> `Cmd+D` (macOS) |
| **Export** | `Ctrl+E` (Windows/Linux) <br> `Cmd+E` (macOS) |
| **Delete** | `Delete` |
| **Close Panel** | `Esc` |

---

## Tips & Tricks

### Faster Analysis

- **Use GPT-3.5 Turbo** for simple crashes (5x faster, 10x cheaper)
- **Reduce file size limit** if you have small logs
- **Z.ai unlimited** = no cost worries

### Better Results

- **Include full stack trace** in crash log
- **Add context** (what user was doing)
- **Use Claude 3.5 Sonnet** for complex multi-file crashes

### Organization

- **Star critical crashes** for quick reference
- **Use descriptive file names** for easier search
- **Export to Markdown** for team documentation

### Cost Savings

- **Anthropic** = 3-5x cheaper than OpenAI for large files
- **Z.ai** = best for >10 analyses/day
- **Reduce file size** = lower API costs

---

## Troubleshooting

For detailed troubleshooting, see [TROUBLESHOOTING.md](../../TROUBLESHOOTING.md).

### Common Issues

**"API Key Invalid"**
- Check key format (OpenAI: `sk-`, Anthropic: `sk-ant-`)
- Verify account has credits/subscription
- Re-enter key in Settings

**"Analysis Failed"**
- Check internet connection
- Try different provider (circuit breaker should auto-switch)
- Check file is valid text format

**"File Too Large"**
- Increase Max File Size in Settings
- Or split large log into smaller files

**"Update Check Failed"**
- Check internet connection
- Verify GitHub is accessible
- Manual download from GitHub Releases

---

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/hadron-team/hadron-desktop/issues)
- **Discussions**: [GitHub Discussions](https://github.com/hadron-team/hadron-desktop/discussions)
- **Documentation**: [DOCUMENTATION.md](../../DOCUMENTATION.md)

---

**Version**: 1.0.0
**Last Updated**: 2025-11-13
