export interface SentryFullData {
  issueId?: string;
  shortId?: string;
  permalink?: string;
  level?: string;
  status?: string;
  platform?: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  culprit?: string;
  /** Daily event counts: [[epoch_seconds, count], ...] */
  eventStats: Array<[number, number]>;
  detectedPatterns: Array<{
    patternType: string;
    confidence: number;
    evidence: string[];
  }>;
  aiResult?: {
    root_cause?: string;
    suggested_fixes?: string[];
    error_type?: string;
    error_message?: string;
    severity?: string;
    component?: string;
    confidence?: string;
    pattern_type?: string;
    user_impact?: string;
    breadcrumb_analysis?: string;
    plain_english?: string;
    reproduction_steps?: string[];
    workaround?: string;
    fingerprint?: string[];
    monitoring_alerts?: Array<{
      name: string;
      condition: string;
      target?: string;
      severity?: string;
    }>;
    confidence_breakdown?: {
      confirmed: string[];
      inferred: string[];
      unknown: string[];
    };
    stack_trace?: string;
  };
  breadcrumbs: Array<{
    timestamp?: string;
    category?: string;
    message?: string;
    level?: string;
    data?: Record<string, unknown>;
    breadcrumb_type?: string;
  }>;
  exceptions: Array<{
    exception_type?: string;
    value?: string;
    module?: string;
    stacktrace?: {
      frames?: Array<{
        filename?: string;
        function?: string;
        lineNo?: number;
        colNo?: number;
        contextLine?: string;
        preContext?: string[];
        postContext?: string[];
        inApp?: boolean;
        module?: string;
      }>;
    };
  }>;
  tags: Array<{ key: string; value: string }>;
  contexts?: Record<string, unknown>;
}

export function parseSentryFullData(fullDataStr?: string | null): SentryFullData | null {
  if (!fullDataStr) return null;
  try {
    const data = JSON.parse(fullDataStr);
    return {
      issueId:    data.sentry_issue_id,
      shortId:    data.sentry_short_id,
      permalink:  data.sentry_permalink,
      level:      data.sentry_level,
      status:     data.sentry_status,
      platform:   data.sentry_platform,
      count:      data.sentry_count,
      userCount:  data.sentry_user_count,
      firstSeen:  data.sentry_first_seen,
      lastSeen:   data.sentry_last_seen,
      culprit:    data.sentry_culprit,
      eventStats: Array.isArray(data.event_stats) ? data.event_stats : [],
      detectedPatterns: data.detected_patterns || [],
      aiResult:   data.ai_result || null,
      breadcrumbs: data.breadcrumbs || [],
      exceptions:  data.exceptions  || [],
      tags:        data.tags        || [],
      contexts:    data.contexts    || null,
    };
  } catch {
    return null;
  }
}

/** Group suggested fixes by priority prefix (P0:, P1:, P2:). Falls back to P1 bucket. */
export function groupFixesByPriority(fixes: string[]): Record<"P0" | "P1" | "P2", string[]> {
  const result: Record<"P0" | "P1" | "P2", string[]> = { P0: [], P1: [], P2: [] };
  for (const fix of fixes) {
    if (/^P0\b/i.test(fix)) result.P0.push(fix);
    else if (/^P2\b/i.test(fix)) result.P2.push(fix);
    else result.P1.push(fix);
  }
  return result;
}
