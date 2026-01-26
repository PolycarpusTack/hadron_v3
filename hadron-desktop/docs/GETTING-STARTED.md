# Getting Started with Hadron

Welcome to Hadron - your AI-powered Smalltalk crash log analyzer! This tutorial will walk you through everything you need to know to become productive with Hadron.

---

## What You'll Learn

By the end of this tutorial, you'll be able to:
- [ ] Set up Hadron with your API key
- [ ] Analyze your first crash log
- [ ] Understand analysis results
- [ ] Use the History feature
- [ ] Export and share reports

**Estimated time: 15 minutes**

---

## Module 1: First Launch & Setup

### Step 1.1: Launch Hadron

When you first open Hadron, you'll see the main interface:

```
┌─────────────────────────────────────────────────────────────┐
│  🔬 Hadron                                    ☀️ ⚙️         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│     ┌─────────────────────────────────────────────┐        │
│     │                                             │        │
│     │        Choose File or Paste Log Text        │        │
│     │            to start analysis                │        │
│     │                                             │        │
│     └─────────────────────────────────────────────┘        │
│                                                             │
│     [  Dashboard  ] [  History  ] [  Patterns  ]           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Step 1.2: Configure Your API Key

Before analyzing crashes, you need to set up an AI provider:

1. **Click the Settings icon** (⚙️) in the top right corner, or press `Ctrl+,`

2. **You'll see the Settings panel:**
   ```
   ┌─────────────── Settings ────────────────┐
   │                                         │
   │  AI Provider:  [ OpenAI        ▼]      │
   │                                         │
   │  API Key:      [_________________]     │
   │                                         │
   │  Model:        [ gpt-4o         ▼]      │
   │                                         │
   │            [ Save Settings ]            │
   └─────────────────────────────────────────┘
   ```

3. **Enter your API key:**
   - For OpenAI: Get yours at https://platform.openai.com/api-keys
   - For Anthropic: Get yours at https://console.anthropic.com/settings/keys
   - For Ollama (local/free): No key needed, just install Ollama

4. **Click "Save Settings"**

> ✅ **Checkpoint:** You should see a green "API Key Set" indicator in the footer.

---

## Module 2: Your First Analysis

### Step 2.1: Load a Crash Log

Use one of the two inputs in the Crash Analyzer panel:

**Option A: Choose File**
1. Click **Choose File**
2. Navigate to your crash log
3. Select one or more files and click **Open**

**Option B: Paste Log Text**
1. Click **Paste Log Text**
2. Paste the crash log content
3. Click **Analyze Pasted Log**

### Step 2.2: Choose Analysis Type

Pick the analysis type before starting:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   📄 CrashLog_2025-01-22.wks loaded                       │
│                                                            │
│   ┌──────────────────┐    ┌──────────────────┐            │
│   │  Quick Analysis  │    │ Comprehensive    │            │
│   │                  │    │                  │            │
│   │  • Fast (5-10s)  │    │  • Full scan     │            │
│   │  • Crash focus   │    │  • Full context  │            │
│   │  • Root cause    │    │  • Test scenarios│            │
│   └──────────────────┘    └──────────────────┘            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**For your first analysis, try "Quick Analysis"** - it's faster and focuses on the crash and fix.

### Step 2.3: Watch the Progress

During analysis, you'll see:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   Analyzing crash log...                                   │
│                                                            │
│   ████████████████████░░░░░░░░░░░░░░░░░░░░  45%           │
│                                                            │
│   Current: Extracting stack trace...                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

> 💡 **Tip:** The analysis has multiple phases: parsing, pattern matching, AI analysis, and result formatting.

### Step 2.4: Understanding Results

When analysis completes, you'll see results like this:

```
┌─────────────────── Analysis Results ───────────────────────┐
│                                                            │
│  📊 Summary                                                │
│  ─────────────────────────────────────────────────────     │
│  NullReferenceException in OrderProcessor when            │
│  attempting to access customer billing information.        │
│                                                            │
│  🔍 Root Cause                                             │
│  ─────────────────────────────────────────────────────     │
│  The order.customer.billingAddress field is nil           │
│  because the customer profile was created without         │
│  billing information.                                      │
│                                                            │
│  💡 Suggested Fix                                          │
│  ─────────────────────────────────────────────────────     │
│  Add nil check before accessing billing address:          │
│  `order customer billingAddress ifNotNil: [...]`          │
│                                                            │
│  [Copy] [Export] [Create JIRA Ticket] [Re-analyze]        │
└────────────────────────────────────────────────────────────┘
```

> ✅ **Checkpoint:** You've successfully analyzed your first crash log!

---

## Module 3: Understanding the Results

### 3.1: Result Sections Explained

| Section | What It Tells You |
|---------|-------------------|
| **Summary** | One-paragraph explanation of what crashed and why |
| **Root Cause** | The underlying technical reason for the crash |
| **Suggested Fix** | Code changes or steps to resolve the issue |
| **Severity** | How critical the crash is (Critical, High, Medium, Low) |
| **Component** | Which part of the application was affected |

### 3.2: Reading the Stack Trace

Click "Show Stack Trace" to see the technical details:

```
┌─────────────────── Stack Trace ────────────────────────────┐
│                                                            │
│  1. OrderProcessor>>processOrder:      ← Crash location   │
│  2. OrderController>>submitOrder:                          │
│  3. WebHandler>>handlePost:                                │
│  4. HttpServer>>processRequest:                            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

