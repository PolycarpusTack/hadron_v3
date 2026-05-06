/**
 * Parser utility for WHATS'ON Enhanced Analysis data
 */

import type { WhatsOnEnhancedAnalysis } from "../types";
import logger from '../services/logger';

/**
 * Parse the full_data JSON string into a WhatsOnEnhancedAnalysis object.
 * Tries three strategies in order:
 *   1. Parse full_data as a valid WhatsOnEnhancedAnalysis (new prompt format)
 *   2. Parse root_cause as JSON (legacy storage)
 *   3. Synthesize a minimal WhatsOnEnhancedAnalysis from the flat AI response
 *      fields stored in full_data (old flat prompt / intermediate prompt formats)
 */
export function parseWhatsOnAnalysis(
  fullData?: string,
  rootCause?: string
): WhatsOnEnhancedAnalysis | null {
  // 1. Try full_data as validated WhatsOnEnhancedAnalysis
  if (fullData) {
    try {
      const parsed = JSON.parse(fullData);
      const validation = validateWhatsOnAnalysis(parsed);
      if (validation.valid) {
        return normalizeWhatsOnAnalysis(parsed, rootCause);
      }
      logger.debug('WhatsOn validation failed, will synthesize', { missingFields: validation.missingFields });
    } catch (e) {
      logger.warn('Failed to parse full_data as JSON', { error: String(e) });
    }
  }

  // 2. Try root_cause as JSON (legacy)
  if (rootCause) {
    try {
      const parsed = JSON.parse(rootCause);
      if (validateWhatsOnAnalysis(parsed).valid) {
        return normalizeWhatsOnAnalysis(parsed, rootCause);
      }
    } catch {
      // expected for plain-text root_cause
    }
  }

  // 3. Synthesize from flat or intermediate fields so old analyses render properly
  const flat = (() => {
    if (!fullData) return null;
    try { return JSON.parse(fullData) as Record<string, unknown>; } catch { return null; }
  })();
  return synthesizeFromFlat(flat, rootCause);
}

