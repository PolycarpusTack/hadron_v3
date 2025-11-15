# VisualWorks Smalltalk Crash Analysis System - Development Plan

## Project Overview

**System Name:** Smalltalk Crash Analysis & Knowledge Management System  
**Purpose:** Automated crash log analysis with AI-powered insights, searchable database storage, and human validation workflow  
**Architecture:** Offline-first, cross-platform (Desktop + Web) with PostgreSQL synchronization

---

## Core System Requirements

### Functional Requirements

1. Upload crash log files (text/log format)
2. Extract and parse crash data including:
   - Stack traces
   - User reproduction steps
   - Error messages and context
   - System state information
3. Send crash data to AI for comprehensive analysis
4. Store crash records in PostgreSQL database
5. Enable full-text search across crash records
6. Support human validation and solution documentation
7. Work offline with automatic synchronization
8. Cross-platform desktop application (Windows, macOS, Linux)
9. Web application with identical functionality
10. Real-time sync between desktop and web clients

### AI Analysis Requirements

The AI analysis must provide:

- **Stack trace parsing and interpretation**
- **Root cause analysis** (primary focus)
- **Suggested fixes and remediation steps** (primary focus)
- **User steps translation** into clear, human-readable language
- **Test scenario generation** to reproduce the issue
- **Severity scoring** (Critical, High, Medium, Low)
- **Similar crash pattern matching** against historical data
- **Component/module identification**
- **Potential side effects** of the crash
- **Recommended prevention strategies**

### Technical Architecture Decisions

**Database Strategy:**

- **Server:** PostgreSQL (central source of truth)
- **Desktop:** SQLite (local embedded database)
- **Web:** IndexedDB (browser-based storage)
- **Sync Pattern:** Event-sourcing with timestamp-based conflict resolution

**ID Strategy:**

- Use UUIDv4 for all crash records to prevent ID collisions
- Local records sync to server using UUID as primary key
- No auto-increment IDs to enable offline creation

**AI Integration:**

- **Local AI:** Ollama with Qwen 3, Qwencoder or other available models (for privacy-sensitive environments)
- **Cloud AI:** OpenAI GPT-4, Anthropic Claude, or Google Gemini (for enhanced analysis)
- **Configurable:** Users choose local vs. cloud per installation

**Technology Stack:**

- **Desktop:** Electron + React + SQLite + Node.js
- **Web:** React + IndexedDB + REST API
- **Backend API:** Node.js + Express + PostgreSQL
- **AI Integration:** LangChain for unified AI interface

---

## PHASE 1: Foundation & Database Infrastructure

### Phase 1 Objective

Establish the core database schema, API foundation, and basic PostgreSQL setup. This phase creates the data backbone that all other features depend on.

### Definition of Ready (DoR) - Phase 1

Before starting Phase 1, ensure:

- [ ] PostgreSQL server is available (local or cloud)
- [ ] Database credentials and connection details are documented
- [ ] Node.js development environment is set up (v18+)
- [ ] Git repository is initialized
- [ ] Development team has PostgreSQL knowledge
- [ ] Decision made on database hosting (self-hosted vs. managed service)
- [ ] All stakeholders approve the database schema design

### Phase 1: Step-by-Step Tasks

#### Task 1.1: PostgreSQL Database Setup

**Action:** Create the central PostgreSQL database instance

- Install PostgreSQL 15+ or provision cloud database (AWS RDS, Google Cloud SQL, etc.)
- Create database named `smalltalk_crash_db`
- Configure connection pooling (max 20 connections)
- Set up SSL/TLS for secure connections
- Document connection string format
- Create database backup strategy

**Deliverable:** Working PostgreSQL instance with documented connection details

#### Task 1.2: Database Schema Design

**Action:** Design and implement the complete database schema

**Schema Design:**

```sql
-- Core tables for crash management

-- 1. crashes table (main crash records)
CREATE TABLE crashes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- File metadata
    filename VARCHAR(255) NOT NULL,
    file_size_bytes INTEGER,
    upload_source VARCHAR(50) CHECK (upload_source IN ('desktop', 'web')),

    -- Raw crash data
    raw_log_content TEXT NOT NULL,

    -- Parsed crash information
    error_type VARCHAR(255),
    error_message TEXT,
    stack_trace TEXT,
    user_steps TEXT,
    system_info JSONB,

    -- AI analysis results
    ai_analysis_status VARCHAR(50) DEFAULT 'pending'
        CHECK (ai_analysis_status IN ('pending', 'processing', 'completed', 'failed')),
    ai_provider VARCHAR(50), -- 'ollama', 'openai', 'anthropic', 'google'
    ai_model_used VARCHAR(100),
    ai_analysis_timestamp TIMESTAMP WITH TIME ZONE,

    root_cause_analysis TEXT,
    suggested_fixes TEXT[],
    remediation_steps TEXT[],
    severity VARCHAR(20) CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    affected_components TEXT[],
    user_steps_summary TEXT,
    test_scenarios TEXT[],
    prevention_strategies TEXT[],
    similar_crash_ids UUID[],

    -- Human validation
    validation_status VARCHAR(50) DEFAULT 'pending'
        CHECK (validation_status IN ('pending', 'validated', 'rejected', 'needs_revision')),
    validated_by VARCHAR(255),
    validated_at TIMESTAMP WITH TIME ZONE,
    human_solution TEXT,
    human_notes TEXT,

    -- Search and categorization
    tags TEXT[],
    category VARCHAR(100),

    -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE,

    -- Sync metadata
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sync_version INTEGER DEFAULT 1
);

-- 2. sync_log table (track synchronization events)
CREATE TABLE sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crash_id UUID REFERENCES crashes(id) ON DELETE CASCADE,
    sync_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sync_source VARCHAR(50), -- 'desktop', 'web'
    sync_action VARCHAR(50), -- 'create', 'update', 'delete'
    sync_status VARCHAR(50), -- 'success', 'failed', 'conflict'
    conflict_resolution VARCHAR(100),
    sync_metadata JSONB
);

-- 3. user_sessions table (track desktop/web sessions)
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) UNIQUE NOT NULL,
    device_type VARCHAR(50), -- 'desktop', 'web'
    device_id VARCHAR(255),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. ai_analysis_queue table (queue for AI processing)
CREATE TABLE ai_analysis_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crash_id UUID REFERENCES crashes(id) ON DELETE CASCADE,
    queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    priority INTEGER DEFAULT 5 -- 1 (highest) to 10 (lowest)
);

-- Create indexes for performance
CREATE INDEX idx_crashes_created_at ON crashes(created_at DESC);
CREATE INDEX idx_crashes_severity ON crashes(severity);
CREATE INDEX idx_crashes_validation_status ON crashes(validation_status);
CREATE INDEX idx_crashes_deleted_at ON crashes(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_crashes_ai_status ON crashes(ai_analysis_status);

-- Full-text search indexes
CREATE INDEX idx_crashes_error_message_fts ON crashes USING gin(to_tsvector('english', error_message));
CREATE INDEX idx_crashes_raw_log_fts ON crashes USING gin(to_tsvector('english', raw_log_content));
CREATE INDEX idx_crashes_root_cause_fts ON crashes USING gin(to_tsvector('english', root_cause_analysis));

-- JSONB indexes for system_info queries
CREATE INDEX idx_crashes_system_info ON crashes USING gin(system_info);

-- Sync indexes
CREATE INDEX idx_sync_log_crash_id ON sync_log(crash_id);
CREATE INDEX idx_sync_log_timestamp ON sync_log(sync_timestamp DESC);

-- Queue indexes
CREATE INDEX idx_ai_queue_status ON ai_analysis_queue(status) WHERE status = 'queued';
CREATE INDEX idx_ai_queue_crash_id ON ai_analysis_queue(crash_id);
```

**Additional Schema Components:**

```sql
-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to crashes table
CREATE TRIGGER update_crashes_updated_at
    BEFORE UPDATE ON crashes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function for full-text search
CREATE OR REPLACE FUNCTION search_crashes(search_term TEXT)
RETURNS TABLE (
    id UUID,
    filename VARCHAR,
    error_message TEXT,
    severity VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.filename,
        c.error_message,
        c.severity,
        c.created_at,
        ts_rank(
            to_tsvector('english', c.error_message || ' ' || c.raw_log_content || ' ' || COALESCE(c.root_cause_analysis, '')),
            plainto_tsquery('english', search_term)
        ) as rank
    FROM crashes c
    WHERE c.deleted_at IS NULL
    AND to_tsvector('english', c.error_message || ' ' || c.raw_log_content || ' ' || COALESCE(c.root_cause_analysis, ''))
        @@ plainto_tsquery('english', search_term)
    ORDER BY rank DESC;
END;
$$ LANGUAGE plpgsql;
```

**Deliverable:** Complete SQL schema file with all tables, indexes, and functions

#### Task 1.3: REST API Foundation

**Action:** Build the Node.js/Express API server

**API Structure:**

```javascript
// Project structure
smalltalk-crash-api/
├── src/
│   ├── config/
│   │   ├── database.js         // PostgreSQL connection
│   │   └── environment.js      // Environment variables
│   ├── models/
│   │   ├── Crash.js           // Crash model
│   │   ├── SyncLog.js         // Sync log model
│   │   └── AIQueue.js         // AI queue model
│   ├── routes/
│   │   ├── crashes.js         // Crash CRUD endpoints
│   │   ├── sync.js            // Sync endpoints
│   │   └── search.js          // Search endpoints
│   ├── middleware/
│   │   ├── errorHandler.js    // Global error handling
│   │   ├── validation.js      // Request validation
│   │   └── auth.js            // Authentication (future)
│   ├── utils/
│   │   ├── logger.js          // Winston logger
│   │   └── helpers.js         // Utility functions
│   └── server.js              // Express app entry
├── package.json
└── .env.example
```

**Core API Endpoints:**

```javascript
// GET /api/v1/health
// Check API and database health

// POST /api/v1/crashes
// Create new crash record
// Body: { filename, raw_log_content, upload_source, system_info }

// GET /api/v1/crashes
// List crashes with pagination, filtering, sorting
// Query params: page, limit, severity, validation_status, from_date, to_date

// GET /api/v1/crashes/:id
// Get single crash by ID

// PATCH /api/v1/crashes/:id
// Update crash record (for AI analysis results, validation)

// DELETE /api/v1/crashes/:id
// Soft delete crash (set deleted_at)

// GET /api/v1/search
// Full-text search across crashes
// Query params: q (search term), limit, offset

// POST /api/v1/sync/push
// Push local changes to server
// Body: { crashes: [], device_id, last_sync_timestamp }

// POST /api/v1/sync/pull
// Pull server changes since last sync
// Body: { device_id, last_sync_timestamp }
```

**Implementation Steps:**

1. Initialize Node.js project with Express
2. Install dependencies: `express`, `pg` (PostgreSQL client), `dotenv`, `joi` (validation), `winston` (logging), `cors`
3. Create database connection pool
4. Implement models with query builders
5. Build route handlers with proper error handling
6. Add request validation middleware
7. Implement logging for all requests
8. Add CORS configuration
9. Create comprehensive API documentation (OpenAPI/Swagger)

**Deliverable:** Working REST API with documented endpoints

#### Task 1.4: API Testing Suite

**Action:** Create comprehensive test coverage

**Testing Approach:**

- Use Jest for unit tests
- Use Supertest for API integration tests
- Mock PostgreSQL database for unit tests
- Use test database for integration tests

**Test Coverage Areas:**

1. Database connection handling
2. CRUD operations for crashes
3. Search functionality
4. Sync endpoint logic
5. Error handling and edge cases
6. Input validation

**Test Structure:**

```
tests/
├── unit/
│   ├── models/
│   │   └── Crash.test.js
│   └── utils/
│       └── helpers.test.js
├── integration/
│   ├── crashes.test.js
│   ├── sync.test.js
│   └── search.test.js
└── setup.js
```

**Deliverable:** Test suite with >80% code coverage

### Definition of Done (DoD) - Phase 1

Phase 1 is complete when:

- [ ] PostgreSQL database is running and accessible
- [ ] Database schema is implemented with all tables, indexes, and functions
- [ ] All database migrations are version-controlled
- [ ] REST API server runs without errors
- [ ] All core API endpoints are implemented and tested
- [ ] API documentation is complete and accurate
- [ ] Test suite passes with >80% coverage
- [ ] API responds within 200ms for GET requests, 500ms for POST requests
- [ ] Database connection pooling is configured and tested
- [ ] Error handling returns consistent JSON error format
- [ ] Health check endpoint reports database connectivity
- [ ] Code is peer-reviewed and merged to main branch
- [ ] Deployment scripts are documented

---

## PHASE 2: Desktop Application Foundation

### Phase 2 Objective

Build the cross-platform desktop application with local SQLite database, file upload functionality, and offline-first architecture.

### Definition of Ready (DoR) - Phase 2

Before starting Phase 2, ensure:

