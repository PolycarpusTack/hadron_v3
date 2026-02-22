# Persistent Crash Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent crash logging so that when Hadron crashes (app disappears), diagnostic logs and crash dumps survive on disk for post-mortem analysis.

**Architecture:** Five-layer approach: (1) Rust panic hook writes crash logs before process death, (2) enhanced tauri-plugin-log with Debug level and rotation, (3) debug breadcrumbs at every command entry point, (4) in-process minidump capture for native crashes, (5) frontend error forwarding via tauri-plugin-log JS API. All artifacts written to local files under `{data_dir}/hadron/`.

**Tech Stack:** Rust (`crash-handler`, `minidumper`, `minidump-writer` crates), `tauri-plugin-log` v2, `@tauri-apps/plugin-log` JS bindings, React global error handlers.

---

### Task 1: Add crash-handler dependencies to Cargo.toml

**Files:**
- Modify: `hadron-desktop/src-tauri/Cargo.toml:56-60`

**Step 1: Add the three crash-handling crates**

Add after the `parking_lot` line (line 56) in Cargo.toml:

```toml
# Crash capture: write minidumps on native crashes (segfault, abort, etc.)
crash-handler = "0.6"
minidumper = "0.8"
```

Note: We use `minidumper` 0.8 (not 0.9) because 0.9 requires Rust edition 2024 which conflicts with our edition 2021. The `minidumper` crate bundles `minidump-writer` internally so we don't need it as a separate dep.

**Step 2: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check 2>&1 | tail -5`
Expected: `Finished` or compilation errors to investigate. If version conflicts appear, adjust versions.

**Step 3: Commit**

```bash
git add hadron-desktop/src-tauri/Cargo.toml
git commit -m "chore: add crash-handler and minidumper dependencies"
```

---

### Task 2: Create `crash_handler.rs` — Panic Hook

**Files:**
- Create: `hadron-desktop/src-tauri/src/crash_handler.rs`
- Modify: `hadron-desktop/src-tauri/src/main.rs:4` (add `mod crash_handler;`)

**Step 1: Create the crash handler module with panic hook**

Create `hadron-desktop/src-tauri/src/crash_handler.rs`:

```rust
//! Crash handling: panic hook + minidump capture.
//!
//! The panic hook writes a crash log to disk before the process terminates.
//! The minidump handler captures native crashes (segfault, abort, stack overflow).

use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// Returns the directory for crash artifacts.
/// Creates it if it doesn't exist.
fn crash_dir() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("hadron");
    path.push("crashes");
    let _ = fs::create_dir_all(&path);
    path
}

/// Returns the directory for log files (same as tauri-plugin-log LogDir).
fn log_dir() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("hadron");
    path.push("logs");
    let _ = fs::create_dir_all(&path);
    path
}

/// Install the panic hook. Must be called BEFORE tauri::Builder.
/// Writes panic info + backtrace to a crash-{timestamp}.log file.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        let crash_file = log_dir().join(format!("crash-{}.log", timestamp));

        let mut content = String::new();
        content.push_str(&format!("=== HADRON CRASH REPORT ===\n"));
        content.push_str(&format!("Timestamp: {}\n", chrono::Local::now()));
        content.push_str(&format!("Version: {}\n\n", env!("CARGO_PKG_VERSION")));

        // Panic message
        content.push_str(&format!("Panic: {}\n\n", panic_info));

        // Location
        if let Some(location) = panic_info.location() {
            content.push_str(&format!(
                "Location: {}:{}:{}\n\n",
                location.file(),
                location.line(),
                location.column()
            ));
        }

        // Backtrace
        let backtrace = std::backtrace::Backtrace::force_capture();
        content.push_str(&format!("Backtrace:\n{}\n", backtrace));

        // Write synchronously — we may die after this
        if let Ok(mut file) = fs::File::create(&crash_file) {
            let _ = file.write_all(content.as_bytes());
            let _ = file.flush();
        }

        // Also write to stderr as a fallback
        eprintln!("{}", content);
    }));
}
```

**Step 2: Register the module in main.rs**

In `main.rs`, add `mod crash_handler;` after line 4 (after `mod chat_commands;`).

**Step 3: Call the panic hook before Tauri builder**

In `main.rs`, add `crash_handler::install_panic_hook();` as the first line of `fn main()` (before database initialization at line 40).

**Step 4: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check 2>&1 | tail -5`
Expected: `Finished`

