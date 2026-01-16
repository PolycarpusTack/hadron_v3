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

      // Ctrl+N - New Analysis
      if (isCtrl && event.key === "n") {
        event.preventDefault();
        handlers.onNewAnalysis?.();
      }

      // Ctrl+H - View History
      if (isCtrl && event.key === "h") {
        event.preventDefault();
        handlers.onViewHistory?.();
      }

      // Ctrl+, - Open Settings
      if (isCtrl && event.key === ",") {
        event.preventDefault();
        handlers.onOpenSettings?.();
      }

      // Escape - Close modals
      if (event.key === "Escape") {
        handlers.onCloseModal?.();
      }

      // Ctrl+F - Focus search
      if (isCtrl && event.key === "f") {
        // Only prevent default if we have a search handler
        if (handlers.onFocusSearch) {
          event.preventDefault();
          handlers.onFocusSearch();
        }
      }

      // Ctrl+Y - Toggle console/log viewer
      if (isCtrl && event.key === "y") {
        event.preventDefault();
        handlers.onToggleConsole?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handlers]);
}
