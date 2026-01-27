import { Settings, Activity, HelpCircle } from "lucide-react";

interface AppHeaderProps {
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
  onOpenDocs: () => void;
}

export default function AppHeader({ onOpenDashboard, onOpenSettings, onOpenDocs }: AppHeaderProps) {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <img
          src="/hadron-logo.png"
          alt="Hadron Logo"
          className="w-14 h-14 object-contain rounded-lg"
        />
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Hadron Crash Analyzer
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            AI-powered crash log analysis for Smalltalk applications
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenDocs}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
          title="Help & Documentation"
        >
          <HelpCircle className="w-5 h-5" />
          Help
        </button>
        <button
          onClick={onOpenDashboard}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
          title="View Analytics Dashboard"
        >
          <Activity className="w-5 h-5" />
          Dashboard
        </button>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition"
        >
          <Settings className="w-5 h-5" />
          Settings
        </button>
      </div>
    </header>
  );
}
