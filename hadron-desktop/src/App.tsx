import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import FileDropZone from "./components/FileDropZone";
import AnalysisResults from "./components/AnalysisResults";
import SettingsPanel from "./components/SettingsPanel";
import HistoryView from "./components/HistoryView";
import CodeAnalyzerView from "./components/CodeAnalyzerView";
import PerformanceAnalyzerView from "./components/PerformanceAnalyzerView";
import JiraAnalyzerView from "./components/JiraAnalyzerView";
import SentryAnalyzerView from "./components/SentryAnalyzerView";
import ConsoleViewer from "./components/ConsoleViewer";
import DocumentationViewer from "./components/DocumentationViewer";
import Splashscreen from "./components/Splashscreen";
import { ViewErrorBoundary, AppErrorBoundary } from "./components/ErrorBoundary";
import Navigation from "./components/Navigation";
import ErrorDisplay from "./components/ErrorDisplay";
import ApiKeyWarning from "./components/ApiKeyWarning";
import BatchProgressDisplay from "./components/BatchProgressDisplay";
import AppHeader from "./components/AppHeader";
import AppFooter from "./components/AppFooter";
import { analyzeCrashLog, getStoredModel, getStoredProvider, getAnalysisById, type AnalysisMode } from "./services/api";
import { analyzeCode } from "./services/code-analysis";
import { isJiraEnabled } from "./services/jira";
import { isSentryEnabled } from "./services/sentry";
import { checkAndUpdate } from "./services/updater";
import { STORAGE_KEYS, getBooleanSetting } from "./utils/config";
import { getApiKey, migrateFromLocalStorage } from "./services/secure-storage";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppState } from "./hooks/useAppState";
import { retryOperation, getUserFriendlyErrorMessage, getRecoverySuggestions } from "./utils/errorHandling";
import logger from "./services/logger";

// Lazy-loaded components for code splitting
const AnalysisDetailView = lazy(() => import("./components/AnalysisDetailView"));
const WhatsOnDetailView = lazy(() => import("./components/WhatsOnDetailView"));
const QuickAnalysisDetailView = lazy(() => import("./components/QuickAnalysisDetailView"));
const SentryDetailView = lazy(() => import("./components/sentry/SentryDetailView"));
const AskHadronView = lazy(() => import("./components/AskHadronView"));
const ReleaseNotesView = lazy(() => import("./components/ReleaseNotesView"));

// Loading fallback component
function LazyLoadFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      <span className="ml-2 text-gray-400">Loading...</span>
    </div>
  );
}

