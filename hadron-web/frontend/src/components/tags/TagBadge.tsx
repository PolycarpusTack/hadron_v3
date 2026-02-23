import type { Tag } from "../../services/api";

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
}

const DEFAULT_COLORS: Record<string, string> = {
  red: "bg-red-500/20 text-red-400",
  blue: "bg-blue-500/20 text-blue-400",
  green: "bg-green-500/20 text-green-400",
  yellow: "bg-yellow-500/20 text-yellow-400",
  purple: "bg-purple-500/20 text-purple-400",
  orange: "bg-orange-500/20 text-orange-400",
  pink: "bg-pink-500/20 text-pink-400",
  cyan: "bg-cyan-500/20 text-cyan-400",
};

export function TagBadge({ tag, onRemove }: TagBadgeProps) {
  const colorClass = tag.color
    ? DEFAULT_COLORS[tag.color] || "bg-slate-600/50 text-slate-300"
    : "bg-slate-600/50 text-slate-300";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 opacity-60 hover:opacity-100"
        >
          &times;
        </button>
      )}
    </span>
  );
}
