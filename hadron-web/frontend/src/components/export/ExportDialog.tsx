import { useState } from "react";
import { api } from "../../services/api";
import { useToast } from "../Toast";

interface ExportDialogProps {
  analysisId: number;
  filename: string;
  onClose: () => void;
}

export function ExportDialog({
  analysisId,
  filename,
  onClose,
}: ExportDialogProps) {
  const toast = useToast();
  const [format, setFormat] = useState<"markdown" | "html" | "json">(
    "markdown",
  );
  const [audience, setAudience] = useState<
    "technical" | "customer" | "support" | "executive"
  >("technical");
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    setLoading(true);
    try {
      const content = await api.exportAnalysis(analysisId, format, audience);
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
      const content =
        preview ?? (await api.exportAnalysis(analysisId, format, audience));
      const ext = format === "markdown" ? "md" : format;
      const mime =
        format === "json"
          ? "application/json"
          : format === "html"
            ? "text/html"
            : "text/markdown";
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename.replace(/\.[^.]+$/, "")}-export.${ext}`;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Export Analysis</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Format
            </label>
            <div className="flex gap-2">
              {(["markdown", "html", "json"] as const).map((f) => (
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
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

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

          {preview && (
            <div className="max-h-60 overflow-auto rounded-md border border-slate-600 bg-slate-900 p-3">
              <pre className="whitespace-pre-wrap text-xs text-slate-300">
                {preview}
              </pre>
            </div>
          )}

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
