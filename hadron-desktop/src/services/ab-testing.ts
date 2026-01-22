/**
 * A/B Testing Service for RAG Feature
 * Phase 2.3 - Tracks and compares RAG vs baseline analysis performance
 */

// ============================================================================
// Types
// ============================================================================

export interface ABTestConfig {
  /** Whether RAG is enabled for new analyses */
  ragEnabled: boolean;
  /** Percentage of analyses to run with RAG (0-100) */
  ragSampleRate: number;
  /** Whether to force RAG for all analyses (overrides sample rate) */
  forceRag: boolean;
  /** Start date of current A/B test period */
  testStartDate: string;
}

export interface ABTestResult {
  analysisId: number;
  timestamp: string;
  useRag: boolean;
  /** Time taken for analysis in ms */
  analysisDuration: number;
  /** User feedback rating (1-5) */
  rating?: number;
  /** User accepted/rejected the analysis */
  feedbackType?: "accept" | "reject";
  /** Was promoted to gold */
  promotedToGold?: boolean;
  /** Error signature for grouping */
  errorSignature?: string;
  /** Component for filtering */
  component?: string;
}

export interface ABTestSummary {
  /** Total analyses in test period */
  totalAnalyses: number;
  /** Analyses with RAG enabled */
  ragAnalyses: number;
  /** Analyses without RAG (baseline) */
  baselineAnalyses: number;
  /** Average rating for RAG analyses */
  ragAvgRating: number;
  /** Average rating for baseline analyses */
  baselineAvgRating: number;
  /** RAG acceptance rate (accepted / total with feedback) */
  ragAcceptanceRate: number;
  /** Baseline acceptance rate */
  baselineAcceptanceRate: number;
  /** RAG gold promotion rate */
  ragGoldRate: number;
  /** Baseline gold promotion rate */
  baselineGoldRate: number;
  /** Average analysis duration with RAG (ms) */
  ragAvgDuration: number;
  /** Average analysis duration without RAG (ms) */
  baselineAvgDuration: number;
}

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  CONFIG: "hadron_ab_test_config",
  RESULTS: "hadron_ab_test_results",
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ABTestConfig = {
  ragEnabled: true,
  ragSampleRate: 50, // 50% get RAG by default for A/B test
  forceRag: false,
  testStartDate: new Date().toISOString(),
};

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get the current A/B test configuration
 */
export function getABTestConfig(): ABTestConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load A/B test config:", e);
  }
  return DEFAULT_CONFIG;
}

/**
 * Save A/B test configuration
 */
export function setABTestConfig(config: Partial<ABTestConfig>): void {
  try {
    const current = getABTestConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save A/B test config:", e);
  }
}

/**
 * Reset A/B test (clear results and start new test period)
 */
export function resetABTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.RESULTS);
    setABTestConfig({ testStartDate: new Date().toISOString() });
  } catch (e) {
    console.error("Failed to reset A/B test:", e);
  }
}

// ============================================================================
// RAG Decision Logic
// ============================================================================

/**
 * Determine whether to use RAG for a new analysis
 * Uses configured sample rate for A/B testing
 */
export function shouldUseRag(): boolean {
  const config = getABTestConfig();

  // If RAG is disabled, never use it
  if (!config.ragEnabled) {
    return false;
  }

  // If force RAG is enabled, always use it
  if (config.forceRag) {
    return true;
  }

  // Otherwise, use sample rate for A/B testing
  const random = Math.random() * 100;
  return random < config.ragSampleRate;
}

// ============================================================================
// Result Tracking
// ============================================================================

/**
 * Get all A/B test results
 */
export function getABTestResults(): ABTestResult[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.RESULTS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load A/B test results:", e);
  }
  return [];
}

/**
 * Record a new A/B test result
 */
export function recordABTestResult(result: Omit<ABTestResult, "timestamp">): void {
  try {
    const results = getABTestResults();
    results.push({
      ...result,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 1000 results to prevent storage bloat
    const trimmed = results.slice(-1000);
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(trimmed));
  } catch (e) {
    console.error("Failed to record A/B test result:", e);
  }
}

/**
 * Update an existing A/B test result (e.g., when feedback is provided)
 */
export function updateABTestResult(
  analysisId: number,
  updates: Partial<Pick<ABTestResult, "rating" | "feedbackType" | "promotedToGold">>
): void {
  try {
    const results = getABTestResults();
    const index = results.findIndex((r) => r.analysisId === analysisId);

    if (index !== -1) {
      results[index] = { ...results[index], ...updates };
      localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(results));
    }
  } catch (e) {
    console.error("Failed to update A/B test result:", e);
  }
}

