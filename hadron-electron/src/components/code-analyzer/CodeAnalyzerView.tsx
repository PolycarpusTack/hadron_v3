import { useState, useEffect, useRef } from "react";
import {
  Code,
  BookOpen,
  Lightbulb,
  Shield,
  Trash2,
  FileCode,
  Upload,
  Download,
} from "lucide-react";
import type {
  CodeAnalysisResult,
  CodeAnalyzerTab,
  CodeInput,
  ExportSource,
} from "../../types";
import logger from "../../services/logger";
import AnalyzerEntryPanel from "../AnalyzerEntryPanel";
import ExportDialog from "../ExportDialog";
import Button from "../ui/Button";

import { SOFT_TOKEN_WARN_BYTES, warnIfLargeFile } from "./constants";
import { detectLanguage } from "./detectLanguage";
import OverviewTab from "./tabs/OverviewTab";
import WalkthroughTab from "./tabs/WalkthroughTab";
import IssuesTab from "./tabs/IssuesTab";
import OptimizedTab from "./tabs/OptimizedTab";
import QualityTab from "./tabs/QualityTab";
import LearnTab from "./tabs/LearnTab";

// ============================================================================
// Props Interface
// ============================================================================

interface CodeAnalyzerViewProps {
  onAnalyze: (code: string, filename: string, language: string) => Promise<CodeAnalysisResult>;
  isAnalyzing: boolean;
  analysisResult: CodeAnalysisResult | null;
  codeInput: CodeInput | null;
  activeTab: CodeAnalyzerTab;
  onTabChange: (tab: CodeAnalyzerTab) => void;
  onSetInput: (input: CodeInput) => void;
  onClear: () => void;
}

// ============================================================================
// Export Helper
// ============================================================================

function buildCodeExportSource(
  result: CodeAnalysisResult,
  filename: string,
  language: string
): ExportSource {
  const sections: ExportSource["sections"] = [
    {
      id: "summary",
      label: "Summary",
      content: result.summary,
      defaultOn: true,
    },
    {
      id: "quality",
      label: "Quality Scores",
      content: [
        `Overall: ${result.qualityScores.overall}/100`,
        `Security: ${result.qualityScores.security}/100`,
        `Performance: ${result.qualityScores.performance}/100`,
        `Maintainability: ${result.qualityScores.maintainability}/100`,
        `Best Practices: ${result.qualityScores.bestPractices}/100`,
      ].join("\n"),
      defaultOn: true,
    },
    {
      id: "issues",
      label: "Issues",
      content:
        result.issues.length > 0
          ? result.issues
              .map(
                (issue) =>
                  `[${issue.severity.toUpperCase()}] ${issue.title} (line ${issue.line})\n  ${issue.description}\n  Fix: ${issue.fix}`
              )
              .join("\n\n")
          : "No issues found.",
      defaultOn: true,
    },
    {
      id: "walkthrough",
      label: "Code Walkthrough",
      content: result.walkthrough
        .map(
          (section) =>
            `### ${section.title}\n\`\`\`\n${section.code}\n\`\`\`\n${section.whatItDoes}\n\nWhy it matters: ${section.whyItMatters}`
        )
        .join("\n\n"),
      defaultOn: false,
    },
  ];

  if (result.optimizedCode) {
    sections.push({
      id: "optimized",
      label: "Optimized Code",
      content: "```" + language + "\n" + result.optimizedCode + "\n```",
      defaultOn: false,
    });
  }

  if (result.glossary && result.glossary.length > 0) {
    sections.push({
      id: "glossary",
      label: "Glossary",
      content: result.glossary
        .map((g) => `**${g.term}**: ${g.definition}`)
        .join("\n"),
      defaultOn: false,
    });
  }

  return {
    sourceType: "code",
    sourceName: filename,
    defaultTitle: `Code Analysis: ${filename}`,
    sections,
  };
}

// ============================================================================
// Main Component
// ============================================================================

