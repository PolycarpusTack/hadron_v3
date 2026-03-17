//! Crash handling: panic hook + Windows SEH handler that writes crash reports to disk.
//!
//! Catches both Rust panics and native crashes (access violation, illegal instruction,
//! stack overflow) so that silent closes produce a diagnosable log file.
//!
//! The crash log directory is configurable via Settings. The path is stored in
//! `%APPDATA%/hadron/crash_config.json` so the crash handler can read it at
//! startup before the Tauri app is fully initialized.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// Returns the hadron data directory (`%APPDATA%/hadron` or `~/.local/share/hadron`).
fn hadron_data_dir() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("hadron");
    path
}

/// Path to the crash config file.
fn config_file_path() -> PathBuf {
    hadron_data_dir().join("crash_config.json")
}

/// Read the user-configured crash log directory from `crash_config.json`.
/// Returns `None` if not configured or the file doesn't exist.
fn read_custom_crash_dir() -> Option<PathBuf> {
    let config_path = config_file_path();
    let content = fs::read_to_string(&config_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let dir_str = json.get("crash_log_dir")?.as_str()?;
    if dir_str.is_empty() {
        return None;
    }
    Some(PathBuf::from(dir_str))
}

/// Returns the directory for crash log files.
///
/// Priority:
/// 1. User-configured path from `crash_config.json`
/// 2. Default: `%APPDATA%/hadron/logs`
pub fn log_dir() -> PathBuf {
    if let Some(custom_dir) = read_custom_crash_dir() {
        // Validate the custom dir exists or can be created
        if fs::create_dir_all(&custom_dir).is_ok() {
            return custom_dir;
        }
        // Fall through to default if custom dir is unusable
        eprintln!(
            "Warning: custom crash log dir {:?} is not writable, using default",
            custom_dir
        );
    }

    let path = hadron_data_dir().join("logs");
    let _ = fs::create_dir_all(&path);
    path
}

/// Get the current crash log directory path (for display in UI).
pub fn get_crash_log_dir() -> PathBuf {
    log_dir()
}

/// Set a custom crash log directory. Pass an empty string to reset to default.
///
/// Validates that the directory exists or can be created before saving.
pub fn set_crash_log_dir(dir: &str) -> Result<PathBuf, String> {
    let config_path = config_file_path();

    if dir.is_empty() {
        // Reset to default — remove the config key
        let json = serde_json::json!({});
        let content = serde_json::to_string_pretty(&json)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        let _ = fs::create_dir_all(config_path.parent().unwrap_or(&hadron_data_dir()));
        fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        let default_dir = hadron_data_dir().join("logs");
        let _ = fs::create_dir_all(&default_dir);
        return Ok(default_dir);
    }

    let path = PathBuf::from(dir);

    // Validate the directory is usable
    fs::create_dir_all(&path)
        .map_err(|e| format!("Cannot create directory '{}': {}", dir, e))?;

    // Write a test file to verify write permissions
    let test_file = path.join(".hadron_write_test");
    fs::write(&test_file, "test")
        .map_err(|e| format!("Directory '{}' is not writable: {}", dir, e))?;
    let _ = fs::remove_file(&test_file);

    // Save to config
    let json = serde_json::json!({
        "crash_log_dir": dir,
    });
    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    let _ = fs::create_dir_all(config_path.parent().unwrap_or(&hadron_data_dir()));
    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    log::info!("Crash log directory set to: {}", dir);
    Ok(path)
}

/// Write a crash report to disk. Used by both the panic hook and the SEH handler.
fn write_crash_report(header: &str, body: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let crash_file = log_dir().join(format!("crash-{}.log", timestamp));

    let mut content = String::new();
    content.push_str("=== HADRON CRASH REPORT ===\n");
    content.push_str(&format!("Timestamp: {}\n", chrono::Local::now()));
    content.push_str(&format!("Version: {}\n", env!("CARGO_PKG_VERSION")));
    content.push_str(&format!("Crash log dir: {}\n\n", log_dir().display()));
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
        // Capped at MAX_AUTO_RESTARTS to prevent fork-bomb if the trigger persists.
        let is_tao_paint_bug = panic_info
            .location()
            .map(|l| l.file().contains("tao") && l.file().contains("event_loop"))
            .unwrap_or(false)
            || panic_info.to_string().contains("flush_paint_messages");

        if is_tao_paint_bug {
            const MAX_AUTO_RESTARTS: u32 = 2;
            let restart_count: u32 = std::env::var("HADRON_RESTART_COUNT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);

            if restart_count < MAX_AUTO_RESTARTS {
                if let Ok(exe) = std::env::current_exe() {
                    let _ = std::process::Command::new(&exe)
                        .args(std::env::args().skip(1))
                        .env("HADRON_RESTART_COUNT", (restart_count + 1).to_string())
                        .spawn();
                }
            } else {
                eprintln!(
                    "Hadron: suppressed auto-restart (already restarted {} times)",
                    restart_count
                );
            }
        }
    }));
}

/// Install a Windows Structured Exception Handler (SEH) that catches native crashes
/// (access violation, illegal instruction, stack overflow, etc.) and writes a crash
/// report before the process terminates.
///
/// On non-Windows platforms this is a no-op.
pub fn install_native_crash_handler() {
    #[cfg(target_os = "windows")]
    {
        use std::sync::Once;
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            windows_seh::set_unhandled_exception_filter();
        });
    }
}