**Step 5: Commit**

```bash
git add hadron-desktop/src-tauri/src/crash_handler.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat: add panic hook that writes crash logs to disk"
```

---

### Task 3: Enhance `tauri-plugin-log` Configuration

**Files:**
- Modify: `hadron-desktop/src-tauri/src/main.rs:57-67` (log plugin config)

**Step 1: Update the log plugin configuration**

Replace the current log plugin block (lines 57-68 of main.rs) with:

```rust
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("hadron".to_string()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Debug)
                .max_file_size(50_000 /* 50KB rotation — each rotated file kept */)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
```

Key changes from current:
- `LevelFilter::Info` → `LevelFilter::Debug`
- Added `max_file_size(50_000)` — rotate at 50KB (keep files small and numerous for debugging)
- Added `RotationStrategy::KeepAll` — don't delete old log files
- Added `TimezoneStrategy::UseLocal` — human-readable timestamps

Note: 50KB rotation with KeepAll means we get many small log files. Adjust to `50_000_000` (50MB) if you prefer fewer, larger files. The 50KB setting is good for quick browsing of recent logs.

**Step 2: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check 2>&1 | tail -5`
Expected: `Finished`. If `RotationStrategy` or `TimezoneStrategy` are not available in the installed version, check `cargo doc --open` for the actual API.

**Step 3: Commit**

```bash
git add hadron-desktop/src-tauri/src/main.rs
git commit -m "feat: enhance log config with debug level, rotation, and local timezone"
```

---

### Task 4: Add `log:default` Capability for Frontend Logging

**Files:**
- Modify: `hadron-desktop/src-tauri/tauri.conf.json:45-56` (main-capability permissions)

**Step 1: Add log:default permission to main window**

In `tauri.conf.json`, add `"log:default"` to the main-capability permissions array (after `"core:event:default"` on line 55):

```json
          "permissions": [
            "core:default",
            "dialog:default",
            "store:default",
            "updater:default",
            "process:default",
            "notification:default",
            "window-state:default",
            "core:app:default",
            "core:window:default",
            "core:event:default",
            "log:default"
          ]
```

Also add `"log:default"` to the widget-capability permissions array (after `"store:default"` on line 72):

```json
          "permissions": [
            "core:default",
            "core:window:default",
            "core:window:allow-start-dragging",
            "core:window:allow-set-size",
            "core:window:allow-set-position",
            "core:event:default",
            "global-shortcut:default",
            "clipboard-manager:default",
            "dialog:default",
            "store:default",
            "log:default"
          ]
```

**Step 2: Verify the `@tauri-apps/plugin-log` JS package is installed**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npm ls @tauri-apps/plugin-log 2>&1`

If NOT installed, run: `npm install @tauri-apps/plugin-log`

**Step 3: Commit**

```bash
git add hadron-desktop/src-tauri/tauri.conf.json
git commit -m "feat: add log:default capability for frontend error forwarding"
```

---

### Task 5: Add Frontend Global Error Handlers

**Files:**
- Modify: `hadron-desktop/src/main.tsx`

**Step 1: Add global error handlers**

Update `main.tsx` to add `window.onerror` and `window.onunhandledrejection` handlers that forward errors to the Rust log file via the Tauri log plugin JS API:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { error as logError, attachConsole } from "@tauri-apps/plugin-log";
import "./styles.css";

// Forward uncaught JS errors to persistent Rust log file
window.onerror = (message, source, lineno, colno, err) => {
  const detail = `${message} at ${source}:${lineno}:${colno}`;
  logError(`[JS] Uncaught error: ${detail}${err?.stack ? `\n${err.stack}` : ""}`);
};

window.onunhandledrejection = (event) => {
  const reason = event.reason;
  const detail = reason instanceof Error
    ? `${reason.message}\n${reason.stack || ""}`
    : String(reason);
  logError(`[JS] Unhandled rejection: ${detail}`);
};

// Attach console bridge so console.log/warn/error also go to the log file
attachConsole();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
```

**Step 2: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npm run build 2>&1 | tail -5`
Expected: Build succeeds. If `@tauri-apps/plugin-log` import fails, install it first (Task 4 Step 2).

