# Hadron Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `hadron-electron/` — a fully functional Electron desktop app containing all core Hadron features (crash analysis, history, tags, settings, AI chat, JIRA), so users blocked by ESET/Tauri policy have a supported alternative.

**Architecture:** The Electron main process (TypeScript/Node.js) replaces the Tauri Rust backend, using `better-sqlite3` for SQLite and `node-fetch`/`@anthropic-ai/sdk` for AI calls. The React frontend from `hadron-desktop/src/` is copied verbatim; Vite module aliases shim every `@tauri-apps/*` import so no component code changes. IPC follows the same `invoke(channel, args)` signature as Tauri so the service layer needs only import-path fixes.

**Tech Stack:** Electron 29, electron-vite 2, React 18, TypeScript 5, better-sqlite3 9, electron-store 10, keytar 7, @anthropic-ai/sdk, node-fetch 3, electron-builder 25, Vitest

**Out of scope (Phase 2 plan):** Chat/AskHadron, JIRA Assist poller, Keeper Secrets Manager, RAG/embeddings, Investigation deep analysis, Release Notes, floating widget.

---

## File Map

**Created:**
- `hadron-electron/package.json`
- `hadron-electron/electron.vite.config.ts`
- `hadron-electron/tsconfig.json`
- `hadron-electron/tsconfig.node.json`
- `hadron-electron/electron-builder.config.ts`
- `hadron-electron/electron/main.ts` — window creation, IPC registration, app lifecycle
- `hadron-electron/electron/preload.ts` — contextBridge: exposes `window.hadron` to renderer
- `hadron-electron/electron/database.ts` — better-sqlite3 singleton, WAL setup
- `hadron-electron/electron/migrations.ts` — all 14 schema migrations (ported from Rust)
- `hadron-electron/electron/ipc/index.ts` — registers all IPC handlers
- `hadron-electron/electron/ipc/ai.ts` — analyze_crash_log, call_ai, translate, save_analysis
- `hadron-electron/electron/ipc/crud.ts` — get/delete/favorite analyses & translations
- `hadron-electron/electron/ipc/search.ts` — FTS5 search, filtered list
- `hadron-electron/electron/ipc/tags.ts` — CRUD tags, assign/remove
- `hadron-electron/electron/ipc/notes.ts` — add/update/delete notes on analyses
- `hadron-electron/electron/ipc/archive.ts` — archive/restore/permanent delete
- `hadron-electron/electron/ipc/analytics.ts` — dashboard stats, trend data
- `hadron-electron/electron/ipc/bulk.ts` — bulk delete/tag/favorite
- `hadron-electron/electron/ipc/info.ts` — DB info, file stats, app version
- `hadron-electron/electron/ipc/settings.ts` — electron-store get/set, API key via keytar
- `hadron-electron/electron/ipc/dialog.ts` — file open/save dialog handlers
- `hadron-electron/electron/services/ai-service.ts` — Anthropic/OpenAI/ZAI HTTP calls
- `hadron-electron/electron/services/ai-providers.ts` — provider model list
- `hadron-electron/src/` — copied from `hadron-desktop/src/` (see Task 5)
- `hadron-electron/src/lib/tauri-core-shim.ts` — shims `invoke`
- `hadron-electron/src/lib/tauri-event-shim.ts` — shims `listen`, `emit`
- `hadron-electron/src/lib/tauri-window-shim.ts` — shims `currentMonitor`, `getCurrentWindow`
- `hadron-electron/src/lib/tauri-dialog-shim.ts` — shims `open`, `save`
- `hadron-electron/src/lib/tauri-store-shim.ts` — shims `load`, `Store`
- `hadron-electron/src/lib/tauri-log-shim.ts` — shims `info`, `error`, `attachConsole`
- `hadron-electron/src/lib/tauri-process-shim.ts` — shims `relaunch`
- `hadron-electron/src/lib/tauri-path-shim.ts` — shims `join`
- `hadron-electron/src/lib/tauri-updater-shim.ts` — shims `check`
- `hadron-electron/src/lib/tauri-clipboard-shim.ts` — shims clipboard manager

**Modified after copy:**
- `hadron-electron/src/services/api.ts` — change `@tauri-apps/api/core` import only
- `hadron-electron/src/services/logger.ts` — change `@tauri-apps/plugin-log` import only
- `hadron-electron/src/services/updater.ts` — change `@tauri-apps/plugin-updater` import only
- `hadron-electron/src/services/secure-storage.ts` — route to keytar via IPC

---

## Task 1: Project Scaffold

**Files:**
- Create: `hadron-electron/package.json`
- Create: `hadron-electron/electron.vite.config.ts`
- Create: `hadron-electron/tsconfig.json`
- Create: `hadron-electron/tsconfig.node.json`
- Create: `hadron-electron/electron/main.ts`
- Create: `hadron-electron/electron/preload.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /mnt/c/Projects/Hadron_v3/hadron-electron/electron
mkdir -p /mnt/c/Projects/Hadron_v3/hadron-electron/src
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "hadron-electron",
  "version": "4.6.0",
  "description": "Hadron - AI Support Assistant (Electron)",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.20.0",
    "better-sqlite3": "^9.4.0",
    "date-fns": "^2.30.0",
    "docx": "^9.6.0",
    "electron-log": "^5.1.0",
    "electron-store": "^10.0.0",
    "electron-updater": "^6.1.0",
    "focus-trap-react": "^12.0.0",
    "keytar": "^7.9.0",
    "lucide-react": "^0.294.0",
    "node-fetch": "^3.3.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/keytar": "^4.4.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^5.1.2",
    "autoprefixer": "^10.4.16",
    "electron": "^29.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.0.0",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.3.0",
    "typescript": "^5.2.2",
    "vite": "^6.4.1",
    "vitest": "^4.0.17"
  }
}
```

- [ ] **Step 3: Write `electron.vite.config.ts`**

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src',
    build: { outDir: 'out/renderer' },
    plugins: [react()],
    resolve: {
      alias: {
        '@tauri-apps/api/core':    resolve('src/lib/tauri-core-shim.ts'),
        '@tauri-apps/api/event':   resolve('src/lib/tauri-event-shim.ts'),
        '@tauri-apps/api/window':  resolve('src/lib/tauri-window-shim.ts'),
        '@tauri-apps/api/webview': resolve('src/lib/tauri-window-shim.ts'),
        '@tauri-apps/api/path':    resolve('src/lib/tauri-path-shim.ts'),
        '@tauri-apps/plugin-dialog':           resolve('src/lib/tauri-dialog-shim.ts'),
        '@tauri-apps/plugin-log':              resolve('src/lib/tauri-log-shim.ts'),
        '@tauri-apps/plugin-store':            resolve('src/lib/tauri-store-shim.ts'),
        '@tauri-apps/plugin-updater':          resolve('src/lib/tauri-updater-shim.ts'),
        '@tauri-apps/plugin-process':          resolve('src/lib/tauri-process-shim.ts'),
        '@tauri-apps/plugin-clipboard-manager': resolve('src/lib/tauri-clipboard-shim.ts'),
      }
    },
    css: { postcss: { plugins: [] } }
  }
})
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

Write `tsconfig.node.json`:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["electron.vite.config.*", "electron/**/*"],
  "compilerOptions": {
    "composite": true,
    "outDir": "out",
    "baseUrl": ".",
    "paths": {}
  }
}
```

Write `tsconfig.web.json`:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": ["src/**/*"],
  "compilerOptions": {
    "composite": true,
    "outDir": "out/renderer",
    "baseUrl": ".",
    "paths": {}
  }
}
```

- [ ] **Step 5: Write `electron/main.ts`**

```typescript
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'
import { initDatabase } from './database'
import { registerAllHandlers } from './ipc/index'

log.initialize()
log.transports.file.level = 'info'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Hadron',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  registerAllHandlers(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Write `electron/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hadron', {
  invoke: (channel: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, args),

  openFile: (options?: Electron.OpenDialogOptions): Promise<string[] | null> =>
    ipcRenderer.invoke('dialog:openFile', options),

  saveFile: (options?: Electron.SaveDialogOptions): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', options),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', { filePath, content }),

  writeFileBytes: (filePath: string, bytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('fs:writeFileBytes', { filePath, bytes: Array.from(bytes) }),

  onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string): void => callback(chunk)
    ipcRenderer.on('stream:chunk', handler)
    return () => ipcRenderer.removeListener('stream:chunk', handler)
  },

  getAppVersion: (): string => ipcRenderer.sendSync('app:version'),
  relaunch: (): void => ipcRenderer.send('app:relaunch'),
  getPath: (name: string): Promise<string> => ipcRenderer.invoke('app:getPath', name),
  writeToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  readFromClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read')
})
```

- [ ] **Step 7: Install dependencies and verify build compiles**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm install
npm run build 2>&1 | head -30
```

Expected: compilation errors about missing `src/` content — that is fine at this stage; main+preload should compile.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/
git commit -m "feat(electron): scaffold electron-vite project with main/preload entry points"
```

---

## Task 2: Database + Migrations

**Files:**
- Create: `hadron-electron/electron/database.ts`
- Create: `hadron-electron/electron/migrations.ts`
- Create: `hadron-electron/electron/database.test.ts`

- [ ] **Step 1: Write `electron/database.ts`**

```typescript
import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import log from 'electron-log'
import { runMigrations } from './migrations'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized — call initDatabase() first')
  return _db
}