- [ ] Phase 1 is fully complete and deployed
- [ ] Electron development environment is set up
- [ ] Design mockups/wireframes for desktop UI are approved
- [ ] Decision made on UI framework (React recommended)
- [ ] SQLite database schema is designed (matching PostgreSQL schema)
- [ ] Team has Electron and React experience
- [ ] Cross-platform testing devices are available (Windows, macOS, Linux)

### Phase 2: Step-by-Step Tasks

#### Task 2.1: Electron Application Setup

**Action:** Initialize Electron project with React

**Project Structure:**

```
smalltalk-crash-desktop/
├── electron/
│   ├── main.js              // Electron main process
│   ├── preload.js           // Secure IPC bridge
│   └── menu.js              // Application menu
├── src/
│   ├── components/          // React components
│   ├── pages/              // Page-level components
│   ├── services/           // Business logic
│   ├── database/           // SQLite management
│   ├── store/              // State management (Redux/Zustand)
│   ├── App.jsx
│   └── index.jsx
├── public/
├── package.json
└── electron-builder.json    // Build configuration
```

**Implementation Steps:**

1. Initialize project with `create-react-app` or Vite
2. Add Electron dependencies: `electron`, `electron-builder`
3. Configure Electron main process
4. Set up IPC (Inter-Process Communication) for secure renderer-main communication
5. Configure window management (size, minimize, maximize, close)
6. Add application icon and branding
7. Configure auto-updater for future releases
8. Set up development environment with hot reload

**Deliverable:** Electron app that opens with React UI

#### Task 2.2: Local SQLite Database Setup

**Action:** Implement SQLite database for offline storage

**Database Implementation:**

```javascript
// Use better-sqlite3 for synchronous, fast SQLite operations

// Database location:
// Windows: %APPDATA%/smalltalk-crash-analyzer/crashes.db
// macOS: ~/Library/Application Support/smalltalk-crash-analyzer/crashes.db
// Linux: ~/.config/smalltalk-crash-analyzer/crashes.db

// Schema: Mirror PostgreSQL schema but simplified
CREATE TABLE crashes (
    id TEXT PRIMARY KEY,  -- UUID as TEXT
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    filename TEXT NOT NULL,
    file_size_bytes INTEGER,
    upload_source TEXT DEFAULT 'desktop',

    raw_log_content TEXT NOT NULL,

    error_type TEXT,
    error_message TEXT,
    stack_trace TEXT,
    user_steps TEXT,
    system_info TEXT,  -- JSON as TEXT

    ai_analysis_status TEXT DEFAULT 'pending',
    ai_provider TEXT,
    ai_model_used TEXT,
    ai_analysis_timestamp TEXT,

    root_cause_analysis TEXT,
    suggested_fixes TEXT,  -- JSON array as TEXT
    remediation_steps TEXT,  -- JSON array as TEXT
    severity TEXT,
    affected_components TEXT,  -- JSON array as TEXT
    user_steps_summary TEXT,
    test_scenarios TEXT,  -- JSON array as TEXT
    prevention_strategies TEXT,  -- JSON array as TEXT
    similar_crash_ids TEXT,  -- JSON array as TEXT

    validation_status TEXT DEFAULT 'pending',
    validated_by TEXT,
    validated_at TEXT,
    human_solution TEXT,
    human_notes TEXT,

    tags TEXT,  -- JSON array as TEXT
    category TEXT,

    deleted_at TEXT,

    -- Sync tracking
    last_synced_at TEXT,
    sync_version INTEGER DEFAULT 1,
    sync_status TEXT DEFAULT 'unsynced',  -- 'unsynced', 'synced', 'conflict'
    needs_push INTEGER DEFAULT 1,  -- 1 = needs sync to server, 0 = synced

    -- Offline creation tracking
    created_offline INTEGER DEFAULT 0  -- 1 if created while offline
);

-- Sync queue table (local operations to push to server)
CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY,
    crash_id TEXT NOT NULL,
    operation TEXT NOT NULL,  -- 'create', 'update', 'delete'
    timestamp TEXT NOT NULL,
    data TEXT,  -- JSON payload
    retry_count INTEGER DEFAULT 0,
    last_error TEXT
);

-- Create indexes
CREATE INDEX idx_crashes_created_at ON crashes(created_at);
CREATE INDEX idx_crashes_severity ON crashes(severity);
CREATE INDEX idx_crashes_needs_push ON crashes(needs_push) WHERE needs_push = 1;
CREATE INDEX idx_sync_queue_timestamp ON sync_queue(timestamp);

-- FTS (Full-Text Search) virtual table
CREATE VIRTUAL TABLE crashes_fts USING fts5(
    id UNINDEXED,
    filename,
    error_message,
    raw_log_content,
    root_cause_analysis,
    content=crashes,
    content_rowid=rowid
);
```

**Database Service API:**

```javascript
class CrashDatabase {
    constructor(dbPath);

    // CRUD operations
    createCrash(crashData): crashId
    getCrash(id): crash
    updateCrash(id, updates): boolean
    deleteCrash(id): boolean  // soft delete
    listCrashes(options): { crashes, total }

    // Search
    searchCrashes(searchTerm): crashes[]

    // Sync operations
    getUnsyncedCrashes(): crashes[]
    markAsSynced(id, syncVersion): boolean
    addToSyncQueue(operation, crashData): boolean
    getSyncQueue(): operations[]
    clearSyncQueueItem(id): boolean

    // Offline tracking
    isOnline(): boolean
    setOnlineStatus(online): void
}
```

**Deliverable:** Working SQLite database with service API

#### Task 2.3: File Upload UI Component

**Action:** Build drag-and-drop file upload interface

**UI Requirements:**

- Drag-and-drop area for crash log files
- Traditional file picker button
- File type validation (.log, .txt, .crash)
- File size validation (max 10MB)
- Multiple file upload support
- Upload progress indicator
- File preview before upload
- Cancel upload capability

**Component Structure:**

```jsx
<FileUploader>
  <DropZone>
    // Drag and drop area // "Drop crash log files here or click to browse"
  </DropZone>

  <FileList>
    // List of files queued for upload
    <FileItem>// Filename, size, remove button</FileItem>
  </FileList>

  <UploadButton>// Process uploads</UploadButton>
</FileUploader>
```

**Implementation:**

1. Create React component with drag-and-drop handlers
2. Validate file types and sizes
3. Read file contents using File API
4. Parse basic metadata (filename, size, timestamp)
5. Store in local SQLite database
6. Add to sync queue if online
7. Display success/error notifications

**Deliverable:** Working file upload component

#### Task 2.4: Crash List View

**Action:** Build main crash list interface

**UI Features:**

- Table/list view of all crashes
- Columns: Filename, Date, Severity, Status, AI Analysis Status, Validation Status
- Sortable columns
- Filter by: Severity, Status, Date range, AI status, Validation status
- Pagination (50 items per page)
- Search bar (full-text search)
- Bulk actions: Delete, Export
- Row click to view details
- Status badges with color coding
- Offline indicator when no network

**Component Structure:**

```jsx
<CrashListPage>
  <Toolbar>
    <SearchBar />
    <FilterDropdowns />
    <OnlineStatusIndicator />
    <RefreshButton />
  </Toolbar>

  <CrashTable>
    <TableHeader>// Sortable columns</TableHeader>
    <TableBody>
      <CrashRow>// Click to view details</CrashRow>
    </TableBody>
  </CrashTable>

  <Pagination />
</CrashListPage>
```

**Deliverable:** Working crash list interface with all features

#### Task 2.5: Offline Detection & Queue Management

**Action:** Implement offline-first architecture

**Offline Strategy:**

1. Detect network status using `navigator.onLine` and periodic ping
2. Display online/offline indicator in UI
3. Queue all write operations when offline
4. Automatically sync when connection restored
5. Handle conflicts (server-wins, client-wins, or manual resolution)

**Sync Service:**

```javascript
class SyncService {
    constructor(database, apiClient);

    // Network detection
    isOnline(): boolean
    startOnlineMonitoring(): void

    // Sync operations
    sync(): Promise<syncResult>
    pushLocalChanges(): Promise<pushResult>
    pullServerChanges(lastSyncTimestamp): Promise<pullResult>

    // Conflict resolution
    resolveConflict(localCrash, serverCrash, strategy): crash

    // Queue management
    processSyncQueue(): Promise<void>

    // Events
    on('sync-started', callback)
    on('sync-completed', callback)
    on('sync-failed', callback)
    on('online-status-changed', callback)
}
```

**Conflict Resolution Strategy:**

- **Server-wins:** If timestamps indicate server is newer, accept server version
- **Last-write-wins:** Compare `updated_at` timestamps
- **Manual resolution:** For validated crashes, prompt user to choose

**Deliverable:** Working offline-first sync system

### Definition of Done (DoD) - Phase 2

Phase 2 is complete when:

- [ ] Desktop application launches on Windows, macOS, and Linux
- [ ] SQLite database initializes correctly
- [ ] File upload works via drag-and-drop and file picker
- [ ] Multiple files can be uploaded in one operation
- [ ] Uploaded crashes appear in crash list immediately
- [ ] Crash list supports sorting, filtering, and searching
- [ ] Pagination works correctly
- [ ] Application detects online/offline status
- [ ] Crashes created offline are queued for sync
- [ ] Sync triggers automatically when going online
- [ ] Sync conflicts are detected and logged
- [ ] UI shows clear online/offline indicator
- [ ] All database operations complete in <100ms
- [ ] Application is packaged for all three platforms
- [ ] Installation and uninstallation work correctly
- [ ] Application data persists across restarts
- [ ] Error handling provides clear user feedback
- [ ] Code is peer-reviewed and tested

---

## PHASE 3: AI Integration & Analysis

### Phase 3 Objective

Integrate AI models (local and cloud) to analyze crash logs and generate comprehensive insights including root cause analysis, suggested fixes, and test scenarios.

### Definition of Ready (DoR) - Phase 3

Before starting Phase 3, ensure:

- [ ] Phase 2 is complete and tested
- [ ] Decision made on AI providers (Ollama, OpenAI, Anthropic, Google)
- [ ] API keys obtained for cloud AI providers
- [ ] Ollama installed and tested locally (for local AI option)
- [ ] Sample crash logs available for testing AI analysis
- [ ] Prompt engineering guidelines documented
- [ ] AI analysis timeout and retry strategy defined
- [ ] AI cost budget established (for cloud providers)

### Phase 3: Step-by-Step Tasks

#### Task 3.1: AI Provider Abstraction Layer

**Action:** Create unified interface for multiple AI providers

**AI Service Architecture:**

```javascript
// Abstract base class
class AIProvider {
    constructor(config);

    async analyze(crashData, options): Promise<analysis>
    async testConnection(): Promise<boolean>
    getModelInfo(): modelInfo
    supportsStreaming(): boolean
}

// Concrete implementations
class OllamaProvider extends AIProvider {
    // Local Ollama integration
    // Models: llama3, codellama, mistral
}

class OpenAIProvider extends AIProvider {
    // OpenAI GPT-4, GPT-3.5
}

class AnthropicProvider extends AIProvider {
    // Claude 3 Opus, Sonnet, Haiku
}

class GoogleProvider extends AIProvider {
    // Gemini Pro, Ultra
}

// Factory pattern
class AIProviderFactory {
    static create(providerType, config): AIProvider
}

// Main AI service
class AIAnalysisService {
    constructor(provider);

    async analyzeCrash(crashId): Promise<analysis>
    async queueAnalysis(crashId, priority): Promise<queueId>
    async getAnalysisStatus(crashId): Promise<status>
    async reanalyze(crashId, provider): Promise<analysis>
}
```

**Deliverable:** AI abstraction layer with all providers

#### Task 3.2: Crash Log Parser

**Action:** Build intelligent crash log parser

**Parser Requirements:**

- Extract stack traces from various formats
- Identify error types and messages
- Parse timestamps
- Extract user reproduction steps (if present)
- Identify system information
- Handle malformed logs gracefully

**Parser Structure:**

```javascript
class CrashLogParser {
    parse(rawLogContent): ParsedCrash {
        stackTrace: string;
        errorType: string;
        errorMessage: string;
        timestamp: Date;
        userSteps: string[];
        systemInfo: object;
        logSections: {
            header: string;
            body: string;
            footer: string;
        };
        confidence: number; // 0-1, how confident parser is
    }

    // Format-specific parsers
    parseSmallTalkStackTrace(text): StackTrace
    parseSmallTalkError(text): Error
    extractUserSteps(text): string[]
    extractSystemInfo(text): object

    // Heuristics for different log formats
    detectLogFormat(content): LogFormat
}

// Example output
{
    stackTrace: "MessageNotUnderstood: receiver of \"foo\" is nil\n  Context PC = 123...",
    errorType: "MessageNotUnderstood",
    errorMessage: "receiver of 'foo' is nil",
    timestamp: "2025-11-07T10:30:45Z",
    userSteps: [
        "User clicked 'Export Report' button",
        "Selected PDF format from dropdown",
        "Clicked 'Generate' button"
    ],
    systemInfo: {
        platform: "Windows",
        version: "10.0.19045",
        smalltalkVersion: "VisualWorks 9.3",
        memory: "8GB"
    },
    confidence: 0.89
}
```

