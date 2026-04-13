import { useState } from "react";
import { api, type Analysis } from "../../services/api";
import { useToast } from "../Toast";

interface CreateJiraTicketDialogProps {
  open: boolean;
  analysis: Analysis;
  onClose: () => void;
}

export function CreateJiraTicketDialog({
  open,
  analysis,
  onClose,
}: CreateJiraTicketDialogProps) {
  const toast = useToast();
  const [projectKey, setProjectKey] = useState("");
  const [summary, setSummary] = useState(
    `[Hadron] ${analysis.errorType || "Crash"} in ${analysis.component || "Unknown"}`,
  );
  const [description, setDescription] = useState(
    buildDescription(analysis),
  );
  const [priority, setPriority] = useState("Medium");
  const [labels, setLabels] = useState("hadron,crash-analysis");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!projectKey) {
      toast.error("Project key is required");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createJiraTicket(
        { projectKey },
        {
          summary,
          description,
          priority,
          labels: labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
          analysisId: analysis.id,
        },
      );
      toast.success(`Ticket created: ${result.key}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-white">
          Create Jira Ticket
        </h3>

        {/* Project key */}
        <div className="mb-4 space-y-3">
          <h4 className="text-xs font-medium uppercase text-slate-400">
            Jira Project
          </h4>
          <p className="text-xs text-slate-500">
            JIRA credentials are configured by your admin. Specify the target project key below.
          </p>
          <input
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            placeholder="Project key (e.g. HAD)"
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Ticket details */}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Summary</label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              >
                <option>Highest</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
                <option>Lowest</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Labels (comma-separated)
              </label>
              <input
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildDescription(analysis: Analysis): string {
  const parts: string[] = [];
  if (analysis.errorType) parts.push(`*Error Type:* ${analysis.errorType}`);
  if (analysis.errorMessage) parts.push(`*Message:* ${analysis.errorMessage}`);
  if (analysis.component) parts.push(`*Component:* ${analysis.component}`);
  if (analysis.severity) parts.push(`*Severity:* ${analysis.severity}`);
  if (analysis.rootCause) parts.push(`\n*Root Cause:*\n${analysis.rootCause}`);
  if (analysis.suggestedFixes) {
    const fixes = Array.isArray(analysis.suggestedFixes)
      ? analysis.suggestedFixes
      : [];
    if (fixes.length > 0) {
      parts.push(
        `\n*Suggested Fixes:*\n${fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
      );
    }
  }
  parts.push(`\n_Generated by Hadron from ${analysis.filename}_`);
  return parts.join("\n");
}