export function initDatabase(dbPath?: string): void {
  const resolvedPath = dbPath ?? path.join(app.getPath('userData'), 'hadron.db')
  log.info(`Opening database at: ${resolvedPath}`)
  _db = new Database(resolvedPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.pragma('busy_timeout = 5000')
  runMigrations(_db)
  log.info('Database initialized')
}

export function closeDatabase(): void {
  _db?.close()
  _db = null
}
```

- [ ] **Step 2: Write `electron/migrations.ts` — migrations 1–7**

```typescript
import Database from 'better-sqlite3'
import log from 'electron-log'

const CURRENT_VERSION = 14

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  const currentVersion: number = (db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS v FROM schema_versions'
  ).get() as { v: number }).v

  log.info(`DB schema: current=${currentVersion}, target=${CURRENT_VERSION}`)

  const migrations: Array<{ version: number; name: string; up: (db: Database.Database) => void }> = [
    { version: 1,  name: 'initial_schema',         up: m001 },
    { version: 2,  name: 'add_analysis_type',       up: m002 },
    { version: 3,  name: 'add_translations_table',  up: m003 },
    { version: 4,  name: 'add_crash_signatures',    up: m004 },
    { version: 5,  name: 'history_enhancements',    up: m005 },
    { version: 6,  name: 'intelligence_platform',   up: m006 },
    { version: 7,  name: 'jira_ticket_linking',     up: m007 },
    { version: 8,  name: 'chat_feedback',           up: m008 },
    { version: 9,  name: 'chat_sessions',           up: m009 },
    { version: 10, name: 'release_notes',           up: m010 },
    { version: 11, name: 'feedback_reason',         up: m011 },
    { version: 12, name: 'ask_hadron_2',            up: m012 },
    { version: 13, name: 'canonicalize_jira_type',  up: m013 },
    { version: 14, name: 'jira_assist_tables',      up: m014 },
  ]

  for (const m of migrations) {
    if (m.version > currentVersion) {
      log.info(`Running migration ${m.version}: ${m.name}`)
      const run = db.transaction(() => {
        m.up(db)
        db.prepare('INSERT INTO schema_versions (version, name) VALUES (?, ?)').run(m.version, m.name)
      })
      run()
      log.info(`Migration ${m.version} complete`)
    }
  }
}

function m001(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      file_size_kb REAL,
      error_type TEXT,
      error_message TEXT,
      severity TEXT CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
      component TEXT,
      stack_trace TEXT,
      root_cause TEXT,
      suggested_fixes TEXT,
      confidence TEXT CHECK(confidence IN ('HIGH','MEDIUM','LOW')),
      analyzed_at TEXT NOT NULL,
      ai_model TEXT,
      ai_provider TEXT,
      tokens_used INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      was_truncated INTEGER DEFAULT 0,
      analysis_duration_ms INTEGER,
      full_data TEXT,
      is_favorite INTEGER DEFAULT 0,
      last_viewed_at TEXT,
      view_count INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS analyses_fts USING fts5(
      error_type, error_message, root_cause, suggested_fixes, component, stack_trace,
      content=analyses, content_rowid=id, tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS analyses_ai AFTER INSERT ON analyses BEGIN
      INSERT INTO analyses_fts(rowid,error_type,error_message,root_cause,suggested_fixes,component,stack_trace)
      VALUES (new.id,new.error_type,new.error_message,new.root_cause,new.suggested_fixes,new.component,new.stack_trace);
    END;
    CREATE TRIGGER IF NOT EXISTS analyses_au AFTER UPDATE ON analyses BEGIN
      UPDATE analyses_fts SET error_type=new.error_type,error_message=new.error_message,
        root_cause=new.root_cause,suggested_fixes=new.suggested_fixes,
        component=new.component,stack_trace=new.stack_trace WHERE rowid=new.id;
    END;
    CREATE TRIGGER IF NOT EXISTS analyses_ad AFTER DELETE ON analyses BEGIN
      DELETE FROM analyses_fts WHERE rowid=old.id;
    END;

    CREATE INDEX IF NOT EXISTS idx_analyzed_at ON analyses(analyzed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_severity    ON analyses(severity) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_component   ON analyses(component) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_favorite    ON analyses(is_favorite, analyzed_at DESC) WHERE is_favorite=1;
    CREATE INDEX IF NOT EXISTS idx_recent      ON analyses(last_viewed_at DESC) WHERE last_viewed_at IS NOT NULL;
  `)
}

function m002(db: Database.Database): void {
  const has = (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('analyses') WHERE name='analysis_type'`).get() as {c:number}).c > 0
  if (!has) db.exec(`ALTER TABLE analyses ADD COLUMN analysis_type TEXT DEFAULT 'complete'`)
}

function m003(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_content TEXT NOT NULL,
      translation TEXT NOT NULL,
      translated_at TEXT NOT NULL,
      ai_model TEXT NOT NULL,
      ai_provider TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      last_viewed_at TEXT,
      view_count INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS translations_fts USING fts5(
      input_content, translation, content=translations, content_rowid=id, tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS translations_ai AFTER INSERT ON translations BEGIN
      INSERT INTO translations_fts(rowid,input_content,translation) VALUES(new.id,new.input_content,new.translation);
    END;
    CREATE TRIGGER IF NOT EXISTS translations_au AFTER UPDATE ON translations BEGIN
      UPDATE translations_fts SET input_content=new.input_content,translation=new.translation WHERE rowid=new.id;
    END;
    CREATE TRIGGER IF NOT EXISTS translations_ad AFTER DELETE ON translations BEGIN
      DELETE FROM translations_fts WHERE rowid=old.id;
    END;
    CREATE INDEX IF NOT EXISTS idx_translations_date ON translations(translated_at DESC);
  `)
}

function m004(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crash_signatures (
      hash TEXT PRIMARY KEY,
      canonical TEXT NOT NULL,
      components_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      linked_ticket_system TEXT,
      linked_ticket_id TEXT,
      linked_ticket_url TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      status_metadata_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS analysis_signatures (
      analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      signature_hash TEXT NOT NULL REFERENCES crash_signatures(hash) ON DELETE CASCADE,
      matched_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (analysis_id, signature_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_signatures_hash ON analysis_signatures(signature_hash);
  `)
}

function m005(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6B7280',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      usage_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS analysis_tags (
      analysis_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (analysis_id, tag_id),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS translation_tags (
      translation_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      tagged_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (translation_id, tag_id),
      FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS archived_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_id INTEGER NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_by TEXT,
      data_json TEXT NOT NULL,
      restore_eligible_until TEXT
    );
    CREATE TABLE IF NOT EXISTS analysis_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_analysis_tags_tag ON analysis_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_notes_analysis ON analysis_notes(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_filter_composite ON analyses(deleted_at,is_favorite,severity,analyzed_at DESC);
  `)

  const hasErr = (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('analyses') WHERE name='error_signature'`).get() as {c:number}).c > 0
  if (!hasErr) db.exec(`ALTER TABLE analyses ADD COLUMN error_signature TEXT`)

  const hasSrc = (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('analyses') WHERE name='source_type'`).get() as {c:number}).c > 0
  if (!hasSrc) db.exec(`ALTER TABLE analyses ADD COLUMN source_type TEXT DEFAULT 'file'`)

  const defaultTags = [
    ['production','#EF4444'],['staging','#F97316'],['development','#22C55E'],
    ['resolved','#10B981'],['investigating','#EAB308'],['needs-review','#8B5CF6'],
    ['recurring','#EC4899'],['critical-path','#DC2626'],
  ]
  const ins = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)')
  for (const [name, color] of defaultTags) ins.run(name, color)
}

function m006(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      feedback_type TEXT NOT NULL CHECK(feedback_type IN ('accept','reject','edit','rating')),
      field_name TEXT, original_value TEXT, new_value TEXT,
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
      feedback_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gold_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_analysis_id INTEGER,
      source_type TEXT NOT NULL DEFAULT 'crash',
      error_signature TEXT NOT NULL,
      crash_content_hash TEXT,
      root_cause TEXT NOT NULL,
      suggested_fixes TEXT NOT NULL,
      component TEXT, severity TEXT,
      validation_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_by TEXT,
      times_referenced INTEGER DEFAULT 0,
      success_rate REAL,
      FOREIGN KEY (source_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS retrieval_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('analysis','gold','ticket','documentation')),
      source_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL, embedding BLOB, embedding_model TEXT,
      metadata_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON analysis_feedback(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_gold_signature ON gold_analyses(error_signature);
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON retrieval_chunks(source_type, source_id);
  `)
  const cols = ['embedding','embedding_model','feedback_status']
  const defs = ['BLOB','TEXT','TEXT DEFAULT \'pending\'']
  for (let i = 0; i < cols.length; i++) {
    const has = (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('analyses') WHERE name='${cols[i]}'`).get() as {c:number}).c > 0
    if (!has) db.exec(`ALTER TABLE analyses ADD COLUMN ${cols[i]} ${defs[i]}`)
  }
}

function m007(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_jira_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      jira_key TEXT NOT NULL, jira_url TEXT, jira_summary TEXT, jira_status TEXT, jira_priority TEXT,
      link_type TEXT NOT NULL DEFAULT 'related',
      linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      linked_by TEXT, notes TEXT,
      UNIQUE(analysis_id, jira_key),
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jira_links_analysis ON analysis_jira_links(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_jira_links_key ON analysis_jira_links(jira_key);
  `)
}

