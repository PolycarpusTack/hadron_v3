# WHATS'ON Crash Analyzer - Implementation Specification

## Document Overview
This document provides a complete implementation roadmap for building an intelligent crash analysis tool for WHATS'ON (VisualWorks Smalltalk application). The system combines automated parsing, AI-powered analysis, and user-friendly presentation.

**Target Users:** Support Engineers, Developers, QA Team, Product Support
**Technology Stack:** Rust Backend, Tauri Desktop App, SQLite/PostgreSQL, Claude/OpenAI API

---

# ARCHITECTURE OVERVIEW

## Technology Choices

### Desktop Application: Tauri + React
```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Application                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────┐ │
│  │   React/TS UI   │◄──►│      Tauri Commands         │ │
│  │   (WebView)     │    │   (Rust ↔ JS Bridge)        │ │
│  └─────────────────┘    └─────────────────────────────┘ │
│                                   │                      │
│  ┌────────────────────────────────▼────────────────────┐│
│  │                   Rust Core                          ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ││
│  │  │  Parser  │ │ Analyzer │ │ AI Client│ │Database│ ││
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘ ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Why Rust/Tauri?
- **Performance:** Native parsing of large crash files
- **Security:** Memory-safe handling of untrusted input
- **Distribution:** Single binary, no runtime dependencies
- **Cross-platform:** Windows, macOS, Linux from one codebase
- **Small footprint:** ~10MB vs ~150MB+ Electron

---

# EPIC 1: CRASH FILE PARSING ENGINE (Rust)

## Description
Build a robust, high-performance parser in Rust that extracts structured data from WHATS'ON crash dump files (WCR_*.txt format). The parser must handle all known sections and produce a normalized structure for downstream processing.

---

### TASK 1.1: Rust Parser Core

#### SUBTASK 1.1.1: Project Structure
```
src/
├── parser/
│   ├── mod.rs              # Parser module exports
│   ├── crash_file.rs       # Main CrashFile struct
│   ├── sections/
│   │   ├── mod.rs
│   │   ├── header.rs       # System header parsing
│   │   ├── environment.rs  # Environment info
│   │   ├── exception.rs    # Exception details
│   │   ├── stack_trace.rs  # Stack trace parsing
│   │   ├── context.rs      # Context arguments
│   │   ├── windows.rs      # Open windows
│   │   ├── processes.rs    # Process lists
│   │   ├── database.rs     # DB connections/sessions
│   │   ├── memory.rs       # Memory report
│   │   └── walkback.rs     # Full walkback parsing
│   ├── patterns.rs         # Regex patterns
│   └── errors.rs           # Parser error types
├── analyzer/
│   ├── mod.rs
│   ├── ai_client.rs        # LLM API client
│   ├── prompts.rs          # Prompt templates
│   ├── rules.rs            # Rule-based analysis
│   └── patterns.rs         # Known crash patterns
├── models/
│   ├── mod.rs
│   ├── crash.rs            # Core data models
│   ├── analysis.rs         # Analysis result models
│   └── export.rs           # Export format models
├── db/
│   ├── mod.rs
│   ├── schema.rs           # Database schema
│   └── queries.rs          # SQL queries
├── commands.rs             # Tauri commands
├── lib.rs
└── main.rs
```

---

#### SUBTASK 1.1.2: Core Data Structures

```rust
// src/models/crash.rs

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashFile {
    pub header: CrashHeader,
    pub environment: Environment,
    pub exception: Exception,
    pub active_process: Option<Process>,
    pub stack_trace: Vec<StackFrame>,
    pub context: Option<ContextArguments>,
    pub windows: Vec<OpenWindow>,
    pub processes: ProcessLists,
    pub database: DatabaseState,
    pub memory: MemoryReport,
    pub command_line: Option<String>,
    pub walkback: Option<String>,  // Raw walkback for AI analysis
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashHeader {
    pub timestamp: DateTime<Utc>,
    pub dump_complete: bool,
    pub file_name: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub user: String,
    pub site: String,
    pub version: String,
    pub build: String,
    pub db_hash: Option<String>,
    pub smalltalk_version: String,
    pub computer_name: String,
    pub os_user: String,
    pub time_zone: String,
    pub frame_rate: Option<String>,
    pub frame_rate_mode: Option<String>,
    pub oracle_server: Option<String>,
    pub oracle_client: Option<String>,
    pub db_encoding: Option<String>,
    pub citrix_session: Option<String>,
    pub custom_fields: HashMap<String, String>,  // Extensible
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exception {
    pub exception_type: String,
    pub message: String,
    pub parameter: Option<String>,
    pub signal_name: Option<String>,
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFrame {
    pub frame_number: u32,
    pub method_signature: String,
    pub class_name: Option<String>,
    pub parent_class: Option<String>,
    pub method_name: Option<String>,
    pub namespace: Option<String>,
    pub is_optimized: bool,
    pub is_block_closure: bool,
    pub frame_type: FrameType,
    pub source_position: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FrameType {
    Error,       // Exception-related frames
    Application, // MediaGeniX.* or custom namespaces
    Framework,   // VisualWorks core
    Database,    // Oracle/EXDI related
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextArguments {
    pub receiver: Option<ObjectSnapshot>,
    pub arguments: Vec<ArgumentValue>,
    pub temporaries: Vec<TemporaryValue>,
    pub instance_variables: Vec<InstanceVariable>,
    pub related_objects: Vec<BusinessObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectSnapshot {
    pub class_name: String,
    pub print_string: Option<String>,
    pub object_id: Option<String>,
    pub collection_contents: Option<Vec<String>>,
    pub collection_size: Option<usize>,
    pub first_index: Option<usize>,
    pub last_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessObject {
    pub class_name: String,
    pub object_id: Option<String>,
    pub properties: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseState {
    pub connections: Vec<DbConnection>,
    pub sessions: Vec<DbSession>,
    pub has_active_transaction: bool,
    pub transaction_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbConnection {
    pub hash: String,
    pub state: ConnectionState,
    pub username: String,
    pub environment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionState {
    ActiveTransaction,  // xactYes
    NoTransaction,      // xactNo
    New,
    Unknown(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryReport {
    pub spaces: Vec<MemorySpace>,
    pub total_used: String,
    pub config_limit: String,
    pub growth_limit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySpace {
    pub name: String,  // Eden, Survivor, Large, Old, Perm
    pub size: String,
    pub percent: f32,
}
```

---

#### SUBTASK 1.1.3: Section Parsers

```rust
// src/parser/sections/stack_trace.rs

use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    static ref FRAME_PATTERN: Regex = Regex::new(
        r"^\[(\d+)\]\s+(.+)$"
    ).unwrap();
    
    static ref METHOD_PATTERN: Regex = Regex::new(
        r"^(?:optimized\s+)?(?:\[\]\s+in\s+)*(?:(\w+(?:\.\w+)*)\.)?([\w<>]+)(?:\((\w+)\))?>>(\S+)"
    ).unwrap();
}

pub fn parse_stack_trace(content: &str) -> Vec<StackFrame> {
    let mut frames = Vec::new();
    
    for line in content.lines() {
        if let Some(caps) = FRAME_PATTERN.captures(line.trim()) {
            let frame_num: u32 = caps[1].parse().unwrap_or(0);
            let method_sig = &caps[2];
            
            let frame = parse_method_signature(frame_num, method_sig);
            frames.push(frame);
        }
    }
    
    frames
}

fn parse_method_signature(frame_number: u32, signature: &str) -> StackFrame {
    let is_optimized = signature.starts_with("optimized");
    let is_block = signature.contains("[] in");
    
    let frame_type = classify_frame(signature);
    
    // Extract class and method from signature
    let (class_name, parent_class, method_name, namespace) = 
        extract_method_parts(signature);
    
    StackFrame {
        frame_number,
        method_signature: signature.to_string(),
        class_name,
        parent_class,
        method_name,
        namespace,
        is_optimized,
        is_block_closure: is_block,
        frame_type,
        source_position: None,
    }
}

fn classify_frame(signature: &str) -> FrameType {
    // Error indicators
    if signature.contains("Error") || 
       signature.contains("Exception") ||
       signature.contains("signal") ||
       signature.contains("subscriptBounds") {
        return FrameType::Error;
    }
    
    // Application code (MediaGeniX namespace)
    if signature.contains("MediaGeniX.") {
        return FrameType::Application;
    }
    
    // Database related
    if signature.contains("EXDI") || 
       signature.contains("Oracle") ||
       signature.contains("Database") {
        return FrameType::Database;
    }
    
    // Everything else is framework
    FrameType::Framework
}
```

---

#### SUBTASK 1.1.4: Main Parser Implementation

```rust
// src/parser/crash_file.rs

use std::path::Path;
use tokio::fs;
use anyhow::Result;

pub struct CrashFileParser {
    patterns: ParserPatterns,
}

impl CrashFileParser {
    pub fn new() -> Self {
        Self {
            patterns: ParserPatterns::new(),
        }
    }
    
    pub async fn parse_file(&self, path: &Path) -> Result<CrashFile> {
        let content = fs::read_to_string(path).await?;
        self.parse_content(&content, path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown"))
    }
    
    pub fn parse_content(&self, content: &str, filename: &str) -> Result<CrashFile> {
        // Split into sections
        let sections = self.split_sections(content)?;
        
        // Parse each section
        let header = self.parse_header(&sections, filename)?;
        let environment = self.parse_environment(&sections)?;
        let exception = self.parse_exception(&sections)?;
        let stack_trace = self.parse_stack_trace(&sections)?;
        let context = self.parse_context(&sections)?;
        let windows = self.parse_windows(&sections)?;
        let processes = self.parse_processes(&sections)?;
        let database = self.parse_database(&sections)?;
        let memory = self.parse_memory(&sections)?;
        
        Ok(CrashFile {
            header,
            environment,
            exception,
            active_process: self.parse_active_process(&sections)?,
            stack_trace,
            context,
            windows,
            processes,
            database,
            memory,
            command_line: sections.get("command_line").cloned(),
            walkback: sections.get("walkback").cloned(),
        })
    }
    
    fn split_sections(&self, content: &str) -> Result<HashMap<String, String>> {
        let mut sections = HashMap::new();
        let mut current_section = String::new();
        let mut current_content = String::new();
        
        for line in content.lines() {
            if let Some(section_name) = self.patterns.detect_section(line) {
                if !current_section.is_empty() {
                    sections.insert(current_section.clone(), current_content.clone());
                }
                current_section = section_name;
                current_content.clear();
            } else {
                current_content.push_str(line);
                current_content.push('\n');
            }
        }
        
        // Don't forget the last section
        if !current_section.is_empty() {
            sections.insert(current_section, current_content);
        }
        
        Ok(sections)
    }
}
```

---

### TASK 1.2: Tauri Commands

#### SUBTASK 1.2.1: Command Definitions

```rust
// src/commands.rs

use tauri::State;
use crate::parser::CrashFileParser;
use crate::analyzer::CrashAnalyzer;
use crate::models::{CrashFile, AnalysisResult};

#[derive(Clone, serde::Serialize)]
pub struct AnalysisProgress {
    pub file_id: String,
    pub stage: String,
    pub progress: u8,
    pub message: String,
}

#[tauri::command]
pub async fn parse_crash_file(
    path: String,
    parser: State<'_, CrashFileParser>,
) -> Result<CrashFile, String> {
    parser.parse_file(Path::new(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn analyze_crash(
    crash_data: CrashFile,
    analyzer: State<'_, CrashAnalyzer>,
    window: tauri::Window,
) -> Result<AnalysisResult, String> {
    // Emit progress events
    window.emit("analysis:progress", AnalysisProgress {
        file_id: crash_data.header.file_name.clone(),
        stage: "parsing".to_string(),
        progress: 10,
        message: "Parsing complete, starting analysis...".to_string(),
    }).ok();
    
    // Run AI analysis
    let result = analyzer.analyze(&crash_data, |progress| {
        window.emit("analysis:progress", progress).ok();
    }).await.map_err(|e| e.to_string())?;
    
    Ok(result)
}

#[tauri::command]
pub async fn batch_analyze(
    paths: Vec<String>,
    parser: State<'_, CrashFileParser>,
    analyzer: State<'_, CrashAnalyzer>,
    window: tauri::Window,
) -> Result<Vec<AnalysisResult>, String> {
    let mut results = Vec::new();
    
    for (i, path) in paths.iter().enumerate() {
        window.emit("batch:progress", serde_json::json!({
            "current": i + 1,
            "total": paths.len(),
            "file": path,
        })).ok();
        
        let crash = parser.parse_file(Path::new(path))
            .await
            .map_err(|e| e.to_string())?;
            
        let analysis = analyzer.analyze(&crash, |_| {})
            .await
            .map_err(|e| e.to_string())?;
            
        results.push(analysis);
    }
    
    Ok(results)
}

#[tauri::command]
pub async fn export_report(
    analysis: AnalysisResult,
    format: String,
    output_path: String,
) -> Result<(), String> {
    match format.as_str() {
        "pdf" => export_pdf(&analysis, &output_path).await,
        "json" => export_json(&analysis, &output_path).await,
        "markdown" => export_markdown(&analysis, &output_path).await,
        "docx" => export_docx(&analysis, &output_path).await,
        _ => Err("Unsupported format".to_string()),
    }
}

#[tauri::command]
pub async fn search_analyses(
    query: SearchQuery,
    db: State<'_, Database>,
) -> Result<Vec<AnalysisSummary>, String> {
    db.search(&query)
        .await
        .map_err(|e| e.to_string())
}
```

---

# EPIC 2: AI-POWERED ANALYSIS ENGINE

## Description
Build a comprehensive AI analysis system that understands the full WHATS'ON domain, not limited to specific crash types. The prompts should be extensible and domain-aware.

---

### TASK 2.1: Domain Knowledge Base

#### SUBTASK 2.1.1: WHATS'ON Domain Model

**System Knowledge Document (to be included in prompts):**

```markdown
# WHATS'ON Domain Knowledge

## Application Architecture

### Layer Structure
WHATS'ON follows a layered architecture with clear namespace conventions:

1. **PSI Layer (Presentation/Scheduling Infrastructure)**
   - Core scheduling entities
   - Channel management
   - Schedule versions and locking
   - Transmission blocks (TxBlocks)
   
2. **BM Layer (Business Model)**
   - Business rules and validation
   - Time allocations and segmentation
   - Program information
   - Commercial/break management
   
3. **PL Layer (Planning)**
   - Continuity planning
   - Long-form planning
   - Promo planning
   - Acquisition planning
   
4. **WOn Layer (WHATS'ON Core)**
   - Launcher and navigation
   - User preferences
   - Session management
   
5. **EX Layer (External/Export)**
   - Playlist generation
   - EPG export
   - Traffic system integration
   - Automation system interfaces

### Key Entity Types

#### Scheduling Entities
- **PSIChannel** - Broadcast channel definition
- **PSIScheduleVersion** - A version of a schedule (working, approved, on-air)
- **PSITxBlock** - Transmission block (a scheduled item)
- **PSIBreakPattern** - Commercial break structure
- **PSIJunction** - Transition between programs

#### Time Management
- **BMTimeAllocation** - Time slot within a TxBlock
- **BMProgramSegment** - Part of a program
- **BMProgramSegmentDurations** - Duration data for segments
- **BMBreak** - Commercial break
- **BMPromo** - Promotional item

#### Content/Media
- **BMProgram** - Program/show definition
- **BMEpisode** - Episode of a series
- **BMSeries** - Series definition
- **BMMedia** - Media asset reference
- **BMMaterial** - Physical material (tape, file)

#### Commercial
- **BMCampaign** - Advertising campaign
- **BMSpot** - Commercial spot
- **BMBooking** - Commercial booking
- **BMContract** - Advertising contract

#### Planning
- **PLContinuityPlan** - Continuity planning document
- **PLPromoSlot** - Slot for promos
- **PLAcquisition** - Content acquisition record

#### System
- **WOnUser** - User account
- **WOnSite** - Site/environment configuration
- **WOnPreference** - User preferences

### Common Operations & Workflows

#### Schedule Management
- Create/copy schedule versions
- Lock/unlock schedules
- Approve schedules for broadcast
- Roll forward schedules

#### Continuity Planning
- Make Continuous - Remove gaps between items
- Insert breaks - Add commercial breaks
- Split/merge TxBlocks
- Adjust timings

#### Playlist Generation
- Generate automation playlists
- Export to traffic systems
- Create as-run logs

#### Data Import/Export
- Schedule import (various formats)
- EPG export
- Rights/contracts import
- Media asset metadata sync

### Database Structure
- Oracle database backend
- EXDI (External Database Interface) for connectivity
- Table prefix: PSI.*, BM.*, PL.*
- OID-based primary keys
- Soft delete with status flags

### Common Error Patterns

#### Collection Errors
- SubscriptOutOfBoundsError - Index mismatch
- KeyNotFoundError - Missing dictionary key
- CollectionIsEmpty - Empty collection access

#### Type Errors
- MessageNotUnderstood - Wrong receiver type or nil
- WrongNumberOfArguments - API misuse
- ClassCastError - Type conversion failure

#### Database Errors
- OracleError - Database connectivity/query issues
- TransactionError - Commit/rollback problems
- LockTimeout - Concurrent access issues

#### Business Rule Errors
- ValidationError - Data validation failure
- ConstraintViolation - Business rule violation
- StateError - Invalid workflow state

### UI Components
- Launcher - Main navigation
- Continuity Planner - Schedule editing
- Break Editor - Commercial breaks
- Program Browser - Content lookup
- Media Manager - Asset management
- Report Viewer - Reporting
- Admin Console - System administration
```

---

#### SUBTASK 2.1.2: Prompt Template System

```rust
// src/analyzer/prompts.rs

use handlebars::Handlebars;
use serde_json::json;

pub struct PromptTemplates {
    handlebars: Handlebars<'static>,
}

impl PromptTemplates {
    pub fn new() -> Self {
        let mut hb = Handlebars::new();
        
        // Register all templates
        hb.register_template_string("system_base", SYSTEM_BASE_PROMPT).unwrap();
        hb.register_template_string("root_cause", ROOT_CAUSE_PROMPT).unwrap();
        hb.register_template_string("user_scenario", USER_SCENARIO_PROMPT).unwrap();
        hb.register_template_string("fix_suggestion", FIX_SUGGESTION_PROMPT).unwrap();
        hb.register_template_string("impact_analysis", IMPACT_ANALYSIS_PROMPT).unwrap();
        hb.register_template_string("test_scenarios", TEST_SCENARIOS_PROMPT).unwrap();
        hb.register_template_string("full_analysis", FULL_ANALYSIS_PROMPT).unwrap();
        
        Self { handlebars: hb }
    }
    
    pub fn render_full_analysis(&self, crash: &CrashFile) -> Result<String> {
        let data = self.crash_to_template_data(crash);
        self.handlebars.render("full_analysis", &data)
            .map_err(|e| anyhow::anyhow!("Template error: {}", e))
    }
}

// System base prompt with full domain knowledge
const SYSTEM_BASE_PROMPT: &str = r#"
You are an expert crash analyst for WHATS'ON, a comprehensive broadcast management and scheduling system built on VisualWorks Smalltalk by MediaGeniX (now part of Amagi).

## Your Expertise

### VisualWorks Smalltalk Runtime
- Object memory model with 5 spaces: Eden, Survivor, Large, Old, Permanent
- Process scheduling with priority-based preemption
- Exception handling via signal/handle mechanism
- Collection classes: OrderedCollection, Dictionary, Set, Array, etc.
- Block closures and optimization
- Database connectivity via EXDI (External Database Interface)

### WHATS'ON Application Architecture
You understand the complete WHATS'ON system:

**Namespace Conventions:**
- `MediaGeniX.PSI*` - Scheduling infrastructure (channels, schedules, TxBlocks)
- `MediaGeniX.BM*` - Business model (programs, breaks, time allocations)
- `MediaGeniX.PL*` - Planning modules (continuity, promo, acquisition)
- `MediaGeniX.WOn*` - Core application (launcher, preferences)
- `MediaGeniX.EX*` - Export/external interfaces

**Key Entities:**
- PSITxBlock - Transmission block (scheduled item)
- PSIChannel - Broadcast channel
- PSIScheduleVersion - Schedule version (working/approved/on-air)
- BMTimeAllocation - Time segment within a block
- BMProgram/BMEpisode - Content definitions
- BMBreak/BMSpot - Commercial items
- PLContinuityPlan - Planning documents

**Common Operations:**
- Schedule creation, copying, approval workflows
- Continuity planning (Make Continuous, insert breaks, timing adjustments)
- Playlist generation for automation systems
- EPG export for program guides
- Import/export of schedules and content data

### Broadcast Domain Knowledge
- Transmission scheduling concepts
- Commercial break structures and regulations
- EPG (Electronic Program Guide) requirements
- Playlist formats for automation systems
- Rights and contracts management
- Multi-channel, multi-site operations

## Analysis Approach

When analyzing a crash:

1. **Identify the Exception**
   - Parse the exception type and message
   - Understand what the Smalltalk runtime is complaining about

2. **Trace the Code Path**
   - Focus on MediaGeniX.* frames (application code)
   - Identify the module (PSI/BM/PL/WOn/EX)
   - Understand the operation being performed

3. **Examine Context**
   - Receiver object state
   - Method arguments
   - Related business objects
   - Data conditions that may have caused the issue

4. **Assess Database State**
   - Active transactions (data integrity risk)
   - Prepared statements (what was being modified)
   - Connection health

5. **Check System Health**
   - Memory utilization
   - Process states
   - Resource constraints

6. **Determine Root Cause**
   - Is this a code bug or data issue?
   - Is it reproducible or environment-specific?
   - What data conditions trigger it?

7. **Assess Impact**
   - What functionality is affected?
   - Is data at risk?
   - Who is impacted (users, operations)?

## Response Guidelines

- Be SPECIFIC: Reference exact classes, methods, and data
- Be CLEAR: Explain technical issues in plain English too
- Be ACTIONABLE: Provide concrete steps for resolution
- Be THOROUGH: Consider all implications and related areas
- Be HONEST: Express confidence levels and uncertainties
"#;
```

---

### TASK 2.2: Primary Analysis Prompts

#### SUBTASK 2.2.1: Full Analysis Prompt

```rust
const FULL_ANALYSIS_PROMPT: &str = r#"
{{> system_base}}

## Your Task

Analyze the following WHATS'ON crash dump and provide comprehensive analysis.

---

## CRASH DATA

### File Information
- **File:** {{header.file_name}}
- **Timestamp:** {{header.timestamp}}
- **Dump Complete:** {{header.dump_complete}}

### Environment
- **User:** {{environment.user}}
- **Site:** {{environment.site}}
- **Version:** {{environment.version}}
- **Build:** {{environment.build}}
- **Computer:** {{environment.computer_name}}
- **Smalltalk:** {{environment.smalltalk_version}}
{{#if environment.oracle_server}}- **Oracle Server:** {{environment.oracle_server}}{{/if}}
{{#if environment.oracle_client}}- **Oracle Client:** {{environment.oracle_client}}{{/if}}

### Exception
- **Type:** {{exception.exception_type}}
- **Message:** {{exception.message}}
{{#if exception.parameter}}- **Parameter:** {{exception.parameter}}{{/if}}
{{#if exception.signal_name}}- **Signal:** {{exception.signal_name}}{{/if}}

### Stack Trace (Top 20 Frames)
```
{{#each stack_trace}}
[{{frame_number}}] {{method_signature}} ({{frame_type}})
{{/each}}
```

### Context Arguments
{{#if context}}
**Receiver:**
- Class: {{context.receiver.class_name}}
{{#if context.receiver.print_string}}- Value: {{context.receiver.print_string}}{{/if}}
{{#if context.receiver.collection_size}}- Size: {{context.receiver.collection_size}} items{{/if}}
{{#if context.receiver.collection_contents}}- Contents: {{context.receiver.collection_contents}}{{/if}}

**Arguments:**
{{#each context.arguments}}
- {{name}}: {{value}}
{{/each}}

**Related Business Objects:**
{{#each context.related_objects}}
- **{{class_name}}** {{#if object_id}}(ID: {{object_id}}){{/if}}
  {{#each properties}}
  - {{@key}}: {{this}}
  {{/each}}
{{/each}}
{{else}}
*Context not available in crash dump*
{{/if}}

### Open Windows
{{#each windows}}
- {{title}} ({{model}})
{{/each}}

### Database State
**Connections:**
{{#each database.connections}}
- Connection {{hash}}: {{state}} ({{username}}@{{environment}})
{{/each}}

{{#if database.has_active_transaction}}
⚠️ **ACTIVE TRANSACTION DETECTED** - Data integrity may be at risk
{{/if}}

**Active Sessions:**
{{#each database.sessions}}
- [{{state}}] {{query}}
{{/each}}

### Memory Report
{{#each memory.spaces}}
- **{{name}}:** {{size}} ({{percent}}%)
{{/each}}
- **Total:** {{memory.total_used}} / Limit: {{memory.config_limit}}

---

## REQUIRED OUTPUT

Provide your analysis as a JSON object with the following structure:

```json
{
  "summary": {
    "title": "Brief title for the crash (max 100 chars)",
    "severity": "critical|high|medium|low",
    "category": "data_integrity|code_bug|configuration|infrastructure|user_error|unknown",
    "confidence": 0.0-1.0
  },
  
  "rootCause": {
    "technical": "Technical description of what went wrong",
    "plainEnglish": "Simple explanation anyone can understand",
    "affectedMethod": "The primary method where the crash occurred",
    "affectedModule": "PSI|BM|PL|WOn|EX|Framework",
    "triggerCondition": "What data/state condition triggered this crash"
  },
  
  "userScenario": {
    "description": "What the user was doing when the crash occurred",
    "workflow": "The business workflow being performed",
    "steps": [
      {
        "step": 1,
        "action": "Action description",
        "details": "Additional details",
        "isCrashPoint": false
      }
    ],
    "expectedResult": "What should have happened",
    "actualResult": "What actually happened",
    "reproductionLikelihood": "high|medium|low",
    "reproductionNotes": "Notes on reproducing this crash"
  },
  
  "suggestedFix": {
    "summary": "One-line description of the fix",
    "reasoning": "Why this crash happened (root cause explanation)",
    "explanation": "How to fix it (technical approach)",
    "codeChanges": [
      "Specific change 1",
      "Specific change 2"
    ],
    "complexity": "low|medium|high",
    "estimatedEffort": "e.g., 2-4 hours",
    "riskLevel": "low|medium|high",
    "testingNotes": "What to test after the fix"
  },
  
  "systemWarnings": [
    {
      "source": "Database|Memory|Data|Process|Configuration",
      "severity": "error|warning|info",
      "title": "Short title",
      "description": "What's wrong",
      "recommendation": "What to do about it",
      "contributedToCrash": true|false
    }
  ],
  
  "impactAnalysis": {
    "dataAtRisk": true|false,
    "dataRiskDescription": "If data is at risk, what specifically",
    "directlyAffected": [
      {
        "feature": "Feature name",
        "module": "Module name",
        "description": "How it's affected",
        "severity": "critical|high|medium|low"
      }
    ],
    "potentiallyAffected": [
      {
        "feature": "Feature name",
        "module": "Module name",
        "description": "How it might be affected",
        "severity": "critical|high|medium|low"
      }
    ]
  },
  
  "testScenarios": [
    {
      "id": "TC001",
      "name": "Test scenario name",
      "priority": "P1|P2|P3",
      "type": "regression|verification|edge-case|integration",
      "description": "What this test verifies",
      "steps": "1. Step one\n2. Step two",
      "expectedResult": "Expected outcome",
      "dataRequirements": "Data needed for the test"
    }
  ],
  
  "relatedPatterns": [
    "Names of similar known crash patterns, if any"
  ],
  
  "additionalNotes": "Any other observations or recommendations"
}
```

Analyze the crash data above and provide your response as valid JSON only, no additional text.
"#;
```

---

#### SUBTASK 2.2.2: Specialized Follow-up Prompts

```rust
// For when we need deeper analysis on specific aspects

const DATA_INVESTIGATION_PROMPT: &str = r#"
{{> system_base}}

Based on this crash involving data inconsistency:

**Exception:** {{exception.exception_type}}: {{exception.message}}
**Affected Objects:**
{{#each context.related_objects}}
- {{class_name}}: {{#each properties}}{{@key}}={{this}} {{/each}}
{{/each}}

Generate SQL queries to:
1. Find all instances of this data inconsistency in the database
2. Identify when/how the bad data was created
3. Assess the scope of the problem

Use the WHATS'ON database schema:
- Tables prefixed with PSI.* for scheduling entities
- Tables prefixed with BM.* for business model entities
- OID column as primary key
- Common join patterns via *_ID_* foreign key columns

Provide queries that are:
- SELECT only (read-safe)
- Well-commented
- Include helpful column aliases
- Ordered by most relevant criteria

Output as JSON:
{
  "queries": [
    {
      "purpose": "What this query finds",
      "sql": "The SQL query",
      "expectedColumns": ["Column descriptions"]
    }
  ],
  "dataFixStrategy": "If applicable, how to fix the data (with appropriate caution)"
}
"#;

const SIMILAR_CRASHES_PROMPT: &str = r#"
Given this crash signature:
- Exception: {{exception.exception_type}}
- Method: {{affected_method}}
- Module: {{affected_module}}

And these previous crash summaries from our database:
{{#each previous_crashes}}
- [{{id}}] {{exception_type}} in {{method}} - {{summary}}
{{/each}}

Identify:
1. Which previous crashes are likely the same issue?
2. Which are related but different?
3. Is there a pattern suggesting a systemic problem?

Output as JSON:
{
  "sameIssue": ["crash_ids"],
  "relatedIssues": ["crash_ids"],
  "isSystemicPattern": true|false,
  "patternDescription": "Description if systemic"
}
"#;

const WORKAROUND_PROMPT: &str = r#"
{{> system_base}}

For this crash that users are experiencing:

**Problem:** {{root_cause.plain_english}}
**Affected Feature:** {{affected_feature}}
**User Workflow:** {{user_scenario.workflow}}

Suggest practical workarounds that users can employ while waiting for a fix.

Consider:
- Alternative ways to accomplish the same task
- Data conditions to avoid
- Sequence of operations that might work
- Temporary configuration changes

Output as JSON:
{
  "workarounds": [
    {
      "title": "Workaround name",
      "description": "How to do it",
      "steps": ["Step 1", "Step 2"],
      "limitations": "What this doesn't solve",
      "riskLevel": "none|low|medium"
    }
  ],
  "avoidanceGuidance": "What users should avoid doing until fixed"
}
"#;
```

---

### TASK 2.3: AI Client Implementation

#### SUBTASK 2.3.1: Rust AI Client

```rust
// src/analyzer/ai_client.rs

use reqwest::Client;
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Clone)]
pub struct AiClient {
    client: Client,
    api_key: String,
    model: String,
    base_url: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
    usage: Usage,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Usage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

impl AiClient {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model,
            base_url: "https://api.anthropic.com/v1".to_string(),
        }
    }
    
    pub fn with_openai(api_key: String, model: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model,
            base_url: "https://api.openai.com/v1".to_string(),
        }
    }
    
    pub async fn analyze(&self, prompt: &str) -> Result<AnalysisResponse> {
        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message {
                    role: "user".to_string(),
                    content: prompt.to_string(),
                }
            ],
            max_tokens: 4096,
            temperature: 0.1,  // Low temperature for consistent analysis
        };
        
        let response = self.client
            .post(&format!("{}/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;
            
        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow::anyhow!("AI API error: {}", error_text));
        }
        
        let chat_response: ChatResponse = response.json().await?;
        let content = &chat_response.choices[0].message.content;
        
        // Parse JSON from response
        let analysis: AnalysisResponse = serde_json::from_str(content)
            .map_err(|e| anyhow::anyhow!("Failed to parse AI response: {}\n\nResponse was:\n{}", e, content))?;
            
        Ok(analysis)
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AnalysisResponse {
    pub summary: AnalysisSummary,
    pub root_cause: RootCause,
    pub user_scenario: UserScenario,
    pub suggested_fix: SuggestedFix,
    pub system_warnings: Vec<SystemWarning>,
    pub impact_analysis: ImpactAnalysis,
    pub test_scenarios: Vec<TestScenario>,
    pub related_patterns: Vec<String>,
    pub additional_notes: Option<String>,
}

// ... additional structs for each section
```

---

#### SUBTASK 2.3.2: Caching and Rate Limiting

```rust
// src/analyzer/cache.rs

use std::collections::HashMap;
use std::time::{Duration, Instant};
use sha2::{Sha256, Digest};
use tokio::sync::RwLock;

pub struct AnalysisCache {
    cache: RwLock<HashMap<String, CachedAnalysis>>,
    ttl: Duration,
}

struct CachedAnalysis {
    result: AnalysisResponse,
    created_at: Instant,
}

impl AnalysisCache {
    pub fn new(ttl_hours: u64) -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            ttl: Duration::from_secs(ttl_hours * 3600),
        }
    }
    
    pub fn cache_key(crash: &CrashFile) -> String {
        // Hash relevant fields (excluding timestamp)
        let mut hasher = Sha256::new();
        hasher.update(&crash.exception.exception_type);
        hasher.update(&crash.exception.message);
        for frame in crash.stack_trace.iter().take(10) {
            hasher.update(&frame.method_signature);
        }
        if let Some(ctx) = &crash.context {
            if let Some(recv) = &ctx.receiver {
                hasher.update(&recv.class_name);
            }
        }
        format!("{:x}", hasher.finalize())
    }
    
    pub async fn get(&self, key: &str) -> Option<AnalysisResponse> {
        let cache = self.cache.read().await;
        if let Some(cached) = cache.get(key) {
            if cached.created_at.elapsed() < self.ttl {
                return Some(cached.result.clone());
            }
        }
        None
    }
    
    pub async fn set(&self, key: String, result: AnalysisResponse) {
        let mut cache = self.cache.write().await;
        cache.insert(key, CachedAnalysis {
            result,
            created_at: Instant::now(),
        });
    }
}
```

---

### TASK 2.4: Rule-Based Fallback

#### SUBTASK 2.4.1: Pattern Matching Rules

```rust
// src/analyzer/rules.rs

use crate::models::{CrashFile, FrameType};

pub struct RuleBasedAnalyzer {
    patterns: Vec<CrashPattern>,
}

pub struct CrashPattern {
    pub name: String,
    pub matcher: Box<dyn Fn(&CrashFile) -> bool + Send + Sync>,
    pub analysis: PatternAnalysis,
}

pub struct PatternAnalysis {
    pub root_cause_template: String,
    pub plain_english_template: String,
    pub category: String,
    pub severity: String,
    pub fix_template: String,
}

impl RuleBasedAnalyzer {
    pub fn new() -> Self {
        Self {
            patterns: Self::build_patterns(),
        }
    }
    
    fn build_patterns() -> Vec<CrashPattern> {
        vec![
            // Collection index out of bounds
            CrashPattern {
                name: "collection_index_mismatch".to_string(),
                matcher: Box::new(|crash| {
                    crash.exception.exception_type.contains("SubscriptOutOfBounds")
                }),
                analysis: PatternAnalysis {
                    root_cause_template: "Collection access at index {parameter} but collection only has {size} elements".to_string(),
                    plain_english_template: "The system tried to access item #{parameter} in a list that only has {size} items".to_string(),
                    category: "data_integrity".to_string(),
                    severity: "high".to_string(),
                    fix_template: "Add bounds checking before accessing the collection".to_string(),
                },
            },
            
            // Nil receiver (MessageNotUnderstood to nil)
            CrashPattern {
                name: "nil_receiver".to_string(),
                matcher: Box::new(|crash| {
                    crash.exception.exception_type.contains("MessageNotUnderstood") &&
                    crash.context.as_ref()
                        .and_then(|c| c.receiver.as_ref())
                        .map(|r| r.class_name == "UndefinedObject")
                        .unwrap_or(false)
                }),
                analysis: PatternAnalysis {
                    root_cause_template: "Message '{method}' sent to nil (UndefinedObject)".to_string(),
                    plain_english_template: "The system tried to use an object that doesn't exist (nil)".to_string(),
                    category: "code_bug".to_string(),
                    severity: "high".to_string(),
                    fix_template: "Add nil check before sending message, or ensure object is properly initialized".to_string(),
                },
            },
            
            // Database connection error
            CrashPattern {
                name: "database_error".to_string(),
                matcher: Box::new(|crash| {
                    crash.exception.exception_type.contains("Oracle") ||
                    crash.exception.exception_type.contains("EXDI") ||
                    crash.exception.exception_type.contains("Database")
                }),
                analysis: PatternAnalysis {
                    root_cause_template: "Database error: {message}".to_string(),
                    plain_english_template: "There was a problem communicating with the database".to_string(),
                    category: "infrastructure".to_string(),
                    severity: "high".to_string(),
                    fix_template: "Check database connectivity, query syntax, and data constraints".to_string(),
                },
            },
            
            // Memory exhaustion
            CrashPattern {
                name: "memory_exhaustion".to_string(),
                matcher: Box::new(|crash| {
                    crash.exception.exception_type.contains("ObjectMemory") ||
                    crash.exception.exception_type.contains("OutOfMemory") ||
                    crash.memory.spaces.iter().any(|s| s.name == "Old" && s.percent > 95.0)
                }),
                analysis: PatternAnalysis {
                    root_cause_template: "Memory exhaustion in {space} space ({percent}% used)".to_string(),
                    plain_english_template: "The application ran out of memory".to_string(),
                    category: "infrastructure".to_string(),
                    severity: "critical".to_string(),
                    fix_template: "Increase memory limits, optimize memory usage, or investigate memory leaks".to_string(),
                },
            },
            
            // Add more patterns as discovered...
        ]
    }
    
    pub fn analyze(&self, crash: &CrashFile) -> Option<PatternAnalysis> {
        for pattern in &self.patterns {
            if (pattern.matcher)(crash) {
                return Some(pattern.analysis.clone());
            }
        }
        None
    }
}
```

---

# EPIC 3: FRONTEND APPLICATION (React + TypeScript)

## Description
Build the React frontend that runs inside Tauri's WebView, communicating with Rust backend via Tauri commands.

---

### TASK 3.1: Project Setup

#### SUBTASK 3.1.1: Dependencies

```json
// package.json
{
  "name": "whatson-crash-analyzer",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tauri-apps/api": "^1.5.0",
    "lucide-react": "^0.300.0",
    "zustand": "^4.4.0",
    "react-query": "^3.39.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^1.5.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

---

#### SUBTASK 3.1.2: Tauri API Types

```typescript
// src/types/tauri.ts

export interface CrashFile {
  header: CrashHeader;
  environment: Environment;
  exception: Exception;
  activeProcess?: Process;
  stackTrace: StackFrame[];
  context?: ContextArguments;
  windows: OpenWindow[];
  processes: ProcessLists;
  database: DatabaseState;
  memory: MemoryReport;
  commandLine?: string;
  walkback?: string;
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  rootCause: RootCause;
  userScenario: UserScenario;
  suggestedFix: SuggestedFix;
  systemWarnings: SystemWarning[];
  impactAnalysis: ImpactAnalysis;
  testScenarios: TestScenario[];
  relatedPatterns: string[];
  additionalNotes?: string;
}

// ... complete type definitions matching Rust structs
```

---

#### SUBTASK 3.1.3: Tauri Command Hooks

```typescript
// src/hooks/useTauri.ts

import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { useQuery, useMutation } from 'react-query';

export function useFilePicker() {
  return async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Crash Files', extensions: ['txt'] }]
    });
    return selected as string[] | null;
  };
}

export function useParseCrash() {
  return useMutation(async (path: string) => {
    return await invoke<CrashFile>('parse_crash_file', { path });
  });
}

export function useAnalyzeCrash() {
  return useMutation(async (crashData: CrashFile) => {
    return await invoke<AnalysisResult>('analyze_crash', { crashData });
  });
}

export function useBatchAnalyze() {
  return useMutation(async (paths: string[]) => {
    return await invoke<AnalysisResult[]>('batch_analyze', { paths });
  });
}

export function useAnalysisProgress(onProgress: (progress: AnalysisProgress) => void) {
  useEffect(() => {
    const unlisten = listen<AnalysisProgress>('analysis:progress', (event) => {
      onProgress(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [onProgress]);
}

export function useExportReport() {
  return useMutation(async ({ analysis, format, outputPath }: {
    analysis: AnalysisResult;
    format: 'pdf' | 'json' | 'markdown' | 'docx';
    outputPath: string;
  }) => {
    return await invoke('export_report', { analysis, format, outputPath });
  });
}
```

---

### TASK 3.2: State Management

#### SUBTASK 3.2.1: Zustand Store

```typescript
// src/store/analysisStore.ts

import { create } from 'zustand';

interface FileEntry {
  id: string;
  path: string;
  name: string;
  size: number;
  status: 'pending' | 'parsing' | 'analyzing' | 'complete' | 'error';
  progress: number;
  error?: string;
  crashData?: CrashFile;
  analysis?: AnalysisResult;
}

interface AnalysisStore {
  files: FileEntry[];
  selectedFileId: string | null;
  activeTab: string;
  
  // Actions
  addFiles: (paths: string[]) => void;
  removeFile: (id: string) => void;
  updateFileStatus: (id: string, status: FileEntry['status'], progress?: number) => void;
  setFileCrashData: (id: string, data: CrashFile) => void;
  setFileAnalysis: (id: string, analysis: AnalysisResult) => void;
  setFileError: (id: string, error: string) => void;
  selectFile: (id: string | null) => void;
  setActiveTab: (tab: string) => void;
  clearAll: () => void;
}

export const useAnalysisStore = create<AnalysisStore>((set, get) => ({
  files: [],
  selectedFileId: null,
  activeTab: 'overview',
  
  addFiles: (paths) => {
    const newFiles: FileEntry[] = paths.map(path => ({
      id: crypto.randomUUID(),
      path,
      name: path.split(/[/\\]/).pop() || 'unknown',
      size: 0,
      status: 'pending',
      progress: 0,
    }));
    set(state => ({ files: [...state.files, ...newFiles] }));
  },
  
  removeFile: (id) => {
    set(state => ({
      files: state.files.filter(f => f.id !== id),
      selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
    }));
  },
  
  updateFileStatus: (id, status, progress = 0) => {
    set(state => ({
      files: state.files.map(f => 
        f.id === id ? { ...f, status, progress } : f
      ),
    }));
  },
  
  setFileCrashData: (id, data) => {
    set(state => ({
      files: state.files.map(f => 
        f.id === id ? { ...f, crashData: data } : f
      ),
    }));
  },
  
  setFileAnalysis: (id, analysis) => {
    set(state => ({
      files: state.files.map(f => 
        f.id === id ? { ...f, analysis, status: 'complete', progress: 100 } : f
      ),
    }));
  },
  
  setFileError: (id, error) => {
    set(state => ({
      files: state.files.map(f => 
        f.id === id ? { ...f, error, status: 'error' } : f
      ),
    }));
  },
  
  selectFile: (id) => set({ selectedFileId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  clearAll: () => set({ files: [], selectedFileId: null }),
}));
```

---

### TASK 3.3: UI Components

*[The UI components remain similar to the enhanced HTML mockup, but converted to proper React/TypeScript with Tauri integration. The mockup HTML file serves as the visual specification.]*

---

# EPIC 4: DATABASE AND STORAGE

## Description
Implement local storage for analysis history, caching, and user preferences.

---

### TASK 4.1: SQLite Schema

#### SUBTASK 4.1.1: Database Migrations

```rust
// src/db/migrations.rs

pub const MIGRATIONS: &[&str] = &[
    // Migration 1: Initial schema
    r#"
    CREATE TABLE IF NOT EXISTS crash_files (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT,
        file_size INTEGER,
        file_hash TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        
        -- Parsed header info
        crash_timestamp TEXT,
        dump_complete INTEGER,
        
        -- Environment
        user_name TEXT,
        site TEXT,
        version TEXT,
        build TEXT,
        
        -- Exception
        exception_type TEXT NOT NULL,
        exception_message TEXT,
        
        -- Raw content (compressed)
        raw_content BLOB
    );
    
    CREATE INDEX idx_crash_files_hash ON crash_files(file_hash);
    CREATE INDEX idx_crash_files_exception ON crash_files(exception_type);
    CREATE INDEX idx_crash_files_timestamp ON crash_files(crash_timestamp);
    "#,
    
    // Migration 2: Analysis results
    r#"
    CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        crash_file_id TEXT NOT NULL REFERENCES crash_files(id),
        
        -- Analysis metadata
        analyzed_at TEXT NOT NULL,
        ai_model TEXT,
        confidence REAL,
        cached_from TEXT,  -- NULL if fresh analysis
        
        -- Results (JSON)
        summary_json TEXT NOT NULL,
        root_cause_json TEXT NOT NULL,
        user_scenario_json TEXT NOT NULL,
        suggested_fix_json TEXT NOT NULL,
        system_warnings_json TEXT,
        impact_analysis_json TEXT,
        test_scenarios_json TEXT,
        
        -- Searchable fields
        severity TEXT,
        category TEXT,
        affected_method TEXT,
        affected_module TEXT
    );
    
    CREATE INDEX idx_analyses_crash_file ON analyses(crash_file_id);
    CREATE INDEX idx_analyses_severity ON analyses(severity);
    CREATE INDEX idx_analyses_category ON analyses(category);
    "#,
    
    // Migration 3: Linked tickets
    r#"
    CREATE TABLE IF NOT EXISTS linked_tickets (
        analysis_id TEXT NOT NULL REFERENCES analyses(id),
        ticket_system TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        ticket_url TEXT,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (analysis_id, ticket_system, ticket_id)
    );
    "#,
    
    // Migration 4: User preferences
    r#"
    CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    
    // Migration 5: Full-text search
    r#"
    CREATE VIRTUAL TABLE IF NOT EXISTS crash_search USING fts5(
        file_name,
        exception_type,
        exception_message,
        user_name,
        site,
        affected_method,
        root_cause_text,
        content='crash_files',
        content_rowid='rowid'
    );
    "#,
];
```

---

# EPIC 5: PACKAGING AND DISTRIBUTION

## Description
Package the application for distribution on Windows, macOS, and Linux.

---

### TASK 5.1: Tauri Configuration

#### SUBTASK 5.1.1: tauri.conf.json

```json
{
  "build": {
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev",
    "devPath": "http://localhost:5173",
    "distDir": "../dist"
  },
  "package": {
    "productName": "WHATS'ON Crash Analyzer",
    "version": "1.0.0"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "shell": { "open": true },
      "dialog": { "all": true },
      "fs": { 
        "all": true,
        "scope": ["$APPDATA/**", "$HOME/**", "$DOCUMENT/**"]
      },
      "path": { "all": true },
      "clipboard": { "all": true }
    },
    "bundle": {
      "active": true,
      "category": "DeveloperTool",
      "copyright": "© 2026 Your Company",
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ],
      "identifier": "com.yourcompany.whatson-crash-analyzer",
      "shortDescription": "WHATS'ON Crash File Analyzer",
      "longDescription": "AI-powered crash analysis tool for WHATS'ON broadcast management system",
      "targets": ["msi", "dmg", "deb", "appimage"],
      "windows": {
        "certificateThumbprint": null,
        "digestAlgorithm": "sha256",
        "timestampUrl": ""
      }
    },
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    },
    "windows": [
      {
        "fullscreen": false,
        "height": 900,
        "width": 1400,
        "minHeight": 600,
        "minWidth": 1000,
        "resizable": true,
        "title": "WHATS'ON Crash Analyzer",
        "center": true
      }
    ]
  }
}
```

---

# APPENDIX A: COMPLETE AI PROMPT LIBRARY

## A.1 Configuration

```rust
// src/analyzer/config.rs

pub struct PromptConfig {
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub include_domain_knowledge: bool,
    pub max_stack_frames: usize,
    pub max_context_objects: usize,
}

impl Default for PromptConfig {
    fn default() -> Self {
        Self {
            model: "claude-3-opus-20240229".to_string(),
            max_tokens: 4096,
            temperature: 0.1,
            include_domain_knowledge: true,
            max_stack_frames: 20,
            max_context_objects: 10,
        }
    }
}
```

## A.2 Domain Knowledge Document

*[The full domain knowledge from SUBTASK 2.1.1 should be stored as an embedded resource and included in prompts when `include_domain_knowledge` is true]*

## A.3 Prompt Templates Summary

| Template | Purpose | When Used |
|----------|---------|-----------|
| `full_analysis` | Complete analysis in one call | Primary analysis |
| `data_investigation` | Generate SQL queries | Data issues detected |
| `similar_crashes` | Find related crashes | After analysis, for linking |
| `workaround` | Generate user workarounds | When fix is not immediate |
| `explain_technical` | Simplify technical details | For non-technical reports |

---

# APPENDIX B: ERROR HANDLING

## B.1 Error Types

```rust
// src/errors.rs

use thiserror::Error;

#[derive(Error, Debug)]
pub enum CrashAnalyzerError {
    #[error("Failed to parse crash file: {0}")]
    ParseError(String),
    
    #[error("AI analysis failed: {0}")]
    AiError(String),
    
    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),
    
    #[error("File I/O error: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("Invalid crash file format: {0}")]
    InvalidFormat(String),
    
    #[error("Analysis cache miss")]
    CacheMiss,
    
    #[error("Rate limited, retry after {0} seconds")]
    RateLimited(u32),
}
```

---

# APPENDIX C: TESTING

## C.1 Test Data

Store sample crash files in `tests/fixtures/` for unit and integration testing.

## C.2 Test Commands

```bash
# Run Rust tests
cargo test

# Run with specific crash file
cargo test -- --test-threads=1 parse_real_crash

# Run frontend tests
npm test

# Build release
cargo tauri build
```

---

# CHANGE LOG

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-19 | Initial specification |
| 1.1 | 2026-01-19 | Updated for Rust/Tauri, expanded domain coverage |

---

*End of Document*
