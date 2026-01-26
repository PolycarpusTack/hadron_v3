# Hadron Help & Troubleshooting Guide

This guide helps you solve common problems when using Hadron. Each issue includes symptoms, causes, and step-by-step solutions.

---

## Quick Reference: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New analysis |
| `Ctrl+H` | Open History |
| `Ctrl+,` | Open Settings |
| `Ctrl+Y` | Open Console Viewer |
| `Esc` | Close current panel/modal |

---

## Issue 1: "All AI providers failed" Error

### Symptoms
- Error message: "All AI providers failed"
- Analysis button spins then shows error
- Console shows API connection errors

### Diagnosis Checklist
- [ ] Is an API key configured in Settings?
- [ ] Is the API key valid and not expired?
- [ ] Is a valid model selected (not "gpt-5.1" or similar invalid names)?
- [ ] Do you have internet connectivity?

### Solution Steps

**Step 1: Check API Key**
1. Press `Ctrl+,` to open Settings
2. Look at the "API Key" field
3. If empty or shows `*****`, the key may not be saved

**Step 2: Re-enter API Key**
1. Delete the current API key field content
2. Paste your API key from your provider dashboard:
   - OpenAI: https://platform.openai.com/api-keys
   - Anthropic: https://console.anthropic.com/settings/keys
3. Click "Save Settings"

**Step 3: Select Valid Model**
1. In Settings, check the "Model" dropdown
2. Select a valid model:
   - OpenAI: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
   - Anthropic: `claude-3-opus-20240229`, `claude-3-sonnet-20240229`
   - Ollama: `llama3`, `mistral`, `codellama`
3. Save and retry

**Step 4: Test Connection**
1. Open Console Viewer (`Ctrl+Y`)
2. Try a simple analysis
3. Look for specific error messages in the console

---

## Issue 2: Comprehensive (WHATS'ON) Analysis Shows "No Enhanced Data"

### Symptoms
- Analysis completes but shows fallback/empty view
- "Comprehensive (WHATS'ON) Analysis" tab appears but content is missing
- Console shows JSON parsing warnings

### Diagnosis Checklist
- [ ] Did the analysis actually complete (not timeout)?
- [ ] Is the crash log in the expected format?
- [ ] Did the AI return structured JSON?

### Solution Steps

**Step 1: Check Analysis Status**
1. Wait for the progress bar to reach 100%
2. If it times out, the crash log may be too large

**Step 2: Try Smaller Log**
1. If the crash log is very large (>1MB), try:
   - Trimming repetitive sections
   - Using "Quick Analysis" first (fast crash-focused analysis)

**Step 3: Check Console for Details**
1. Press `Ctrl+Y` to open Console
2. Look for messages like:
   - `"WhatsOn validation failed"` - AI response format issue
   - `"Missing fields"` - Partial response received
3. This helps identify if it's an AI or parsing issue

**Step 4: Retry Analysis**
1. Click "Re-analyze" button
2. AI responses can vary; a second attempt often succeeds

---

## Issue 3: "Python script not found in bundle"

### Symptoms
- Error: "Python script not found in bundle at: [path]"
- Translation feature doesn't work
- RAG features fail

### Diagnosis Checklist
- [ ] Is this a fresh install or upgrade?
- [ ] Was the installer completed successfully?
- [ ] Is Python installed on your system?

### Solution Steps

**Step 1: Check Installation Integrity**
1. Navigate to the Hadron installation folder:
   - Windows: `C:\Users\[you]\AppData\Local\Hadron`
   - macOS: `/Applications/Hadron.app/Contents/Resources`
2. Look for a `python` folder containing `translate.py`

**Step 2: Reinstall Application**
1. Uninstall Hadron
2. Download the latest installer
3. Run installer with administrator privileges
4. Complete installation fully

**Step 3: Alternative - Core Features Still Work**
- Parsing and Quick Analysis work without Python
- Only Translation and RAG require Python scripts

---

## Issue 4: Application Doesn't Start

### Symptoms
- Double-click does nothing
- Splash screen shows then disappears
- Error dialog on startup

### Solution Steps

**Step 1: Check System Requirements**
- Windows 10/11 (64-bit)
- macOS 10.15+ (Catalina or later)
- 4GB RAM minimum

**Step 2: Try Running from Terminal**
```bash
# Windows (PowerShell)
cd "C:\Users\[you]\AppData\Local\Hadron"
.\Hadron.exe

# macOS
/Applications/Hadron.app/Contents/MacOS/Hadron

# Linux
/opt/hadron/hadron
```
This shows any startup errors.

**Step 3: Check Log Files**
```
Windows: %APPDATA%/com.hadron.desktop/logs/
macOS:   ~/Library/Logs/com.hadron.desktop/
Linux:   ~/.local/share/com.hadron.desktop/logs/
```

**Step 4: Reset Configuration**
If corrupted settings are the issue:
1. Close Hadron
2. Delete the config folder (see paths above)
3. Restart Hadron (will recreate defaults)

---

## Issue 5: History Not Loading

### Symptoms
- History tab shows empty
- "Loading..." spinner never stops
- Previously saved analyses missing

### Diagnosis Checklist
- [ ] Has Hadron been upgraded recently?
- [ ] Was the database moved or deleted?
- [ ] Is there sufficient disk space?

### Solution Steps