The **top of the stack** shows where the crash occurred. Read downward to see how the code got there.

### 3.3: Try Comprehensive (WHATS'ON) for Deeper Analysis

Now that you've seen Quick Analysis, try Comprehensive on the same crash:

1. Click **"Re-analyze"**
2. Select **"Comprehensive"**
3. Wait for the comprehensive analysis

Comprehensive (WHATS'ON) provides additional insights:
- **User Scenario**: What was the user trying to do?
- **Impact Analysis**: What's affected by this crash?
- **Test Scenarios**: How to verify the fix works
- **Reproduction Steps**: How to recreate the crash

---

## Module 4: Using History

### 4.1: Access History

Press `Ctrl+H` or click the **History** tab to see past analyses.

```
┌──────────────────────── History ───────────────────────────┐
│                                                            │
│  🔍 Search...                    [Filter ▼] [Date Range]  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ CrashLog_2025-01-22.wks                              │ │
│  │ NullReferenceException • High • 2 hours ago          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ production_error_01-21.txt                           │ │
│  │ DatabaseConnectionError • Critical • Yesterday       │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 4.2: Search and Filter

- **Search**: Type keywords like "null" or "database"
- **Filter by Severity**: Show only Critical or High issues
- **Filter by Date**: Focus on recent crashes
- **Filter by Component**: See crashes in specific areas

### 4.3: Compare Analyses

Select two analyses to compare them side-by-side. This helps identify patterns across crashes.

---

## Module 5: Exporting Reports

### 5.1: Export a Single Analysis

From the results view:
1. Click **"Export"**
2. Choose format:
   - **Markdown** - For documentation/wikis
   - **HTML** - For sharing in browsers
   - **JSON** - For integrations

### 5.2: Export to JIRA

If JIRA is configured:
1. Click **"Create JIRA Ticket"**
2. Review the pre-filled ticket
3. Adjust priority/assignee if needed
4. Click **"Create"**

### 5.3: Bulk Export

From History:
1. Select multiple analyses (checkbox)
2. Click **"Bulk Actions"**
3. Choose **"Export Selected"**

---

## Module 6: Tips for Power Users

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Analysis | `Ctrl+N` |
| Open History | `Ctrl+H` |
| Open Settings | `Ctrl+,` |
| Open Console | `Ctrl+Y` |
| Close Panel | `Esc` |

### Batch Analysis

Have many crash logs? Select multiple files at once:
1. Click **Choose File**
2. Multi-select files in Explorer/Finder
3. Choose analysis type
4. Hadron processes them sequentially

### Using Tags

Organize analyses with tags:
1. Click the **tag icon** on any analysis
2. Add tags like `production`, `investigated`, `wontfix`
3. Filter by tags in History

### Notes

Add your own notes to any analysis:
1. Open an analysis from History
2. Click **"Add Notes"**
3. Record your findings, decisions, or follow-ups

---

## Knowledge Check

Test your understanding:

1. **Q: Where do you configure your API key?**
   <details>
   <summary>Show Answer</summary>
   Settings panel (Ctrl+,) > API Key field
   </details>

2. **Q: What's the difference between Quick and Comprehensive analysis?**
   <details>
   <summary>Show Answer</summary>
   Quick is fast (5-10s) and focused on the crash, root cause, and fix. Comprehensive is a full scan (30-60s) with broader context, impact analysis, and test cases.
   </details>

3. **Q: How do you find a crash you analyzed yesterday?**
   <details>
   <summary>Show Answer</summary>
   Press Ctrl+H to open History, then use date filter or search.
   </details>

4. **Q: What shortcut opens the console for debugging?**
   <details>
   <summary>Show Answer</summary>
   Ctrl+Y
   </details>

---

## What's Next?

Now that you know the basics:

- [ ] **Analyze 5 crash logs** to get comfortable with the workflow
- [ ] **Try Comprehensive analysis** for a complex crash
- [ ] **Set up JIRA integration** if your team uses JIRA
- [ ] **Explore the Dashboard** for crash trends and statistics
- [ ] **Read the [Developer Guide](./DEVELOPER-GUIDE.md)** if you want to contribute

---

## Getting Help

Stuck? Here's where to go:

| Problem | Solution |
|---------|----------|
| Feature not working | Check [Help Guide](./HELP.md) |
| Bug in Hadron | Report at GitHub Issues |
| General questions | Ask your team lead or check docs |

---

## Summary

Congratulations! You've completed the Hadron Getting Started tutorial. You now know how to:

- ✅ Configure Hadron with your API key
- ✅ Run Quick and Comprehensive analyses
- ✅ Interpret analysis results
- ✅ Use History to find past analyses
- ✅ Export reports in multiple formats

Happy crash hunting! 🔬
