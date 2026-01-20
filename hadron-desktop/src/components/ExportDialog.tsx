import { useState, useEffect, useCallback } from "react";
import {
  X,
  Download,
  FileText,
  FileJson,
  Code,
  Eye,
  Users,
  Briefcase,
  Headphones,
  Wrench,
  Check,
  Loader2,
} from "lucide-react";
import type { Analysis } from "../services/api";
import type { ReportAudience, ExportResponse } from "../types";
import { previewReport, generateReportMulti } from "../services/api";

interface ExportDialogProps {
  analysis: Analysis;
  isOpen: boolean;
  onClose: () => void;
}

interface FormatOption {
  id: string;
  name: string;
  icon: JSX.Element;
  extension: string;
  description: string;
}

interface AudienceOption {
  id: ReportAudience;
  name: string;
  icon: JSX.Element;
  description: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: "markdown",
    name: "Markdown",
    icon: <FileText className="w-4 h-4" />,
    extension: "md",
    description: "Standard markdown format, great for documentation",
  },
  {
    id: "html",
    name: "HTML",
    icon: <Code className="w-4 h-4" />,
    extension: "html",
    description: "Self-contained HTML with styling, ready to share",
  },
  {
    id: "json",
    name: "JSON",
    icon: <FileJson className="w-4 h-4" />,
    extension: "json",
    description: "Structured data format for integration with other tools",
  },
];

const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    id: "technical",
    name: "Technical",
    icon: <Wrench className="w-4 h-4" />,
    description: "Full technical details for developers",
  },
  {
    id: "support",
    name: "Support",
    icon: <Headphones className="w-4 h-4" />,
    description: "PII redacted, technical terms preserved",
  },
  {
    id: "customer",
    name: "Customer",
    icon: <Users className="w-4 h-4" />,
    description: "Simplified language, no sensitive data",
  },
  {
    id: "executive",
    name: "Executive",
    icon: <Briefcase className="w-4 h-4" />,
    description: "High-level summary, business impact focus",
  },
];

const SECTION_OPTIONS = [
  { id: "summary", label: "Summary" },
  { id: "environment", label: "Environment" },
  { id: "exception_details", label: "Exception Details" },
  { id: "root_cause", label: "Root Cause" },
  { id: "suggested_fix", label: "Suggested Fixes" },
  { id: "stack_trace", label: "Stack Trace" },
  { id: "reproduction_steps", label: "Reproduction Steps" },
  { id: "impact_analysis", label: "Impact Analysis" },
  { id: "pattern_match", label: "Pattern Match" },
];

