# Phase 1a: Code Analyzer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the desktop's 6-tab AI-powered code analyzer to hadron-web — backend routes + full frontend.

**Architecture:** Update hadron-core types/prompts to match desktop's richer schema. Add `POST /api/code-analysis` and `/api/code-analysis/stream` routes to hadron-server. Build frontend component tree (orchestrator + 6 tabs + 3 shared components) using `useAiStream` hook from Phase 0. Custom state-based routing in App.tsx (no React Router).

**Tech Stack:** Rust (hadron-core types, hadron-server Axum routes), React 18 + TypeScript + Tailwind CSS

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `crates/hadron-core/src/ai/detect_language.rs` | Heuristic language detection |
| `crates/hadron-server/src/routes/code_analysis.rs` | Code analysis route handlers |
| `frontend/src/components/code-analyzer/CodeAnalyzerView.tsx` | Orchestrator component |
| `frontend/src/components/code-analyzer/detectLanguage.ts` | Frontend language detection |
| `frontend/src/components/code-analyzer/constants.ts` | File size limits, language map |
| `frontend/src/components/code-analyzer/tabs/OverviewTab.tsx` | Overview tab |
| `frontend/src/components/code-analyzer/tabs/WalkthroughTab.tsx` | Walkthrough tab |
| `frontend/src/components/code-analyzer/tabs/IssuesTab.tsx` | Issues tab with filters |
| `frontend/src/components/code-analyzer/tabs/OptimizedTab.tsx` | Optimized code tab |
| `frontend/src/components/code-analyzer/tabs/QualityTab.tsx` | Quality scores tab |
| `frontend/src/components/code-analyzer/tabs/LearnTab.tsx` | Glossary + next steps |
| `frontend/src/components/code-analyzer/shared/SeverityBadge.tsx` | Severity badge |
| `frontend/src/components/code-analyzer/shared/CategoryBadge.tsx` | Category badge |
| `frontend/src/components/code-analyzer/shared/QualityGauge.tsx` | SVG circular gauge |

### Modified files

| File | Change |
|------|--------|
| `crates/hadron-core/src/ai/mod.rs` | Add `pub mod detect_language` |
| `crates/hadron-core/src/ai/parsers.rs` | Replace types with desktop-matching schema |
| `crates/hadron-core/src/ai/prompts.rs` | Replace `CODE_ANALYSIS_PROMPT` with desktop prompt, update builder |
| `crates/hadron-server/src/routes/mod.rs` | Add `mod code_analysis` + routes |
| `frontend/src/App.tsx` | Add `code-analyzer` to View type, nav, and render |
| `frontend/src/services/api.ts` | Add code analysis types |

---

## Task 1: Update hadron-core Types to Match Desktop Schema

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/parsers.rs`

- [ ] **Step 1: Replace the entire `parsers.rs` with desktop-matching types**

Replace the full contents of `hadron-web/crates/hadron-core/src/ai/parsers.rs` with:

```rust
//! AI response parsers — extract structured data from AI text output.

use crate::error::{HadronError, HadronResult};
use serde::{Deserialize, Serialize};

/// Strip markdown code fences from AI output.
pub fn strip_markdown_fences(raw: &str) -> &str {
    let trimmed = raw.trim();

    for marker in ["```json", "```JSON", "```"] {
        if let Some(start_idx) = trimmed.find(marker) {
            let content_start = start_idx + marker.len();
            if let Some(end_idx) = trimmed[content_start..].find("```") {
                let block = trimmed[content_start..content_start + end_idx].trim();
                if !block.is_empty() {
                    return block;
                }
            }
        }
    }

    trimmed
}

