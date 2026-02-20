import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import WidgetFAB from "./WidgetFAB";
import WidgetPanel from "./WidgetPanel";
import WidgetChat from "./WidgetChat";
import ClipboardWatcher from "./ClipboardWatcher";
import type { ChatMessage } from "../../services/chat";

type WidgetState = "fab" | "expanded";

const FAB_SIZE = { width: 60, height: 60 };
const PANEL_SIZE = { width: 400, height: 520 };

export default function WidgetApp() {
  const [widgetState, setWidgetState] = useState<WidgetState>("expanded");
  const [pendingClipboard, setPendingClipboard] = useState<string | null>(null);
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const widgetMessagesRef = useRef<ChatMessage[]>([]);

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    widgetMessagesRef.current = messages;
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

  if (widgetState === "fab") {
    return (
      <div className="relative w-[60px] h-[60px] flex items-center justify-center">
        <WidgetFAB onClick={expand} onTemplate={handleTemplate} />
        <ClipboardWatcher onAnalyze={handleClipboardAnalyze} enabled />
      </div>
    );
  }

  return (
    <WidgetPanel onCollapse={collapse} messages={widgetMessagesRef.current}>
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
