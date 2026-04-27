# CodexMgX Integration — Phase 4: UI Components

> **Prerequisites:** Phase 2 (desktop commands) and Phase 3 (web service) complete.

**Goal:** Build `InvestigationPanel` in both frontends, wire "Investigate" buttons into both JIRA analyzers, add the 5th Elena quick action.

**Files:**
- Create: `hadron-desktop/src/services/investigation.ts`
- Create: `hadron-desktop/src/components/jira/InvestigationPanel.tsx`
- Modify: `hadron-desktop/src/components/jira/JiraTicketAnalyzer.tsx`
- Create: `hadron-web/frontend/src/components/jira/InvestigationPanel.tsx`
- Modify: `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`
- Modify: `hadron-web/frontend/src/components/widget/FloatingElena.tsx`

---

### Task 18: Desktop Investigation Service

**Files:**
- Create: `hadron-desktop/src/services/investigation.ts`

- [ ] **Step 1: Create the service**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { getApiKey, getSetting } from "./secure-storage";

export interface EvidenceClaim {
  text: string;
  category:
    | "observed_behavior"
    | "linked_context"
    | "historical_match"
    | "expected_behavior"
    | "attachment_signal"
    | "issue_comment"
    | "customer_history";
  entities: string[];
}

export interface RelatedIssue {
  key: string;
  summary: string;
  status: string;
  relation_type: "direct_link" | "project_history" | "cross_project_sibling";
  url: string;
}

export interface ConfluenceDoc {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  space_key: string | null;
}

export interface Hypothesis {
  text: string;
  confidence: "high" | "medium" | "low";
  supporting_claims: string[];
}

export interface AttachmentResult {
  filename: string;
  extracted_text: string | null;
  extraction_status: "success" | "skipped" | { failed: string };
}

export interface InvestigationDossier {
  ticket_key: string;
  ticket_summary: string;
  ticket_url: string;
  status: string;
  assignee: string | null;
  claims: EvidenceClaim[];
  related_issues: RelatedIssue[];
  confluence_docs: ConfluenceDoc[];
  hypotheses: Hypothesis[];
  open_questions: string[];
  next_checks: string[];
  attachments: AttachmentResult[];
  warnings: string[];
  investigation_type: "ticket" | "regression_family" | "expected_behavior" | "customer_history";
  investigation_status: "complete" | "partial_failure";
}

async function getJiraCredentials() {
  const baseUrl = (await getSetting<string>("jira.baseUrl")) ?? "";
  const email = (await getSetting<string>("jira.email")) ?? "";
  const apiToken = (await getApiKey("jira")) ?? "";
  const confluenceUrl = (await getSetting<string>("confluence.overrideUrl")) ?? undefined;
  const confluenceEmail = (await getSetting<string>("confluence.overrideEmail")) ?? undefined;
  const confluenceToken = confluenceUrl ? ((await getApiKey("confluence")) ?? undefined) : undefined;
  const whatsonKbUrl = (await getSetting<string>("investigation.whatsonKbUrl")) ?? undefined;
  const modDocsHomepageId = (await getSetting<string>("investigation.modDocsHomepageId")) ?? undefined;
  const modDocsSpacePath = (await getSetting<string>("investigation.modDocsSpacePath")) ?? undefined;
  return {
    base_url: baseUrl,
    email,
    api_token: apiToken,
    confluence_url: confluenceUrl,
    confluence_email: confluenceEmail,
    confluence_token: confluenceToken,
    whatson_kb_url: whatsonKbUrl,
    mod_docs_homepage_id: modDocsHomepageId,
    mod_docs_space_path: modDocsSpacePath,
  };
}

export async function investigateTicket(key: string): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_ticket", { key, ...creds });
}

export async function investigateRegressionFamily(key: string): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_regression_family", { key, ...creds });
}

export async function investigateExpectedBehavior(
  key: string,
  query: string
): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_expected_behavior", { key, query, ...creds });
}

export async function investigateCustomerHistory(key: string): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_customer_history", { key, ...creds });
}

export async function searchConfluence(
  query: string,
  spaceKey?: string,
  limit?: number
): Promise<ConfluenceDoc[]> {
  const creds = await getJiraCredentials();
  return invoke<ConfluenceDoc[]>("search_confluence_docs", {
    query,
    space_key: spaceKey ?? null,
    limit: limit ?? null,
    ...creds,
  });
}

