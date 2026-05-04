import { useCallback } from "react";
import { FileDown } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

interface WidgetDropZoneProps {
  onFileSelected: (filePath: string) => void;
  disabled: boolean;
}

export default function WidgetDropZone({ onFileSelected, disabled }: WidgetDropZoneProps) {
  const handleClick = useCallback(async () => {
    if (disabled) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: "Crash Logs",
          extensions: ["txt", "log", "dmp", "wcr"],
        }],
      });
      if (selected) {
        onFileSelected(typeof selected === "string" ? selected : selected[0]);
      }
    } catch {
      // Dialog cancelled or failed — silently ignore
    }
  }, [disabled, onFileSelected]);

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`mx-4 mb-3 w-[calc(100%-2rem)] border border-dashed rounded-lg px-3 py-2 text-center text-xs
        transition-colors cursor-pointer
        ${disabled
          ? "border-white/[0.06] text-gray-700 cursor-not-allowed"
          : "border-white/[0.1] text-gray-500 hover:border-emerald-500/30 hover:text-emerald-400/70 hover:bg-emerald-500/5"
        }`}
    >
      <FileDown className="w-3.5 h-3.5 inline mr-1.5" />
      {disabled ? "Analyzing..." : "Quick scan a log file"}
    </button>
  );
}