function App() {
  const { state, actions } = useAppState();
  const [showConsole, setShowConsole] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [jiraEnabled, setJiraEnabled] = useState(false);
  const [sentryEnabled, setSentryEnabled] = useState(false);
  const [showCodeAnalyzer, setShowCodeAnalyzer] = useState(() => getBooleanSetting(STORAGE_KEYS.FEATURE_CODE_ANALYZER, true));
  const [showPerformanceAnalyzer, setShowPerformanceAnalyzer] = useState(() => getBooleanSetting(STORAGE_KEYS.FEATURE_PERFORMANCE_ANALYZER, true));
  const [showAskHadron, setShowAskHadron] = useState(() => getBooleanSetting(STORAGE_KEYS.FEATURE_ASK_HADRON, true));

  // Destructure for cleaner code
  const {
    currentView,
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
      const storedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
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
        const autoCheck = localStorage.getItem(STORAGE_KEYS.AUTO_CHECK_UPDATES) === "true";
        if (autoCheck) {
          checkAndUpdate().catch((e) => console.warn("Auto update check failed", e));
        }
      } catch (e) {
        console.warn("Auto update check failed", e);
      }
    }

    initializeApp();
  }, [actions]);

  useEffect(() => {
    isJiraEnabled().then(setJiraEnabled);
    isSentryEnabled().then(setSentryEnabled);
  }, []);

  // Update theme when it changes
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem(STORAGE_KEYS.THEME, "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem(STORAGE_KEYS.THEME, "light");
    }
  }, [darkMode]);

  // Widget event listeners — handle "Open in Main" from widget window
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      const unlistenOpenInMain = await listen<{ messages?: Array<{ role: string; content: string }> }>(
        "widget:open-in-main",
        (_event) => {
          // TODO: pass _event.payload.messages to AskHadronView for conversation carry-over
          actions.setView("chat");
        }
      );
      unlisteners.push(unlistenOpenInMain);
      if (cancelled) { unlistenOpenInMain(); return; }

      const unlistenOpenAnalysis = await listen<{ analysisId: string }>(
        "widget:open-analysis-in-main",
        async (event) => {
          try {
            const id = Number(event.payload.analysisId);
            if (!id || isNaN(id)) {
              logger.warn("widget:open-analysis-in-main received invalid analysisId", { payload: event.payload });
              return;
            }
            const analysis = await getAnalysisById(id);
            if (analysis) {
              actions.viewAnalysis(analysis);
            }
          } catch (e) {
            logger.error("Failed to open analysis from widget", { error: e });
          }
        }
      );
      unlisteners.push(unlistenOpenAnalysis);
      if (cancelled) { unlistenOpenAnalysis(); return; }
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [actions]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewAnalysis: () => {
      actions.setView("analyze");
      actions.clearAnalysis();
    },
    onViewHistory: () => actions.setView("history"),
    onOpenSettings: () => actions.setView('configure'),
    onCloseModal: () => {
      if (showDocs) {
        setShowDocs(false);
      } else if (showConsole) {
        setShowConsole(false);
      } else if (currentView === "configure") {
        actions.setView("analyze");
      } else if (currentView === "detail") {
        actions.backToHistory();
      }
    },
    onToggleConsole: () => setShowConsole(prev => !prev),
  });

  // Handle single file analysis
  const handleFileSelect = useCallback(async (filePath: string, analysisType: string = "complete", analysisMode: AnalysisMode = "auto") => {
    actions.startAnalysis();

    try {
      if (!apiKey) {
        throw new Error("Please set your OpenAI API key in Settings");
      }

      const model = getStoredModel();
      const provider = getStoredProvider();

      logger.info('Starting crash analysis', { filePath, model, provider, analysisType, analysisMode });

      // For comprehensive/deep scan analysis, don't retry - it's expensive and takes several minutes
      // For quick analysis, allow retries
      const isComprehensive = analysisType === 'comprehensive' || analysisMode === 'deep_scan';
      const result = await retryOperation(
        () => analyzeCrashLog(filePath, apiKey, model, provider, analysisType, analysisMode),
        { maxAttempts: isComprehensive ? 1 : 3, delayMs: 1000, backoff: true }
      );

      logger.info('Analysis backend completed', {
        id: result.id,
        filename: result.filename,
        severity: result.severity,
        analysisMode: result.analysis_mode
      });

      // Fetch the full analysis from database (includes full_data with structured JSON)
      const fullAnalysis = await getAnalysisById(result.id);

      logger.info('Full analysis fetched from database', {
        id: fullAnalysis.id,
        analysisType: fullAnalysis.analysis_type,
        hasFullData: !!fullAnalysis.full_data,
        fullDataLength: fullAnalysis.full_data?.length
      });

      // Navigate directly to detail view with full analysis data
      actions.viewAnalysis(fullAnalysis);

      logger.info('Navigating to detail view', {
        id: result.id,
        analysisType: fullAnalysis.analysis_type
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
  }, [apiKey, actions]);

  // Handle batch file analysis
  const handleBatchSelect = useCallback(async (filePaths: string[], analysisType: string = "complete", analysisMode: AnalysisMode = "auto") => {
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
  }, [apiKey, actions]);

  // Handle code analysis
  const handleCodeAnalysis = useCallback(async (code: string, filename: string, language: string) => {
    actions.startCodeAnalysis();
    try {
      const result = await analyzeCode(code, filename, language);
      actions.codeAnalysisSuccess(result);
      return result;
    } catch (err) {
      const friendlyError = getUserFriendlyErrorMessage(err);
      actions.codeAnalysisError(friendlyError);
      throw err;
    }
  }, [actions]);

  // Handle settings change
  const handleSettingsChange = useCallback(async () => {
    const provider = getStoredProvider();
    const newApiKey = await getApiKey(provider);
    if (newApiKey) {
      actions.setApiKey(newApiKey);
    }
    const jiraStatus = await isJiraEnabled();
    setJiraEnabled(jiraStatus);
    if (!jiraStatus && currentView === "jira") {
      actions.setView("analyze");
    }
    const sentryStatus = await isSentryEnabled();
    setSentryEnabled(sentryStatus);
    if (!sentryStatus && currentView === "sentry") {
      actions.setView("analyze");
    }
    if (!jiraStatus && currentView === "release_notes") {
      actions.setView("analyze");
    }
    // Re-read feature flags
    const codeFlag = getBooleanSetting(STORAGE_KEYS.FEATURE_CODE_ANALYZER, true);
    const perfFlag = getBooleanSetting(STORAGE_KEYS.FEATURE_PERFORMANCE_ANALYZER, true);
    const chatFlag = getBooleanSetting(STORAGE_KEYS.FEATURE_ASK_HADRON, true);
    setShowCodeAnalyzer(codeFlag);
    setShowPerformanceAnalyzer(perfFlag);
    setShowAskHadron(chatFlag);
    // Redirect if active view was disabled
    if (!codeFlag && currentView === "translate") actions.setView("analyze");
    if (!perfFlag && currentView === "performance") actions.setView("analyze");
    if (!chatFlag && currentView === "chat") actions.setView("analyze");
  }, [currentView, actions]);

  // Handle navigation to analysis from chat
  const handleNavigateToAnalysis = useCallback(async (id: number) => {
    try {
      const analysis = await getAnalysisById(id);
      actions.viewAnalysis(analysis);
    } catch (err) {
      logger.error("Failed to navigate to analysis", { id, error: err instanceof Error ? err.message : String(err) });
    }
  }, [actions]);

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
    <div
      className="min-h-screen transition-colors duration-200"
      style={{
        background: 'var(--hd-bg-base)',
        backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16,185,129,0.08), transparent)',
        color: 'var(--hd-text)',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <AppHeader
          providerName={getStoredProvider()}
          jiraConnected={jiraEnabled}
          sentryConnected={sentryEnabled}
        />

        {/* Navigation Tabs */}
        <Navigation
          currentView={currentView}
          onViewChange={actions.setView}
          onOpenAskHadron={() => actions.setView("chat")}
          showJiraAnalyzer={jiraEnabled}
          showSentryAnalyzer={sentryEnabled}
          showReleaseNotes={jiraEnabled}
          showCodeAnalyzer={showCodeAnalyzer}
          showPerformanceAnalyzer={showPerformanceAnalyzer}
          showAskHadron={showAskHadron}
        />

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

          {/* JIRA Analyzer View */}
          {currentView === "jira" && (
            <ViewErrorBoundary name="JIRA Analyzer">
              <div id="jira-panel" role="tabpanel">
                <JiraAnalyzerView onAnalysisComplete={actions.viewAnalysis} />
              </div>
            </ViewErrorBoundary>
          )}

          {/* Sentry Analyzer View */}
          {currentView === "sentry" && (
            <ViewErrorBoundary name="Sentry Analyzer">
              <div id="sentry-panel" role="tabpanel">
                <SentryAnalyzerView onAnalysisComplete={actions.viewAnalysis} />
              </div>
            </ViewErrorBoundary>
          )}

          {/* Release Notes Generator View - lazy loaded */}
          {currentView === "release_notes" && (
            <ViewErrorBoundary name="Release Notes">
              <Suspense fallback={<LazyLoadFallback />}>
                <div id="release_notes-panel" role="tabpanel">
                  <ReleaseNotesView />
                </div>
              </Suspense>
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

          {/* Ask Hadron Chat View - lazy loaded */}
          {currentView === "chat" && (
            <ViewErrorBoundary name="Ask Hadron">
              <Suspense fallback={<LazyLoadFallback />}>
                <div id="chat-panel" role="tabpanel">
                  <AskHadronView
                    selectedAnalysisId={selectedAnalysis?.id ?? null}
                    onNavigateToAnalysis={handleNavigateToAnalysis}
                  />
                </div>
              </Suspense>
            </ViewErrorBoundary>
          )}

          {/* Configure View (Settings as inline tab) */}
          {currentView === "configure" && (
            <ViewErrorBoundary name="Settings">
              <SettingsPanel
                isOpen={true}
                onClose={() => actions.setView("analyze")}
                darkMode={darkMode}
                onThemeChange={actions.setDarkMode}
                onSettingsChange={handleSettingsChange}
                isInline={true}
              />
            </ViewErrorBoundary>
          )}

          {/* Detail View - lazy loaded */}
          {currentView === "detail" && selectedAnalysis && (
            <ViewErrorBoundary name="Analysis Details">
              <Suspense fallback={<LazyLoadFallback />}>
                {/* Route to appropriate detail view based on analysis type */}
                {(selectedAnalysis.analysis_type === "whatson" || selectedAnalysis.analysis_type === "comprehensive") ? (
                  <WhatsOnDetailView
                    analysis={selectedAnalysis}
                    onBack={actions.backToHistory}
                  />
                ) : selectedAnalysis.analysis_type === "quick" ? (
                  <QuickAnalysisDetailView
                    analysis={selectedAnalysis}
                    onBack={actions.backToHistory}
                  />
                ) : selectedAnalysis.analysis_type === "sentry" ? (
                  <SentryDetailView
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

      {/* Console Viewer - toggle with Ctrl+Y */}
      <ConsoleViewer
        isOpen={showConsole}
        onClose={() => setShowConsole(false)}
      />

      {/* Documentation Viewer */}
      <DocumentationViewer
        isOpen={showDocs}
        onClose={() => setShowDocs(false)}
      />
    </div>
  );
}

// Wrap App with error boundary to catch top-level errors
function AppWithErrorBoundary() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

export default AppWithErrorBoundary;
