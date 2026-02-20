import { useState, useRef, useEffect } from "react";
import { Zap, Search, FileText, Wrench, Copy } from "lucide-react";

interface WidgetFABProps {
  onClick: () => void;
  onTemplate: (template: string) => void;
}

const TEMPLATES = [
  { icon: Search, label: "Explain this error", prefix: "Explain this error: " },
  { icon: FileText, label: "Summarize for Jira", prefix: "Summarize for a Jira ticket: " },
  { icon: Wrench, label: "Suggest a fix", prefix: "Suggest a fix for: " },
  { icon: Copy, label: "Find similar issues", prefix: "Find similar issues to: " },
];

export default function WidgetFAB({ onClick, onTemplate }: WidgetFABProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowMenu(true);
  };

  const handleSelect = async (prefix: string) => {
    setShowMenu(false);
    // Try to append clipboard content if it looks like an error
    let clipContent = "";
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const text = await readText();
      if (text && text.length > 10 && text.length < 10000) {
        clipContent = text;
      }
    } catch { /* ignore */ }
    onTemplate(prefix + clipContent);
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className="w-[56px] h-[56px] rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600
                   flex items-center justify-center shadow-lg shadow-emerald-500/25
                   hover:from-emerald-400 hover:to-emerald-500 transition-all duration-200
                   border border-emerald-400/30 cursor-pointer"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        title="Hadron Quick — Click to expand, right-click for quick actions"
      >
        <Zap className="w-6 h-6 text-white" fill="currentColor" />
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full mb-2 right-0 w-[220px] rounded-xl overflow-hidden
                     border border-white/[0.12] shadow-2xl py-1"
          style={{ background: "rgba(6,13,27,0.97)", backdropFilter: "blur(12px)" }}
        >
          <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
            Quick Actions
          </div>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => handleSelect(t.prefix)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300
                         hover:bg-white/[0.08] hover:text-white transition-colors text-left"
            >
              <t.icon className="w-4 h-4 text-emerald-400/70" />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
