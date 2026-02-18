/**
 * GoldAnswerDialog — Modal for curating gold-standard Q&A pairs
 *
 * Appears when user clicks the gold star icon on an assistant message.
 * Shows question/answer previews, tag input with autocomplete, and
 * saves via the gold-answers service.
 */

import { useState, useEffect, useRef } from "react";
import { Star, X, Loader2, Tag } from "lucide-react";
import { saveGoldAnswer, listGoldAnswers, type SaveGoldAnswerParams } from "../services/gold-answers";

// ============================================================================
// Types
// ============================================================================

interface GoldAnswerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  question: string;
  answer: string;
  sessionId: string;
  messageId: string;
  wonVersion?: string;
  customer?: string;
}

// ============================================================================
// Component
// ============================================================================

export default function GoldAnswerDialog({
  isOpen,
  onClose,
  onSaved,
  question,
  answer,
  sessionId,
  messageId,
  wonVersion,
  customer,
}: GoldAnswerDialogProps) {
  const [tags, setTags] = useState("");
  const [verifiedBy, setVerifiedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tag autocomplete
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Load existing tags for autocomplete on mount
  useEffect(() => {
    if (!isOpen) return;
    listGoldAnswers(200)
      .then((golds) => {
        const tagSet = new Set<string>();
        for (const g of golds) {
          if (g.tags) {
            g.tags.split(",").forEach((t) => {
              const trimmed = t.trim();
              if (trimmed) tagSet.add(trimmed);
            });
          }
        }
        setExistingTags(Array.from(tagSet).sort());
      })
      .catch(() => {
        // Autocomplete is best-effort
      });
  }, [isOpen]);

  // Update suggestions when tag input changes
  useEffect(() => {
    if (!tags) {
      setTagSuggestions([]);
      return;
    }
    // Get the last tag segment being typed
    const parts = tags.split(",");
    const current = parts[parts.length - 1].trim().toLowerCase();
    if (!current) {
      setTagSuggestions([]);
      return;
    }
    // Already-entered tags
    const enteredTags = new Set(
      parts.slice(0, -1).map((t) => t.trim().toLowerCase())
    );
    const matches = existingTags.filter(
      (t) =>
        t.toLowerCase().includes(current) &&
        !enteredTags.has(t.toLowerCase())
    );
    setTagSuggestions(matches.slice(0, 6));
  }, [tags, existingTags]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately on open
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  function applySuggestion(tag: string) {
    const parts = tags.split(",");
    parts[parts.length - 1] = ` ${tag}`;
    setTags(parts.join(",") + ", ");
    setShowSuggestions(false);
    tagInputRef.current?.focus();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const params: SaveGoldAnswerParams = {
        question,
        answer,
        sessionId,
        messageId,
        wonVersion: wonVersion || undefined,
        customer: customer || undefined,
        tags: tags.trim() || undefined,
        verifiedBy: verifiedBy.trim() || undefined,
      };
      await saveGoldAnswer(params);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  const truncatedQuestion =
    question.length > 100 ? question.slice(0, 100) + "..." : question;
  const truncatedAnswer =
    answer.length > 200 ? answer.slice(0, 200) + "..." : answer;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg bg-gray-800 border border-gray-700 shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-700">
          <div className="flex items-center gap-2 text-amber-400">
            <Star className="w-4 h-4 fill-current" />
            <span className="font-medium text-sm">Save as Gold Answer</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Question preview */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Question
            </label>
            <div className="p-2.5 rounded bg-gray-900/60 border border-gray-700/50 text-sm text-gray-300 leading-relaxed">
              {truncatedQuestion}
            </div>
          </div>

          {/* Answer preview */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Answer
            </label>
            <div className="p-2.5 rounded bg-gray-900/60 border border-gray-700/50 text-sm text-gray-400 leading-relaxed max-h-32 overflow-y-auto">
              {truncatedAnswer}
            </div>
          </div>

          {/* Tags input with autocomplete */}
          <div className="relative">
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Tags (comma-separated)
            </label>
            <div className="flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <input
                ref={tagInputRef}
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="e.g. scheduling, psi, crash"
                className="flex-1 px-3 py-1.5 rounded bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            {/* Autocomplete dropdown */}
            {showSuggestions && tagSuggestions.length > 0 && (
              <div className="absolute z-10 left-6 right-0 mt-1 rounded bg-gray-900 border border-gray-700 shadow-lg max-h-36 overflow-y-auto">
                {tagSuggestions.map((t) => (
                  <button
                    key={t}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(t);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-emerald-400 transition"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Verified By */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
              Verified By (optional)
            </label>
            <input
              type="text"
              value={verifiedBy}
              onChange={(e) => setVerifiedBy(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-1.5 rounded bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3.5 py-1.5 rounded text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium bg-amber-600 text-white hover:bg-amber-500 transition disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Star className="w-3.5 h-3.5" />
            )}
            Save as Gold
          </button>
        </div>
      </div>
    </div>
  );
}
