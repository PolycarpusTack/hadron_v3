import { describe, expect, it } from "vitest";
import { calcMenuPosition } from "./widgetPositioning";

describe("calcMenuPosition", () => {
  const fabSize = { width: 44, height: 44 };
  const menuSize = { width: 230, height: 250 };
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };

  it("anchors the menu up-left when there is room", () => {
    expect(
      calcMenuPosition({ x: 1000, y: 700 }, fabSize, menuSize, bounds, 8),
    ).toEqual({
      x: 814,
      y: 494,
    });
  });

  it("clamps the menu on the top-left edges", () => {
    expect(
      calcMenuPosition({ x: 20, y: 20 }, fabSize, menuSize, bounds, 8),
    ).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("clamps the menu on the bottom-right edges", () => {
    expect(
      calcMenuPosition({ x: 1910, y: 1070 }, fabSize, menuSize, bounds, 8),
    ).toEqual({
      x: 1682,
      y: 822,
    });
  });
});
