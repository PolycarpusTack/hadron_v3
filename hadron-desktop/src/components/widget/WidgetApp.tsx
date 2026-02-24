import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor } from "@tauri-apps/api/window";
import WidgetFAB from "./WidgetFAB";
import WidgetPanel from "./WidgetPanel";
import WidgetChat from "./WidgetChat";
import ClipboardWatcher from "./ClipboardWatcher";
import { withWidgetLock } from "./widgetLock";
import type { ChatMessage } from "../../services/chat";

type WidgetState = "fab" | "expanded";

const FAB_SIZE = { width: 44, height: 44 };
const PANEL_SIZE = { width: 400, height: 520 };
const POSITION_STORAGE_KEY = "hadron-widget-position";
const SCREEN_MARGIN = 8; // px padding from screen edges

/**
 * Calculate where to position the widget window when expanding from FAB to panel.
 * Picks the direction (up/down, left/right) that keeps the panel fully on screen.
 */
async function calcExpandPosition(): Promise<{ x: number; y: number } | null> {
  try {
    const [pos, monitor] = await Promise.all([
      invoke<{ x: number; y: number }>("get_widget_position"),
      currentMonitor(),
    ]);
    if (!monitor) return null;

    const scale = monitor.scaleFactor;
    const screenX = monitor.position.x / scale;
    const screenY = monitor.position.y / scale;
    const screenW = monitor.size.width / scale;
    const screenH = monitor.size.height / scale;

    // FAB center point
    const fabCenterX = pos.x + FAB_SIZE.width / 2;
    const fabCenterY = pos.y + FAB_SIZE.height / 2;

    // Determine horizontal: if FAB is in the right half, expand leftward
    let x: number;
    if (fabCenterX - screenX > screenW / 2) {
      // Anchor panel's right edge to FAB's right edge
      x = pos.x + FAB_SIZE.width - PANEL_SIZE.width;
    } else {
      // Anchor panel's left edge to FAB's left edge (default)
      x = pos.x;
    }

    // Determine vertical: if FAB is in the bottom half, expand upward
    let y: number;
    if (fabCenterY - screenY > screenH / 2) {
      // Anchor panel's bottom edge to FAB's bottom edge
      y = pos.y + FAB_SIZE.height - PANEL_SIZE.height;
    } else {
      // Anchor panel's top edge to FAB's top edge (default)
      y = pos.y;
    }

    // Clamp to screen bounds
    x = Math.max(screenX + SCREEN_MARGIN, Math.min(x, screenX + screenW - PANEL_SIZE.width - SCREEN_MARGIN));
    y = Math.max(screenY + SCREEN_MARGIN, Math.min(y, screenY + screenH - PANEL_SIZE.height - SCREEN_MARGIN));

    return { x, y };
  } catch {
    return null;
  }
}

export default function WidgetApp() {
  const [widgetState, setWidgetState] = useState<WidgetState>("fab");
  const [pendingClipboard, setPendingClipboard] = useState<string | null>(null);
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const widgetMessagesRef = useRef<ChatMessage[]>([]);
  const fabPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Restore saved position on mount
  useEffect(() => {
    const restorePosition = async () => {
      try {
        const saved = localStorage.getItem(POSITION_STORAGE_KEY);
        if (saved) {
          const { x, y } = JSON.parse(saved);
          await invoke("move_widget", { x, y });
        }
      } catch { /* ignore */ }
    };
    restorePosition();
  }, []);

  // Track whether hover button feature is enabled
  const hoverEnabledRef = useRef(true);

  // Listen for setting changes from the main window
  useEffect(() => {
    const unlisten = listen<{ enabled: boolean }>("settings:hover-button-changed", (event) => {
      hoverEnabledRef.current = event.payload.enabled;
      if (!event.payload.enabled) {
        invoke("hide_widget").catch(() => {});
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Poll main window visibility — hide widget when main is visible, show when hidden
  // NOTE: Disabled for crash investigation — rapid show/hide cycling may be causing
  // ILLEGAL_INSTRUCTION crashes via tao/wry event loop state machine violations.
  // Re-enable once root cause is confirmed.
  //
  // useEffect(() => {
  //   const interval = setInterval(async () => {
  //     if (!hoverEnabledRef.current) return;
  //     try {
  //       const mainVisible = await invoke<boolean>("is_main_window_visible");
  //       if (mainVisible) {
  //         await invoke("hide_widget");
  //       } else {
  //         await invoke("show_widget");
  //       }
  //     } catch { /* ignore */ }
  //   }, VISIBILITY_CHECK_INTERVAL);
  //   return () => clearInterval(interval);
  // }, []);

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    widgetMessagesRef.current = messages;
  }, []);

  const handleOpenInMain = useCallback(async () => {
    try {
      await emit("widget:open-in-main", { messages: widgetMessagesRef.current });
      await invoke("focus_main_window");
    } catch {
      // Main window may not be available; silently fail
    }
  }, []);

  // Shared helper: reposition + resize for expanding (serialized via lock)
  const expandToPanel = useCallback(() => withWidgetLock(async () => {
    try {
      // Save FAB position so we can restore on collapse
      fabPositionRef.current = await invoke<{ x: number; y: number }>("get_widget_position");
    } catch { /* ignore */ }
    const target = await calcExpandPosition();
    try {
      if (target) await invoke("move_widget", target);
      await invoke("resize_widget", PANEL_SIZE);
    } catch {
      // Resize/move failed; still expand to avoid stuck state
    }
  }), []);

  const expand = useCallback(async () => {
    await expandToPanel();
    setWidgetState("expanded");
  }, [expandToPanel]);

  const collapse = useCallback(() => withWidgetLock(async () => {
    try {
      await invoke("resize_widget", FAB_SIZE);
      // Restore FAB to its original position before expansion
      if (fabPositionRef.current) {
        await invoke("move_widget", fabPositionRef.current);
        fabPositionRef.current = null;
      }
    } catch {
      // Resize failed; still collapse to avoid stuck state
    }
    setPendingClipboard(null);
    setPendingInput(null);
    setWidgetState("fab");
  }), []);

  const handleClipboardAnalyze = useCallback(async (content: string) => {
    setPendingClipboard(content);
    await expandToPanel();
    setWidgetState("expanded");
  }, [expandToPanel]);

  const handleTemplate = useCallback(async (template: string) => {
    setPendingClipboard(null);
    setPendingInput(template);
    await expandToPanel();
    setWidgetState("expanded");
  }, [expandToPanel]);

  const handleDragEnd = useCallback((x: number, y: number) => {
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ x, y }));
    } catch { /* ignore */ }
  }, []);

  if (widgetState === "fab") {
    return (
      <div className="relative w-screen h-screen flex items-end justify-end">
        <WidgetFAB onClick={expand} onTemplate={handleTemplate} onDragEnd={handleDragEnd} />
        <ClipboardWatcher onAnalyze={handleClipboardAnalyze} enabled />
      </div>
    );
  }

  return (
    <WidgetPanel onCollapse={collapse} onOpenInMain={handleOpenInMain}>
      <WidgetChat
        initialMessage={pendingClipboard}
        onInitialMessageConsumed={() => setPendingClipboard(null)}
        initialInput={pendingInput}
        onInitialInputConsumed={() => setPendingInput(null)}
        onMessagesChange={handleMessagesChange}
      />
    </WidgetPanel>
  );
}
