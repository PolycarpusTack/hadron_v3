import React, { useState, useEffect, useCallback } from 'react';
import { SentryProject, SentryIssue } from '../../services/api';
import { api } from '../../services/api';
import { SentryIssueRow } from './SentryIssueRow';

interface SentryIssueBrowserProps {
  onAnalyze: (issueId: string) => void;
}

export function SentryIssueBrowser({ onAnalyze }: SentryIssueBrowserProps) {
  const [projects, setProjects] = useState<SentryProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState<boolean>(false);
  const [issuesLoaded, setIssuesLoaded] = useState<boolean>(false);

  // Load projects on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getSentryProjects();
        if (!cancelled) {
          setProjects(data);
          setProjectsLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects');
          setProjectsLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadIssues = useCallback(async (projectSlug: string) => {
    if (!projectSlug) return;
    setLoading(true);
    setError(null);
    setIssuesLoaded(false);
    try {
      const data = await api.getSentryIssues(projectSlug);
      setIssues(data);
      setIssuesLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load issues');
      setIssues([]);
      setIssuesLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const slug = e.target.value;
    setSelectedProject(slug);
    setIssues([]);
    setIssuesLoaded(false);
    setError(null);
    if (slug) {
      loadIssues(slug);
    }
  };

  return (
    <div className="space-y-4">
      {/* Project selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="sentry-project-select" className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Project
        </label>
        <select
          id="sentry-project-select"
          value={selectedProject}
          onChange={handleProjectChange}
          disabled={!projectsLoaded || projects.length === 0}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">
            {!projectsLoaded
              ? 'Loading projects…'
              : projects.length === 0
              ? 'No projects available'
              : 'Select a project…'}
          </option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Manual reload button */}
        {selectedProject && !loading && (
          <button
            type="button"
            onClick={() => loadIssues(selectedProject)}
            className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-700 font-medium transition-colors whitespace-nowrap"
          >
            Reload
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
          <svg
            className="h-4 w-4 animate-spin text-emerald-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading issues…
        </div>
      )}

      {/* Issue list */}
      {!loading && issuesLoaded && issues.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{issues.length} issue{issues.length !== 1 ? 's' : ''} found</p>
          {issues.map((issue) => (
            <SentryIssueRow key={issue.id} issue={issue} onAnalyze={onAnalyze} />
          ))}
        </div>
      )}

      {/* Empty state after load */}
      {!loading && issuesLoaded && issues.length === 0 && !error && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          No issues found for this project.
        </div>
      )}

      {/* Pre-selection prompt */}
      {!loading && !issuesLoaded && !error && !selectedProject && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          Select a project to browse issues.
        </div>
      )}
    </div>
  );
}

export default SentryIssueBrowser;
