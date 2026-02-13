/**
 * Release Notes Editor
 * Three-mode editor (Edit/Preview/Diff), autosave, export bar.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Edit3,
  Eye,
  GitCompare,
  Save,
  Loader2,
  CheckCircle,
  FileText,
  Code,
  Globe,
} from "lucide-react";
import {
  getReleaseNotes,
  updateContent,
  exportReleaseNotes,
} from "../../services/release-notes";
import type { ReleaseNotesDraft, ReleaseNotesExportFormat } from "../../types";
import logger from "../../services/logger";

interface Props {
  draftId: number;
}

type EditorMode = "edit" | "preview" | "diff";

export default function ReleaseNotesEditor({ draftId }: Props) {
  const [draft, setDraft] = useState<ReleaseNotesDraft | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [error, setError] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load draft
  useEffect(() => {
    loadDraft();
  }, [draftId]);

  const loadDraft = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReleaseNotes(draftId);
      if (data) {
        setDraft(data);
        setContent(data.markdownContent);
      } else {
        setError("Release notes draft not found.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Autosave on content change
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setSaved(false);

      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }

      autosaveTimer.current = setTimeout(async () => {
        try {
          setSaving(true);
          await updateContent(draftId, newContent);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } catch (err) {
          logger.error("Autosave failed", { error: err });
        } finally {
          setSaving(false);
        }
      }, 1500);
    },
    [draftId],
  );

  const handleManualSave = useCallback(async () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      setSaving(true);
      await updateContent(draftId, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      logger.error("Manual save failed", { error: err });
    } finally {
      setSaving(false);
    }
  }, [draftId, content]);

  const handleExport = useCallback(
    async (format: ReleaseNotesExportFormat) => {
      try {
        const exported = await exportReleaseNotes(draftId, format);

        // Create download blob
        const mimeTypes: Record<string, string> = {
          markdown: "text/markdown",
          confluence: "text/plain",
          html: "text/html",
        };
        const extensions: Record<string, string> = {
          markdown: "md",
          confluence: "txt",
          html: "html",
        };

        const blob = new Blob([exported], { type: mimeTypes[format] || "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `release-notes-${draft?.fixVersion || "draft"}.${extensions[format] || "txt"}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [draftId, draft],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
        <span className="ml-2 text-gray-400">Loading draft...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
        {error}
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="space-y-4">
      {/* Header: Title + Status */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">{draft.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {draft.ticketCount} tickets | {draft.aiModel} | {draft.status}
            {draft.isManualEdit && " (edited)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving...
            </span>
          )}
          {saved && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Saved
            </span>
          )}
        </div>
      </div>

      {/* Mode Tabs + Export */}
      <div className="flex items-center justify-between border-b border-gray-700 pb-0">
        <div className="flex items-center gap-1">
          {(
            [
              { id: "edit", label: "Edit", icon: Edit3 },
              { id: "preview", label: "Preview", icon: Eye },
              { id: "diff", label: "Diff", icon: GitCompare },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                mode === id
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Export & Save */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleManualSave}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
          <button
            onClick={() => handleExport("markdown")}
            title="Export as Markdown"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            MD
          </button>
          <button
            onClick={() => handleExport("confluence")}
            title="Export as Confluence Wiki Markup"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            Wiki
          </button>
          <button
            onClick={() => handleExport("html")}
            title="Export as HTML"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
            HTML
          </button>
        </div>
      </div>

      {/* Editor Area */}
      {mode === "edit" && (
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          className="w-full h-[500px] bg-gray-900 border border-gray-700 rounded-lg p-4 text-sm text-gray-200 font-mono resize-y focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none"
          spellCheck={false}
        />
      )}

      {mode === "preview" && (
        <div
          className="w-full min-h-[500px] bg-gray-900 border border-gray-700 rounded-lg p-6 prose prose-invert prose-sm max-w-none overflow-auto"
          dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(content) }}
        />
      )}

      {mode === "diff" && (
        <div className="w-full min-h-[500px] bg-gray-900 border border-gray-700 rounded-lg p-4 text-sm font-mono overflow-auto">
          {draft.originalAiContent ? (
            <DiffView original={draft.originalAiContent} current={content} />
          ) : (
            <p className="text-gray-500">No original AI content to compare against.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Simple markdown → HTML for preview (basic conversion) */
function simpleMarkdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Tables (basic)
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split("|").filter(Boolean);
    if (cells.every((c) => c.trim().match(/^-+$/))) return "";
    const tds = cells.map((c) => `<td class="border border-gray-700 px-2 py-1">${c.trim()}</td>`).join("");
    return `<tr>${tds}</tr>`;
  });

  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  return html;
}

/** Simple line-by-line diff view */
function DiffView({ original, current }: { original: string; current: string }) {
  const origLines = original.split("\n");
  const currLines = current.split("\n");
  const maxLen = Math.max(origLines.length, currLines.length);

  return (
    <div className="space-y-0">
      {Array.from({ length: maxLen }).map((_, i) => {
        const origLine = origLines[i] || "";
        const currLine = currLines[i] || "";
        const changed = origLine !== currLine;

        if (!changed) {
          return (
            <div key={i} className="flex text-gray-500 leading-6">
              <span className="w-10 text-right pr-2 text-gray-700 select-none">{i + 1}</span>
              <span className="flex-1 whitespace-pre-wrap">{currLine}</span>
            </div>
          );
        }

        return (
          <div key={i}>
            {origLine && (
              <div className="flex bg-red-500/10 text-red-400 leading-6">
                <span className="w-10 text-right pr-2 text-red-700 select-none">-</span>
                <span className="flex-1 whitespace-pre-wrap">{origLine}</span>
              </div>
            )}
            {currLine && (
              <div className="flex bg-green-500/10 text-green-400 leading-6">
                <span className="w-10 text-right pr-2 text-green-700 select-none">+</span>
                <span className="flex-1 whitespace-pre-wrap">{currLine}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