**Deliverable:** Robust crash log parser

#### Task 3.3: Comprehensive AI Prompt Engineering

**Action:** Design prompts for all analysis requirements

**Prompt Template Structure:**

```javascript
const AI_ANALYSIS_PROMPT = `
You are an expert VisualWorks Smalltalk developer and crash analyst. Analyze the following crash log and provide comprehensive insights.

# CRASH LOG DATA
Filename: {filename}
Error Type: {errorType}
Error Message: {errorMessage}

## Stack Trace
{stackTrace}

## User Steps (what the user was doing)
{userSteps}

## System Information
{systemInfo}

## Raw Log Content
{rawLogContent}

# YOUR ANALYSIS TASK
Provide a comprehensive analysis in the following JSON structure. Be thorough, specific, and actionable.

{
  "root_cause_analysis": "Detailed explanation of why this crash occurred. Identify the immediate cause, contributing factors, and the sequence of events that led to the crash. Reference specific line numbers or methods from the stack trace.",
  
  "suggested_fixes": [
    "Specific, actionable fix #1 with code examples if applicable",
    "Specific, actionable fix #2",
    "Specific, actionable fix #3"
  ],
  
  "remediation_steps": [
    "Step 1: Immediate action to prevent crash recurrence",
    "Step 2: Code changes needed (with specific methods/classes)",
    "Step 3: Testing approach",
    "Step 4: Deployment considerations"
  ],
  
  "severity": "critical|high|medium|low",
  "severity_reasoning": "Why this severity level was assigned",
  
  "affected_components": [
    "Component/module/class names affected by this crash"
  ],
  
  "user_steps_summary": "Clear, human-readable summary of what the user was doing when the crash occurred. Write this as if explaining to a non-technical person.",
  
  "test_scenarios": [
    {
      "title": "Test scenario 1 title",
      "steps": [
        "Test step 1",
        "Test step 2",
        "Test step 3"
      ],
      "expected_result": "What should happen if bug is fixed",
      "preconditions": "What needs to be set up before testing"
    }
  ],
  
  "prevention_strategies": [
    "Long-term strategy 1 to prevent similar crashes",
    "Long-term strategy 2 (e.g., architectural changes, validation improvements)",
    "Long-term strategy 3 (e.g., monitoring, alerts)"
  ],
  
  "potential_side_effects": [
    "Potential issue 1 that might arise from suggested fixes",
    "Potential issue 2 to watch for"
  ],
  
  "confidence_score": 0.0-1.0,
  "confidence_reasoning": "Why this confidence level (e.g., clear stack trace vs. ambiguous error)"
}

# IMPORTANT GUIDELINES
- Be specific: Reference exact classes, methods, and line numbers when available
- Be actionable: Every suggestion should be implementable
- Be thorough: Consider edge cases and dependencies
- Be clear: Write for both technical and non-technical audiences where appropriate
- Use Smalltalk terminology correctly
- If information is missing or unclear, state that explicitly rather than guessing

Provide ONLY the JSON response, no additional text.
`;
```

**Additional Prompt Templates:**

```javascript
// Pattern matching prompt for finding similar crashes
const PATTERN_MATCHING_PROMPT = `
Analyze this crash and compare it to the following historical crashes.
Identify which crashes are similar and explain the commonalities.

Current Crash:
{currentCrash}

Historical Crashes:
{historicalCrashes}

Return JSON:
{
  "similar_crash_ids": ["uuid1", "uuid2"],
  "similarity_reasoning": "Why these crashes are similar",
  "common_patterns": ["Pattern 1", "Pattern 2"],
  "unique_aspects": "What makes this crash different"
}
`;

// Simplified prompt for local models (smaller context window)
const LOCAL_MODEL_PROMPT = `
Analyze this Smalltalk crash:

Error: {errorMessage}
Stack: {stackTrace}

Provide:
1. Root cause (2-3 sentences)
2. Top 3 fixes
3. Severity (critical/high/medium/low)

Format as JSON.
`;
```

**Deliverable:** Complete prompt templates for all analysis types

#### Task 3.4: AI Analysis Pipeline Implementation

**Action:** Build the complete AI analysis workflow

**Pipeline Stages:**

```javascript
class AIAnalysisPipeline {
  async execute(crashId) {
    try {
      // Stage 1: Retrieve crash from database
      const crash = await this.database.getCrash(crashId);

      // Stage 2: Parse raw log
      const parsed = this.parser.parse(crash.raw_log_content);

      // Stage 3: Prepare AI prompt
      const prompt = this.preparePrompt(crash, parsed);

      // Stage 4: Call AI provider
      await this.updateStatus(crashId, "processing");
      const aiResponse = await this.aiProvider.analyze(prompt, {
        maxTokens: 4000,
        temperature: 0.3, // Lower = more consistent
        timeout: 60000, // 60 second timeout
      });

      // Stage 5: Parse AI response
      const analysis = this.parseAIResponse(aiResponse);

      // Stage 6: Validate analysis structure
      this.validateAnalysis(analysis);

      // Stage 7: Find similar crashes (pattern matching)
      const similarCrashes = await this.findSimilarCrashes(crash, analysis);
      analysis.similar_crash_ids = similarCrashes.map((c) => c.id);

      // Stage 8: Update database
      await this.database.updateCrash(crashId, {
        ai_analysis_status: "completed",
        ai_provider: this.aiProvider.name,
        ai_model_used: this.aiProvider.model,
        ai_analysis_timestamp: new Date().toISOString(),
        ...analysis,
      });

      // Stage 9: Sync to server if online
      if (this.syncService.isOnline()) {
        await this.syncService.pushCrash(crashId);
      }

      return { success: true, analysis };
    } catch (error) {
      // Error handling
      await this.handleAnalysisError(crashId, error);
      throw error;
    }
  }

  async findSimilarCrashes(currentCrash, analysis) {
    // Use embeddings or keyword matching to find similar crashes
    // Compare: error_type, error_message, affected_components
    // Return crashes with similarity score > 0.7
  }
}
```

**Error Handling:**

- Timeout after 60 seconds
- Retry up to 3 times with exponential backoff
- Log all failures with error details
- Update status to 'failed' with error message
- Allow manual retry via UI

**Deliverable:** Complete AI analysis pipeline

#### Task 3.5: AI Configuration UI

**Action:** Build settings interface for AI providers

**Configuration Interface:**

```jsx
<AISettingsPage>
  <ProviderSelector>
    // Radio buttons: Local (Ollama), OpenAI, Anthropic, Google
  </ProviderSelector>

  <ProviderConfig>
    // Ollama: Model selection (llama3, codellama), host URL // OpenAI: API key,
    model selection (gpt-4, gpt-3.5-turbo) // Anthropic: API key, model
    selection (claude-3-opus, sonnet) // Google: API key, model selection
    (gemini-pro)
  </ProviderConfig>

  <TestConnection>
    // Button to test API connection // Shows success/failure with details
  </TestConnection>

  <AnalysisSettings>
    // Auto-analyze new crashes: Yes/No // Max parallel analysis: 1-5 //
    Timeout: 30-120 seconds // Retry attempts: 1-5
  </AnalysisSettings>

  <SaveButton />
</AISettingsPage>
```

**Settings Storage:**

- Encrypt API keys before storing locally
- Store in secure Electron store or system keychain
- Never log or display API keys in plain text

**Deliverable:** AI configuration UI with secure credential storage

#### Task 3.6: Analysis Display UI

**Action:** Build crash detail view with AI analysis

**Detail View Structure:**

```jsx
<CrashDetailPage crashId={id}>
  <Header>
    <Filename />
    <Timestamp />
    <StatusBadges />
    <ActionButtons>
      <ReanalyzeButton />
      <ExportButton />
      <DeleteButton />
    </ActionButtons>
  </Header>

  <Tabs>
    <Tab label="Overview">
      <SeverityIndicator />
      <RootCauseAnalysis>
        // Formatted markdown with syntax highlighting
      </RootCauseAnalysis>
      <SuggestedFixes>// Numbered list with code snippets</SuggestedFixes>
      <AffectedComponents>// Tag-style display</AffectedComponents>
    </Tab>

    <Tab label="Remediation">
      <RemediationSteps>// Step-by-step checklist</RemediationSteps>
      <PreventionStrategies>// Expandable cards</PreventionStrategies>
      <PotentialSideEffects>// Warning-style display</PotentialSideEffects>
    </Tab>

    <Tab label="Testing">
      <UserStepsSummary>// Plain language explanation</UserStepsSummary>
      <TestScenarios>
        {scenarios.map((scenario) => (
          <TestScenarioCard>
            <Title />
            <Preconditions />
            <Steps />
            <ExpectedResult />
          </TestScenarioCard>
        ))}
      </TestScenarios>
    </Tab>

    <Tab label="Raw Log">
      <LogViewer>
        // Syntax-highlighted, line-numbered log content // Search functionality
      </LogViewer>
    </Tab>

    <Tab label="Similar Crashes">
      <SimilarCrashesList>
        // Links to similar crash records // Similarity reasoning
      </SimilarCrashesList>
    </Tab>
  </Tabs>

  <ValidationSection>
    <HumanSolutionInput>
      // Rich text editor for validated solution
    </HumanSolutionInput>
    <NotesInput />
    <ValidationButtons>
      <ValidateButton />
      <RejectButton />
      <NeedsRevisionButton />
    </ValidationButtons>
  </ValidationSection>
</CrashDetailPage>
```

**Deliverable:** Complete crash detail view with AI analysis display

### Definition of Done (DoD) - Phase 3

Phase 3 is complete when:

- [ ] AI provider abstraction layer supports all configured providers
- [ ] Ollama integration works with local models
- [ ] Cloud AI providers (OpenAI, Anthropic, Google) integrate correctly
- [ ] Crash log parser extracts all required information
- [ ] AI prompts are tested and produce quality results
- [ ] Analysis pipeline executes successfully end-to-end
- [ ] AI analysis completes in <60 seconds for typical crash logs
- [ ] Error handling and retries work correctly
- [ ] AI configuration UI allows provider switching
- [ ] API keys are stored securely (encrypted)
- [ ] Test connection feature verifies AI provider connectivity
- [ ] Crash detail view displays all AI analysis components
- [ ] Analysis results are properly formatted and readable
- [ ] Similar crash detection finds relevant matches
- [ ] All AI operations are logged for debugging
- [ ] AI analysis syncs to server when online
- [ ] Offline crashes are queued for analysis when back online
- [ ] Re-analysis feature works correctly
- [ ] Code is peer-reviewed and tested
- [ ] AI costs are within budget (for cloud providers)

---

## PHASE 4: Search & Human Validation Workflow

### Phase 4 Objective

Implement comprehensive search functionality and build the human validation workflow for reviewing and approving AI-generated solutions.

### Definition of Ready (DoR) - Phase 4

Before starting Phase 4, ensure:

- [ ] Phase 3 is complete with working AI analysis
- [ ] Sample crashes are in the system with AI analysis
- [ ] Search requirements are documented
- [ ] Validation workflow is designed and approved
- [ ] User roles are defined (if multi-user)
- [ ] UI mockups for validation workflow are approved

### Phase 4: Step-by-Step Tasks

#### Task 4.1: Advanced Search Implementation

**Action:** Build powerful search and filter system

**Search Features:**

1. **Full-text search** across all crash fields
2. **Faceted search** with multiple filters
3. **Saved searches** for common queries
4. **Search history**
5. **Export search results**

**Search Architecture:**

```javascript
class SearchService {
    // Full-text search
    async search(query, options) {
        // Query: search terms
        // Options: filters, sorting, pagination

        // Desktop: Use SQLite FTS5
        // Server: Use PostgreSQL tsvector

        return {
            results: [...],
            total: count,
            facets: {
                severity: { critical: 5, high: 12, medium: 23, low: 45 },
                validation_status: { pending: 30, validated: 40, rejected: 5 },
                ai_provider: { ollama: 20, openai: 35, anthropic: 20 }
            },
            took_ms: 45
        };
    }

    // Filter options
    filters: {
        severity: ['critical', 'high', 'medium', 'low'],
        validation_status: ['pending', 'validated', 'rejected', 'needs_revision'],
        ai_analysis_status: ['pending', 'processing', 'completed', 'failed'],
        date_range: { from: Date, to: Date },
        components: string[],
        tags: string[],
        error_type: string
    }

    // Sorting options
    sort: {
        field: 'created_at' | 'severity' | 'filename' | 'validation_status',
        order: 'asc' | 'desc'
    }

    // Save search
    async saveSearch(name, query, filters): searchId
    async getSavedSearches(): searches[]
    async deleteSavedSearch(id): boolean
}
```

