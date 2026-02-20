import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import WidgetFAB from "./WidgetFAB";
import WidgetPanel from "./WidgetPanel";
import WidgetChat from "./WidgetChat";

type WidgetState = "fab" | "expanded";

const FAB_SIZE = { width: 60, height: 60 };
const PANEL_SIZE = { width: 400, height: 520 };

export default function WidgetApp() {
  const [widgetState, setWidgetState] = useState<WidgetState>("expanded");

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
    setWidgetState("fab");
  }, []);

  if (widgetState === "fab") {
    return (
      <div className="w-[60px] h-[60px] flex items-center justify-center">
        <WidgetFAB onClick={expand} />
      </div>
    );
  }

  return (
    <WidgetPanel onCollapse={collapse}>
      <WidgetChat />
    </WidgetPanel>
  );
}
