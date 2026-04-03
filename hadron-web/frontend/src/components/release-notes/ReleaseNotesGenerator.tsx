import { useState, useEffect } from 'react';
import { api, JiraFixVersion, ReleaseNoteTicketPreview, ReleaseNotesGenerateRequest } from '../../services/api';
import { useProgressStream } from '../../hooks/useProgressStream';
import { getPhaseLabel, getPhaseColor } from './releaseNotesHelpers';

interface Props {
  onComplete: (releaseNoteId: number) => void;
}

interface EnrichmentOptions {
  rewrite: boolean;
  keywords: boolean;
  modules: boolean;
  breaking: boolean;
}

export default function ReleaseNotesGenerator({ onComplete }: Props) {
  const [projectKey, setProjectKey] = useState('MGXPRODUCT');
  const [fixVersions, setFixVersions] = useState<JiraFixVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [contentType, setContentType] = useState<'features' | 'fixes' | 'both'>('both');
  const [enrichment, setEnrichment] = useState<EnrichmentOptions>({
    rewrite: true,
    keywords: true,
    modules: true,
    breaking: true,
  });
  const [jqlFilter, setJqlFilter] = useState('');
  const [previewTickets, setPreviewTickets] = useState<ReleaseNoteTicketPreview[] | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    startStream,
    progress,
    phase,
    message,
    isStreaming,
    error: streamError,
    completedData,
    reset,
  } = useProgressStream();

  useEffect(() => {
    if (completedData?.releaseNoteId) {
      onComplete(completedData.releaseNoteId);
    }
  }, [completedData, onComplete]);

  function buildConfig(): ReleaseNotesGenerateRequest {
    return {
      fixVersion: selectedVersion,
      contentType,
      projectKey: projectKey || undefined,
      jqlFilter: jqlFilter || undefined,
      enrichment: {
        rewriteDescriptions: enrichment.rewrite,
        generateKeywords: enrichment.keywords,
        classifyModules: enrichment.modules,
        detectBreakingChanges: enrichment.breaking,
      },
    };
  }

  async function handleLoadVersions() {
    if (!projectKey.trim()) return;
    setLoadingVersions(true);
    setError(null);
    try {
      const versions = await api.getJiraFixVersions(projectKey.trim());
      setFixVersions(versions);
      if (versions.length > 0 && !selectedVersion) {
        setSelectedVersion(versions[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fix versions');
    } finally {
      setLoadingVersions(false);
    }
  }

  async function handlePreview() {
    if (!selectedVersion) {
      setError('Please select a fix version first');
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const tickets = await api.previewReleaseNotesTickets(buildConfig());
      setPreviewTickets(tickets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview tickets');
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleGenerate() {
    if (!selectedVersion) {
      setError('Please select a fix version first');
      return;
    }
    setError(null);
    reset();
    startStream('/release-notes/generate/stream', buildConfig());
  }

  function toggleEnrichment(key: keyof EnrichmentOptions) {
    setEnrichment(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const issueTypeIcon: Record<string, string> = {
    Bug: '🐛',
    Story: '📖',
    Task: '✅',
    Epic: '⚡',
  };

  return (
    <div className="space-y-6">
      {/* Config Section */}
      <div className="bg-gray-800 rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">Configuration</h3>

        {/* Project key + Load Versions */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-400 mb-1">Project Key</label>
            <input
              type="text"
              value={projectKey}
              onChange={e => setProjectKey(e.target.value)}
              placeholder="e.g. MGXPRODUCT"
              className="w-full bg-gray-700 text-gray-100 text-sm rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            onClick={handleLoadVersions}
            disabled={loadingVersions || !projectKey.trim()}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-gray-100 rounded transition-colors"
          >
            {loadingVersions ? 'Loading…' : 'Load Versions'}
          </button>
        </div>

        {/* Fix version dropdown */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Fix Version</label>
          <select
            value={selectedVersion}
            onChange={e => setSelectedVersion(e.target.value)}
            disabled={fixVersions.length === 0}
            className="w-full bg-gray-700 text-gray-100 text-sm rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
          >
            {fixVersions.length === 0 ? (
              <option value="">— load versions first —</option>
            ) : (
              fixVersions.map(v => (
                <option key={v.id} value={v.name}>
                  {v.name}
                  {v.released ? ' (released)' : ''}
                  {v.releaseDate ? ` · ${v.releaseDate}` : ''}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Content type */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">Content Type</label>
          <div className="flex gap-4">
            {(['features', 'fixes', 'both'] as const).map(type => (
              <label key={type} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="contentType"
                  value={type}
                  checked={contentType === type}
                  onChange={() => setContentType(type)}
                  className="accent-amber-500"
                />
                <span className="text-sm text-gray-300 capitalize">{type === 'both' ? 'Both' : type === 'features' ? 'Features' : 'Fixes'}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Enrichment toggles (2x2 grid) */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">Enrichment Options</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'rewrite' as const, label: 'Rewrite Descriptions' },
                { key: 'keywords' as const, label: 'Generate Keywords' },
                { key: 'modules' as const, label: 'Classify Modules' },
                { key: 'breaking' as const, label: 'Detect Breaking Changes' },
              ] as const
            ).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enrichment[key]}
                  onChange={() => toggleEnrichment(key)}
                  className="accent-amber-500"
                />
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Optional JQL filter */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Optional JQL Filter <span className="text-gray-500 font-normal">(applied on top of fix version)</span>
          </label>
          <input
            type="text"
            value={jqlFilter}
            onChange={e => setJqlFilter(e.target.value)}
            placeholder='e.g. priority = High AND labels = "customer-facing"'
            className="w-full bg-gray-700 text-gray-100 text-sm rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handlePreview}
          disabled={loadingPreview || isStreaming || !selectedVersion}
          className="px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-gray-100 rounded transition-colors"
        >
          {loadingPreview ? 'Loading preview…' : 'Preview Tickets'}
        </button>
        <button
          onClick={handleGenerate}
          disabled={isStreaming || !selectedVersion}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white font-medium rounded transition-colors"
        >
          {isStreaming ? 'Generating…' : 'Generate Release Notes'}
        </button>
      </div>

      {/* Preview results */}
      {previewTickets !== null && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-300">Ticket Preview</span>
            <span className="px-2 py-0.5 bg-amber-600 text-white text-xs rounded-full">
              {previewTickets.length}
            </span>
          </div>
          {previewTickets.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No tickets found for this filter.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              {previewTickets.map(ticket => (
                <div
                  key={ticket.key}
                  className="flex items-start gap-2 py-1.5 border-b border-gray-700 last:border-0"
                >
                  <span className="text-base leading-none mt-0.5">
                    {issueTypeIcon[ticket.issueType] ?? '🎫'}
                  </span>
                  <div className="min-w-0">
                    <span className="text-xs font-mono text-amber-400 mr-2">{ticket.key}</span>
                    <span className="text-sm text-gray-200 break-words">{ticket.summary}</span>
                  </div>
                  <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">{ticket.issueType}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress section */}
      {isStreaming && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-200">{getPhaseLabel(phase)}</span>
            <span className="text-sm font-semibold text-amber-400">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${getPhaseColor(phase)}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {message && <p className="text-xs text-gray-400">{message}</p>}
        </div>
      )}

      {/* Completion progress (phase = complete, not streaming) */}
      {!isStreaming && completedData && completedData.phase === 'complete' && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-200">{getPhaseLabel(completedData.phase)}</span>
            <span className="text-sm font-semibold text-green-400">100%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-green-500" style={{ width: '100%' }} />
          </div>
          {completedData.message && (
            <p className="text-xs text-gray-400">{completedData.message}</p>
          )}
        </div>
      )}

      {/* Error display */}
      {(error || streamError) && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3">
          <p className="text-sm text-red-300">{error || streamError}</p>
        </div>
      )}
    </div>
  );
}
