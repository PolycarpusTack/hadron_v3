import { useEffect, useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import FileDropZone from "./components/FileDropZone";
import AnalysisResults from "./components/AnalysisResults";
import SettingsPanel from "./components/SettingsPanel";
import HistoryView from "./components/HistoryView";
import CodeAnalyzerView from "./components/CodeAnalyzerView";
import PerformanceAnalyzerView from "./components/PerformanceAnalyzerView";
import ConsoleViewer from "./components/ConsoleViewer";
import Splashscreen from "./components/Splashscreen";
import { ViewErrorBoundary } from "./components/ErrorBoundary";
import Navigation from "./components/Navigation";
import ErrorDisplay from "./components/ErrorDisplay";
import ApiKeyWarning from "./components/ApiKeyWarning";
import BatchProgressDisplay from "./components/BatchProgressDisplay";
import AppHeader from "./components/AppHeader";
import AppFooter from "./components/AppFooter";
import { analyzeCrashLog, translateTechnicalContent, getStoredModel, getStoredProvider, type AnalysisMode } from "./services/api";
import { checkAndUpdate } from "./services/updater";
import { getApiKey, migrateFromLocalStorage } from "./services/secure-storage";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppState } from "./hooks/useAppState";
import { retryOperation, getUserFriendlyErrorMessage, getRecoverySuggestions } from "./utils/errorHandling";
import logger from "./services/logger";

// Lazy-loaded components for code splitting
const AnalysisDetailView = lazy(() => import("./components/AnalysisDetailView"));
const WhatsOnDetailView = lazy(() => import("./components/WhatsOnDetailView"));
const DashboardPanel = lazy(() => import("./components/DashboardPanel"));

// Loading fallback component
function LazyLoadFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      <span className="ml-2 text-gray-400">Loading...</span>
    </div>
  );
}