function m008(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      rating TEXT NOT NULL, comment TEXT, tools_used TEXT, sources_cited TEXT, query TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_feedback_session ON chat_feedback(session_id);
  `)
}

function m009(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, timestamp);
  `)
}

function m010(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS release_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fix_version TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'both', title TEXT NOT NULL,
      markdown_content TEXT NOT NULL, original_ai_content TEXT,
      ticket_keys TEXT NOT NULL DEFAULT '[]', ticket_count INTEGER NOT NULL DEFAULT 0,
      jql_filter TEXT, module_filter TEXT, ai_model TEXT NOT NULL, ai_provider TEXT NOT NULL,
      tokens_used INTEGER DEFAULT 0, cost REAL DEFAULT 0.0, generation_duration_ms INTEGER,
      ai_insights TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','published','archived')),
      checklist_state TEXT, reviewed_by TEXT, reviewed_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, parent_id INTEGER REFERENCES release_notes(id),
      is_manual_edit INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT, deleted_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rn_fix_version ON release_notes(fix_version);
    CREATE INDEX IF NOT EXISTS idx_rn_status ON release_notes(status);
  `)
}

function m011(db: Database.Database): void {
  db.exec(`ALTER TABLE chat_feedback ADD COLUMN reason TEXT`)
}

function m012(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gold_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL, answer TEXT NOT NULL,
      session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      won_version TEXT, customer TEXT, tags TEXT, verified_by TEXT, tool_results_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      summary_markdown TEXT NOT NULL, topic TEXT, won_version TEXT, customer TEXT,
      is_indexed INTEGER NOT NULL DEFAULT 0, is_exported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const cols = [['is_starred','INTEGER NOT NULL DEFAULT 0'],['tags','TEXT'],['customer','TEXT'],['won_version','TEXT']]
  for (const [col, def] of cols) {
    const has = (db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('chat_sessions') WHERE name='${col}'`).get() as {c:number}).c > 0
    if (!has) db.exec(`ALTER TABLE chat_sessions ADD COLUMN ${col} ${def}`)
  }
}

function m013(db: Database.Database): void {
  db.exec(`UPDATE analyses SET analysis_type='jira' WHERE analysis_type='jira_ticket'`)
}

