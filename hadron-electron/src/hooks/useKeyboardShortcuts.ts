import { useEffect } from "react";

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
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for modifier keys
      const isCtrl = event.ctrlKey || event.metaKey; // Support both Ctrl and Cmd (Mac)
      const key = event.key.toLowerCase();

      // Ctrl+N - New Analysis
      if (isCtrl && (key === "n" || event.code === "KeyN")) {
        event.preventDefault();
        handlers.onNewAnalysis?.();
      }

      // Ctrl+H - View History
      if (isCtrl && (key === "h" || event.code === "KeyH")) {
        event.preventDefault();
        handlers.onViewHistory?.();
      }

      // Ctrl+, - Open Settings
      if (isCtrl && (event.key === "," || event.code === "Comma")) {
        event.preventDefault();
        handlers.onOpenSettings?.();
      }

      // Escape - Close modals
      if (event.key === "Escape") {
        handlers.onCloseModal?.();
      }

      // Ctrl+F - Focus search
      if (isCtrl && (key === "f" || event.code === "KeyF")) {
        // Only prevent default if we have a search handler
        if (handlers.onFocusSearch) {
          event.preventDefault();
          handlers.onFocusSearch();
        }
      }

      // Ctrl+Y - Toggle console/log viewer
      if (isCtrl && (key === "y" || event.code === "KeyY")) {
        event.preventDefault();
        handlers.onToggleConsole?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handlers]);
}
