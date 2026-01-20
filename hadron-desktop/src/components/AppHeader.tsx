import { Settings, Activity } from "lucide-react";

interface AppHeaderProps {
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
}

export default function AppHeader({ onOpenDashboard, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Hadron Crash Analyzer
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          AI-powered crash log analysis for Smalltalk applications
        </p>
      </div>
      <div className="flex items-center gap-3">
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
