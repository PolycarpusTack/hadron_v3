export type WidgetAutoAction = "show" | "hide" | null;

export function getWidgetAutoAction(
  hoverEnabled: boolean,
  mainVisible: boolean,
  widgetVisible: boolean,
): WidgetAutoAction {
  const shouldShowWidget = hoverEnabled && !mainVisible;

  if (widgetVisible === shouldShowWidget) {
    return null;
  }

  return shouldShowWidget ? "show" : "hide";
}