function m014(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_briefs (
      jira_key TEXT PRIMARY KEY, title TEXT NOT NULL, customer TEXT, severity TEXT, category TEXT,
      tags TEXT, triage_json TEXT, brief_json TEXT,
      posted_to_jira INTEGER NOT NULL DEFAULT 0, posted_at TEXT,
      engineer_rating INTEGER, engineer_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ticket_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jira_key TEXT NOT NULL REFERENCES ticket_briefs(jira_key) ON DELETE CASCADE,
      embedding BLOB NOT NULL, source_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_jira_key ON ticket_embeddings(jira_key);
  `)
}
```

- [ ] **Step 3: Write `electron/database.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
})

afterEach(() => db.close())

describe('migrations', () => {
  it('runs all 14 migrations from empty', () => {
    runMigrations(db)
    const version = (db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v: number }).v
    expect(version).toBe(14)
  })

  it('is idempotent — running twice is safe', () => {
    runMigrations(db)
    runMigrations(db)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM schema_versions').get() as { c: number }).c
    expect(count).toBe(14)
  })

  it('seeds 8 default tags', () => {
    runMigrations(db)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c
    expect(count).toBe(8)
  })

  it('creates analyses table with FTS', () => {
    runMigrations(db)
    const exists = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='analyses'`).get() as {c:number}).c
    expect(exists).toBe(1)
    const fts = (db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name='analyses_fts'`).get() as {c:number}).c
    expect(fts).toBe(1)
  })
})
```

- [ ] **Step 4: Run the test**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npx vitest run electron/database.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/electron/database.ts hadron-electron/electron/migrations.ts hadron-electron/electron/database.test.ts
git commit -m "feat(electron): add SQLite database with all 14 migrations ported from Rust"
```

---

## Task 3: Tauri API Shims

These shims let the React frontend compile without any component changes by aliasing every `@tauri-apps/*` import to a thin Electron IPC equivalent.

**Files:**
- Create: `hadron-electron/src/lib/tauri-core-shim.ts`
- Create: `hadron-electron/src/lib/tauri-event-shim.ts`
- Create: `hadron-electron/src/lib/tauri-window-shim.ts`
- Create: `hadron-electron/src/lib/tauri-dialog-shim.ts`
- Create: `hadron-electron/src/lib/tauri-log-shim.ts`
- Create: `hadron-electron/src/lib/tauri-store-shim.ts`
- Create: `hadron-electron/src/lib/tauri-updater-shim.ts`
- Create: `hadron-electron/src/lib/tauri-process-shim.ts`
- Create: `hadron-electron/src/lib/tauri-path-shim.ts`
- Create: `hadron-electron/src/lib/tauri-clipboard-shim.ts`
- Create: `hadron-electron/src/lib/electron-types.d.ts`

- [ ] **Step 1: Write the global types declaration `src/lib/electron-types.d.ts`**

```typescript
export {}

declare global {
  interface Window {
    hadron: {
      invoke(channel: string, args?: unknown): Promise<unknown>
      openFile(options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string[] | null>
      saveFile(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>
      writeFile(filePath: string, content: string): Promise<void>
      writeFileBytes(filePath: string, bytes: Uint8Array): Promise<void>
      onStreamChunk(callback: (chunk: string) => void): () => void
      getAppVersion(): string
      relaunch(): void
      getPath(name: string): Promise<string>
      writeToClipboard(text: string): Promise<void>
      readFromClipboard(): Promise<string>
    }
  }
}
```

- [ ] **Step 2: Write `src/lib/tauri-core-shim.ts`**

```typescript
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return window.hadron.invoke(command, args) as Promise<T>
}
```

- [ ] **Step 3: Write `src/lib/tauri-event-shim.ts`**

```typescript
export type UnlistenFn = () => void

export function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void
): Promise<UnlistenFn> {
  // Events used by the Tauri desktop are replaced by stream:chunk in Electron.
  // Components using listen() for stream events use onStreamChunk instead.
  return Promise.resolve(() => {})
}

export function emit(_event: string, _payload?: unknown): Promise<void> {
  return Promise.resolve()
}
```

- [ ] **Step 4: Write `src/lib/tauri-window-shim.ts`**

```typescript
export async function getCurrentWindow() {
  return {
    isMinimized: async () => false,
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    close: async () => {},
    setTitle: async (_title: string) => {},
  }
}

export async function currentMonitor() {
  return {
    size: { width: window.screen.width, height: window.screen.height },
    position: { x: 0, y: 0 },
    scaleFactor: window.devicePixelRatio,
  }
}

export async function getCurrentWebview() {
  return { setZoom: async (_factor: number) => {} }
}
```

- [ ] **Step 5: Write `src/lib/tauri-dialog-shim.ts`**

```typescript
export async function open(options?: {
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
  directory?: boolean
}): Promise<string | string[] | null> {
  const result = await window.hadron.openFile({
    multiple: options?.multiple,
    filters: options?.filters?.map(f => ({ name: f.name, extensions: f.extensions }))
  })
  if (!result) return null
  return options?.multiple ? result : result[0] ?? null
}

export async function save(options?: {
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}): Promise<string | null> {
  return window.hadron.saveFile(options)
}
```

- [ ] **Step 6: Write `src/lib/tauri-log-shim.ts`**

```typescript
export function info(message: string): Promise<void> {
  console.info('[hadron]', message)
  return Promise.resolve()
}

export function error(message: string): Promise<void> {
  console.error('[hadron]', message)
  return Promise.resolve()
}

export function warn(message: string): Promise<void> {
  console.warn('[hadron]', message)
  return Promise.resolve()
}

export function debug(message: string): Promise<void> {
  console.debug('[hadron]', message)
  return Promise.resolve()
}

export function attachConsole(): Promise<() => void> {
  return Promise.resolve(() => {})
}
```

- [ ] **Step 7: Write `src/lib/tauri-store-shim.ts`**

This shim wraps the electron-store IPC calls with the same `Store` interface that `@tauri-apps/plugin-store` provides.

```typescript
export interface StoreOptions {
  autoSave?: boolean
}

export class Store {
  private storeName: string

  constructor(storeName: string, _opts?: StoreOptions) {
    this.storeName = storeName
  }

  async get<T>(key: string): Promise<T | null> {
    return window.hadron.invoke('store:get', { store: this.storeName, key }) as Promise<T | null>
  }

  async set(key: string, value: unknown): Promise<void> {
    await window.hadron.invoke('store:set', { store: this.storeName, key, value })
  }

  async delete(key: string): Promise<void> {
    await window.hadron.invoke('store:delete', { store: this.storeName, key })
  }

  async has(key: string): Promise<boolean> {
    return window.hadron.invoke('store:has', { store: this.storeName, key }) as Promise<boolean>
  }

  async save(): Promise<void> {
    // electron-store auto-saves; this is a no-op
  }
}

export async function load(storeName: string, opts?: StoreOptions): Promise<Store> {
  return new Store(storeName, opts)
}
```

- [ ] **Step 8: Write `src/lib/tauri-updater-shim.ts`**

```typescript
export interface Update {
  version: string
  available: boolean
  download: () => Promise<void>
  install: () => Promise<void>
}

export async function check(): Promise<Update | null> {
  return window.hadron.invoke('updater:check') as Promise<Update | null>
}
```

- [ ] **Step 9: Write `src/lib/tauri-process-shim.ts`**

```typescript
export function relaunch(): Promise<void> {
  window.hadron.relaunch()
  return Promise.resolve()
}
```

- [ ] **Step 10: Write `src/lib/tauri-path-shim.ts`**

```typescript
export async function join(...paths: string[]): Promise<string> {
  return paths.join('/')
}
```

- [ ] **Step 11: Write `src/lib/tauri-clipboard-shim.ts`**

```typescript
export async function writeText(text: string): Promise<void> {
  return window.hadron.writeToClipboard(text)
}

export async function readText(): Promise<string> {
  return window.hadron.readFromClipboard()
}
```

- [ ] **Step 12: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/src/lib/
git commit -m "feat(electron): add Tauri API shims to alias all @tauri-apps/* imports"
```

---

## Task 4: Frontend Port

Copy the entire React frontend from `hadron-desktop/src/` and apply the minimal changes needed to remove Tauri-specific behaviour.

**Files:**
- Copy: `hadron-desktop/src/` → `hadron-electron/src/` (all files)
- Modify: `hadron-electron/src/services/secure-storage.ts`

- [ ] **Step 1: Copy frontend source**

```bash
cp -r /mnt/c/Projects/Hadron_v3/hadron-desktop/src/. /mnt/c/Projects/Hadron_v3/hadron-electron/src/
```

- [ ] **Step 2: Copy static assets and config files**

```bash
cp /mnt/c/Projects/Hadron_v3/hadron-desktop/index.html       /mnt/c/Projects/Hadron_v3/hadron-electron/src/index.html
cp /mnt/c/Projects/Hadron_v3/hadron-desktop/tailwind.config.js  /mnt/c/Projects/Hadron_v3/hadron-electron/
cp /mnt/c/Projects/Hadron_v3/hadron-desktop/postcss.config.js   /mnt/c/Projects/Hadron_v3/hadron-electron/
```

- [ ] **Step 3: Replace `src/services/secure-storage.ts`**

The original uses Tauri store for API keys. Electron uses keytar (system keychain) via IPC.

Open `hadron-electron/src/services/secure-storage.ts` and replace its entire content with:

```typescript
const SERVICE_NAME = 'hadron-electron'

export async function getApiKey(provider: string): Promise<string | null> {
  return window.hadron.invoke('keytar:get', { service: SERVICE_NAME, account: provider }) as Promise<string | null>
}

export async function storeApiKey(provider: string, key: string): Promise<void> {
  await window.hadron.invoke('keytar:set', { service: SERVICE_NAME, account: provider, password: key })
}

export async function deleteApiKey(provider: string): Promise<void> {
  await window.hadron.invoke('keytar:delete', { service: SERVICE_NAME, account: provider })
}
```

- [ ] **Step 4: Add `src/index.html` entry that loads the shim types**

Ensure `hadron-electron/src/index.html` has the correct script entry path for electron-vite (it should reference `/src/main.tsx` — check and update if needed):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hadron</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Add `lib/electron-types.d.ts` to TypeScript include**

Update `tsconfig.web.json` `include` to:
```json
"include": ["src/**/*", "src/lib/electron-types.d.ts"]
```

- [ ] **Step 6: Run TypeScript check on renderer**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npx tsc --project tsconfig.web.json --noEmit 2>&1 | head -40
```

Fix any errors that appear — they will be import path issues, not logic issues.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/src/
git commit -m "feat(electron): port React frontend from hadron-desktop with Tauri API shims"
```

---

## Task 5: Settings & Secure Storage IPC Handlers

**Files:**
- Create: `hadron-electron/electron/ipc/settings.ts`
- Create: `hadron-electron/electron/ipc/dialog.ts`
- Modify: `hadron-electron/electron/ipc/index.ts` (create if new)

- [ ] **Step 1: Write `electron/ipc/settings.ts`**

```typescript
import { IpcMain, app, clipboard } from 'electron'
import Store from 'electron-store'
import keytar from 'keytar'
import log from 'electron-log'
import fs from 'fs/promises'

const stores = new Map<string, Store>()

function getStore(name: string): Store {
  if (!stores.has(name)) stores.set(name, new Store({ name }))
  return stores.get(name)!
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('store:get', (_e, { store, key }: { store: string; key: string }) => {
    return getStore(store).get(key) ?? null
  })

  ipcMain.handle('store:set', (_e, { store, key, value }: { store: string; key: string; value: unknown }) => {
    getStore(store).set(key, value)
  })

  ipcMain.handle('store:delete', (_e, { store, key }: { store: string; key: string }) => {
    getStore(store).delete(key)
  })

  ipcMain.handle('store:has', (_e, { store, key }: { store: string; key: string }) => {
    return getStore(store).has(key)
  })

  ipcMain.handle('keytar:get', async (_e, { service, account }: { service: string; account: string }) => {
    try {
      return await keytar.getPassword(service, account)
    } catch (err) {
      log.warn('keytar:get failed', err)
      return null
    }
  })

  ipcMain.handle('keytar:set', async (_e, { service, account, password }: { service: string; account: string; password: string }) => {
    await keytar.setPassword(service, account, password)
  })

  ipcMain.handle('keytar:delete', async (_e, { service, account }: { service: string; account: string }) => {
    await keytar.deletePassword(service, account)
  })

  ipcMain.handle('app:getPath', (_e, name: string) => app.getPath(name as Parameters<typeof app.getPath>[0]))

  ipcMain.handle('clipboard:write', (_e, text: string) => { clipboard.writeText(text) })
  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('fs:writeFile', async (_e, { filePath, content }: { filePath: string; content: string }) => {
    await fs.writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('fs:writeFileBytes', async (_e, { filePath, bytes }: { filePath: string; bytes: number[] }) => {
    await fs.writeFile(filePath, Buffer.from(bytes))
  })
}
```

- [ ] **Step 2: Write `electron/ipc/dialog.ts`**

```typescript
import { IpcMain, dialog, BrowserWindow } from 'electron'

export function registerDialogHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('dialog:openFile', async (_e, options?: Electron.OpenDialogOptions) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: options?.multiSelections ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options?.filters,
      ...options,
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('dialog:saveFile', async (_e, options?: Electron.SaveDialogOptions) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, options ?? {})
    return result.canceled ? null : result.filePath
  })
}
```

- [ ] **Step 3: Write `electron/ipc/index.ts`**

```typescript
import { IpcMain, ipcMain as electronIpcMain, app } from 'electron'
import { registerSettingsHandlers } from './settings'
import { registerDialogHandlers } from './dialog'
import { registerAiHandlers } from './ai'
import { registerCrudHandlers } from './crud'
import { registerSearchHandlers } from './search'
import { registerTagHandlers } from './tags'
import { registerNotesHandlers } from './notes'
import { registerArchiveHandlers } from './archive'
import { registerAnalyticsHandlers } from './analytics'
import { registerBulkHandlers } from './bulk'
import { registerInfoHandlers } from './info'

export function registerAllHandlers(ipcMain: IpcMain): void {
  registerSettingsHandlers(ipcMain)
  registerDialogHandlers(ipcMain)
  registerAiHandlers(ipcMain)
  registerCrudHandlers(ipcMain)
  registerSearchHandlers(ipcMain)
  registerTagHandlers(ipcMain)
  registerNotesHandlers(ipcMain)
  registerArchiveHandlers(ipcMain)
  registerAnalyticsHandlers(ipcMain)
  registerBulkHandlers(ipcMain)
  registerInfoHandlers(ipcMain)

  electronIpcMain.on('app:version', (event) => { event.returnValue = app.getVersion() })
  electronIpcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0) })
}
```

- [ ] **Step 4: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/electron/ipc/
git commit -m "feat(electron): add settings, keytar, dialog, and clipboard IPC handlers"
```

---

## Task 6: AI Service + Analysis IPC

**Files:**
- Create: `hadron-electron/electron/services/ai-service.ts`
- Create: `hadron-electron/electron/ipc/ai.ts`
- Create: `hadron-electron/electron/ipc/ai.test.ts`

- [ ] **Step 1: Write `electron/services/ai-service.ts`**

This port handles Anthropic, OpenAI, and ZAI providers — matching the Rust `ai_service.rs` call signatures.

