# CodexMgX Investigation Integration — Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate CodexMgX investigation capabilities into Hadron as a native Rust library (`hadron-investigation` crate), exposing deep Jira/Confluence investigation in AskHadron chat, the JIRA Analyzer, and the Elena widget — with full desktop and web parity.

**Architecture:** New `hadron-investigation` crate in `hadron-web/crates/` translates the CodexMgX PowerShell investigation engine to Rust. Desktop references it as a path dependency; web server uses it via Axum route handlers. Both platforms share identical investigation output types serialised to JSON.

**Tech Stack:** Rust (tokio, reqwest 0.12, serde_json, lopdf, zip, roxmltree, regex), Tauri v2 (desktop), Axum 0.8 (web), React/TypeScript (both frontends), lucide-react icons

**Design spec:** `docs/superpowers/specs/2026-04-27-codexmgx-integration-design.md`

---

## Phases

The plan is split into 5 files to stay within token limits. Execute them in order.

| Phase | File | Tasks | Scope |
|-------|------|-------|-------|
| 1 | [phase1-crate](2026-04-27-codexmgx-phase1-crate.md) | 1–12 | `hadron-investigation` Rust crate — all API + orchestrators |
| 2 | [phase2-desktop](2026-04-27-codexmgx-phase2-desktop.md) | 13–15 | Desktop Tauri commands, chat tools, AskHadron labels |
| 3 | [phase3-web](2026-04-27-codexmgx-phase3-web.md) | 16–17 | Web Axum routes, frontend service module |
| 4 | [phase4-ui](2026-04-27-codexmgx-phase4-ui.md) | 18–23 | InvestigationPanel UI, Investigate buttons, Elena quick action |
| 5 | [phase5-settings](2026-04-27-codexmgx-phase5-settings.md) | 24–25 | Desktop + web settings UI, DB migration |

## Known gaps / Phase 2 path

- **No OCR** for scanned PDFs and image attachments — confirmed gap, high priority Phase 2 via `tesseract` crate
- **One-shot investigation** (full result on complete) — Phase 2: stream per-step progress events
- **WHATS'ON KB structure** — if the index URL or JSON shape differs from the stub assumption, adjust `knowledge_base/mod.rs` after testing against the live KB

## Implementation notes

- `AtlassianClient` must be `Clone` — reqwest::Client is Clone, so `#[derive(Clone)]` works
- Desktop credentials are passed per-call (same pattern as existing jira commands — no shared state)
- Web credentials come from `jira_poller_config` table row (single config row, id=1)
- `SQLX_OFFLINE=true` required for `cargo check` on web without Postgres
- Desktop uses `reqwest 0.11` natively but pulls in `0.12` via hadron-mcp already — new crate uses workspace `0.12`, no conflict
