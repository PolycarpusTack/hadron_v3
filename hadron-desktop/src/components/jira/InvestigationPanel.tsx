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

      {dossier.attachments.length > 0 && (
        <Section title={`Attachments (${dossier.attachments.length})`} defaultOpen={false}>
          <ul className="space-y-2">
            {dossier.attachments.map((att, i) => (
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
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
