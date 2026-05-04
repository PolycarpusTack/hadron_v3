import { describe, expect, it } from "vitest";
import type { Analysis } from "../services/api";
import {
  aggregateByField,
  countLast7Days,
  findSimilarAnalyses,
} from "./dashboard";

function makeAnalysis(overrides: Partial<Analysis>): Analysis {
  return {
    id: overrides.id ?? 1,
    filename: overrides.filename ?? "crash.log",
    file_size_kb: overrides.file_size_kb ?? 10,
    error_type: overrides.error_type ?? "MessageNotUnderstood",
    error_message: overrides.error_message,
    severity: overrides.severity ?? "HIGH",
    component: overrides.component,
    stack_trace: overrides.stack_trace,
    root_cause: overrides.root_cause ?? "Root cause",
    suggested_fixes: overrides.suggested_fixes ?? "[]",
    confidence: overrides.confidence,
    analyzed_at: overrides.analyzed_at ?? new Date().toISOString(),
    ai_model: overrides.ai_model ?? "gpt-4-turbo-preview",
    ai_provider: overrides.ai_provider,
    tokens_used: overrides.tokens_used ?? 0,
    cost: overrides.cost ?? 0,
    was_truncated: overrides.was_truncated ?? false,
    is_favorite: overrides.is_favorite ?? false,
    view_count: overrides.view_count ?? 0,
    analysis_type: overrides.analysis_type ?? "complete",
    analysis_duration_ms: overrides.analysis_duration_ms,
  };
}

describe("countLast7Days", () => {
  it("counts only analyses within the last 7 days", () => {
    const now = new Date();
    const within7 = makeAnalysis({ analyzed_at: now.toISOString(), id: 1 });

    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const outside7 = makeAnalysis({ analyzed_at: eightDaysAgo.toISOString(), id: 2 });

    const result = countLast7Days([within7, outside7]);
    expect(result).toBe(1);
  });

  it("returns 0 for empty list", () => {
    expect(countLast7Days([])).toBe(0);
  });
});

describe("aggregateByField", () => {
  it("groups by error_type and counts occurrences", () => {
    const a1 = makeAnalysis({ id: 1, error_type: "ErrorA" });
    const a2 = makeAnalysis({ id: 2, error_type: "ErrorA" });
    const a3 = makeAnalysis({ id: 3, error_type: "ErrorB" });

    const result = aggregateByField([a1, a2, a3], "error_type");

    const errorA = result.find((item) => item.key === "ErrorA");
    const errorB = result.find((item) => item.key === "ErrorB");

    expect(errorA?.count).toBe(2);
    expect(errorB?.count).toBe(1);
  });

  it("uses latest analyzed_at as lastSeen", () => {
    const older = makeAnalysis({
      id: 1,
      error_type: "ErrorA",
      analyzed_at: "2024-01-01T00:00:00.000Z",
    });
    const newer = makeAnalysis({
      id: 2,
      error_type: "ErrorA",
      analyzed_at: "2024-02-01T00:00:00.000Z",
    });

    const result = aggregateByField([older, newer], "error_type");
    const errorA = result.find((item) => item.key === "ErrorA");

    expect(errorA?.lastSeen).toBe("2024-02-01T00:00:00.000Z");
  });
});

describe("findSimilarAnalyses", () => {
  it("returns analyses with same error_type and component when available", () => {
    const base = makeAnalysis({
      id: 1,
      error_type: "ErrorA",
      component: "CompX",
    });

    const sameBoth = makeAnalysis({
      id: 2,
      error_type: "ErrorA",
      component: "CompX",
    });
    const sameTypeDifferentComp = makeAnalysis({
      id: 3,
      error_type: "ErrorA",
      component: "CompY",
    });
    const differentType = makeAnalysis({
      id: 4,
      error_type: "ErrorB",
      component: "CompX",
    });

    const result = findSimilarAnalyses(base, [
      base,
      sameBoth,
      sameTypeDifferentComp,
      differentType,
    ]);

    expect(result).toContainEqual(sameBoth);
    expect(result).not.toContainEqual(base);
    // Because we have matches on both type and component, we do not fall back to "type only"
    expect(result).not.toContainEqual(sameTypeDifferentComp);
    expect(result).not.toContainEqual(differentType);
  });

  it("falls back to same error_type only when no component matches", () => {
    const base = makeAnalysis({
      id: 1,
      error_type: "ErrorA",
      component: "CompX",
    });

    const sameTypeDifferentComp = makeAnalysis({
      id: 2,
      error_type: "ErrorA",
      component: "CompY",
    });
    const differentType = makeAnalysis({
      id: 3,
      error_type: "ErrorB",
      component: "CompX",
    });

    const result = findSimilarAnalyses(base, [
      base,
      sameTypeDifferentComp,
      differentType,
    ]);

    expect(result).toContainEqual(sameTypeDifferentComp);
    expect(result).not.toContainEqual(differentType);
  });
});

