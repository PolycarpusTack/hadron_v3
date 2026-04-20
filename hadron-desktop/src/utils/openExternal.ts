import logger from "../services/logger";

/**
 * Open an external URL in the user's default browser.
 *
 * Replaces `open` from `@tauri-apps/plugin-shell`, which was imported by
 * ten components but never registered on the Rust side of the Tauri app
 * (the plugin crate was missing from `Cargo.toml`, so every call was a
 * runtime no-op). The audit (F9, 2026-04-20) flagged this both as a
 * functional bug and as a hazard: if someone later added the plugin to
 * "fix" link opening without a scheme allowlist, AI-authored hrefs could
 * route into `open("file:///etc/passwd")` or `open("javascript:...")`.
 *
 * This helper:
 *   1. Requires the URL to start with `https://` — no http, file, javascript,
 *      or custom schemes. That rules out local-file exfiltration and XSS-
 *      like payloads even when the href came from AI output or untrusted
 *      content embedded in chat, JIRA descriptions, etc.
 *   2. Uses `window.open(url, "_blank", "noopener,noreferrer")`. In a
 *      Tauri WebView2 context, external navigations with target=_blank
 *      are handed off to the OS default browser, which is what every
 *      call site already expected.
 *
 * The Promise shape matches the old plugin-shell API so no call site
 * needs to change beyond its import.
 */
export async function openExternal(url: string): Promise<void> {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    logger.warn("openExternal: refusing non-https URL", { url });
    throw new Error("Only https:// URLs are allowed");
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    logger.error("openExternal: window.open threw", { error: String(e), url });
    throw e instanceof Error ? e : new Error(String(e));
  }
}
