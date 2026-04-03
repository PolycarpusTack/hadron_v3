import React from 'react';
import { DetectedPattern } from '../../services/api';
import { getPatternIcon, getPatternLabel } from './sentryHelpers';

interface SentryPatternCardProps {
  patterns: DetectedPattern[];
  aiPatternType: string;
}

const REMEDIATION_GUIDANCE: Record<string, string> = {
  deadlock:
    'Review lock ordering across all code paths to ensure a consistent acquisition sequence. ' +
    'Use timeout-based locking so threads do not wait indefinitely. ' +
    'Consider replacing coarse-grained locks with advisory locks or lock-free data structures.',
  n_plus_one:
    'Use eager loading (JOIN or preload) to fetch related records in a single query. ' +
    'Review ORM query patterns and add batch-loading where associations are traversed in loops. ' +
    'Enable query logging in development to surface N+1 patterns early.',
  memory_leak:
    'Check for unclosed resources such as streams, connections, and file handles. ' +
    'Audit growing caches or collections that are never evicted. ' +
    'Use memory-profiling tools (e.g. heap snapshots or Valgrind) to pinpoint the allocation site.',
  unhandled_promise:
    'Add .catch() handlers or try/await blocks to all Promise chains. ' +
    'Enable the unhandledRejection process event as a safety net. ' +
    'Consider a global error boundary in frameworks that support it.',
  race_condition:
    'Identify shared mutable state and protect it with appropriate synchronisation primitives. ' +
    'Prefer immutable data structures or message-passing patterns where possible. ' +
    'Add integration tests that exercise concurrent code paths.',
  connection_exhaustion:
    'Tune the connection-pool size to match the load and upstream limits. ' +
    'Ensure connections are always released in finally blocks. ' +
    'Add circuit breakers and back-pressure mechanisms to prevent cascading exhaustion.',
  timeout_cascade:
    'Set per-call timeouts and propagate them through the call chain. ' +
    'Implement bulkheads to isolate slow dependencies. ' +
    'Add retries with exponential back-off and jitter.',
  auth_failure:
    'Verify token expiry and refresh logic on the client side. ' +
    'Ensure clock skew between services is within acceptable bounds. ' +
    'Add structured logging for auth failures to aid diagnosis.',
  constraint_violation:
    'Validate data at the application layer before it reaches the database. ' +
    'Review recent schema or business-rule changes that may have tightened constraints. ' +
    'Handle constraint errors explicitly and surface actionable messages to callers.',
  resource_exhaustion:
    'Profile CPU, memory, and file-descriptor usage under realistic load. ' +
    'Implement rate limiting and request queuing to prevent runaway consumption. ' +
    'Set OS-level resource limits (ulimits/cgroups) as a safety net.',
  stack_overflow:
    'Identify recursive call sites and add base-case guards. ' +
    'Convert deep recursion to iterative algorithms or trampolining. ' +
    'Increase the stack size only as a temporary measure while refactoring.',
};

const DEFAULT_REMEDIATION =
  'Review recent changes related to this area of the codebase. ' +
  'Add targeted logging and metrics around the failing code path. ' +
  'Consult runbooks or prior incident reports for similar failures.';

function getConfidenceBarColor(confidence: number): string {
  if (confidence > 0.8) return 'bg-green-500';
  if (confidence > 0.6) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function SentryPatternCard({ patterns, aiPatternType }: SentryPatternCardProps) {
  const isGeneric = aiPatternType === 'generic' || !aiPatternType;

  return (
    <div className="space-y-4">
      {/* AI classification header */}
      <div
        className={`rounded-lg p-4 ${
          isGeneric ? 'bg-blue-50 border border-blue-200' : 'bg-emerald-50 border border-emerald-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{getPatternIcon(aiPatternType)}</span>
          <div>
            <p className={`text-sm font-semibold ${isGeneric ? 'text-blue-800' : 'text-emerald-800'}`}>
              AI Classification
            </p>
            <p className={`text-base font-bold ${isGeneric ? 'text-blue-900' : 'text-emerald-900'}`}>
              {getPatternLabel(aiPatternType)}
            </p>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {patterns.length === 0 && isGeneric && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No specific patterns detected — analysis classified as generic.
        </div>
      )}

      {/* Per-pattern cards */}
      {patterns.map((pattern, idx) => {
        const pct = Math.round(pattern.confidence * 100);
        const barColor = getConfidenceBarColor(pattern.confidence);
        const remediation = REMEDIATION_GUIDANCE[pattern.patternType] ?? DEFAULT_REMEDIATION;

        return (
          <div key={idx} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{getPatternIcon(pattern.patternType)}</span>
                <span className="font-semibold text-gray-900">{getPatternLabel(pattern.patternType)}</span>
              </div>
              <span className="text-sm font-medium text-gray-600 whitespace-nowrap">{pct}%</span>
            </div>

            {/* Confidence bar */}
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div
                className={`h-2 rounded-full ${barColor} transition-all`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Evidence list */}
            {pattern.evidence.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Evidence</p>
                <ul className="space-y-1">
                  {pattern.evidence.map((ev, ei) => (
                    <li key={ei} className="flex items-start gap-1.5 text-sm text-gray-700">
                      <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                      {ev}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Remediation */}
            <div className="rounded-md bg-gray-50 border border-gray-100 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Remediation</p>
              <p className="text-sm text-gray-700">{remediation}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SentryPatternCard;