export default function ExportDialog({ analysis, isOpen, onClose }: ExportDialogProps) {
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["markdown"]);
  const [selectedAudience, setSelectedAudience] = useState<ReportAudience>("technical");
  const [selectedSections, setSelectedSections] = useState<string[]>([
    "summary",
    "environment",
    "exception_details",
    "root_cause",
    "suggested_fix",
  ]);
  const [customTitle, setCustomTitle] = useState("");
  const [footerText, setFooterText] = useState("");
  const [preview, setPreview] = useState<string>("");
  const [previewFormat, setPreviewFormat] = useState<string>("markdown");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [crashContent, setCrashContent] = useState<string>("");

  // Load crash content when dialog opens
  // Since we don't have file_path, we use the analysis data directly
  useEffect(() => {
    if (isOpen) {
      // Construct content from analysis data for export
      const content = [
        `Error Type: ${analysis.error_type}`,
        `Severity: ${analysis.severity}`,
        analysis.error_message ? `Error Message: ${analysis.error_message}` : '',
        analysis.component ? `Component: ${analysis.component}` : '',
        '',
        'Root Cause:',
        analysis.root_cause,
        '',
        analysis.stack_trace ? `Stack Trace:\n${analysis.stack_trace}` : '',
      ].filter(Boolean).join('\n');
      setCrashContent(content);
    }
  }, [isOpen, analysis]);

  // Update preview when settings change
  useEffect(() => {
    if (isOpen && crashContent) {
      loadPreview();
    }
  }, [isOpen, crashContent, selectedAudience, previewFormat, selectedSections]);

  const loadPreview = useCallback(async () => {
    if (!crashContent) return;

    setIsLoadingPreview(true);
    try {
      const previewContent = await previewReport(
        crashContent,
        analysis.filename,
        previewFormat,
        selectedAudience
      );
      setPreview(previewContent);
    } catch (error) {
      console.error("Preview failed:", error);
      setPreview(`Preview failed: ${error}`);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [crashContent, analysis.filename, previewFormat, selectedAudience]);

  const toggleFormat = (formatId: string) => {
    setSelectedFormats((prev) => {
      if (prev.includes(formatId)) {
        // Don't allow deselecting the last format
        if (prev.length === 1) return prev;
        return prev.filter((f) => f !== formatId);
      }
      return [...prev, formatId];
    });
  };

  const toggleSection = (sectionId: string) => {
    setSelectedSections((prev) => {
      if (prev.includes(sectionId)) {
        return prev.filter((s) => s !== sectionId);
      }
      return [...prev, sectionId];
    });
  };

  const handleExport = async () => {
    if (!crashContent || selectedFormats.length === 0) return;

    setIsExporting(true);
    setExportMessage(null);

    try {
      const results = await generateReportMulti({
        crash_content: crashContent,
        file_name: analysis.filename,
        formats: selectedFormats,
        audience: selectedAudience,
        title: customTitle || undefined,
        include_sections: selectedSections.length > 0 ? selectedSections : undefined,
        footer_text: footerText || undefined,
      });

      // Download each file
      for (const result of results) {
        downloadFile(result);
      }

      setExportMessage(`Successfully exported ${results.length} file(s)`);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Export failed:", error);
      setExportMessage(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadFile = (result: ExportResponse) => {
    const mimeTypes: Record<string, string> = {
      html: "text/html",
      json: "application/json",
      markdown: "text/markdown",
    };

    const blob = new Blob([result.content], {
      type: mimeTypes[result.format] || "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.suggested_filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div className="bg-gray-800 rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Download className="w-6 h-6 text-blue-400" />
            <div>
              <h2 id="export-dialog-title" className="text-2xl font-bold">
                Export Report
              </h2>
              <p className="text-sm text-gray-400">{analysis.filename}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            aria-label="Close export dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Settings Panel */}
          <div className="w-80 border-r border-gray-700 p-6 overflow-y-auto space-y-6">
            {/* Format Selection */}
            <div>
              <label className="block text-sm font-semibold mb-3">Export Formats</label>
              <div className="space-y-2">
                {FORMAT_OPTIONS.map((format) => (
                  <button
                    key={format.id}
                    onClick={() => toggleFormat(format.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                      selectedFormats.includes(format.id)
                        ? "bg-blue-500/20 border-blue-500/50"
                        : "bg-gray-900/50 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg ${
                        selectedFormats.includes(format.id)
                          ? "bg-blue-500/30 text-blue-400"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {format.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{format.name}</p>
                      <p className="text-xs text-gray-500 truncate">{format.description}</p>
                    </div>
                    {selectedFormats.includes(format.id) && (
                      <Check className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Audience Selection */}
            <div>
              <label className="block text-sm font-semibold mb-3">Target Audience</label>
              <div className="space-y-2">
                {AUDIENCE_OPTIONS.map((audience) => (
                  <button
                    key={audience.id}
                    onClick={() => setSelectedAudience(audience.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                      selectedAudience === audience.id
                        ? "bg-green-500/20 border-green-500/50"
                        : "bg-gray-900/50 border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg ${
                        selectedAudience === audience.id
                          ? "bg-green-500/30 text-green-400"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {audience.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{audience.name}</p>
                      <p className="text-xs text-gray-500 truncate">{audience.description}</p>
                    </div>
                    {selectedAudience === audience.id && (
                      <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Section Toggles */}
            <div>
              <label className="block text-sm font-semibold mb-3">Include Sections</label>
              <div className="space-y-1">
                {SECTION_OPTIONS.map((section) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-900/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSections.includes(section.id)}
                      onChange={() => toggleSection(section.id)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">{section.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Custom Title */}
            <div>
              <label className="block text-sm font-semibold mb-2">Custom Title (optional)</label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Crash Analysis Report"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Footer Text */}
            <div>
              <label className="block text-sm font-semibold mb-2">Footer Text (optional)</label>
              <input
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Generated by Hadron"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Preview Panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Preview Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium">Preview</span>
              </div>
              <div className="flex gap-2">
                {FORMAT_OPTIONS.filter((f) => selectedFormats.includes(f.id)).map((format) => (
                  <button
                    key={format.id}
                    onClick={() => setPreviewFormat(format.id)}
                    className={`px-3 py-1 text-xs rounded-lg transition ${
                      previewFormat === format.id
                        ? "bg-blue-500/30 text-blue-400"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {format.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-auto p-4 bg-gray-900/50">
              {isLoadingPreview ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                </div>
              ) : (
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                  {preview || "Select formats and settings to see preview..."}
                </pre>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-700">
          <div className="text-sm text-gray-400">
            {selectedFormats.length} format{selectedFormats.length !== 1 ? "s" : ""} selected
            {selectedAudience !== "technical" && (
              <span className="ml-2 text-green-400">
                • PII redaction for {selectedAudience}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {exportMessage && (
              <span
                className={`text-sm ${
                  exportMessage.includes("failed") ? "text-red-400" : "text-green-400"
                }`}
              >
                {exportMessage}
              </span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || selectedFormats.length === 0}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export {selectedFormats.length > 1 ? "All" : ""}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