export default function CodeAnalyzerView({
  onAnalyze,
  isAnalyzing,
  analysisResult,
  codeInput,
  activeTab,
  onTabChange,
  onSetInput,
  onClear,
}: CodeAnalyzerViewProps) {
  const [input, setInput] = useState("");
  const [filename, setFilename] = useState("code.txt");
  const [language, setLanguage] = useState("Auto-detect");
  const [highlightIssueId, setHighlightIssueId] = useState<number | undefined>();
  const [issuesSeverityFilter, setIssuesSeverityFilter] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore input if we have it in state
  useEffect(() => {
    if (codeInput) {
      setInput(codeInput.content);
      setFilename(codeInput.filename);
      setLanguage(codeInput.language);
    }
  }, [codeInput]);

  const handleAnalyze = async () => {
    if (!input.trim()) return;

    if (input.length > SOFT_TOKEN_WARN_BYTES) {
      const proceed = window.confirm(
        `This code is ${(input.length / 1024).toFixed(0)} KB (~${Math.round(input.length / 4).toLocaleString()} tokens). ` +
        `It may exceed your AI model's context limit. Proceed anyway?`
      );
      if (!proceed) return;
    }

    const detectedLang = language === "Auto-detect" ? detectLanguage(input, filename) : language;
    // Reflect the resolved language back into the dropdown so it doesn't stay on "Auto-detect"
    if (language === "Auto-detect") setLanguage(detectedLang);
    onSetInput({ content: input, filename, language: detectedLang });

    try {
      await onAnalyze(input, filename, detectedLang);
    } catch (error) {
      logger.error("Code analysis failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleClear = () => {
    setInput("");
    setFilename("code.txt");
    setLanguage("Auto-detect");
    onClear();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (!warnIfLargeFile(file)) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setInput(content);
        setFilename(file.name);
        setLanguage(detectLanguage(content, file.name));
      };
      reader.readAsText(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!warnIfLargeFile(file)) return;
      // Reset so the browser fires onChange again if the same file is selected next time
      e.target.value = "";
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setInput(content);
        setFilename(file.name);
        setLanguage(detectLanguage(content, file.name));
      };
      reader.readAsText(file);
    }
  };

  const navigateToIssue = (issueId: number) => {
    // Reset to undefined first so the prop always changes, even for repeated clicks
    // on the same issue. The rAF gives React one frame to propagate the reset before
    // re-setting the new value.
    setHighlightIssueId(undefined);
    onTabChange("issues");
    requestAnimationFrame(() => setHighlightIssueId(issueId));
  };

  const navigateToFilteredIssues = (severity: string) => {
    setIssuesSeverityFilter(severity);
    onTabChange("issues");
  };

  const tabs: { id: CodeAnalyzerTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "walkthrough", label: "Walkthrough" },
    { id: "issues", label: `Issues${analysisResult ? ` (${analysisResult.issues.length})` : ""}` },
    { id: "optimized", label: "Optimized" },
    { id: "quality", label: "Quality" },
    { id: "learn", label: "Learn" },
  ];

  return (
    <div className="space-y-6">
      {/* Input + Placeholder when no result */}
      {!analysisResult && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Left: Input panel */}
            <div className="md:col-span-7">
              <AnalyzerEntryPanel
                icon={<Code className="w-6 h-6 text-violet-400" />}
                title="Code Analyzer"
                subtitle="Analyze code for issues, get walkthroughs, and learn best practices"
                iconBgClassName="bg-violet-500/20"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-300">Paste or drop your code:</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="px-3 py-1 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200"
                      >
                        <option>Auto-detect</option>
                        <option>CSS</option>
                        <option>Go</option>
                        <option>HTML</option>
                        <option>Java</option>
                        <option>JavaScript</option>
                        <option>JSON</option>
                        <option>Markdown</option>
                        <option>Python</option>
                        <option>React</option>
                        <option>Ruby</option>
                        <option>Rust</option>
                        <option>Smalltalk</option>
                        <option>SQL</option>
                        <option>TypeScript</option>
                        <option>XML</option>
                        <option>YAML</option>
                        <option>Plaintext</option>
                      </select>
                      <input
                        type="text"
                        value={filename}
                        onChange={(e) => setFilename(e.target.value)}
                        placeholder="filename.ext"
                        className="px-3 py-1 bg-gray-900 border border-gray-700 rounded text-sm font-mono text-gray-200 w-40"
                      />
                    </div>
                  </div>

                  <div
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    className="relative"
                  >
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Paste code here, or drag & drop a file..."
                      className="w-full h-64 px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none font-mono text-sm text-gray-200"
                      disabled={isAnalyzing}
                    />
                    {!input && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center text-gray-400">
                          <Upload className="w-8 h-8 mx-auto mb-2" />
                          <p className="text-sm">Drop a file here or paste code above</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={handleAnalyze}
                      disabled={!input.trim() || isAnalyzing}
                      loading={isAnalyzing}
                      icon={<FileCode className="w-4 h-4" />}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {isAnalyzing ? "Analyzing..." : "Analyze Code"}
                    </Button>

                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isAnalyzing}
                      variant="secondary"
                      icon={<Upload className="w-4 h-4" />}
                    >
                      Browse
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      accept=".sql,.tsx,.jsx,.ts,.js,.st,.py,.rs,.go,.java,.xml,.html,.css,.json,.yaml,.yml,.md,.rb,.txt"
                    />

                    <Button
                      onClick={handleClear}
                      disabled={isAnalyzing}
                      variant="secondary"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </AnalyzerEntryPanel>
            </div>

            {/* Right: Results placeholder */}
            <div className="md:col-span-5">
              <div className="hd-panel p-4" style={{ minHeight: 400 }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>Results</h3>
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <span className="text-4xl mb-3">🔍</span>
                  <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>Submit code to see analysis results</p>
                  <p className="text-xs mt-2" style={{ color: 'var(--hd-text-dim)' }}>Security issues, code smells, and suggestions</p>
                </div>
              </div>
            </div>
          </div>

          {/* Feature highlights below the grid */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="hd-config-grid-card">
              <Shield className="w-6 h-6 text-purple-400 mb-3" />
              <h3 className="font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Security & Risks</h3>
              <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>Spot risky patterns, unsafe inputs, and security hotspots with prioritized severity.</p>
            </div>
            <div className="hd-config-grid-card">
              <BookOpen className="w-6 h-6 text-blue-400 mb-3" />
              <h3 className="font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Guided Walkthroughs</h3>
              <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>Step-by-step explanations that map issues to concrete fixes and best practices.</p>
            </div>
            <div className="hd-config-grid-card">
              <Lightbulb className="w-6 h-6 text-green-400 mb-3" />
              <h3 className="font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Optimization Ideas</h3>
              <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>Performance and quality suggestions with practical next steps you can apply.</p>
            </div>
          </div>
        </>
      )}

      {/* Results Section - full width */}
      {analysisResult && (
        <>
          {/* Action Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Analyzed: <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{codeInput?.filename}</span>
              </span>
              <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 rounded text-xs">
                {codeInput?.language}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setShowExport(true)}
                icon={<Download className="w-4 h-4" />}
              >
                Export
              </Button>
              <Button
                onClick={handleClear}
                variant="ghost"
                icon={<Trash2 className="w-4 h-4" />}
              >
                New Analysis
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-violet-600 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20"
                      : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 hover:border-gray-400 dark:hover:border-gray-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* All tab panels stay mounted to preserve filter/expand state — toggled via CSS only */}
            <div className="p-6 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className={activeTab !== "overview" ? "hidden" : ""}>
                <OverviewTab result={analysisResult} onNavigateToIssue={navigateToIssue} />
              </div>
              <div className={activeTab !== "walkthrough" ? "hidden" : ""}>
                <WalkthroughTab sections={analysisResult.walkthrough} />
              </div>
              <div className={activeTab !== "issues" ? "hidden" : ""}>
                <IssuesTab issues={analysisResult.issues} highlightIssueId={highlightIssueId} externalSeverityFilter={issuesSeverityFilter} />
              </div>
              <div className={activeTab !== "optimized" ? "hidden" : ""}>
                <OptimizedTab code={analysisResult.optimizedCode} />
              </div>
              <div className={activeTab !== "quality" ? "hidden" : ""}>
                <QualityTab scores={analysisResult.qualityScores} issues={analysisResult.issues} onFilterToSeverity={navigateToFilteredIssues} />
              </div>
              <div className={activeTab !== "learn" ? "hidden" : ""}>
                <LearnTab
                  glossary={analysisResult.glossary}
                  hasOptimizedCode={analysisResult.optimizedCode !== null}
                  criticalCount={analysisResult.issues.filter((i) => i.severity === "critical").length}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {analysisResult && codeInput && (
        <ExportDialog
          source={buildCodeExportSource(analysisResult, codeInput.filename, codeInput.language)}
          isOpen={showExport}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