**Step 3: Commit**

```bash
git add hadron-desktop/src/main.tsx
git commit -m "feat: forward uncaught JS errors to persistent log file"
```

---

### Task 6: Add Debug Breadcrumbs to All Command Entry Points

**Files:**
- Modify: All 23 files containing `#[tauri::command]` functions (270 total commands)

This is a mechanical change: add `log::debug!("cmd: {function_name}")` as the first line of every `#[tauri::command]` function body.

**Step 1: Add breadcrumbs to widget_commands.rs (8 commands)**

For each `#[tauri::command]` function, add a debug log as the first line of the function body. Example for `toggle_widget`:

```rust
#[tauri::command]
pub async fn toggle_widget(app: AppHandle) -> CommandResult<()> {
    log::debug!("cmd: toggle_widget");
    // ... existing code unchanged
```

Do this for all 8 functions in widget_commands.rs:
- `toggle_widget`, `show_widget`, `hide_widget`, `resize_widget`
- `focus_main_window`, `get_widget_position`, `move_widget`, `is_main_window_visible`

**Step 2: Add breadcrumbs to commands_legacy.rs (100 commands)**

Same pattern. For each `#[tauri::command]` function, add `log::debug!("cmd: {fn_name}");` as the first line. For commands that take meaningful parameters, include them:

```rust
#[tauri::command]
pub async fn analyze_crash_log(/* params */) -> CommandResult<AnalysisResult> {
    log::debug!("cmd: analyze_crash_log");
    // ... existing code unchanged
```

**Step 3: Add breadcrumbs to all commands/ submodules**

Apply the same pattern to all files under `src-tauri/src/commands/`:
- `crud.rs` (18 commands)
- `patterns.rs` (13 commands)
- `tags.rs` (12 commands)
- `intelligence.rs` (15 commands)
- `jira.rs` (11 commands)
- `release_notes.rs` (12 commands)
- `archive.rs` (7 commands)
- `export.rs` (7 commands)
- `bulk_ops.rs` (6 commands)
- `sentry.rs` (6 commands)
- `signatures.rs` (6 commands)
- `keeper.rs` (5 commands)
- `gold_answers.rs` (5 commands)
- `summaries.rs` (4 commands)
- `analytics.rs` (4 commands)
- `search.rs` (2 commands)
- `performance.rs` (1 command)
- `notes.rs` (6 commands)

**Step 4: Add breadcrumbs to remaining top-level command files**

- `chat_commands.rs` (12 commands)
- `rag_commands.rs` (9 commands)

**Step 5: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check 2>&1 | tail -5`
Expected: `Finished`

**Step 6: Commit**

```bash
git add hadron-desktop/src-tauri/src/
git commit -m "feat: add debug breadcrumbs to all 270 command entry points"
```

---

### Task 7: Add Minidump Crash Capture

**Files:**
- Modify: `hadron-desktop/src-tauri/src/crash_handler.rs` (add minidump init)
- Modify: `hadron-desktop/src-tauri/src/main.rs` (call minidump init)

**Step 1: Add minidump setup to crash_handler.rs**

Add the following to `crash_handler.rs` after the `install_panic_hook()` function:

```rust
/// In-process minidump handler for native crashes.
/// Stores the CrashHandler to keep it alive for the process lifetime.
static CRASH_HANDLER: std::sync::OnceLock<crash_handler::CrashHandler> = std::sync::OnceLock::new();

