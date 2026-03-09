# Commands Legacy Retirement Plan

**Date:** 2026-03-06  
**Status:** Proposed  
**Target Version:** 4.4.x

## Goal

Retire `src-tauri/src/commands_legacy.rs` and remove `pub use crate::commands_legacy::*` from `src-tauri/src/commands/mod.rs` without breaking IPC command contracts.

## Current State

- `commands_legacy.rs` is a large mixed-responsibility file (~5k lines).
- `commands/mod.rs` still re-exports all legacy commands.
- `main.rs` directly registers a very large command list (roughly 196 handlers).
- New modular command files exist (`crud`, `archive`, `notes`, `performance`, `jira`, `release_notes`, etc.), but migration is incomplete.

## Constraints

- Do not break existing frontend `invoke("<command_name>")` strings.
- Keep migration DB-safe and backward-compatible.
- Maintain release cadence (no long-lived destabilizing branch).

## Phase 1: Inventory and Ownership

1. Produce a command inventory from `main.rs` `generate_handler![]`.
2. Classify each command by domain:
   - `analysis/core`
   - `search/retrieval`
   - `jira`
   - `sentry`
   - `release_notes`
   - `chat`
   - `intelligence`
   - `admin/export`
3. Create a mapping table: `command_name -> current file -> target module`.

**Acceptance criteria**
- 100% of registered commands mapped to a target module.
- No orphan commands.

## Phase 2: Stabilize Command Registry

1. Move the handler list from `main.rs` into a dedicated registry module (single source of truth).
2. Keep command names unchanged.
3. Group handlers by module with clear section boundaries.

**Acceptance criteria**
- `main.rs` no longer contains the long inline registration list.
- App boots and can invoke representative commands from each domain.

## Phase 3: Domain-by-Domain Extraction

1. Extract commands from `commands_legacy.rs` incrementally by domain.
2. For each extracted domain:
   - Move request/response structs near the new module when practical.
   - Keep helper functions private to domain modules.
   - Add/refresh focused tests for moved logic.
3. After each domain extraction:
   - Remove moved code from `commands_legacy.rs`.
   - Run targeted test suite.

**Acceptance criteria**
- Legacy file shrinks each PR.
- No IPC signature changes.
- Unit tests and core smoke flow stay green.

## Phase 4: Remove Legacy Re-export

1. Delete `pub use crate::commands_legacy::*` from `commands/mod.rs`.
2. Ensure all handlers referenced by the registry resolve from modular files.
3. Build and run regression checks.

**Acceptance criteria**
- No imports from `commands_legacy`.
- No compile/runtime command resolution failures.

## Phase 5: Delete Legacy Module

1. Delete `src-tauri/src/commands_legacy.rs`.
2. Remove `mod commands_legacy;` from `main.rs`.
3. Clean dead imports and unused helpers.

**Acceptance criteria**
- Clean compile with no dead references.
- Existing frontend command invocations continue to work.

## Risk Controls

- Keep migration PRs small (one domain at a time).
- Add command smoke tests that execute representative `invoke()` paths.
- Maintain a migration checklist in each PR:
  - handler still registered
  - command string unchanged
  - serialization shape unchanged
  - tests updated

## Suggested Order

1. `tags`, `notes`, `archive`, `bulk_ops` (low external coupling)
2. `crud`, `search`, `export`
3. `jira`, `sentry`, `release_notes`
4. `analysis` + shared helpers
5. final cleanup/removal

## Deliverables

- New command registry module
- Updated modular command files
- Removed legacy re-export
- Deleted `commands_legacy.rs`
- Updated developer documentation reflecting final structure