function App() {
  const { state, actions } = useAppState();
  const [showConsole, setShowConsole] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Destructure for cleaner code
  const {
    currentView,
    showSettings,
    showDashboard,
    darkMode,
    apiKey,
    analyzing,
    analysisResult,
    selectedAnalysis,
    batchProgress,
    batchSummary,
    error,
    // Code Analyzer
    codeAnalyzerTab,
    codeAnalyzing,
    codeAnalysisResult,
    codeInput,
  } = state;

  // Initialize app on mount
  useEffect(() => {
    async function initializeApp() {
      // Run migration from localStorage to encrypted storage
      await migrateFromLocalStorage();

      // Load API key from encrypted storage
      const provider = getStoredProvider();
      const storedKey = await getApiKey(provider);

      // Load theme (non-sensitive, keep in localStorage for now)
      const storedTheme = localStorage.getItem("theme");
      const isDark = storedTheme === "dark" || storedTheme === null;

      // Initialize state
      actions.initComplete(storedKey || '', isDark);

      // Apply theme to document
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }

      // Optional: auto-check for updates on startup
      try {
        const autoCheck = localStorage.getItem("auto_check_updates") === "true";
        if (autoCheck) {
          checkAndUpdate().catch((e) => console.warn("Auto update check failed", e));
        }
      } catch (e) {
        console.warn("Auto update check failed", e);
      }
    }

    initializeApp();
  }, [actions]);

  // Update theme when it changes
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewAnalysis: () => {
      actions.setView("analyze");
      actions.clearAnalysis();
    },
    onViewHistory: () => actions.setView("history"),
    onOpenSettings: () => actions.openSettings(),
    onCloseModal: () => {
      if (showConsole) {
        setShowConsole(false);
      } else if (showSettings) {
        actions.closeSettings();
      } else if (currentView === "detail") {
        actions.backToHistory();
      }
    },
    onToggleConsole: () => setShowConsole(prev => !prev),
  });

  // Handle single file analysis
  const handleFileSelect = async (filePath: string, analysisType: string = "complete", analysisMode: AnalysisMode = "auto") => {
    actions.startAnalysis();

    try {
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      logger.info('Starting crash analysis', { filePath, model, provider, analysisType, analysisMode });

      const result = await retryOperation(
        () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType, analysisMode),
        { maxAttempts: 3, delayMs: 1000, backoff: true }
      );

      actions.analysisSuccess({
        id: result.id,
        filename: result.filename,
        file_size_kb: 0,
        error_type: result.error_type,
        severity: result.severity.toUpperCase() as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        root_cause: result.root_cause,
        suggested_fixes: JSON.stringify(result.suggested_fixes),
        analyzed_at: result.analyzed_at,
        ai_model: getStoredModel() || "unknown",
        tokens_used: 0,
        cost: result.cost,
        was_truncated: false,
        is_favorite: false,
        view_count: 0,
      });
    } catch (err) {
      logger.error('Analysis failed', {
        error: err instanceof Error ? err.message : String(err),
        filePath,
        provider: getStoredProvider(),
        model: getStoredModel(),
      });

      const friendlyMessage = getUserFriendlyErrorMessage(err);
      const suggestions = getRecoverySuggestions(err);
      actions.analysisError(friendlyMessage, suggestions);
    }
  };

  // Handle batch file analysis
  const handleBatchSelect = async (filePaths: string[], analysisType: string = "complete", analysisMode: AnalysisMode = "auto") => {
    if (!filePaths || filePaths.length === 0) return;

    actions.startBatch(filePaths.length);

    try {
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      // Track counts locally to avoid stale state reads in loop
      let processedCount = 0;
      let failedCount = 0;

      for (const filePath of filePaths) {
        // Update current file being processed
        actions.batchProgress({ currentFile: filePath, processed: processedCount, failed: failedCount });

        try {
          logger.info("Starting batch crash analysis", { filePath, model, provider, analysisType, analysisMode });

          await retryOperation(
            () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType, analysisMode),
            { maxAttempts: 3, delayMs: 1000, backoff: true }
          );

          logger.info("Batch analysis succeeded", { filePath, model, provider, analysisType, analysisMode });
        } catch (err) {
          logger.error("Batch analysis failed", {
            error: err instanceof Error ? err.message : String(err),
            filePath,
            provider: getStoredProvider(),
            model: getStoredModel(),
          });
          failedCount += 1;
        } finally {
          processedCount += 1;
          // Update progress with local counts (avoids stale state issue)
          actions.batchProgress({ processed: processedCount, failed: failedCount });
        }
      }

      const succeeded = filePaths.length - failedCount;
      actions.batchComplete(`Batch complete: ${succeeded} succeeded, ${failedCount} failed.`);
    } catch (err) {
      const friendlyMessage = getUserFriendlyErrorMessage(err);
      const suggestions = getRecoverySuggestions(err);
      actions.setError(friendlyMessage, suggestions);
    }
  };

  // Handle code analysis
  const handleCodeAnalysis = async (code: string, filename: string, language: string) => {
    actions.startCodeAnalysis();

    try {
      if (!apiKey) {
        throw new Error("Please set your API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      logger.info('Starting code analysis', { filename, language, model, provider });

      // Full code analysis prompt
      const analysisPrompt = `You are an expert code reviewer. Analyze this ${language} code and return a comprehensive JSON response.

FILENAME: ${filename}
LANGUAGE: ${language}

CODE:
${code}

Return a JSON object with this EXACT structure:
{
  "summary": "2-3 sentence description of what this code does and its purpose",
  "issues": [
    {
      "id": 1,
      "severity": "critical|high|medium|low",
      "category": "security|performance|error|best-practice",
      "line": <line number>,
      "title": "Short issue title",
      "description": "What's wrong and why it matters",
      "technical": "Technical details and evidence from the code",
      "fix": "Suggested fix with code example",
      "complexity": "Low|Medium|High",
      "impact": "Real-world impact if not fixed"
    }
  ],
  "walkthrough": [
    {
      "lines": "1-10",
      "title": "Section name (e.g., 'Imports', 'Main Function', 'Error Handling')",
      "code": "the actual code snippet for these lines",
      "whatItDoes": "Clear explanation of what this code does",
      "whyItMatters": "Why this section is important",
      "evidence": "Specific code tokens/patterns that support the explanation",
      "dependencies": [{"name": "dependency name", "type": "import|variable|function|table", "note": "brief note"}],
      "impact": "What happens if this code is changed or removed",
      "testability": "How to test this section",
      "eli5": "Simple analogy a beginner would understand",
      "quality": "Code quality observations for this section"
    }
  ],
  "optimizedCode": "Improved version of the full code with issues fixed, or null if no improvements needed",
  "qualityScores": {
    "overall": <0-100>,
    "security": <0-100>,
    "performance": <0-100>,
    "maintainability": <0-100>,
    "bestPractices": <0-100>
  },
  "glossary": [
    {"term": "Technical term used", "definition": "Clear definition"}
  ]
}

IMPORTANT INSTRUCTIONS:
1. Find ALL issues - security vulnerabilities, performance problems, bugs, and best practice violations
2. Create walkthrough sections for logical code blocks (imports, functions, classes, etc.)
3. Be specific with line numbers and code references
4. Provide actionable fixes with actual code
5. Return ONLY valid JSON, no markdown or additional text`;

      const response = await translateTechnicalContent(analysisPrompt, apiKey, model, provider);

      // Parse the JSON response
      let result;
      try {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Ensure all required fields exist with defaults
          result = {
            summary: parsed.summary || "Analysis complete.",
            issues: (parsed.issues || []).map((issue: Record<string, unknown>, idx: number) => ({
              ...issue,
              id: issue.id || idx + 1,
              severity: issue.severity || "medium",
              category: issue.category || "best-practice",
              line: issue.line || 1,
              impact: issue.impact || "Review recommended"
            })),
            walkthrough: parsed.walkthrough || [],
            optimizedCode: parsed.optimizedCode || null,
            qualityScores: parsed.qualityScores || {
              overall: 50, security: 50, performance: 50, maintainability: 50, bestPractices: 50
            },
            glossary: parsed.glossary || []
          };
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseError) {
        logger.error('Failed to parse code analysis response', { error: parseError });
        // Show error to user instead of silently falling back to demo data
        const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
        throw new Error(`Failed to parse AI response: ${errorMessage}. The AI may have returned malformed JSON. Please try again.`);
      }

      actions.codeAnalysisSuccess(result);
      return result;
    } catch (err) {
      const friendlyError = getUserFriendlyErrorMessage(err);
      actions.codeAnalysisError(friendlyError);
      throw err;
    }
  };

  // Handle settings change
  const handleSettingsChange = async () => {
    const provider = getStoredProvider();
    const newApiKey = await getApiKey(provider);
    if (newApiKey) {
      actions.setApiKey(newApiKey);
    }
  };

  // Handle opening analysis from dashboard
  const handleOpenFromDashboard = (analysis: typeof selectedAnalysis) => {
    if (analysis) {
      actions.viewAnalysis(analysis);
      actions.closeDashboard();
    }
  };

  // Splashscreen on app start - only show for minimum time, don't block on initialization
  if (showSplash) {
    return (
      <Splashscreen
        onComplete={() => setShowSplash(false)}
        minDisplayTime={1500}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 dark:from-gray-900 dark:to-gray-800 bg-gray-50 text-gray-900 dark:text-white p-8 transition-colors duration-200">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <AppHeader
          onOpenDashboard={actions.openDashboard}
          onOpenSettings={actions.openSettings}
        />

        {/* Navigation Tabs */}
        <Navigation currentView={currentView} onViewChange={actions.setView} />

        {/* API Key Warning */}
        <ApiKeyWarning hasApiKey={!!apiKey} />

        {/* Error Display */}
        <ErrorDisplay error={error} />

        {/* Main Content */}
        <div className="space-y-6">
          {/* Analyze View */}
          {currentView === "analyze" && (
            <ViewErrorBoundary name="Analysis">
              <div id="analyze-panel" role="tabpanel">
                <BatchProgressDisplay
                  batchProgress={batchProgress}
                  batchSummary={batchSummary}
                  isAnalyzing={analyzing}
                />
                {!analysisResult && (
                  <FileDropZone
                    onFileSelect={handleFileSelect}
                    onBatchSelect={handleBatchSelect}
                    onOpenAnalysis={(analysis) => actions.viewAnalysis(analysis)}
                    isAnalyzing={analyzing}
                  />
                )}

                {analysisResult && (
                  <AnalysisResults
                    result={analysisResult}
                    onNewAnalysis={actions.clearAnalysis}
                  />
                )}
              </div>
            </ViewErrorBoundary>
          )}

          {/* Code Analyzer View */}
          {currentView === "translate" && (
            <ViewErrorBoundary name="Code Analyzer">
              <div id="translate-panel" role="tabpanel">
                <CodeAnalyzerView
                  onAnalyze={handleCodeAnalysis}
                  isAnalyzing={codeAnalyzing}
                  analysisResult={codeAnalysisResult}
                  codeInput={codeInput}
                  activeTab={codeAnalyzerTab}
                  onTabChange={actions.setCodeAnalyzerTab}
                  onSetInput={actions.setCodeInput}
                  onClear={actions.clearCodeAnalysis}
                />
              </div>
            </ViewErrorBoundary>
          )}

          {/* History View */}
          {currentView === "history" && (
            <ViewErrorBoundary name="History">
              <div id="history-panel" role="tabpanel">
                <HistoryView onViewAnalysis={actions.viewAnalysis} />
              </div>
            </ViewErrorBoundary>
          )}

          {/* Performance Analyzer View */}
          {currentView === "performance" && (
            <ViewErrorBoundary name="Performance">
              <div id="performance-panel" role="tabpanel">
                <PerformanceAnalyzerView />
              </div>
            </ViewErrorBoundary>
          )}

          {/* Detail View - lazy loaded */}
          {currentView === "detail" && selectedAnalysis && (
            <ViewErrorBoundary name="Analysis Details">
              <Suspense fallback={<LazyLoadFallback />}>
                {selectedAnalysis.analysis_type === "whatson" ? (
                  <WhatsOnDetailView
                    analysis={selectedAnalysis}
                    onBack={actions.backToHistory}
                  />
                ) : (
                  <AnalysisDetailView
                    analysis={selectedAnalysis}
                    onBack={actions.backToHistory}
                  />
                )}
              </Suspense>
            </ViewErrorBoundary>
          )}
        </div>

        {/* Footer */}
        <AppFooter hasApiKey={!!apiKey} />
      </div>

      {/* Settings Panel */}
      <ViewErrorBoundary name="Settings">
        <SettingsPanel
          isOpen={showSettings}
          onClose={actions.closeSettings}
          darkMode={darkMode}
          onThemeChange={actions.setDarkMode}
          onSettingsChange={handleSettingsChange}
        />
      </ViewErrorBoundary>

      {/* Dashboard Panel - lazy loaded */}
      {showDashboard && (
        <ViewErrorBoundary name="Dashboard">
          <Suspense fallback={<LazyLoadFallback />}>
            <DashboardPanel
              isOpen={showDashboard}
              onClose={actions.closeDashboard}
              onOpenAnalysis={handleOpenFromDashboard}
            />
          </Suspense>
        </ViewErrorBoundary>
      )}

      {/* Console Viewer - toggle with Ctrl+Y */}
      <ConsoleViewer
        isOpen={showConsole}
        onClose={() => setShowConsole(false)}
      />
    </div>
  );
}

export default App;
