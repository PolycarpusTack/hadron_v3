fn main() {
    // Link dbghelp.dll for MiniDumpWriteDump in the crash handler.
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "windows" {
        println!("cargo:rustc-link-lib=dbghelp");
    }
    tauri_build::build()
}
