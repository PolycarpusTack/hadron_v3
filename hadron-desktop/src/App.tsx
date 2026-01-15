import { useEffect } from "react";
import { Settings, FileUp, History, Languages, Activity } from "lucide-react";
import FileDropZone from "./components/FileDropZone";
import AnalysisResults from "./components/AnalysisResults";
import SettingsPanel from "./components/SettingsPanel";
import HistoryView from "./components/HistoryView";
import AnalysisDetailView from "./components/AnalysisDetailView";
import TranslateView from "./components/TranslateView";
import DashboardPanel from "./components/DashboardPanel";
import { ViewErrorBoundary } from "./components/ErrorBoundary";
import { analyzeCrashLog, translateTechnicalContent, getStoredModel, getStoredProvider } from "./services/api";
import { checkAndUpdate } from "./services/updater";
import { getApiKey, migrateFromLocalStorage } from "./services/secure-storage";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppState } from "./hooks/useAppState";
import { retryOperation, getUserFriendlyErrorMessage, getRecoverySuggestions } from "./utils/errorHandling";
import logger from "./services/logger";

function App() {
  const { state, actions } = useAppState();

  // Destructure for cleaner code
  const {
    isInitializing,
    currentView,
    showSettings,
    showDashboard,
    darkMode,
    apiKey,
    analyzing,
    analysisResult,
    selectedAnalysis,
    translating,
    batchProgress,
    batchSummary,
    error,
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
      if (showSettings) {
        actions.closeSettings();
      } else if (currentView === "detail") {
        actions.backToHistory();
      }
    },
  });

  // Handle single file analysis
  const handleFileSelect = async (filePath: string, analysisType: string = "complete") => {
    actions.startAnalysis();

    try {
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      logger.info('Starting crash analysis', { filePath, model, provider, analysisType });

      const result = await retryOperation(
        () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType),
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
  const handleBatchSelect = async (filePaths: string[], analysisType: string = "complete") => {
    if (!filePaths || filePaths.length === 0) return;

    actions.startBatch(filePaths.length);

    try {
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();
      let failedCount = 0;

      for (const filePath of filePaths) {
        actions.batchProgress({ currentFile: filePath });

        try {
          logger.info("Starting batch crash analysis", { filePath, model, provider, analysisType });

          await retryOperation(
            () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType),
            { maxAttempts: 3, delayMs: 1000, backoff: true }
          );

          logger.info("Batch analysis succeeded", { filePath, model, provider, analysisType });
        } catch (err) {
          logger.error("Batch analysis failed", {
            error: err instanceof Error ? err.message : String(err),
            filePath,
            provider: getStoredProvider(),
            model: getStoredModel(),
          });

          failedCount += 1;
          actions.batchProgress({ failed: (batchProgress?.failed || 0) + 1 });
        } finally {
          actions.batchProgress({ processed: (batchProgress?.processed || 0) + 1 });
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

  // Handle translation
  const handleTranslate = async (content: string): Promise<string> => {
    actions.startTranslation();

    try {
      if (!apiKey) {
        throw new Error("Please set your API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      const translation = await translateTechnicalContent(content, apiKey, model, provider);
      actions.translationComplete();
      return translation;
    } catch (err) {
      const friendlyError = getUserFriendlyErrorMessage(err);
      actions.translationError(friendlyError);
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

  // Loading screen during initialization
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Hadron</h2>
          <p className="text-gray-400">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 dark:from-gray-900 dark:to-gray-800 bg-gray-50 text-gray-900 dark:text-white p-8 transition-colors duration-200">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold mb-2">Hadron</h1>
            <p className="text-gray-600 dark:text-gray-400">
              Smalltalk Crash Analyzer powered by AI
            </p>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={actions.openDashboard}
              className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition"
            >
              <Activity className="w-5 h-5" />
              Dashboard
            </button>
            <button
              onClick={actions.openSettings}
              className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition"
            >
              <Settings className="w-5 h-5" />
              Settings
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <div className="mb-6 flex gap-2 border-b border-gray-300 dark:border-gray-700">
          <button
            onClick={() => actions.setView("analyze")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition ${
              currentView === "analyze"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <FileUp className="w-5 h-5" />
            Analyze
          </button>
          <button
            onClick={() => actions.setView("translate")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition ${
              currentView === "translate"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Languages className="w-5 h-5" />
            Translate
          </button>
          <button
            onClick={() => actions.setView("history")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition ${
              currentView === "history" || currentView === "detail"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <History className="w-5 h-5" />
            History
          </button>
        </div>

        {/* API Key Warning */}
        {!apiKey && (
          <div className="mb-6 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <p className="text-yellow-400">
              Warning: API Key Required - Please set your OpenAI API key in Settings to analyze crash logs
            </p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-red-400 font-semibold mb-2">Error: {error.message}</p>
            {error.suggestions.length > 0 && (
              <div className="mt-3 text-sm text-red-300">
                <p className="font-semibold mb-1">Try these solutions:</p>
                <ul className="list-disc list-inside space-y-1">
                  {error.suggestions.map((suggestion, index) => (
                    <li key={index}>{suggestion}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="space-y-6">
          {/* Analyze View */}
          {currentView === "analyze" && (
            <ViewErrorBoundary name="Analysis">
              <>
                {batchProgress && (
                  <div className="mb-4 bg-gray-800/60 border border-gray-700 rounded-lg p-4 text-sm">
                    <div className="font-semibold text-gray-100">
                      Batch analysis: {batchProgress.processed} / {batchProgress.total} completed
                    </div>
                    {batchProgress.currentFile && (
                      <div className="text-xs text-gray-400 truncate mt-1">
                        Current file: {batchProgress.currentFile}
                      </div>
                    )}
                    {batchProgress.failed > 0 && (
                      <div className="text-xs text-red-400 mt-1">
                        Failed: {batchProgress.failed}
                      </div>
                    )}
                  </div>
                )}
                {batchSummary && !analyzing && (
                  <div className="mb-4 bg-gray-800/40 border border-gray-700 rounded-lg p-3 text-xs text-gray-300">
                    {batchSummary}
                  </div>
                )}
                {!analysisResult && (
                  <FileDropZone
                    onFileSelect={handleFileSelect}
                    onBatchSelect={handleBatchSelect}
                    isAnalyzing={analyzing}
                  />
                )}

                {analysisResult && (
                  <AnalysisResults
                    result={analysisResult}
                    onNewAnalysis={actions.clearAnalysis}
                  />
                )}
              </>
            </ViewErrorBoundary>
          )}

          {/* Translate View */}
          {currentView === "translate" && (
            <ViewErrorBoundary name="Translation">
              <TranslateView
                onTranslate={handleTranslate}
                isTranslating={translating}
              />
            </ViewErrorBoundary>
          )}

          {/* History View */}
          {currentView === "history" && (
            <ViewErrorBoundary name="History">
              <HistoryView onViewAnalysis={actions.viewAnalysis} />
            </ViewErrorBoundary>
          )}

          {/* Detail View */}
          {currentView === "detail" && selectedAnalysis && (
            <ViewErrorBoundary name="Analysis Details">
              <AnalysisDetailView
                analysis={selectedAnalysis}
                onBack={actions.backToHistory}
              />
            </ViewErrorBoundary>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-gray-400 dark:text-gray-500 text-sm">
          <div className="mb-2">
            Phase 1: Desktop Foundation | v1.0.0
            {apiKey && <span className="ml-4 text-green-600 dark:text-green-400">API Key Set</span>}
          </div>
          <div className="text-xs opacity-60">
            Shortcuts: Ctrl+N (New) | Ctrl+H (History) | Ctrl+, (Settings) | Esc (Close)
          </div>
        </footer>
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

      {/* Dashboard Panel */}
      <ViewErrorBoundary name="Dashboard">
        <DashboardPanel
          isOpen={showDashboard}
          onClose={actions.closeDashboard}
          onOpenAnalysis={handleOpenFromDashboard}
        />
      </ViewErrorBoundary>
    </div>
  );
}

export default App;
