import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { useToast } from "../Toast";

interface ReleaseNoteEditorProps {
  noteId: number | null;
  onSaved: () => void;
  onCancel: () => void;
}

export function ReleaseNoteEditor({
  noteId,
  onSaved,
  onCancel,
}: ReleaseNoteEditorProps) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [format, setFormat] = useState("markdown");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(false);

  useEffect(() => {
    if (noteId) {
      api
        .getReleaseNote(noteId)
        .then((note) => {
          setTitle(note.title);
          setVersion(note.version || "");
          setFormat(note.format);
          setContent(note.content);
          setIsPublished(note.isPublished);
        })
        .catch((e) =>
          toast.error(
            e instanceof Error ? e.message : "Failed to load release note",
          ),
        );
    } else {
      setTitle("");
      setVersion("");
      setFormat("markdown");
      setContent("");
      setIsPublished(false);
    }
  }, [noteId]);

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
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="markdown">Markdown</option>
              <option value="plain">Plain text</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm text-slate-400">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            placeholder={
              format === "markdown"
                ? "## Changes\n\n- Feature A\n- Bug fix B"
                : "Write release notes here..."
            }
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-400">Preview</label>
          <div className="h-[calc(16*1.5rem+1rem)] overflow-y-auto rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
            {format === "markdown" ? (
              <div className="whitespace-pre-wrap">{content || "Nothing to preview"}</div>
            ) : (
              <pre className="whitespace-pre-wrap">{content || "Nothing to preview"}</pre>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {noteId && !isPublished && (
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
            onClick={async () => {
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
    </div>
  );
}
