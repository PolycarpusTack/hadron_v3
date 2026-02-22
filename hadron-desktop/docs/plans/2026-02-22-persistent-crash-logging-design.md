# Hadron Persistent Crash Logging Design

**Date:** 2026-02-22
**Status:** Approved
**Version:** Hadron 4.1.x

## Problem

Random crashes cause the entire Tauri app window to disappear, leaving no diagnostic trace. The existing `tauri-plugin-log` captures normal operation but:
- No panic handler exists, so Rust panics kill the process without logging
- Frontend logger is in-memory only — lost on crash
- Log level is `Info`, missing diagnostic detail needed for crash investigation
- No native crash capture for segfaults/stack overflows/aborts

## Solution

Five-component persistent logging system that captures crashes at every level.

## Components

### 1. Panic Hook (`crash_handler.rs`)

Custom `std::panic::set_hook` installed before Tauri builder. On panic:

1. Formats panic message + location + `RUST_BACKTRACE=1` backtrace
2. Writes synchronously to `{data_dir}/hadron/logs/crash-{YYYY-MM-DD_HH-MM-SS}.log`
3. Flushes and closes the file handle
4. Lets the process terminate naturally

Independent of `tauri-plugin-log` because the plugin may not be initialized or functional at panic time.

### 2. Enhanced `tauri-plugin-log` Configuration

Update existing logger config in `main.rs`:

- **Level:** `Debug` (from current `Info`)
- **Rotation:** `max_file_size(50_000_000)` (50MB) with `RotationStrategy::KeepAll`
- **Timezone:** `TimezoneStrategy::UseLocal`
- **Targets:** Unchanged (Stdout, LogDir, Webview)

### 3. Command Breadcrumbs

Add `log::debug!("cmd: <command_name> called")` at the entry point of every `#[tauri::command]` function. This creates a breadcrumb trail showing exactly which operations were invoked before a crash.

Covers all command files:
- `commands_legacy.rs`
- `widget_commands.rs`
- `commands/performance.rs`
- `sentry_service.rs`
- `jira_service.rs`
- `release_notes_service.rs`
- `model_fetcher.rs`
- Any other command modules

### 4. Minidump Crash Capture

In-process crash handler using `crash-handler` + `minidumper` + `minidump-writer` crates.

**Architecture:**
- On startup, register an in-process crash handler via `crash_handler::CrashHandler`
- On native crash (segfault, abort, stack overflow), the handler writes a minidump to `{data_dir}/hadron/crashes/{timestamp}.dmp`
- Minidumps contain: thread stacks, register state, loaded modules, exception info
- Files are small (~100KB-1MB) and can be analyzed with `minidump-stackwalk`

**New Cargo dependencies:**
```toml
crash-handler = "0.6"
minidumper = "0.9"
minidump-writer = "0.11"
```

### 5. Frontend Error Forwarding

**Global error handlers in `main.tsx`:**
- `window.onerror` — catches uncaught JS exceptions
- `window.onunhandledrejection` — catches unhandled promise rejections

Both call `error()` from `@tauri-apps/plugin-log` JS API to persist errors to the same log file as Rust-side logs.

**Capability update:** Add `log:default` to the main window capabilities in `tauri.conf.json`.

## File Locations

| Artifact | Path | Rotation |
|----------|------|----------|
| Regular logs | `{data_dir}/hadron/logs/hadron.log` | 50MB, KeepAll |
| Crash logs | `{data_dir}/hadron/logs/crash-{timestamp}.log` | One per panic |
| Minidumps | `{data_dir}/hadron/crashes/{timestamp}.dmp` | One per native crash |

Platform data_dir:
- Windows: `%APPDATA%\hadron\`
- macOS: `~/Library/Application Support/hadron/`
- Linux: `~/.local/share/hadron/`

## What This Catches

| Crash Type | Captured By | Output |
|-----------|------------|--------|
| Rust panic (unwinding) | Panic hook | crash-{ts}.log |
| Segfault / SIGSEGV | Minidump handler | {ts}.dmp |
| Stack overflow | Minidump handler | {ts}.dmp |
| Abort / SIGABRT | Minidump handler | {ts}.dmp |
| JS uncaught exception | Frontend error handler | hadron.log |
| JS unhandled rejection | Frontend error handler | hadron.log |
| Operation timeline | Debug breadcrumbs | hadron.log |

## Files Changed

### New Files
- `src-tauri/src/crash_handler.rs` — Panic hook + minidump setup

### Modified Files
- `src-tauri/src/main.rs` — Install panic hook, update log config, init crash handler
- `src-tauri/Cargo.toml` — Add crash-handler, minidumper, minidump-writer deps
- `src-tauri/tauri.conf.json` — Add `log:default` capability
- `src/main.tsx` — Add window.onerror + onunhandledrejection handlers
- `src-tauri/src/commands_legacy.rs` — Add debug breadcrumbs
- `src-tauri/src/widget_commands.rs` — Add debug breadcrumbs
- `src-tauri/src/commands/performance.rs` — Add debug breadcrumbs
- `src-tauri/src/sentry_service.rs` — Add debug breadcrumbs
- `src-tauri/src/jira_service.rs` — Add debug breadcrumbs
- `src-tauri/src/release_notes_service.rs` — Add debug breadcrumbs
- `src-tauri/src/model_fetcher.rs` — Add debug breadcrumbs

## Non-Goals

- No external crash reporting (Sentry, Bugsnag, etc.)
- No crash notification on next startup
- No log upload mechanism
- No source map integration for frontend
