# Smalltalk Crash Analyzer - Week 1 MVP

Analyze VisualWorks Smalltalk crash logs with AI in seconds.

## Quick Start (2 minutes)

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Set API Key

```bash
# OpenAI (recommended for MVP)
export OPENAI_API_KEY='your-key-here'

# Or Anthropic Claude
export ANTHROPIC_API_KEY='your-key-here'
```

### 3. Run Analysis

```bash
python analyze.py samples/crash-example.log
```

That's it! Results appear in terminal and save to `results/`.

## Example Output

```
🔍 CRASH ANALYSIS RESULTS
═══════════════════════════════════════════

📌 Error Type: MessageNotUnderstood
⚠️  Severity: HIGH
🎯 Component: ReportGenerator class
💡 Confidence: high

🔎 Root Cause:
   The receiver of 'formatDate:' message is nil. The crash occurs
   when trying to format a date that was never initialized.

✅ Suggested Fixes:
   1. Add nil check before calling formatDate:
      date ifNotNil: [ date formatDate: format ]
   2. Initialize date in the constructor
   3. Add defensive programming in ReportGenerator>>initialize

🔄 How to Reproduce:
   1. Open Report Generator
   2. Click 'Export PDF' without setting date range
   3. Crash occurs

💰 Analysis Cost:
   Model: gpt-4-turbo-preview
   Tokens: 1543
   Cost: $0.0154
```

## Configuration

Edit `config.yaml` to change AI provider or model:

```yaml
provider: openai
model: gpt-4-turbo-preview
temperature: 0.3
```

### Use Claude Instead

```yaml
provider: anthropic
model: claude-3-sonnet-20240229
```

### Use Free Local AI (Ollama)

```yaml
provider: ollama
model: llama3
api_url: http://localhost:11434
```

## Large File Support (Up to 2MB+)

The analyzer intelligently handles large crash logs:

- **Files ≤400 KB**: Sent to AI completely
- **Files >400 KB**: Smart truncation keeps:
  - First 50% (error message, stack trace)
  - Last 25% (recent context)
  - Truncation notice in middle

**Example with 2MB file:**
```
📂 Reading crash log: large-crash.log
   Original Size: 2048.00 KB
   ⚠️  File is 2048.0 KB, truncating to 400.0 KB for AI analysis
   📏 Sent to AI: 400.00 KB (truncated)
   💡 Keeping most relevant sections for analysis
```

This ensures:
- ✅ Files up to 2MB+ can be analyzed
- ✅ AI stays within context window limits
- ✅ Most important crash info is preserved
- ✅ No memory issues

You can adjust `max_file_size_kb` in `config.yaml`.

## Cost Estimates

- **OpenAI GPT-4**: ~$0.03 per crash analysis
- **Claude Sonnet**: ~$0.015 per analysis
- **Ollama (local)**: Free

## Project Structure

```
phase-0-mvp/
├── analyze.py          # Main script (200 lines)
├── config.yaml         # Configuration
├── requirements.txt    # Python dependencies
├── results/           # Output directory (auto-created)
└── samples/           # Sample crash logs (create your own)
```

## Next Steps

After using this for a week:

1. **Do you want to search old analyses?** → Phase 2 adds SQLite database
2. **Do you want a desktop UI?** → Phase 1 adds Tauri application
3. **Do you want team sharing?** → Phase 5 adds web app

**Don't build what you don't need yet.** Ship this MVP, get feedback, then decide.

## Troubleshooting

### "No API key found"
```bash
export OPENAI_API_KEY='sk-...'
```

### "Module 'openai' not found"
```bash
pip install -r requirements.txt
```

### "File not found"
Make sure the crash log path is correct:
```bash
python analyze.py ./samples/my-crash.log
```

## Success Criteria (Week 1)

- [ ] 3 developers use it on real crash logs
- [ ] At least 1 says "this helped me fix the bug faster"
- [ ] 10+ crash logs analyzed
- [ ] AI analysis accuracy >70%

**Happy debugging!** 🚀
