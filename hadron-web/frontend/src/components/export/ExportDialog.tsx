import { useState } from "react";
import { api, ExportFormat, ExportSection } from "../../services/api";
import { useToast } from "../Toast";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  markdown: "Markdown",
  html: "HTML",
  interactive_html: "Interactive HTML",
  json: "JSON",
  txt: "Plain Text",
};

const FORMAT_EXT: Record<ExportFormat, string> = {
  markdown: "md",
  html: "html",
  interactive_html: "html",
  json: "json",
  txt: "txt",
};

const FORMAT_MIME: Record<ExportFormat, string> = {
  markdown: "text/markdown",
  html: "text/html",
  interactive_html: "text/html",
  json: "application/json",
  txt: "text/plain",
};

interface ExportDialogProps {
  onClose: () => void;
  // Generic mode
  title?: string;
  sourceType?: string;
  sections?: ExportSection[];
  // Legacy crash mode
  analysisId?: number;
  filename?: string;
}

export function ExportDialog({
  onClose,
  title,
  sourceType,
  sections,
  analysisId,
  filename,
}: ExportDialogProps) {
  const toast = useToast();
  const isGeneric = sections !== undefined;

  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [audience, setAudience] = useState<
    "technical" | "customer" | "support" | "executive"
  >("technical");
  const [enabledSections, setEnabledSections] = useState<Set<string>>(
    () => new Set(sections?.map((s) => s.id) ?? []),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggleSection(id: string) {
    setEnabledSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setPreview(null);
  }

  async function fetchContent(): Promise<string> {
    if (isGeneric) {
      const activeSections = (sections ?? []).filter((s) =>
        enabledSections.has(s.id),
      );
      return api.exportGenericReport({
        title: title ?? "Export",
        sourceType: sourceType ?? "generic",
        audience,
        sections: activeSections,
        format,
      });
    } else {
      return api.exportAnalysis(analysisId!, format, audience);
    }
  }

  const handlePreview = async () => {
    setLoading(true);
    try {
      const content = await fetchContent();
      setPreview(content);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
      const content = preview ?? (await fetchContent());
      const ext = FORMAT_EXT[format];
      const mime = FORMAT_MIME[format];
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = isGeneric
        ? (title ?? "export").replace(/[^a-z0-9]+/gi, "-").toLowerCase()
        : (filename ?? "export").replace(/\.[^.]+$/, "");
      a.download = `${baseName}-export.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  const FORMATS: ExportFormat[] = isGeneric
    ? ["markdown", "html", "interactive_html", "json", "txt"]
    : ["markdown", "html", "json"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {isGeneric ? `Export — ${title ?? "Report"}` : "Export Analysis"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4">
          {/* Format buttons */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Format
            </label>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFormat(f);
                    setPreview(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    format === f
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          {/* Audience selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Audience
            </label>
            <select
              value={audience}
              onChange={(e) => {
                setAudience(e.target.value as typeof audience);
                setPreview(null);
              }}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
            >
              <option value="technical">Technical (full detail)</option>
              <option value="support">Support (actionable)</option>
              <option value="customer">Customer (simplified)</option>
              <option value="executive">Executive (summary)</option>
            </select>
          </div>

          {/* Section toggles (generic mode only) */}
          {isGeneric && sections && sections.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Sections
              </label>
              <div className="grid grid-cols-2 gap-1">
                {sections.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={enabledSections.has(s.id)}
                      onChange={() => toggleSection(s.id)}
                      className="accent-blue-500"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Preview pane */}
          {preview && (
            <div className="max-h-60 overflow-auto rounded-md border border-slate-600 bg-slate-900 p-3">
              <pre className="whitespace-pre-wrap text-xs text-slate-300">
                {preview}
              </pre>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            <button
              onClick={handlePreview}
              disabled={loading}
              className="rounded-md bg-slate-700 px-4 py-1.5 text-sm text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Preview"}
            </button>
            <button
              onClick={handleDownload}
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
