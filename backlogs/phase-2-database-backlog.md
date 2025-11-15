# Phase 2: Database & Search - Production Backlog

**Updated**: 2025-11-12 (Added PostgreSQL + pgvector for backend)

## Executive Summary
Transform the Smalltalk Crash Analyzer from file-based storage to a **dual-database architecture**:
- **Desktop (Tauri)**: SQLite with FTS5 using better-sqlite3
- **Backend (Node.js)**: PostgreSQL 15+ with pgvector extension for vector similarity search

This phase introduces **hybrid search** combining:
1. **Full-text search** (FTS5/tsvector) for keyword matching
2. **Vector similarity** (pgvector) for semantic crash clustering
3. **Fuzzy search** (pg_trgm) for typo-tolerant matching

**Reference Repositories**:
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite for Node.js/Tauri
- [pgvector/pgvector](https://github.com/pgvector/pgvector) - Vector similarity in PostgreSQL
- [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) - Fuzzy text search

Users have validated the need through pain points with manual JSON management and requests for "find similar crashes" functionality.

## Risk Assessment

### High Risks
1. **Data Loss During Migration** - Corrupted/lost crash analyses
   - Mitigation: Backup strategy, atomic transactions, rollback capability
   - Owner: Migration Service Lead

2. **Search Performance Degradation** - Queries >100ms with 10k records
   - Mitigation: FTS5 optimization, query profiling, caching layer
   - Owner: Search Service Lead

### Medium Risks
1. **Database Corruption** - SQLite file corruption
   - Mitigation: WAL mode, regular backups, integrity checks
   - Acceptance: Manual recovery acceptable for Phase 2

2. **Memory Pressure from Large Results** - OOM with large datasets
   - Mitigation: Pagination, result limiting, virtualization

## Assumptions Ledger

### High-Impact Assumptions
- **Desktop**: SQLite FTS5 extension available via better-sqlite3
- **Backend**: PostgreSQL 15+ with pgvector extension available
- Users have <10,000 crash records locally (50MB SQLite database)
- Backend can handle 100,000+ crashes with vector embeddings (PostgreSQL)
- JSON structure from Phase 1 remains stable
- Desktop: Single-user (no concurrent writes)
- Backend: Multi-user with connection pooling

### Reasonable Defaults
- **Desktop Database**: `~/CrashAnalyzer/database/crashes.db`
- **Backend Database**: PostgreSQL connection via environment variables
- **Vector Dimensions**: 1536 (OpenAI ada-002 embeddings)
- Backup frequency: Weekly (desktop), Daily (backend)
- Search debounce: 150ms
- Page size: 20 results
- Cache TTL: 5 minutes
- **Similarity Threshold**: 0.7 cosine similarity for "similar crashes"

## Architecture Decision Records (ADRs)

### ADR-001: Dual-Database Architecture (Updated)
**Decision**: Use SQLite (desktop) + PostgreSQL (backend)
**Rationale**:
- **Desktop**: SQLite via better-sqlite3 for offline-first, fast local access
- **Backend**: PostgreSQL for multi-user, advanced search (pgvector)
- Both support full-text search (FTS5 vs tsvector)
**Alternatives Rejected**: ElasticSearch (deployment complexity), MongoDB (weak search)
**References**:
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - 5.5k stars
- [pgvector/pgvector](https://github.com/pgvector/pgvector) - 9k stars

### ADR-002: Vector Embeddings for Semantic Search
**Decision**: Store crash embeddings in PostgreSQL with pgvector extension
**Rationale**:
- Enable "find similar crashes" feature
- Cluster crashes by semantic similarity (not just keywords)
- Use OpenAI ada-002 embeddings (1536 dimensions)
- IVFFlat indexing for fast similarity search at scale
**Trade-offs**: Additional API costs for embedding generation, storage overhead
**Implementation**: Create embeddings during analysis, store with vector(1536) type

### ADR-003: Hybrid Search Strategy
**Decision**: Combine FTS, vector similarity, and fuzzy search using RRF
**Rationale**:
- **FTS**: Fast keyword matching
- **Vector**: Semantic similarity (similar error patterns)
- **Fuzzy** (pg_trgm): Typo tolerance
- **RRF** (Reciprocal Rank Fusion): Merge results from all three
**Implementation**:
```sql
-- FTS score
WITH fts AS (SELECT id, ts_rank(search_vector, query) AS score FROM crashes ...),
-- Vector score
vector AS (SELECT id, 1 - (embedding <=> query_embedding) AS score FROM crashes ...),
-- Fuzzy score
fuzzy AS (SELECT id, similarity(stack_trace, query_text) AS score FROM crashes ...)
-- RRF merge
SELECT id, (1/RANK(fts) + 1/RANK(vector) + 1/RANK(fuzzy)) AS final_score
```

### ADR-004: Repository Pattern for Data Access
**Decision**: Abstract database operations behind repository interfaces
**Rationale**: Testability, future migration path, separation of concerns
**Trade-offs**: Additional abstraction layer

### ADR-005: Tauri IPC Bridge for Database Access (Updated from Electron)
**Decision**: Database operations in Rust backend, exposed via Tauri commands
**Rationale**: SQLite thread safety, Tauri architecture best practices
**Trade-offs**: IPC serialization overhead (minimal with Tauri)
**Reference**: [tauri-apps/tauri Commands](https://github.com/tauri-apps/tauri)

## Dependency Graph
```
A-1 (Database Setup) → A-2 (Repository Layer) → B-1 (Migration Service)
                    ↘                        ↗
                      C-1 (Search Service) → D-1 (Search UI)
                                          ↘
                                            E-1 (Favorites)
```

---

# EPIC A: SQLite Database Foundation (Desktop)

**Technology**: better-sqlite3 for Node.js/Tauri
**Reference**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (5.5k stars)

## Definition of Done
- ✓ Database created with proper schema and indexes
- ✓ Repository pattern implemented with 100% test coverage
- ✓ Performance: Insert 1000 records in <5 seconds with better-sqlite3
- ✓ WAL mode enabled for concurrent reads

## Story A-1: Database Schema Setup
**Priority**: P0 - Critical Path
**Status**: READY
**Unblocks**: A-2, B-1, C-1

### Acceptance Criteria
```gherkin
Given the application starts for the first time
When the database service initializes
Then it creates the crashes.db file with proper schema
And creates FTS5 virtual table for search
And creates all required indexes
And enables WAL mode for performance
```

### Tasks

#### A-1-T1: Create Database Schema
**Token Budget**: 8,000
**Modules**: 1 (schema.sql)

```sql
-- Primary crashes table
CREATE TABLE IF NOT EXISTS crashes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    filename TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

    -- Parsed crash data
    error_type TEXT,
    error_message TEXT,
    severity TEXT CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    component TEXT,
    stack_trace TEXT,

    -- AI analysis results
    root_cause TEXT,
    suggested_fixes TEXT, -- JSON array
    confidence TEXT CHECK(confidence IN ('HIGH','MEDIUM','LOW')),
    analysis_timestamp INTEGER,

    -- Full data preservation
    full_data TEXT NOT NULL, -- Complete JSON blob

    -- Metadata
    file_size INTEGER,
    analysis_duration_ms INTEGER,
    ai_provider TEXT,
    ai_model TEXT,

    -- User interaction
    is_favorite INTEGER DEFAULT 0,
    last_viewed_at INTEGER,
    view_count INTEGER DEFAULT 0,

    -- Soft delete support
    deleted_at INTEGER DEFAULT NULL
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS crashes_fts USING fts5(
    error_type,
    error_message,
    root_cause,
    suggested_fixes,
    component,
    stack_trace,
    content=crashes,
    tokenize='porter unicode61'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_crashes_created_at ON crashes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crashes_severity ON crashes(severity) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crashes_component ON crashes(component) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crashes_favorite ON crashes(is_favorite, created_at DESC) WHERE is_favorite = 1;
CREATE INDEX IF NOT EXISTS idx_crashes_recent ON crashes(last_viewed_at DESC) WHERE last_viewed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crashes_deleted ON crashes(deleted_at) WHERE deleted_at IS NOT NULL;

-- Triggers for FTS sync
CREATE TRIGGER IF NOT EXISTS crashes_ai AFTER INSERT ON crashes
BEGIN
    INSERT INTO crashes_fts(rowid, error_type, error_message, root_cause, suggested_fixes, component, stack_trace)
    VALUES (new.rowid, new.error_type, new.error_message, new.root_cause, new.suggested_fixes, new.component, new.stack_trace);
END;

CREATE TRIGGER IF NOT EXISTS crashes_au AFTER UPDATE ON crashes
BEGIN
    UPDATE crashes_fts SET
        error_type = new.error_type,
        error_message = new.error_message,
        root_cause = new.root_cause,
        suggested_fixes = new.suggested_fixes,
        component = new.component,
        stack_trace = new.stack_trace
    WHERE rowid = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS crashes_ad AFTER DELETE ON crashes
BEGIN
    DELETE FROM crashes_fts WHERE rowid = old.rowid;
END;

-- Update timestamp trigger
CREATE TRIGGER IF NOT EXISTS crashes_update_timestamp AFTER UPDATE ON crashes
BEGIN
    UPDATE crashes SET updated_at = unixepoch() WHERE rowid = new.rowid;
END;
```

#### A-1-T2: Database Connection Manager
**Token Budget**: 10,000
**Modules**: 2 (DatabaseManager, ConnectionPool)

```typescript
// database/DatabaseManager.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface DatabaseConfig {
    dbPath: string;
    walMode: boolean;
    busyTimeout: number;
    readonly: boolean;
}

export class DatabaseManager {
    private db: Database.Database | null = null;
    private config: DatabaseConfig;

    constructor(config: Partial<DatabaseConfig>) {
        this.config = {
            dbPath: config.dbPath || path.join(app.getPath('userData'), 'database', 'crashes.db'),
            walMode: config.walMode !== false,
            busyTimeout: config.busyTimeout || 5000,
            readonly: config.readonly || false
        };
    }

    async initialize(): Promise<void> {
        // Ensure directory exists
        const dbDir = path.dirname(this.config.dbPath);
        await fs.promises.mkdir(dbDir, { recursive: true });

        // Open connection
        this.db = new Database(this.config.dbPath, {
            readonly: this.config.readonly,
            fileMustExist: false,
            timeout: this.config.busyTimeout
        });

        // Configure for performance
        if (this.config.walMode) {
            this.db.pragma('journal_mode = WAL');
        }
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('mmap_size = 30000000000');

        // Run schema migrations
        await this.runMigrations();
    }

    private async runMigrations(): Promise<void> {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = await fs.promises.readFile(schemaPath, 'utf-8');
        this.db!.exec(schema);
    }

    getConnection(): Database.Database {
        if (!this.db) throw new Error('Database not initialized');
        return this.db;
    }

    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    async backup(backupPath: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        await this.db.backup(backupPath);
    }

    async integrityCheck(): Promise<boolean> {
        if (!this.db) throw new Error('Database not initialized');
        const result = this.db.pragma('integrity_check');
        return result[0].integrity_check === 'ok';
    }
}
```

#### A-1-T3: Database Health Monitoring
**Token Budget**: 5,000
**Modules**: 1 (HealthMonitor)

```typescript
// database/HealthMonitor.ts
export class DatabaseHealthMonitor {
    private metrics = {
        queryCount: 0,
        errorCount: 0,
        slowQueries: [] as Array<{query: string, duration: number}>,
        dbSize: 0,
        recordCount: 0
    };

    async checkHealth(db: Database.Database): Promise<HealthStatus> {
        const stats = await this.gatherStatistics(db);
        const integrity = await this.checkIntegrity(db);
        const performance = await this.checkPerformance(db);

        return {
            healthy: integrity && performance.p95 < 100,
            stats,
            integrity,
            performance
        };
    }
}
```

---

## Story A-2: Repository Layer Implementation
**Priority**: P0
**Status**: READY
**Depends On**: A-1
**Unblocks**: B-1, C-1

### Acceptance Criteria
```gherkin
Given the database is initialized
When I use the CrashRepository
Then I can perform CRUD operations
And all operations use prepared statements
And errors are properly handled
And transactions are atomic
```

### Tasks

#### A-2-T1: Base Repository Pattern
**Token Budget**: 12,000
**Modules**: 2 (BaseRepository, CrashRepository)

```typescript
// repositories/BaseRepository.ts
export abstract class BaseRepository<T> {
    protected db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    protected transaction<R>(fn: () => R): R {
        const transaction = this.db.transaction(fn);
        return transaction();
    }

    protected prepare(sql: string): Database.Statement {
        return this.db.prepare(sql);
    }
}

// repositories/CrashRepository.ts
export class CrashRepository extends BaseRepository<Crash> {
    private insertStmt: Database.Statement;
    private updateStmt: Database.Statement;
    private findByIdStmt: Database.Statement;

    constructor(db: Database.Database) {
        super(db);
        this.prepareStatements();
    }

    private prepareStatements() {
        this.insertStmt = this.prepare(`
            INSERT INTO crashes (
                id, filename, error_type, error_message, severity,
                component, stack_trace, root_cause, suggested_fixes,
                confidence, full_data, file_size, ai_provider, ai_model
            ) VALUES (
                @id, @filename, @error_type, @error_message, @severity,
                @component, @stack_trace, @root_cause, @suggested_fixes,
                @confidence, @full_data, @file_size, @ai_provider, @ai_model
            )
        `);

        // ... more prepared statements
    }

    async create(crash: CreateCrashDto): Promise<Crash> {
        return this.transaction(() => {
            const id = crypto.randomUUID();
            this.insertStmt.run({
                id,
                ...crash,
                suggested_fixes: JSON.stringify(crash.suggested_fixes)
            });
            return this.findById(id)!;
        });
    }

    async findById(id: string): Promise<Crash | null> {
        const row = this.findByIdStmt.get({ id });
        return row ? this.mapRowToCrash(row) : null;
    }

    async updateFavorite(id: string, isFavorite: boolean): Promise<void> {
        this.db.prepare('UPDATE crashes SET is_favorite = ? WHERE id = ?')
            .run(isFavorite ? 1 : 0, id);
    }

    async softDelete(id: string): Promise<void> {
        this.db.prepare('UPDATE crashes SET deleted_at = unixepoch() WHERE id = ?')
            .run(id);
    }
}
```

#### A-2-T2: Repository Tests
**Token Budget**: 8,000
**Modules**: 1 (test suite)

```typescript
// __tests__/CrashRepository.test.ts
describe('CrashRepository', () => {
    let db: Database.Database;
    let repo: CrashRepository;

    beforeEach(async () => {
        db = new Database(':memory:');
        await runMigrations(db);
        repo = new CrashRepository(db);
    });

    describe('create', () => {
        it('should insert crash with auto-generated ID', async () => {
            const crash = await repo.create(mockCrashData);
            expect(crash.id).toMatch(/^[a-f0-9]{32}$/);
        });

        it('should handle duplicate ID with retry', async () => {
            // Test idempotency
        });
    });

    describe('transaction rollback', () => {
        it('should rollback on error', async () => {
            // Test atomicity
        });
    });
});
```

---

# EPIC B: Data Migration & Import

## Definition of Done
- ✓ All existing JSON files imported without data loss
- ✓ Rollback capability if migration fails
- ✓ Progress tracking with <1% drift from actual

## Story B-1: Migration Service
**Priority**: P0
**Status**: READY
**Depends On**: A-1, A-2
**Unblocks**: User data access

### Acceptance Criteria
```gherkin
Given I have existing JSON crash files
When I run the migration wizard
Then all files are imported to the database
And original files are preserved
And I can rollback if needed
And progress is shown accurately
```

### Tasks

#### B-1-T1: Migration Scanner & Validator
**Token Budget**: 10,000
**Modules**: 2 (Scanner, Validator)

```typescript
// migration/MigrationScanner.ts
export class MigrationScanner {
    async scanForJsonFiles(directories: string[]): Promise<MigrationPlan> {
        const files: JsonFile[] = [];

        for (const dir of directories) {
            const jsonFiles = await glob(path.join(dir, '**/*.json'));

            for (const file of jsonFiles) {
                const stats = await fs.promises.stat(file);
                const content = await fs.promises.readFile(file, 'utf-8');

                try {
                    const data = JSON.parse(content);
                    if (this.isValidCrashFile(data)) {
                        files.push({
                            path: file,
                            size: stats.size,
                            modified: stats.mtime,
                            valid: true,
                            data
                        });
                    }
                } catch (e) {
                    files.push({
                        path: file,
                        size: stats.size,
                        modified: stats.mtime,
                        valid: false,
                        error: e.message
                    });
                }
            }
        }

        return {
            totalFiles: files.length,
            validFiles: files.filter(f => f.valid).length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            files
        };
    }

    private isValidCrashFile(data: any): boolean {
        return data.errorType && data.stackTrace && data.timestamp;
    }
}
```

#### B-1-T2: Batch Import with Transactions
**Token Budget**: 12,000
**Modules**: 2 (BatchImporter, ProgressTracker)

```typescript
// migration/BatchImporter.ts
export class BatchImporter {
    private batchSize = 100;

    async importBatch(
        files: JsonFile[],
        repo: CrashRepository,
        onProgress: (progress: Progress) => void
    ): Promise<ImportResult> {
        const total = files.length;
        let processed = 0;
        let failed: FailedImport[] = [];

        for (let i = 0; i < files.length; i += this.batchSize) {
            const batch = files.slice(i, Math.min(i + this.batchSize, files.length));

            try {
                await this.processBatch(batch, repo);
                processed += batch.length;
            } catch (error) {
                // Rollback batch and track failures
                for (const file of batch) {
                    failed.push({
                        file: file.path,
                        error: error.message
                    });
                }
            }

            onProgress({
                processed,
                total,
                percentage: Math.round((processed / total) * 100),
                currentFile: batch[batch.length - 1]?.path
            });
        }

        return {
            success: processed,
            failed: failed.length,
            failures: failed
        };
    }

    private async processBatch(batch: JsonFile[], repo: CrashRepository): Promise<void> {
        return repo.transaction(() => {
            for (const file of batch) {
                const crash = this.mapJsonToCrash(file.data);
                repo.create(crash);
            }
        });
    }
}
```

#### B-1-T3: Rollback Mechanism
**Token Budget**: 6,000
**Modules**: 1 (RollbackManager)

```typescript
// migration/RollbackManager.ts
export class RollbackManager {
    async createBackup(dbPath: string): Promise<string> {
        const backupPath = `${dbPath}.backup.${Date.now()}`;
        await fs.promises.copyFile(dbPath, backupPath);
        return backupPath;
    }

    async rollback(backupPath: string, dbPath: string): Promise<void> {
        // Close current connection
        await this.db.close();

        // Restore backup
        await fs.promises.copyFile(backupPath, dbPath);

        // Reopen connection
        await this.db.initialize();
    }
}
```

---

# EPIC C: Full-Text Search Implementation

## Definition of Done
- ✓ Search returns results in <100ms for 10k records (p95)
- ✓ Fuzzy matching tolerates 1-2 character typos
- ✓ Search syntax supports field-specific queries

## Story C-1: Search Service Core
**Priority**: P0
**Status**: READY
**Depends On**: A-1, A-2
**Unblocks**: D-1

### Acceptance Criteria
```gherkin
Given I have crashes in the database
When I search for "NullPointer"
Then I get results in <100ms
And results are ranked by relevance
And fuzzy matches are included
```

### Tasks

#### C-1-T1: FTS5 Query Builder
**Token Budget**: 10,000
**Modules**: 2 (QueryBuilder, SearchParser)

```typescript
// search/QueryBuilder.ts
export class FTS5QueryBuilder {
    buildQuery(searchTerm: string, options: SearchOptions): FTSQuery {
        const parsed = this.parseSearchTerm(searchTerm);
        let ftsQuery = '';
        let params: any = {};

        // Handle field-specific searches
        if (parsed.fields.length > 0) {
            const fieldQueries = parsed.fields.map(f => {
                if (f.field === 'error') {
                    return `error_type:${this.escapeFTS(f.value)}`;
                } else if (f.field === 'component') {
                    return `component:${this.escapeFTS(f.value)}`;
                }
                return `${f.value}`;
            });
            ftsQuery = fieldQueries.join(' AND ');
        } else {
            // General search across all fields
            ftsQuery = this.buildFuzzyQuery(parsed.terms);
        }

        // Add filters
        const filters: string[] = [];
        if (options.severity) {
            filters.push('severity = @severity');
            params.severity = options.severity;
        }
        if (options.dateRange) {
            filters.push('created_at >= @startDate AND created_at <= @endDate');
            params.startDate = options.dateRange.start;
            params.endDate = options.dateRange.end;
        }

        return {
            fts: ftsQuery,
            filters: filters.join(' AND '),
            params
        };
    }

    private buildFuzzyQuery(terms: string[]): string {
        // Support fuzzy matching with edit distance
        return terms.map(term => {
            if (term.length > 3) {
                return `"${term}" OR "${term}"*`; // Exact or prefix match
            }
            return `"${term}"`;
        }).join(' OR ');
    }

    private escapeFTS(value: string): string {
        return value.replace(/["]/g, '""');
    }
}
```

#### C-1-T2: Search Executor with Caching
**Token Budget**: 12,000
**Modules**: 2 (SearchExecutor, ResultCache)

```typescript
// search/SearchExecutor.ts
export class SearchExecutor {
    private cache = new LRUCache<string, SearchResult>({ max: 100, ttl: 300000 });

    async search(
        query: string,
        options: SearchOptions,
        repo: CrashRepository
    ): Promise<SearchResult> {
        const cacheKey = this.getCacheKey(query, options);

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const start = Date.now();

        // Build and execute query
        const ftsQuery = this.queryBuilder.buildQuery(query, options);
        const sql = `
            SELECT
                c.*,
                bm25(crashes_fts) as rank,
                snippet(crashes_fts, -1, '<mark>', '</mark>', '...', 32) as snippet
            FROM crashes c
            JOIN crashes_fts ON c.rowid = crashes_fts.rowid
            WHERE crashes_fts MATCH @fts
            ${ftsQuery.filters ? `AND ${ftsQuery.filters}` : ''}
            AND c.deleted_at IS NULL
            ORDER BY rank DESC
            LIMIT @limit OFFSET @offset
        `;

        const stmt = this.db.prepare(sql);
        const rows = stmt.all({
            fts: ftsQuery.fts,
            ...ftsQuery.params,
            limit: options.limit || 20,
            offset: options.offset || 0
        });

        const duration = Date.now() - start;

        const result: SearchResult = {
            query,
            results: rows.map(r => this.mapRow(r)),
            total: this.getCount(ftsQuery),
            duration,
            cached: false
        };

        // Cache if fast enough
        if (duration < 500) {
            this.cache.set(cacheKey, result);
        }

        return result;
    }
}
```

#### C-1-T3: Search Performance Optimization
**Token Budget**: 8,000
**Modules**: 1 (Optimizer)

```typescript
// search/SearchOptimizer.ts
export class SearchOptimizer {
    async optimizeFTS(db: Database.Database): Promise<void> {
        // Optimize FTS index
        db.prepare('INSERT INTO crashes_fts(crashes_fts) VALUES("optimize")').run();

        // Analyze tables for query planner
        db.prepare('ANALYZE crashes').run();
        db.prepare('ANALYZE crashes_fts').run();
    }

    async warmCache(repo: CrashRepository): Promise<void> {
        // Pre-load common searches
        const commonSearches = ['error', 'null', 'exception', 'undefined'];
        for (const term of commonSearches) {
            await repo.search(term, { limit: 10 });
        }
    }

    profileQuery(sql: string, params: any): QueryProfile {
        const stmt = this.db.prepare('EXPLAIN QUERY PLAN ' + sql);
        const plan = stmt.all(params);

        return {
            usesIndex: plan.some(p => p.detail.includes('USING INDEX')),
            estimatedRows: plan[0].rows || 0,
            complexity: this.calculateComplexity(plan)
        };
    }
}
```

---

# EPIC D: Search UI & Filters

## Definition of Done
- ✓ Search results appear within 150ms of typing
- ✓ Results are virtualized for smooth scrolling
- ✓ Keyboard navigation works (arrow keys, enter)

## Story D-1: Search Bar Component
**Priority**: P0
**Status**: READY
**Depends On**: C-1
**Unblocks**: User search interaction

### Acceptance Criteria
```gherkin
Given I'm on the search page
When I type in the search bar
Then results appear as I type (debounced)
And I can use filters
And I can clear the search
```

### Tasks

#### D-1-T1: Search Input with Debouncing
**Token Budget**: 8,000
**Modules**: 1 (SearchBar component)

```tsx
// components/SearchBar.tsx
export const SearchBar: React.FC<SearchBarProps> = ({ onSearch }) => {
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<SearchFilters>({});

    // Debounced search
    const debouncedSearch = useMemo(
        () => debounce((q: string, f: SearchFilters) => {
            onSearch(q, f);
        }, 150),
        [onSearch]
    );

    useEffect(() => {
        if (query.length > 0 || Object.keys(filters).length > 0) {
            debouncedSearch(query, filters);
        }
    }, [query, filters]);

    return (
        <div className="search-bar">
            <div className="search-input-wrapper">
                <SearchIcon />
                <input
                    type="text"
                    placeholder="Search crashes..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="search-input"
                />
                {query && (
                    <button onClick={() => setQuery('')}>
                        <ClearIcon />
                    </button>
                )}
            </div>

            <FilterBar filters={filters} onChange={setFilters} />
        </div>
    );
};
```

#### D-1-T2: Filter Panel Component
**Token Budget**: 10,000
**Modules**: 2 (FilterBar, FilterDropdown)

```tsx
// components/FilterBar.tsx
export const FilterBar: React.FC<FilterBarProps> = ({ filters, onChange }) => {
    const availableComponents = useAvailableComponents();

    return (
        <div className="filter-bar">
            <FilterDropdown
                label="Severity"
                value={filters.severity}
                options={['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']}
                onChange={(v) => onChange({ ...filters, severity: v })}
            />

            <FilterDropdown
                label="Date Range"
                value={filters.dateRange}
                options={[
                    { label: 'Today', value: 'today' },
                    { label: 'This Week', value: 'week' },
                    { label: 'This Month', value: 'month' },
                    { label: 'All Time', value: 'all' }
                ]}
                onChange={(v) => onChange({ ...filters, dateRange: v })}
            />

            <FilterDropdown
                label="Component"
                value={filters.component}
                options={availableComponents}
                onChange={(v) => onChange({ ...filters, component: v })}
            />

            {Object.keys(filters).length > 0 && (
                <button onClick={() => onChange({})}>
                    Clear Filters
                </button>
            )}
        </div>
    );
};
```

#### D-1-T3: Search Results List (Virtualized)
**Token Budget**: 12,000
**Modules**: 2 (SearchResults, ResultCard)

```tsx
// components/SearchResults.tsx
import { VariableSizeList } from 'react-window';

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onSelect }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                setSelectedIndex(i => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
                setSelectedIndex(i => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
                onSelect(results[selectedIndex]);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIndex, results]);

    const getItemSize = (index: number) => {
        // Dynamic height based on content
        const hasSnippet = results[index].snippet;
        return hasSnippet ? 120 : 80;
    };

    const Row = ({ index, style }) => (
        <div style={style}>
            <ResultCard
                crash={results[index]}
                selected={index === selectedIndex}
                onClick={() => onSelect(results[index])}
            />
        </div>
    );

    return (
        <div className="search-results">
            <div className="results-header">
                Showing {results.length} of {totalCount} crashes
            </div>

            <VariableSizeList
                height={600}
                itemCount={results.length}
                itemSize={getItemSize}
                width="100%"
            >
                {Row}
            </VariableSizeList>
        </div>
    );
};
```

---

# EPIC E: Recent & Favorites

## Definition of Done
- ✓ Recent crashes show last 10 viewed
- ✓ Favorites persist across sessions
- ✓ Quick access panel loads in <50ms

## Story E-1: Favorites Management
**Priority**: P1
**Status**: READY
**Depends On**: A-2
**Unblocks**: Quick access feature

### Acceptance Criteria
```gherkin
Given I'm viewing a crash
When I click the star icon
Then it's added to favorites
And appears in the favorites panel
And persists after restart
```

### Tasks

#### E-1-T1: Favorites Service
**Token Budget**: 6,000
**Modules**: 1 (FavoritesService)

```typescript
// services/FavoritesService.ts
export class FavoritesService {
    async toggleFavorite(crashId: string): Promise<boolean> {
        const crash = await this.repo.findById(crashId);
        if (!crash) throw new Error('Crash not found');

        const newState = !crash.is_favorite;
        await this.repo.updateFavorite(crashId, newState);

        this.events.emit('favorite-changed', { crashId, isFavorite: newState });
        return newState;
    }

    async getFavorites(): Promise<Crash[]> {
        return this.repo.findFavorites({ limit: 50 });
    }
}
```

#### E-1-T2: Recent Crashes Tracking
**Token Budget**: 6,000
**Modules**: 1 (RecentService)

```typescript
// services/RecentService.ts
export class RecentCrashesService {
    async trackView(crashId: string): Promise<void> {
        await this.repo.updateViewMetadata(crashId, {
            last_viewed_at: Date.now(),
            view_count: this.db.prepare('SELECT view_count FROM crashes WHERE id = ?')
                .get(crashId).view_count + 1
        });
    }

    async getRecent(limit: number = 10): Promise<Crash[]> {
        return this.repo.findRecent({ limit });
    }
}
```

---

# EPIC F: Database Management Tools

## Definition of Done
- ✓ Database can be backed up manually
- ✓ Import wizard handles 1000+ files
- ✓ Integrity checks run without blocking UI

## Story F-1: Database Maintenance UI
**Priority**: P2
**Status**: READY
**Depends On**: A-1
**Unblocks**: Admin features

### Acceptance Criteria
```gherkin
Given I'm in settings
When I click "Database Management"
Then I can see database statistics
And I can trigger backup
And I can run integrity check
And I can compact the database
```

### Tasks

#### F-1-T1: Database Statistics Service
**Token Budget**: 8,000
**Modules**: 1 (StatsService)

```typescript
// services/DatabaseStatsService.ts
export class DatabaseStatsService {
    async getStatistics(): Promise<DatabaseStats> {
        const stats = {
            totalCrashes: this.db.prepare('SELECT COUNT(*) as count FROM crashes').get().count,
            databaseSize: await this.getFileSize(this.dbPath),
            oldestCrash: this.db.prepare('SELECT MIN(created_at) as date FROM crashes').get().date,
            newestCrash: this.db.prepare('SELECT MAX(created_at) as date FROM crashes').get().date,
            favoriteCount: this.db.prepare('SELECT COUNT(*) as count FROM crashes WHERE is_favorite = 1').get().count,
            componentBreakdown: this.getComponentStats(),
            severityBreakdown: this.getSeverityStats(),
            ftsIndexSize: await this.getFTSIndexSize()
        };

        return stats;
    }

    async compact(): Promise<CompactResult> {
        const before = await this.getFileSize(this.dbPath);
        this.db.prepare('VACUUM').run();
        const after = await this.getFileSize(this.dbPath);

        return {
            spaceSaved: before - after,
            percentReduction: ((before - after) / before) * 100
        };
    }
}
```

#### F-1-T2: Backup & Restore UI
**Token Budget**: 10,000
**Modules**: 2 (BackupUI, RestoreWizard)

```tsx
// components/DatabaseManagement.tsx
export const DatabaseManagement: React.FC = () => {
    const [stats, setStats] = useState<DatabaseStats | null>(null);
    const [backing, setBacking] = useState(false);

    const handleBackup = async () => {
        setBacking(true);
        try {
            const savePath = await dialog.showSaveDialog({
                defaultPath: `crash-analyzer-backup-${Date.now()}.db`,
                filters: [{ name: 'SQLite Database', extensions: ['db'] }]
            });

            if (savePath) {
                await ipcRenderer.invoke('database:backup', savePath);
                showNotification('Backup completed successfully');
            }
        } finally {
            setBacking(false);
        }
    };

    return (
        <div className="database-management">
            <StatsDisplay stats={stats} />

            <div className="actions">
                <button onClick={handleBackup} disabled={backing}>
                    {backing ? 'Backing up...' : 'Backup Database'}
                </button>

                <button onClick={handleCompact}>
                    Compact Database
                </button>

                <button onClick={handleIntegrityCheck}>
                    Run Integrity Check
                </button>

                <button onClick={handleClearAll} className="danger">
                    Clear All Data
                </button>
            </div>
        </div>
    );
};
```

---

# Testing Strategy

## Unit Tests (Target: 90% Coverage)
- Repository layer: All CRUD operations
- Query builder: All search syntax variations
- Migration validator: Edge cases
- Services: Business logic

## Integration Tests
- Database initialization and schema creation
- Migration of 1000+ JSON files
- Search performance with 10k records
- IPC bridge communication

## E2E Tests
- Search flow: Type → Results → Open
- Migration wizard: Scan → Import → Verify
- Favorites: Star → View → Persist
- Database backup and restore

## Performance Tests
```typescript
// __tests__/performance/search.perf.test.ts
describe('Search Performance', () => {
    it('should return results in <100ms for 10k records', async () => {
        await seedDatabase(10000);

        const start = Date.now();
        const results = await searchService.search('error');
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(100);
        expect(results.length).toBeGreaterThan(0);
    });
});
```

---

# Monitoring & Observability

## Metrics to Track
```typescript
// Structured logging
logger.info('search_performed', {
    correlationId: generateId(),
    query,
    resultCount: results.length,
    duration,
    cached: fromCache,
    filters: JSON.stringify(filters)
});

// Performance metrics
metrics.histogram('search.duration', duration);
metrics.counter('search.count', 1);
metrics.gauge('database.size', dbSize);
```

## SLOs
- Search p95 latency < 100ms over 5min window
- Migration success rate > 99% over 24h
- Database integrity check passes 100% daily
- UI responsiveness < 50ms for all interactions

## Alerts
- Search duration > 500ms (3 occurrences in 5min)
- Migration failure rate > 5%
- Database size > 45MB (90% of limit)
- FTS index corruption detected

---

# Rollback Plan

## Feature Flags
```typescript
const FEATURE_FLAGS = {
    USE_DATABASE: process.env.USE_DATABASE === 'true',
    ENABLE_FTS_SEARCH: process.env.ENABLE_FTS === 'true',
    SHOW_MIGRATION_WIZARD: process.env.SHOW_MIGRATION === 'true'
};

// Gradual rollout
if (FEATURE_FLAGS.USE_DATABASE) {
    return databaseRepository.search(query);
} else {
    return legacyJsonSearch(query);
}
```

## Migration Rollback
1. Stop application
2. Restore backup database
3. Clear migration status flags
4. Restart with legacy mode
5. Investigate failure logs

---

# Security Considerations

## SQL Injection Prevention
- All queries use prepared statements
- Input validation before query building
- FTS terms properly escaped

## Data Protection
- Database file encrypted at rest (OS-level)
- Sensitive data excluded from logs
- Crash data sanitized before storage

## Access Control
- Database file permissions: 600 (user only)
- No network access to database
- Local storage only (no cloud sync in Phase 2)

---

# Delivery Health Score

---

# EPIC G: PostgreSQL + pgvector Backend (NEW)

**Technology**: PostgreSQL 15+ with pgvector extension
**References**:
- [pgvector/pgvector](https://github.com/pgvector/pgvector) - Vector similarity search
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)
- [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) - Fuzzy matching

## Definition of Done
- ✓ PostgreSQL database with pgvector extension installed
- ✓ Crash embeddings stored in vector(1536) column
- ✓ IVFFlat index created for similarity search
- ✓ Hybrid search (FTS + vector + fuzzy) implemented
- ✓ Performance: <100ms for similarity search on 100k records

## Story G-1: PostgreSQL Setup with pgvector
**Priority**: P1 (Backend only, desktop uses SQLite)
**Status**: READY
**Depends On**: A-2 (Repository pattern)

### Acceptance Criteria
```gherkin
Given PostgreSQL 15+ is installed
When the backend application starts
Then it installs the pgvector extension
And creates the crashes table with vector(1536) column
And creates IVFFlat index for similarity search
And creates tsvector column for full-text search
And creates GIN index for fuzzy search (pg_trgm)
```

### Tasks

#### G-1-T1: PostgreSQL Schema with pgvector
**Token Budget**: 10,000
**Reference**: [pgvector documentation](https://github.com/pgvector/pgvector#getting-started)

```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Crashes table with vector embeddings
CREATE TABLE IF NOT EXISTS crashes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Parsed crash data
    error_type TEXT,
    error_message TEXT,
    severity TEXT CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    component TEXT,
    stack_trace TEXT,

    -- AI analysis
    root_cause TEXT,
    suggested_fixes JSONB,
    confidence TEXT CHECK(confidence IN ('HIGH','MEDIUM','LOW')),

    -- Vector embedding for semantic search
    embedding vector(1536),  -- OpenAI ada-002 embeddings

    -- Full-text search
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(error_type, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(error_message, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(root_cause, '')), 'C')
    ) STORED,

    -- User metadata
    is_favorite BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- IVFFlat index for vector similarity (cosine distance)
CREATE INDEX IF NOT EXISTS crashes_embedding_idx
ON crashes USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS crashes_search_idx
ON crashes USING GIN (search_vector);

-- GIN index for fuzzy search
CREATE INDEX IF NOT EXISTS crashes_stack_trace_trgm_idx
ON crashes USING GIN (stack_trace gin_trgm_ops);
```

#### G-1-T2: Hybrid Search Query
**Token Budget**: 8,000
**Reference**: [RRF implementation pattern](https://github.com/qdrant/qdrant-js)

```sql
-- Hybrid search combining FTS, vector similarity, and fuzzy matching
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text TEXT,
    query_embedding vector(1536),
    result_limit INT DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    filename TEXT,
    error_type TEXT,
    similarity_score FLOAT,
    search_method TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Full-text search results
    fts_results AS (
        SELECT
            c.id,
            ts_rank(c.search_vector, to_tsquery('english', query_text)) AS fts_score
        FROM crashes c
        WHERE c.search_vector @@ to_tsquery('english', query_text)
            AND c.deleted_at IS NULL
        ORDER BY fts_score DESC
        LIMIT 50
    ),
    -- Vector similarity results
    vector_results AS (
        SELECT
            c.id,
            1 - (c.embedding <=> query_embedding) AS vector_score
        FROM crashes c
        WHERE c.embedding IS NOT NULL
            AND c.deleted_at IS NULL
        ORDER BY c.embedding <=> query_embedding
        LIMIT 50
    ),
    -- Fuzzy matching results (typo tolerance)
    fuzzy_results AS (
        SELECT
            c.id,
            similarity(c.stack_trace, query_text) AS fuzzy_score
        FROM crashes c
        WHERE similarity(c.stack_trace, query_text) > 0.3
            AND c.deleted_at IS NULL
        ORDER BY fuzzy_score DESC
        LIMIT 50
    ),
    -- RRF (Reciprocal Rank Fusion) scoring
    combined_results AS (
        SELECT
            COALESCE(f.id, v.id, fz.id) AS crash_id,
            COALESCE(1.0 / (ROW_NUMBER() OVER (ORDER BY f.fts_score DESC) + 60), 0) AS fts_rank,
            COALESCE(1.0 / (ROW_NUMBER() OVER (ORDER BY v.vector_score DESC) + 60), 0) AS vector_rank,
            COALESCE(1.0 / (ROW_NUMBER() OVER (ORDER BY fz.fuzzy_score DESC) + 60), 0) AS fuzzy_rank
        FROM fts_results f
        FULL OUTER JOIN vector_results v ON f.id = v.id
        FULL OUTER JOIN fuzzy_results fz ON COALESCE(f.id, v.id) = fz.id
    )
    SELECT
        c.id,
        c.filename,
        c.error_type,
        (cr.fts_rank + cr.vector_rank + cr.fuzzy_rank) AS similarity_score,
        CASE
            WHEN cr.fts_rank > 0 AND cr.vector_rank > 0 AND cr.fuzzy_rank > 0 THEN 'hybrid_all'
            WHEN cr.fts_rank > 0 AND cr.vector_rank > 0 THEN 'hybrid_fts_vector'
            WHEN cr.vector_rank > 0 THEN 'vector_only'
            WHEN cr.fts_rank > 0 THEN 'fts_only'
            ELSE 'fuzzy_only'
        END AS search_method
    FROM combined_results cr
    JOIN crashes c ON c.id = cr.crash_id
    ORDER BY similarity_score DESC
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;
```

**Node.js Backend Usage**:
```typescript
// backend/services/crash-search.service.ts
import { Pool } from 'pg';
import { OpenAI } from 'openai';

export class CrashSearchService {
    constructor(
        private pool: Pool,
        private openai: OpenAI
    ) {}

    async hybridSearch(query: string, limit: number = 20) {
        // Generate query embedding
        const embeddingResponse = await this.openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: query
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;

        // Execute hybrid search
        const result = await this.pool.query(
            'SELECT * FROM hybrid_search($1, $2, $3)',
            [query, `[${queryEmbedding.join(',')}]`, limit]
        );

        return result.rows;
    }

    async findSimilarCrashes(crashId: string, limit: number = 10) {
        // Get embedding for the crash
        const crash = await this.pool.query(
            'SELECT embedding FROM crashes WHERE id = $1',
            [crashId]
        );

        if (!crash.rows[0]?.embedding) {
            throw new Error('Crash embedding not found');
        }

        // Find similar crashes using cosine similarity
        const result = await this.pool.query(`
            SELECT id, filename, error_type,
                   1 - (embedding <=> $1) AS similarity
            FROM crashes
            WHERE id != $2 AND deleted_at IS NULL
            ORDER BY embedding <=> $1
            LIMIT $3
        `, [crash.rows[0].embedding, crashId, limit]);

        return result.rows;
    }
}
```

---

## Assessment
1. **Clarity**: 3/3 - Requirements are unambiguous with clear acceptance criteria
2. **Feasibility**: 3/3 - Work items properly sized and sequenced
3. **Completeness**: 3/3 - All quality gates, testing, and observability included

**Total Score: 9/9 - PROCEED**

## Critical Path
```
A-1 → A-2 → C-1 → D-1 (Core search functionality)
         ↘ B-1 (Migration can happen in parallel after A-2)
```

## Risk Summary
- **High Risk**: Data loss during migration - MITIGATED via backups and transactions
- **Medium Risk**: Search performance degradation - MITIGATED via FTS5 optimization and caching
- All risks have mitigation strategies or acceptance criteria

## Next Steps
1. Begin with Epic A (Database Foundation) - A-1 is the root story
2. Parallelize Epic B (Migration) and Epic C (Search) after A-2 completes
3. Epic D (UI) can begin after C-1 search service is ready
4. Epics E and F are lower priority and can be deferred if needed

---

# Appendix: IPC Bridge Definition

```typescript
// main/ipc/database.ipc.ts
ipcMain.handle('database:search', async (event, query, options) => {
    return searchService.search(query, options);
});

ipcMain.handle('database:getCrash', async (event, id) => {
    return crashRepository.findById(id);
});

ipcMain.handle('database:toggleFavorite', async (event, id) => {
    return favoritesService.toggleFavorite(id);
});

// renderer/services/database.service.ts
export class DatabaseService {
    async search(query: string, options?: SearchOptions): Promise<SearchResult> {
        return ipcRenderer.invoke('database:search', query, options);
    }
}
```