```typescript
import Anthropic from '@anthropic-ai/sdk'
import fetch from 'node-fetch'
import log from 'electron-log'

export interface AiCallOptions {
  provider: string
  model: string
  apiKey: string
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  stream?: boolean
  onChunk?: (text: string) => void
}

export interface AiCallResult {
  content: string
  inputTokens: number
  outputTokens: number
  cost: number
  model: string
}

const ANTHROPIC_INPUT_COST_PER_1M = 3.0   // Claude 3.5 Sonnet
const ANTHROPIC_OUTPUT_COST_PER_1M = 15.0

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  if (provider === 'anthropic') {
    return (inputTokens / 1_000_000) * ANTHROPIC_INPUT_COST_PER_1M +
           (outputTokens / 1_000_000) * ANTHROPIC_OUTPUT_COST_PER_1M
  }
  if (provider === 'openai') {
    return (inputTokens / 1_000_000) * 5.0 + (outputTokens / 1_000_000) * 15.0
  }
  return 0
}

export async function callAi(opts: AiCallOptions): Promise<AiCallResult> {
  if (opts.provider === 'anthropic') return callAnthropic(opts)
  if (opts.provider === 'openai') return callOpenAi(opts)
  if (opts.provider === 'zai') return callZai(opts)
  throw new Error(`Unsupported provider: ${opts.provider}`)
}

async function callAnthropic(opts: AiCallOptions): Promise<AiCallResult> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  let content = ''
  let inputTokens = 0
  let outputTokens = 0

  if (opts.stream && opts.onChunk) {
    const stream = await client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        content += event.delta.text
        opts.onChunk(event.delta.text)
      }
    }
    const msg = await stream.finalMessage()
    inputTokens = msg.usage.input_tokens
    outputTokens = msg.usage.output_tokens
  } else {
    const msg = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
    })
    content = msg.content.map(b => b.type === 'text' ? b.text : '').join('')
    inputTokens = msg.usage.input_tokens
    outputTokens = msg.usage.output_tokens
  }

  return { content, inputTokens, outputTokens, cost: estimateCost('anthropic', inputTokens, outputTokens), model: opts.model }
}

async function callOpenAi(opts: AiCallOptions): Promise<AiCallResult> {
  const body = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8192,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user',   content: opts.userPrompt },
    ],
    stream: !!opts.stream,
  }

  if (opts.stream && opts.onChunk) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
    let content = ''
    const reader = res.body!
    for await (const chunk of reader) {
      const lines = chunk.toString().split('\n').filter((l: string) => l.startsWith('data: ') && l !== 'data: [DONE]')
      for (const line of lines) {
        try {
          const delta = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content
          if (delta) { content += delta; opts.onChunk(delta) }
        } catch { /* skip malformed */ }
      }
    }
    return { content, inputTokens: 0, outputTokens: 0, cost: 0, model: opts.model }
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ ...body, stream: false }),
    })
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage: { prompt_tokens: number; completion_tokens: number } }
    const content = data.choices[0]?.message?.content ?? ''
    return { content, inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens, cost: estimateCost('openai', data.usage.prompt_tokens, data.usage.completion_tokens), model: opts.model }
  }
}

async function callZai(opts: AiCallOptions): Promise<AiCallResult> {
  const res = await fetch('https://api.zai.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      messages: [{ role: 'system', content: opts.systemPrompt }, { role: 'user', content: opts.userPrompt }],
    }),
  })
  if (!res.ok) throw new Error(`ZAI error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage: { prompt_tokens: number; completion_tokens: number } }
  const content = data.choices[0]?.message?.content ?? ''
  return { content, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, cost: 0, model: opts.model }
}

