import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
  useMsal,
} from "@azure/msal-react";
import { useCallback, useEffect, useState } from "react";
import { api, UserProfile } from "./services/api";
import { login, logout } from "./auth/msal";
import { AnalyzeView } from "./components/analysis/AnalyzeView";
import { HistoryView } from "./components/history/HistoryView";
import { ChatView } from "./components/chat/ChatView";
import { SettingsView } from "./components/settings/SettingsView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider, useToast } from "./components/Toast";
import { OpenSearchPanel } from "./components/search/OpenSearchPanel";
import { AdvancedSearchPanel } from "./components/search/AdvancedSearchPanel";
import { TeamFeedView } from "./components/team/TeamFeedView";
import { AdminPanel } from "./components/admin/AdminPanel";
import { ReleaseNotesView } from "./components/release-notes/ReleaseNotesView";
import { SignaturesView } from "./components/signatures/SignaturesView";
import { AnalyticsDashboard } from "./components/analytics/AnalyticsDashboard";
import { SentryAnalyzerView } from "./components/sentry/SentryAnalyzerView";
import { CodeAnalyzerView } from "./components/code-analyzer/CodeAnalyzerView";
import { JiraAnalyzerView } from "./components/jira/JiraAnalyzerView";
import { JiraProjectFeed } from "./components/jira/JiraProjectFeed";

type View =
  | "analyze"
  | "history"
  | "chat"
  | "search"
  | "signatures"
  | "analytics"
  | "team"
  | "releases"
  | "sentry"
  | "code-analyzer"
  | "jira-analyzer"
  | "jira-feed"
  | "settings"
  | "admin";

const devMode = import.meta.env.VITE_AUTH_MODE === "dev";

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="min-h-screen bg-slate-900">
          {devMode ? (
            <AuthenticatedApp />
          ) : (
            <>
              <AuthenticatedTemplate>
                <AuthenticatedApp />
              </AuthenticatedTemplate>
              <UnauthenticatedTemplate>
                <LoginPage />
              </UnauthenticatedTemplate>
            </>
          )}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}

function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="mb-2 text-4xl font-bold text-white">Hadron Web</h1>
        <p className="mb-8 text-slate-400">
          AI-Powered Support Analysis Platform
        </p>
        <button
          onClick={login}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
        >
          Sign in with Azure AD
        </button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  // useMsal() requires MsalProvider — skip in dev mode
  const msalResult = devMode ? { accounts: [] as never[] } : useMsal();
  const { accounts } = msalResult;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeView, setActiveView] = useState<View>("analyze");

  // Settings state — kept in browser memory (API key never goes to server)
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem("hadron_api_key") || "",
  );
  const [model, setModel] = useState(
    () => sessionStorage.getItem("hadron_model") || "gpt-4o",
  );
  const [provider, setProvider] = useState(
    () => sessionStorage.getItem("hadron_provider") || "openai",
  );

  const toast = useToast();

  useEffect(() => {
    api
      .getMe()
      .then(setProfile)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load profile"),
      );
  }, []);

  const handleSettingsChange = useCallback(
    (settings: { apiKey: string; model: string; provider: string }) => {
      setApiKey(settings.apiKey);
      setModel(settings.model);
      setProvider(settings.provider);
      // Persist to session storage (cleared on tab close)
      sessionStorage.setItem("hadron_api_key", settings.apiKey);
      sessionStorage.setItem("hadron_model", settings.model);
      sessionStorage.setItem("hadron_provider", settings.provider);
    },
    [],
  );

  const account = accounts[0];

  const navItems: {
    key: View;
    label: string;
    requireAdmin?: boolean;
    requireLead?: boolean;
  }[] = [
    { key: "analyze", label: "Analyze" },
    { key: "code-analyzer", label: "Code Analyzer" },
    { key: "jira-analyzer", label: "JIRA Analyzer" },
    { key: "jira-feed", label: "JIRA Feed" },
    { key: "history", label: "History" },
    { key: "chat", label: "Ask Hadron" },
    { key: "search", label: "Search" },
    { key: "signatures", label: "Signatures" },
    { key: "analytics", label: "Analytics" },
    { key: "team", label: "Team", requireLead: true },
    { key: "releases", label: "Releases" },
    { key: "sentry", label: "Sentry" },
    { key: "settings", label: "Settings" },
    { key: "admin", label: "Admin", requireAdmin: true },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-white">Hadron</h1>
          <nav className="flex gap-1">
            {navItems
              .filter(
                (n) =>
                  (!n.requireAdmin || profile?.role === "admin") &&
                  (!n.requireLead ||
                    profile?.role === "lead" ||
                    profile?.role === "admin"),
              )
              .map((n) => (
                <button
                  key={n.key}
                  onClick={() => setActiveView(n.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeView === n.key
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {n.label}
                </button>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {!apiKey && (
            <span className="text-xs text-amber-400">
              No API key configured
            </span>
          )}
          <div className="text-right">
            <div className="text-sm text-white">
              {profile?.displayName || account?.name}
            </div>
            <div className="text-xs text-slate-400">
              {profile?.role || "..."}
            </div>
          </div>
          <button
            onClick={logout}
            className="rounded-md px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-6">
        {activeView === "analyze" && (
          <AnalyzeView apiKey={apiKey} model={model} provider={provider} />
        )}
        {activeView === "code-analyzer" && <CodeAnalyzerView />}
        {activeView === "jira-analyzer" && <JiraAnalyzerView />}
        {activeView === "jira-feed" && <JiraProjectFeed />}
        {activeView === "history" && <HistoryView apiKey={apiKey} />}
        {activeView === "chat" && (
          <ChatView apiKey={apiKey} model={model} provider={provider} />
        )}
        {activeView === "search" && (
          <div className="space-y-6">
            <AdvancedSearchPanel />
            <details className="rounded-lg border border-slate-700 bg-slate-800 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-300">
                OpenSearch Query
              </summary>
              <div className="mt-4">
                <OpenSearchPanel />
              </div>
            </details>
          </div>
        )}
        {activeView === "signatures" && <SignaturesView />}
        {activeView === "analytics" && <AnalyticsDashboard />}
        {activeView === "team" && <TeamFeedView />}
        {activeView === "releases" && <ReleaseNotesView />}
        {activeView === "sentry" && <SentryAnalyzerView />}
        {activeView === "settings" && (
          <SettingsView
            apiKey={apiKey}
            model={model}
            provider={provider}
            onSettingsChange={handleSettingsChange}
          />
        )}
        {activeView === "admin" && <AdminPanel />}
      </main>
    </div>
  );
}

export default App;