/// Install the in-process crash handler that writes minidumps on native crashes
/// (segfault, abort, stack overflow). Must be called early in main().
///
/// Returns Ok(()) on success, or an error string if setup fails.
/// Failure is non-fatal — the app runs fine without minidump capture.
pub fn install_crash_handler() -> Result<(), String> {
    let crash_dir = crash_dir();

    let handler = crash_handler::CrashHandler::attach(unsafe {
        crash_handler::make_crash_event(move |crash_context: &crash_handler::CrashContext| {
            let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
            let dump_path = crash_dir.join(format!("{}.dmp", timestamp));

            // Write the minidump
            let result = minidumper::create_minidump(crash_context, dump_path);

            match result {
                Ok(_) => {
                    // Also write a companion .txt with basic info
                    let info_path = crash_dir.join(format!("{}.txt", timestamp));
                    let _ = fs::write(
                        &info_path,
                        format!(
                            "Hadron native crash at {}\nVersion: {}\nDump: {}.dmp\n",
                            chrono::Local::now(),
                            env!("CARGO_PKG_VERSION"),
                            timestamp
                        ),
                    );
                }
                Err(_) => {
                    // Best-effort: write error to a crash log
                    let err_path = crash_dir.join(format!("crash-minidump-failed-{}.txt", timestamp));
                    let _ = fs::write(&err_path, "Failed to write minidump\n");
                }
            }

            // Tell the OS to terminate the process normally
            crash_handler::CrashEventResult::Handled(true)
        })
    })
    .map_err(|e| format!("Failed to install crash handler: {}", e))?;

    CRASH_HANDLER
        .set(handler)
        .map_err(|_| "Crash handler already installed".to_string())?;

    Ok(())
}
```

Note: The exact API for `crash_handler::CrashHandler::attach` and `minidumper::create_minidump` may differ from what's shown above. The implementor MUST check the actual crate docs:
- `crash-handler` 0.6: https://docs.rs/crash-handler/0.6
- `minidumper` 0.8: https://docs.rs/minidumper/0.8

The code above shows the intent. The actual API may use a `ServerHandler` trait pattern or different method signatures. Adapt accordingly.

**Step 2: Call install_crash_handler in main.rs**

In `main.rs`, after the panic hook call and before database initialization, add:

```rust
    // Install minidump crash handler (non-fatal if it fails)
    if let Err(e) = crash_handler::install_crash_handler() {
        eprintln!("Warning: minidump crash handler not available: {}", e);
    }
```

**Step 3: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check 2>&1 | tail -20`

This step is most likely to have compilation issues due to the minidumper API. Read the actual error messages and adapt the code to match the real crate API.

**Step 4: Commit**

```bash
git add hadron-desktop/src-tauri/src/crash_handler.rs hadron-desktop/src-tauri/src/main.rs
git commit -m "feat: add in-process minidump crash capture for native crashes"
```

---

### Task 8: Add Window Lifecycle Logging

**Files:**
- Modify: `hadron-desktop/src-tauri/src/main.rs:318-324` (on_window_event handler)

**Step 1: Enhance the window event handler with debug logging**

Replace the current `on_window_event` block (lines 318-324) with:

```rust
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    log::info!("window: {} close requested", window.label());
                    if window.label() == "main" {
                        window.app_handle().exit(0);
                    }
                }
                tauri::WindowEvent::Focused(focused) => {
                    log::debug!("window: {} focused={}", window.label(), focused);
                }
                tauri::WindowEvent::Destroyed => {
                    log::info!("window: {} destroyed", window.label());
                }
                _ => {}
            }
        })
```

**Step 2: Add startup log message**

Inside the `.setup(|app| { ... })` closure (after the global shortcut registration), add:

```rust
            log::info!(
                "Hadron {} started (crash logging active)",
                env!("CARGO_PKG_VERSION")
            );
```

**Step 3: Verify it compiles**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && cargo check 2>&1 | tail -5`
Expected: `Finished`

**Step 4: Commit**

```bash
git add hadron-desktop/src-tauri/src/main.rs
git commit -m "feat: add window lifecycle and startup logging"
```

---

### Task 9: Build and Smoke Test

**Files:** None (verification only)

**Step 1: Full build**

Run: `cd /mnt/c/Projects/Hadron_v3/hadron-desktop && npm run tauri build 2>&1 | tail -20`
Expected: Build succeeds. This is the production build that the user runs.

**Step 2: Verify log files are created**

After running the built app briefly and closing it, check:
- Windows: `%APPDATA%\hadron\logs\` should contain `hadron.log`
- The log should show Debug-level messages including `cmd:` breadcrumbs

**Step 3: Verify crash directory exists**

Check: `%APPDATA%\hadron\crashes\` directory should exist (created by crash_handler init).

**Step 4: Test panic hook (optional, dev only)**

Temporarily add a panic trigger to a command (e.g., `panic!("test crash")` in an unused command), build, trigger it, then check for a `crash-*.log` file in the logs directory. **Remove the panic trigger after testing.**

**Step 5: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: address build issues from crash logging integration"
```
