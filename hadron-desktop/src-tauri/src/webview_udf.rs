//! WebView2 user-data-folder configuration (Windows only).
//!
//! Sets `WEBVIEW2_USER_DATA_FOLDER` to
//! `%LOCALAPPDATA%\Hadron\WebView2` before the Tauri runtime creates the
//! webview. WebView2 respects this environment variable via its standard
//! loader, so this is a portable override that doesn't require a
//! programmatic webview builder rewrite.
//!
//! Why it matters:
//!
//! - Microsoft's guidance says WebView2 needs stable write access to its
//!   UDF, and that placing it on a network share or a location the
//!   security product protects can cause init failures or state
//!   corruption. Explicitly pinning it to a user-local directory gives
//!   the runtime a path it owns.
//! - Crash dumps land at `EBWebView\Crashpad\reports\` inside the UDF.
//!   Moving the UDF to a known location under `%LOCALAPPDATA%\Hadron\`
//!   makes those dumps easy to find for support triage.
//! - If an admin ever does get to configure ESET, a single folder
//!   exclusion on `%LOCALAPPDATA%\Hadron\WebView2` is the cleanest
//!   scoped exclusion.

#[cfg(target_os = "windows")]
pub fn configure_udf() {
    use std::path::PathBuf;

    // Respect an existing operator override if one is already set.
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        log::info!(
            "WebView2 UDF: WEBVIEW2_USER_DATA_FOLDER already set by environment, leaving it alone"
        );
        return;
    }

    let local_data = match std::env::var("LOCALAPPDATA") {
        Ok(p) if !p.is_empty() => p,
        _ => {
            log::warn!(
                "WebView2 UDF: LOCALAPPDATA is not set — falling back to WebView2 default location"
            );
            return;
        }
    };

    let udf = PathBuf::from(local_data).join("Hadron").join("WebView2");
    if let Err(e) = std::fs::create_dir_all(&udf) {
        log::warn!(
            "WebView2 UDF: could not create {} ({e}) — falling back to WebView2 default",
            udf.display()
        );
        return;
    }

    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &udf);
    log::info!("WebView2 UDF: set WEBVIEW2_USER_DATA_FOLDER to {}", udf.display());
}

#[cfg(not(target_os = "windows"))]
pub fn configure_udf() {
    // No-op on non-Windows; the UDF concept is WebView2-specific.
}
