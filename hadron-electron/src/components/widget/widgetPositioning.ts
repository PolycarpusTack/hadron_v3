export interface WidgetSize {
  width: number;
  height: number;
}

export interface WidgetPoint {
  x: number;
  y: number;
}

export interface WidgetScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampWidgetPosition(
  point: WidgetPoint,
  bounds: WidgetScreenBounds,
  size: WidgetSize,
  margin: number,
): WidgetPoint {
  const maxX = bounds.x + bounds.width - size.width - margin;
  const maxY = bounds.y + bounds.height - size.height - margin;

  return {
    x: Math.max(bounds.x + margin, Math.min(point.x, maxX)),
    y: Math.max(bounds.y + margin, Math.min(point.y, maxY)),
  };
}

export function calcMenuPosition(
  fabPosition: WidgetPoint,
  fabSize: WidgetSize,
  menuSize: WidgetSize,
  bounds: WidgetScreenBounds,
  margin: number,
): WidgetPoint {
  const anchored = {
    x: fabPosition.x - (menuSize.width - fabSize.width),
    y: fabPosition.y - (menuSize.height - fabSize.height),
  };

  return clampWidgetPosition(anchored, bounds, menuSize, margin);
}