// ============================================================================
// Code Analysis Types (matches desktop schema exactly)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisResult {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub issues: Vec<CodeIssue>,
    #[serde(default)]
    pub walkthrough: Vec<WalkthroughSection>,
    #[serde(default)]
    pub optimized_code: Option<String>,
    #[serde(default)]
    pub quality_scores: CodeQualityScores,
    #[serde(default)]
    pub glossary: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeIssue {
    #[serde(default)]
    pub id: u32,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub technical: String,
    #[serde(default)]
    pub fix: String,
    #[serde(default)]
    pub complexity: String,
    #[serde(default)]
    pub impact: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughSection {
    #[serde(default)]
    pub lines: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub what_it_does: String,
    #[serde(default)]
    pub why_it_matters: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default)]
    pub dependencies: Vec<CodeDependency>,
    #[serde(default)]
    pub impact: String,
    #[serde(default)]
    pub testability: String,
    #[serde(default)]
    pub eli5: String,
    #[serde(default)]
    pub quality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeDependency {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub dep_type: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeQualityScores {
    #[serde(default)]
    pub overall: u8,
    #[serde(default)]
    pub security: u8,
    #[serde(default)]
    pub performance: u8,
    #[serde(default)]
    pub maintainability: u8,
    #[serde(default)]
    pub best_practices: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    #[serde(default)]
    pub term: String,
    #[serde(default)]
    pub definition: String,
}

/// Parse an AI response into a CodeAnalysisResult.
pub fn parse_code_analysis(raw: &str) -> HadronResult<CodeAnalysisResult> {
    let json_str = strip_markdown_fences(raw);
    serde_json::from_str(json_str).map_err(|e| {
        HadronError::Parse(format!("Failed to parse code analysis response: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_markdown_fences_json() {
        let input = "Here is the result:\n\n```json\n{\"key\": \"value\"}\n```\n\nDone.";
        assert_eq!(strip_markdown_fences(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_strip_markdown_fences_plain() {
        let input = r#"{"key": "value"}"#;
        assert_eq!(strip_markdown_fences(input), r#"{"key": "value"}"#);
    }

    #[test]
    fn test_parse_code_analysis_desktop_schema() {
        let input = r#"{
            "summary": "A test function",
            "issues": [{"id": 1, "severity": "high", "category": "security", "line": 5, "title": "SQL injection", "description": "Unsanitized input", "technical": "String concat in query", "fix": "Use parameterized queries", "complexity": "Low", "impact": "Data breach"}],
            "walkthrough": [{"lines": "1-5", "title": "Imports", "code": "import os", "whatItDoes": "Imports OS module", "whyItMatters": "File access", "evidence": "import statement", "dependencies": [{"name": "os", "type": "import", "note": "stdlib"}], "impact": "Required", "testability": "N/A", "eli5": "Gets tools", "quality": "Fine"}],
            "optimizedCode": "import os\n# fixed",
            "qualityScores": {"overall": 65, "security": 30, "performance": 80, "maintainability": 70, "bestPractices": 60},
            "glossary": [{"term": "SQL injection", "definition": "Malicious SQL in user input"}]
        }"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.summary, "A test function");
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].technical, "String concat in query");
        assert_eq!(result.walkthrough[0].eli5, "Gets tools");
        assert_eq!(result.walkthrough[0].dependencies[0].dep_type, "import");
        assert_eq!(result.quality_scores.security, 30);
        assert_eq!(result.optimized_code.as_deref(), Some("import os\n# fixed"));
    }

    #[test]
    fn test_parse_code_analysis_defaults() {
        let input = r#"{"summary":"hello"}"#;
        let result = parse_code_analysis(input).unwrap();
        assert_eq!(result.summary, "hello");
        assert_eq!(result.quality_scores.overall, 0);
        assert!(result.issues.is_empty());
        assert!(result.walkthrough.is_empty());
        assert!(result.optimized_code.is_none());
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd hadron-web && cargo test -p hadron-core ai::parsers 2>&1 | tail -10`
Expected: all 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/parsers.rs
git commit -m "feat(web): update code analysis types to match desktop schema"
```

---

## Task 2: Update Prompts and Add Language Detection to hadron-core

**Files:**
- Modify: `hadron-web/crates/hadron-core/src/ai/prompts.rs`
- Create: `hadron-web/crates/hadron-core/src/ai/detect_language.rs`
- Modify: `hadron-web/crates/hadron-core/src/ai/mod.rs`

- [ ] **Step 1: Replace `CODE_ANALYSIS_PROMPT` and update builder in `prompts.rs`**

Replace the `CODE_ANALYSIS_PROMPT` constant and `build_code_analysis_messages` function with:

```rust
/// System prompt for 6-tab code analysis — matches desktop's buildCodeAnalysisPrompt.
pub fn build_code_analysis_prompt(code: &str, filename: &str, language: &str) -> String {
    format!(r#"You are an expert code reviewer. Analyze this {language} code and return a comprehensive JSON response.

FILENAME: {filename}
LANGUAGE: {language}

CODE:
{code}

Return a JSON object with this EXACT structure:
{{
  "summary": "2-3 sentence description of what this code does and its purpose",
  "issues": [
    {{
      "id": 1,
      "severity": "critical|high|medium|low",
      "category": "security|performance|error|best-practice",
      "line": 42,
      "title": "Short issue title",
      "description": "What's wrong and why it matters",
      "technical": "Technical details and evidence from the code",
      "fix": "Suggested fix with code example",
      "complexity": "Low|Medium|High",
      "impact": "Real-world impact if not fixed"
    }}
  ],
  "walkthrough": [
    {{
      "lines": "1-10",
      "title": "Section name",
      "code": "the actual code snippet for these lines",
      "whatItDoes": "Clear explanation of what this code does",
      "whyItMatters": "Why this section is important",
      "evidence": "Specific code tokens/patterns that support the explanation",
      "dependencies": [{{"name": "dep name", "type": "import|variable|function|table", "note": "brief note"}}],
      "impact": "What happens if this code is changed or removed",
      "testability": "How to test this section",
      "eli5": "Simple analogy a beginner would understand",
      "quality": "Code quality observations for this section"
    }}
  ],
  "optimizedCode": "Improved version of the full code with issues fixed, or null if no improvements needed",
  "qualityScores": {{
    "overall": 75,
    "security": 65,
    "performance": 80,
    "maintainability": 70,
    "bestPractices": 60
  }},
  "glossary": [
    {{"term": "Technical term used", "definition": "Clear definition"}}
  ]
}}

IMPORTANT INSTRUCTIONS:
1. Find ALL issues - security vulnerabilities, performance problems, bugs, and best practice violations
2. Create walkthrough sections for logical code blocks (imports, functions, classes, etc.)
3. Be specific with line numbers and code references
4. Provide actionable fixes with actual code
5. Return ONLY valid JSON, no markdown or additional text"#)
}

/// Build the messages array for a code analysis request.
pub fn build_code_analysis_messages(code: &str, filename: &str, language: &str) -> Vec<AiMessage> {
    vec![AiMessage {
        role: "user".to_string(),
        content: build_code_analysis_prompt(code, filename, language),
    }]
}
```

Also remove the old `CODE_ANALYSIS_PROMPT` constant. Update the re-export in `prompts.rs` — the constant is gone, replaced by a function.

Update the test:

```rust
    #[test]
    fn test_build_code_analysis_messages() {
        let msgs = build_code_analysis_messages("fn main() {}", "test.rs", "rust");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].role, "user");
        assert!(msgs[0].content.contains("rust"));
        assert!(msgs[0].content.contains("fn main() {}"));
        assert!(msgs[0].content.contains("test.rs"));
    }
```

- [ ] **Step 2: Create `detect_language.rs`**

Create `hadron-web/crates/hadron-core/src/ai/detect_language.rs`:

```rust
//! Heuristic language detection from file extension and code patterns.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static LANGUAGE_EXTENSIONS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("sql", "SQL");
    m.insert("tsx", "React");
    m.insert("jsx", "React");
    m.insert("ts", "TypeScript");
    m.insert("js", "JavaScript");
    m.insert("st", "Smalltalk");
    m.insert("py", "Python");
    m.insert("rs", "Rust");
    m.insert("go", "Go");
    m.insert("java", "Java");
    m.insert("xml", "XML");
    m.insert("html", "HTML");
    m.insert("css", "CSS");
    m.insert("json", "JSON");
    m.insert("yaml", "YAML");
    m.insert("yml", "YAML");
    m.insert("md", "Markdown");
    m.insert("rb", "Ruby");
    m
});

/// Detect the programming language from a filename and/or code content.
///
/// Priority: file extension > pattern-based detection > "Plaintext"
pub fn detect_language(code: &str, filename: &str) -> String {
    // Check file extension first
    if let Some(ext) = filename.rsplit('.').next() {
        if let Some(lang) = LANGUAGE_EXTENSIONS.get(ext.to_lowercase().as_str()) {
            return lang.to_string();
        }
    }

    // Pattern-based detection
    if Regex::new(r"(?i)SELECT\s+.+\s+FROM\s+").unwrap().is_match(code) {
        return "SQL".to_string();
    }
    if Regex::new(r"(?i)import\s+React|from\s+['\x22]react['\x22]").unwrap().is_match(code) {
        return "React".to_string();
    }
    if Regex::new(r"(?i)def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import").unwrap().is_match(code) {
        return "Python".to_string();
    }
    if Regex::new(r"(?i)\|\s*\w+\s*\||\w+\s*>>\s*\w+|ifTrue:|ifFalse:").unwrap().is_match(code) {
        return "Smalltalk".to_string();
    }
    if Regex::new(r"(?i)fn\s+\w+|let\s+mut|impl\s+").unwrap().is_match(code) {
        return "Rust".to_string();
    }
    if Regex::new(r"(?i)func\s+\w+|package\s+main").unwrap().is_match(code) {
        return "Go".to_string();
    }
    if Regex::new(r"(?i)<\w+[^>]*>|</\w+>").unwrap().is_match(code) {
        return "XML".to_string();
    }

    "Plaintext".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_by_extension() {
        assert_eq!(detect_language("", "main.rs"), "Rust");
        assert_eq!(detect_language("", "app.tsx"), "React");
        assert_eq!(detect_language("", "query.sql"), "SQL");
        assert_eq!(detect_language("", "script.py"), "Python");
    }

    #[test]
    fn test_detect_by_pattern() {
        assert_eq!(detect_language("SELECT id FROM users WHERE active = 1", ""), "SQL");
        assert_eq!(detect_language("import React from 'react'", ""), "React");
        assert_eq!(detect_language("def hello():\n    pass", ""), "Python");
        assert_eq!(detect_language("fn main() { println!(\"hi\"); }", ""), "Rust");
        assert_eq!(detect_language("func main() { fmt.Println() }", ""), "Go");
    }

    #[test]
    fn test_detect_fallback() {
        assert_eq!(detect_language("just some text", ""), "Plaintext");
        assert_eq!(detect_language("", ""), "Plaintext");
    }

    #[test]
    fn test_extension_takes_priority() {
        // File says Python, content looks like SQL
        assert_eq!(detect_language("SELECT * FROM table", "script.py"), "Python");
    }
}
```

- [ ] **Step 3: Register in `ai/mod.rs`**

Add to `hadron-web/crates/hadron-core/src/ai/mod.rs`:

```rust
pub mod detect_language;
```

And add to the re-exports:

```rust
pub use detect_language::detect_language;
```

- [ ] **Step 4: Update server re-exports**

In `hadron-web/crates/hadron-server/src/ai/mod.rs`, the line `pub use hadron_core::ai::prompts::...` lists `CODE_ANALYSIS_PROMPT`. Since it's now a function not a constant, update the re-export. Read the file and update accordingly — the function `build_code_analysis_prompt` and `build_code_analysis_messages` should be accessible via the re-export `pub use hadron_core::ai::prompts::*` or add them explicitly.

- [ ] **Step 5: Run tests**

Run: `cd hadron-web && cargo test -p hadron-core 2>&1 | tail -20`
Expected: all tests pass including new detect_language tests

- [ ] **Step 6: Commit**

```bash
git add hadron-web/crates/hadron-core/src/ai/
git commit -m "feat(web): add desktop-matching code analysis prompt and language detection"
```

---

## Task 3: Backend Code Analysis Routes

**Files:**
- Create: `hadron-web/crates/hadron-server/src/routes/code_analysis.rs`
- Modify: `hadron-web/crates/hadron-server/src/routes/mod.rs`

- [ ] **Step 1: Create `code_analysis.rs`**

Create `hadron-web/crates/hadron-server/src/routes/code_analysis.rs`:

```rust
//! Code analysis handlers — AI-powered code review.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::ai;
use crate::auth::AuthenticatedUser;
use crate::sse;
use crate::AppState;

use super::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisRequest {
    pub code: String,
    pub language: Option<String>,
    pub filename: Option<String>,
    /// Optional per-request API key (falls back to server config).
    pub api_key: Option<String>,
}

const MAX_CODE_SIZE: usize = 512 * 1024; // 512 KB

/// POST /api/code-analysis — non-streaming code analysis.
pub async fn analyze_code(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CodeAnalysisRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.code.len() > MAX_CODE_SIZE {
        return Err(AppError(hadron_core::error::HadronError::FileTooLarge {
            size: req.code.len() as u64,
            max: MAX_CODE_SIZE as u64,
        }));
    }

    let filename = req.filename.unwrap_or_else(|| "untitled".to_string());
    let language = req.language.unwrap_or_else(|| {
        hadron_core::ai::detect_language(&req.code, &filename)
    });

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    let messages = hadron_core::ai::build_code_analysis_messages(&req.code, &filename, &language);

    let raw_response = ai::complete(
        &ai_config,
        messages,
        None, // prompt is embedded in the user message
    )
    .await?;

    let result = hadron_core::ai::parse_code_analysis(&raw_response)?;

    Ok(Json(result))
}

/// POST /api/code-analysis/stream — SSE streaming code analysis.
pub async fn analyze_code_stream(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CodeAnalysisRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.code.len() > MAX_CODE_SIZE {
        return Err(AppError(hadron_core::error::HadronError::FileTooLarge {
            size: req.code.len() as u64,
            max: MAX_CODE_SIZE as u64,
        }));
    }

    let filename = req.filename.unwrap_or_else(|| "untitled".to_string());
    let language = req.language.unwrap_or_else(|| {
        hadron_core::ai::detect_language(&req.code, &filename)
    });

    let ai_config = super::analyses::resolve_ai_config(
        &state.db,
        req.api_key.as_deref(),
        None,
        None,
    )
    .await?;

    let messages = hadron_core::ai::build_code_analysis_messages(&req.code, &filename, &language);

    Ok(sse::stream_ai_completion(ai_config, messages, None))
}
```

- [ ] **Step 2: Make `resolve_ai_config` pub(crate)**

In `hadron-web/crates/hadron-server/src/routes/analyses.rs`, change:

```rust
async fn resolve_ai_config(
```

to:

```rust
pub(crate) async fn resolve_ai_config(
```

- [ ] **Step 3: Register routes in `mod.rs`**

In `hadron-web/crates/hadron-server/src/routes/mod.rs`, add the module declaration:

```rust
mod code_analysis;
```

Add routes inside `api_router()`, after the analysis routes:

```rust
        // Code Analysis
        .route("/code-analysis", post(code_analysis::analyze_code))
        .route("/code-analysis/stream", post(code_analysis::analyze_code_stream))
```

- [ ] **Step 4: Build to verify**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`
Expected: compiles cleanly

- [ ] **Step 5: Commit**

```bash
git add hadron-web/crates/hadron-server/src/routes/code_analysis.rs hadron-web/crates/hadron-server/src/routes/mod.rs hadron-web/crates/hadron-server/src/routes/analyses.rs
git commit -m "feat(web): add code analysis API routes (non-streaming + SSE streaming)"
```

---

## Task 4: Frontend Types, Constants, and Language Detection

**Files:**
- Modify: `hadron-web/frontend/src/services/api.ts`
- Create: `hadron-web/frontend/src/components/code-analyzer/constants.ts`
- Create: `hadron-web/frontend/src/components/code-analyzer/detectLanguage.ts`

- [ ] **Step 1: Add types to `api.ts`**

Add these interfaces in `hadron-web/frontend/src/services/api.ts` after the existing `AiConfigTestResult` interface:

```typescript
// ============================================================================
// Code Analysis Types
// ============================================================================

export interface CodeAnalysisResult {
  summary: string;
  issues: CodeIssue[];
  walkthrough: WalkthroughSection[];
  optimizedCode: string | null;
  qualityScores: CodeQualityScores;
  glossary: GlossaryTerm[];
}

export interface CodeIssue {
  id: number;
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "error" | "best-practice";
  line: number;
  title: string;
  description: string;
  technical: string;
  fix: string;
  complexity: string;
  impact: string;
}

export interface WalkthroughSection {
  lines: string;
  title: string;
  code: string;
  whatItDoes: string;
  whyItMatters: string;
  evidence: string;
  dependencies: CodeDependency[];
  impact: string;
  testability: string;
  eli5: string;
  quality: string;
}

export interface CodeDependency {
  name: string;
  type: string;
  note: string;
}

export interface CodeQualityScores {
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

- [ ] **Step 2: Create the component directories**

Run: `mkdir -p hadron-web/frontend/src/components/code-analyzer/tabs hadron-web/frontend/src/components/code-analyzer/shared`

- [ ] **Step 3: Create `constants.ts`**

Create `hadron-web/frontend/src/components/code-analyzer/constants.ts`:

```typescript
export const MAX_FILE_SIZE_BYTES = 200_000;
export const MAX_CODE_SIZE_BYTES = 512_000;

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  sql: "SQL",
  tsx: "React",
  jsx: "React",
  ts: "TypeScript",
  js: "JavaScript",
  st: "Smalltalk",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  rb: "Ruby",
};

export const ALL_LANGUAGES = [
  "CSS", "Go", "HTML", "JSON", "Java", "JavaScript", "Markdown",
  "Plaintext", "Python", "React", "Ruby", "Rust", "SQL", "Smalltalk",
  "TypeScript", "XML", "YAML",
];
```

- [ ] **Step 4: Create `detectLanguage.ts`**

Create `hadron-web/frontend/src/components/code-analyzer/detectLanguage.ts`:

```typescript
import { LANGUAGE_EXTENSIONS } from "./constants";

export function detectLanguage(code: string, filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && LANGUAGE_EXTENSIONS[ext]) {
    return LANGUAGE_EXTENSIONS[ext];
  }

  if (/SELECT\s+.+\s+FROM\s+/i.test(code)) return "SQL";
  if (/import\s+React|from\s+['"]react['"]/i.test(code)) return "React";
  if (/def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/i.test(code)) return "Python";
  if (/\|\s*\w+\s*\||\w+\s*>>\s*\w+|ifTrue:|ifFalse:/i.test(code)) return "Smalltalk";
  if (/fn\s+\w+|let\s+mut|impl\s+/i.test(code)) return "Rust";
  if (/func\s+\w+|package\s+main/i.test(code)) return "Go";
  if (/<\w+[^>]*>|<\/\w+>/i.test(code)) return "XML";

  return "Plaintext";
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 6: Commit**

```bash
git add hadron-web/frontend/src/services/api.ts hadron-web/frontend/src/components/code-analyzer/
git commit -m "feat(web): add code analysis types, constants, and language detection"
```

---

## Task 5: Shared Components (SeverityBadge, CategoryBadge, QualityGauge)

**Files:**
- Create: `hadron-web/frontend/src/components/code-analyzer/shared/SeverityBadge.tsx`
- Create: `hadron-web/frontend/src/components/code-analyzer/shared/CategoryBadge.tsx`
- Create: `hadron-web/frontend/src/components/code-analyzer/shared/QualityGauge.tsx`

- [ ] **Step 1: Create `SeverityBadge.tsx`**

```tsx
const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  high: "bg-orange-500/20 text-orange-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-blue-500/20 text-blue-400",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity.toLowerCase()] || SEVERITY_COLORS.medium;
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {severity}
    </span>
  );
}
```

- [ ] **Step 2: Create `CategoryBadge.tsx`**

```tsx
const CATEGORY_COLORS: Record<string, string> = {
  security: "bg-red-500/20 text-red-400",
  performance: "bg-amber-500/20 text-amber-400",
  error: "bg-rose-500/20 text-rose-400",
  "best-practice": "bg-sky-500/20 text-sky-400",
};

export function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category.toLowerCase()] || CATEGORY_COLORS["best-practice"];
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {category}
    </span>
  );
}
```

- [ ] **Step 3: Create `QualityGauge.tsx`**

```tsx
function scoreColor(score: number): string {
  if (score < 40) return "#ef4444"; // red
  if (score < 70) return "#eab308"; // yellow
  return "#22c55e"; // green
}

export function QualityGauge({
  score,
  size = 80,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = scoreColor(clamped);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>
        {clamped}
      </span>
      {label && (
        <span className="text-xs text-slate-400">{label}</span>
      )}
    </div>
  );
}
```

Note: The score text overlays the SVG. Wrap both in a `relative` container in the parent for absolute positioning to work. The implementer should use `relative` on the outer `div`:

```tsx
    <div className="relative flex flex-col items-center gap-1">
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/code-analyzer/shared/
git commit -m "feat(web): add SeverityBadge, CategoryBadge, and QualityGauge shared components"
```

---

## Task 6: Tab Components (Overview, Issues, Walkthrough)

**Files:**
- Create: `hadron-web/frontend/src/components/code-analyzer/tabs/OverviewTab.tsx`
- Create: `hadron-web/frontend/src/components/code-analyzer/tabs/IssuesTab.tsx`
- Create: `hadron-web/frontend/src/components/code-analyzer/tabs/WalkthroughTab.tsx`

- [ ] **Step 1: Create `OverviewTab.tsx`**

Port from desktop. Props: `result: CodeAnalysisResult`, `onNavigateToIssue: (id: number) => void`. Shows:
- Summary text
- Critical/high issue count with click-to-navigate
- 5 quality gauges (overall, security, performance, maintainability, bestPractices)

The implementer should read the desktop version at `hadron-desktop/src/components/code-analyzer/tabs/OverviewTab.tsx` and port it, using the types from `api.ts` and the `QualityGauge` from `shared/`. Use Tailwind classes matching the existing hadron-web dark theme (slate-800 backgrounds, slate-300 text, blue-600 accents).

- [ ] **Step 2: Create `IssuesTab.tsx`**

Port from desktop. Props: `issues: CodeIssue[]`, `highlightIssueId?: number`, `externalSeverityFilter?: string | null`. Shows:
- Severity filter dropdown (all, critical, high, medium, low)
- Category filter dropdown (all, security, performance, error, best-practice)
- Expandable issue cards sorted by severity (critical first)
- Each card shows: SeverityBadge, CategoryBadge, title, line number, description, technical details, fix (with copy button), complexity, impact
- Scroll-into-view when `highlightIssueId` changes

The implementer should read `hadron-desktop/src/components/code-analyzer/tabs/IssuesTab.tsx` and port it.

- [ ] **Step 3: Create `WalkthroughTab.tsx`**

Port from desktop. Props: `sections: WalkthroughSection[]`. Shows:
- Collapsible sections, each with:
  - Title + line range header
  - Code snippet in a `<pre>` block
  - "What It Does", "Why It Matters", "Evidence" paragraphs
  - Dependencies list (name, type badge, note)
  - Impact, Testability, ELI5, Quality paragraphs

The implementer should read `hadron-desktop/src/components/code-analyzer/tabs/WalkthroughTab.tsx` and port it.

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/code-analyzer/tabs/OverviewTab.tsx hadron-web/frontend/src/components/code-analyzer/tabs/IssuesTab.tsx hadron-web/frontend/src/components/code-analyzer/tabs/WalkthroughTab.tsx
git commit -m "feat(web): add Overview, Issues, and Walkthrough tab components"
```

---

## Task 7: Tab Components (Optimized, Quality, Learn)

**Files:**
- Create: `hadron-web/frontend/src/components/code-analyzer/tabs/OptimizedTab.tsx`
- Create: `hadron-web/frontend/src/components/code-analyzer/tabs/QualityTab.tsx`
- Create: `hadron-web/frontend/src/components/code-analyzer/tabs/LearnTab.tsx`

- [ ] **Step 1: Create `OptimizedTab.tsx`**

Props: `code: string | null`. Shows:
- If code is null: centered "No improvements suggested" placeholder
- If code exists: `<pre>` code block with monospace font, copy-to-clipboard button in top-right corner
- Copy button uses `navigator.clipboard.writeText(code)`

```tsx
import { useState } from "react";

export function OptimizedTab({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!code) {
    return (
      <div className="py-12 text-center text-slate-400">
        No improvements suggested — the code looks good.
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Create `QualityTab.tsx`**

Props: `scores: CodeQualityScores`, `issues: CodeIssue[]`, `onFilterToSeverity: (severity: string) => void`. Shows:
- Large overall score gauge (size=120)
- 4 metric progress bars (security, performance, maintainability, bestPractices) with percentage labels
- Issue breakdown cards: count by severity, clickable to filter Issues tab

The implementer should read `hadron-desktop/src/components/code-analyzer/tabs/QualityTab.tsx` and port it.

- [ ] **Step 3: Create `LearnTab.tsx`**

Props: `glossary: GlossaryTerm[]`, `hasOptimizedCode: boolean`, `criticalCount: number`. Shows:
- Glossary section: term/definition pairs in a list
- "Next Steps" section: dynamic suggestions based on criticalCount and hasOptimizedCode
  - If criticalCount > 0: "Address {n} critical issues first"
  - If hasOptimizedCode: "Review the optimized code in the Optimized tab"
  - Always: "Review all issues by severity in the Issues tab"

```tsx
import type { GlossaryTerm } from "../../../services/api";

export function LearnTab({
  glossary,
  hasOptimizedCode,
  criticalCount,
}: {
  glossary: GlossaryTerm[];
  hasOptimizedCode: boolean;
  criticalCount: number;
}) {
  const nextSteps: string[] = [];
  if (criticalCount > 0) {
    nextSteps.push(`Address ${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} first`);
  }
  if (hasOptimizedCode) {
    nextSteps.push("Review the optimized code in the Optimized tab");
  }
  nextSteps.push("Review all issues by severity in the Issues tab");

  return (
    <div className="space-y-6">
      {glossary.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Glossary</h3>
          <div className="space-y-2">
            {glossary.map((g, i) => (
              <div key={i} className="rounded-md border border-slate-700 bg-slate-800/50 p-3">
                <span className="font-medium text-slate-200">{g.term}</span>
                <p className="mt-1 text-sm text-slate-400">{g.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Next Steps</h3>
        <ul className="space-y-2">
          {nextSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
              <span className="mt-0.5 text-blue-400">&#8226;</span>
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add hadron-web/frontend/src/components/code-analyzer/tabs/OptimizedTab.tsx hadron-web/frontend/src/components/code-analyzer/tabs/QualityTab.tsx hadron-web/frontend/src/components/code-analyzer/tabs/LearnTab.tsx
git commit -m "feat(web): add Optimized, Quality, and Learn tab components"
```

---

## Task 8: CodeAnalyzerView Orchestrator

**Files:**
- Create: `hadron-web/frontend/src/components/code-analyzer/CodeAnalyzerView.tsx`

- [ ] **Step 1: Create the orchestrator**

This is the main component. It manages:
- Code input (textarea + file drop)
- Language detection + manual override
- Streaming analysis via `useAiStream`
- JSON parsing of streamed result
- Tab navigation with all 6 tabs mounted (CSS hidden)

The implementer should create this component with:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { useAiStream, ChatStreamEvent } from "../../hooks/useAiStream";
import { CodeAnalysisResult } from "../../services/api";
import { detectLanguage } from "./detectLanguage";
import { ALL_LANGUAGES, MAX_FILE_SIZE_BYTES, MAX_CODE_SIZE_BYTES } from "./constants";
import { OverviewTab } from "./tabs/OverviewTab";
import { IssuesTab } from "./tabs/IssuesTab";
import { WalkthroughTab } from "./tabs/WalkthroughTab";
import { OptimizedTab } from "./tabs/OptimizedTab";
import { QualityTab } from "./tabs/QualityTab";
import { LearnTab } from "./tabs/LearnTab";
```

State:
```typescript
const [code, setCode] = useState("");
const [filename, setFilename] = useState("");
const [language, setLanguage] = useState("Plaintext");
const [activeTab, setActiveTab] = useState<string>("overview");
const [result, setResult] = useState<CodeAnalysisResult | null>(null);
const [parseError, setParseError] = useState<string | null>(null);
const [highlightIssueId, setHighlightIssueId] = useState<number | undefined>();
const [severityFilter, setSeverityFilter] = useState<string | null>(null);
const { streamAi, content, isStreaming, error, reset } = useAiStream();
```

Key behaviors:
- On code change (debounced ~300ms): `setLanguage(detectLanguage(code, filename))`
- "Analyze" button: `streamAi("/code-analysis/stream", { code, language, filename })`
- `useEffect` on `[content, isStreaming]`: when `isStreaming` becomes false and `content` is non-empty, try `JSON.parse(content)` → `setResult()`. On parse failure, try extracting JSON with `content.match(/\{[\s\S]*\}/)` first. If that also fails, `setParseError("Failed to parse...")`
- File input: `<input type="file" onChange={...}>` reads file via `FileReader`, sets `code` and `filename`. Warns if >200KB, blocks if >512KB.
- Tab bar: 6 buttons, all tabs rendered with `style={{ display: activeTab === "xxx" ? "block" : "none" }}`
- "Clear" button: `reset()`, `setResult(null)`, `setCode("")`, etc.
- `onNavigateToIssue`: `setActiveTab("issues")`, `setHighlightIssueId(id)`
- `onFilterToSeverity`: `setActiveTab("issues")`, `setSeverityFilter(severity)`

The implementer should use the dark theme (slate-800/900 backgrounds, slate-200/300 text, blue-600 buttons) consistent with the rest of hadron-web.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/code-analyzer/CodeAnalyzerView.tsx
git commit -m "feat(web): add CodeAnalyzerView orchestrator with streaming and tab navigation"
```

---

## Task 9: Wire Into App.tsx Navigation

**Files:**
- Modify: `hadron-web/frontend/src/App.tsx`

- [ ] **Step 1: Read App.tsx and make 4 changes**

Read `hadron-web/frontend/src/App.tsx` first. Then:

1. **Add import** at the top:
```typescript
import { CodeAnalyzerView } from "./components/code-analyzer/CodeAnalyzerView";
```

2. **Add to View type** — find the `type View = "analyze" | "history" | ...` union and add `"code-analyzer"`:
```typescript
type View = "analyze" | "history" | "chat" | ... | "code-analyzer";
```

3. **Add to navItems array** — add after the "analyze" entry:
```typescript
{ key: "code-analyzer", label: "Code Analyzer" },
```

4. **Add conditional render** — in the main content area where views are rendered, add:
```tsx
{activeView === "code-analyzer" && <CodeAnalyzerView />}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -10`

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/App.tsx
git commit -m "feat(web): wire Code Analyzer into navigation and routing"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Full Rust check**

Run: `cd hadron-web && SQLX_OFFLINE=true cargo check 2>&1 | tail -10`
Expected: compiles cleanly

- [ ] **Step 2: Run all Rust tests**

Run: `cd hadron-web && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 3: Run frontend type check**

Run: `cd hadron-web/frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: no type errors

- [ ] **Step 4: Verify new files exist**

Run: `ls hadron-web/crates/hadron-core/src/ai/detect_language.rs && ls hadron-web/crates/hadron-server/src/routes/code_analysis.rs && ls hadron-web/frontend/src/components/code-analyzer/CodeAnalyzerView.tsx && ls hadron-web/frontend/src/components/code-analyzer/tabs/ | wc -l`
Expected: all files exist, 6 tab files

- [ ] **Step 5: Verify route count**

Run: `grep -c "code.analysis" hadron-web/crates/hadron-server/src/routes/mod.rs`
Expected: 2 (the two route registrations)