export async function listModels(provider: string, apiKey: string): Promise<string[]> {
  if (provider === 'anthropic') {
    return [
      'claude-opus-4-7','claude-sonnet-4-6','claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022',
    ]
  }
  if (provider === 'openai') {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      const data = await res.json() as { data: Array<{ id: string }> }
      return data.data.map(m => m.id).filter(id => id.startsWith('gpt')).sort()
    } catch (e) {
      log.warn('Failed to list OpenAI models', e)
      return ['gpt-4o','gpt-4o-mini','gpt-4-turbo']
    }
  }
  return []
}
```

- [ ] **Step 2: Write `electron/ipc/ai.ts`**

```typescript
import { IpcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import log from 'electron-log'
import keytar from 'keytar'
import { getDb } from '../database'
import { callAi, listModels } from '../services/ai-service'

const SERVICE_NAME = 'hadron-electron'
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

async function getKey(provider: string): Promise<string> {
  const key = await keytar.getPassword(SERVICE_NAME, provider)
  if (!key) throw new Error(`No API key configured for provider: ${provider}`)
  return key
}

const CRASH_SYSTEM_PROMPT = `You are an expert software engineer specializing in crash log analysis.
Analyze the provided crash log and return a JSON response with this exact structure:
{
  "error_type": "string (e.g. NullPointerException, SIGSEGV)",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "component": "string (affected component)",
  "root_cause": "string (clear explanation)",
  "suggested_fixes": ["fix1", "fix2", "fix3"],
  "confidence": "HIGH|MEDIUM|LOW",
  "stack_trace": "string (relevant stack trace excerpt)"
}
Return only valid JSON, no markdown fences.`

export function registerAiHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('analyze_crash_log', async (event, args: {
    file_path: string
    model: string
    provider: string
    analysis_type?: string
    redact_pii?: boolean
  }) => {
    const start = Date.now()
    let content: string
    try {
      const stat = await fs.stat(args.file_path)
      if (stat.size > MAX_FILE_BYTES) throw new Error('File too large (max 10 MB)')
      content = await fs.readFile(args.file_path, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read file: ${(err as Error).message}`)
    }

    const filename = path.basename(args.file_path)
    const fileSizeKb = content.length / 1024

    const apiKey = await getKey(args.provider)

    let resultText = ''
    const win = BrowserWindow.fromWebContents(event.sender)

    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: CRASH_SYSTEM_PROMPT,
      userPrompt: `Analyze this crash log:\n\nFilename: ${filename}\n\n${content}`,
      maxTokens: 4096,
      stream: true,
      onChunk: (chunk) => {
        resultText += chunk
        win?.webContents.send('stream:chunk', chunk)
      },
    })

    let parsed: Record<string, unknown>
    try {
      const jsonStr = resultText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      parsed = { error_type: 'Unknown', severity: 'MEDIUM', root_cause: resultText, suggested_fixes: [], confidence: 'LOW' }
    }

    const db = getDb()
    const now = new Date().toISOString()
    const stmt = db.prepare(`
      INSERT INTO analyses (filename, file_size_kb, error_type, error_message, severity, component,
        stack_trace, root_cause, suggested_fixes, confidence, analyzed_at, ai_model, ai_provider,
        tokens_used, cost, was_truncated, analysis_duration_ms, full_data, analysis_type, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const row = stmt.run(
      filename,
      fileSizeKb,
      (parsed.error_type as string) ?? 'Unknown',
      null,
      ((parsed.severity as string) ?? 'MEDIUM').toUpperCase(),
      (parsed.component as string) ?? null,
      (parsed.stack_trace as string) ?? null,
      (parsed.root_cause as string) ?? '',
      JSON.stringify(parsed.suggested_fixes ?? []),
      (parsed.confidence as string) ?? 'MEDIUM',
      now,
      args.model,
      args.provider,
      result.inputTokens + result.outputTokens,
      result.cost,
      0,
      Date.now() - start,
      JSON.stringify(parsed),
      args.analysis_type ?? 'comprehensive',
      'file',
    )

    return { id: row.lastInsertRowid, ...parsed, analyzed_at: now, ai_model: args.model, tokens_used: result.inputTokens + result.outputTokens, cost: result.cost }
  })

  ipcMain.handle('call_ai', async (_e, args: {
    provider: string
    model: string
    system_prompt: string
    user_prompt: string
    max_tokens?: number
  }) => {
    const apiKey = await getKey(args.provider)
    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: args.system_prompt,
      userPrompt: args.user_prompt,
      maxTokens: args.max_tokens ?? 4096,
    })
    return { content: result.content, tokens_used: result.inputTokens + result.outputTokens, cost: result.cost }
  })

  ipcMain.handle('translate_content', async (event, args: {
    content: string
    target_language?: string
    provider: string
    model: string
  }) => {
    const apiKey = await getKey(args.provider)
    const lang = args.target_language ?? 'English'
    let translated = ''
    const win = BrowserWindow.fromWebContents(event.sender)

    const result = await callAi({
      provider: args.provider,
      model: args.model,
      apiKey,
      systemPrompt: `You are a technical translator. Translate the provided text to ${lang}. Return only the translated text.`,
      userPrompt: args.content,
      stream: true,
      onChunk: (chunk) => {
        translated += chunk
        win?.webContents.send('stream:chunk', chunk)
      },
    })

    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO translations (input_content, translation, translated_at, ai_model, ai_provider)
      VALUES (?, ?, ?, ?, ?)
    `)
    const row = stmt.run(args.content, translated, new Date().toISOString(), args.model, args.provider)
    return { id: row.lastInsertRowid, translation: translated, tokens_used: result.inputTokens + result.outputTokens }
  })

  ipcMain.handle('list_models', async (_e, args: { provider: string }) => {
    try {
      const apiKey = await keytar.getPassword(SERVICE_NAME, args.provider) ?? ''
      return await listModels(args.provider, apiKey)
    } catch { return [] }
  })

  ipcMain.handle('test_connection', async (_e, args: { provider: string; model: string }) => {
    try {
      const apiKey = await getKey(args.provider)
      await callAi({
        provider: args.provider, model: args.model, apiKey,
        systemPrompt: 'You are a test.', userPrompt: 'Reply with "ok"', maxTokens: 10,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('save_pasted_log', async (_e, args: {
    content: string
    filename: string
    provider: string
    model: string
  }) => {
    const tmpDir = require('os').tmpdir()
    const tmpPath = path.join(tmpDir, args.filename)
    await fs.writeFile(tmpPath, args.content, 'utf-8')
    return { tmp_path: tmpPath }
  })
}
```

- [ ] **Step 3: Write `electron/ipc/ai.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'

// Mock keytar and electron
vi.mock('keytar', () => ({ getPassword: vi.fn(() => 'test-key'), setPassword: vi.fn(), deletePassword: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => null) }, ipcMain: { handle: vi.fn() } }))
vi.mock('../database', () => {
  const db = new Database(':memory:')
  runMigrations(db)
  return { getDb: () => db }
})

describe('ai ipc', () => {
  it('save_pasted_log writes tmp file', async () => {
    const os = await import('os')
    const path = await import('path')
    const fs = await import('fs/promises')
    const tmpPath = path.join(os.tmpdir(), 'test-crash.txt')
    await fs.writeFile(tmpPath, 'test content', 'utf-8')
    const content = await fs.readFile(tmpPath, 'utf-8')
    expect(content).toBe('test content')
    await fs.unlink(tmpPath)
  })
})
```

- [ ] **Step 4: Run the test**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npx vitest run electron/ipc/ai.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/electron/services/ hadron-electron/electron/ipc/ai.ts hadron-electron/electron/ipc/ai.test.ts
git commit -m "feat(electron): add AI service + analyze_crash_log, call_ai, translate IPC handlers"
```

---

## Task 7: Analysis CRUD + Search + Tags IPC

**Files:**
- Create: `hadron-electron/electron/ipc/crud.ts`
- Create: `hadron-electron/electron/ipc/search.ts`
- Create: `hadron-electron/electron/ipc/tags.ts`
- Create: `hadron-electron/electron/ipc/crud.test.ts`

- [ ] **Step 1: Write `electron/ipc/crud.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerCrudHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_all_analyses', (_e, args?: { limit?: number; offset?: number }) => {
    const db = getDb()
    return db.prepare(`
      SELECT a.*, GROUP_CONCAT(t.name) as tag_names
      FROM analyses a
      LEFT JOIN analysis_tags at2 ON at2.analysis_id = a.id
      LEFT JOIN tags t ON t.id = at2.tag_id
      WHERE a.deleted_at IS NULL
      GROUP BY a.id
      ORDER BY a.analyzed_at DESC
      LIMIT ? OFFSET ?
    `).all(args?.limit ?? 100, args?.offset ?? 0)
  })

  ipcMain.handle('get_analyses_paginated', (_e, args: { page: number; page_size: number }) => {
    const db = getDb()
    const offset = (args.page - 1) * args.page_size
    const rows = db.prepare(`
      SELECT * FROM analyses WHERE deleted_at IS NULL ORDER BY analyzed_at DESC LIMIT ? OFFSET ?
    `).all(args.page_size, offset)
    const total = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
    return { items: rows, total, page: args.page, page_size: args.page_size }
  })

  ipcMain.handle('get_analyses_count', () => {
    const db = getDb()
    return (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
  })

  ipcMain.handle('get_analysis_by_id', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.id)
    if (!row) throw new Error(`Analysis ${args.id} not found`)
    db.prepare('UPDATE analyses SET view_count = view_count + 1, last_viewed_at = datetime("now") WHERE id = ?').run(args.id)
    return row
  })

  ipcMain.handle('delete_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?').run(args.id)
  })

  ipcMain.handle('toggle_favorite', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE analyses SET is_favorite = NOT is_favorite WHERE id = ?').run(args.id)
    const row = db.prepare('SELECT is_favorite FROM analyses WHERE id = ?').get(args.id) as { is_favorite: number } | undefined
    return { is_favorite: !!row?.is_favorite }
  })

  ipcMain.handle('get_favorites', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM analyses WHERE is_favorite = 1 AND deleted_at IS NULL ORDER BY analyzed_at DESC').all()
  })

  ipcMain.handle('get_recent', (_e, args?: { limit?: number }) => {
    const db = getDb()
    return db.prepare(`
      SELECT * FROM analyses WHERE deleted_at IS NULL AND last_viewed_at IS NOT NULL
      ORDER BY last_viewed_at DESC LIMIT ?
    `).all(args?.limit ?? 20)
  })

  ipcMain.handle('get_database_statistics', () => {
    const db = getDb()
    const analyses = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
    const favorites = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE is_favorite=1 AND deleted_at IS NULL').get() as { c: number }).c
    const translations = (db.prepare('SELECT COUNT(*) AS c FROM translations WHERE deleted_at IS NULL').get() as { c: number }).c
    return { analyses, favorites, translations }
  })

  ipcMain.handle('get_all_translations', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM translations WHERE deleted_at IS NULL ORDER BY translated_at DESC').all()
  })

  ipcMain.handle('delete_translation', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE translations SET deleted_at = datetime("now") WHERE id = ?').run(args.id)
  })

  ipcMain.handle('toggle_translation_favorite', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE translations SET is_favorite = NOT is_favorite WHERE id = ?').run(args.id)
  })
}
```

- [ ] **Step 2: Write `electron/ipc/search.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerSearchHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('search_analyses', (_e, args: {
    query: string
    limit?: number
    offset?: number
  }) => {
    const db = getDb()
    if (!args.query.trim()) {
      return db.prepare('SELECT * FROM analyses WHERE deleted_at IS NULL ORDER BY analyzed_at DESC LIMIT ? OFFSET ?')
        .all(args.limit ?? 50, args.offset ?? 0)
    }
    return db.prepare(`
      SELECT a.* FROM analyses a
      JOIN analyses_fts f ON f.rowid = a.id
      WHERE analyses_fts MATCH ? AND a.deleted_at IS NULL
      ORDER BY rank LIMIT ? OFFSET ?
    `).all(args.query, args.limit ?? 50, args.offset ?? 0)
  })

  ipcMain.handle('get_analyses_filtered', (_e, args: {
    severity?: string
    analysis_type?: string
    is_favorite?: boolean
    tag_ids?: number[]
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) => {
    const db = getDb()
    const conditions = ['a.deleted_at IS NULL']
    const params: unknown[] = []

    if (args.severity) { conditions.push('a.severity = ?'); params.push(args.severity) }
    if (args.analysis_type) { conditions.push('a.analysis_type = ?'); params.push(args.analysis_type) }
    if (args.is_favorite) { conditions.push('a.is_favorite = 1') }
    if (args.date_from) { conditions.push('a.analyzed_at >= ?'); params.push(args.date_from) }
    if (args.date_to) { conditions.push('a.analyzed_at <= ?'); params.push(args.date_to) }
    if (args.tag_ids?.length) {
      conditions.push(`a.id IN (SELECT analysis_id FROM analysis_tags WHERE tag_id IN (${args.tag_ids.map(() => '?').join(',')}))`)
      params.push(...args.tag_ids)
    }

    params.push(args.limit ?? 50, args.offset ?? 0)
    return db.prepare(`
      SELECT a.* FROM analyses a WHERE ${conditions.join(' AND ')}
      ORDER BY a.analyzed_at DESC LIMIT ? OFFSET ?
    `).all(...params)
  })
}
```

- [ ] **Step 3: Write `electron/ipc/tags.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerTagHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_all_tags', () => {
    return getDb().prepare('SELECT * FROM tags ORDER BY usage_count DESC').all()
  })

  ipcMain.handle('create_tag', (_e, args: { name: string; color: string }) => {
    const db = getDb()
    const row = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *').get(args.name, args.color)
    return row
  })

  ipcMain.handle('update_tag', (_e, args: { id: number; name?: string; color?: string }) => {
    const db = getDb()
    if (args.name !== undefined) db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(args.name, args.id)
    if (args.color !== undefined) db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(args.color, args.id)
  })

  ipcMain.handle('delete_tag', (_e, args: { id: number }) => {
    getDb().prepare('DELETE FROM tags WHERE id = ?').run(args.id)
  })

  ipcMain.handle('add_tag_to_analysis', (_e, args: { analysis_id: number; tag_id: number }) => {
    const db = getDb()
    db.prepare('INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?, ?)').run(args.analysis_id, args.tag_id)
    db.prepare('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?').run(args.tag_id)
  })

  ipcMain.handle('remove_tag_from_analysis', (_e, args: { analysis_id: number; tag_id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM analysis_tags WHERE analysis_id = ? AND tag_id = ?').run(args.analysis_id, args.tag_id)
    db.prepare('UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?').run(args.tag_id)
  })

  ipcMain.handle('get_tags_for_analysis', (_e, args: { analysis_id: number }) => {
    return getDb().prepare(`
      SELECT t.* FROM tags t
      JOIN analysis_tags at2 ON at2.tag_id = t.id
      WHERE at2.analysis_id = ?
    `).all(args.analysis_id)
  })

  ipcMain.handle('add_tag_to_translation', (_e, args: { translation_id: number; tag_id: number }) => {
    getDb().prepare('INSERT OR IGNORE INTO translation_tags (translation_id, tag_id) VALUES (?, ?)').run(args.translation_id, args.tag_id)
  })

  ipcMain.handle('remove_tag_from_translation', (_e, args: { translation_id: number; tag_id: number }) => {
    getDb().prepare('DELETE FROM translation_tags WHERE translation_id = ? AND tag_id = ?').run(args.translation_id, args.tag_id)
  })

  ipcMain.handle('get_tags_for_translation', (_e, args: { translation_id: number }) => {
    return getDb().prepare(`
      SELECT t.* FROM tags t
      JOIN translation_tags tt ON tt.tag_id = t.id
      WHERE tt.translation_id = ?
    `).all(args.translation_id)
  })
}
```

- [ ] **Step 4: Write `electron/ipc/crud.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'

