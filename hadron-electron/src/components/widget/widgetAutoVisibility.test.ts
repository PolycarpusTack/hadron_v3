import { describe, expect, it } from "vitest";
import { getWidgetAutoAction } from "./widgetAutoVisibility";

describe("getWidgetAutoAction", () => {
  it("shows the widget when hover is enabled and main is hidden", () => {
    expect(getWidgetAutoAction(true, false, false)).toBe("show");
  });

  it("hides the widget when main is visible", () => {
    expect(getWidgetAutoAction(true, true, true)).toBe("hide");
  });

  it("hides the widget when hover is disabled", () => {
    expect(getWidgetAutoAction(false, false, true)).toBe("hide");
  });

  it("does nothing when widget already matches the desired state", () => {
    expect(getWidgetAutoAction(true, false, true)).toBeNull();
    expect(getWidgetAutoAction(false, true, false)).toBeNull();
  });
});
