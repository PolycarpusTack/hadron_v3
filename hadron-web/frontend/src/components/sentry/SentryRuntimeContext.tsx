import React from 'react';
import { SentryTag } from '../../services/api';

interface SentryRuntimeContextProps {
  contexts: Record<string, unknown>;
  tags: SentryTag[];
}

const KNOWN_SECTIONS = ['os', 'browser', 'device', 'runtime'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isStringRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export default function SentryRuntimeContext({ contexts, tags }: SentryRuntimeContextProps) {
  const sections = KNOWN_SECTIONS.filter((key) => key in contexts && isStringRecord(contexts[key]));
  const visibleTags = tags.filter((t) => !t.key.startsWith('sentry:'));
  const hasContent = sections.length > 0 || visibleTags.length > 0;

  if (!hasContent) {
    return (
      <div className="text-sm text-gray-500 italic py-4">No context data available.</div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {sections.map((sectionKey) => {
            const sectionData = contexts[sectionKey] as Record<string, unknown>;
            const entries = Object.entries(sectionData).filter(
              ([, v]) => typeof v === 'string'
            ) as [string, string][];

            if (entries.length === 0) return null;

            return (
              <div
                key={sectionKey}
                className="bg-gray-50 rounded-lg p-3 border border-gray-200"
              >
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {capitalize(sectionKey)}
                </h4>
                <dl className="space-y-1">
                  {entries.map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-sm">
                      <dt className="text-gray-500 shrink-0">{k}:</dt>
                      <dd className="text-gray-800 font-medium truncate">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {visibleTags.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Tags
          </h4>
          <div className="flex flex-wrap gap-2">
            {visibleTags.map((tag) => (
              <span
                key={tag.key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 border border-gray-200"
              >
                <span className="font-medium text-gray-500">{tag.key}:</span>
                <span>{tag.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
