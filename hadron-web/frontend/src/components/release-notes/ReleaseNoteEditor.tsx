import { useEffect, useState } from "react";
import { api, type AiInsights, type ReleaseNote, type ConfluencePageResult } from "../../services/api";
import { useToast } from "../Toast";
import { ReleaseNotesInsights } from "./ReleaseNotesInsights";
import { ReleaseNotesReview } from './ReleaseNotesReview';
import { ReleaseNotesCompliance } from './ReleaseNotesCompliance';

type ViewMode = 'edit' | 'preview';

interface ReleaseNoteEditorProps {
  noteId: number | null;
  onSaved: () => void;
  onCancel: () => void;
  currentUserId?: string;
  currentUserRole?: string;
}

export function ReleaseNoteEditor({
  noteId,
  onSaved,
  onCancel,
  currentUserId,
  currentUserRole,
}: ReleaseNoteEditorProps) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [format, setFormat] = useState("markdown");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);
  const [note, setNote] = useState<ReleaseNote | null>(null);
  const [showCompliance, setShowCompliance] = useState(false);
  const [confluenceConfigured, setConfluenceConfigured] = useState(false);
  const [publishingConfluence, setPublishingConfluence] = useState(false);
  const [confluenceResult, setConfluenceResult] = useState<{ url: string; created: boolean } | null>(null);

  function applyNote(loaded: ReleaseNote) {
    setNote(loaded);
    setTitle(loaded.title);
    setVersion(loaded.version || "");
    setFormat(loaded.format);
    setContent(loaded.markdownContent || loaded.content);
    setIsPublished(loaded.isPublished);
    setAiInsights(loaded.aiInsights ?? null);
  }

  useEffect(() => {
    if (noteId) {
      api
        .getReleaseNote(noteId)
        .then(applyNote)
        .catch((e) =>
          toast.error(
            e instanceof Error ? e.message : "Failed to load release note",
          ),
        );
    } else {
      setNote(null);
      setTitle("");
      setVersion("");
      setFormat("markdown");
      setContent("");
      setIsPublished(false);
      setAiInsights(null);
    }
  }, [noteId]);

  useEffect(() => {
    api.getConfluenceConfig().then(c => setConfluenceConfigured(c.configured)).catch(() => {});
  }, []);

  async function handleReload() {
    if (noteId) {
      try {
        const loaded = await api.getReleaseNote(noteId);
        applyNote(loaded);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reload note");
      }
    }
  }

  const isReadOnly =
    note?.status === 'approved' || note?.status === 'published';

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      if (noteId) {
        await api.updateReleaseNote(noteId, {
          title: title.trim(),
          version: version.trim() || undefined,
          content,
          format,
        });
      } else {
        await api.createReleaseNote({
          title: title.trim(),
          version: version.trim() || undefined,
          content,
          format,
        });
      }
      toast.success(noteId ? "Release note updated" : "Release note created");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!noteId) return;
    setPublishing(true);
    try {
      await api.publishReleaseNote(noteId);
      toast.success("Release note published");
      setIsPublished(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  async function handleExportConfluence() {
    if (!noteId) return;
    try {
      const text = await api.exportConfluence(noteId);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'release-notes'}-confluence.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to export Confluence markup");
    }
  }

  async function handlePublishConfluence() {
    if (!noteId) return;
    setPublishingConfluence(true);
    setConfluenceResult(null);
    try {
      const result: ConfluencePageResult = await api.publishToConfluence(noteId);
      setConfluenceResult(result);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to publish to Confluence");
    }
    setPublishingConfluence(false);
  }

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: 'edit', label: 'Edit' },
    { key: 'preview', label: 'Preview' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">
          {noteId ? "Edit Release Note" : "New Release Note"}
        </h3>
        <button
          onClick={onCancel}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          Back to list
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm text-slate-400">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Release note title"
            readOnly={isReadOnly}
            className={`w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none ${isReadOnly ? 'cursor-not-allowed opacity-70' : ''}`}
          />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm text-slate-400">Version</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 4.1.0"
              readOnly={isReadOnly}
              className={`w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none ${isReadOnly ? 'cursor-not-allowed opacity-70' : ''}`}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={isReadOnly}
              className={`rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none ${isReadOnly ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              <option value="markdown">Markdown</option>
              <option value="plain">Plain text</option>
            </select>
          </div>
        </div>
      </div>

      {/* View mode toggle */}
      <div className="flex items-center gap-1">
        {viewModes.map((mode) => (
          <button
            key={mode.key}
            onClick={() => setViewMode(mode.key)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              viewMode === mode.key
                ? 'bg-slate-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      {viewMode === 'edit' ? (
        <div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            readOnly={isReadOnly}
            placeholder={
              format === "markdown"
                ? "## Changes\n\n- Feature A\n- Bug fix B"
                : "Write release notes here..."
            }
            className={`w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none ${isReadOnly ? 'cursor-not-allowed bg-slate-900' : ''}`}
          />
        </div>
      ) : (
        <div className="min-h-[30rem] overflow-y-auto rounded-md border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-300">
          {content ? (
            <div className="whitespace-pre-wrap">{content}</div>
          ) : (
            <span className="text-slate-500">Nothing to preview</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}
        {noteId && !isPublished && !isReadOnly && (
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {publishing ? "Publishing..." : "Publish"}
          </button>
        )}
        {isPublished && (
          <span className="text-sm text-green-400">Published</span>
        )}
        {noteId && (
          <button
            onClick={() => setShowCompliance(!showCompliance)}
            className="rounded-md px-3 py-1.5 text-sm bg-amber-100 text-amber-800 hover:bg-amber-200"
          >
            {showCompliance ? 'Hide Compliance' : 'Compliance Check'}
          </button>
        )}
        {noteId && (
          <button
            onClick={handleExportConfluence}
            className="rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-600/10"
          >
            Export Confluence
          </button>
        )}
        {noteId && confluenceConfigured && (
          <button
            onClick={handlePublishConfluence}
            disabled={publishingConfluence}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {publishingConfluence ? "Publishing..." : "Publish to Confluence"}
          </button>
        )}
        {noteId && (
          <button
            onClick={async () => {
              if (!window.confirm('Are you sure you want to delete this release note?')) return;
              try {
                await api.deleteReleaseNote(noteId);
                toast.success("Release note deleted");
                onSaved();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Failed to delete",
                );
              }
            }}
            className="rounded-md px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
          >
            Delete
          </button>
        )}
      </div>

      {confluenceResult && (
        <div className="text-sm text-green-700 bg-green-50 p-2 rounded">
          {confluenceResult.created ? 'Page created' : 'Page updated'}:{' '}
          <a href={confluenceResult.url} target="_blank" rel="noopener noreferrer" className="underline">
            View in Confluence
          </a>
        </div>
      )}

      {/* Compliance panel */}
      {showCompliance && noteId && (
        <div className="rounded-lg border border-amber-700/40 bg-slate-800/60 p-4">
          <h4 className="mb-4 text-sm font-semibold text-slate-300">Compliance Check</h4>
          <ReleaseNotesCompliance noteId={noteId} />
        </div>
      )}

      {/* Review workflow */}
      {noteId && note?.status !== undefined && (
        <div className="mt-4 border-t border-slate-700 pt-4">
          <h4 className="mb-4 text-sm font-semibold text-slate-300">Review Workflow</h4>
          <ReleaseNotesReview
            noteId={noteId}
            status={note?.status ?? null}
            noteOwnerId={note?.userId ?? ''}
            currentUserId={currentUserId || ''}
            currentUserRole={currentUserRole || 'analyst'}
            onStatusChange={handleReload}
          />
        </div>
      )}

      {/* AI Insights panel — shown only when insights are available */}
      {aiInsights && (
        <div className="mt-6 border-t border-slate-700 pt-6">
          <h4 className="mb-4 text-sm font-semibold text-slate-300">AI Insights</h4>
          <ReleaseNotesInsights insights={aiInsights} />
        </div>
      )}
    </div>
  );
}
