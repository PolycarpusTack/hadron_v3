import type { Analysis } from "../services/api";

export interface AggregatedItem {
  key: string;
  count: number;
  lastSeen: string;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

export function countLast7Days(analyses: Analysis[]): number {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return analyses.filter((analysis) => {
    const time = new Date(analysis.analyzed_at).getTime();
    if (Number.isNaN(time)) return false;
    return now - time <= sevenDaysMs;
  }).length;
}

export function aggregateByField(
  analyses: Analysis[],
  field: "error_type" | "component"
): AggregatedItem[] {
  const map = new Map<string, { count: number; lastSeen: string }>();

  for (const analysis of analyses) {
    const key = analysis[field];
    if (!key) continue;

    const current = map.get(key);
    if (!current) {
      map.set(key, { count: 1, lastSeen: analysis.analyzed_at });
    } else {
      current.count += 1;
      if (analysis.analyzed_at > current.lastSeen) {
        current.lastSeen = analysis.analyzed_at;
      }
    }
  }

  return Array.from(map.entries())
    .map(([key, value]) => ({ key, count: value.count, lastSeen: value.lastSeen }))
    .sort((a, b) => b.count - a.count);
}

export function findSimilarAnalyses(
  base: Analysis | null,
  analyses: Analysis[]
): Analysis[] {
  if (!base) return [];

  const sameTypeAndComponent = analyses.filter((analysis) => {
    if (analysis.id === base.id) return false;
    const sameType = analysis.error_type === base.error_type;
    const sameComponent =
      analysis.component && base.component && analysis.component === base.component;
    return sameType && (!!base.component ? sameComponent : true);
  });

  if (sameTypeAndComponent.length > 0) {
    return sameTypeAndComponent.slice(0, 10);
  }

  const sameTypeOnly = analyses.filter(
    (analysis) => analysis.id !== base.id && analysis.error_type === base.error_type
  );

  return sameTypeOnly.slice(0, 10);
}

