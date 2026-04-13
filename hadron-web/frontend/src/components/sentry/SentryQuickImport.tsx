import { useState, type KeyboardEvent } from 'react';
import { SentryIssue } from '../../services/api';
import { api } from '../../services/api';
import { SentryIssueRow } from './SentryIssueRow';

interface SentryQuickImportProps {
  onAnalyze: (issueId: string) => void;
}

function parseIssueInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full URL: extract numeric issue ID from /issues/123/
  const urlMatch = trimmed.match(/\/issues\/(\d+)\/?/);
  if (urlMatch) return urlMatch[1];

  // Numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;

  // Short ID like PROJ-123
  if (/^[A-Za-z0-9_-]+-\d+$/.test(trimmed)) return trimmed;

  return null;
}

export function SentryQuickImport({ onAnalyze }: SentryQuickImportProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SentryIssue | null>(null);

  const handleFetch = async () => {
    setError(null);
    setResult(null);

    const parsed = parseIssueInput(input);
    if (!parsed) {
      setError('Invalid input. Enter a Sentry issue URL, numeric ID, or short ID (e.g., PROJ-123).');
      return;
    }

    setLoading(true);
    try {
      const issue = await api.getSentryIssue(parsed);
      setResult(issue);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch Sentry issue.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleFetch();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter Sentry issue URL, ID, or short ID (e.g., PROJ-123)"
          disabled={loading}
          className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleFetch}
          disabled={loading || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Fetching…' : 'Fetch'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {result && (
        <div className="rounded-md border border-slate-700 bg-slate-800">
          <SentryIssueRow issue={result} onAnalyze={onAnalyze} />
        </div>
      )}
    </div>
  );
}