// ============================================================================
// Analysis & Reporting
// ============================================================================

/**
 * Calculate A/B test summary statistics
 */
export function calculateABTestSummary(): ABTestSummary {
  const results = getABTestResults();
  const config = getABTestConfig();

  // Filter to current test period
  const testStartDate = new Date(config.testStartDate);
  const periodResults = results.filter((r) => new Date(r.timestamp) >= testStartDate);

  // Split into RAG and baseline groups
  const ragResults = periodResults.filter((r) => r.useRag);
  const baselineResults = periodResults.filter((r) => !r.useRag);

  // Calculate averages
  const avgRating = (items: ABTestResult[]): number => {
    const rated = items.filter((r) => r.rating !== undefined);
    if (rated.length === 0) return 0;
    return rated.reduce((sum, r) => sum + (r.rating || 0), 0) / rated.length;
  };

  const acceptanceRate = (items: ABTestResult[]): number => {
    const withFeedback = items.filter((r) => r.feedbackType);
    if (withFeedback.length === 0) return 0;
    const accepted = withFeedback.filter((r) => r.feedbackType === "accept").length;
    return accepted / withFeedback.length;
  };

  const goldRate = (items: ABTestResult[]): number => {
    if (items.length === 0) return 0;
    const promoted = items.filter((r) => r.promotedToGold).length;
    return promoted / items.length;
  };

  const avgDuration = (items: ABTestResult[]): number => {
    const withDuration = items.filter((r) => r.analysisDuration > 0);
    if (withDuration.length === 0) return 0;
    return withDuration.reduce((sum, r) => sum + r.analysisDuration, 0) / withDuration.length;
  };

  return {
    totalAnalyses: periodResults.length,
    ragAnalyses: ragResults.length,
    baselineAnalyses: baselineResults.length,
    ragAvgRating: avgRating(ragResults),
    baselineAvgRating: avgRating(baselineResults),
    ragAcceptanceRate: acceptanceRate(ragResults),
    baselineAcceptanceRate: acceptanceRate(baselineResults),
    ragGoldRate: goldRate(ragResults),
    baselineGoldRate: goldRate(baselineResults),
    ragAvgDuration: avgDuration(ragResults),
    baselineAvgDuration: avgDuration(baselineResults),
  };
}

/**
 * Determine the winner of the A/B test
 * Returns "rag" | "baseline" | "inconclusive"
 */
export function determineABTestWinner(): "rag" | "baseline" | "inconclusive" {
  const summary = calculateABTestSummary();

  // Need at least 10 samples in each group for statistical significance
  if (summary.ragAnalyses < 10 || summary.baselineAnalyses < 10) {
    return "inconclusive";
  }

  // Compare metrics (weighted scoring)
  let ragScore = 0;
  let baselineScore = 0;

  // Rating comparison (weight: 3)
  if (summary.ragAvgRating > summary.baselineAvgRating + 0.2) {
    ragScore += 3;
  } else if (summary.baselineAvgRating > summary.ragAvgRating + 0.2) {
    baselineScore += 3;
  }

  // Acceptance rate comparison (weight: 2)
  if (summary.ragAcceptanceRate > summary.baselineAcceptanceRate + 0.05) {
    ragScore += 2;
  } else if (summary.baselineAcceptanceRate > summary.ragAcceptanceRate + 0.05) {
    baselineScore += 2;
  }

  // Gold promotion rate comparison (weight: 2)
  if (summary.ragGoldRate > summary.baselineGoldRate + 0.02) {
    ragScore += 2;
  } else if (summary.baselineGoldRate > summary.ragGoldRate + 0.02) {
    baselineScore += 2;
  }

  // Duration penalty (RAG is expected to be slower, penalize if much slower)
  // Only penalize if RAG is more than 50% slower
  if (summary.ragAvgDuration > summary.baselineAvgDuration * 1.5) {
    ragScore -= 1;
  }

  // Determine winner
  if (ragScore > baselineScore + 2) {
    return "rag";
  } else if (baselineScore > ragScore + 2) {
    return "baseline";
  }

  return "inconclusive";
}

// ============================================================================
// Export for Components
// ============================================================================

export const ABTestingService = {
  getConfig: getABTestConfig,
  setConfig: setABTestConfig,
  reset: resetABTest,
  shouldUseRag,
  recordResult: recordABTestResult,
  updateResult: updateABTestResult,
  getSummary: calculateABTestSummary,
  getWinner: determineABTestWinner,
  getResults: getABTestResults,
};

export default ABTestingService;
