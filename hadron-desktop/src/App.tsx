import { useState, useEffect } from "react";
import { Settings, FileUp, History, Languages, Activity } from "lucide-react";
import FileDropZone from "./components/FileDropZone";
import AnalysisResults from "./components/AnalysisResults";
import SettingsPanel from "./components/SettingsPanel";
import HistoryView from "./components/HistoryView";
import AnalysisDetailView from "./components/AnalysisDetailView";
import TranslateView from "./components/TranslateView";
import DashboardPanel from "./components/DashboardPanel";
import { analyzeCrashLog, translateTechnicalContent, getStoredModel, getStoredProvider } from "./services/api";
import { checkAndUpdate } from "./services/updater";
import { getApiKey, migrateFromLocalStorage } from "./services/secure-storage";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { retryOperation, getUserFriendlyErrorMessage, getRecoverySuggestions } from "./utils/errorHandling";
import logger from "./services/logger";
import type { AnalysisResult } from "./types";
import type { Analysis } from "./services/api";

type View = "analyze" | "history" | "detail" | "translate";

function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [currentView, setCurrentView] = useState<View>("analyze");
  const [analyzing, setAnalyzing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSuggestions, setErrorSuggestions] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    processed: number;
    currentFile?: string;
    failed: number;
  } | null>(null);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);

  useEffect(() => {
    // Initialize app: migrate localStorage to encrypted storage and load settings
    async function initializeApp() {
      // Run migration from localStorage to encrypted storage
      await migrateFromLocalStorage();

      // Load API key from encrypted storage
      const provider = getStoredProvider();
      const storedKey = await getApiKey(provider);
      if (storedKey) {
        setApiKey(storedKey);
      }

      // Load theme (non-sensitive, keep in localStorage for now)
      const storedTheme = localStorage.getItem("theme");
      const isDark = storedTheme === "dark" || storedTheme === null; // Default to dark
      setDarkMode(isDark);

      // Apply theme to document
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }

      // Optional: auto-check for updates on startup (run in background)
      try {
        const autoCheck = localStorage.getItem("auto_check_updates") === "true";
        if (autoCheck) {
          // Run in background, don't block UI
          checkAndUpdate().catch((e) => console.warn("Auto update check failed", e));
        }
      } catch (e) {
        // Non-blocking
        console.warn("Auto update check failed", e);
      }

      // Mark initialization as complete
      setIsInitializing(false);
    }

    initializeApp();
  }, []);

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
      setCurrentView("analyze");
      setAnalysisResult(null);
      setError(null);
    },
    onViewHistory: () => {
      setCurrentView("history");
    },
    onOpenSettings: () => {
      setShowSettings(true);
    },
    onCloseModal: () => {
      if (showSettings) {
        setShowSettings(false);
      } else if (currentView === "detail") {
        handleBackToHistory();
      }
    },
  });

  const handleFileSelect = async (filePath: string, analysisType: string = "complete") => {
    setAnalyzing(true);
    setError(null);
    setErrorSuggestions([]);

    try {
      // Check if API key is set
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      logger.info('Starting crash analysis', { filePath, model, provider, analysisType });

      // Retry operation with exponential backoff
      const result = await retryOperation(
        () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoff: true,
        }
      );

      setAnalysisResult({
        id: result.id,
        filename: result.filename,
        file_size_kb: 0, // Not provided in response
        error_type: result.error_type,
        severity: result.severity.toUpperCase() as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        root_cause: result.root_cause,
        suggested_fixes: JSON.stringify(result.suggested_fixes), // Convert array to JSON string
        analyzed_at: result.analyzed_at,
        ai_model: getStoredModel() || "unknown",
        tokens_used: 0, // Not provided in response
        cost: result.cost,
        was_truncated: false,
        is_favorite: false,
        view_count: 0,
      });

      setAnalyzing(false);
    } catch (err) {
      logger.error('Analysis failed', {
        error: err instanceof Error ? err.message : String(err),
        filePath,
        provider: getStoredProvider(),
        model: getStoredModel(),
      });

      // Get user-friendly error message
      const friendlyMessage = getUserFriendlyErrorMessage(err);
      const suggestions = getRecoverySuggestions(err);

      setError(friendlyMessage);
      setErrorSuggestions(suggestions);
      setAnalyzing(false);
    }
  };

  const handleBatchSelect = async (filePaths: string[], analysisType: string = "complete") => {
    if (!filePaths || filePaths.length === 0) return;

    setAnalysisResult(null);
    setError(null);
    setErrorSuggestions([]);
    setBatchSummary(null);
    setBatchProgress({
      total: filePaths.length,
      processed: 0,
      currentFile: undefined,
      failed: 0,
    });
    setAnalyzing(true);

    try {
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();
      let failedCount = 0;

      for (const filePath of filePaths) {
        setBatchProgress((prev) =>
          prev
            ? { ...prev, currentFile: filePath }
            : { total: filePaths.length, processed: 0, currentFile: filePath, failed: 0 }
        );

        try {
          logger.info("Starting batch crash analysis", { filePath, model, provider, analysisType });

          await retryOperation(
            () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType),
            {
              maxAttempts: 3,
              delayMs: 1000,
              backoff: true,
            }
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
          setBatchProgress((prev) =>
            prev
              ? { ...prev, failed: prev.failed + 1 }
              : { total: filePaths.length, processed: 0, currentFile: undefined, failed: 1 }
          );
        } finally {
          setBatchProgress((prev) =>
            prev
              ? { ...prev, processed: prev.processed + 1 }
              : { total: filePaths.length, processed: 1, currentFile: undefined, failed: 0 }
          );
        }
      }

      setBatchProgress((prev) =>
        prev ? { ...prev, currentFile: undefined } : prev
      );

      const succeeded = filePaths.length - failedCount;
      setBatchSummary(`Batch complete: ${succeeded} succeeded, ${failedCount} failed.`);
    } catch (err) {
      const friendlyMessage = getUserFriendlyErrorMessage(err);
      const suggestions = getRecoverySuggestions(err);
      setError(friendlyMessage);
      setErrorSuggestions(suggestions);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleViewAnalysis = (analysis: Analysis) => {
    setSelectedAnalysis(analysis);
    setCurrentView("detail");
  };

  const handleBackToHistory = () => {
    setSelectedAnalysis(null);
    setCurrentView("history");
  };

  const handleTranslate = async (content: string): Promise<string> => {
    setTranslating(true);
    setError(null);

    try {
      if (!apiKey) {
        throw new Error("Please set your API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      const translation = await translateTechnicalContent(content, apiKey, model, provider);
      return translation;
    } catch (err: any) {
      const friendlyError = getUserFriendlyErrorMessage(err);
      setError(friendlyError);
      throw err;
    } finally {
      setTranslating(false);
    }
  };

  // Show loading screen during initialization
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
            <h1 className="text-4xl font-bold mb-2">
              Hadron
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Smalltalk Crash Analyzer powered by AI
            </p>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDashboard(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition"
            >
              <Activity className="w-5 h-5" />
              Dashboard
            </button>
            <button
              onClick={() => setShowSettings(true)}
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
            onClick={() => setCurrentView("analyze")}
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
            onClick={() => setCurrentView("translate")}
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
            onClick={() => setCurrentView("history")}
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
              ⚠️ API Key Required - Please set your OpenAI API key in Settings to analyze crash logs
            </p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-red-400 font-semibold mb-2">❌ {error}</p>
            {errorSuggestions.length > 0 && (
              <div className="mt-3 text-sm text-red-300">
                <p className="font-semibold mb-1">Try these solutions:</p>
                <ul className="list-disc list-inside space-y-1">
                  {errorSuggestions.map((suggestion, index) => (
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
                  onNewAnalysis={() => {
                    setAnalysisResult(null);
                    setError(null);
                  }}
                />
              )}
            </>
          )}

          {/* Translate View */}
          {currentView === "translate" && (
            <TranslateView
              onTranslate={handleTranslate}
              isTranslating={translating}
            />
          )}

          {/* History View */}
          {currentView === "history" && (
            <HistoryView onViewAnalysis={handleViewAnalysis} />
          )}

          {/* Detail View */}
          {currentView === "detail" && selectedAnalysis && (
            <AnalysisDetailView
              analysis={selectedAnalysis}
              onBack={handleBackToHistory}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-gray-400 dark:text-gray-500 text-sm">
          <div className="mb-2">
            Phase 1: Desktop Foundation | v1.0.0
            {apiKey && <span className="ml-4 text-green-600 dark:text-green-400">✓ API Key Set</span>}
          </div>
          <div className="text-xs opacity-60">
            Shortcuts: Ctrl+N (New) • Ctrl+H (History) • Ctrl+, (Settings) • Esc (Close)
          </div>
        </footer>
      </div>

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        darkMode={darkMode}
        onThemeChange={setDarkMode}
        onSettingsChange={async () => {
          // Reload API key after settings change
          const provider = getStoredProvider();
          const newApiKey = await getApiKey(provider);
          if (newApiKey) {
            setApiKey(newApiKey);
          }
        }}
      />
      {/* Dashboard Panel */}
      <DashboardPanel
        isOpen={showDashboard}
        onClose={() => setShowDashboard(false)}
        onOpenAnalysis={(analysis) => {
          setSelectedAnalysis(analysis);
          setCurrentView("detail");
          setShowDashboard(false);
        }}
      />
    </div>
  );
}

export default App;