#[cfg(target_os = "windows")]
mod windows_seh {
    //! Windows SEH integration: catches native crashes and writes detailed reports
    //! including a raw stack trace (return addresses) and loaded module map so that
    //! ACCESS_VIOLATION and other native faults can be mapped back to source.

    use std::ffi::c_void;

    const EXCEPTION_ACCESS_VIOLATION: u32 = 0xC0000005;
    const EXCEPTION_ILLEGAL_INSTRUCTION: u32 = 0xC000001D;
    const EXCEPTION_STACK_OVERFLOW: u32 = 0xC00000FD;
    const EXCEPTION_INT_DIVIDE_BY_ZERO: u32 = 0xC0000094;
    const EXCEPTION_IN_PAGE_ERROR: u32 = 0xC0000006;
    const EXCEPTION_GUARD_PAGE: u32 = 0x80000001;

    const EXCEPTION_CONTINUE_SEARCH: i32 = 0;

    #[repr(C)]
    struct ExceptionRecord {
        exception_code: u32,
        exception_flags: u32,
        exception_record: *mut ExceptionRecord,
        exception_address: *mut c_void,
        number_parameters: u32,
        exception_information: [usize; 15],
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

    // Stack trace capture
    extern "system" {
        fn RtlCaptureStackBackTrace(
            frames_to_skip: u32,
            frames_to_capture: u32,
            back_trace: *mut *mut c_void,
            back_trace_hash: *mut u32,
        ) -> u16;
    }

    // Module enumeration for address → DLL mapping
    #[repr(C)]
    struct ModuleEntry32W {
        dw_size: u32,
        th32_module_id: u32,
        th32_process_id: u32,
        glbl_cnt_usage: u32,
        proc_cnt_usage: u32,
        mod_base_addr: *mut u8,
        mod_base_size: u32,
        h_module: *mut c_void,
        sz_module: [u16; 256],
        sz_exe_path: [u16; 260],
    }

    const TH32CS_SNAPMODULE: u32 = 0x00000008;
    const TH32CS_SNAPMODULE32: u32 = 0x00000010;
    const INVALID_HANDLE: *mut c_void = -1isize as *mut c_void;

    extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> *mut c_void;
        fn Module32FirstW(h_snapshot: *mut c_void, lpme: *mut ModuleEntry32W) -> i32;
        fn Module32NextW(h_snapshot: *mut c_void, lpme: *mut ModuleEntry32W) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
        fn GetCurrentProcessId() -> u32;
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

    /// Capture raw return addresses from the current call stack.
    unsafe fn capture_stack_trace() -> String {
        const MAX_FRAMES: u32 = 64;
        let mut frames: [*mut c_void; 64] = [std::ptr::null_mut(); 64];
        let count = unsafe {
            RtlCaptureStackBackTrace(
                2, // skip this fn + the exception filter
                MAX_FRAMES,
                frames.as_mut_ptr(),
                std::ptr::null_mut(),
            )
        };

        if count == 0 {
            return "  (no frames captured)\n".to_string();
        }

        let mut out = String::new();
        for i in 0..count as usize {
            out.push_str(&format!("  [{:2}] 0x{:016X}\n", i, frames[i] as usize));
        }
        out
    }

    /// List loaded modules (DLLs) with base address and size for offline addr2line.
    unsafe fn capture_module_map() -> String {
        let pid = unsafe { GetCurrentProcessId() };
        let snap = unsafe {
            CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
        };
        if snap == INVALID_HANDLE || snap.is_null() {
            return "  (failed to enumerate modules)\n".to_string();
        }

        let mut entry: ModuleEntry32W = unsafe { std::mem::zeroed() };
        entry.dw_size = std::mem::size_of::<ModuleEntry32W>() as u32;

        let mut out = String::new();
        let mut ok = unsafe { Module32FirstW(snap, &mut entry) } != 0;

        while ok {
            let base = entry.mod_base_addr as usize;
            let size = entry.mod_base_size as usize;
            let name = String::from_utf16_lossy(
                &entry.sz_module[..entry.sz_module.iter().position(|&c| c == 0).unwrap_or(256)],
            );
            out.push_str(&format!(
                "  0x{:016X} - 0x{:016X}  {}\n",
                base,
                base + size,
                name
            ));
            ok = unsafe { Module32NextW(snap, &mut entry) } != 0;
        }

        unsafe { CloseHandle(snap) };
        out
    }

    unsafe extern "system" fn hadron_exception_filter(
        info: *mut ExceptionPointers,
    ) -> i32 {
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

        let description = match code {
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

        // Capture stack trace and module map for offline analysis
        let stack = unsafe { capture_stack_trace() };
        let modules = unsafe { capture_module_map() };

        let body = format!(
            "{}\nStack trace (raw return addresses):\n{}\nLoaded modules:\n{}\n\
             To resolve: match the crash address against module base ranges above,\n\
             then use `addr2line -e <module> <offset>` where offset = address - base.\n",
            description, stack, modules
        );

        super::write_crash_report(&header, &body);

        EXCEPTION_CONTINUE_SEARCH
    }

    pub unsafe fn set_unhandled_exception_filter() {
        unsafe {
            SetUnhandledExceptionFilter(Some(hadron_exception_filter));
        }
    }
}