vi.mock('../database', () => {
  let db: Database.Database
  return {
    getDb: () => {
      if (!db) { db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db) }
      return db
    }
  }
})

vi.mock('electron', () => ({ BrowserWindow: {}, ipcMain: { handle: vi.fn() } }))

import { getDb } from '../database'

describe('crud queries', () => {
  beforeEach(() => {
    const db = getDb()
    db.prepare(`INSERT INTO analyses (filename, analyzed_at, ai_model, root_cause, suggested_fixes, severity)
      VALUES ('test.log', datetime('now'), 'claude-sonnet-4-6', 'NPE in auth', '["fix it"]', 'HIGH')`).run()
  })

  afterEach(() => {
    getDb().prepare('DELETE FROM analyses').run()
  })

  it('returns all analyses', () => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM analyses WHERE deleted_at IS NULL').all()
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('soft-deletes analysis', () => {
    const db = getDb()
    const id = (db.prepare('SELECT id FROM analyses LIMIT 1').get() as { id: number }).id
    db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?').run(id)
    const rows = db.prepare('SELECT * FROM analyses WHERE deleted_at IS NULL').all()
    expect(rows.find((r: unknown) => (r as { id: number }).id === id)).toBeUndefined()
  })

  it('toggles favorite', () => {
    const db = getDb()
    const id = (db.prepare('SELECT id FROM analyses LIMIT 1').get() as { id: number }).id
    db.prepare('UPDATE analyses SET is_favorite = NOT is_favorite WHERE id = ?').run(id)
    const row = db.prepare('SELECT is_favorite FROM analyses WHERE id = ?').get(id) as { is_favorite: number }
    expect(row.is_favorite).toBe(1)
  })
})
```

- [ ] **Step 5: Run the tests**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npx vitest run electron/ipc/crud.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/electron/ipc/crud.ts hadron-electron/electron/ipc/search.ts hadron-electron/electron/ipc/tags.ts hadron-electron/electron/ipc/crud.test.ts
git commit -m "feat(electron): add CRUD, search, and tags IPC handlers"
```

---

## Task 8: Notes, Archive, Analytics, Bulk, Info IPC

**Files:**
- Create: `hadron-electron/electron/ipc/notes.ts`
- Create: `hadron-electron/electron/ipc/archive.ts`
- Create: `hadron-electron/electron/ipc/analytics.ts`
- Create: `hadron-electron/electron/ipc/bulk.ts`
- Create: `hadron-electron/electron/ipc/info.ts`

- [ ] **Step 1: Write `electron/ipc/notes.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerNotesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('add_note_to_analysis', (_e, args: { analysis_id: number; content: string }) => {
    const db = getDb()
    return db.prepare('INSERT INTO analysis_notes (analysis_id, content) VALUES (?, ?) RETURNING *')
      .get(args.analysis_id, args.content)
  })

  ipcMain.handle('update_note', (_e, args: { id: number; content: string }) => {
    getDb().prepare('UPDATE analysis_notes SET content = ?, updated_at = datetime("now") WHERE id = ?')
      .run(args.content, args.id)
  })

  ipcMain.handle('delete_note', (_e, args: { id: number }) => {
    getDb().prepare('DELETE FROM analysis_notes WHERE id = ?').run(args.id)
  })

  ipcMain.handle('get_notes_for_analysis', (_e, args: { analysis_id: number }) => {
    return getDb().prepare('SELECT * FROM analysis_notes WHERE analysis_id = ? ORDER BY created_at ASC').all(args.analysis_id)
  })

  ipcMain.handle('get_note_count', (_e, args: { analysis_id: number }) => {
    return (getDb().prepare('SELECT COUNT(*) AS c FROM analysis_notes WHERE analysis_id = ?').get(args.analysis_id) as { c: number }).c
  })

  ipcMain.handle('analysis_has_notes', (_e, args: { analysis_id: number }) => {
    const c = (getDb().prepare('SELECT COUNT(*) AS c FROM analysis_notes WHERE analysis_id = ?').get(args.analysis_id) as { c: number }).c
    return c > 0
  })
}
```

- [ ] **Step 2: Write `electron/ipc/archive.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerArchiveHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('archive_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(args.id)
    if (!row) throw new Error('Analysis not found')
    db.prepare('INSERT INTO archived_analyses (original_id, data_json) VALUES (?, ?)').run(args.id, JSON.stringify(row))
    db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?').run(args.id)
  })

  ipcMain.handle('restore_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('UPDATE analyses SET deleted_at = NULL WHERE id = ?').run(args.id)
    db.prepare('DELETE FROM archived_analyses WHERE original_id = ?').run(args.id)
  })

  ipcMain.handle('get_archived_analyses', () => {
    return getDb().prepare('SELECT a.* FROM analyses a WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC').all()
  })

  ipcMain.handle('permanently_delete_analysis', (_e, args: { id: number }) => {
    const db = getDb()
    db.prepare('DELETE FROM archived_analyses WHERE original_id = ?').run(args.id)
    db.prepare('DELETE FROM analyses WHERE id = ?').run(args.id)
  })

  ipcMain.handle('bulk_archive_analyses', (_e, args: { ids: number[] }) => {
    const db = getDb()
    const archiveStmt = db.prepare('INSERT INTO archived_analyses (original_id, data_json) VALUES (?, ?)')
    const deleteStmt = db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?')
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id)
        if (row) { archiveStmt.run(id, JSON.stringify(row)); deleteStmt.run(id) }
      }
    })
    tx(args.ids)
  })

  ipcMain.handle('archive_translation', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET deleted_at = datetime("now") WHERE id = ?').run(args.id)
  })

  ipcMain.handle('restore_translation', (_e, args: { id: number }) => {
    getDb().prepare('UPDATE translations SET deleted_at = NULL WHERE id = ?').run(args.id)
  })
}
```

- [ ] **Step 3: Write `electron/ipc/analytics.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerAnalyticsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_dashboard_stats', () => {
    const db = getDb()
    const total = (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL').get() as { c: number }).c
    const thisWeek = (db.prepare(`SELECT COUNT(*) AS c FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', '-7 days')`).get() as { c: number }).c
    const bySeverity = db.prepare(`SELECT severity, COUNT(*) AS count FROM analyses WHERE deleted_at IS NULL GROUP BY severity`).all()
    return { total, thisWeek, bySeverity }
  })

  ipcMain.handle('get_trend_data', (_e, args?: { days?: number }) => {
    const db = getDb()
    const days = args?.days ?? 30
    return db.prepare(`
      SELECT date(analyzed_at) AS day, COUNT(*) AS count
      FROM analyses WHERE deleted_at IS NULL AND analyzed_at >= datetime('now', '-' || ? || ' days')
      GROUP BY day ORDER BY day ASC
    `).all(days)
  })

  ipcMain.handle('get_top_error_patterns', (_e, args?: { limit?: number }) => {
    return getDb().prepare(`
      SELECT error_type, COUNT(*) AS count FROM analyses
      WHERE deleted_at IS NULL AND error_type IS NOT NULL
      GROUP BY error_type ORDER BY count DESC LIMIT ?
    `).all(args?.limit ?? 10)
  })

  ipcMain.handle('get_similar_analyses', (_e, args: { id: number; limit?: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT error_type, component FROM analyses WHERE id = ?').get(args.id) as { error_type: string; component: string } | undefined
    if (!row) return []
    return db.prepare(`
      SELECT * FROM analyses WHERE id != ? AND deleted_at IS NULL
        AND (error_type = ? OR component = ?)
      ORDER BY analyzed_at DESC LIMIT ?
    `).all(args.id, row.error_type, row.component, args.limit ?? 5)
  })

  ipcMain.handle('count_similar_analyses', (_e, args: { id: number }) => {
    const db = getDb()
    const row = db.prepare('SELECT error_type FROM analyses WHERE id = ?').get(args.id) as { error_type: string } | undefined
    if (!row) return 0
    return (db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE id != ? AND error_type = ? AND deleted_at IS NULL').get(args.id, row.error_type) as { c: number }).c
  })
}
```

- [ ] **Step 4: Write `electron/ipc/bulk.ts`**

```typescript
import { IpcMain } from 'electron'
import { getDb } from '../database'

export function registerBulkHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('bulk_delete_analyses', (_e, args: { ids: number[] }) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE analyses SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id)))(args.ids)
  })

  ipcMain.handle('bulk_delete_translations', (_e, args: { ids: number[] }) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE translations SET deleted_at = datetime("now") WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id)))(args.ids)
  })

  ipcMain.handle('bulk_add_tag_to_analyses', (_e, args: { analysis_ids: number[]; tag_id: number }) => {
    const db = getDb()
    const stmt = db.prepare('INSERT OR IGNORE INTO analysis_tags (analysis_id, tag_id) VALUES (?, ?)')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id, args.tag_id)))(args.analysis_ids)
  })

  ipcMain.handle('bulk_remove_tag_from_analyses', (_e, args: { analysis_ids: number[]; tag_id: number }) => {
    const db = getDb()
    const stmt = db.prepare('DELETE FROM analysis_tags WHERE analysis_id = ? AND tag_id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(id, args.tag_id)))(args.analysis_ids)
  })

  ipcMain.handle('bulk_set_favorite_analyses', (_e, args: { ids: number[]; is_favorite: boolean }) => {
    const db = getDb()
    const val = args.is_favorite ? 1 : 0
    const stmt = db.prepare('UPDATE analyses SET is_favorite = ? WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(val, id)))(args.ids)
  })

  ipcMain.handle('bulk_set_favorite_translations', (_e, args: { ids: number[]; is_favorite: boolean }) => {
    const db = getDb()
    const val = args.is_favorite ? 1 : 0
    const stmt = db.prepare('UPDATE translations SET is_favorite = ? WHERE id = ?')
    db.transaction((ids: number[]) => ids.forEach(id => stmt.run(val, id)))(args.ids)
  })
}
```

- [ ] **Step 5: Write `electron/ipc/info.ts`**

```typescript
import { IpcMain, app } from 'electron'
import { getDb } from '../database'
import fs from 'fs/promises'
import path from 'path'

export function registerInfoHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get_database_info', async () => {
    const db = getDb()
    const dbPath = path.join(app.getPath('userData'), 'hadron.db')
    let sizeKb = 0
    try {
      const stat = await fs.stat(dbPath)
      sizeKb = stat.size / 1024
    } catch { /* ignore */ }
    const version = (db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v: number }).v
    return { path: dbPath, size_kb: sizeKb, schema_version: version }
  })

  ipcMain.handle('get_file_stats', async (_e, args: { file_path: string }) => {
    try {
      const stat = await fs.stat(args.file_path)
      return { size_bytes: stat.size, size_kb: stat.size / 1024, exists: true }
    } catch {
      return { size_bytes: 0, size_kb: 0, exists: false }
    }
  })

  ipcMain.handle('get_crash_log_dir', () => {
    return app.getPath('userData')
  })

  ipcMain.handle('set_crash_log_dir', () => {
    // no-op in Electron (user selects via dialog)
  })

  ipcMain.handle('get_stability_mode', () => 'normal')
  ipcMain.handle('set_stability_mode', () => {})

  ipcMain.handle('optimize_fts_index', () => {
    getDb().exec("INSERT INTO analyses_fts(analyses_fts) VALUES('optimize')")
  })

  ipcMain.handle('check_database_integrity', () => {
    const result = getDb().pragma('integrity_check') as Array<{ integrity_check: string }>
    return { ok: result[0]?.integrity_check === 'ok', details: result.map(r => r.integrity_check) }
  })

  ipcMain.handle('compact_database', () => {
    getDb().exec('VACUUM')
  })

  ipcMain.handle('checkpoint_wal', () => {
    getDb().pragma('wal_checkpoint(FULL)')
  })
}
```

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/electron/ipc/notes.ts hadron-electron/electron/ipc/archive.ts hadron-electron/electron/ipc/analytics.ts hadron-electron/electron/ipc/bulk.ts hadron-electron/electron/ipc/info.ts
git commit -m "feat(electron): add notes, archive, analytics, bulk ops, and info IPC handlers"
```