**Search UI:**

```jsx
<SearchPage>
  <SearchBar>
    <Input placeholder="Search crashes..." />
    <SearchButton />
    <AdvancedSearchToggle />
  </SearchBar>

  <AdvancedFilters collapsed={!showAdvanced}>
    <FilterGroup label="Severity">
      <Checkboxes />
    </FilterGroup>
    <FilterGroup label="Validation Status">
      <Checkboxes />
    </FilterGroup>
    <FilterGroup label="Date Range">
      <DateRangePicker />
    </FilterGroup>
    <FilterGroup label="Components">
      <MultiSelect />
    </FilterGroup>
    <FilterGroup label="Tags">
      <TagSelector />
    </FilterGroup>
    <ClearFiltersButton />
  </AdvancedFilters>

  <ResultsSummary>
    // "Showing 25 of 127 results" // Active filters as removable chips
  </ResultsSummary>

  <FacetSidebar>// Quick filter counts // Click to apply filter</FacetSidebar>

  <SearchResults>
    <ResultCard>
      // Crash summary with highlighted search terms // Quick actions: View,
      Validate, Export
    </ResultCard>
  </SearchResults>

  <SavedSearches>
    <SaveCurrentSearch />
    <SavedSearchList>// Click to load saved search</SavedSearchList>
  </SavedSearches>
</SearchPage>
```

**Search Optimization:**

- Debounce search input (300ms delay)
- Cache recent search results (5 minutes)
- Index all searchable fields
- Use pagination to limit result sets
- Highlight search terms in results

**Deliverable:** Full-featured search system

#### Task 4.2: Validation Workflow Design

**Action:** Build human review and approval system

**Validation States:**

1. **Pending** - Awaiting human review (default after AI analysis)
2. **Validated** - Human has reviewed and approved AI analysis + added solution
3. **Rejected** - AI analysis was incorrect or unhelpful
4. **Needs Revision** - AI analysis partially correct but needs improvement

**Validation Workflow:**

```javascript
class ValidationService {
  // Start validation process
  async startValidation(crashId, userId) {
    // Lock crash for editing (prevent concurrent edits)
    // Set validation_in_progress flag
    // Record who is validating
  }

  // Submit validation
  async submitValidation(crashId, validationData) {
    // validationData: {
    //   status: 'validated' | 'rejected' | 'needs_revision',
    //   human_solution: string,
    //   human_notes: string,
    //   validated_by: string,
    //   corrections: {
    //     corrected_severity?: string,
    //     corrected_components?: string[],
    //     additional_fixes?: string[]
    //   }
    // }

    await this.database.updateCrash(crashId, {
      validation_status: validationData.status,
      validated_by: validationData.validated_by,
      validated_at: new Date().toISOString(),
      human_solution: validationData.human_solution,
      human_notes: validationData.human_notes,
      ...validationData.corrections,
    });

    // Unlock crash
    // Sync to server
    // Emit validation event
  }

  // Get validation queue (crashes pending review)
  async getValidationQueue(options) {
    // Return crashes with ai_analysis_status = 'completed'
    // AND validation_status = 'pending'
    // Sorted by severity (critical first), then date
  }

  // Validation statistics
  async getValidationStats() {
    return {
      pending: count,
      validated: count,
      rejected: count,
      needs_revision: count,
      avg_validation_time_hours: number,
    };
  }
}
```

**Validation UI:**

```jsx
<ValidationPage>
  <ValidationQueue>
    <QueueStats>// Count of pending validations by severity</QueueStats>
    <QueueList>
      <QueueItem>
        // Crash summary, severity badge // "Start Validation" button
      </QueueItem>
    </QueueList>
  </ValidationQueue>

  <ValidationEditor crashId={selectedCrash}>
    <Split orientation="horizontal">
      <LeftPane>
        <AIAnalysisDisplay>
          // Read-only view of AI analysis // Collapsible sections
          <RootCause />
          <SuggestedFixes />
          <RemediationSteps />
          <TestScenarios />
        </AIAnalysisDisplay>
        <RawLogViewer>// Reference material</RawLogViewer>
      </LeftPane>

      <RightPane>
        <ValidationForm>
          <StatusSelector>
            // Radio buttons: Validate, Reject, Needs Revision
          </StatusSelector>

          <HumanSolutionEditor>
            // Rich text editor (markdown support) // Label: "Confirmed Solution
            (required for validation)" // Placeholder: "Describe the actual fix
            implemented..."
          </HumanSolutionEditor>

          <CorrectionsSection>
            // Optional corrections to AI analysis
            <SeverityCorrection />
            <ComponentCorrection />
            <AdditionalFixes />
          </CorrectionsSection>

          <NotesEditor>
            // Optional notes for future reference // Label: "Internal Notes"
          </NotesEditor>

          <ValidationActions>
            <SubmitButton />
            <SaveDraftButton />
            <CancelButton />
          </ValidationActions>
        </ValidationForm>
      </RightPane>
    </Split>
  </ValidationEditor>
</ValidationPage>
```

**Validation Workflow Features:**

- Auto-save drafts every 30 seconds
- Warn before navigating away from unsaved changes
- Required fields: status, human_solution (if validated)
- Character limits: human_solution (10,000 chars), notes (5,000 chars)
- Markdown preview for formatted text
- Keyboard shortcuts: Ctrl+Enter to submit, Esc to cancel

**Deliverable:** Complete validation workflow

#### Task 4.3: Validation Dashboard

**Action:** Build analytics and reporting for validated crashes

**Dashboard Features:**

```jsx
<ValidationDashboard>
  <StatsCards>
    <StatCard title="Pending Validation">
      // Count with severity breakdown
    </StatCard>
    <StatCard title="Validated This Week">
      // Count with trend indicator
    </StatCard>
    <StatCard title="Average Validation Time">// Hours, with trend</StatCard>
    <StatCard title="AI Accuracy Rate">// % validated vs. rejected</StatCard>
  </StatsCards>

  <Charts>
    <TimeSeriesChart title="Validations Over Time">
      // Line chart: validated, rejected, needs_revision
    </TimeSeriesChart>

    <PieChart title="Validation Status Distribution">
      // Pending, validated, rejected, needs_revision
    </PieChart>

    <BarChart title="Crashes by Severity">
      // Critical, high, medium, low
    </BarChart>

    <BarChart title="Top Components with Crashes">
      // Most frequently crashing components
    </BarChart>
  </Charts>

  <RecentValidations>
    <Table>
      // Last 10 validations // Columns: Crash, Validator, Status, Date
    </Table>
  </RecentValidations>

  <ValidatorLeaderboard>
    // Who has validated the most crashes // Gamification element
  </ValidatorLeaderboard>
</ValidationDashboard>
```

**Analytics Queries:**

```javascript
// Implement backend queries for dashboard
- Count crashes by validation_status
- Count crashes by severity
- Avg time between ai_analysis_timestamp and validated_at
- AI accuracy: validated_count / (validated_count + rejected_count)
- Top 10 components by crash count
- Validations per user
- Time series: validations per day/week/month
```

**Deliverable:** Validation dashboard with analytics

#### Task 4.4: Tag & Category Management

**Action:** Build crash organization system

**Tagging System:**

```javascript
class TagService {
    // Predefined tags
    systemTags: [
        'ui-crash',
        'data-corruption',
        'memory-leak',
        'performance',
        'security',
        'integration-issue',
        'regression',
        'known-issue'
    ];

    // Custom tags
    async createTag(name, color): tag
    async getTags(): tags[]
    async addTagToCrash(crashId, tagName): boolean
    async removeTagFromCrash(crashId, tagName): boolean

    // Tag-based search
    async getCrashesByTag(tagName): crashes[]

    // Tag statistics
    async getTagStats(): { tagName: count }
}
```

**Category System:**

```javascript
// Predefined categories for crash classification
categories: [
  "UI/Frontend",
  "Business Logic",
  "Database/Persistence",
  "Integration/API",
  "Performance",
  "Security",
  "Configuration",
  "Third-Party",
  "Unknown",
];
```

**Tag & Category UI:**

```jsx
<CrashDetailPage>
  <TagSection>
    <ExistingTags>
      <Tag name="ui-crash" removable />
      <Tag name="regression" removable />
    </ExistingTags>
    <AddTagButton>
      // Autocomplete dropdown with existing tags
      // Option to create new tag
    </AddTagButton>
  </TagSection>

  <CategorySelector>
    <Dropdown options={categories} />
  </CategorySelector>
</CrashDetailPage>

<SearchPage>
  <FilterByTag>
    // Multi-select tag filter
  </FilterByTag>
  <FilterByCategory>
    // Category dropdown filter
  </FilterByCategory>
</SearchPage>
```

**Deliverable:** Tag and category management system

### Definition of Done (DoD) - Phase 4

Phase 4 is complete when:

- [ ] Full-text search returns relevant results in <500ms
- [ ] Advanced filters work correctly (all combinations)
- [ ] Faceted search displays accurate counts
- [ ] Saved searches persist and load correctly
- [ ] Search results highlight matching terms
- [ ] Validation workflow allows approval/rejection
- [ ] Human solution editor supports markdown
- [ ] Validation form validation works (required fields)
- [ ] Auto-save drafts every 30 seconds
- [ ] Validation queue shows pending crashes
- [ ] Validation statistics are accurate
- [ ] Dashboard displays correct analytics
- [ ] Charts update in real-time
- [ ] Tag system allows adding/removing tags
- [ ] Category selector updates crash category
- [ ] Search by tag/category works correctly
- [ ] Validation status changes sync to server
- [ ] All validations are logged in sync_log
- [ ] Code is peer-reviewed and tested
- [ ] Performance testing shows acceptable response times

---

## PHASE 5: Web Application Development

### Phase 5 Objective

Build the web version of the application with identical functionality to the desktop app, using IndexedDB for offline storage and syncing to the same PostgreSQL backend.

### Definition of Ready (DoR) - Phase 5

Before starting Phase 5, ensure:

- [ ] Phase 4 is complete and stable
- [ ] Desktop app is fully functional and tested
- [ ] Web hosting environment is decided (cloud provider)
- [ ] Domain name is registered (if needed)
- [ ] SSL certificate strategy is defined
- [ ] Authentication strategy is designed
- [ ] Web UI framework is chosen (React recommended for consistency)
- [ ] IndexedDB strategy is documented
- [ ] Cross-browser testing plan is ready

### Phase 5: Step-by-Step Tasks

#### Task 5.1: Web Application Foundation

**Action:** Set up React web app with build pipeline

**Project Structure:**

```
smalltalk-crash-web/
├── src/
│   ├── components/       // Shared with desktop (maximum reuse)
│   ├── pages/
│   ├── services/
│   │   ├── api/         // REST API client
│   │   ├── database/    // IndexedDB wrapper
│   │   └── sync/        // Web sync service
│   ├── hooks/           // React hooks
│   ├── store/           // State management
│   ├── utils/
│   ├── App.jsx
│   └── index.jsx
├── public/
├── package.json
└── vite.config.js (or webpack)
```

**Implementation:**

1. Initialize React project with Vite or Create React App
2. Configure build pipeline for production
3. Set up routing (React Router)
4. Implement responsive design (mobile, tablet, desktop)
5. Configure service worker for offline support
6. Set up error boundary components
7. Implement loading states and skeletons
8. Add toast notifications system

**Deliverable:** Web app skeleton with routing and basic layout

#### Task 5.2: IndexedDB Implementation

**Action:** Build offline storage using IndexedDB

**IndexedDB Schema:**

```javascript
// Database name: 'smalltalk_crash_db'
// Version: 1

const DB_SCHEMA = {
    crashes: {
        keyPath: 'id',
        indexes: {
            created_at: { unique: false },
            severity: { unique: false },
            validation_status: { unique: false },
            needs_push: { unique: false },
            filename: { unique: false, fullText: true },
            error_message: { unique: false, fullText: true }
        }
    },
    sync_queue: {
        keyPath: 'id',
        indexes: {
            timestamp: { unique: false },
            crash_id: { unique: false }
        }
    },
    app_state: {
        keyPath: 'key'
        // Stores: last_sync_timestamp, device_id, settings
    }
};

// IndexedDB wrapper service
class IndexedDBService {
    constructor(dbName, version, schema);

    async open(): Promise<db>
    async close(): void

    // CRUD operations
    async add(storeName, data): Promise<id>
    async get(storeName, id): Promise<data>
    async getAll(storeName): Promise<data[]>
    async update(storeName, id, data): Promise<boolean>
    async delete(storeName, id): Promise<boolean>

    // Query operations
    async query(storeName, indexName, query): Promise<data[]>
    async count(storeName, indexName, query): Promise<number>

    // Bulk operations
    async bulkAdd(storeName, dataArray): Promise<ids[]>
    async bulkDelete(storeName, ids[]): Promise<boolean>

    // Search (using indexes)
    async searchCrashes(searchTerm): Promise<crashes[]>
}
```

