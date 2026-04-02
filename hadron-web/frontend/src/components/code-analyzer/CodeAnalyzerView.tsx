import { useCallback, useEffect, useRef, useState } from "react";
import { useAiStream } from "../../hooks/useAiStream";
import type { CodeAnalysisResult } from "../../services/api";
import { detectLanguage } from "./detectLanguage";
import { ALL_LANGUAGES, MAX_FILE_SIZE_BYTES, MAX_CODE_SIZE_BYTES } from "./constants";
import { OverviewTab } from "./tabs/OverviewTab";
import { IssuesTab } from "./tabs/IssuesTab";
import { WalkthroughTab } from "./tabs/WalkthroughTab";
import { OptimizedTab } from "./tabs/OptimizedTab";
import { QualityTab } from "./tabs/QualityTab";
import { LearnTab } from "./tabs/LearnTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "walkthrough", label: "Walkthrough" },
  { id: "issues", label: "Issues" },
  { id: "optimized", label: "Optimized" },
  { id: "quality", label: "Quality" },
  { id: "learn", label: "Learn" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function CodeAnalyzerView() {
  const [code, setCode] = useState("");
  const [filename, setFilename] = useState("");
  const [language, setLanguage] = useState("Plaintext");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [result, setResult] = useState<CodeAnalysisResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [highlightIssueId, setHighlightIssueId] = useState<number | undefined>();
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const { streamAi, content, isStreaming, error, reset } = useAiStream();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Language auto-detect (debounced 300ms)
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLanguage(detectLanguage(code, filename));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [code, filename]);

  // Parse on stream completion
  useEffect(() => {
    if (isStreaming || !content) return;

    try {
      const parsed = JSON.parse(content) as CodeAnalysisResult;
      setResult(parsed);
      setParseError(null);
      return;
    } catch {
      // Try extracting JSON object from raw content
    }

    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as CodeAnalysisResult;
        setResult(parsed);
        setParseError(null);
        return;
      } catch {
        // Both strategies failed
      }
    }

    setParseError("Failed to parse AI response. The raw output is shown below.");
  }, [content, isStreaming]);

  const handleAnalyze = useCallback(() => {
    setResult(null);
    setParseError(null);
    streamAi("/code-analysis/stream", { code, language, filename });
  }, [code, language, filename, streamAi]);

  const handleClear = useCallback(() => {
    reset();
    setResult(null);
    setParseError(null);
    setCode("");
    setFilename("");
    setLanguage("Plaintext");
    setHighlightIssueId(undefined);
    setSeverityFilter(null);
  }, [reset]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_CODE_SIZE_BYTES) {
        alert(
          `File is too large (${(file.size / 1024).toFixed(0)} KB). Maximum allowed is ${(MAX_CODE_SIZE_BYTES / 1024).toFixed(0)} KB.`,
        );
        // Reset input so the same file can be re-selected after trimming
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const proceed = confirm(
          `File is large (${(file.size / 1024).toFixed(0)} KB). Analysis quality may be reduced. Continue?`,
        );
        if (!proceed) {
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setCode(text);
        setFilename(file.name);
        setLanguage(detectLanguage(text, file.name));
      };
      reader.readAsText(file);

      // Reset input for re-upload of the same file
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const onNavigateToIssue = useCallback((id: number) => {
    setActiveTab("issues");
    setHighlightIssueId(id);
  }, []);

  const onFilterToSeverity = useCallback((sev: string) => {
    setActiveTab("issues");
    setSeverityFilter(sev);
  }, []);

  const showResults = result || isStreaming || error || parseError;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-200">Code Analyzer</h1>
        <button
          onClick={handleClear}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          Clear
        </button>
      </div>

      {/* Input area */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste your code here..."
          className="min-h-[200px] w-full resize-y rounded-md border border-slate-600 bg-slate-900 p-3 font-mono text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          spellCheck={false}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Filename */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Filename:</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="optional"
              className="rounded border border-slate-600 bg-slate-900 px-3 py-1 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Language dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Language:</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded border border-slate-600 bg-slate-900 px-3 py-1 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {ALL_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          {/* File upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              className="hidden"
              id="code-file-upload"
              accept=".ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.sql,.xml,.html,.css,.json,.yaml,.yml,.md,.rb,.txt"
            />
            <label
              htmlFor="code-file-upload"
              className="cursor-pointer rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            >
              Upload File
            </label>
          </div>
        </div>

        {/* Analyze button */}
        <div className="mt-3">
          <button
            onClick={handleAnalyze}
            disabled={isStreaming || !code.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? "Analyzing..." : "Analyze Code"}
          </button>
        </div>
      </div>

      {/* Streaming / error / parse-error feedback */}
      {isStreaming && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-blue-400">
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Analyzing...
          </div>
          {content && (
            <pre className="max-h-[200px] overflow-y-auto rounded bg-slate-900 p-2 text-xs text-slate-400">
              {content}
            </pre>
          )}
        </div>
      )}

      {!isStreaming && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {!isStreaming && parseError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="mb-2 text-sm font-medium text-yellow-400">{parseError}</p>
          <pre className="max-h-[300px] overflow-y-auto rounded bg-slate-900 p-2 text-xs text-slate-400">
            {content}
          </pre>
        </div>
      )}

      {/* Results: tab navigation + tab panels */}
      {showResults && result && (
        <div className="rounded-lg border border-slate-700 bg-slate-900">
          {/* Tab bar */}
          <div className="flex flex-wrap gap-1 border-b border-slate-700 p-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                }`}
              >
                {tab.label}
                {tab.id === "issues" && result.issues.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-600 px-1.5 py-0.5 text-xs text-slate-300">
                    {result.issues.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab panels — all mounted, toggled via display */}
          <div className="p-4">
            <div style={{ display: activeTab === "overview" ? "block" : "none" }}>
              <OverviewTab result={result} onNavigateToIssue={onNavigateToIssue} />
            </div>
            <div style={{ display: activeTab === "walkthrough" ? "block" : "none" }}>
              <WalkthroughTab sections={result.walkthrough} />
            </div>
            <div style={{ display: activeTab === "issues" ? "block" : "none" }}>
              <IssuesTab
                issues={result.issues}
                highlightIssueId={highlightIssueId}
                externalSeverityFilter={severityFilter}
              />
            </div>
            <div style={{ display: activeTab === "optimized" ? "block" : "none" }}>
              <OptimizedTab code={result.optimizedCode} />
            </div>
            <div style={{ display: activeTab === "quality" ? "block" : "none" }}>
              <QualityTab
                scores={result.qualityScores}
                issues={result.issues}
                onFilterToSeverity={onFilterToSeverity}
              />
            </div>
            <div style={{ display: activeTab === "learn" ? "block" : "none" }}>
              <LearnTab
                glossary={result.glossary}
                hasOptimizedCode={result.optimizedCode != null}
                criticalCount={result.issues.filter((i) => i.severity === "critical").length}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