export async function getConfluencePage(contentId: string): Promise<ConfluenceDoc> {
  const creds = await getJiraCredentials();
  return invoke<ConfluenceDoc>("get_confluence_page", { content_id: contentId, ...creds });
}
```

- [ ] **Step 2: Commit**

```bash
git add hadron-desktop/src/services/investigation.ts
git commit -m "feat(desktop): add investigation TypeScript service"
```

---

### Task 19: InvestigationPanel Component (Desktop)

**Files:**
- Create: `hadron-desktop/src/components/jira/InvestigationPanel.tsx`

- [ ] **Step 1: Create InvestigationPanel.tsx**

```tsx
import { useState } from "react";
import type { InvestigationDossier, EvidenceClaim } from "../../services/investigation";

interface Props {
  dossier: InvestigationDossier;
}

const CATEGORY_LABELS: Record<string, string> = {
  observed_behavior: "Observed Behavior",
  linked_context: "Linked Context",
  historical_match: "Historical Match",
  expected_behavior: "Expected Behavior",
  attachment_signal: "Attachment Signal",
  issue_comment: "Comment",
  customer_history: "Customer History",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-300 border border-red-500/30",
  medium: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  low: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
};

const RELATION_LABELS: Record<string, string> = {
  direct_link: "Direct Link",
  project_history: "Project History",
  cross_project_sibling: "Cross-Project",
};

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-left"
      >
        <span className="text-sm font-semibold text-slate-200">{title}</span>
        <span className="text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 py-3 bg-slate-900">{children}</div>}
    </div>
  );
}

