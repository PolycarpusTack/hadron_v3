import { Minimize2, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

interface WidgetPanelProps {
  onCollapse: () => void;
  children: React.ReactNode;
}

export default function WidgetPanel({ onCollapse, children }: WidgetPanelProps) {
  const handleOpenInMain = async () => {
    try {
      // TODO(Task 11): App.tsx will add listener to receive conversation data
      await emit("widget:open-in-main", {});
      await invoke("focus_main_window");
    } catch {
      // Main window may not be available; silently fail
    }
  };

  return (
    <div className="w-[400px] h-[520px] rounded-xl overflow-hidden flex flex-col
                    border border-white/[0.08] shadow-2xl"
         style={{ background: "rgba(6,13,27,0.95)", backdropFilter: "blur(12px)" }}>
      {/* Header — draggable */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]"
           style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <span className="text-emerald-400 text-sm font-semibold">&#9889; Hadron Quick</span>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={handleOpenInMain}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Open in main app"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={onCollapse}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Collapse to button"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content — children slot for chat */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}