// ---------------------------------------------------------------------------
// Normalization: keep partially compliant model JSON from breaking the screen
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asArray<T>(value: unknown, mapper: (item: unknown, index: number) => T): T[] {
  return Array.isArray(value) ? value.map(mapper) : [];
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

function normalizeWhatsOnAnalysis(value: unknown, rootCauseFallback?: string): WhatsOnEnhancedAnalysis {
  const data = isRecord(value) ? value : {};
  const summary = isRecord(data.summary) ? data.summary : {};
  const rootCause = isRecord(data.rootCause) ? data.rootCause : {};
  const scenario = isRecord(data.userScenario) ? data.userScenario : {};
  const fix = isRecord(data.suggestedFix) ? data.suggestedFix : {};
  const impact = isRecord(data.impactAnalysis) ? data.impactAnalysis : {};
  const stackTrace = isRecord(data.stackTrace) ? data.stackTrace : null;

  const technical = asString(rootCause.technical, rootCauseFallback ?? "No technical root cause provided.");
  const plainEnglish = asString(rootCause.plainEnglish, technical);
  const affectedModule = asString(rootCause.affectedModule, asString(data.component, "Unknown module"));

  const normalizedFixes: WhatsOnEnhancedAnalysis["suggestedFix"]["codeChanges"] = asArray(fix.codeChanges, (item, index) => {
    const row = isRecord(item) ? item : {};
    return {
      file: asString(row.file, affectedModule || "Unknown"),
      description: asString(row.description, asString(fix.summary, "Review the identified failure point.")),
      before: asString(row.before) || undefined,
      after: asString(row.after) || undefined,
      priority: pickEnum(row.priority, ["P0", "P1", "P2"] as const, index === 0 ? "P0" : index === 1 ? "P1" : "P2"),
    };
  });

  const suggestedFixes = parseSuggestedFixes(data.suggested_fixes);
  if (!normalizedFixes.length && suggestedFixes.length) {
    normalizedFixes.push(...suggestedFixes.map((description, index) => ({
      file: affectedModule || "Unknown",
      description,
      priority: (index === 0 ? "P0" : index === 1 ? "P1" : "P2") as "P0" | "P1" | "P2",
    })));
  }

  const scenarioSteps = asArray(scenario.steps, (item, index) => {
    const row = isRecord(item) ? item : {};
    return {
      step: typeof row.step === "number" ? row.step : index + 1,
      action: asString(row.action, "User action not identified"),
      details: asString(row.details) || undefined,
      isCrashPoint: Boolean(row.isCrashPoint),
    };
  });

  const normalizedStackTrace = stackTrace
    ? {
        frames: asArray(stackTrace.frames, (item, index) => {
          const row = isRecord(item) ? item : {};
          return {
            index: typeof row.index === "number" ? row.index : index,
            method: asString(row.method, "Unknown method"),
            type: pickEnum(row.type, ["error", "application", "framework", "library"] as const, "library"),
            isErrorOrigin: Boolean(row.isErrorOrigin),
            context: asString(row.context) || undefined,
          };
        }),
        totalFrames: typeof stackTrace.totalFrames === "number"
          ? stackTrace.totalFrames
          : Array.isArray(stackTrace.frames) ? stackTrace.frames.length : 0,
        errorFrame: asString(stackTrace.errorFrame) || undefined,
      }
    : undefined;

  return {
    ...data,
    summary: {
      title: asString(summary.title, asString(data.error_type, "WHATS'ON crash analysis")),
      severity: pickEnum(summary.severity, ["critical", "high", "medium", "low"] as const, parseSeverity(data.severity)),
      category: pickEnum(summary.category, ["scheduling", "playout", "database", "memory", "integration", "ui", "rights", "timing", "other"] as const, "other"),
      confidence: pickEnum(summary.confidence, ["high", "medium", "low"] as const, parseConfidence(data.confidence)),
      affectedWorkflow: asString(summary.affectedWorkflow) || undefined,
    },
    rootCause: {
      technical,
      plainEnglish,
      affectedMethod: asString(rootCause.affectedMethod, asString(data.component, "Unknown method")),
      affectedModule,
      triggerCondition: asString(rootCause.triggerCondition) || undefined,
    },
    userScenario: {
      description: asString(scenario.description, "User triggered an action that caused the crash"),
      workflow: asString(scenario.workflow) || undefined,
      steps: scenarioSteps.length ? scenarioSteps : [{ step: 1, action: "User triggered an action that caused the crash", isCrashPoint: true }],
      expectedResult: asString(scenario.expectedResult, "Application continues normally"),
      actualResult: asString(scenario.actualResult, asString(data.error_message, "Application crashed")),
      reproductionLikelihood: pickEnum(scenario.reproductionLikelihood, ["always", "often", "sometimes", "rarely", "unknown"] as const, "unknown"),
    },
    suggestedFix: {
      summary: asString(fix.summary, normalizedFixes[0]?.description ?? "Review and fix the identified issue"),
      reasoning: asString(fix.reasoning, technical),
      explanation: asString(fix.explanation) || undefined,
      codeChanges: normalizedFixes,
      complexity: pickEnum(fix.complexity, ["simple", "moderate", "complex"] as const, "moderate"),
      estimatedEffort: pickEnum(fix.estimatedEffort, ["hours", "days", "weeks"] as const, "hours"),
      riskLevel: pickEnum(fix.riskLevel, ["low", "medium", "high"] as const, "medium"),
    },
    systemWarnings: asArray(data.systemWarnings, (item) => {
      const row = isRecord(item) ? item : {};
      return {
        source: pickEnum(row.source, ["memory", "database", "process", "network", "configuration", "other"] as const, "other"),
        severity: pickEnum(row.severity, ["critical", "warning", "info"] as const, "info"),
        title: asString(row.title, "System warning"),
        description: asString(row.description, "No warning details provided."),
        recommendation: asString(row.recommendation) || undefined,
        contributedToCrash: Boolean(row.contributedToCrash),
      };
    }),
    impactAnalysis: {
      dataAtRisk: pickEnum(impact.dataAtRisk, ["none", "low", "moderate", "high", "critical"] as const, "none"),
      dataRiskDescription: asString(impact.dataRiskDescription) || undefined,
      directlyAffected: asArray(impact.directlyAffected, (item) => normalizeAffectedFeature(item, affectedModule)),
      potentiallyAffected: asArray(impact.potentiallyAffected, (item) => normalizeAffectedFeature(item, affectedModule)),
    },
    testScenarios: asArray(data.testScenarios, (item, index) => {
      const row = isRecord(item) ? item : {};
      return {
        id: asString(row.id, `TC${String(index + 1).padStart(3, "0")}`),
        name: asString(row.name, "Regression test"),
        priority: pickEnum(row.priority, ["P0", "P1", "P2"] as const, "P1"),
        type: pickEnum(row.type, ["regression", "smoke", "integration", "unit"] as const, "regression"),
        description: asString(row.description, "Validate the crash no longer occurs."),
        steps: asString(row.steps, "Reproduce the original workflow and verify the expected result."),
        expectedResult: asString(row.expectedResult, "No crash occurs."),
        dataRequirements: asString(row.dataRequirements) || undefined,
      };
    }),
    stackTrace: normalizedStackTrace,
  } as WhatsOnEnhancedAnalysis;
}

function normalizeAffectedFeature(item: unknown, fallbackModule: string): WhatsOnEnhancedAnalysis["impactAnalysis"]["directlyAffected"][number] {
  const row = isRecord(item) ? item : {};
  return {
    feature: asString(row.feature, "Unknown feature"),
    module: asString(row.module, fallbackModule || "Unknown module"),
    description: asString(row.description, "Impact not specified."),
    severity: pickEnum(row.severity, ["critical", "high", "medium", "low"] as const, "medium"),
  };
}

// ---------------------------------------------------------------------------
// Synthesis: build a minimal WhatsOnEnhancedAnalysis from flat AI response
// ---------------------------------------------------------------------------

function parseSeverity(raw: unknown): "critical" | "high" | "medium" | "low" {
  const s = (typeof raw === "string" ? raw : "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function parseConfidence(raw: unknown): "high" | "medium" | "low" {
  const s = (typeof raw === "string" ? raw : "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function parseSuggestedFixes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter(x => typeof x === "string");
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("[")) { try { const arr = JSON.parse(t); if (Array.isArray(arr)) return arr; } catch {} }
    return t.split("\n").map(l => l.trim()).filter(Boolean);
  }
  return [];
}

function synthesizeFromFlat(
  data: Record<string, unknown> | null,
  rootCause?: string
): WhatsOnEnhancedAnalysis | null {
  // Need at minimum something to show
  const rc = (data?.root_cause as string | undefined)
    || (data?.rootCause as Record<string, unknown> | undefined)?.plainEnglish as string | undefined
    || (data?.rootCause as Record<string, unknown> | undefined)?.technical as string | undefined
    || rootCause
    || "";

  if (!rc && !data?.error_type) return null;

  const errorType   = (data?.error_type as string | undefined) || "Unknown Error";
  const component   = (data?.component as string | undefined)
    || (data?.rootCause as Record<string, unknown> | undefined)?.affectedModule as string | undefined
    || "";
  const severity    = parseSeverity(data?.severity ?? (data?.summary && (data.summary as Record<string, unknown>)?.severity));
  const confidence  = parseConfidence(data?.confidence);
  const fixes       = parseSuggestedFixes(data?.suggested_fixes);
  const stackTrace  = data?.stack_trace as string | undefined;

  // Prefer rich rootCause if present (intermediate prompt format)
  const richRc = data?.rootCause as Record<string, unknown> | undefined;
  const technical   = (richRc?.technical as string | undefined) || rc;
  const plainEng    = (richRc?.plainEnglish as string | undefined) || rc;
  const method      = (richRc?.affectedMethod as string | undefined) || "";
  const module_     = (richRc?.affectedModule as string | undefined) || component;
  const trigger     = (richRc?.triggerCondition as string | undefined);

  // User scenario: prefer structured, fall back to minimal
  const rawScenario = data?.userScenario as Record<string, unknown> | undefined;
  const scenarioSteps: WhatsOnEnhancedAnalysis["userScenario"]["steps"] =
    Array.isArray(rawScenario?.steps)
      ? (rawScenario!.steps as Array<Record<string, unknown>>).map((s, i) => ({
          step: typeof s.step === "number" ? s.step : i + 1,
          action: (s.action as string) || "",
          isCrashPoint: !!(s.isFailure ?? s.isCrashPoint),
        }))
      : [{ step: 1, action: "User triggered an action that caused the crash", isCrashPoint: true }];

  // Remediation → codeChanges
  type CC = WhatsOnEnhancedAnalysis["suggestedFix"]["codeChanges"][number];
  const remP0 = (data?.remediation as Record<string, unknown> | undefined)?.p0;
  const codeChanges: CC[] = Array.isArray(remP0) && remP0.length > 0
    ? (remP0 as Array<Record<string, unknown>>).map((item, i) => ({
        file: (item.location as string | undefined) || component || "Unknown",
        description: (item.title as string | undefined) || (item.description as string | undefined) || "",
        before: item.before as string | undefined,
        after: item.after as string | undefined,
        priority: (i === 0 ? "P0" : i === 1 ? "P1" : "P2") as "P0" | "P1" | "P2",
      }))
    : fixes.map((fix, i) => ({
        file: component || "Unknown",
        description: fix,
        priority: (i === 0 ? "P0" : i === 1 ? "P1" : "P2") as "P0" | "P1" | "P2",
      }));

  const titleBase = component ? `${errorType} in ${component}` : errorType;
  const title = titleBase.length > 80 ? titleBase.slice(0, 80) + "…" : titleBase;

  return {
    summary: {
      title,
      severity,
      category: "other",
      confidence,
      affectedWorkflow: trigger ?? undefined,
    },
    rootCause: {
      technical,
      plainEnglish: plainEng,
      affectedMethod: method,
      affectedModule: module_,
      triggerCondition: trigger,
    },
    userScenario: {
      description: rawScenario?.description as string || "User triggered an action that caused the crash",
      workflow: rawScenario?.workflow as string | undefined,
      steps: scenarioSteps,
      expectedResult: (rawScenario?.expectedResult as string | undefined) || "Application continues normally",
      actualResult: (rawScenario?.actualResult as string | undefined) || `${errorType}: application crashed`,
      reproductionLikelihood: "unknown",
    },
    suggestedFix: {
      summary: fixes[0] || "Review and fix the identified issue",
      reasoning: technical,
      codeChanges,
      complexity: "moderate",
      estimatedEffort: "hours",
      riskLevel: "medium",
    },
    systemWarnings: [],
    impactAnalysis: {
      dataAtRisk: "none",
      directlyAffected: component
        ? [{ feature: component, module: module_, description: errorType, severity: severity === "critical" || severity === "high" ? severity : "medium" }]
        : [],
      potentiallyAffected: [],
    },
    testScenarios: [],
    stackTrace: stackTrace ? { frames: [], totalFrames: 0 } : undefined,
  };
}

/**
 * Validation result with details about what's missing
 */
interface ValidationResult {
  valid: boolean;
  missingFields: string[];
}

/**
 * Validate a WHATS'ON analysis structure and report what's missing
 */
function validateWhatsOnAnalysis(obj: unknown): ValidationResult {
  if (!obj || typeof obj !== "object") {
    return { valid: false, missingFields: ["(not an object)"] };
  }

  const analysis = obj as Partial<WhatsOnEnhancedAnalysis>;
  const missingFields: string[] = [];

  // Check required top-level properties
  if (analysis.summary === undefined) missingFields.push("summary");
  if (analysis.rootCause === undefined) missingFields.push("rootCause");
  if (analysis.userScenario === undefined) missingFields.push("userScenario");
  if (analysis.suggestedFix === undefined) missingFields.push("suggestedFix");

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}


/**
 * Get severity color classes for styling
 */
export function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "high":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "medium":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "low":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

/**
 * Get severity badge color for inline badges
 */
export function getSeverityBadgeColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500 text-white";
    case "high":
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-black";
    case "low":
      return "bg-blue-500 text-white";
    default:
      return "bg-gray-500 text-white";
  }
}

