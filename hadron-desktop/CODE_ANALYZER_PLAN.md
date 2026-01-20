# Code Analyzer Feature - Implementation Plan

**Reference Mockup:** `/mnt/c/Projects/Hadron_v3/Prototypes/Code_Analyzer_Mockup.html`

---

## Phase 1: Backend (Rust)

### 1.1 Database Migration
**File:** `src-tauri/src/migrations.rs`

Add `code_analyses` table:
```sql
CREATE TABLE code_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    language TEXT NOT NULL,
    code_content TEXT NOT NULL,
    quality_score INTEGER,
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    medium_count INTEGER DEFAULT 0,
    low_count INTEGER DEFAULT 0,
    full_analysis TEXT NOT NULL,  -- JSON blob
    analyzed_at TEXT NOT NULL,
    ai_model TEXT,
    is_favorite INTEGER DEFAULT 0
);
```

### 1.2 Code Analysis Module
**New folder:** `src-tauri/src/code_analysis/`

Files to create:
- `mod.rs` - Module exports
- `types.rs` - Structs for CodeIssue, WalkthroughSection, QualityScores, etc.
- `prompts.rs` - AI prompts for analysis (adapt from Prototypes/*.md)
- `service.rs` - Main analysis logic using existing ai_service.rs patterns

### 1.3 Tauri Commands
**File:** `src-tauri/src/commands.rs`

Add commands:
- `analyze_code(code, filename, language, api_key, model, provider)` → CodeAnalysisResult
- `get_code_analyses()` → Vec<CodeAnalysis>
- `get_code_analysis_by_id(id)` → CodeAnalysis
- `delete_code_analysis(id)`
- `detect_language(code, filename)` → String

### 1.4 Language Detection
Simple approach:
```rust
fn detect_language(filename: &str, code: &str) -> String {
    // 1. Check file extension (.sql, .tsx, .st, .py, etc.)
    // 2. Check code patterns (SELECT, import React, etc.)
    // 3. Default to "plaintext"
}
```

---

## Phase 2: Frontend (React/TypeScript)

### 2.1 Types
**New file:** `src/types/codeAnalyzer.ts`

```typescript
export interface CodeAnalysisResult {
  summary: string;
  issues: CodeIssue[];
  walkthrough: WalkthroughSection[];
  optimizedCode: string | null;
  qualityScores: QualityScores;
  glossary: GlossaryTerm[];
}

export interface CodeIssue {
  id: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'performance' | 'error' | 'best-practice';
  line: number;
  title: string;
  description: string;
  technical: string;
  fix: string;
  complexity: string;
  impact?: string;
}

export interface WalkthroughSection {
  lines: string;
  title: string;
  code: string;
  whatItDoes: string;
  whyItMatters: string;
  evidence: string;
  dependencies: { name: string; type: string; note: string }[];
  impact: string;
  testability: string;
  eli5: string;
  quality: string;
}

export interface QualityScores {
  overall: number;
  security: number;
  performance: number;
  maintainability: number;
  bestPractices: number;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}
```

### 2.2 State Management
**File:** `src/hooks/useAppState.ts`

Add to View type:
```typescript
export type View = 'analyze' | 'history' | 'detail' | 'translate' | 'code-analyzer';
```

Add state fields:
```typescript
codeAnalyzerTab: 'overview' | 'walkthrough' | 'issues' | 'optimized' | 'quality' | 'learn';
codeAnalyzing: boolean;
codeAnalysisResult: CodeAnalysisResult | null;
codeInput: { content: string; filename: string; language: string } | null;
```

Add actions:
- `SET_CODE_ANALYZER_TAB`
- `START_CODE_ANALYSIS`
- `CODE_ANALYSIS_SUCCESS`
- `CODE_ANALYSIS_ERROR`
- `SET_CODE_INPUT`
- `CLEAR_CODE_ANALYSIS`

### 2.3 Navigation
**File:** `src/App.tsx`

Add sidebar tab:
```tsx
<button onClick={() => actions.setView("code-analyzer")}>
  <Code className="w-5 h-5" />
  Code Analyzer
</button>
```

Add view rendering:
```tsx
{currentView === "code-analyzer" && <CodeAnalyzerView />}
```

### 2.4 Components
**New folder:** `src/components/codeanalyzer/`

| Component | Purpose |
|-----------|---------|
| `CodeAnalyzerView.tsx` | Main container (copy pattern from AnalysisResults) |
| `CodeInputZone.tsx` | Drag/drop/paste area |
| `CodeViewer.tsx` | Code display with line numbers + issue markers |
| `OverviewTab.tsx` | Summary + quality gauges + critical issues |
| `WalkthroughTab.tsx` | Line-by-line explanations |
| `IssuesTab.tsx` | Issue list with filters |
| `OptimizedTab.tsx` | Improved code display |
| `QualityTab.tsx` | Score breakdown |
| `LearnTab.tsx` | Glossary + next steps |
| `QualityGauge.tsx` | Circular score indicator |
| `IssueCard.tsx` | Expandable issue display |
| `Badges.tsx` | SeverityBadge, CategoryBadge |

### 2.5 Service Layer
**New file:** `src/services/codeAnalyzer.ts`

```typescript
import { invoke } from "@tauri-apps/api/tauri";

export async function analyzeCode(code: string, filename: string, language: string, apiKey: string, model: string, provider: string) {
  return invoke("analyze_code", { code, filename, language, apiKey, model, provider });
}

export async function getCodeAnalyses() {
  return invoke("get_code_analyses");
}

// etc.
```

---

## Phase 3: Polish

- [ ] Test with SQL, React, Smalltalk samples
- [ ] Add keyboard shortcut (Ctrl+Shift+C)
- [ ] Add to history view (optional)
- [ ] Add export functionality (HTML/Markdown)
- [ ] Fix any UI issues

---

## Implementation Order

```
Day 1: Backend foundation
  ├── Migration + database methods
  └── Types + basic command stubs

Day 2: Backend AI integration
  ├── Prompts (adapt from Prototypes/*.md)
  └── Analysis service + language detection

Day 3: Frontend foundation
  ├── Types + state management
  ├── Navigation tab
  └── CodeAnalyzerView shell

Day 4: Input + Overview
  ├── CodeInputZone (drag/drop/paste)
  ├── CodeViewer
  └── OverviewTab + QualityGauge

Day 5: Core tabs
  ├── WalkthroughTab + WalkthroughSection
  └── IssuesTab + IssueCard + Badges

Day 6: Remaining tabs
  ├── OptimizedTab
  ├── QualityTab
  └── LearnTab

Day 7: Integration + testing
  ├── Wire everything together
  ├── Test with real AI
  └── Bug fixes
```

---

## Notes

- Follow existing patterns in `ai_service.rs` for Ollama/OpenAI calls
- Follow existing patterns in `AnalysisResults.tsx` for tab structure
- The mockup HTML has all the UI/styling figured out - translate to React components
- Start with hardcoded demo data to build UI, then wire up real AI
