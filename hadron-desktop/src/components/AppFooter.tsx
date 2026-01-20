interface AppFooterProps {
  hasApiKey: boolean;
}

export default function AppFooter({ hasApiKey }: AppFooterProps) {
  return (
    <footer className="mt-12 text-center text-gray-400 dark:text-gray-500 text-sm">
      <div className="mb-2">
        Phase 1: Desktop Foundation | v1.0.0
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
