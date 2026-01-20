# History Tab Enhancement - Solution Design

**Version:** 1.0
**Date:** 2026-01-19
**Status:** Draft - Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Database Schema Changes](#3-database-schema-changes)
4. [Feature Specifications](#4-feature-specifications)
5. [UI/UX Design](#5-uiux-design)
6. [API Changes](#6-api-changes)
7. [Component Architecture](#7-component-architecture)
8. [Implementation Phases](#8-implementation-phases)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Executive Summary

### Objective
Transform the History tab from a simple list view into a powerful analysis management system with advanced filtering, organization, and insights capabilities.

### Key Deliverables
- Extended filtering (type, date range, tags, cost)
- Favorites management with dedicated tab
- User-defined tagging system
- Bulk operations (delete, tag, export)
- Comparison view for regression analysis
- Analytics and trend visualization
- Archive/soft-delete system

### Success Metrics
- Reduce time to find specific analysis by 70%
- Enable pattern detection across crash history
- Support enterprise reporting requirements

---

## 2. Current State Analysis

### Current Data Model

```
Analysis Table:
├── id, filename, file_size_kb
├── error_type, error_message, severity, component
├── stack_trace, root_cause, suggested_fixes, confidence
├── analyzed_at, ai_model, ai_provider
├── tokens_used, cost, was_truncated
├── analysis_duration_ms, analysis_type
├── full_data (JSON blob)
├── is_favorite, last_viewed_at, view_count
└── [NEW] analysis_mode, coverage_summary, token_utilization

Translation Table:
├── id, input_content, translation
├── translated_at, ai_model, ai_provider
├── is_favorite, last_viewed_at, view_count
└── [No type distinction for Code Analyzer]
```

### Current Features
- ✅ Tab switching (All/Analyses/Translations)
- ✅ Full-text search with debounce
- ✅ Severity filter (dropdown + pills)
- ✅ Favorites toggle per item
- ✅ Delete with confirmation
- ✅ Analytics dashboard (basic stats)
- ✅ Virtual scrolling for performance

### Gaps Identified
- ❌ No type filter (WHATS'ON/Complete/Specialized)
- ❌ No date range filter
- ❌ No user-defined tags
- ❌ No bulk operations
- ❌ No export functionality
- ❌ No comparison view
- ❌ No archive system (hard delete only)
- ❌ Code Analyzer results mixed with translations

---

## 3. Database Schema Changes

### 3.1 New Tables

```sql
-- User-defined tags
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6B7280', -- Tailwind gray-500
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    usage_count INTEGER NOT NULL DEFAULT 0
);

-- Many-to-many: Analysis <-> Tags
CREATE TABLE analysis_tags (
    analysis_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (analysis_id, tag_id),
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Many-to-many: Translation <-> Tags
CREATE TABLE translation_tags (
    translation_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (translation_id, tag_id),
    FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Archive table for soft-deleted items
CREATE TABLE archived_analyses (
    id INTEGER PRIMARY KEY,
    original_id INTEGER NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_by TEXT, -- future: user tracking
    data_json TEXT NOT NULL, -- full serialized Analysis
    restore_eligible_until TEXT -- optional auto-purge date
);

-- User notes/comments on analyses
CREATE TABLE analysis_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);
```

### 3.2 Schema Modifications

```sql
-- Add to analyses table
ALTER TABLE analyses ADD COLUMN deleted_at TEXT; -- soft delete
ALTER TABLE analyses ADD COLUMN error_signature TEXT; -- for duplicate detection
ALTER TABLE analyses ADD COLUMN source_type TEXT DEFAULT 'file'; -- 'file' | 'paste' | 'api'

-- Add to translations table
ALTER TABLE translations ADD COLUMN deleted_at TEXT;
ALTER TABLE translations ADD COLUMN translation_type TEXT DEFAULT 'technical'; -- 'technical' | 'code_analysis'

-- Indexes for new queries
CREATE INDEX idx_analyses_deleted_at ON analyses(deleted_at);
CREATE INDEX idx_analyses_error_signature ON analyses(error_signature);
CREATE INDEX idx_analyses_analyzed_at ON analyses(analyzed_at);
CREATE INDEX idx_analyses_analysis_type ON analyses(analysis_type);
CREATE INDEX idx_tags_name ON tags(name);
```

### 3.3 Migration Script

```rust
// migrations.rs - Add new migration version
pub const MIGRATION_V8_HISTORY_ENHANCEMENTS: &str = r#"
    -- Tags system
    CREATE TABLE IF NOT EXISTS tags (...);
    CREATE TABLE IF NOT EXISTS analysis_tags (...);
    CREATE TABLE IF NOT EXISTS translation_tags (...);

    -- Archive system
    CREATE TABLE IF NOT EXISTS archived_analyses (...);

    -- Notes system
    CREATE TABLE IF NOT EXISTS analysis_notes (...);

    -- Schema modifications
    ALTER TABLE analyses ADD COLUMN deleted_at TEXT;
    ALTER TABLE analyses ADD COLUMN error_signature TEXT;
    ALTER TABLE analyses ADD COLUMN source_type TEXT DEFAULT 'file';
    ALTER TABLE translations ADD COLUMN deleted_at TEXT;
    ALTER TABLE translations ADD COLUMN translation_type TEXT DEFAULT 'technical';

    -- Generate error signatures for existing data
    UPDATE analyses SET error_signature =
        error_type || ':' || COALESCE(component, 'unknown')
    WHERE error_signature IS NULL;

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_analyses_deleted_at ON analyses(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_analyses_error_signature ON analyses(error_signature);
    CREATE INDEX IF NOT EXISTS idx_analyses_analyzed_at ON analyses(analyzed_at);
"#;
```

---

## 4. Feature Specifications

### 4.1 Extended Filters

#### 4.1.1 Type Filter
```typescript
interface TypeFilter {
  analyses: {
    types: ('whatson' | 'complete' | 'specialized')[];
    modes: ('Quick' | 'Quick (Extracted)' | 'Deep Scan')[];
  };
  translations: {
    types: ('technical' | 'code_analysis')[];
  };
}
```

**UI Behavior:**
- Multi-select pills (can select multiple types)
- Persists to localStorage
- Combines with other filters (AND logic)

#### 4.1.2 Date Range Filter
```typescript
interface DateRangeFilter {
  preset: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'allTime' | 'custom';
  customRange?: {
    start: Date;
    end: Date;
  };
}
```

**Presets:**
| Preset | Query |
|--------|-------|
| Today | `analyzed_at >= date('now', 'start of day')` |
| Yesterday | `analyzed_at >= date('now', '-1 day', 'start of day') AND analyzed_at < date('now', 'start of day')` |
| Last 7 Days | `analyzed_at >= date('now', '-7 days')` |
| Last 30 Days | `analyzed_at >= date('now', '-30 days')` |
| This Month | `analyzed_at >= date('now', 'start of month')` |
| Last Month | Previous calendar month |
| Custom | User-selected range with date picker |

#### 4.1.3 Tag Filter
```typescript
interface TagFilter {
  mode: 'any' | 'all'; // OR vs AND
  tagIds: number[];
  excludeTagIds?: number[]; // "NOT tagged with"
}
```

#### 4.1.4 Cost Filter
```typescript
interface CostFilter {
  min?: number;
  max?: number;
  presets: 'under1cent' | 'under10cents' | 'over10cents' | 'custom';
}
```

#### 4.1.5 Combined Filter State
```typescript
interface HistoryFilters {
  // Existing
  search: string;
  severity: 'all' | 'critical' | 'high' | 'medium' | 'low';

  // New
  types: string[];           // ['whatson', 'complete']
  modes: string[];           // ['Quick', 'Deep Scan']
  dateRange: DateRangeFilter;
  tags: TagFilter;
  cost: CostFilter;

  // View options
  showArchived: boolean;
  showFavoritesOnly: boolean;
  groupBy: 'none' | 'date' | 'type' | 'severity' | 'errorSignature';
  sortBy: 'date' | 'severity' | 'cost' | 'fileSize' | 'name';
  sortOrder: 'asc' | 'desc';
}
```

### 4.2 Favorites System Enhancement

**Current:** Simple boolean toggle per item

**Enhanced:**
- Dedicated "Favorites" tab
- Favorites count in tab label
- Quick filter pill on other tabs
- Keyboard shortcut (F key) to toggle

### 4.3 Tagging System

#### Tag Management
```typescript
interface Tag {
  id: number;
  name: string;
  color: string; // Hex color
  usageCount: number;
  createdAt: string;
}

// Predefined color palette
const TAG_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#6B7280', // gray
];
```

#### Tag Operations
- Create tag (name + color)
- Rename tag
- Change tag color
- Delete tag (with confirmation, removes from all items)
- Merge tags (combine two tags into one)

#### Tagging Items
- Click tag icon on list item → tag picker dropdown
- Bulk select → "Add Tag" / "Remove Tag"
- Quick-add: Type new tag name in picker to create

### 4.4 Bulk Operations

```typescript
interface BulkOperation {
  type: 'delete' | 'archive' | 'addTag' | 'removeTag' | 'export' | 'favorite' | 'unfavorite';
  itemIds: number[];
  itemType: 'analysis' | 'translation';
  payload?: {
    tagId?: number;
    exportFormat?: 'csv' | 'json' | 'markdown';
  };
}
```

**UI Flow:**
1. Enter selection mode (checkbox appears on each item)
2. Select items (click or Shift+click for range)
3. Bulk action bar appears at bottom
4. Choose action → confirmation → execute

### 4.5 Comparison View

**Purpose:** Compare two analyses side-by-side to identify:
- Regression patterns
- Fix verification
- Environment differences

```typescript
interface ComparisonState {
  leftAnalysisId: number;
  rightAnalysisId: number;
  diffMode: 'sideBySide' | 'unified';
  sections: {
    errorInfo: boolean;
    rootCause: boolean;
    suggestedFixes: boolean;
    stackTrace: boolean;
    metadata: boolean;
  };
}
```

**Diff Highlights:**
- Green: Present only in right (newer)
- Red: Present only in left (older)
- Yellow: Changed between versions

### 4.6 Archive System

**Soft Delete Flow:**
1. User clicks delete
2. Item moves to "Archived" (sets `deleted_at`)
3. Archived items hidden by default
4. "Show Archived" toggle reveals them (grayed out)
5. Can restore or permanently delete

**Auto-Purge (Optional):**
- Archives older than 90 days auto-purged
- Configurable in settings
- Warning before purge

### 4.7 Notes/Comments

```typescript
interface AnalysisNote {
  id: number;
  analysisId: number;
  content: string;
  createdAt: string;
  updatedAt?: string;
}
```

**Features:**
- Add/edit/delete notes on any analysis
- Markdown support (basic)
- Searchable (include notes in search)
- Show note indicator icon on list item

### 4.8 Duplicate/Similar Detection

**Error Signature Generation:**
```rust
fn generate_error_signature(analysis: &Analysis) -> String {
    // Normalize and hash key identifying features
    let normalized_error = analysis.error_type.to_lowercase().trim();
    let normalized_component = analysis.component
        .as_ref()
        .map(|c| c.to_lowercase().trim())
        .unwrap_or("unknown");

    format!("{}:{}", normalized_error, normalized_component)
}
```

**UI Indication:**
- Badge showing "3 similar" on list items
- Click to filter by same signature
- Group view option to collapse duplicates

### 4.9 Analytics Enhancements

#### Trend Chart
```typescript
interface TrendData {
  period: 'day' | 'week' | 'month';
  data: {
    date: string;
    total: number;
    bySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    byType: {
      whatson: number;
      complete: number;
      specialized: number;
    };
  }[];
}
```

#### Cost Summary
```typescript
interface CostSummary {
  period: string;
  totalCost: number;
  averageCost: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
}
```

### 4.10 Export Functionality

**Formats:**
| Format | Use Case |
|--------|----------|
| CSV | Spreadsheet analysis, reporting |
| JSON | API integration, backup |
| Markdown | Documentation, sharing |
| PDF | Formal reports (future) |

**Export Options:**
```typescript
interface ExportOptions {
  format: 'csv' | 'json' | 'markdown';
  items: 'selected' | 'filtered' | 'all';
  fields: string[]; // Which fields to include
  includeNotes: boolean;
  includeTags: boolean;
  dateRange?: DateRangeFilter;
}
```

---

## 5. UI/UX Design

### 5.1 Updated Tab Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  History                                          [Export ▼]    │
├─────────────────────────────────────────────────────────────────┤
│  [All (156)] [Analyses (142)] [Translations (14)] [⭐ Fav (8)]  │
├─────────────────────────────────────────────────────────────────┤
│  🔍 Search...                          [Type ▼] [Date ▼] [More▼]│
├─────────────────────────────────────────────────────────────────┤
│  Quick: [All] [Critical] [High] [Medium] [Low]                  │
│  Types: [WHATS'ON] [Complete] [Specialized]  [Clear Filters]    │
│  Tags:  [#production] [#resolved] [+]                           │
├─────────────────────────────────────────────────────────────────┤
│  ☐ Select All (156 items)    Sort: [Date ▼] [↓]    Group: [None]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ crash_log_001.txt        [CRITICAL] [WHATS'ON] [Quick]│   │
│  │   Error: ORA-00060         #production  #investigating  │   │
│  │   Cause: Deadlock detected in transaction...            │   │
│  │   Jan 19, 2026 • 245 KB • $0.0234      [📝] [⭐] [👁] [🗑]│   │
│  │   ⚠️ 3 similar crashes found                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ error_20260118.log       [HIGH] [COMPLETE]            │   │
│  │   Error: MessageNotUnderstood    #staging               │   │
│  │   ...                                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Load More (20 of 156)]                                        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓░░  3 selected    [Add Tag] [Delete] [Compare] [✕]   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Filter Panel (Expanded "More" Dropdown)

```
┌─────────────────────────────────────┐
│  Advanced Filters                   │
├─────────────────────────────────────┤
│  Date Range                         │
│  ○ Today                            │
│  ○ Yesterday                        │
│  ○ Last 7 days                      │
│  ○ Last 30 days                     │
│  ○ This month                       │
│  ● Custom: [Jan 1] to [Jan 19]      │
├─────────────────────────────────────┤
│  Cost Range                         │
│  Min: [$0.00    ] Max: [$1.00    ]  │
│  Quick: [<1¢] [<10¢] [>10¢]         │
├─────────────────────────────────────┤
│  Analysis Mode                      │
│  ☑ Quick                            │
│  ☑ Quick (Extracted)                │
│  ☑ Deep Scan                        │
├─────────────────────────────────────┤
│  Options                            │
│  ☐ Show archived items              │
│  ☐ Favorites only                   │
├─────────────────────────────────────┤
│  [Reset All]              [Apply]   │
└─────────────────────────────────────┘
```

### 5.3 Tag Manager Modal

```
┌─────────────────────────────────────────────┐
│  Manage Tags                           [✕]  │
├─────────────────────────────────────────────┤
│  + Create New Tag                           │
│  ┌─────────────────────────────────────┐    │
│  │ Tag name: [_________________]       │    │
│  │ Color:    [●] [●] [●] [●] [●] [●]  │    │
│  │                          [Create]   │    │
│  └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│  Existing Tags                              │
│                                             │
│  🔴 production (24 items)      [Edit] [🗑]  │
│  🟢 resolved (18 items)        [Edit] [🗑]  │
│  🟡 investigating (7 items)    [Edit] [🗑]  │
│  🔵 staging (12 items)         [Edit] [🗑]  │
│  ⚫ needs-review (3 items)     [Edit] [🗑]  │
│                                             │
├─────────────────────────────────────────────┤
│                              [Done]         │
└─────────────────────────────────────────────┘
```

### 5.4 Comparison View

```
┌─────────────────────────────────────────────────────────────────┐
│  Compare Analyses                                          [✕]  │
├─────────────────────────────────────────────────────────────────┤
│  [◀ Older]  crash_001.txt  ←→  crash_002.txt  [Newer ▶]        │
│  Jan 15, 2026              vs   Jan 19, 2026                    │
├────────────────────────────┬────────────────────────────────────┤
│  ERROR TYPE                │  ERROR TYPE                        │
│  ORA-00060: Deadlock       │  ORA-00060: Deadlock               │
│  ✓ Same                    │                                    │
├────────────────────────────┼────────────────────────────────────┤
│  SEVERITY                  │  SEVERITY                          │
│  🔴 CRITICAL               │  🟠 HIGH                           │
│  ⚠️ Changed                │                                    │
├────────────────────────────┼────────────────────────────────────┤
│  ROOT CAUSE                │  ROOT CAUSE                        │
│  Transaction lock timeout  │  Transaction lock timeout          │
│  in BM.Schedule>>save      │  in BM.Schedule>>saveWithRetry    │
│                            │  + Added retry logic               │
├────────────────────────────┼────────────────────────────────────┤
│  SUGGESTED FIXES           │  SUGGESTED FIXES                   │
│  1. Add retry logic ────────→ ✓ Implemented                    │
│  2. Increase timeout       │  1. Increase timeout               │
│  3. Review lock order      │  2. Review lock order              │
├────────────────────────────┴────────────────────────────────────┤
│  Summary: 1 fix implemented, severity reduced                   │
│                                    [Export Comparison] [Close]  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.5 Analytics Dashboard (Enhanced)

```
┌─────────────────────────────────────────────────────────────────┐
│  Analytics                                    Period: [Last 30d]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │   156    │ │    8     │ │  $4.82   │ │   23%    │           │
│  │  Total   │ │ Critical │ │  Cost    │ │ ↓ vs last│           │
│  │ Analyses │ │  Issues  │ │ (30 days)│ │  period  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                 │
│  Crash Trend (Last 30 Days)                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │     ▄                                                   │   │
│  │   ▄ █ ▄     ▄                           ▄               │   │
│  │ ▄ █ █ █   ▄ █ ▄   ▄       ▄   ▄       ▄ █ ▄           │   │
│  │ █ █ █ █ ▄ █ █ █ ▄ █ ▄   ▄ █ ▄ █ ▄   ▄ █ █ █ ▄       │   │
│  │ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   │   │
│  │ 1/1        1/8         1/15        1/22        1/29    │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [■ Critical  ■ High  ■ Medium  ■ Low]                         │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ By Type             │  │ Top Error Patterns  │              │
│  │ ████████░░ WHATS'ON │  │ ORA-00060      (12) │              │
│  │ ██████░░░░ Complete │  │ MNU            (8)  │              │
│  │ ██░░░░░░░░ Special. │  │ Timeout        (6)  │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. API Changes

### 6.1 New Rust Commands

```rust
// ============================================================================
// Tag Management
// ============================================================================

#[tauri::command]
pub async fn create_tag(name: String, color: String, db: DbState<'_>) -> Result<Tag, String>;

#[tauri::command]
pub async fn update_tag(id: i64, name: Option<String>, color: Option<String>, db: DbState<'_>) -> Result<Tag, String>;

#[tauri::command]
pub async fn delete_tag(id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn get_all_tags(db: DbState<'_>) -> Result<Vec<Tag>, String>;

#[tauri::command]
pub async fn add_tag_to_analysis(analysis_id: i64, tag_id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn remove_tag_from_analysis(analysis_id: i64, tag_id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn get_tags_for_analysis(analysis_id: i64, db: DbState<'_>) -> Result<Vec<Tag>, String>;

// ============================================================================
// Advanced Filtering
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AdvancedFilterOptions {
    pub search: Option<String>,
    pub severity: Option<Vec<String>>,
    pub analysis_types: Option<Vec<String>>,
    pub analysis_modes: Option<Vec<String>>,
    pub tag_ids: Option<Vec<i64>>,
    pub tag_mode: Option<String>, // "any" | "all"
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub cost_min: Option<f64>,
    pub cost_max: Option<f64>,
    pub include_archived: Option<bool>,
    pub favorites_only: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[tauri::command]
pub async fn get_analyses_filtered(
    options: AdvancedFilterOptions,
    db: DbState<'_>
) -> Result<FilteredResults<Analysis>, String>;

#[derive(Serialize)]
pub struct FilteredResults<T> {
    pub items: Vec<T>,
    pub total_count: i64,
    pub page: i64,
    pub page_size: i64,
    pub has_more: bool,
}

// ============================================================================
// Archive System
// ============================================================================

#[tauri::command]
pub async fn archive_analysis(id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn restore_analysis(id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn permanently_delete_analysis(id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn get_archived_analyses(db: DbState<'_>) -> Result<Vec<ArchivedAnalysis>, String>;

// ============================================================================
// Notes System
// ============================================================================

#[tauri::command]
pub async fn add_note_to_analysis(
    analysis_id: i64,
    content: String,
    db: DbState<'_>
) -> Result<AnalysisNote, String>;

#[tauri::command]
pub async fn update_note(id: i64, content: String, db: DbState<'_>) -> Result<AnalysisNote, String>;

#[tauri::command]
pub async fn delete_note(id: i64, db: DbState<'_>) -> Result<(), String>;

#[tauri::command]
pub async fn get_notes_for_analysis(analysis_id: i64, db: DbState<'_>) -> Result<Vec<AnalysisNote>, String>;

// ============================================================================
// Bulk Operations
// ============================================================================

#[tauri::command]
pub async fn bulk_delete_analyses(ids: Vec<i64>, db: DbState<'_>) -> Result<BulkResult, String>;

#[tauri::command]
pub async fn bulk_archive_analyses(ids: Vec<i64>, db: DbState<'_>) -> Result<BulkResult, String>;

#[tauri::command]
pub async fn bulk_add_tag(
    analysis_ids: Vec<i64>,
    tag_id: i64,
    db: DbState<'_>
) -> Result<BulkResult, String>;

#[tauri::command]
pub async fn bulk_remove_tag(
    analysis_ids: Vec<i64>,
    tag_id: i64,
    db: DbState<'_>
) -> Result<BulkResult, String>;

#[derive(Serialize)]
pub struct BulkResult {
    pub success_count: i64,
    pub failure_count: i64,
    pub failures: Vec<BulkFailure>,
}

// ============================================================================
// Analytics
// ============================================================================

#[tauri::command]
pub async fn get_trend_data(
    period: String, // "day" | "week" | "month"
    range_days: i32,
    db: DbState<'_>
) -> Result<Vec<TrendDataPoint>, String>;

#[tauri::command]
pub async fn get_cost_summary(
    date_from: Option<String>,
    date_to: Option<String>,
    db: DbState<'_>
) -> Result<CostSummary, String>;

#[tauri::command]
pub async fn get_similar_analyses(
    analysis_id: i64,
    db: DbState<'_>
) -> Result<Vec<Analysis>, String>;

// ============================================================================
// Export
// ============================================================================

#[tauri::command]
pub async fn export_analyses(
    options: ExportOptions,
    db: DbState<'_>
) -> Result<String, String>; // Returns file path or content based on format
```

### 6.2 TypeScript API Layer

```typescript
// services/api.ts additions

// Tags
export async function createTag(name: string, color: string): Promise<Tag>;
export async function updateTag(id: number, updates: Partial<Tag>): Promise<Tag>;
export async function deleteTag(id: number): Promise<void>;
export async function getAllTags(): Promise<Tag[]>;
export async function addTagToAnalysis(analysisId: number, tagId: number): Promise<void>;
export async function removeTagFromAnalysis(analysisId: number, tagId: number): Promise<void>;
export async function getTagsForAnalysis(analysisId: number): Promise<Tag[]>;

// Advanced Filtering
export async function getAnalysesFiltered(options: AdvancedFilterOptions): Promise<FilteredResults<Analysis>>;

// Archive
export async function archiveAnalysis(id: number): Promise<void>;
export async function restoreAnalysis(id: number): Promise<void>;
export async function permanentlyDeleteAnalysis(id: number): Promise<void>;

// Notes
export async function addNoteToAnalysis(analysisId: number, content: string): Promise<AnalysisNote>;
export async function updateNote(id: number, content: string): Promise<AnalysisNote>;
export async function deleteNote(id: number): Promise<void>;
export async function getNotesForAnalysis(analysisId: number): Promise<AnalysisNote[]>;

// Bulk
export async function bulkDeleteAnalyses(ids: number[]): Promise<BulkResult>;
export async function bulkArchiveAnalyses(ids: number[]): Promise<BulkResult>;
export async function bulkAddTag(analysisIds: number[], tagId: number): Promise<BulkResult>;

// Analytics
export async function getTrendData(period: string, rangeDays: number): Promise<TrendDataPoint[]>;
export async function getCostSummary(dateFrom?: string, dateTo?: string): Promise<CostSummary>;
export async function getSimilarAnalyses(analysisId: number): Promise<Analysis[]>;

// Export
export async function exportAnalyses(options: ExportOptions): Promise<string>;
```

---

## 7. Component Architecture

### 7.1 New Components

```
src/components/
├── history/
│   ├── HistoryView.tsx           # Main container (refactored)
│   ├── HistoryFilters.tsx        # Filter bar component
│   ├── AdvancedFilterPanel.tsx   # Expanded filter options
│   ├── HistoryListItem.tsx       # Individual item (enhanced)
│   ├── BulkActionBar.tsx         # Bottom action bar
│   ├── TagPicker.tsx             # Tag selection dropdown
│   ├── TagManager.tsx            # Tag CRUD modal
│   ├── TagBadge.tsx              # Individual tag display
│   ├── DateRangePicker.tsx       # Date filter component
│   ├── ComparisonView.tsx        # Side-by-side comparison
│   ├── NotesPanel.tsx            # Notes for an analysis
│   ├── SimilarCrashesIndicator.tsx
│   └── AnalyticsDashboard.tsx    # Enhanced analytics
├── shared/
│   ├── MultiSelect.tsx           # Reusable multi-select
│   ├── DatePicker.tsx            # Single date picker
│   └── ColorPicker.tsx           # For tag colors
```

### 7.2 State Management

```typescript
// hooks/useHistoryState.ts

interface HistoryState {
  // Data
  analyses: Analysis[];
  translations: Translation[];
  tags: Tag[];

  // Filters
  filters: HistoryFilters;

  // UI State
  currentTab: 'all' | 'analyses' | 'translations' | 'favorites';
  selectedIds: Set<number>;
  selectionMode: boolean;
  loading: boolean;
  error: string | null;

  // Pagination
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;

  // Modals
  tagManagerOpen: boolean;
  comparisonOpen: boolean;
  comparisonIds: [number, number] | null;
  advancedFiltersOpen: boolean;
}

type HistoryAction =
  | { type: 'SET_FILTERS'; payload: Partial<HistoryFilters> }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_TAB'; payload: string }
  | { type: 'TOGGLE_SELECTION'; payload: number }
  | { type: 'SELECT_ALL' }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'ENTER_SELECTION_MODE' }
  | { type: 'EXIT_SELECTION_MODE' }
  | { type: 'LOAD_SUCCESS'; payload: FilteredResults<Analysis> }
  | { type: 'LOAD_ERROR'; payload: string }
  | { type: 'OPEN_COMPARISON'; payload: [number, number] }
  | { type: 'CLOSE_COMPARISON' }
  // ... etc

export function useHistoryState() {
  const [state, dispatch] = useReducer(historyReducer, initialState);

  // Memoized actions
  const actions = useMemo(() => ({
    setFilters: (filters: Partial<HistoryFilters>) =>
      dispatch({ type: 'SET_FILTERS', payload: filters }),
    resetFilters: () => dispatch({ type: 'RESET_FILTERS' }),
    // ... etc
  }), []);

  // Load data effect
  useEffect(() => {
    loadData(state.filters, state.page);
  }, [state.filters, state.page, state.currentTab]);

  return { state, actions };
}
```

### 7.3 Filter Persistence

```typescript
// hooks/useFilterPersistence.ts

const FILTER_STORAGE_KEY = 'hadron_history_filters';

export function useFilterPersistence(filters: HistoryFilters) {
  // Save to localStorage on change
  useEffect(() => {
    const serializable = {
      ...filters,
      // Exclude transient state
      search: undefined,
    };
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(serializable));
  }, [filters]);

  // Load on mount
  const loadSavedFilters = useCallback((): Partial<HistoryFilters> => {
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  return { loadSavedFilters };
}
```

---

## 8. Implementation Phases

### Phase 1: Foundation (Day 1)
**Estimated: 4-6 hours**

- [ ] Database migration (tags, archive, notes tables)
- [ ] Tag CRUD API commands
- [ ] Tag TypeScript types and API functions
- [ ] TagBadge component
- [ ] TagPicker component
- [ ] Basic tag display on list items

### Phase 2: Filtering (Day 2)
**Estimated: 4-6 hours**

- [ ] AdvancedFilterOptions Rust struct
- [ ] `get_analyses_filtered` command
- [ ] HistoryFilters TypeScript interface
- [ ] DateRangePicker component
- [ ] AdvancedFilterPanel component
- [ ] Filter persistence to localStorage
- [ ] Type filter pills

### Phase 3: Bulk Operations (Day 3)
**Estimated: 3-4 hours**

- [ ] Selection mode state
- [ ] Bulk API commands
- [ ] BulkActionBar component
- [ ] Shift+click range selection
- [ ] Bulk delete/archive/tag

### Phase 4: Archive & Notes (Day 4)
**Estimated: 3-4 hours**

- [ ] Archive system implementation
- [ ] Restore functionality
- [ ] Notes CRUD API
- [ ] NotesPanel component
- [ ] Note indicator on list items

### Phase 5: Comparison & Analytics (Day 5)
**Estimated: 4-5 hours**

- [ ] Comparison view component
- [ ] Diff highlighting logic
- [ ] Enhanced analytics dashboard
- [ ] Trend chart (basic)
- [ ] Similar crash detection

### Phase 6: Export & Polish (Day 6)
**Estimated: 3-4 hours**

- [ ] Export API commands
- [ ] Export dialog component
- [ ] CSV/JSON/Markdown formatters
- [ ] Keyboard shortcuts
- [ ] Performance optimization
- [ ] Testing & bug fixes

---

## 9. Testing Strategy

### Unit Tests

```typescript
// Filter logic
describe('HistoryFilters', () => {
  it('should combine multiple severity filters with OR');
  it('should combine type filters with OR');
  it('should combine tag filters based on mode');
  it('should correctly calculate date ranges');
  it('should persist and restore filters');
});

// Tag operations
describe('Tags', () => {
  it('should create tag with valid name');
  it('should prevent duplicate tag names');
  it('should cascade delete tag from all analyses');
  it('should update usage count correctly');
});
```

### Integration Tests

```typescript
// E2E with Playwright
describe('History Tab', () => {
  it('should filter by multiple criteria');
  it('should bulk select and delete');
  it('should add and remove tags');
  it('should archive and restore');
  it('should compare two analyses');
  it('should export filtered results');
});
```

### Performance Tests

```typescript
describe('Performance', () => {
  it('should handle 10,000 items without lag');
  it('should filter 10,000 items in <100ms');
  it('should render incremental list smoothly');
});
```

---

## Appendix A: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `F` | Toggle favorite (when item focused) |
| `T` | Open tag picker (when item focused) |
| `Delete` | Delete selected items |
| `Ctrl+A` | Select all visible |
| `Escape` | Clear selection / close modal |
| `Ctrl+E` | Export filtered |
| `Ctrl+Shift+F` | Open advanced filters |

---

## Appendix B: Color Palette for Tags

```typescript
export const TAG_COLORS = {
  red: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', hex: '#EF4444' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', hex: '#F97316' },
  amber: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', hex: '#F59E0B' },
  yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', hex: '#EAB308' },
  lime: { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30', hex: '#84CC16' },
  green: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', hex: '#22C55E' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', hex: '#10B981' },
  teal: { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30', hex: '#14B8A6' },
  cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', hex: '#06B6D4' },
  sky: { bg: 'bg-sky-500/20', text: 'text-sky-400', border: 'border-sky-500/30', hex: '#0EA5E9' },
  blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', hex: '#3B82F6' },
  indigo: { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30', hex: '#6366F1' },
  violet: { bg: 'bg-violet-500/20', text: 'text-violet-400', border: 'border-violet-500/30', hex: '#8B5CF6' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', hex: '#A855F7' },
  fuchsia: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-400', border: 'border-fuchsia-500/30', hex: '#D946EF' },
  pink: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', hex: '#EC4899' },
  rose: { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/30', hex: '#F43F5E' },
  gray: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30', hex: '#6B7280' },
};
```

---

## Appendix C: Default Tags (Pre-seeded)

```sql
INSERT INTO tags (name, color) VALUES
  ('production', '#EF4444'),    -- red
  ('staging', '#F97316'),       -- orange
  ('development', '#22C55E'),   -- green
  ('resolved', '#10B981'),      -- emerald
  ('investigating', '#EAB308'), -- yellow
  ('needs-review', '#8B5CF6'),  -- violet
  ('recurring', '#EC4899'),     -- pink
  ('critical-path', '#DC2626'); -- dark red
```

---

**Document Status:** Ready for implementation review
**Next Steps:** Prioritize phases, assign tasks, begin Phase 1