**Full-Text Search Strategy for Web:**

```javascript
// Since IndexedDB doesn't have native FTS, implement client-side search
class ClientSideSearch {
  async search(query, options) {
    // 1. Get all crashes from IndexedDB
    const crashes = await db.getAll("crashes");

    // 2. Build search index (cache in memory)
    const searchableFields = crashes.map((c) => ({
      id: c.id,
      text: [
        c.filename,
        c.error_message,
        c.root_cause_analysis,
        c.raw_log_content,
      ]
        .join(" ")
        .toLowerCase(),
    }));

    // 3. Filter by query terms
    const terms = query.toLowerCase().split(" ");
    const results = searchableFields.filter((item) =>
      terms.every((term) => item.text.includes(term))
    );

    // 4. Return full crash objects
    return results.map((r) => crashes.find((c) => c.id === r.id));
  }
}
```

**Deliverable:** Working IndexedDB storage with CRUD operations

#### Task 5.3: Web Sync Service

**Action:** Implement offline-first sync for web

**Web Sync Architecture:**

```javascript
class WebSyncService {
    constructor(indexedDB, apiClient);

    async sync() {
        // 1. Check online status
        if (!navigator.onLine) {
            console.log('Offline - sync postponed');
            return { success: false, reason: 'offline' };
        }

        // 2. Push local changes to server
        const pushResult = await this.pushLocalChanges();

        // 3. Pull server changes
        const lastSync = await this.getLastSyncTimestamp();
        const pullResult = await this.pullServerChanges(lastSync);

        // 4. Update last sync timestamp
        await this.setLastSyncTimestamp(new Date());

        // 5. Emit sync event
        this.emitSyncEvent('completed', { pushResult, pullResult });

        return { success: true, pushed: pushResult.count, pulled: pullResult.count };
    }

    async pushLocalChanges() {
        // Get all records with needs_push = 1
        const unsyncedCrashes = await this.indexedDB.query(
            'crashes',
            'needs_push',
            1
        );

        if (unsyncedCrashes.length === 0) {
            return { count: 0 };
        }

        // Batch upload to server
        const response = await this.apiClient.post('/api/v1/sync/push', {
            crashes: unsyncedCrashes,
            device_id: this.getDeviceId(),
            timestamp: new Date().toISOString()
        });

        // Mark as synced
        for (const crash of unsyncedCrashes) {
            await this.indexedDB.update('crashes', crash.id, {
                needs_push: 0,
                last_synced_at: new Date().toISOString(),
                sync_version: crash.sync_version + 1
            });
        }

        return { count: unsyncedCrashes.length };
    }

    async pullServerChanges(lastSyncTimestamp) {
        // Request changes since last sync
        const response = await this.apiClient.post('/api/v1/sync/pull', {
            device_id: this.getDeviceId(),
            last_sync_timestamp: lastSyncTimestamp
        });

        const serverChanges = response.data.crashes;

        // Merge server changes with local database
        for (const serverCrash of serverChanges) {
            const localCrash = await this.indexedDB.get('crashes', serverCrash.id);

            if (!localCrash) {
                // New crash from server - add locally
                await this.indexedDB.add('crashes', {
                    ...serverCrash,
                    needs_push: 0
                });
            } else if (localCrash.sync_version < serverCrash.sync_version) {
                // Server version is newer - update local
                await this.indexedDB.update('crashes', serverCrash.id, {
                    ...serverCrash,
                    needs_push: 0
                });
            } else if (localCrash.sync_version > serverCrash.sync_version) {
                // Local version is newer - already in push queue
                console.log('Local version newer, will push on next sync');
            } else {
                // Same version - check if local has unpushed changes
                if (localCrash.needs_push === 1) {
                    // Conflict! Need resolution
                    await this.resolveConflict(localCrash, serverCrash);
                }
            }
        }

        return { count: serverChanges.length };
    }

    async resolveConflict(localCrash, serverCrash) {
        // Conflict resolution strategy: Server wins for validated crashes
        if (serverCrash.validation_status !== 'pending') {
            // Server has validated version - accept it
            await this.indexedDB.update('crashes', serverCrash.id, {
                ...serverCrash,
                needs_push: 0
            });
            console.log('Conflict resolved: Server wins (validated)');
        } else if (localCrash.updated_at > serverCrash.updated_at) {
            // Local is more recent - keep local version
            console.log('Conflict resolved: Local wins (newer timestamp)');
        } else {
            // Server is more recent - accept server version
            await this.indexedDB.update('crashes', serverCrash.id, {
                ...serverCrash,
                needs_push: 0
            });
            console.log('Conflict resolved: Server wins (newer timestamp)');
        }
    }

    // Auto-sync on connection change
    startAutoSync() {
        // Sync every 5 minutes if online
        this.syncInterval = setInterval(() => {
            if (navigator.onLine) {
                this.sync();
            }
        }, 5 * 60 * 1000);

        // Sync when connection restored
        window.addEventListener('online', () => {
            console.log('Connection restored - syncing...');
            this.sync();
        });
    }
}
```

**Deliverable:** Web sync service with offline support

#### Task 5.4: Component Reuse & Web-Specific Components

**Action:** Adapt desktop components for web, create web-specific UI

**Reusable Components (share between desktop and web):**

- FileUploader (with web File API instead of Electron)
- CrashList
- CrashDetail
- SearchBar
- FilterPanel
- ValidationEditor
- AIAnalysisDisplay
- TagManager

**Web-Specific Components:**

```jsx
// Navigation bar with menu
<WebNavBar>
  <Logo />
  <NavLinks>
    <Link to="/dashboard">Dashboard</Link>
    <Link to="/crashes">Crashes</Link>
    <Link to="/validate">Validate</Link>
    <Link to="/search">Search</Link>
    <Link to="/settings">Settings</Link>
  </NavLinks>
  <UserMenu>
    // Future: User profile, logout
  </UserMenu>
  <OnlineIndicator />
</WebNavBar>

// Responsive mobile menu
<MobileMenu>
  <Drawer>
    // Slide-out navigation for mobile
  </Drawer>
</MobileMenu>

// Install PWA prompt
<PWAInstallPrompt>
  // "Install this app for offline access"
  <InstallButton />
  <DismissButton />
</PWAInstallPrompt>

// Update notification
<UpdateNotification>
  // "New version available"
  <ReloadButton />
</UpdateNotification>
```

**Responsive Design:**

- Mobile: Single column, drawer navigation, bottom nav bar
- Tablet: Two columns, side navigation
- Desktop: Three columns (list + detail + sidebar), full navigation

**Deliverable:** Web UI with reused and web-specific components

#### Task 5.5: Progressive Web App (PWA) Configuration

**Action:** Make web app installable and fully offline-capable

**PWA Requirements:**

1. **Manifest file** (manifest.json)
2. **Service Worker** for offline caching
3. **HTTPS** (required for PWA)
4. **Icons** for all platforms

**Manifest Configuration:**

```json
{
  "name": "Smalltalk Crash Analyzer",
  "short_name": "Crash Analyzer",
  "description": "AI-powered crash analysis for VisualWorks Smalltalk",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

**Service Worker Strategy:**

```javascript
// Use Workbox for service worker
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate, CacheFirst } from "workbox-strategies";

// Precache all build assets
precacheAndRoute(self.__WB_MANIFEST);

// Cache API responses with stale-while-revalidate
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new StaleWhileRevalidate({
    cacheName: "api-cache",
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => {
          // Only cache successful responses
          return response.status === 200 ? response : null;
        },
      },
    ],
  })
);

// Cache static assets with cache-first
registerRoute(
  ({ request }) =>
    request.destination === "image" || request.destination === "font",
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [
      {
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    ],
  })
);
```

**Deliverable:** Installable PWA with offline support

#### Task 5.6: Cross-Browser Testing & Optimization

**Action:** Ensure compatibility and performance

**Browser Support Matrix:**

- Chrome 100+ (primary)
- Firefox 100+ (primary)
- Safari 15+ (primary)
- Edge 100+ (primary)
- Mobile Chrome (Android)
- Mobile Safari (iOS)

**Testing Checklist:**

- [ ] IndexedDB works in all browsers
- [ ] Service Worker registers correctly
- [ ] File upload works in all browsers
- [ ] Sync functionality works
- [ ] UI renders correctly (no layout breaks)
- [ ] Search performance is acceptable (<1s)
- [ ] Offline mode works (airplane mode test)
- [ ] PWA installs correctly
- [ ] No console errors or warnings
- [ ] Accessibility: keyboard navigation, screen reader support

**Performance Optimization:**

- Lazy load routes (code splitting)
- Compress images
- Minimize bundle size (<500KB initial load)
- Use React.memo for expensive components
- Virtualize long lists (react-window)
- Debounce search input
- Optimize re-renders

**Deliverable:** Cross-browser compatible, optimized web app

### Definition of Done (DoD) - Phase 5

Phase 5 is complete when:

- [ ] Web application runs in all supported browsers
- [ ] IndexedDB stores crashes correctly
- [ ] File upload works from web interface
- [ ] Crash list displays with pagination and filters
- [ ] Search functionality works (full-text)
- [ ] Validation workflow functions correctly
- [ ] Web app syncs with PostgreSQL server
- [ ] Offline mode works (create/view crashes offline)
- [ ] Sync triggers automatically when going online
- [ ] PWA manifest is configured correctly
- [ ] Service Worker caches assets appropriately
- [ ] App is installable on desktop and mobile
- [ ] Responsive design works on all screen sizes
- [ ] No layout breaks on any supported browser
- [ ] Performance: Time to Interactive < 3s on 3G
- [ ] Performance: Search results in < 1s
- [ ] Accessibility: WCAG 2.1 AA compliance
- [ ] Cross-browser testing passes
- [ ] Web and desktop apps have feature parity
- [ ] Code is peer-reviewed and tested
- [ ] Production deployment is successful

---

## PHASE 6: Sync Refinement & Conflict Resolution

### Phase 6 Objective

Enhance the synchronization system with robust conflict resolution, sync status indicators, and reliability improvements to handle complex offline scenarios.

### Definition of Ready (DoR) - Phase 6

Before starting Phase 6, ensure:

- [ ] Phase 5 is complete (both desktop and web working)
- [ ] Sync issues and edge cases are documented
- [ ] Conflict scenarios are identified and prioritized
- [ ] Test cases for sync conflicts are written
- [ ] Decision made on conflict resolution UI approach

### Phase 6: Step-by-Step Tasks

#### Task 6.1: Advanced Conflict Detection

**Action:** Implement sophisticated conflict detection

**Conflict Scenarios:**

```javascript
// Conflict types
const ConflictTypes = {
  CONCURRENT_EDIT: "concurrent_edit", // Both devices edited same crash
  DELETE_UPDATE: "delete_update", // One deleted, other updated
  OFFLINE_VALIDATION: "offline_validation", // Validated offline on multiple devices
  VERSION_MISMATCH: "version_mismatch", // Sync version out of sync
};

class ConflictDetector {
  detectConflict(localCrash, serverCrash) {
    // No conflict if one is null
    if (!localCrash || !serverCrash) {
      return { hasConflict: false };
    }

    // No conflict if versions match and local is synced
    if (
      localCrash.sync_version === serverCrash.sync_version &&
      localCrash.needs_push === 0
    ) {
      return { hasConflict: false };
    }

    // Detect conflict type
    if (localCrash.deleted_at && serverCrash.deleted_at === null) {
      return {
        hasConflict: true,
        type: ConflictTypes.DELETE_UPDATE,
        localState: "deleted",
        serverState: "active",
      };
    }

    if (serverCrash.deleted_at && localCrash.deleted_at === null) {
      return {
        hasConflict: true,
        type: ConflictTypes.DELETE_UPDATE,
        localState: "active",
        serverState: "deleted",
      };
    }

    if (
      localCrash.validation_status !== "pending" &&
      serverCrash.validation_status !== "pending" &&
      localCrash.validation_status !== serverCrash.validation_status
    ) {
      return {
        hasConflict: true,
        type: ConflictTypes.OFFLINE_VALIDATION,
        localValidation: localCrash.validation_status,
        serverValidation: serverCrash.validation_status,
      };
    }

    if (
      localCrash.updated_at !== serverCrash.updated_at &&
      localCrash.needs_push === 1
    ) {
      return {
        hasConflict: true,
        type: ConflictTypes.CONCURRENT_EDIT,
        localTimestamp: localCrash.updated_at,
        serverTimestamp: serverCrash.updated_at,
      };
    }

    return { hasConflict: false };
  }

