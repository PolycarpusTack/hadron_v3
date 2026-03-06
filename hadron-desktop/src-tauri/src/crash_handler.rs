//! Crash handling: panic hook + Windows SEH handler that writes crash reports to disk.
//!
//! Catches both Rust panics and native crashes (access violation, illegal instruction,
//! stack overflow) so that silent closes produce a diagnosable log file.

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

/// Write a crash report to disk. Used by both the panic hook and the SEH handler.
fn write_crash_report(header: &str, body: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let crash_file = log_dir().join(format!("crash-{}.log", timestamp));

    let mut content = String::new();
    content.push_str("=== HADRON CRASH REPORT ===\n");
    content.push_str(&format!("Timestamp: {}\n", chrono::Local::now()));
    content.push_str(&format!("Version: {}\n\n", env!("CARGO_PKG_VERSION")));
    content.push_str(header);
    content.push('\n');
    content.push_str(body);

    if let Ok(mut file) = fs::File::create(&crash_file) {
        let _ = file.write_all(content.as_bytes());
        let _ = file.flush();
    }

    eprintln!("{}", content);
}

/// Install the panic hook. Must be called BEFORE tauri::Builder.
/// Writes panic info + backtrace to a crash-{timestamp}.log file.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        let panic_msg = format!("Panic: {}\n", panic_info);

        let location = if let Some(loc) = panic_info.location() {
            format!("Location: {}:{}:{}\n\n", loc.file(), loc.line(), loc.column())
        } else {
            String::new()
        };

        let backtrace = std::backtrace::Backtrace::force_capture();
        let body = format!("{}{}\nBacktrace:\n{}\n", panic_msg, location, backtrace);

        write_crash_report("Type: Rust panic\n", &body);

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

/// Install a Windows Structured Exception Handler (SEH) that catches native crashes
/// (access violation, illegal instruction, stack overflow, etc.) and writes a crash
/// report before the process terminates.
///
/// This covers the gap that the Rust panic hook cannot: crashes in C libraries
/// (SQLite, Keeper SDK, webview) and CPU-level faults like SIGILL.
///
/// On non-Windows platforms this is a no-op.
pub fn install_native_crash_handler() {
    #[cfg(target_os = "windows")]
    {
        use std::sync::Once;
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            // SetUnhandledExceptionFilter — catches unhandled SEH exceptions.
            // This is the last resort before the process dies.
            windows_seh::set_unhandled_exception_filter();
        });
    }
}

#[cfg(target_os = "windows")]
mod windows_seh {
    //! Minimal Windows SEH integration using raw FFI.
    //! No external crate needed — just kernel32 + ntdll types.

    use std::ffi::c_void;

    // Windows exception codes
    const EXCEPTION_ACCESS_VIOLATION: u32 = 0xC0000005;
    const EXCEPTION_ILLEGAL_INSTRUCTION: u32 = 0xC000001D;
    const EXCEPTION_STACK_OVERFLOW: u32 = 0xC00000FD;
    const EXCEPTION_INT_DIVIDE_BY_ZERO: u32 = 0xC0000094;
    const EXCEPTION_IN_PAGE_ERROR: u32 = 0xC0000006;
    const EXCEPTION_GUARD_PAGE: u32 = 0x80000001;

    // Return value: continue search (let Windows show the error dialog after we log)
    const EXCEPTION_CONTINUE_SEARCH: i32 = 0;

    #[repr(C)]
    struct ExceptionRecord {
        exception_code: u32,
        exception_flags: u32,
        exception_record: *mut ExceptionRecord,
        exception_address: *mut c_void,
        number_parameters: u32,
        exception_information: [usize; 15], // EXCEPTION_MAXIMUM_PARAMETERS
    }

    #[repr(C)]
    struct ExceptionPointers {
        exception_record: *mut ExceptionRecord,
        _context_record: *mut c_void,
    }

    type UnhandledExceptionFilter =
        unsafe extern "system" fn(*mut ExceptionPointers) -> i32;

    extern "system" {
        fn SetUnhandledExceptionFilter(
            filter: Option<UnhandledExceptionFilter>,
        ) -> Option<UnhandledExceptionFilter>;
    }

    fn exception_code_name(code: u32) -> &'static str {
        match code {
            EXCEPTION_ACCESS_VIOLATION => "ACCESS_VIOLATION (0xC0000005)",
            EXCEPTION_ILLEGAL_INSTRUCTION => "ILLEGAL_INSTRUCTION (0xC000001D)",
            EXCEPTION_STACK_OVERFLOW => "STACK_OVERFLOW (0xC00000FD)",
            EXCEPTION_INT_DIVIDE_BY_ZERO => "INT_DIVIDE_BY_ZERO (0xC0000094)",
            EXCEPTION_IN_PAGE_ERROR => "IN_PAGE_ERROR (0xC0000006)",
            EXCEPTION_GUARD_PAGE => "GUARD_PAGE (0x80000001)",
            _ => "UNKNOWN",
        }
    }

    unsafe extern "system" fn hadron_exception_filter(
        info: *mut ExceptionPointers,
    ) -> i32 {
        // Safety: we're in a crash handler — do minimal work, no allocations if possible.
        // But we need to write a useful report, so we accept the risk of String allocation.
        if info.is_null() {
            return EXCEPTION_CONTINUE_SEARCH;
        }

        let record = unsafe { &*(*info).exception_record };
        let code = record.exception_code;
        let address = record.exception_address;

        let header = format!(
            "Type: Windows SEH exception\nException: {} (0x{:08X})\nAddress: {:?}\n",
            exception_code_name(code),
            code,
            address,
        );

        let body = match code {
            EXCEPTION_ACCESS_VIOLATION if record.number_parameters >= 2 => {
                let op = if record.exception_information[0] == 0 { "read" } else { "write" };
                format!(
                    "Attempted {} of address 0x{:016X}\n\n\
                     This is a memory safety violation in native code (C/C++ library or FFI).\n\
                     Common causes: use-after-free, null pointer dereference, buffer overflow.\n",
                    op, record.exception_information[1]
                )
            }
            EXCEPTION_ILLEGAL_INSTRUCTION => {
                "The CPU encountered an instruction it cannot execute.\n\n\
                 Common causes:\n\
                 - Binary compiled with AVX/AVX2 but running on a CPU that only supports SSE2\n\
                 - Corrupted executable or DLL\n\
                 - Jump to invalid/non-code memory\n\n\
                 Fix: rebuild with target-cpu=x86-64 in .cargo/config.toml\n"
                    .to_string()
            }
            EXCEPTION_STACK_OVERFLOW => {
                "Stack overflow detected.\n\n\
                 Common causes: infinite recursion, very deep call chains, large stack allocations.\n"
                    .to_string()
            }
            _ => format!("Exception code: 0x{:08X}\n", code),
        };

        super::write_crash_report(&header, &body);

        EXCEPTION_CONTINUE_SEARCH
    }

    pub unsafe fn set_unhandled_exception_filter() {
        unsafe {
            SetUnhandledExceptionFilter(Some(hadron_exception_filter));
        }
    }
}
