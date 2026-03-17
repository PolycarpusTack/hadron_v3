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
    //! Minimal Windows SEH handler.
    //!
    //! After a native crash (ACCESS_VIOLATION, ILLEGAL_INSTRUCTION, etc.) the
    //! process heap may be corrupt, so we avoid all heap allocation in the hot
    //! path.  The strategy is:
    //!
    //! 1. **Write a MiniDump** via `MiniDumpWriteDump` — a single kernel call
    //!    that captures full thread/stack/module state without touching the heap.
    //!    This is the primary diagnostic artifact.
    //!
    //! 2. **Write a small text report** to a pre-allocated static buffer using
    //!    `core::fmt::Write` on a `&mut [u8]` — no String/format! allocation.
    //!    Contains the exception code, address, and raw stack frames.
    //!
    //! 3. **Flush the buffer** to disk via `CreateFileW`/`WriteFile` (kernel32),
    //!    bypassing Rust's std::fs which may allocate.

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
        context_record: *mut c_void,
    }

    type UnhandledExceptionFilter =
        unsafe extern "system" fn(*mut ExceptionPointers) -> i32;

    extern "system" {
        fn SetUnhandledExceptionFilter(
            filter: Option<UnhandledExceptionFilter>,
        ) -> Option<UnhandledExceptionFilter>;
        fn RtlCaptureStackBackTrace(
            frames_to_skip: u32,
            frames_to_capture: u32,
            back_trace: *mut *mut c_void,
            back_trace_hash: *mut u32,
        ) -> u16;
        fn GetCurrentProcessId() -> u32;
        fn GetCurrentThreadId() -> u32;
        fn GetCurrentProcess() -> *mut c_void;
    }

    // MiniDump support
    const MINIDUMP_NORMAL: u32 = 0x00000000;
    const MINIDUMP_WITH_THREAD_INFO: u32 = 0x00001000;
    const MINIDUMP_WITH_MODULE_HEADERS: u32 = 0x00080000;

    #[repr(C)]
    struct MinidumpExceptionInformation {
        thread_id: u32,
        exception_pointers: *mut ExceptionPointers,
        client_pointers: i32, // BOOL
    }

    extern "system" {
        // dbghelp.dll
        fn MiniDumpWriteDump(
            h_process: *mut c_void,
            process_id: u32,
            h_file: *mut c_void,
            dump_type: u32,
            exception_param: *const MinidumpExceptionInformation,
            user_stream_param: *const c_void,
            callback_param: *const c_void,
        ) -> i32;

        // kernel32.dll — file I/O without heap
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *const c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: *mut c_void,
        ) -> *mut c_void;
        fn WriteFile(
            h_file: *mut c_void,
            buffer: *const u8,
            number_of_bytes_to_write: u32,
            number_of_bytes_written: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    const GENERIC_WRITE: u32 = 0x40000000;
    const CREATE_ALWAYS: u32 = 2;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
    const INVALID_HANDLE: *mut c_void = -1isize as *mut c_void;

    fn exception_code_name(code: u32) -> &'static str {
        match code {
            EXCEPTION_ACCESS_VIOLATION => "ACCESS_VIOLATION",
            EXCEPTION_ILLEGAL_INSTRUCTION => "ILLEGAL_INSTRUCTION",
            EXCEPTION_STACK_OVERFLOW => "STACK_OVERFLOW",
            EXCEPTION_INT_DIVIDE_BY_ZERO => "INT_DIVIDE_BY_ZERO",
            EXCEPTION_IN_PAGE_ERROR => "IN_PAGE_ERROR",
            EXCEPTION_GUARD_PAGE => "GUARD_PAGE",
            _ => "UNKNOWN",
        }
    }

    /// Fixed-capacity buffer that implements core::fmt::Write without allocating.
    struct StackBuf {
        buf: [u8; Self::CAPACITY],
        pos: usize,
    }

    impl StackBuf {
        const CAPACITY: usize = 8192;

        const fn new() -> Self {
            Self {
                buf: [0u8; Self::CAPACITY],
                pos: 0,
            }
        }

        fn as_bytes(&self) -> &[u8] {
            &self.buf[..self.pos]
        }
    }

    impl core::fmt::Write for StackBuf {
        fn write_str(&mut self, s: &str) -> core::fmt::Result {
            let bytes = s.as_bytes();
            let remaining = Self::CAPACITY - self.pos;
            let len = bytes.len().min(remaining);
            self.buf[self.pos..self.pos + len].copy_from_slice(&bytes[..len]);
            self.pos += len;
            Ok(())
        }
    }

    /// Encode a path as null-terminated UTF-16 into a stack buffer.
    fn path_to_wide(path: &str, out: &mut [u16; 512]) -> usize {
        let mut i = 0;
        for ch in path.encode_utf16() {
            if i >= 511 { break; }
            out[i] = ch;
            i += 1;
        }
        out[i] = 0;
        i
    }

    /// Write a MiniDump file — single kernel call, no heap.
    unsafe fn write_minidump(info: *mut ExceptionPointers) {
        let dump_dir = super::log_dir();
        let dump_path = format!(
            "{}\\crash-{}.dmp",
            dump_dir.display(),
            // Use a simple counter instead of chrono to avoid allocation
            unsafe { GetCurrentProcessId() }
        );

        let mut wide_path = [0u16; 512];
        path_to_wide(&dump_path, &mut wide_path);

        let h_file = unsafe {
            CreateFileW(
                wide_path.as_ptr(),
                GENERIC_WRITE,
                0,
                std::ptr::null(),
                CREATE_ALWAYS,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            )
        };

        if h_file == INVALID_HANDLE || h_file.is_null() {
            return;
        }

        let exc_info = MinidumpExceptionInformation {
            thread_id: unsafe { GetCurrentThreadId() },
            exception_pointers: info,
            client_pointers: 0, // FALSE
        };

        let dump_type = MINIDUMP_NORMAL | MINIDUMP_WITH_THREAD_INFO | MINIDUMP_WITH_MODULE_HEADERS;

        unsafe {
            MiniDumpWriteDump(
                GetCurrentProcess(),
                GetCurrentProcessId(),
                h_file,
                dump_type,
                &exc_info,
                std::ptr::null(),
                std::ptr::null(),
            );
            CloseHandle(h_file);
        }
    }

    /// Write the text crash report using only stack-allocated buffers.
    unsafe fn write_text_report(record: &ExceptionRecord) {
        use core::fmt::Write;

        let mut buf = StackBuf::new();
        let code = record.exception_code;
        let addr = record.exception_address as usize;

        let _ = write!(buf, "=== HADRON CRASH REPORT ===\n");
        let _ = write!(buf, "Version: {}\n", env!("CARGO_PKG_VERSION"));
        let _ = write!(buf, "PID: {}\n\n", unsafe { GetCurrentProcessId() });
        let _ = write!(
            buf,
            "Type: Windows SEH exception\nException: {} (0x{:08X})\nAddress: 0x{:016X}\n\n",
            exception_code_name(code), code, addr,
        );

        // Exception-specific detail
        match code {
            EXCEPTION_ACCESS_VIOLATION if record.number_parameters >= 2 => {
                let op = if record.exception_information[0] == 0 { "read" } else { "write" };
                let target = record.exception_information[1];
                let _ = write!(buf, "Attempted {} of address 0x{:016X}\n\n", op, target);
            }
            EXCEPTION_ILLEGAL_INSTRUCTION => {
                let _ = write!(buf, "CPU cannot execute instruction at crash address.\n");
                let _ = write!(buf, "Fix: rebuild with target-cpu=x86-64 in .cargo/config.toml\n\n");
            }
            EXCEPTION_STACK_OVERFLOW => {
                let _ = write!(buf, "Stack overflow detected.\n\n");
            }
            _ => {}
        }

        // Raw stack trace (no heap — frames on stack)
        let _ = write!(buf, "Stack trace:\n");
        const MAX_FRAMES: u32 = 48;
        let mut frames: [*mut c_void; 48] = [std::ptr::null_mut(); 48];
        let count = unsafe {
            RtlCaptureStackBackTrace(2, MAX_FRAMES, frames.as_mut_ptr(), std::ptr::null_mut())
        };
        for i in 0..count as usize {
            let _ = write!(buf, "  [{:2}] 0x{:016X}\n", i, frames[i] as usize);
        }
        if count == 0 {
            let _ = write!(buf, "  (no frames captured)\n");
        }

        let _ = write!(buf, "\nA .dmp minidump file was also written (if dbghelp.dll is available).\n");
        let _ = write!(buf, "Open the .dmp in WinDbg or Visual Studio for full stack + module info.\n");

        // Write to file via kernel32 (no std::fs allocation)
        let log_dir = super::log_dir();
        let text_path = format!(
            "{}\\crash-{}.log",
            log_dir.display(),
            unsafe { GetCurrentProcessId() }
        );
        let mut wide_path = [0u16; 512];
        path_to_wide(&text_path, &mut wide_path);

        let h_file = unsafe {
            CreateFileW(
                wide_path.as_ptr(),
                GENERIC_WRITE,
                0,
                std::ptr::null(),
                CREATE_ALWAYS,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            )
        };

        if h_file != INVALID_HANDLE && !h_file.is_null() {
            let bytes = buf.as_bytes();
            let mut written: u32 = 0;
            unsafe {
                WriteFile(
                    h_file,
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    &mut written,
                    std::ptr::null_mut(),
                );
                CloseHandle(h_file);
            }
        }

        // Also write to stderr (best effort)
        let _ = std::io::Write::write_all(&mut std::io::stderr(), buf.as_bytes());
    }

    unsafe extern "system" fn hadron_exception_filter(
        info: *mut ExceptionPointers,
    ) -> i32 {
        if info.is_null() {
            return EXCEPTION_CONTINUE_SEARCH;
        }

        // 1. Write minidump first — single kernel call, most robust
        unsafe { write_minidump(info) };

        // 2. Write minimal text report using stack-allocated buffer
        let record = unsafe { &*(*info).exception_record };
        unsafe { write_text_report(record) };

        EXCEPTION_CONTINUE_SEARCH
    }

    pub unsafe fn set_unhandled_exception_filter() {
        unsafe {
            SetUnhandledExceptionFilter(Some(hadron_exception_filter));
        }
    }
}