/**
 * Get warning severity icon color
 */
export function getWarningSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "text-red-400";
    case "warning":
      return "text-yellow-400";
    case "info":
      return "text-blue-400";
    default:
      return "text-gray-400";
  }
}

/**
 * Get complexity badge styling
 */
export function getComplexityColor(complexity: string): string {
  switch (complexity.toLowerCase()) {
    case "simple":
      return "bg-green-500/20 text-green-400";
    case "moderate":
      return "bg-yellow-500/20 text-yellow-400";
    case "complex":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

/**
 * Get priority badge styling
 */
export function getPriorityColor(priority: string): string {
  switch (priority.toUpperCase()) {
    case "P0":
      return "bg-red-500 text-white";
    case "P1":
      return "bg-orange-500 text-white";
    case "P2":
      return "bg-blue-500 text-white";
    default:
      return "bg-gray-500 text-white";
  }
}

/**
 * Get data risk color styling
 */
export function getDataRiskColor(risk: string): string {
  switch (risk.toLowerCase()) {
    case "critical":
      return "text-red-400";
    case "high":
      return "text-orange-400";
    case "moderate":
      return "text-yellow-400";
    case "low":
      return "text-blue-400";
    case "none":
      return "text-green-400";
    default:
      return "text-gray-400";
  }
}

/**
 * Get frame type color for stack trace
 */
export function getFrameTypeColor(type: string): string {
  switch (type.toLowerCase()) {
    case "error":
      return "bg-red-500/20 border-l-red-500";
    case "application":
      return "bg-blue-500/10 border-l-blue-500";
    case "framework":
      return "bg-purple-500/10 border-l-purple-500";
    case "library":
      return "bg-gray-500/10 border-l-gray-500";
    default:
      return "bg-gray-500/10 border-l-gray-500";
  }
}

/**
 * Format memory value for display
 */
export function formatMemoryValue(value?: string, total?: string): string {
  if (!value) return "N/A";
  if (total) return `${value} / ${total}`;
  return value;
}

/**
 * Calculate percentage safely
 */
export function calculatePercentage(used?: string, total?: string): number {
  if (!used || !total) return 0;

  const usedNum = parseFloat(used.replace(/[^0-9.]/g, ""));
  const totalNum = parseFloat(total.replace(/[^0-9.]/g, ""));

  if (isNaN(usedNum) || isNaN(totalNum) || totalNum === 0) return 0;

  return Math.round((usedNum / totalNum) * 100);
}
