import React, { useState } from 'react';
import { SentryException } from '../../services/api';

interface SentryExceptionChainProps {
  exceptions: SentryException[];
}

interface FrameTagProps {
  inApp: boolean | null;
}

function FrameTag({ inApp }: FrameTagProps) {
  if (inApp) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-xs font-bold bg-green-100 text-green-800">
        APP
      </span>
    );
  }
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-xs font-bold bg-gray-100 text-gray-600">
      LIB
    </span>
  );
}

export function SentryExceptionChain({ exceptions }: SentryExceptionChainProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  if (exceptions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No exception data available.
      </div>
    );
  }

  function toggle(idx: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {exceptions.map((exc, idx) => {
        const isOpen = expanded.has(idx);
        const frames = exc.stacktrace ?? [];
        const reversedFrames = [...frames].reverse();

        return (
          <div key={idx} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            {/* Header */}
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              onClick={() => toggle(idx)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-gray-900 truncate">
                  {exc.type ?? 'Unknown Exception'}
                </span>
                {exc.module && (
                  <span className="text-xs text-gray-500 truncate">
                    in {exc.module}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {frames.length > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {frames.length} frame{frames.length !== 1 ? 's' : ''}
                  </span>
                )}
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Body */}
            {isOpen && (
              <div className="border-t border-gray-100 px-4 py-3 space-y-4">
                {/* Exception value/message */}
                {exc.value && (
                  <div className="rounded-md bg-gray-900 px-3 py-2">
                    <p className="font-mono text-sm text-gray-100 whitespace-pre-wrap break-words">
                      {exc.value}
                    </p>
                  </div>
                )}

                {/* Frame table */}
                {reversedFrames.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left">
                          <th className="pb-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-400 w-12">
                            Tag
                          </th>
                          <th className="pb-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Function
                          </th>
                          <th className="pb-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            File
                          </th>
                          <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 w-16">
                            Line
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {reversedFrames.map((frame, fi) => (
                          <tr key={fi} className={frame.inApp ? 'bg-green-50/40' : ''}>
                            <td className="py-1.5 pr-3">
                              <FrameTag inApp={frame.inApp} />
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs text-gray-800 max-w-xs truncate">
                              {frame.function ?? <span className="italic text-gray-400">anonymous</span>}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs text-gray-500 max-w-xs truncate">
                              {frame.filename ?? frame.module ?? '—'}
                            </td>
                            <td className="py-1.5 font-mono text-xs text-gray-500">
                              {frame.lineNo != null ? frame.lineNo : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No stack frames available.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default SentryExceptionChain;
