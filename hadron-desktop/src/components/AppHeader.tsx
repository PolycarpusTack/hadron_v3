import { Settings, Activity, HelpCircle } from "lucide-react";
import Button from "./ui/Button";

interface AppHeaderProps {
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
  onOpenDocs: () => void;
}

export default function AppHeader({ onOpenDashboard, onOpenSettings, onOpenDocs }: AppHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <img
          src="/hadron-logo.png"
          alt="Hadron Logo"
          className="w-14 h-14 object-contain rounded-lg"
        />
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Hadron
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Your Friendly AI-powered Support Assistant
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="accent"
          onClick={onOpenDocs}
          title="Help & Documentation"
          icon={<HelpCircle />}
        >
          Help
        </Button>
        <Button
          variant="primary"
          onClick={onOpenDashboard}
          title="View Analytics Dashboard"
          icon={<Activity />}
        >
          Dashboard
        </Button>
        <Button
          variant="secondary"
          onClick={onOpenSettings}
          icon={<Settings />}
        >
          Settings
        </Button>
      </div>
    </header>
  );
}