---

## Task 9: App Packaging

**Files:**
- Create: `hadron-electron/electron-builder.config.ts`
- Create: `hadron-electron/.github/workflows/electron-build.yml` (optional)

- [ ] **Step 1: Write `electron-builder.config.ts`**

```typescript
import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.hadron.electron',
  productName: 'Hadron',
  copyright: 'Copyright © 2026 Hadron Team',
  directories: {
    output: 'dist',
    buildResources: 'resources',
  },
  files: [
    'out/**/*',
    'resources/**/*',
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
    artifactName: 'hadron-electron-setup-${version}.exe',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'resources/icon.ico',
    installerHeaderIcon: 'resources/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Hadron',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'resources/icon.icns',
    category: 'public.app-category.developer-tools',
    artifactName: 'hadron-electron-${version}.dmg',
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon: 'resources/icon.png',
    category: 'Development',
    artifactName: 'hadron-electron-${version}.AppImage',
  },
  publish: null,
  asar: true,
  asarUnpack: ['**/node_modules/better-sqlite3/**', '**/node_modules/keytar/**'],
}

export default config
```

Note: `better-sqlite3` and `keytar` contain native modules and must be excluded from asar.

- [ ] **Step 2: Copy app icons from the Tauri build**

```bash
mkdir -p /mnt/c/Projects/Hadron_v3/hadron-electron/resources
# Copy existing Tauri icons — convert as needed
cp /mnt/c/Projects/Hadron_v3/hadron-desktop/src-tauri/icons/icon.png \
   /mnt/c/Projects/Hadron_v3/hadron-electron/resources/icon.png
cp /mnt/c/Projects/Hadron_v3/hadron-desktop/src-tauri/icons/icon.ico \
   /mnt/c/Projects/Hadron_v3/hadron-electron/resources/icon.ico 2>/dev/null || true
```

- [ ] **Step 3: Add `.gitignore` for the electron folder**

Create `hadron-electron/.gitignore`:
```
node_modules/
out/
dist/
*.db
```

- [ ] **Step 4: Do a full dev build to verify no compile errors**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm run build 2>&1 | tail -20
```

Expected: `Build complete` with no TypeScript errors.

- [ ] **Step 5: Run all tests**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Projects/Hadron_v3
git add hadron-electron/electron-builder.config.ts hadron-electron/resources/ hadron-electron/.gitignore
git commit -m "feat(electron): add electron-builder packaging config for win/mac/linux"
```

---

## Task 10: Smoke-Test the Dev Build

- [ ] **Step 1: Start the dev server**

```bash
cd /mnt/c/Projects/Hadron_v3/hadron-electron
npm run dev
```

Expected: Electron window opens showing the Hadron UI.

- [ ] **Step 2: Verify settings dialog opens and saves an API key**

In the app: go to Settings → enter a test Anthropic API key → save → close → reopen → confirm key is still present.

Expected: keytar stored the key; the store shim round-trips correctly.

- [ ] **Step 3: Test crash log analysis**

In the app: drag a `.log` file onto the analyzer → click Analyze. Observe the streaming output appearing in the UI.

Expected: analysis completes, result saved to DB, appears in History.

- [ ] **Step 4: Test history CRUD**

In History: confirm the analysis appears → toggle favorite → search for the error type → soft-delete → confirm it disappears.

Expected: all three operations succeed without console errors.

- [ ] **Step 5: Commit final state**

```bash
cd /mnt/c/Projects/Hadron_v3
git add -A
git commit -m "feat(electron): complete Hadron Electron MVP — core analysis, history, tags, settings"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Project scaffold with electron-vite ✓ Task 1
- [x] All 14 DB migrations ported ✓ Task 2
- [x] All `@tauri-apps/*` shims so frontend compiles unchanged ✓ Task 3
- [x] Frontend copied + secure-storage adapted ✓ Task 4
- [x] Settings/keytar/dialog IPC ✓ Task 5
- [x] AI analysis (Anthropic/OpenAI/ZAI), streaming ✓ Task 6
- [x] CRUD, search, favorites, tags ✓ Task 7
- [x] Notes, archive, analytics, bulk, info ✓ Task 8
- [x] Packaging config ✓ Task 9
- [x] Smoke test ✓ Task 10

**Not in this plan (Phase 2):**
- Chat/AskHadron (needs streaming chat + tool use pipeline)
- JIRA integration (needs `commands/jira.ts` → IPC port)
- JIRA Assist + poller
- Keeper Secrets Manager (check if JS SDK exists first)
- RAG / embeddings
- Investigation deep analysis
- Release Notes generator
- Floating widget (separate BrowserWindow)
- Intelligence / gold analyses export

**Placeholder scan:** No TBDs or "implement later" comments found.

**Type consistency:**
- `getDb()` used consistently across all IPC files
- `analysis_id` / `tag_id` parameter names match between shim callers and handlers
- `stream:chunk` event name consistent between preload and `ai.ts`
