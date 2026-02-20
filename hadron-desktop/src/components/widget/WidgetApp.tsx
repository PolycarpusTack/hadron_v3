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
    await invoke("resize_widget", PANEL_SIZE);
    setWidgetState("expanded");
  }, []);

  const collapse = useCallback(async () => {
    await invoke("resize_widget", FAB_SIZE);
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