  getDiff(localCrash, serverCrash) {
    // Return field-level differences
    const fields = [
      "error_message",
      "severity",
      "root_cause_analysis",
      "suggested_fixes",
      "validation_status",
      "human_solution",
      "tags",
      "category",
    ];

    const diff = {};
    for (const field of fields) {
      if (
        JSON.stringify(localCrash[field]) !== JSON.stringify(serverCrash[field])
      ) {
        diff[field] = {
          local: localCrash[field],
          server: serverCrash[field],
        };
      }
    }

    return diff;
  }
}
```

**Deliverable:** Conflict detection system

#### Task 6.2: Automatic Conflict Resolution

**Action:** Implement automatic resolution for simple conflicts

**Resolution Strategies:**

```javascript
class ConflictResolver {
  async resolveAutomatic(conflict, localCrash, serverCrash) {
    switch (conflict.type) {
      case ConflictTypes.DELETE_UPDATE:
        // Delete wins (safety first)
        return this.resolveDeleteUpdate(conflict, localCrash, serverCrash);

      case ConflictTypes.CONCURRENT_EDIT:
        // Try automatic merge, fallback to manual
        return this.resolveConcurrentEdit(localCrash, serverCrash);

      case ConflictTypes.OFFLINE_VALIDATION:
        // Validated wins over other statuses
        return this.resolveOfflineValidation(localCrash, serverCrash);

      case ConflictTypes.VERSION_MISMATCH:
        // Server wins (source of truth)
        return { resolution: "server_wins", merged: serverCrash };

      default:
        return { resolution: "manual", merged: null };
    }
  }

  resolveDeleteUpdate(conflict, localCrash, serverCrash) {
    // Delete always wins (safety)
    if (conflict.localState === "deleted") {
      return {
        resolution: "local_wins",
        merged: localCrash,
        reason: "Delete operation takes precedence",
      };
    } else {
      return {
        resolution: "server_wins",
        merged: serverCrash,
        reason: "Delete operation takes precedence",
      };
    }
  }

  resolveConcurrentEdit(localCrash, serverCrash) {
    // Check if changes are in different fields (can auto-merge)
    const diff = new ConflictDetector().getDiff(localCrash, serverCrash);

    // If no overlapping field changes, merge both
    const localChangedFields = Object.keys(diff);
    const canAutoMerge = this.changesAreCompatible(diff);

    if (canAutoMerge) {
      // Merge: take server as base, apply local changes
      const merged = { ...serverCrash };
      for (const field of localChangedFields) {
        merged[field] = localCrash[field];
      }
      merged.sync_version =
        Math.max(localCrash.sync_version, serverCrash.sync_version) + 1;

      return {
        resolution: "auto_merged",
        merged,
        reason: "Non-overlapping changes merged automatically",
      };
    } else {
      // Cannot auto-merge - need manual resolution
      return {
        resolution: "manual",
        merged: null,
        reason: "Conflicting changes to same fields",
      };
    }
  }

  resolveOfflineValidation(localCrash, serverCrash) {
    // Priority: validated > needs_revision > rejected > pending
    const priority = {
      validated: 4,
      needs_revision: 3,
      rejected: 2,
      pending: 1,
    };

    const localPriority = priority[localCrash.validation_status] || 0;
    const serverPriority = priority[serverCrash.validation_status] || 0;

    if (localPriority > serverPriority) {
      return {
        resolution: "local_wins",
        merged: localCrash,
        reason: `Local validation status (${localCrash.validation_status}) takes precedence`,
      };
    } else {
      return {
        resolution: "server_wins",
        merged: serverCrash,
        reason: `Server validation status (${serverCrash.validation_status}) takes precedence`,
      };
    }
  }

  changesAreCompatible(diff) {
    // Check if changes can be merged without conflict
    // Compatible if: changes are to different fields OR
    // changes are additive (e.g., adding tags, not replacing)

    for (const field in diff) {
      const { local, server } = diff[field];

      // If field is an array, check if changes are additive
      if (Array.isArray(local) && Array.isArray(server)) {
        const localSet = new Set(local);
        const serverSet = new Set(server);
        const isAdditive =
          local.every((item) => serverSet.has(item)) ||
          server.every((item) => localSet.has(item));

        if (!isAdditive) {
          return false; // Conflicting array changes
        }
      }
    }

    return true;
  }
}
```

**Deliverable:** Automatic conflict resolution

#### Task 6.3: Manual Conflict Resolution UI

**Action:** Build UI for user to resolve conflicts

**Conflict Resolution Interface:**

```jsx
<ConflictResolutionModal conflict={conflict}>
  <Header>
    <Icon type="warning" />
    <Title>Sync Conflict Detected</Title>
    <ConflictType>{conflict.type}</ConflictType>
  </Header>

  <ConflictDescription>
    // Human-readable explanation of conflict // "This crash was modified both
    locally and on the server"
  </ConflictDescription>

  <ComparisonView>
    <Split orientation="vertical">
      <LocalVersion>
        <Label>Your Local Version</Label>
        <Timestamp>{localCrash.updated_at}</Timestamp>
        <DiffView
          data={localCrash}
          diff={conflict.diff}
          highlightChanges={true}
        />
      </LocalVersion>

      <ServerVersion>
        <Label>Server Version</Label>
        <Timestamp>{serverCrash.updated_at}</Timestamp>
        <DiffView
          data={serverCrash}
          diff={conflict.diff}
          highlightChanges={true}
        />
      </ServerVersion>
    </Split>
  </ComparisonView>

  <FieldByFieldComparison>
    {Object.entries(conflict.diff).map(([field, versions]) => (
      <FieldComparison>
        <FieldName>{field}</FieldName>
        <VersionChoice>
          <Radio
            value="local"
            label="Keep Local"
            checked={choices[field] === "local"}
          />
          <LocalValue>{versions.local}</LocalValue>
        </VersionChoice>
        <VersionChoice>
          <Radio
            value="server"
            label="Keep Server"
            checked={choices[field] === "server"}
          />
          <ServerValue>{versions.server}</ServerValue>
        </VersionChoice>
      </FieldComparison>
    ))}
  </FieldByFieldComparison>

  <QuickActions>
    <Button variant="secondary" onClick={keepLocal}>
      Keep All Local Changes
    </Button>
    <Button variant="secondary" onClick={keepServer}>
      Keep All Server Changes
    </Button>
    <Button variant="primary" onClick={submitCustomResolution}>
      Apply Custom Resolution
    </Button>
  </QuickActions>

  <CancelButton onClick={postpone}>Resolve Later</CancelButton>
</ConflictResolutionModal>
```

**Conflict Resolution Workflow:**

1. User triggers sync (manual or automatic)
2. Conflicts detected during sync
3. Modal appears for each conflict (or batched)
4. User chooses resolution (field-by-field or wholesale)
5. Resolution applied and sync continues
6. Conflict logged in sync_log table

**Deliverable:** Manual conflict resolution UI

#### Task 6.4: Sync Status Indicators & Logging

**Action:** Build comprehensive sync visibility

**Sync Status System:**

```javascript
class SyncStatusManager {
    // Real-time sync status
    status: {
        state: 'idle' | 'syncing' | 'conflict' | 'error' | 'success',
        lastSyncTime: Date,
        nextSyncTime: Date,
        pendingChanges: number,
        conflictCount: number,
        errors: string[]
    };

    // Emit status updates
    on('status-changed', (status) => {
        // Update UI indicators
    });

    // Sync history
    async getSyncHistory(limit = 20) {
        // Return recent sync operations from sync_log
        return {
            syncs: [
                {
                    timestamp: Date,
                    action: 'push' | 'pull' | 'conflict_resolved',
                    status: 'success' | 'failed' | 'partial',
                    details: string,
                    crashes_affected: number
                }
            ]
        };
    }
}
```

**UI Indicators:**

```jsx
<SyncStatusIndicator>
  {status === 'idle' && (
    <StatusBadge color="gray">
      <Icon name="cloud-check" />
      Synced
      <Timestamp>{formatRelative(lastSyncTime)}</Timestamp>
    </StatusBadge>
  )}

  {status === 'syncing' && (
    <StatusBadge color="blue" animated>
      <Spinner />
      Syncing...
      <ProgressBar current={syncProgress} />
    </StatusBadge>
  )}

  {status === 'conflict' && (
    <StatusBadge color="orange">
      <Icon name="alert-triangle" />
      {conflictCount} Conflict{conflictCount > 1 ? 's' : ''}
      <ResolveButton />
    </StatusBadge>
  )}

  {status === 'error' && (
    <StatusBadge color="red">
      <Icon name="x-circle" />
      Sync Failed
      <RetryButton />
    </StatusBadge>
  )}

  {pendingChanges > 0 && (
    <PendingBadge>
      {pendingChanges} unsaved change{pendingChanges > 1 ? 's' : ''}
      <SyncNowButton />
    </PendingBadge>
  )}
</SyncStatusIndicator>

// Sync history panel
<SyncHistoryDrawer>
  <Header>Sync History</Header>
  <Timeline>
    {syncHistory.map(sync => (
      <TimelineItem>
        <Icon status={sync.status} />
        <Timestamp>{sync.timestamp}</Timestamp>
        <Action>{sync.action}</Action>
        <Details>{sync.details}</Details>
      </TimelineItem>
    ))}
  </Timeline>
</SyncHistoryDrawer>
```

**Deliverable:** Sync status system with UI

#### Task 6.5: Sync Reliability Improvements

**Action:** Enhance sync robustness and error recovery

**Reliability Features:**

```javascript
class ReliableSyncService {
  constructor(config) {
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 5000; // 5 seconds
    this.batchSize = config.batchSize || 10; // Sync 10 crashes at a time
  }

