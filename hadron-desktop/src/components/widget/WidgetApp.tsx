import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import WidgetFAB from "./WidgetFAB";
import WidgetPanel from "./WidgetPanel";
import WidgetChat from "./WidgetChat";
import ClipboardWatcher from "./ClipboardWatcher";
import type { ChatMessage } from "../../services/chat";

type WidgetState = "fab" | "expanded";

const FAB_SIZE = { width: 60, height: 60 };
const PANEL_SIZE = { width: 400, height: 520 };
const POSITION_STORAGE_KEY = "hadron-widget-position";
const VISIBILITY_CHECK_INTERVAL = 2000; // ms

export default function WidgetApp() {
  const [widgetState, setWidgetState] = useState<WidgetState>("expanded");
  const [pendingClipboard, setPendingClipboard] = useState<string | null>(null);
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const widgetMessagesRef = useRef<ChatMessage[]>([]);

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

  // Poll main window visibility — hide widget when main is visible
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const mainVisible = await invoke<boolean>("is_main_window_visible");
        if (mainVisible) {
          await invoke("hide_widget");
        } else {
          await invoke("show_widget");
        }
      } catch { /* ignore */ }
    }, VISIBILITY_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, []);

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

  const expand = useCallback(async () => {
    try {
      await invoke("resize_widget", PANEL_SIZE);
    } catch {
      // Resize failed; still expand to avoid stuck state
    }
    setWidgetState("expanded");
  }, []);

  const collapse = useCallback(async () => {
    try {
      await invoke("resize_widget", FAB_SIZE);
    } catch {
      // Resize failed; still collapse to avoid stuck state
    }
    setPendingClipboard(null);
    setPendingInput(null);
    setWidgetState("fab");
  }, []);

  const handleClipboardAnalyze = useCallback(async (content: string) => {
    setPendingClipboard(content);
    try {
      await invoke("resize_widget", PANEL_SIZE);
    } catch {
      // Resize failed; still expand to avoid stuck state
    }
    setWidgetState("expanded");
  }, []);

  const handleTemplate = useCallback(async (template: string) => {
    setPendingClipboard(null);
    setPendingInput(template);
    try {
      await invoke("resize_widget", PANEL_SIZE);
    } catch {
      // Resize failed; still expand to avoid stuck state
    }
    setWidgetState("expanded");
  }, []);

  const handleDragEnd = useCallback((x: number, y: number) => {
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ x, y }));
    } catch { /* ignore */ }
  }, []);

  if (widgetState === "fab") {
    return (
      <div className="relative w-[60px] h-[60px] flex items-center justify-center">
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
