//! Crash handling: panic hook + minidump capture.
//!
//! The panic hook writes a crash log to disk before the process terminates.
//! The minidump handler captures native crashes (segfault, abort, stack overflow)
//! by running a monitor in a child process that writes .dmp files via ptrace.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// Argument passed to the re-launched executable to start as crash monitor.
pub const CRASH_MONITOR_ARG: &str = "--crash-monitor";

/// Returns the socket path for IPC between the app and crash monitor.
/// Uses temp dir to avoid triggering Tauri's dev file watcher.
fn socket_path() -> PathBuf {
    std::env::temp_dir().join("hadron-crash-monitor")
}

/// Returns the directory for crash artifacts (minidumps).
/// Creates it if it doesn't exist.
fn crash_dir() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("hadron");
    path.push("crashes");
    let _ = fs::create_dir_all(&path);
    path
}

/// Returns the directory for log files.
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
        content.push_str("=== HADRON CRASH REPORT ===\n");
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

// =============================================================================
// Minidump crash monitor (runs in a child process)
// =============================================================================

/// ServerHandler implementation that writes minidumps to the crashes directory.
struct CrashDumpHandler;

impl minidumper::ServerHandler for CrashDumpHandler {
    fn create_minidump_file(&self) -> Result<(fs::File, PathBuf), std::io::Error> {
        let dir = crash_dir();
        let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        let dump_path = dir.join(format!("{}.dmp", timestamp));
        let file = fs::File::create(&dump_path)?;
        Ok((file, dump_path))
    }

    fn on_minidump_created(
        &self,
        result: Result<minidumper::MinidumpBinary, minidumper::Error>,
    ) -> minidumper::LoopAction {
        match result {
            Ok(mut md_bin) => {
                let _ = md_bin.file.flush();
                // Write a companion text file with basic info
                let info_path = md_bin.path.with_extension("txt");
                let _ = fs::write(
                    &info_path,
                    format!(
                        "=== HADRON NATIVE CRASH ===\nTimestamp: {}\nVersion: {}\nDump: {}\n",
                        chrono::Local::now(),
                        env!("CARGO_PKG_VERSION"),
                        md_bin.path.display(),
                    ),
                );
            }
            Err(e) => {
                let dir = crash_dir();
                let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
                let err_path = dir.join(format!("minidump-failed-{}.txt", timestamp));
                let _ = fs::write(&err_path, format!("Failed to write minidump: {}\n", e));
            }
        }
        // Exit the monitor after handling the crash
        minidumper::LoopAction::Exit
    }

    fn on_message(&self, _kind: u32, _buffer: Vec<u8>) {
        // We don't use custom messages
    }
}

/// Run the crash monitor server. Called when the process is started with
/// `--crash-monitor`. This blocks until the monitored process crashes or exits.
pub fn run_crash_monitor() -> ! {
    let mut server =
        minidumper::Server::with_name(socket_path().as_path()).expect("failed to create crash monitor server");

    let shutdown = std::sync::atomic::AtomicBool::new(false);
    let _ = server.run(Box::new(CrashDumpHandler), &shutdown, None);

    std::process::exit(0);
}

// =============================================================================
// Crash handler client (runs in the main app process)
// =============================================================================

/// Keeps the crash handler and monitor process alive for the process lifetime.
struct CrashGuard {
    _handler: crash_handler::CrashHandler,
    _monitor: std::process::Child,
}

static CRASH_GUARD: std::sync::OnceLock<CrashGuard> = std::sync::OnceLock::new();

/// Install the crash handler that captures native crashes (segfault, abort, etc.)
/// and writes minidumps via an out-of-process monitor.
///
/// This spawns the current executable with `--crash-monitor` as a child process,
/// connects to it via IPC, and registers a signal/exception handler that requests
/// a minidump on crash.
///
/// Non-fatal if it fails — the app runs fine without minidump capture.
pub fn install_crash_handler() -> Result<(), String> {
    // Spawn the monitor as a child process (same binary, different mode)
    let exe = std::env::current_exe().map_err(|e| format!("Can't find executable: {}", e))?;
    let monitor = std::process::Command::new(&exe)
        .arg(CRASH_MONITOR_ARG)
        .spawn()
        .map_err(|e| format!("Failed to spawn crash monitor: {}", e))?;

    // Give the monitor time to start and create the socket
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Connect to the monitor
    let client = minidumper::Client::with_name(socket_path().as_path())
        .map_err(|e| format!("Failed to connect to crash monitor: {}", e))?;

    // Register the signal/exception handler
    let handler = crash_handler::CrashHandler::attach(unsafe {
        crash_handler::make_crash_event(move |crash_context: &crash_handler::CrashContext| {
            crash_handler::CrashEventResult::Handled(
                client.request_dump(crash_context).is_ok(),
            )
        })
    })
    .map_err(|e| format!("Failed to attach crash handler: {}", e))?;

    // Allow the monitor to ptrace this process (Linux-specific)
    #[cfg(any(target_os = "linux", target_os = "android"))]
    handler.set_ptracer(Some(monitor.id()));

    CRASH_GUARD
        .set(CrashGuard {
            _handler: handler,
            _monitor: monitor,
        })
        .map_err(|_| "Crash handler already installed".to_string())?;

    Ok(())
}