**Step 1: Check Database Existence**
Look for `analysis.db` at:
```
Windows: %APPDATA%/com.hadron.desktop/analysis.db
macOS:   ~/Library/Application Support/com.hadron.desktop/analysis.db
```

**Step 2: Check Database Size**
- If 0 bytes, database is corrupted
- Normal size: 100KB - 100MB depending on history

**Step 3: Database Recovery**
1. Go to Settings > Database Administration
2. Click "Verify Database"
3. If errors found, click "Repair Database"

**Step 4: Fresh Start (Last Resort)**
1. Export any visible analyses first
2. In Settings > Database Administration
3. Click "Reset Database"
4. This clears all history but fixes corruption

---

## Issue 6: JIRA Integration Not Working

### Symptoms
- "Create JIRA Ticket" fails
- "Failed to connect to JIRA" error
- Tickets created but fields missing

### Diagnosis Checklist
- [ ] Is JIRA URL configured correctly?
- [ ] Are credentials valid?
- [ ] Do you have permission to create tickets in the project?

### Solution Steps

**Step 1: Verify JIRA Settings**
1. Go to Settings > JIRA Integration
2. Check fields:
   - **URL**: Must include `https://` (e.g., `https://yourcompany.atlassian.net`)
   - **Email**: Your Atlassian account email
   - **API Token**: Generate at https://id.atlassian.com/manage-profile/security/api-tokens
   - **Project Key**: The short code (e.g., `PROJ`, `BUG`)

**Step 2: Test Connection**
1. Click "Test Connection" button
2. Should show "Connection successful"
3. If not, check the error message

**Step 3: Common URL Fixes**
```
Wrong: jira.company.com
Right: https://jira.company.com

Wrong: https://yourcompany.atlassian.net/browse
Right: https://yourcompany.atlassian.net
```

---

## Issue 7: Slow Performance

### Symptoms
- UI feels sluggish
- Analysis takes too long
- Application freezes temporarily

### Solution Steps

**Step 1: Check System Resources**
1. Open Task Manager (Windows) or Activity Monitor (macOS)
2. Check if Hadron is using excessive CPU/memory
3. Close other heavy applications

**Step 2: Reduce History Size**
1. Go to Settings > Database Administration
2. Use "Cleanup Old Records" to remove old analyses
3. Keep last 30-90 days for best performance

**Step 3: Clear Cache**
1. Close Hadron
2. Delete cache folder:
   ```
   Windows: %APPDATA%/com.hadron.desktop/cache/
   macOS:   ~/Library/Caches/com.hadron.desktop/
   ```
3. Restart Hadron

**Step 4: Use Quick Analysis**
- Comprehensive runs a full scan and can take longer
- Use Quick Analysis for initial triage (crash-focused)
- Reserve Comprehensive for deep dives

---

## Issue 8: Export Not Working

### Symptoms
- Export button doesn't respond
- Exported file is empty
- "Export failed" error

### Solution Steps

**Step 1: Check Export Location**
1. When exporting, ensure you have write permission to the destination
2. Try exporting to Desktop first

**Step 2: Verify Analysis Data**
1. Can you see the analysis in Hadron?
2. If the analysis is incomplete, export will fail

**Step 3: Try Different Format**
1. If Markdown fails, try JSON
2. JSON export is simpler and more reliable

---

## Issue 9: Dark Mode Not Working

### Symptoms
- Theme toggle doesn't change colors
- Partial dark mode (some elements light)

### Solution Steps

**Step 1: Toggle Theme**
1. Click the sun/moon icon in the header
2. Or go to Settings > Appearance

**Step 2: System Preference Sync**
- Hadron respects system dark mode preference
- Check your OS settings if auto-detection isn't working

**Step 3: Hard Refresh**
1. Close Hadron completely
2. Reopen the application
3. Theme should apply correctly

---

## Getting More Help

### Console Viewer
Press `Ctrl+Y` to see detailed logs. This shows:
- API requests and responses
- Parsing progress
- Error details

### Export Logs for Support
1. Open Console Viewer
2. Click "Export Logs"
3. Share the log file when reporting issues

### Report a Bug
File issues at: https://github.com/hadron-team/hadron-desktop/issues

Include:
- Hadron version (shown in footer)
- Operating system
- Steps to reproduce
- Console logs if available

---

## Diagnostic Commands Reference

### Check Hadron Version
Look at the bottom of the application window:
```
Hadron 3.5.2 - your friendly neighbourhood Analyzer
```

### View Raw Crash File
1. Open Console Viewer (`Ctrl+Y`)
2. Drag a crash file into Hadron
3. Console shows raw parsing output

### Test AI Connection
1. Open Settings
2. Ensure API key is entered
3. Go to main view
4. Click "Test" next to provider selection

---

## Feature Limitations

| Feature | Limitation | Workaround |
|---------|------------|------------|
| Max file size | 10MB | Split large logs |
| Batch analysis | 50 files | Process in batches |
| Offline mode | Requires Ollama | Set up local Ollama |
| Export formats | MD, HTML, JSON | Convert externally if needed |

---

## Glossary

| Term | Meaning |
|------|---------|
| **Quick Analysis** | Fast, basic analysis of crash logs |
| **Comprehensive (WHATS'ON)** | Comprehensive deep analysis with full context |
| **RAG** | Retrieval Augmented Generation - uses past analyses to improve new ones |
| **Signature** | Unique identifier for a crash pattern |
| **Gold Analysis** | Expert-verified, high-quality analysis used for training |
