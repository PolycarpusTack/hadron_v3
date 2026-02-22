import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Search, FileText, Wrench, Copy } from "lucide-react";
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

// Menu needs ~230x250 to render; FAB is 44x44.
const MENU_SIZE = { width: 230, height: 250 };
const FAB_SIZE = { width: 44, height: 44 };
const DRAG_THRESHOLD = 5; // px before a click becomes a drag

export default function WidgetFAB({ onClick, onTemplate, onDragEnd }: WidgetFABProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        fabRef.current && !fabRef.current.contains(e.target as Node)
      ) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const closeMenu = useCallback(async () => {
    setShowMenu(false);
    try {
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
      // Expand window upward-left so menu renders above the FAB
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

  // --- Drag-to-move using native Tauri startDragging ---
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDragging.current = false;

    const startX = e.screenX;
    const startY = e.screenY;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current && Math.abs(ev.screenX - startX) + Math.abs(ev.screenY - startY) >= DRAG_THRESHOLD) {
        isDragging.current = true;
        cleanup();
        // Hand off to native OS window dragging
        getCurrentWindow().startDragging().then(async () => {
          // startDragging resolves when drag ends — save final position
          try {
            const pos = await invoke<{ x: number; y: number }>("get_widget_position");
            onDragEnd?.(pos.x, pos.y);
          } catch { /* ignore */ }
        }).catch(() => {});
      }
    };

    const onUp = () => {
      cleanup();
      // No drag occurred — treat as click
      if (!isDragging.current) {
        onClick();
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [onClick, onDragEnd]);

  return (
    <div className="relative w-full h-full flex items-end justify-end">
      <button
        ref={fabRef}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        className="elena-fab-badge w-[40px] h-[40px] rounded-full
                   flex items-center justify-center
                   cursor-grab active:cursor-grabbing select-none"
        style={{ WebkitAppRegion: "no-drag", background: "transparent" } as React.CSSProperties}
        title="Hadron Quick — Click to expand, right-click for quick actions, drag to move"
      >
        <img
          src="/elena-button.png"
          alt="Hadron"
          className="w-9 h-9 rounded-full pointer-events-none"
          draggable={false}
        />
        <span className="elena-signal-dot" />
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
