# Hadron Investigation Engine

Hadron embeds the CodexMgX investigation logic as a native Rust library (`hadron-investigation`), surfacing deep JIRA/Confluence investigation in both the desktop app and the web platform.

## What it does

Given a JIRA ticket key, the engine:

1. Fetches the full issue context — description, comments (rendered), changelog, worklogs, remote links, attachments, sprint, and fix versions
2. Searches for related issues across three strategies: direct links, same-project history (90 days), and cross-project siblings (180 days)
3. Searches Confluence for documentation related to the extracted entities
4. Searches the WHATS'ON Knowledge Base by title/chunk scoring
5. Extracts text from supported attachments: txt, log, json, xml, html, zip, docx, pdf
6. Builds a structured dossier: evidence claims, related issues, Confluence docs, hypotheses, open questions, and next checks

## Investigation modes

| Mode | Entry point | Description |
|------|-------------|-------------|
| `investigate_ticket` | Default "Investigate" button | Full dossier for one ticket |
| `investigate_regression_family` | Chat tool | Broadens the related-issue search to find the regression family |
| `investigate_expected_behavior` | Chat tool | Adds a Confluence/KB query for a specific behavior question |
| `investigate_customer_history` | Chat tool | Focuses on same-customer/same-project history |

## Architecture

```
hadron-investigation/          Shared Rust crate
  atlassian/
    jira.rs                    Jira Cloud API (full context fetch + JQL search)
    confluence.rs              Confluence search + content fetch
    mod_.rs                    MOD documentation helpers
    attachments.rs             Attachment download + text extraction
    adf.rs                     Atlassian Document Format → plain text
  investigation/
    ticket.rs                  investigate_ticket orchestrator
    regression.rs              investigate_regression_family orchestrator
    expected.rs                investigate_expected_behavior orchestrator
    customer.rs                investigate_customer_history orchestrator
    evidence.rs                Dossier types (InvestigationDossier, EvidenceClaim, …)
    evidence_builder.rs        Claim extraction + hypothesis engine
    related.rs                 3-strategy related issue finder + token extraction
  knowledge_base/
    mod.rs                     WHATS'ON KB index.json search
```

The crate is consumed by:
- **hadron-desktop**: Tauri commands in `commands/investigation.rs`, wired to 6 AskHadron chat tools and the "Investigate" button in `JiraTicketAnalyzer`
- **hadron-web**: Axum routes in `routes/investigation.rs`, wired to `investigationService.ts` and the "Investigate" button in `JiraAnalyzerView`

## Configuration

### Desktop

Credentials are read from the existing JIRA settings plus the Confluence override and advanced fields added in Phase 5:

| Setting key | Purpose |
|-------------|---------|
| `jira.baseUrl` + `jira.email` + `getApiKey("jira")` | Jira Cloud credentials (required) |
| `confluence.overrideUrl` + `confluence.overrideEmail` + `getApiKey("confluence")` | Confluence override (optional — defaults to Jira tenant) |
| `investigation.whatsonKbUrl` | WHATS'ON KB base URL override |
| `investigation.modDocsHomepageId` | MOD docs homepage ID override (default `1888060283`) |
| `investigation.modDocsSpacePath` | MOD docs space path override (default `modkb`) |

### Web

Configuration is stored in the `jira_poller_config` table (migration `019_investigation_settings.sql`).  
Admin → JIRA Poller already stores the base Jira credentials.  
Admin → `/api/admin/investigation-settings` (GET/PUT) manages the Confluence override and KB settings.

## Known gaps vs. original CodexMgX plugin

The original PowerShell plugin has capabilities that are intentionally excluded or simplified:

| Feature | PS plugin | Rust crate | Notes |
|---------|-----------|------------|-------|
| Screenshot OCR | ✅ via tesseract.exe | ❌ skipped | Not practical for a server — images are skipped |
| Version pattern extraction | ✅ `2024r1.x.x` | ❌ | Token extraction uses simple alphanumeric split |
| Error code pattern extraction | ✅ `ERROR_XXX` regex | ❌ | Same — partial coverage via uppercase identifier regex |
| Per-evidence relevance scoring | ✅ float 0–1 | ❌ | Dossier uses categorical confidence enum |
| Evidence contradictions | ✅ cross-checks | ❌ | Not implemented |
| Structured hypothesis kinds | ✅ typed kinds | partial | Rust uses keyword heuristics (null, timeout) |

These gaps are acceptable for the first integration pass. The dossier quality is high enough to surface the most useful investigation signals.
