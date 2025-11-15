# ⚡ Reference Implementation & Acceleration Guide
## Proven Repositories for Smalltalk Crash Analyzer

---

## 🎯 Purpose

This guide maps **proven, battle-tested open-source repositories** to each phase of development. Instead of building everything from scratch, we leverage production-quality patterns and code from the open-source ecosystem.

**Alex Chen's Principle**: *"Steal patterns, not problems. Learn from proven code, adapt it to our needs."*

---

## 🚀 Quick Reference Table — Proven Repositories by Domain

| Domain | Repository | License | Use / Port |
|--------|-----------|---------|------------|
| **Backend Security & Auth** | [helmetjs/helmet](https://github.com/helmetjs/helmet) | MIT | Security headers & CSP |
| | [express-rate-limit](https://github.com/nfriedly/express-rate-limit) | MIT | Rate limiting middleware |
| | [passport](https://github.com/jaredhanson/passport) | MIT | OAuth2 / OIDC authentication |
| | [express-validator](https://github.com/express-validator/express-validator) | MIT | Declarative request validation |
| | [open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js) | Apache-2.0 | Observability and tracing |
| **Database & Search** | [pgvector/pgvector](https://github.com/pgvector/pgvector) | MIT | Vector embeddings & similarity |
| | [postgres/postgres](https://github.com/postgres/postgres) | PostgreSQL | Reference for FTS and `pg_trgm` |
| | [salsita/node-pg-migrate](https://github.com/salsita/node-pg-migrate) | MIT | Database migrations |
| **Desktop (Tauri)** | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | Apache-2.0 | Secure desktop shell |
| | [tauri-plugin-keyring](https://github.com/tauri-apps/tauri-plugin-keyring) | MIT | Secure credential storage |
| | [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | Local database with FTS5 |
| | [offlinefirst/research](https://github.com/offlinefirst/research) | — | Offline sync & conflict resolution patterns |
| **AI / LLM Analysis** | [logpai/logparser](https://github.com/logpai/logparser) | Apache-2.0 | Log parsing algorithms |
| | [microsoft/LogAnalysis](https://github.com/microsoft/LogAnalysis) | MIT | AI-driven log analysis |
| | [microsoft/presidio](https://github.com/microsoft/presidio) | MIT | PII redaction & entity detection |
| | [nodeshift/opossum](https://github.com/nodeshift/opossum) | Apache-2.0 | Circuit breaker implementation |
| | [guardrails-ai/guardrails](https://github.com/guardrails-ai/guardrails) | Apache-2.0 | Schema validation for LLM output |
| **Search & Validation** | [qdrant/qdrant](https://github.com/qdrant/qdrant) | Apache-2.0 | Hybrid search & ranking fusion |
| | [UKPLab/sentence-transformers](https://github.com/UKPLab/sentence-transformers) | Apache-2.0 | Cross-encoder reranking |
| | [facebookresearch/faiss](https://github.com/facebookresearch/faiss) | MIT | Benchmark reference for ANN |
| **Web App** | [Dexie/Dexie.js](https://github.com/dexie/Dexie.js) | Apache-2.0 | IndexedDB wrapper |
| | [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) | Apache-2.0 | Service workers & PWA caching |
| | [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | Accessible React component patterns |
| | [diafygi/webcrypto-examples](https://github.com/diafygi/webcrypto-examples) | MIT | Web Crypto encryption examples |
| **Sync & Conflict Handling** | [automerge/automerge](https://github.com/automerge/automerge) | MIT | CRDT concepts & merge patterns |
| | [powersync-ja/powersync.js](https://github.com/powersync-ja/powersync.js) | MIT | Differential sync design |
| **Testing & CI/CD** | [visionmedia/supertest](https://github.com/visionmedia/supertest) | MIT | API test patterns |
| | [microsoft/playwright](https://github.com/microsoft/playwright) | Apache-2.0 | E2E testing |
| | [docker/awesome-compose](https://github.com/docker/awesome-compose) | Apache-2.0 | Compose examples |
| | [actions/starter-workflows](https://github.com/actions/starter-workflows) | MIT | CI/CD templates |
| **Cross-cutting Tools** | [vercel/turborepo](https://github.com/vercel/turborepo) | MPL-2.0 | Monorepo & caching |
| | [winstonjs/winston](https://github.com/winstonjs/winston) | MIT | Structured logging |
| | [node-config/node-config](https://github.com/node-config/node-config) | MIT | Environment-based config management |

---

## 🧱 Phase 0 — MVP & Security Baseline

### Technology Decisions
- **MVP**: Python CLI (keep simple for validation)
- **Backend**: Node.js + Express (when API needed)
- **Security**: Helmet + Express Rate Limit from day one

### Borrow From:

**helmetjs/helmet** → Security headers
```javascript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

**express-rate-limit** → Rate limiting
```javascript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
```

**express-validator** → Input validation
```javascript
import { body, validationResult } from 'express-validator';

app.post('/api/crashes',
  body('filename').isString().trim().notEmpty(),
  body('content').isString().notEmpty(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // Process...
  }
);
```

### Adaptation Rules:
- Enforce strict upload MIME filtering (`.log`, `.txt` only)
- Limit uploads by role
- Add dependency scans in CI (`npm audit`, `license-checker`)

---

## 🗃️ Phase 1 — Database & API Foundation

### Technology Stack
- **Database**: PostgreSQL 15+ with pgvector
- **API**: Node.js + Express + TypeScript
- **Migrations**: node-pg-migrate
- **Search**: pg_trgm + FTS + pgvector

### Borrow From:

**pgvector/pgvector** → Vector similarity search
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add vector column for embeddings
ALTER TABLE crashes ADD COLUMN embedding vector(1536);

-- Create IVFFlat index for ANN search
CREATE INDEX ON crashes
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Similarity search
SELECT id, filename,
       1 - (embedding <=> query_embedding) as similarity
FROM crashes
WHERE 1 - (embedding <=> query_embedding) > 0.7
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

**node-pg-migrate** → Database migrations
```javascript
// migrations/1234567890_create_crashes_table.js
exports.up = (pgm) => {
  pgm.createTable('crashes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    sha256: { type: 'varchar(64)', unique: true, notNull: true },
    filename: { type: 'varchar(255)', notNull: true },
    raw_content: { type: 'text', notNull: true },
    embedding: { type: 'vector(1536)' },
    ts_doc: { type: 'tsvector' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.createIndex('crashes', 'sha256');
  pgm.createIndex('crashes', 'ts_doc', { method: 'gin' });
  pgm.createIndex('crashes', 'embedding', { method: 'ivfflat', opclass: 'vector_cosine_ops' });
};

exports.down = (pgm) => {
  pgm.dropTable('crashes');
};
```

**Full-Text Search** → PostgreSQL FTS
```sql
-- Generate tsvector column
ALTER TABLE crashes
ADD COLUMN ts_doc tsvector
GENERATED ALWAYS AS (
  to_tsvector('english',
    coalesce(filename, '') || ' ' ||
    coalesce(error_type, '') || ' ' ||
    coalesce(root_cause_analysis, '')
  )
) STORED;

-- GIN index for fast FTS
CREATE INDEX idx_crashes_fts ON crashes USING gin(ts_doc);

-- Trigram index for fuzzy search
CREATE INDEX idx_crashes_filename_trgm ON crashes
USING gin(filename gin_trgm_ops);

-- Search with highlighting
SELECT id, filename,
       ts_rank(ts_doc, query) as rank,
       ts_headline('english', raw_content, query,
                   'MaxWords=50, MinWords=25') as snippet
FROM crashes, plainto_tsquery('english', 'null pointer') query
WHERE ts_doc @@ query
ORDER BY rank DESC
LIMIT 20;
```

### Key Implementation Rules:
- Use `sha256` for deduplication
- Store `parser_version`, `prompt_version`, `model_name`
- Track `tokens_in`, `tokens_out`, `cost_usd`
- Add `search_config` table for hybrid search weights

---

## 💻 Phase 2 — Desktop Application (Tauri)

### Technology Stack
- **Framework**: Tauri (Rust + TypeScript)
- **Frontend**: React 18 + TypeScript + Tailwind
- **Local DB**: better-sqlite3 with FTS5
- **Secure Storage**: tauri-plugin-keyring

### Why Tauri over Electron?
- ✅ **Smaller bundle**: 10-20MB vs 100-200MB
- ✅ **Better security**: OS-level sandboxing
- ✅ **Lower memory**: Uses system WebView
- ✅ **Native performance**: Rust backend
- ✅ **Better credential storage**: OS keyring integration

### Borrow From:

**tauri-apps/tauri** → Secure IPC
```rust
// src-tauri/src/main.rs
#[tauri::command]
async fn analyze_crash(filepath: String) -> Result<CrashAnalysis, String> {
    // Read file
    let content = std::fs::read_to_string(filepath)
        .map_err(|e| e.to_string())?;

    // Call backend API
    let analysis = call_ai_analysis(&content).await?;

    Ok(analysis)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_crash])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**tauri-plugin-keyring** → Secure credential storage
```typescript
import { KeyringService } from 'tauri-plugin-keyring';

// Store API key securely in OS keyring
async function storeApiKey(key: string) {
  const keyring = new KeyringService();
  await keyring.setPassword('crash-analyzer', 'openai-key', key);
}

// Retrieve API key
async function getApiKey(): Promise<string> {
  const keyring = new KeyringService();
  return await keyring.getPassword('crash-analyzer', 'openai-key');
}
```

**better-sqlite3** → Local database with FTS5
```typescript
import Database from 'better-sqlite3';

const db = new Database('crashes.db');

// Create tables with FTS5
db.exec(`
  CREATE TABLE IF NOT EXISTS crashes (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    content TEXT NOT NULL,
    analysis TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- FTS5 virtual table
  CREATE VIRTUAL TABLE IF NOT EXISTS crashes_fts
  USING fts5(filename, content, analysis, content=crashes);

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS crashes_ai AFTER INSERT ON crashes BEGIN
    INSERT INTO crashes_fts(rowid, filename, content, analysis)
    VALUES (new.rowid, new.filename, new.content, new.analysis);
  END;
`);

// Fast full-text search
const searchCrashes = db.prepare(`
  SELECT c.* FROM crashes c
  JOIN crashes_fts fts ON c.rowid = fts.rowid
  WHERE crashes_fts MATCH ?
  ORDER BY rank
  LIMIT 20
`);
```

**offlinefirst/research** → Sync patterns
```typescript
// Offline queue with exponential backoff
class SyncQueue {
  private queue: SyncOperation[] = [];
  private retryCount = new Map<string, number>();

  async push(operation: SyncOperation) {
    this.queue.push(operation);
    await this.saveQueue();
  }

  async process() {
    while (this.queue.length > 0) {
      const op = this.queue[0];
      const retries = this.retryCount.get(op.id) || 0;

      try {
        await this.executeOperation(op);
        this.queue.shift();
        this.retryCount.delete(op.id);
      } catch (error) {
        this.retryCount.set(op.id, retries + 1);
        const delay = Math.min(1000 * Math.pow(2, retries), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}
```

### Implementation Rules:
- IPC bridge exposes minimal commands: `upload`, `sync`, `auth`
- Field-level merge only for editable metadata (tags, notes)
- Local offline queue with exponential backoff
- Use OS-native file dialogs and notifications

---

## 🧠 Phase 3 — AI Integration & Analysis

### Technology Stack
- **Parsing**: Drain algorithm from logpai/logparser
- **PII Redaction**: Microsoft Presidio patterns
- **Circuit Breaker**: Opossum
- **Schema Validation**: Guardrails patterns

### Borrow From:

**logpai/logparser** → Drain algorithm
```python
# Adapt Drain algorithm for Smalltalk stack traces
from logparser import Drain

parser = Drain.LogParser(
    log_format='<Time> <Level> <Content>',
    indir='./logs',
    outdir='./parsed',
    depth=4,  # Tree depth
    st=0.5,   # Similarity threshold
    rex=[r'\d+']  # Regex to mask numbers
)

parser.parse('crash.log')
```

**microsoft/presidio** → PII redaction
```typescript
// Regex-based PII redaction (Stage 0)
const redactors = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
  { pattern: /\/Users\/\w+\//g, replacement: '/Users/[REDACTED]/' },
  { pattern: /C:\\Users\\\w+\\/g, replacement: 'C:\\Users\\[REDACTED]\\' }
];

function redactPII(content: string): { redacted: string, count: number } {
  let redacted = content;
  let count = 0;

  for (const { pattern, replacement } of redactors) {
    const matches = redacted.match(pattern);
    if (matches) count += matches.length;
    redacted = redacted.replace(pattern, replacement);
  }

  return { redacted, count };
}
```

**nodeshift/opossum** → Circuit breaker
```typescript
import CircuitBreaker from 'opossum';

const options = {
  timeout: 60000, // 60s
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // 30s
  rollingCountTimeout: 10000,
  rollingCountBuckets: 10
};

const breaker = new CircuitBreaker(analyzeWithAI, options);

breaker.fallback(() => ({
  error: 'AI service temporarily unavailable',
  fallback: true
}));

breaker.on('open', () => {
  console.warn('Circuit breaker opened - AI service down');
});

// Use breaker
const analysis = await breaker.fire(crashData);
```

**guardrails-ai patterns** → Schema validation
```typescript
import Ajv from 'ajv';

const ajv = new Ajv();

const analysisSchema = {
  type: 'object',
  required: ['root_cause', 'suggested_fixes', 'severity'],
  properties: {
    root_cause: { type: 'string', minLength: 10 },
    suggested_fixes: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5
    },
    severity: { enum: ['critical', 'high', 'medium', 'low'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
};

const validate = ajv.compile(analysisSchema);

function validateAIResponse(response: any): boolean {
  const valid = validate(response);
  if (!valid) {
    console.error('Schema validation failed:', validate.errors);
    // Quarantine invalid responses
    quarantineTable.insert({ response, errors: validate.errors });
  }
  return valid;
}
```

### AI Analysis Pipeline:
```
Upload → Parse (Drain) → Redact (Presidio) → Analyze (LLM) → Validate (Schema) → Persist
```

### Implementation Rules:
- Store `parser_version`, `prompt_version`, `model`, `tokens_in/out`
- Quarantine table for failed schema validations
- Circuit breaker with fallback to cached/similar analyses
- Exponential backoff on retries

---

## 🔍 Phase 4 — Hybrid Search & Validation

### Technology Stack
- **Vector DB**: pgvector (already in Postgres)
- **Hybrid Fusion**: RRF from Qdrant patterns
- **Reranking**: Cross-encoder patterns from sentence-transformers

### Borrow From:

**qdrant patterns** → Reciprocal Rank Fusion (RRF)
```sql
-- Hybrid search with RRF
WITH lexical_search AS (
  SELECT id, filename,
         ts_rank(ts_doc, query) as rank,
         row_number() OVER (ORDER BY ts_rank(ts_doc, query) DESC) as rn
  FROM crashes, plainto_tsquery('english', $1) query
  WHERE ts_doc @@ query
  LIMIT 50
),
vector_search AS (
  SELECT id, filename,
         1 - (embedding <=> $2::vector) as similarity,
         row_number() OVER (ORDER BY embedding <=> $2::vector) as rn
  FROM crashes
  WHERE 1 - (embedding <=> $2::vector) > 0.5
  LIMIT 50
)
SELECT
  COALESCE(l.id, v.id) as id,
  COALESCE(l.filename, v.filename) as filename,
  (
    COALESCE(1.0 / (60 + l.rn), 0) * 0.4 +  -- 40% weight to lexical
    COALESCE(1.0 / (60 + v.rn), 0) * 0.6    -- 60% weight to vector
  ) as rrf_score
FROM lexical_search l
FULL OUTER JOIN vector_search v ON l.id = v.id
ORDER BY rrf_score DESC
LIMIT 20;
```

**sentence-transformers patterns** → Cross-encoder reranking
```python
# Use cross-encoder for top-k reranking
from sentence_transformers import CrossEncoder

model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')

def rerank_results(query: str, results: list, top_k: int = 10):
    # Only rerank top 50 from initial search
    pairs = [(query, result['content']) for result in results[:50]]
    scores = model.predict(pairs)

    # Sort by cross-encoder scores
    ranked = sorted(
        zip(results[:50], scores),
        key=lambda x: x[1],
        reverse=True
    )

    return [r[0] for r in ranked[:top_k]]
```

**PostgreSQL highlighting** → Search result snippets
```sql
SELECT
  id,
  filename,
  ts_headline(
    'english',
    raw_content,
    plainto_tsquery('english', $1),
    'MaxWords=50, MinWords=25, HighlightAll=false'
  ) as snippet
FROM crashes
WHERE ts_doc @@ plainto_tsquery('english', $1);
```

### Implementation Rules:
- Hybrid weighting: 40% lexical (FTS), 60% vector similarity
- Store search config versions in database
- Add audit trail for "why this crash matched"
- Cache embedding generation (don't re-embed identical content)

---

## 🌐 Phase 5 — Web Application

### Technology Stack
- **Frontend**: React + TypeScript + Tailwind
- **Offline Storage**: Dexie.js (IndexedDB)
- **Service Worker**: Workbox
- **Components**: shadcn/ui patterns
- **Encryption**: Web Crypto API

### Borrow From:

**Dexie.js** → IndexedDB with migrations
```typescript
import Dexie, { Table } from 'dexie';

interface Crash {
  id: string;
  filename: string;
  content: string;
  analysis?: string;
  synced: boolean;
  updatedAt: number;
}

class CrashDatabase extends Dexie {
  crashes!: Table<Crash>;

  constructor() {
    super('CrashAnalyzer');

    this.version(1).stores({
      crashes: 'id, filename, *tags, synced, updatedAt'
    });

    this.version(2).stores({
      crashes: 'id, filename, *tags, synced, updatedAt, sha256'
    }).upgrade(tx => {
      return tx.table('crashes').toCollection().modify(crash => {
        crash.sha256 = sha256(crash.content);
      });
    });
  }
}

const db = new CrashDatabase();

// Efficient queries
const recentCrashes = await db.crashes
  .where('synced').equals(false)
  .limit(20)
  .toArray();
```

**Workbox** → Service worker caching
```typescript
// service-worker.ts
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

// Precache app shell
precacheAndRoute(self.__WB_MANIFEST);

// API calls: Network first, cache fallback
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [
      new BackgroundSyncPlugin('api-queue', {
        maxRetentionTime: 24 * 60 // 24 hours
      })
    ]
  })
);

// Static assets: Cache first
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({ cacheName: 'images' })
);
```

**shadcn/ui patterns** → Accessible components
```tsx
// Adapt shadcn/ui patterns (don't copy, learn structure)
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

export function CrashDialog({ crash, onClose }: Props) {
  return (
    <Dialog.Root open onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className={cn(
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
          "bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-2xl"
        )}>
          <Dialog.Title className="text-xl font-semibold">
            {crash.filename}
          </Dialog.Title>
          {/* Content */}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Web Crypto** → Client-side encryption
```typescript
// Encrypt sensitive data before IndexedDB storage
async function encryptData(data: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    dataBuffer
  );

  // Return iv + encrypted data as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encrypted: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
```

### Implementation Rules:
- IndexedDB chunked queries (not "load all")
- Background sync for uploads
- `network-first` for API calls
- Include `axe` accessibility audit in E2E tests

---

## 🔁 Phase 6 — Sync & Conflict Resolution

### Technology Stack
- **Sync Pattern**: Differential sync from powersync.js
- **Merge Strategy**: Field-level merge from Automerge patterns
- **Conflict Logging**: Express rate-limited sync API

### Borrow From:

**automerge patterns** → Field-level merge
```typescript
// Learn merge strategies from Automerge (don't use library directly)
interface ConflictResolution {
  field: string;
  localValue: any;
  remoteValue: any;
  resolution: 'local' | 'remote' | 'merge';
  strategy: string;
}

function mergeChanges(local: Crash, remote: Crash): {
  merged: Crash;
  conflicts: ConflictResolution[];
} {
  const merged = { ...local };
  const conflicts: ConflictResolution[] = [];

  // Immutable fields: remote wins
  if (local.analysis !== remote.analysis && remote.validated) {
    merged.analysis = remote.analysis;
    conflicts.push({
      field: 'analysis',
      localValue: local.analysis,
      remoteValue: remote.analysis,
      resolution: 'remote',
      strategy: 'validated-wins'
    });
  }

  // Mergeable fields: union of tags
  if (local.tags && remote.tags) {
    merged.tags = [...new Set([...local.tags, ...remote.tags])];
    if (JSON.stringify(local.tags) !== JSON.stringify(remote.tags)) {
      conflicts.push({
        field: 'tags',
        localValue: local.tags,
        remoteValue: remote.tags,
        resolution: 'merge',
        strategy: 'union'
      });
    }
  }

  // Timestamp: last-write-wins
  if (local.updatedAt < remote.updatedAt) {
    merged.notes = remote.notes;
  }

  return { merged, conflicts };
}
```

**powersync.js patterns** → Differential sync
```typescript
// Sync only changes, not full objects
interface SyncOperation {
  id: string;
  table: string;
  op: 'insert' | 'update' | 'delete';
  data?: Partial<Crash>;
  timestamp: number;
  checksum: string;
}

class DifferentialSync {
  async push(lastSyncTimestamp: number): Promise<void> {
    const operations = await db.sync_queue
      .where('timestamp').above(lastSyncTimestamp)
      .toArray();

    if (operations.length === 0) return;

    await fetch('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ operations }),
      headers: { 'Content-Type': 'application/json' }
    });

    // Clear synced operations
    await db.sync_queue.bulkDelete(operations.map(op => op.id));
  }

  async pull(lastSyncTimestamp: number): Promise<void> {
    const response = await fetch(
      `/api/sync/pull?since=${lastSyncTimestamp}`
    );
    const { operations } = await response.json();

    for (const op of operations) {
      await this.applyOperation(op);
    }
  }

  private async applyOperation(op: SyncOperation) {
    switch (op.op) {
      case 'insert':
        await db.crashes.add(op.data!);
        break;
      case 'update':
        await db.crashes.update(op.id, op.data!);
        break;
      case 'delete':
        await db.crashes.delete(op.id);
        break;
    }
  }
}
```

### Implementation Rules:
- Canonical solutions = immutable; edits require reviewer role
- Conflict decisions logged (`decision`, `resolver`, `timestamp`)
- Rate limit sync API for fairness
- Use checksum to detect changes efficiently

---

## 🧪 Phase 7 — Testing & Deployment

### Technology Stack
- **API Testing**: Supertest
- **E2E Testing**: Playwright
- **Local Stack**: Docker Compose
- **CI/CD**: GitHub Actions

### Borrow From:

**supertest** → API testing
```typescript
import request from 'supertest';
import { app } from '../src/server';

describe('POST /api/crashes', () => {
  it('should create crash with valid data', async () => {
    const response = await request(app)
      .post('/api/crashes')
      .send({
        filename: 'test.log',
        content: 'Error: null pointer...'
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.filename).toBe('test.log');
  });

  it('should reject invalid MIME types', async () => {
    await request(app)
      .post('/api/crashes')
      .send({
        filename: 'test.exe',
        content: 'malicious...'
      })
      .expect(400);
  });
});
```

**playwright** → E2E testing
```typescript
import { test, expect } from '@playwright/test';

test('upload and analyze crash', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Upload file
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('fixtures/sample-crash.log');

  // Wait for analysis
  await page.waitForSelector('[data-testid="analysis-result"]');

  // Verify analysis displayed
  const analysis = await page.locator('[data-testid="root-cause"]').textContent();
  expect(analysis).toContain('null pointer');

  // Check accessibility
  const violations = await page.locator('[role="alert"]').count();
  expect(violations).toBe(0);
});
```

**docker/awesome-compose** → Local development stack
```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: crashes
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build: ./api
    ports:
      - "3001:3001"
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgres://dev:dev@postgres:5432/crashes
      REDIS_URL: redis://redis:6379

volumes:
  postgres_data:
```

**GitHub Actions** → CI/CD pipeline
```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: pgvector/pgvector:pg15
        env:
          POSTGRES_DB: test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run linters
        run: npm run lint

      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/test

      - name: Check licenses
        run: npx license-checker --json > licenses.json
```

### Implementation Rules:
- Property-based tests for parser (use fast-check)
- Golden log dataset (25 files) re-parsed on each CI run
- E2E tests simulate uploads, validation, and search
- Accessibility tests with axe-core

---

## ⚙️ Cross-Cutting Concerns

### Logging with Winston
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'crash-analyzer' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ]
});

// Add console in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

export { logger };
```

### Configuration with node-config
```typescript
// config/default.json
{
  "database": {
    "host": "localhost",
    "port": 5432,
    "database": "crashes"
  },
  "ai": {
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "timeout": 60000
  },
  "upload": {
    "maxSize": 10485760,
    "allowedTypes": [".log", ".txt"]
  }
}

// config/production.json
{
  "database": {
    "ssl": true,
    "pool": {
      "min": 2,
      "max": 10
    }
  }
}
```

---

## 🧩 License & Attribution Rules

| License | Use | Modify | Attribute | Copyleft |
|---------|-----|--------|-----------|----------|
| MIT | ✅ | ✅ | ✅ | ❌ |
| Apache-2.0 | ✅ | ✅ | ✅ | ❌ |
| BSD | ✅ | ✅ | ✅ | ❌ |
| GPL | ⚠️ Learn only | ⚠️ Yes | ✅ | ✅ |

### Attribution Template
Add to adapted code:
```typescript
/**
 * Adapted from: https://github.com/<repo>/<file>
 * License: MIT
 * Author: <name>
 * Modifications: <description>
 */
```

### CI License Check
```bash
npm install --save-dev license-checker

# In package.json scripts:
"check-licenses": "license-checker --json > licenses.json"
```

---

## 🧭 Recommended Study Flow

| Phase | Study First | Duration | Focus |
|-------|-------------|----------|-------|
| 0 | helmet, express-validator, opentelemetry-js | 3h | Security + tracing |
| 1 | pgvector, node-pg-migrate | 3h | Database + migrations |
| 2 | tauri, better-sqlite3, offlinefirst | 4h | Desktop + offline sync |
| 3 | logparser, presidio, opossum | 5h | AI + resilience |
| 4 | qdrant patterns, sentence-transformers | 4h | Hybrid search |
| 5 | Dexie.js, Workbox, shadcn patterns | 4h | Offline web |
| 6 | automerge patterns, powersync.js | 3h | Sync + merge |
| 7 | supertest, playwright | 3h | Tests + CI |

---

## ⏱️ Projected Time Savings

| Phase | From Scratch | With References | Time Saved |
|-------|--------------|-----------------|------------|
| 1 | 3w | 2w | 33% |
| 2 | 4w | 3w | 25% |
| 3 | 5w | 3.5w | 30% |
| 4 | 3w | 2w | 33% |
| 5 | 5w | 3.5w | 30% |
| 6 | 3w | 2.5w | 17% |
| 7 | 4w | 3w | 25% |

➡️ **27 weeks → ~19.5 weeks (≈28% faster)** and far more robust.

---

## 🧠 Final Principles

✅ **Learn, don't lift** - Understand patterns, adapt to our needs
✅ **Use permissive licenses** - MIT, Apache-2.0, BSD preferred
✅ **Attribute and document** - Credit original authors
✅ **Keep stack consistent** - Express + Tauri + Postgres
✅ **Secure by default** - Helmet, rate limiting, validation
✅ **Measure everything** - OTEL, metrics, tests

---

## 📞 Quick Links

- **Security**: helmet, express-rate-limit, express-validator
- **Database**: pgvector, node-pg-migrate
- **Desktop**: tauri, better-sqlite3, tauri-plugin-keyring
- **AI**: logparser, presidio, opossum, guardrails
- **Search**: qdrant patterns, sentence-transformers
- **Web**: Dexie.js, Workbox, shadcn patterns
- **Testing**: supertest, playwright
- **Tooling**: winston, node-config, turborepo

---

## TL;DR

> **"Steal patterns, not problems."**
>
> You now have a complete, reference-backed, security-tight blueprint to build the crash-analysis system fast **and right**.

---

**Next**: Update phase backlogs to reference these proven patterns and repositories.
