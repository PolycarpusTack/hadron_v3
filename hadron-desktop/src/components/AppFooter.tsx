import { APP_VERSION } from "../constants/version";

interface AppFooterProps {
  hasApiKey: boolean;
}

export default function AppFooter({ hasApiKey }: AppFooterProps) {
  return (
    <footer className="mt-12 text-center text-gray-400 dark:text-gray-500 text-sm">
      <div className="mb-2">
        Hadron {APP_VERSION} - your friendly neighbourhood Analyzer
        {hasApiKey && (
          <span className="ml-4 text-green-600 dark:text-green-400">API Key Set</span>
        )}
      </div>
      <div className="text-xs opacity-60">
        Shortcuts: Ctrl+N (New) | Ctrl+H (History) | Ctrl+, (Settings) | Ctrl+Y (Console) | Esc (Close)
      </div>
    </footer>
  );
}
