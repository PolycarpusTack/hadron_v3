//! WebView2 process-failure recovery handlers (Windows only).
//!
//! Registers `ICoreWebView2::add_ProcessFailed` on the main WebView's
//! `CoreWebView2`, plus `add_BrowserProcessExited` on the
//! `CoreWebView2Environment`, and logs every failure with its kind, exit
//! code, and a sliding 60-second crash counter.
//!
//! Response per failure kind:
//!
//! - `RenderProcessExited` / `FrameRenderProcessExited` /
//!   `RenderProcessUnresponsive` → attempt `Reload()` (up to 3 times per
//!   60 seconds; after that we stop and log an error so the user sees a
//!   crashloop rather than an infinite reload storm).
//! - `BrowserProcessExited` → cannot self-recover; log error so support
//!   has a timestamped crash to cross-reference.
//! - Any other kind (GPU, utility, sandbox-helper, PPAPI) →
//!   log only. Per Microsoft's guidance these are usually auto-recovered
//!   by WebView2 itself.
//!
//! Background: ESET's WebView2 hook can destabilise renderer / GPU /
//! utility processes on Windows. Without these handlers the app
//! manifests as a blank view or frozen UI. See
//! <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/measures>
//! and <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events>.

#[cfg(target_os = "windows")]
pub fn install_recovery(window: &tauri::WebviewWindow) {
    let label = window.label().to_string();
    if let Err(e) = window.with_webview(move |webview| {
        windows_impl::install_on_main_thread(&label, webview);
    }) {
        log::warn!(
            "WebView2 recovery: could not dispatch to main thread for window '{}': {e}",
            window.label()
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn install_recovery(_window: &tauri::WebviewWindow) {
    // WebView2 is Windows-only. On other platforms the webkit2gtk /
    // WKWebView lifecycles are handled by their own runtimes.
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use once_cell::sync::Lazy;
    use parking_lot::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };
    use webview2_com::{BrowserProcessExitedEventHandler, ProcessFailedEventHandler};

    const CRASH_WINDOW_MS: u64 = 60_000;
    const MAX_RELOADS_IN_WINDOW: usize = 3;

    /// Timestamps of recent crashes (ms since epoch). Retained only for
    /// the last `CRASH_WINDOW_MS`.
    static RECENT_CRASHES: Lazy<Mutex<Vec<u64>>> = Lazy::new(|| Mutex::new(Vec::new()));

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Record a crash in the sliding window and return how many have
    /// happened within it.
    fn record_crash_and_count() -> usize {
        let now = now_ms();
        let mut crashes = RECENT_CRASHES.lock();
        crashes.retain(|&t| now.saturating_sub(t) < CRASH_WINDOW_MS);
        crashes.push(now);
        crashes.len()
    }

    pub fn install_on_main_thread(label: &str, webview: PlatformWebview) {
        let label = label.to_string();

        // 1) Register ProcessFailed on the CoreWebView2 (renderer/GPU/etc).
        unsafe {
            let controller = webview.controller();
            let core = match controller.CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "WebView2 recovery: could not resolve CoreWebView2 for '{label}': {e}"
                    );
                    return;
                }
            };

            let label_for_process_failed = label.clone();
            let handler = ProcessFailedEventHandler::create(Box::new(
                // SAFETY: COM vtable methods on `ICoreWebView2ProcessFailedEventArgs`
                // and `ICoreWebView2::Reload` are declared `unsafe fn` in the
                // windows-rs bindings. Each call site below wraps them in its
                // own `unsafe` block because closure bodies have an independent
                // unsafety scope (the `unsafe` block around handler creation
                // does not propagate in). All arguments are checked for None /
                // error before use, so no invalid pointers are dereferenced.
                move |sender, args| {
                    let Some(args) = args else { return Ok(()); };
                    let kind = unsafe { args.ProcessFailedKind() }.unwrap_or_default();
                    let exit_code = unsafe { args.ExitCode() }.unwrap_or(0);
                    let count = record_crash_and_count();

                    log::error!(
                        "WebView2 process failed: window='{label_for_process_failed}' kind={:?} exit_code={exit_code} crashes_in_60s={count}",
                        kind.0
                    );

                    let is_renderer = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                        || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED
                        || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
                    let is_browser = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;

                    if is_renderer {
                        if count <= MAX_RELOADS_IN_WINDOW {
                            if let Some(sender) = sender.as_ref() {
                                match unsafe { sender.Reload() } {
                                    Ok(()) => log::info!(
                                        "WebView2 recovery: reloaded '{label_for_process_failed}' after renderer exit ({count}/{} in 60s)",
                                        MAX_RELOADS_IN_WINDOW
                                    ),
                                    Err(e) => log::warn!(
                                        "WebView2 recovery: Reload failed for '{label_for_process_failed}': {e}"
                                    ),
                                }
                            }
                        } else {
                            log::error!(
                                "WebView2 recovery: '{label_for_process_failed}' has crashed {count} times in 60s — suppressing auto-reload to avoid crashloop (user intervention required)"
                            );
                        }
                    } else if is_browser {
                        log::error!(
                            "WebView2 recovery: browser process for '{label_for_process_failed}' exited — app cannot self-recover; user will need to restart"
                        );
                    }
                    // GPU / utility / PPAPI / sandbox-helper: auto-recovered by
                    // WebView2. We log at error level above so there is a
                    // record, but take no active recovery action here.

                    Ok(())
                },
            ));

            let mut token = Default::default();
            if let Err(e) = core.add_ProcessFailed(&handler, &mut token) {
                log::warn!(
                    "WebView2 recovery: could not register ProcessFailed for '{label}': {e}"
                );
            } else {
                log::info!("WebView2 recovery: ProcessFailed handler installed for '{label}'");
            }
            // The COM subscription keeps an internal ref; the Rust wrapper
            // can drop safely without detaching the handler.
            std::mem::forget(handler);
        }

        // 2) Register BrowserProcessExited on the Environment. Fires after
        //    the whole WebView2 browser process (the parent of all
        //    renderer/GPU workers) has gone away; the app cannot use this
        //    WebView instance afterwards, but at least it lets us log the
        //    exit reason and counter for support.
        unsafe {
            let environment = webview.environment();
            let label_for_browser = label.clone();
            let handler = BrowserProcessExitedEventHandler::create(Box::new(
                // SAFETY: see the SAFETY note on the ProcessFailed handler;
                // every COM call in this closure is individually wrapped.
                move |_env, args| {
                    if let Some(args) = args {
                        let kind = unsafe { args.BrowserProcessExitKind() }.unwrap_or_default();
                        let pid = unsafe { args.BrowserProcessId() }.unwrap_or(0);
                        let count = record_crash_and_count();
                        log::error!(
                            "WebView2 browser process exited: window='{label_for_browser}' kind={:?} pid={pid} crashes_in_60s={count}",
                            kind.0
                        );
                    } else {
                        log::error!(
                            "WebView2 browser process exited: window='{label_for_browser}' (no args)"
                        );
                    }
                    Ok(())
                },
            ));
            let mut token = Default::default();
            if let Err(e) = environment.add_BrowserProcessExited(&handler, &mut token) {
                log::warn!(
                    "WebView2 recovery: could not register BrowserProcessExited for '{label}': {e}"
                );
            } else {
                log::info!(
                    "WebView2 recovery: BrowserProcessExited handler installed for '{label}'"
                );
            }
            std::mem::forget(handler);
        }
    }
}
