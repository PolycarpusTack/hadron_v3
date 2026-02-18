/**
 * SourcePanel — Slide-out panel showing sources used in a response
 *
 * Triggered by clicking source badges (KB: 5, Analyses: 3, etc.)
 * on an assistant message. Lists each source with type badge,
 * clickable URL, relevance score, and expandable snippet preview.
 */

import { useState, useEffect, useRef } from "react";
import {
  X,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Database,
  Star,
  Search,
  BarChart3,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

// ============================================================================
// Types
// ============================================================================

export interface SourceItem {
  title: string;
  url?: string;
  type: "kb" | "analysis" | "gold" | "fts" | "jira";
  snippet?: string;
  score?: number;
}

interface SourcePanelProps {
  isOpen: boolean;
  onClose: () => void;
  sources: SourceItem[];
}

// ============================================================================
// Constants
// ============================================================================

const TYPE_CONFIG: Record<
  SourceItem["type"],
  { label: string; color: string; bgColor: string; icon: typeof BookOpen }
> = {
  kb: {
    label: "KB",
    color: "text-blue-400",
    bgColor: "bg-blue-900/30 border-blue-800/30",
    icon: BookOpen,
  },
  analysis: {
    label: "Analysis",
    color: "text-purple-400",
    bgColor: "bg-purple-900/30 border-purple-800/30",
    icon: Database,
  },
  gold: {
    label: "Gold",
    color: "text-amber-400",
    bgColor: "bg-amber-900/30 border-amber-800/30",
    icon: Star,
  },
  fts: {
    label: "FTS",
    color: "text-cyan-400",
    bgColor: "bg-cyan-900/30 border-cyan-800/30",
    icon: Search,
  },
  jira: {
    label: "JIRA",
    color: "text-green-400",
    bgColor: "bg-green-900/30 border-green-800/30",
    icon: BarChart3,
  },
};

// ============================================================================
// Component
// ============================================================================

export default function SourcePanel({
  isOpen,
  onClose,
  sources,
}: SourcePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group by type for summary
  const typeCounts: Partial<Record<SourceItem["type"], number>> = {};
  for (const s of sources) {
    typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div
        ref={panelRef}
        className="w-full max-w-md h-full bg-gray-800 border-l border-gray-700 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-700 flex-shrink-0">
          <div>
            <div className="font-medium text-sm text-gray-200">Sources</div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {sources.length} source{sources.length !== 1 ? "s" : ""} used
              {Object.entries(typeCounts).length > 0 && (
                <span>
                  {" "}
                  ({Object.entries(typeCounts)
                    .map(([type, count]) => `${TYPE_CONFIG[type as SourceItem["type"]].label}: ${count}`)
                    .join(", ")}
                  )
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {sources.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-8">
              No sources available for this response.
            </div>
          ) : (
            sources.map((source, idx) => (
              <SourceCard key={idx} source={source} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SourceCard sub-component
// ============================================================================

function SourceCard({ source }: { source: SourceItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = TYPE_CONFIG[source.type];
  const Icon = config.icon;

  async function handleOpenUrl() {
    if (source.url) {
      try {
        await open(source.url);
      } catch {
        // Fallback: copy URL
        navigator.clipboard.writeText(source.url);
      }
    }
  }

  return (
    <div className="rounded bg-gray-900/50 border border-gray-700/50">
      {/* Card header */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* Expand toggle (only for items with snippets) */}
        {source.snippet ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-0.5 text-gray-500 hover:text-gray-300 transition flex-shrink-0"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <div className="w-3.5 flex-shrink-0" />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Type badge */}
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.bgColor} ${config.color}`}
            >
              <Icon className="w-2.5 h-2.5" />
              {config.label}
            </span>

            {/* Score bar */}
            {source.score != null && (
              <div className="flex items-center gap-1">
                <div className="w-12 h-1 rounded-full bg-gray-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      source.score >= 0.7
                        ? "bg-emerald-500"
                        : source.score >= 0.4
                          ? "bg-amber-500"
                          : "bg-red-500"
                    }`}
                    style={{ width: `${Math.round(source.score * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-500">
                  {Math.round(source.score * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="text-sm text-gray-300 mt-1 leading-snug truncate">
            {source.title}
          </div>

          {/* URL */}
          {source.url && (
            <button
              onClick={handleOpenUrl}
              className="flex items-center gap-1 text-[11px] text-blue-400/70 hover:text-blue-400 mt-0.5 transition truncate max-w-full"
            >
              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{source.url}</span>
            </button>
          )}
        </div>
      </div>

      {/* Expandable snippet */}
      {expanded && source.snippet && (
        <div className="px-3 pb-2.5 pt-0">
          <div className="ml-6 p-2 rounded bg-gray-800/80 border border-gray-700/30 text-xs text-gray-400 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
            {source.snippet}
          </div>
        </div>
      )}
    </div>
  );
}
