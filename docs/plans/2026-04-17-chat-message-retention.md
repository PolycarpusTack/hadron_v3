# Plan: chat message retention and PII minimisation

**Date:** 2026-04-17
**Owner:** TBD
**Security source:** Internal risk assessment 2026-04-17 (finding F9)
**Status:** Draft — not started
**Related findings also tracked here:** F7 (release-notes lead-scope intent — product decision already documented in code)

## 1. Problem

`chat_messages` currently persists every user and assistant turn verbatim
(`hadron-web/crates/hadron-server/src/routes/chat.rs:227,339,427`). Users
routinely paste:

- crash logs containing customer IDs, user emails, internal hostnames;
- JIRA ticket bodies and Sentry events pulled via tools;
- stack traces with file paths that may identify customers;
- release note drafts containing product copy.

There is no retention policy, no minimisation, no user-facing warning
(beyond the one-line notice added by this plan), and no export/erase
hook for an individual user's history. The data lives in Postgres
indefinitely alongside an otherwise low-sensitivity analysis store.

## 2. Goal

Define and implement a retention and minimisation policy for
`chat_messages` (and the adjacent `analysis_notes`,
`chat_sessions.title`) so that:

- PII exposure from a DB breach is bounded in time.
- Users can be told, concretely, how long their messages are kept.
- A user-delete or analyst-delete of a session also deletes its
  messages, irreversibly.
- The product can answer a GDPR "right to erasure" request without
  engineering intervention.

## 3. Decisions needed from product / legal

1. **Default retention window**. Proposal: 90 days for chat messages,
   180 days for analysis notes. Confirm against privacy policy.
2. **User-initiated deletion**. Must exist. Per-session delete already
   exists; add a per-account "delete all my chat history" action.
3. **Admin-initiated deletion**. Admins already can delete sessions
   they own; decide whether they can delete any user's session
   (currently no). Recommendation: yes, for GDPR compliance, with
   audit-log entry.
4. **Archival for compliance**. Some customers may require longer
   retention for audit. Decide whether archive-to-cold-storage is in
   scope now or later.
5. **Minimisation at write time**. Two options:
   - (A) Store as-is and rely on retention alone.
   - (B) Redact recognisable patterns (emails, bearer tokens, IPv4
     addresses) at write time using a denylist regex.
   Recommendation: (A) for v1 (lower risk of losing debugging value),
   (B) scoped to bearer-token-shaped strings only.

## 4. Implementation sketch

### 4.1 Retention job

- New migration: add `chat_messages.created_at` (already present).
- New cron job (`jira_poller`-style background task in `main.rs`) that
  runs every 24h and executes:
  ```sql
  DELETE FROM chat_messages
   WHERE created_at < now() - interval '90 days';
  DELETE FROM chat_sessions
   WHERE NOT EXISTS (
     SELECT 1 FROM chat_messages m WHERE m.session_id = chat_sessions.id
   );
  ```
- Retention window read from env `CHAT_RETENTION_DAYS` (default 90).
- Log rows-deleted at `tracing::info!` with per-run count (no PII).

### 4.2 User-initiated erase

- New endpoint `DELETE /api/chat/messages` (no path id): deletes every
  chat_message + chat_session owned by the authenticated user.
- Frontend: add a button in `SettingsView.tsx` under a new "Privacy"
  section: "Delete all my chat history". Confirm dialog.

### 4.3 Bearer-token redaction at write time

- Add `fn redact_bearers(text: &str) -> Cow<str>` in
  `hadron-core/src/ai/` that replaces matches of
  `(?i)bearer\s+[A-Za-z0-9._-]{20,}` with `bearer ***REDACTED***`.
- Call it from `save_chat_message` on both `role="user"` and
  `role="assistant"` content.
- Unit test: round-trip that the original text contains
  `bearer abc…` and the stored value contains `***REDACTED***`.
- Scope: only tokens matching the bearer shape. Do not attempt to
  redact free-form PII (email addresses, IPs) in v1 — too many false
  positives for debugging.

### 4.4 User-facing notice

**Already shipped** as part of this plan's first increment: the chat
input now carries a small notice reminding users to avoid pasting
customer identifiers (`hadron-web/frontend/src/components/chat/ChatView.tsx`).

## 5. Risks

- Retention deletion could remove a message a user genuinely wanted to
  keep. Mitigate by surfacing the window in SettingsView and allowing
  per-session export via the existing export flows before purge.
- Bearer-token redaction may break debugging of a failed OAuth flow.
  Accept — a leaked bearer in the DB is worse than a harder debug.

## 6. Acceptance criteria

- `CHAT_RETENTION_DAYS` env var is respected; default 90.
- Retention job runs on startup and every 24h; logs rows-deleted.
- `DELETE /api/chat/messages` is authenticated, role-agnostic, and
  removes all of the caller's chat rows. Unit test + integration test.
- SettingsView surfaces both the retention window and a "delete all"
  button.
- A unit test confirms bearer-token redaction on write.
- Privacy notice is visible on the chat input (already shipped).
