import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Zap, Search, FileText, Wrench, Copy } from "lucide-react";
import { looksLikeError } from "../../utils/errorDetection";

interface WidgetFABProps {
  onClick: () => void;
  onTemplate: (template: string) => void;
  onDragEnd?: (x: number, y: number) => void;
}

const TEMPLATES = [
  { icon: Search, label: "Explain this error", prefix: "Explain this error: " },
  { icon: FileText, label: "Summarize for Jira", prefix: "Summarize for a Jira ticket: " },
  { icon: Wrench, label: "Suggest a fix", prefix: "Suggest a fix for: " },
  { icon: Copy, label: "Find similar issues", prefix: "Find similar issues to: " },
];

// Menu needs ~230x220 to render; FAB is 60x60.
const MENU_SIZE = { width: 230, height: 250 };
const FAB_SIZE = { width: 60, height: 60 };
const DRAG_THRESHOLD = 5; // px before a click becomes a drag

export default function WidgetFAB({ onClick, onTemplate, onDragEnd }: WidgetFABProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef<{ screenX: number; screenY: number; winX: number; winY: number } | null>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const closeMenu = useCallback(async () => {
    setShowMenu(false);
    try {
      // Resize back to FAB and restore position
      const pos = await invoke<{ x: number; y: number }>("get_widget_position");
      const dx = MENU_SIZE.width - FAB_SIZE.width;
      const dy = MENU_SIZE.height - FAB_SIZE.height;
      await invoke("resize_widget", FAB_SIZE);
      await invoke("move_widget", { x: pos.x + dx, y: pos.y + dy });
    } catch { /* ignore resize errors */ }
  }, []);

  const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      // Expand window upward-left so menu has room to render above the FAB
      const pos = await invoke<{ x: number; y: number }>("get_widget_position");
      const dx = MENU_SIZE.width - FAB_SIZE.width;
      const dy = MENU_SIZE.height - FAB_SIZE.height;
      await invoke("move_widget", { x: pos.x - dx, y: pos.y - dy });
      await invoke("resize_widget", MENU_SIZE);
    } catch { /* ignore */ }
    setShowMenu(true);
  }, []);

  const handleSelect = async (prefix: string) => {
    await closeMenu();
    let clipContent = "";
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const text = await readText();
      if (text && looksLikeError(text)) {
        clipContent = text;
      }
    } catch { /* ignore */ }
    onTemplate(prefix + clipContent);
  };

  // --- Drag-to-move logic ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left-click
    isDragging.current = false;
    invoke<{ x: number; y: number }>("get_widget_position").then((pos) => {
      dragStart.current = { screenX: e.screenX, screenY: e.screenY, winX: pos.x, winY: pos.y };
    });

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = ev.screenX - dragStart.current.screenX;
      const dy = ev.screenY - dragStart.current.screenY;
      if (!isDragging.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      isDragging.current = true;
      invoke("move_widget", {
        x: dragStart.current.winX + dx,
        y: dragStart.current.winY + dy,
      }).catch(() => {});
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (isDragging.current && dragStart.current) {
        const dx = ev.screenX - dragStart.current.screenX;
        const dy = ev.screenY - dragStart.current.screenY;
        const finalX = dragStart.current.winX + dx;
        const finalY = dragStart.current.winY + dy;
        onDragEnd?.(finalX, finalY);
      }
      dragStart.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [onDragEnd]);

  const handleClick = useCallback(() => {
    // Only fire click if we didn't just drag
    if (!isDragging.current) {
      onClick();
    }
  }, [onClick]);

  return (
    <div className="relative w-full h-full flex items-end justify-end">
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        className="w-[56px] h-[56px] rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600
                   flex items-center justify-center shadow-lg shadow-emerald-500/25
                   hover:from-emerald-400 hover:to-emerald-500 transition-all duration-200
                   border border-emerald-400/30 cursor-grab active:cursor-grabbing select-none"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        title="Hadron Quick — Click to expand, right-click for quick actions, drag to move"
      >
        <Zap className="w-6 h-6 text-white pointer-events-none" fill="currentColor" />
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
