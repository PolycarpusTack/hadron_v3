import { useEffect, useRef } from "react";

interface ShortcutHandlers {
  onNewAnalysis?: () => void;
  onViewHistory?: () => void;
  onOpenSettings?: () => void;
  onCloseModal?: () => void;
  onFocusSearch?: () => void;
  onToggleConsole?: () => void;
}

/**
 * Custom hook for global keyboard shortcuts
 *
 * Shortcuts:
 * - Ctrl+N: New analysis
 * - Ctrl+H: View history
 * - Ctrl+,: Open settings
 * - Ctrl+Y: Toggle console/log viewer
 * - Escape: Close modals
 * - Ctrl+F: Focus search (in history view)
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  // Keep a ref so the listener never needs to be re-registered when handlers change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const h = handlersRef.current;
      const isCtrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (isCtrl && (key === "n" || event.code === "KeyN")) {
        event.preventDefault();
        h.onNewAnalysis?.();
      }
      if (isCtrl && (key === "h" || event.code === "KeyH")) {
        event.preventDefault();
        h.onViewHistory?.();
      }
      if (isCtrl && (event.key === "," || event.code === "Comma")) {
        event.preventDefault();
        h.onOpenSettings?.();
      }
      if (event.key === "Escape") {
        h.onCloseModal?.();
      }
      if (isCtrl && (key === "f" || event.code === "KeyF")) {
        if (h.onFocusSearch) {
          event.preventDefault();
          h.onFocusSearch();
        }
      }
      if (isCtrl && (key === "y" || event.code === "KeyY")) {
        event.preventDefault();
        h.onToggleConsole?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []); // stable — listener registered once for the component lifetime
}
