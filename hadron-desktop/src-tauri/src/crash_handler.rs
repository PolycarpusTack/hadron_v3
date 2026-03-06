//! Crash handling: panic hook that writes crash reports to disk.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

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

        // Auto-restart for the known tao Windows event-loop re-entrancy bug.
        // https://github.com/tauri-apps/tao/issues/1140
        // Triggered by device changes (Bluetooth, VPN, USB) during a paint cycle.
        // Safe to restart: the panic is in the UI layer; SQLite WAL survives unclean exit.
        let is_tao_paint_bug = panic_info
            .location()
            .map(|l| l.file().contains("tao") && l.file().contains("event_loop"))
            .unwrap_or(false)
            || panic_info.to_string().contains("flush_paint_messages");

        if is_tao_paint_bug {
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(&exe)
                    .args(std::env::args().skip(1))
                    .spawn();
            }
        }
    }));
}
