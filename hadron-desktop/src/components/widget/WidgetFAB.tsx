import { Zap } from "lucide-react";

interface WidgetFABProps {
  onClick: () => void;
}

export default function WidgetFAB({ onClick }: WidgetFABProps) {
  return (
    <button
      onClick={onClick}
      className="w-[56px] h-[56px] rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600
                 flex items-center justify-center shadow-lg shadow-emerald-500/25
                 hover:from-emerald-400 hover:to-emerald-500 transition-all duration-200
                 border border-emerald-400/30 cursor-pointer"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title="Hadron Quick — Click to expand"
    >
      <Zap className="w-6 h-6 text-white" fill="currentColor" />
    </button>
  );
}
