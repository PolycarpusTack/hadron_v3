import { useEffect, useState } from "react";
import { api, Tag } from "../../services/api";
import { TagBadge } from "./TagBadge";

interface TagSelectorProps {
  analysisId: number;
  onTagsChange?: (tags: Tag[]) => void;
}

export function TagSelector({ analysisId, onTagsChange }: TagSelectorProps) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.listTags().then(setAllTags).catch(console.error);
    api.getAnalysisTags(analysisId).then(setSelectedTags).catch(console.error);
  }, [analysisId]);

  const toggleTag = async (tag: Tag) => {
    const isSelected = selectedTags.some((t) => t.id === tag.id);
    const newIds = isSelected
      ? selectedTags.filter((t) => t.id !== tag.id).map((t) => t.id)
      : [...selectedTags.map((t) => t.id), tag.id];

    try {
      const updated = await api.setAnalysisTags(analysisId, newIds);
      setSelectedTags(updated);
      onTagsChange?.(updated);
    } catch (e) {
      console.error("Failed to update tags:", e);
    }
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {selectedTags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} onRemove={() => toggleTag(tag)} />
        ))}
        <button
          onClick={() => setOpen(!open)}
          className="rounded-md px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          + Tag
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-slate-600 bg-slate-800 p-2 shadow-lg">
          {allTags.length === 0 ? (
            <p className="text-xs text-slate-500">No tags available</p>
          ) : (
            allTags.map((tag) => {
              const isSelected = selectedTags.some((t) => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-blue-600/20 text-blue-400"
                      : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <span className={isSelected ? "opacity-100" : "opacity-0"}>
                    &#10003;
                  </span>
                  {tag.name}
                </button>
              );
            })
          )}
          <button
            onClick={() => setOpen(false)}
            className="mt-1 w-full rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
