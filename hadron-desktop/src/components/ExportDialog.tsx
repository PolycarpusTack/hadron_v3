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
  FileSpreadsheet,
  LayoutDashboard,
  AlignLeft,
} from "lucide-react";
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import type { ExportSource, ExportResponse, ReportAudience } from "../types";
import { previewReport, exportGenericReport, previewGenericReport } from "../services/api";
import { invoke } from "@tauri-apps/api/core";
import logger from "../services/logger";

interface ExportDialogProps {
  source: ExportSource;
  isOpen: boolean;
  onClose: () => void;
}

interface FormatOption {
  id: string;
  name: string;
  icon: JSX.Element;
  extension: string;
  description: string;
  /** If true, content is base64-encoded binary */
  isBinary?: boolean;
}

interface AudienceOption {
  id: ReportAudience;
  name: string;
  icon: JSX.Element;
  description: string;
}

/** Formats that support live preview (text-based formats only) */
const PREVIEWABLE_FORMATS = new Set(["markdown", "html", "html_interactive", "json", "txt"]);

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
    id: "html_interactive",
    name: "Interactive HTML",
    icon: <LayoutDashboard className="w-4 h-4" />,
    extension: "html",
    description: "Interactive page with tabbed navigation per section",
  },
  {
    id: "json",
    name: "JSON",
    icon: <FileJson className="w-4 h-4" />,
    extension: "json",
    description: "Structured data format for integration with other tools",
  },
  {
    id: "txt",
    name: "Plain Text",
    icon: <AlignLeft className="w-4 h-4" />,
    extension: "txt",
    description: "Simple text format without formatting",
  },
  {
    id: "xlsx",
    name: "Excel (XLSX)",
    icon: <FileSpreadsheet className="w-4 h-4" />,
    extension: "xlsx",
    description: "Multi-sheet spreadsheet with tabbed sections",
    isBinary: true,
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

export default function ExportDialog({ source, isOpen, onClose }: ExportDialogProps) {
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["markdown"]);
  const [selectedAudience, setSelectedAudience] = useState<ReportAudience>("technical");
  const [selectedSections, setSelectedSections] = useState<string[]>(() =>
    source.sections.filter(s => s.defaultOn).map(s => s.id)
  );
  const [customTitle, setCustomTitle] = useState("");
  const [footerText, setFooterText] = useState("");
  const [preview, setPreview] = useState<string>("");
  const [previewFormat, setPreviewFormat] = useState<string>("markdown");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Update preview when settings change
  useEffect(() => {
    if (isOpen && source.sections.length > 0) {
      loadPreview();
    }
  }, [isOpen, selectedAudience, previewFormat, selectedSections]);

  const loadPreview = useCallback(async () => {
    if (!PREVIEWABLE_FORMATS.has(previewFormat)) return;
    const activeSections = source.sections.filter(s => selectedSections.includes(s.id));
    if (activeSections.length === 0) return;

    setIsLoadingPreview(true);
    try {
      let previewContent: string;
      if (source.sourceType === "crash") {
        const crashContent = activeSections.map(s => s.content).join("\n\n");
        previewContent = await previewReport(
          crashContent,
          source.sourceName,
          previewFormat,
          selectedAudience
        );
      } else {
        previewContent = await previewGenericReport(
          source.sourceType,
          source.sourceName,
          previewFormat,
          selectedAudience,
          customTitle || source.defaultTitle,
          activeSections.map(({ id, label, content }) => ({ id, label, content }))
        );
      }
      setPreview(previewContent);
    } catch (error) {
      logger.error("Preview failed", { error });
      setPreview(`Preview failed: ${error}`);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [source, selectedSections, previewFormat, selectedAudience, customTitle]);

  const toggleFormat = (formatId: string) => {
    setSelectedFormats((prev) => {
      if (prev.includes(formatId)) {
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
    if (selectedFormats.length === 0) return;

    setIsExporting(true);
    setExportMessage(null);

    try {
      const activeSections = source.sections.filter(s => selectedSections.includes(s.id));
      const results: ExportResponse[] = [];

      for (const fmt of selectedFormats) {
        if (source.sourceType === "crash") {
          const crashContent = activeSections.map(s => s.content).join("\n\n");
          const result = await invoke<ExportResponse>("generate_report", {
            request: {
              crash_content: crashContent,
              file_name: source.sourceName,
              format: fmt,
              audience: selectedAudience,
              title: customTitle || undefined,
              include_sections: selectedSections.length > 0 ? selectedSections : undefined,
              footer_text: footerText || undefined,
            },
          });
          results.push(result);
        } else {
          const result = await exportGenericReport({
            source_type: source.sourceType,
            source_name: source.sourceName,
            format: fmt,
            audience: selectedAudience,
            title: customTitle || source.defaultTitle,
            sections: activeSections.map(({ id, label, content }) => ({ id, label, content })),
            footer_text: footerText || undefined,
          });
          results.push(result);
        }
      }

      for (const result of results) {
        downloadFile(result);
      }

      setExportMessage(`Successfully exported ${results.length} file(s)`);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      logger.error("Export failed", { error });
      setExportMessage(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadFile = (result: ExportResponse) => {
    const formatDef = FORMAT_OPTIONS.find((f) => f.id === result.format);

    if (formatDef?.isBinary) {
      // Binary content is base64-encoded — decode to bytes
      const binaryString = atob(result.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      triggerDownload(blob, result.suggested_filename);
    } else {
      const mimeTypes: Record<string, string> = {
        html: "text/html",
        html_interactive: "text/html",
        json: "application/json",
        markdown: "text/markdown",
        txt: "text/plain",
      };
      const blob = new Blob([result.content], {
        type: mimeTypes[result.format] || "text/plain",
      });
      triggerDownload(blob, result.suggested_filename);
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get previewable formats from the selected set
  const previewableSelected = FORMAT_OPTIONS.filter(
    (f) => selectedFormats.includes(f.id) && PREVIEWABLE_FORMATS.has(f.id)
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Download className="w-6 h-6 text-blue-400" />
            <div>
              <h2 id="export-dialog-title" className="text-2xl font-bold">
                Export Report
              </h2>
              <p className="text-sm text-gray-400">{source.sourceName}</p>
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
                {source.sections.map((section) => (
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
                placeholder={source.defaultTitle}
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
              <div className="flex gap-2 flex-wrap">
                {previewableSelected.map((format) => (
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
              ) : !PREVIEWABLE_FORMATS.has(previewFormat) ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Preview not available for binary formats.</p>
                    <p className="text-xs mt-1">The file will be generated on export.</p>
                  </div>
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
            <Button
              variant="secondary"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={isExporting || selectedFormats.length === 0}
              loading={isExporting}
              icon={<Download />}
              className="font-semibold"
            >
              {isExporting ? "Exporting..." : `Export ${selectedFormats.length > 1 ? "All" : ""}`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
