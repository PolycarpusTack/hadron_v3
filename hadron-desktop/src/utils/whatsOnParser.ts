/**
 * Parser utility for WHATS'ON Enhanced Analysis data
 */

import type { WhatsOnEnhancedAnalysis } from "../types";
import logger from '../services/logger';

/**
 * Parse the full_data JSON string into a WhatsOnEnhancedAnalysis object
 * Handles both the JSON blob in full_data and fallback to root_cause parsing
 */
export function parseWhatsOnAnalysis(
  fullData?: string,
  rootCause?: string
): WhatsOnEnhancedAnalysis | null {
  // First try to parse from full_data
  if (fullData) {
    try {
      const parsed = JSON.parse(fullData);
      const validation = validateWhatsOnAnalysis(parsed);
      if (validation.valid) {
        return parsed;
      } else {
        logger.warn('WHATS ON validation failed', { missingFields: validation.missingFields });
        logger.debug('Parsed structure keys', { keys: Object.keys(parsed) });
      }
    } catch (e) {
      logger.warn('Failed to parse full_data as JSON', { error: String(e) });
      logger.debug('full_data preview', { length: fullData?.length });
    }
  } else {
    logger.debug('No full_data for WHATS ON parsing');
  }

  // Fallback: try to parse from root_cause if it's JSON
  if (rootCause) {
    try {
      const parsed = JSON.parse(rootCause);
      const validation = validateWhatsOnAnalysis(parsed);
      if (validation.valid) {
        return parsed;
      }
    } catch {
      // root_cause is not JSON, which is expected for non-whatson analyses
    }
  }

  return null;
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