export function InvestigationPanel({ dossier }: Props) {
  const groupedClaims = dossier.claims.reduce<Record<string, EvidenceClaim[]>>(
    (acc, claim) => {
      const cat = claim.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(claim);
      return acc;
    },
    {}
  );

  const groupedRelated = dossier.related_issues.reduce<
    Record<string, typeof dossier.related_issues>
  >((acc, issue) => {
    const rel = issue.relation_type;
    if (!acc[rel]) acc[rel] = [];
    acc[rel].push(issue);
    return acc;
  }, {});

  return (
    <div className="space-y-1">
      {/* Warnings */}
      {dossier.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-900/30 border border-amber-600/40 px-4 py-3 mb-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">Partial results</p>
          {dossier.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-300">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Ticket header */}
      <Section title="Ticket Summary">
        <div className="space-y-1">
          <p className="text-sm text-slate-200">
            <a
              href={dossier.ticket_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline font-medium"
            >
              {dossier.ticket_key}
            </a>{" "}
            — {dossier.ticket_summary}
          </p>
          <p className="text-xs text-slate-400">
            Status: <span className="text-slate-300">{dossier.status || "—"}</span>
            {dossier.assignee && (
              <>
                {" "}· Assignee:{" "}
                <span className="text-slate-300">{dossier.assignee}</span>
              </>
            )}
          </p>
        </div>
      </Section>

      {/* Evidence claims */}
      {Object.keys(groupedClaims).length > 0 && (
        <Section title={`Evidence (${dossier.claims.length})`}>
          <div className="space-y-3">
            {Object.entries(groupedClaims).map(([cat, claims]) => (
              <div key={cat}>
                <p className="text-xs font-semibold text-slate-400 mb-1">
                  {CATEGORY_LABELS[cat] ?? cat}
                </p>
                <ul className="space-y-1">
                  {claims.map((c, i) => (
                    <li key={i} className="text-xs text-slate-300 leading-relaxed pl-3 border-l border-slate-700">
                      {c.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Related issues */}
      {dossier.related_issues.length > 0 && (
        <Section title={`Related Issues (${dossier.related_issues.length})`}>
          <div className="space-y-3">
            {Object.entries(groupedRelated).map(([rel, issues]) => (
              <div key={rel}>
                <p className="text-xs font-semibold text-slate-400 mb-1">
                  {RELATION_LABELS[rel] ?? rel}
                </p>
                <ul className="space-y-1">
                  {issues.map((issue) => (
                    <li key={issue.key} className="text-xs text-slate-300 flex gap-2">
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline shrink-0"
                      >
                        {issue.key}
                      </a>
                      <span className="truncate">{issue.summary}</span>
                      <span className="shrink-0 text-slate-500">{issue.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Confluence docs */}
      {dossier.confluence_docs.length > 0 && (
        <Section title={`Confluence (${dossier.confluence_docs.length})`} defaultOpen={false}>
          <ul className="space-y-2">
            {dossier.confluence_docs.map((doc) => (
              <li key={doc.id} className="text-xs">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline font-medium"
                >
                  {doc.title}
                </a>
                {doc.excerpt && (
                  <p className="text-slate-400 mt-0.5 line-clamp-2">{doc.excerpt}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Hypotheses */}
      {dossier.hypotheses.length > 0 && (
        <Section title="Hypotheses">
          <ul className="space-y-2">
            {dossier.hypotheses.map((h, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE_COLORS[h.confidence]}`}
                  >
                    {h.confidence.toUpperCase()}
                  </span>
                  <span className="text-slate-200">{h.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Open questions + Next checks */}
      {(dossier.open_questions.length > 0 || dossier.next_checks.length > 0) && (
        <Section title="Open Questions & Next Steps" defaultOpen={false}>
          {dossier.open_questions.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-slate-400 mb-1">Open Questions</p>
              <ul className="space-y-0.5">
                {dossier.open_questions.map((q, i) => (
                  <li key={i} className="text-xs text-slate-300">
                    ? {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dossier.next_checks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-1">Next Checks</p>
              <ul className="space-y-0.5">
                {dossier.next_checks.map((c, i) => (
                  <li key={i} className="text-xs text-slate-300">
                    → {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Attachments */}
      {dossier.attachments.length > 0 && (
        <Section title={`Attachments (${dossier.attachments.length})`} defaultOpen={false}>
          <ul className="space-y-2">
            {dossier.attachments.map((att, i) => {
              const ok =
                att.extraction_status === "success" ||
                att.extraction_status === "skipped";
              return (
                <li key={i} className="text-xs border-b border-slate-800 pb-2 last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-slate-300 font-medium">{att.filename}</span>
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-semibold ${
                        att.extraction_status === "success"
                          ? "bg-green-900/30 text-green-400"
                          : att.extraction_status === "skipped"
                          ? "bg-slate-700 text-slate-400"
                          : "bg-red-900/30 text-red-400"
                      }`}
                    >
                      {typeof att.extraction_status === "object"
                        ? "FAILED"
                        : att.extraction_status.toUpperCase()}
                    </span>
                  </div>
                  {att.extracted_text && (
                    <pre className="text-slate-400 whitespace-pre-wrap break-all text-[10px] leading-relaxed max-h-32 overflow-y-auto bg-slate-800 rounded p-2">
                      {att.extracted_text}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add hadron-desktop/src/components/jira/InvestigationPanel.tsx
git commit -m "feat(desktop): add InvestigationPanel component"
```

---

### Task 20: Desktop JiraTicketAnalyzer — Investigate Button

**Files:**
- Modify: `hadron-desktop/src/components/jira/JiraTicketAnalyzer.tsx`

The file already imports `Microscope` (used for Deep Analyze at line ~666). We need `FlaskConical` for Investigate.

- [ ] **Step 1: Add FlaskConical to the lucide-react import**

Find the line starting with `import {` that includes `Microscope` and add `FlaskConical`:
```ts
import {
  // ... existing icons ...
  FlaskConical,
  Microscope,
  // ...
} from "lucide-react";
```

- [ ] **Step 2: Add investigation state**

Find where analysis state is declared (around the existing `analyzing`, `deepResult` state). Add:
```ts
const [investigating, setInvestigating] = useState(false);
const [investigationDossier, setInvestigationDossier] = useState<InvestigationDossier | null>(null);
const [investigationError, setInvestigationError] = useState<string | null>(null);
```

- [ ] **Step 3: Add import**

At the top with other service imports:
```ts
import { investigateTicket, type InvestigationDossier } from "../../services/investigation";
import { InvestigationPanel } from "./InvestigationPanel";
```

- [ ] **Step 4: Add handleInvestigate function**

After the existing `handleDeepAnalyze` function:
```ts
const handleInvestigate = async () => {
  if (!selectedTicket) return;
  setInvestigating(true);
  setInvestigationError(null);
  setInvestigationDossier(null);
  try {
    const dossier = await investigateTicket(selectedTicket.key);
    setInvestigationDossier(dossier);
  } catch (err) {
    setInvestigationError(err instanceof Error ? err.message : String(err));
  } finally {
    setInvestigating(false);
  }
};
```

- [ ] **Step 5: Add Investigate button to the action bar**

The action bar is around lines 620-680. The Deep Analyze button uses `Microscope`. Add the Investigate button right after the Deep Analyze button:

```tsx
<button
  onClick={handleInvestigate}
  disabled={!selectedTicket || investigating}
  className="flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
>
  <FlaskConical className="h-4 w-4" />
  {investigating ? "Investigating…" : "Investigate"}
</button>
```

- [ ] **Step 6: Render InvestigationPanel**

Find where `deepResult` is rendered (the analysis output section). Add below it:

```tsx
{investigationError && (
  <div className="rounded-lg bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-300">
    Investigation failed: {investigationError}
  </div>
)}
{investigationDossier && (
  <div className="mt-4">
    <h3 className="text-sm font-semibold text-slate-300 mb-2">Investigation Results</h3>
    <InvestigationPanel dossier={investigationDossier} />
  </div>
)}
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd hadron-desktop && npm run type-check
```

- [ ] **Step 8: Commit**

```bash
git add hadron-desktop/src/components/jira/JiraTicketAnalyzer.tsx
git commit -m "feat(desktop): add Investigate button to JiraTicketAnalyzer"
```

---

### Task 21: Web InvestigationPanel

**Files:**
- Create: `hadron-web/frontend/src/components/jira/InvestigationPanel.tsx`

- [ ] **Step 1: Create InvestigationPanel.tsx (web)**

The implementation is identical to the desktop version. Copy the desktop file verbatim but change the import path:

```tsx
import type { InvestigationDossier, EvidenceClaim } from "../../services/investigation";
```

All other code is the same as the desktop `InvestigationPanel.tsx` created in Task 19.

- [ ] **Step 2: Commit**

```bash
git add hadron-web/frontend/src/components/jira/InvestigationPanel.tsx
git commit -m "feat(web): add InvestigationPanel component"
```

---

### Task 22: Web JiraAnalyzerView — Investigate Button

**Files:**
- Modify: `hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx`

The action buttons are at lines 253-275. There are currently 3 buttons: Triage, Generate Brief, Deep Analyze.

- [ ] **Step 1: Add imports**

At the top of the file, add:
```ts
import { investigationService, type InvestigationDossier } from "../../services/investigation";
import { InvestigationPanel } from "./InvestigationPanel";
```

- [ ] **Step 2: Add investigation state**

In the component, after the existing analysis state declarations:
```ts
const [investigating, setInvestigating] = useState(false);
const [investigationDossier, setInvestigationDossier] = useState<InvestigationDossier | null>(null);
const [investigationError, setInvestigationError] = useState<string | null>(null);
```

- [ ] **Step 3: Add handleInvestigate**

After the existing `handleAnalyze` function:
```ts
const handleInvestigate = async () => {
  if (!ticket) return;
  setInvestigating(true);
  setInvestigationError(null);
  setInvestigationDossier(null);
  try {
    const dossier = await investigationService.investigateTicket(ticket.key);
    setInvestigationDossier(dossier);
  } catch (err) {
    setInvestigationError(err instanceof Error ? err.message : String(err));
  } finally {
    setInvestigating(false);
  }
};
```

- [ ] **Step 4: Add Investigate button in the action bar (lines 253-275)**

After the Deep Analyze button (around line 274), add:
```tsx
<button
  onClick={handleInvestigate}
  disabled={!canAnalyze || investigating}
  className="rounded-md bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
>
  {investigating ? "Investigating…" : "Investigate"}
</button>
```

- [ ] **Step 5: Render InvestigationPanel**

After the existing `JiraAnalysisReport` render, add:
```tsx
{investigationError && (
  <div className="rounded-lg bg-red-900/30 border border-red-500/40 px-4 py-3 text-sm text-red-300 mt-4">
    Investigation failed: {investigationError}
  </div>
)}
{investigationDossier && (
  <div className="mt-4">
    <h3 className="text-sm font-semibold text-slate-300 mb-2">Investigation Results</h3>
    <InvestigationPanel dossier={investigationDossier} />
  </div>
)}
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd hadron-web/frontend && npm run type-check
```

- [ ] **Step 7: Commit**

```bash
git add hadron-web/frontend/src/components/jira/JiraAnalyzerView.tsx
git commit -m "feat(web): add Investigate button to JiraAnalyzerView"
```

---

### Task 23: FloatingElena 5th Quick Action

**Files:**
- Modify: `hadron-web/frontend/src/components/widget/FloatingElena.tsx`

`QUICK_ACTIONS` is at line 38, currently 4 entries.

- [ ] **Step 1: Add 5th entry**

After the last entry (`Find similar issues`), add:
```ts
  {
    label: 'Investigate JIRA ticket',
    prompt: 'Investigate this JIRA ticket: [paste ticket key or describe the issue]',
  },
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd hadron-web/frontend && npm run type-check
```

- [ ] **Step 3: Commit**

```bash
git add hadron-web/frontend/src/components/widget/FloatingElena.tsx
git commit -m "feat(web): add Investigate JIRA ticket quick action to FloatingElena"
```
