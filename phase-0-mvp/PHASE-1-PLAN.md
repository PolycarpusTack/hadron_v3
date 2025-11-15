# Phase 1: Desktop Foundation - Implementation Plan

**Status**: Planning → Implementation
**Timeline**: 3 weeks (Weeks 2-4)
**Deliverable**: 10-20MB Tauri desktop application

## Prerequisites Met ✅

- [x] Phase 0 MVP complete and working
- [x] Validated with real crash logs (332KB, 594KB)
- [x] Truncation approach proven effective
- [x] User wants desktop UI experience

## Architecture Overview

### Technology Stack

**Frontend**: React + TypeScript
- Modern UI framework
- Type safety
- Rich component ecosystem
- Fast development

**Backend**: Tauri (Rust)
- Small bundle size (10-20MB vs Electron's 100MB+)
- Native performance
- Built-in security
- Cross-platform (Windows, macOS, Linux)

**Python Integration**:
- Keep `analyze.py` as backend processor
- Tauri calls Python via subprocess
- Reuse proven AI analysis logic

**Storage**: SQLite
- Local database for history
- Fast queries
- No server needed
- Easy backup

### Application Structure

```
hadron-desktop/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/
│   │   ├── FileDropZone.tsx      # Drag & drop interface
│   │   ├── AnalysisResults.tsx   # Display AI analysis
│   │   ├── HistoryView.tsx       # Past analyses
│   │   ├── StackTraceViewer.tsx  # Syntax-highlighted stack traces
│   │   └── SettingsPanel.tsx     # API key, model selection
│   ├── services/
│   │   ├── api.ts                # Tauri backend communication
│   │   ├── database.ts           # SQLite queries
│   │   └── analysis.ts           # Analysis orchestration
│   └── App.tsx                   # Main application
│
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── main.rs               # Tauri entry point
│   │   ├── commands.rs           # Tauri commands (analyze, history, etc.)
│   │   ├── python_runner.rs     # Python subprocess management
│   │   └── database.rs           # SQLite operations
│   └── Cargo.toml
│
├── python/                       # Python analysis engine
│   ├── analyze.py                # Ported from Phase 0
│   ├── config.yaml               # AI configuration
│   └── requirements.txt
│
└── package.json                  # Dependencies
```

## Implementation Roadmap

### Week 1: Tauri + React Setup (Days 1-5)

**Day 1: Project Initialization**
- [ ] Install Tauri CLI
- [ ] Create new Tauri + React project
- [ ] Set up TypeScript configuration
- [ ] Configure development environment

**Day 2: Port Python Backend**
- [ ] Copy `analyze.py` into `python/` directory
- [ ] Create Rust command to call Python subprocess
- [ ] Test Python integration from Tauri
- [ ] Handle Python environment/dependencies

**Day 3: File Upload UI**
- [ ] Build drag-and-drop zone
- [ ] File validation (size, extension)
- [ ] Loading states and progress indicators
- [ ] Error handling for invalid files

**Day 4: Analysis Display**
- [ ] Create results view component
- [ ] Syntax highlighting for stack traces
- [ ] Severity indicators (HIGH, MEDIUM, LOW)
- [ ] Suggested fixes display

**Day 5: Settings Panel**
- [ ] API key configuration
- [ ] Model selection (GPT-4, GPT-3.5, Claude)
- [ ] Max file size settings
- [ ] Save settings to local storage

### Week 2: SQLite History & Advanced UI (Days 6-10)

**Day 6: SQLite Integration**
- [ ] Database schema design
  ```sql
  CREATE TABLE analyses (
      id INTEGER PRIMARY KEY,
      filename TEXT,
      error_type TEXT,
      severity TEXT,
      root_cause TEXT,
      analyzed_at DATETIME,
      file_size_kb REAL,
      tokens_used INTEGER,
      cost REAL
  );

  CREATE TABLE suggested_fixes (
      id INTEGER PRIMARY KEY,
      analysis_id INTEGER,
      fix_description TEXT,
      FOREIGN KEY(analysis_id) REFERENCES analyses(id)
  );
  ```
- [ ] Rust database operations
- [ ] Migration system

**Day 7: History View**
- [ ] List all past analyses
- [ ] Search by filename, error type, date
- [ ] Filter by severity
- [ ] Delete old analyses

**Day 8: Analysis Detail View**
- [ ] Click on history item to view full analysis
- [ ] Re-analyze same file with different settings
- [ ] Export analysis to Markdown/PDF
- [ ] Copy-to-clipboard functionality

**Day 9: Stack Trace Viewer**
- [ ] Syntax highlighting for Smalltalk code
- [ ] Line numbers
- [ ] Collapsible stack frames
- [ ] Jump to specific frame
- [ ] Search within stack trace

**Day 10: Dark Mode & Themes**
- [ ] Dark mode toggle
- [ ] Light theme
- [ ] Persist theme preference
- [ ] Smooth transitions

### Week 3: Polish, Testing & Packaging (Days 11-15)

**Day 11: Error Handling**
- [ ] Comprehensive error messages
- [ ] Retry logic for API failures
- [ ] Offline mode detection
- [ ] Network error handling

**Day 12: Performance Optimization**
- [ ] Lazy loading for large analyses
- [ ] Virtual scrolling for history list
- [ ] Debounce search inputs
- [ ] Optimize database queries

**Day 13: Testing**
- [ ] Unit tests for critical functions
- [ ] Integration tests for Python → Rust → React flow
- [ ] Test with real crash logs (332KB, 594KB, 2MB)
- [ ] Cross-platform testing (Windows, macOS)

**Day 14: Packaging & Distribution**
- [ ] Build Windows installer (.msi)
- [ ] Build macOS app (.dmg)
- [ ] Bundle Python runtime with app
- [ ] Test installation on fresh machines

**Day 15: Documentation**
- [ ] User guide (screenshots, tutorials)
- [ ] Developer README
- [ ] Changelog
- [ ] Release notes for v1.0

## Feature List

### Core Features (Must Have)

1. **Drag & Drop Interface**
   - Drop crash log file anywhere
   - Show file preview (name, size)
   - Validate before analysis

2. **AI Analysis**
   - Reuse Phase 0 `analyze.py` logic
   - Progress indicator during analysis
   - Display results with formatting

3. **History**
   - SQLite storage of all analyses
   - Search and filter
   - View past results
   - Delete unwanted entries

4. **Stack Trace Viewer**
   - Syntax highlighting
   - Collapsible frames
   - Copy individual frames
   - Jump to specific line

5. **Settings**
   - API key management (encrypted storage)
   - Model selection
   - Max file size
   - Output preferences

### Enhanced Features (Nice to Have)

6. **Export Options**
   - Export to Markdown
   - Export to PDF (using Aspose or similar)
   - Copy formatted results
   - Share analysis link

7. **Batch Processing**
   - Analyze multiple files at once
   - Queue management
   - Progress for each file
   - Summary report

8. **Comparison View**
   - Compare two crash logs side-by-side
   - Highlight differences
   - Common patterns detection

9. **Templates**
   - Save custom analysis prompts
   - Reusable configurations
   - Share templates with team

### Future Enhancements (Phase 2+)

10. **Enterprise Chunker Integration**
    - Port `aegis-chunker` for files >2MB
    - Stack trace preservation
    - Zero information loss
    - Production-grade reliability

11. **Team Collaboration**
    - Share analyses with team
    - Comments and annotations
    - Assign ownership
    - Track resolution status

12. **CI/CD Integration**
    - GitHub Actions plugin
    - GitLab CI support
    - Automated crash detection
    - Slack/Discord notifications

## Technical Decisions

### Why Tauri over Electron?

| Feature | Tauri | Electron |
|---------|-------|----------|
| Bundle Size | 10-20MB | 100MB+ |
| Memory Usage | ~50MB | ~200MB |
| Startup Time | Fast | Slower |
| Security | Rust (memory-safe) | Node.js |
| Platform Support | Win, Mac, Linux | Win, Mac, Linux |

**Decision**: Tauri for better performance and smaller size.

### Why SQLite over Cloud Database?

- No server needed
- Works offline
- Fast queries
- Easy backup (single file)
- Privacy (data stays local)
- Simple to migrate later if needed

**Decision**: SQLite for Phase 1, cloud option in Phase 3+.

### Why Keep Python Backend?

- Already proven with Phase 0
- Don't rewrite working code
- Easy to port AI logic
- Can swap for Rust later if needed

**Decision**: Keep Python, bundle with app.

## Database Schema

```sql
-- Main analyses table
CREATE TABLE analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_file_path TEXT,
    file_size_kb REAL,
    file_hash TEXT,  -- SHA-256 for deduplication

    -- Analysis results
    error_type TEXT,
    severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')),
    root_cause TEXT,
    affected_component TEXT,
    how_to_reproduce TEXT,
    confidence TEXT CHECK(confidence IN ('high', 'medium', 'low')),

    -- Metadata
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- AI metadata
    ai_model TEXT,
    tokens_used INTEGER,
    cost REAL,

    -- File handling
    was_truncated BOOLEAN DEFAULT 0,
    truncation_info TEXT,

    UNIQUE(file_hash, ai_model)  -- Avoid duplicate analyses
);

-- Suggested fixes (one-to-many relationship)
CREATE TABLE suggested_fixes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    fix_number INTEGER,
    description TEXT NOT NULL,
    FOREIGN KEY(analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

-- Tags for organization
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY(analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

-- User notes
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

-- Indexes for fast queries
CREATE INDEX idx_analyses_date ON analyses(analyzed_at);
CREATE INDEX idx_analyses_severity ON analyses(severity);
CREATE INDEX idx_analyses_error_type ON analyses(error_type);
CREATE INDEX idx_analyses_hash ON analyses(file_hash);
CREATE INDEX idx_tags_analysis ON tags(analysis_id);
```

## UI Mockups

### Main Window

```
┌──────────────────────────────────────────────────────────────┐
│  Hadron - Smalltalk Crash Analyzer               ⚙️  ⚫️  ⬜️  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │                                                    │    │
│  │           📂  Drop crash log file here             │    │
│  │                                                    │    │
│  │              or click to browse                    │    │
│  │                                                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  Recent Analyses:                                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🔴 WCR_5-2_11-23-15.txt     HIGH      2h ago        │ │
│  │ 🟡 WCR_16-4_11-40-58.txt    MEDIUM    Yesterday     │ │
│  │ 🟢 debug_log_01.txt         LOW       3 days ago    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [📊 View All History]    [⚙️ Settings]    [📖 Help]        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Analysis Results

```
┌──────────────────────────────────────────────────────────────┐
│  Analysis Results: WCR_5-2_11-23-15.txt          🔙  ⬜️  ⚫️  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📌 Error Type: MediaGeniX.MgXViolationError                │
│  ⚠️  Severity: HIGH                                          │
│  🎯 Component: WOnActiveTxDaySchedule                       │
│  💡 Confidence: high                                         │
│                                                              │
│  🔎 Root Cause:                                              │
│  The user attempted to delete a transmission event          │
│  without proper permissions. The security check raised      │
│  a violation error when validating modification rights.     │
│                                                              │
│  ✅ Suggested Fixes:                                         │
│  1. Check user permissions before deletion                  │
│  2. Add permission validation UI feedback                   │
│  3. Implement role-based access control                     │
│                                                              │
│  📊 Stack Trace (255 frames):                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [1]  MgXViolations>>raiseIfAppropriate               │ │
│  │ [2]  MgXUtilities class>>raisePermissionViolation... │ │
│  │ [3]  WOnActiveTxDaySchedule class>>raisePerm...     │ │
│  │ ...                                                   │ │
│  │ [255] WindowManager>>processNextEvent                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  💰 Analysis Cost: $0.0234                                  │
│  📅 Analyzed: 2 hours ago with GPT-4                        │
│                                                              │
│  [💾 Export]  [🔄 Re-analyze]  [🗑️ Delete]  [📋 Copy]       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Success Criteria

### Must Meet
- [ ] Analyze crash logs 3x faster than Phase 0 CLI
- [ ] Handle files up to 2MB without issues
- [ ] Store and retrieve 1000+ analyses
- [ ] Bundle size <20MB
- [ ] Startup time <2 seconds

### User Validation
- [ ] 5 developers test Phase 1
- [ ] 80%+ prefer desktop UI over CLI
- [ ] All can navigate without documentation
- [ ] No data loss or corruption

### Performance
- [ ] Analysis completes in <30 seconds for 500KB file
- [ ] UI remains responsive during analysis
- [ ] Search history in <100ms
- [ ] Memory usage <200MB

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Python bundling issues | Medium | High | Test on multiple clean Windows/Mac installs |
| SQLite corruption | Low | High | Implement auto-backup, migration tools |
| Tauri learning curve | Medium | Medium | Start with official tutorial, community support |
| Bundle size >20MB | Low | Low | Optimize dependencies, tree-shaking |
| Cross-platform bugs | Medium | Medium | Test on Windows + Mac early and often |

## Dependencies

### Frontend
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tauri-apps/api": "^1.5.0",
    "tailwindcss": "^3.3.0",
    "react-syntax-highlighter": "^15.5.0",
    "date-fns": "^2.30.0"
  }
}
```

### Backend (Rust)
```toml
[dependencies]
tauri = "1.5"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
rusqlite = { version = "0.30", features = ["bundled"] }
tokio = { version = "1.35", features = ["full"] }
```

### Python
```
openai>=1.0.0
anthropic>=0.9.0
pyyaml>=6.0
```

## Deliverables

### Week 1
- [ ] Tauri + React project running
- [ ] Python integration working
- [ ] Basic file upload UI

### Week 2
- [ ] SQLite history working
- [ ] Stack trace viewer complete
- [ ] Dark mode implemented

### Week 3
- [ ] Windows .msi installer
- [ ] macOS .dmg package
- [ ] User documentation
- [ ] Release v1.0.0

## Next Phase Trigger

**Proceed to Phase 2 if:**
- 80%+ users prefer desktop over CLI
- Users request search/filter features
- Want to analyze crash trends over time
- Need data export capabilities

**Skip to Phase 3 if:**
- Multiple teams want to use it
- Request for team collaboration
- Want centralized analysis sharing

---

**Status**: Ready to begin implementation
**Start Date**: TBD
**Target Completion**: 3 weeks from start