  // Exponential backoff retry
  async syncWithRetry(operation, retries = 0) {
    try {
      return await operation();
    } catch (error) {
      if (retries < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retries);
        console.log(`Sync failed, retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.syncWithRetry(operation, retries + 1);
      } else {
        throw new Error(
          `Sync failed after ${this.maxRetries} retries: ${error.message}`
        );
      }
    }
  }

  // Batch sync to avoid large payloads
  async syncInBatches(crashes) {
    const batches = this.chunk(crashes, this.batchSize);
    const results = [];

    for (const batch of batches) {
      const result = await this.syncWithRetry(() =>
        this.apiClient.post("/api/v1/sync/push", { crashes: batch })
      );
      results.push(result);

      // Small delay between batches to avoid overwhelming server
      await this.sleep(100);
    }

    return results;
  }

  // Partial sync failure recovery
  async handlePartialFailure(batch, error) {
    // If batch sync fails, try individual syncs
    console.log("Batch sync failed, trying individual syncs...");

    const successes = [];
    const failures = [];

    for (const crash of batch) {
      try {
        await this.apiClient.post("/api/v1/crashes", crash);
        successes.push(crash.id);
      } catch (err) {
        failures.push({ id: crash.id, error: err.message });
      }
    }

    return { successes, failures };
  }

  // Connection quality check
  async checkConnectionQuality() {
    const start = Date.now();
    try {
      await this.apiClient.get("/api/v1/health");
      const latency = Date.now() - start;

      return {
        online: true,
        latency,
        quality: latency < 200 ? "good" : latency < 1000 ? "fair" : "poor",
      };
    } catch (error) {
      return { online: false, latency: null, quality: "offline" };
    }
  }

  // Sync queue persistence
  async persistSyncQueue() {
    // Save sync queue to local storage
    // In case app crashes during sync
    const queue = await this.database.getAllFromSyncQueue();
    localStorage.setItem("sync_queue_backup", JSON.stringify(queue));
  }

  async restoreSyncQueue() {
    // Restore sync queue after app restart
    const backup = localStorage.getItem("sync_queue_backup");
    if (backup) {
      const queue = JSON.parse(backup);
      for (const item of queue) {
        await this.database.addToSyncQueue(item);
      }
      localStorage.removeItem("sync_queue_backup");
    }
  }

  // Utility functions
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
```

**Deliverable:** Reliable sync with retry and recovery

### Definition of Done (DoD) - Phase 6

Phase 6 is complete when:

- [ ] Conflict detection identifies all conflict types
- [ ] Automatic conflict resolution works for simple conflicts
- [ ] Manual conflict resolution UI allows user choice
- [ ] Field-by-field conflict resolution works
- [ ] Sync status indicator shows current state accurately
- [ ] Pending changes count is correct
- [ ] Sync history logs all operations
- [ ] Retry logic works (3 attempts with exponential backoff)
- [ ] Batch sync prevents memory issues with large datasets
- [ ] Partial sync failures are handled gracefully
- [ ] Sync queue persists across app restarts
- [ ] Connection quality check provides accurate status
- [ ] Conflicts are logged in sync_log table
- [ ] Stress testing passes (100+ crashes, multiple conflicts)
- [ ] No data loss in any conflict scenario
- [ ] Sync performance is acceptable (<5s for 50 crashes)
- [ ] Code is peer-reviewed and tested
- [ ] Documentation includes conflict resolution guide

---

## PHASE 7: Polish, Testing & Deployment

### Phase 7 Objective

Final polish, comprehensive testing, performance optimization, documentation, and production deployment setup.

### Definition of Ready (DoR) - Phase 7

Before starting Phase 7, ensure:

- [ ] All previous phases (1-6) are complete
- [ ] Both desktop and web apps are fully functional
- [ ] Feature freeze is in effect (no new features)
- [ ] Production infrastructure is ready
- [ ] Deployment strategy is documented
- [ ] Test environments are prepared
- [ ] Beta testers are identified

### Phase 7: Step-by-Step Tasks

#### Task 7.1: Comprehensive Testing

**Action:** Execute full test suite across all components

**Testing Strategy:**

```
1. Unit Testing
   - All services and utilities
   - Database operations
   - AI prompt generation
   - Conflict resolution logic
   - Target: >85% code coverage

2. Integration Testing
   - API endpoints with database
   - Desktop app with SQLite
   - Web app with IndexedDB
   - Sync between desktop/web and server
   - AI provider integrations

3. End-to-End Testing
   - Complete user workflows
   - File upload → AI analysis → validation → search
   - Offline creation → online sync
   - Conflict creation → resolution
   - Use Playwright or Cypress for automation

4. Performance Testing
   - Load testing: 1000+ crashes in database
   - Search performance: <1s for any query
   - Sync performance: 100 crashes in <10s
   - AI analysis: <60s per crash
   - Memory usage: <500MB for desktop, <100MB for web

5. Security Testing
   - SQL injection prevention
   - XSS prevention
   - API key security
   - Database encryption
   - HTTPS enforcement

6. Accessibility Testing
   - WCAG 2.1 AA compliance
   - Keyboard navigation
   - Screen reader compatibility
   - Color contrast
   - Focus indicators

7. Cross-Platform Testing
   Desktop:
   - Windows 10, 11
   - macOS Monterey, Ventura, Sonoma
   - Ubuntu 22.04, 24.04

   Web:
   - Chrome, Firefox, Safari, Edge
   - Mobile browsers (iOS Safari, Android Chrome)
   - Different screen sizes

8. Offline/Sync Testing
   - Create crash offline → sync when online
   - Edit crash on two devices → resolve conflict
   - Long offline period → successful sync
   - Network interruption during sync → resume
   - Multiple devices syncing simultaneously

9. AI Integration Testing
   - Test with all AI providers (Ollama, OpenAI, Anthropic, Google)
   - Verify analysis quality
   - Handle AI failures gracefully
   - Timeout scenarios
   - Rate limiting scenarios

10. User Acceptance Testing (UAT)
    - Beta test with real users
    - Gather feedback on usability
    - Test with real crash logs
    - Validate AI analysis accuracy
```

**Test Execution:**

- Create test plan document with all test cases
- Assign test cases to team members
- Track test results in issue tracker
- Fix all critical and high-priority bugs
- Re-test after fixes

**Deliverable:** Complete test report with all tests passed

#### Task 7.2: Performance Optimization

**Action:** Optimize application performance

**Desktop App Optimizations:**

```javascript
// 1. Database query optimization
- Add missing indexes
- Use prepared statements
- Batch database operations
- Cache frequently accessed data

// 2. UI rendering optimization
- Use React.memo for expensive components
- Virtualize long lists (react-window)
- Lazy load images
- Debounce search and filter inputs

// 3. Memory management
- Clean up event listeners
- Dispose of large objects when not needed
- Limit in-memory cache size
- Use weak references where appropriate

// 4. Startup optimization
- Lazy load modules
- Defer non-critical initialization
- Pre-load critical data only
- Show splash screen during initialization
```

**Web App Optimizations:**

```javascript
// 1. Bundle optimization
- Code splitting by route
- Tree shaking
- Minification
- Compression (gzip/brotli)

// 2. Asset optimization
- Compress images (WebP format)
- Lazy load images
- Use SVG for icons
- Optimize fonts

// 3. Caching strategy
- Service worker caching
- Browser caching headers
- CDN for static assets
- API response caching

// 4. Runtime performance
- Avoid unnecessary re-renders
- Use Web Workers for heavy computations
- Optimize IndexedDB queries
- Reduce JavaScript execution time
```

**API Optimizations:**

```javascript
// 1. Database optimization
- Connection pooling
- Query optimization (EXPLAIN ANALYZE)
- Proper indexing
- Materialized views for complex queries

// 2. Response optimization
- Pagination for list endpoints
- Field selection (allow clients to specify fields)
- Response compression
- Efficient JSON serialization

// 3. Caching
- Redis for frequently accessed data
- Cache invalidation strategy
- ETag support

// 4. Rate limiting
- Prevent API abuse
- Fair usage policies
- Per-user rate limits
```

**Performance Targets:**

- Desktop startup: <3s
- Web Time to Interactive: <3s on 3G
- Search: <1s for any query
- AI analysis: <60s
- Sync: 100 crashes in <10s
- API response: <200ms (p95)

**Deliverable:** Optimized application meeting performance targets

#### Task 7.3: Error Handling & Logging

**Action:** Implement comprehensive error handling

**Error Handling Strategy:**

```javascript
// 1. User-facing error messages
class ErrorMessageService {
  getMessage(error) {
    // Translate technical errors to user-friendly messages
    const errorMap = {
      NETWORK_ERROR:
        "Unable to connect to the server. Please check your internet connection.",
      DATABASE_ERROR: "A database error occurred. Please try again.",
      AI_TIMEOUT:
        "AI analysis is taking longer than expected. The analysis will continue in the background.",
      VALIDATION_ERROR: "Please check your input and try again.",
      SYNC_CONFLICT:
        "Your changes conflict with changes made on another device. Please resolve the conflict.",
      FILE_TOO_LARGE: "The file is too large. Maximum file size is 10MB.",
      INVALID_FILE_TYPE:
        "Invalid file type. Please upload a .log or .txt file.",
      RATE_LIMIT: "Too many requests. Please wait a moment and try again.",
    };

    return (
      errorMap[error.code] || "An unexpected error occurred. Please try again."
    );
  }
}

// 2. Error boundary components (React)
class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    // Log error
    logger.error("React error boundary caught error", {
      error: error.message,
      componentStack: errorInfo.componentStack,
    });

    // Show error UI
    this.setState({ hasError: true, error });
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallbackUI error={this.state.error} />;
    }
    return this.props.children;
  }
}

// 3. Global error handlers
// Desktop (Electron)
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection", { reason });
});

window.onerror = (message, source, lineno, colno, error) => {
  logger.error("Window error", { message, source, lineno, colno, error });
};

// Web
window.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled promise rejection", { reason: event.reason });
});

// 4. API error handling
class APIClient {
  async request(method, url, data) {
    try {
      const response = await fetch(url, {
        method,
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new APIError(response.status, await response.json());
      }

      return await response.json();
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      } else if (error.name === "TypeError") {
        throw new NetworkError("Network request failed");
      } else {
        throw new UnknownError("An unexpected error occurred");
      }
    }
  }
}
```

**Logging Strategy:**

```javascript
// Winston logger configuration (Node.js/Electron)
import winston from 'winston';

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        // Log to file
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error'
        }),
        new winston.transports.File({
            filename: 'logs/combined.log'
        }),

        // Also log to console in development
        ...(process.env.NODE_ENV !== 'production' ? [
            new winston.transports.Console({
                format: winston.format.simple()
            })
        ] : [])
    ]
});

// Usage
logger.info('User uploaded crash', {
    crashId: crash.id,
    filename: crash.filename
});

logger.error('AI analysis failed', {
    crashId: crash.id,
    error: error.message,
    provider: aiProvider
});

// What to log
- User actions (upload, validate, search)
- AI analysis requests and results
- Sync operations (push, pull, conflicts)
- Errors and exceptions
- Performance metrics
- Security events

// What NOT to log
- Sensitive data (API keys, passwords)
- Full crash log contents (too large)
- Personal identifiable information (PII)
```

**Deliverable:** Robust error handling and logging

#### Task 7.4: Documentation

**Action:** Create comprehensive documentation

**Documentation Requirements:**

```
1. User Documentation
   a. Getting Started Guide
      - Installation (desktop and web)
      - First-time setup
      - Uploading first crash log
      - Understanding AI analysis

   b. User Manual
      - Complete feature walkthrough
      - File upload
      - Search and filtering
      - Validation workflow
      - Settings and configuration
      - Troubleshooting common issues

   c. Video Tutorials
      - Basic workflow demo (5 min)
      - Advanced search (3 min)
      - Validation process (5 min)
      - Offline mode and sync (4 min)

2. Administrator Documentation
   a. Installation Guide
      - Server setup (PostgreSQL, Node.js API)
      - Desktop app deployment
      - Web app deployment
      - SSL certificate setup

   b. Configuration Guide
      - Environment variables
      - Database configuration
      - AI provider setup (Ollama, OpenAI, etc.)
      - Backup and restore procedures

   c. Maintenance Guide
      - Database maintenance
      - Log rotation
      - Performance monitoring
      - Security updates

3. Developer Documentation
   a. Architecture Overview
      - System architecture diagram
      - Database schema
      - API documentation (OpenAPI/Swagger)
      - Sync architecture
      - AI integration architecture

   b. Development Setup
      - Prerequisites
      - Local development environment
      - Running tests
      - Debugging

   c. Code Documentation
      - Inline code comments (JSDoc)
      - API endpoint documentation
      - Database query documentation
      - Component documentation (React)

   d. Contributing Guide
      - Code style guide
      - Git workflow
      - Pull request process
      - Testing requirements

4. API Documentation
   - Auto-generated from OpenAPI spec
   - Hosted with Swagger UI or Redoc
   - Include examples for all endpoints
   - Authentication documentation
   - Rate limiting documentation

5. Release Notes
   - Version history
   - New features
   - Bug fixes
   - Breaking changes
   - Migration guides
```

**Documentation Tools:**

- User docs: Markdown + Docusaurus or GitBook
- API docs: Swagger/OpenAPI
- Code docs: JSDoc + TypeDoc
- Videos: Screen recording tool

**Deliverable:** Complete documentation package

#### Task 7.5: Production Deployment Setup

**Action:** Prepare production infrastructure

**Deployment Architecture:**

```
Production Stack:
- PostgreSQL Database: AWS RDS or self-hosted
- API Server: AWS EC2, DigitalOcean Droplet, or containerized (Docker)
- Web App: Static hosting (AWS S3 + CloudFront, Netlify, Vercel)
- Desktop App: Distribution via GitHub Releases or website download

Components:
1. Database (PostgreSQL)
   - Production instance
   - Automated backups (daily)
   - Point-in-time recovery
   - Connection pooling
   - Monitoring

2. API Server
   - Load balancer (if multi-instance)
   - SSL/TLS certificate (Let's Encrypt or purchased)
   - Reverse proxy (Nginx)
   - Process manager (PM2 or systemd)
   - Auto-restart on failure
   - Log aggregation

3. Web App
   - Build and minify
   - Deploy to CDN
   - Configure caching headers
   - Enable compression
   - Set up CI/CD pipeline

4. Desktop App
   - Code signing (Windows, macOS)
   - Notarization (macOS)
   - Auto-updater configuration
   - Distribution method
```

**Deployment Checklist:**

```
Database:
[ ] PostgreSQL production instance provisioned
[ ] Database migrated with schema
[ ] Backups configured (daily, 30-day retention)
[ ] Connection pooling configured
[ ] Monitoring enabled
[ ] Security: firewall rules, SSL connections

API Server:
[ ] Server provisioned (EC2, Droplet, etc.)
[ ] Node.js and dependencies installed
[ ] Application deployed
[ ] Environment variables configured
[ ] SSL certificate installed
[ ] Nginx reverse proxy configured
[ ] PM2 process manager configured
[ ] Firewall configured (allow 443, deny others)
[ ] Log rotation configured
[ ] Monitoring enabled (CPU, memory, disk)
[ ] Health check endpoint verified

Web App:
[ ] Production build created (npm run build)
[ ] Uploaded to hosting (S3, Netlify, etc.)
[ ] CDN configured
[ ] SSL certificate enabled (HTTPS)
[ ] Environment variables configured
[ ] Service worker registered
[ ] PWA manifest validated
[ ] Domain name configured

Desktop App:
[ ] Windows build signed
[ ] macOS build signed and notarized
[ ] Linux AppImage/deb/rpm created
[ ] Auto-updater configured
[ ] Release notes written
[ ] GitHub release created
[ ] Download page updated

Monitoring:
[ ] Application monitoring (New Relic, DataDog, or similar)
[ ] Error tracking (Sentry)
[ ] Uptime monitoring (Pingdom, UptimeRobot)
[ ] Log aggregation (ELK Stack, Papertrail)
[ ] Database monitoring (pg_stat_statements)
[ ] Alert configuration (email, Slack)

Security:
[ ] Dependency audit (npm audit)
[ ] Security headers configured (CORS, CSP, etc.)
[ ] Rate limiting enabled
[ ] API authentication configured (if multi-user)
[ ] Database encryption at rest
[ ] Sensitive data encrypted (API keys)
[ ] Regular security updates planned
```

**CI/CD Pipeline (GitHub Actions):**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
      - run: npm run lint

  deploy-api:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to server
        run: |
          ssh user@server 'cd /app && git pull && npm install && pm2 restart api'

  deploy-web:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - name: Deploy to S3
        run: aws s3 sync ./dist s3://bucket-name --delete

  build-desktop:
    needs: test
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build:desktop
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: desktop-${{ matrix.os }}
          path: dist/
```

**Deliverable:** Production deployment completed

### Definition of Done (DoD) - Phase 7

Phase 7 is complete when:

- [ ] All test suites pass (unit, integration, e2e)
- [ ] Code coverage is >85%
- [ ] All critical and high-priority bugs are fixed
- [ ] Performance targets are met
- [ ] Error handling is comprehensive
- [ ] Logging is implemented throughout
- [ ] User documentation is complete
- [ ] Administrator documentation is complete
- [ ] Developer documentation is complete
- [ ] API documentation is auto-generated and accurate
- [ ] Production database is deployed
- [ ] API server is deployed and accessible
- [ ] Web app is deployed and accessible
- [ ] Desktop app is built for all platforms
- [ ] Desktop app is code-signed (Windows, macOS)
- [ ] Monitoring is enabled
- [ ] Backups are configured and tested
- [ ] Security audit is passed
- [ ] SSL certificates are installed
- [ ] CI/CD pipeline is working
- [ ] Beta testing feedback is incorporated
- [ ] Release notes are written
- [ ] Launch announcement is prepared
- [ ] System is stable under production load
- [ ] Team is trained on deployment procedures
- [ ] Rollback procedure is documented and tested

---

## PHASE 8 (Future): Advanced Features

### Phase 8 Objective

Implement advanced features that enhance the system's capabilities beyond the core requirements.

### Future Feature Ideas

#### 8.1 Advanced Analytics Dashboard

- Crash trends over time
- Most problematic components
- AI accuracy metrics
- Mean time to resolution (MTTR)
- Crash frequency analysis
- Predictive crash prevention

#### 8.2 Multi-User Support & Permissions

- User authentication (OAuth, SAML)
- Role-based access control (Admin, Analyst, Viewer)
- Team collaboration features
- Comment threads on crashes
- @mentions in validation notes
- Activity feed

#### 8.3 Notification System

- Email notifications for critical crashes
- Slack/Teams integration
- Browser push notifications
- Webhook integrations
- Notification preferences

#### 8.4 Export & Reporting

- PDF crash reports
- Excel export with charts
- Custom report builder
- Scheduled reports
- Executive summaries

#### 8.5 Machine Learning Enhancements

- Custom ML model training on historical crashes
- Automatic severity prediction
- Crash clustering (unsupervised learning)
- Time series forecasting (predict future crashes)
- Anomaly detection (unusual crash patterns)

#### 8.6 Integration Hub

- Jira integration (create tickets from crashes)
- GitHub integration (link to code commits)
- CI/CD integration (link crashes to deployments)
- Version control integration (blame analysis)
- Crash reporting SDK (for automatic submissions)

#### 8.7 Advanced Search

- Natural language search ("crashes from last week with high severity")
- Regex search in logs
- Fuzzy search
- Search suggestions
- Search analytics (most common searches)

#### 8.8 Batch Operations

- Bulk validation
- Bulk tagging
- Bulk export
- Bulk delete

#### 8.9 Mobile App

- React Native mobile app
- View crashes on mobile
- Quick validation on-the-go
- Push notifications

#### 8.10 AI Model Fine-Tuning

- Fine-tune local models on organization's crash data
- Custom prompts per component/category
- Model performance comparison
- A/B testing different AI providers

---

## APPENDIX A: Technology Stack Summary

### Desktop Application

- **Framework:** Electron 27+
- **UI:** React 18+ with Hooks
- **State Management:** Redux Toolkit or Zustand
- **Database:** SQLite (better-sqlite3)
- **Styling:** Tailwind CSS or Material-UI
- **Build:** Electron Builder

### Web Application

- **Framework:** React 18+ with Hooks
- **Routing:** React Router 6+
- **State Management:** Redux Toolkit or Zustand
- **Database:** IndexedDB (with Dexie.js wrapper)
- **Styling:** Tailwind CSS or Material-UI
- **Build:** Vite or Create React App
- **PWA:** Workbox

### Backend API

- **Runtime:** Node.js 18+
- **Framework:** Express 4+
- **Database:** PostgreSQL 15+
- **ORM/Query Builder:** pg (node-postgres) or Knex.js
- **Validation:** Joi
- **Logging:** Winston
- **Testing:** Jest, Supertest

### AI Integration

- **Local:** Ollama (Llama 3, CodeLlama)
- **Cloud:** OpenAI (GPT-4), Anthropic (Claude), Google (Gemini)
- **Abstraction:** LangChain or custom abstraction

### DevOps

- **CI/CD:** GitHub Actions
- **Containerization:** Docker (optional)
- **Monitoring:** New Relic, DataDog, or Prometheus
- **Error Tracking:** Sentry
- **Hosting:** AWS, DigitalOcean, or Vercel

---

## APPENDIX B: Database Size Estimates

### Storage Requirements (Approximate)

**Single Crash Record:**

- Raw log content: 10-100 KB (average 50 KB)
- AI analysis: 5-20 KB (average 10 KB)
- Metadata: 1 KB
- **Total per crash: ~60 KB**

**Database Growth:**

- 100 crashes: ~6 MB
- 1,000 crashes: ~60 MB
- 10,000 crashes: ~600 MB
- 100,000 crashes: ~6 GB

**Recommendations:**

- Plan for 10,000-100,000 crashes initially
- Database size: 1-10 GB for first year
- Implement archival strategy after 1 year
- Consider partitioning table by date if >100K crashes

---

## APPENDIX C: AI Prompt Optimization Tips

### Prompt Engineering Best Practices

1. **Be Specific:**

   - Bad: "Analyze this crash"
   - Good: "Analyze this VisualWorks Smalltalk crash. Identify the root cause, suggest specific fixes, and provide test scenarios."

2. **Provide Context:**

   - Include file name, error type, stack trace
   - Include user steps (what user was doing)
   - Include system information

3. **Structure Output:**

   - Use JSON schema for consistent output
   - Request specific fields
   - Define expected data types

4. **Use Examples:**

   - Include example input and expected output
   - "Few-shot" prompting improves accuracy

5. **Set Constraints:**

   - "Keep suggestions under 3 items"
   - "Provide code examples in Smalltalk syntax"
   - "Assign severity as: critical, high, medium, or low"

6. **Iterative Refinement:**

   - Test prompts with real crash logs
   - Refine based on output quality
   - Version control your prompts

7. **Model-Specific Tuning:**
   - Smaller models (Llama 3 8B): Shorter, simpler prompts
   - Larger models (GPT-4): Can handle longer, more complex prompts

---

## APPENDIX D: Sync Conflict Scenarios & Resolutions

### Common Conflict Scenarios

| Scenario               | Local State             | Server State                   | Resolution Strategy                       |
| ---------------------- | ----------------------- | ------------------------------ | ----------------------------------------- |
| **Concurrent Edit**    | Crash edited offline    | Same crash edited on server    | Field-by-field merge or manual resolution |
| **Offline Delete**     | Crash deleted offline   | Crash updated on server        | Delete wins (safety first)                |
| **Offline Validation** | Crash validated offline | Same crash validated on server | Validated status wins                     |
| **Version Mismatch**   | Old sync version        | Newer sync version             | Server wins                               |
| **Network Split**      | Multiple edits offline  | Multiple edits on other device | Last-write-wins or manual                 |

### Resolution Priority

1. **Safety First:** Deletes always win
2. **Validated Wins:** Validated crashes override pending
3. **Timestamp:** Newer timestamp wins (if same validation status)
4. **Manual:** User chooses when automatic resolution not possible

---

## APPENDIX E: Performance Benchmarks

### Target Performance Metrics

| Operation                   | Target   | Acceptable | Poor     |
| --------------------------- | -------- | ---------- | -------- |
| **Database Query**          | <50ms    | <100ms     | >200ms   |
| **Full-Text Search**        | <500ms   | <1s        | >2s      |
| **AI Analysis**             | <30s     | <60s       | >90s     |
| **Sync (50 crashes)**       | <5s      | <10s       | >15s     |
| **Desktop Startup**         | <2s      | <3s        | >5s      |
| **Web Time to Interactive** | <2s (3G) | <3s (3G)   | >5s (3G) |
| **File Upload (5MB)**       | <2s      | <5s        | >10s     |

### Optimization Strategies

**If search is slow:**

- Add indexes to searchable fields
- Implement caching
- Use FTS (full-text search) tables
- Limit result set size

**If AI analysis is slow:**

- Use smaller models (Llama 3 8B vs 70B)
- Reduce max_tokens in prompt
- Parallel processing for multiple crashes
- Queue system for background processing

**If sync is slow:**

- Batch sync operations
- Compress payload data
- Implement differential sync (only changed fields)
- Use WebSockets for real-time sync

**If app startup is slow:**

- Lazy load modules
- Defer non-critical initialization
- Optimize database schema
- Reduce initial data load

---

## APPENDIX F: Security Checklist

### Security Best Practices

**API Security:**

- [ ] All endpoints use HTTPS
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitize inputs)
- [ ] Authentication required (future phase)
- [ ] API keys stored securely (encrypted)

**Database Security:**

- [ ] PostgreSQL connections use SSL
- [ ] Database credentials not in code
- [ ] Regular backups encrypted
- [ ] Access restricted (firewall rules)
- [ ] Least privilege principle (database user permissions)

**Desktop App Security:**

- [ ] API keys encrypted before storage
- [ ] No sensitive data in logs
- [ ] Auto-updates use HTTPS
- [ ] Code signing (prevents tampering)
- [ ] Secure IPC between Electron processes

**Web App Security:**

- [ ] Service Worker served over HTTPS
- [ ] Content Security Policy (CSP) configured
- [ ] No eval() or inline scripts
- [ ] Subresource Integrity (SRI) for CDN assets
- [ ] Local storage encrypted (for sensitive data)

---

## APPENDIX G: Glossary

**Terms Used in This Plan:**

- **AI Provider:** Service that provides AI/LLM capabilities (Ollama, OpenAI, etc.)
- **Conflict:** When same crash record is modified on multiple devices/locations
- **Crash Record:** Database entry containing crash log and analysis
- **DoD (Definition of Done):** Criteria that must be met to consider phase complete
- **DoR (Definition of Ready):** Prerequisites before starting a phase
- **Embedding:** Vector representation of text for similarity search
- **Full-Text Search (FTS):** Search capability that indexes all text content
- **IndexedDB:** Browser-based NoSQL database for web apps
- **Offline-First:** Architecture where app works offline, syncs when online
- **PostgreSQL:** Relational database used as central data store
- **PWA (Progressive Web App):** Web app that can be installed like native app
- **Service Worker:** Browser background script enabling offline functionality
- **SQLite:** Embedded relational database for desktop app
- **Stack Trace:** List of function calls leading to an error
- **Sync:** Process of synchronizing data between local and server
- **UUID:** Universally Unique Identifier (prevents ID collisions)
- **Validation:** Human review and approval of AI analysis

---

## SUMMARY

This development plan provides a clear, phased roadmap for building the VisualWorks Smalltalk Crash Analysis System:

**Phase 1:** Database & API foundation
**Phase 2:** Desktop application with offline support
**Phase 3:** AI integration and analysis
**Phase 4:** Search and validation workflow
**Phase 5:** Web application
**Phase 6:** Sync refinement and conflict resolution
**Phase 7:** Testing, optimization, and deployment
**Phase 8:** Future advanced features

Each phase has clear objectives, detailed step-by-step tasks, Definition of Ready, and Definition of Done criteria. The plan is designed to be:

- **AI-friendly:** Clear, unambiguous language
- **Actionable:** Specific tasks with deliverables
- **Sequential:** Each phase builds on the previous
- **Flexible:** Can adjust based on priorities
- **Comprehensive:** Covers all aspects from code to deployment

**Estimated Timeline:**

- Phase 1: 2-3 weeks
- Phase 2: 3-4 weeks
- Phase 3: 4-5 weeks
- Phase 4: 2-3 weeks
- Phase 5: 4-5 weeks
- Phase 6: 2-3 weeks
- Phase 7: 3-4 weeks

**Total: 20-27 weeks (5-7 months)** for core system

This timeline assumes a small team (2-3 developers) working full-time. Adjust as needed based on your resources and priorities.

---

**Next Steps:**

1. Review this plan with stakeholders
2. Prioritize phases based on business needs
3. Assign team members to phases
4. Set up development environment
5. Begin Phase 1!
