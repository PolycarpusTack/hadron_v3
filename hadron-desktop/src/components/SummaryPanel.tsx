/**
 * SummaryPanel — Session Summary slide-over panel
 *
 * Generates, edits, and exports AI session summaries.
 * Supports markdown editing with live preview, clipboard copy,
 * file export (.txt/.md), JIRA comment posting, and DB persistence.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Sparkles,
  Save,
  Copy,
  FileText,
  FileDown,
  ExternalLink,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  generateSessionSummary,
  saveSessionSummary,
  getSessionSummary,
  markdownToPlainText,
  type SessionSummary,
} from "../services/summaries";
import { postJiraComment } from "../services/chat";
import { getStoredProvider, getStoredModel } from "../services/api";
import { getApiKey } from "../services/secure-storage";
import { getJiraConfig } from "../services/jira";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import Button from "./ui/Button";

// ============================================================================
// Types
// ============================================================================

interface SummaryPanelProps {
  sessionId: string;
  onClose: () => void;
  isOpen: boolean;
}

// ============================================================================
// Component
// ============================================================================

export default function SummaryPanel({
  sessionId,
  onClose,
  isOpen,
}: SummaryPanelProps) {
  const [markdown, setMarkdown] = useState("");
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // JIRA state
  const [showJiraPrompt, setShowJiraPrompt] = useState(false);
  const [jiraIssueKey, setJiraIssueKey] = useState("");
  const [jiraPosting, setJiraPosting] = useState(false);

  // Load existing summary if one exists
  useEffect(() => {
    if (!isOpen || !sessionId) return;
    setError(null);
    setSuccessMsg(null);
    getSessionSummary(sessionId)
      .then((existing: SessionSummary | null) => {
        if (existing) {
          setMarkdown(existing.summaryMarkdown);
          setTopic(existing.topic || "");
          setIsLoaded(true);
        } else {
          setMarkdown("");
          setTopic("");
          setIsLoaded(false);
        }
      })
      .catch(() => {
        // Fresh summary
        setIsLoaded(false);
      });
  }, [isOpen, sessionId]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const clearMessages = useCallback(() => {
    setError(null);
    setSuccessMsg(null);
  }, []);

  // Auto-clear success message after 3s
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  async function handleGenerate() {
    clearMessages();
    setIsGenerating(true);
    try {
      const provider = getStoredProvider();
      const model = getStoredModel();
      const apiKey = (await getApiKey(provider)) || "";
      const result = await generateSessionSummary({
        sessionId,
        provider,
        model,
        apiKey,
      });
      setMarkdown(result);
      // Try to extract topic from first heading
      const headingMatch = result.match(/^#\s+(.+)$/m);
      if (headingMatch && !topic) {
        setTopic(headingMatch[1]);
      }
    } catch (e) {
      setError(`Failed to generate summary: ${String(e)}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave() {
    if (!markdown.trim()) return;
    clearMessages();
    setIsSaving(true);
    try {
      await saveSessionSummary({
        sessionId,
        summaryMarkdown: markdown,
        topic: topic || "Untitled Summary",
      });
      setIsLoaded(true);
      setSuccessMsg("Summary saved");
    } catch (e) {
      setError(`Failed to save: ${String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyPlainText() {
    try {
      const plain = markdownToPlainText(markdown);
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  }

  async function handleExportFile(format: "txt" | "md") {
    clearMessages();
    try {
      const content =
        format === "txt" ? markdownToPlainText(markdown) : markdown;
      const ext = format === "txt" ? "txt" : "md";
      const filePath = await save({
        defaultPath: `session-summary.${ext}`,
        filters: [
          {
            name: format === "txt" ? "Text files" : "Markdown files",
            extensions: [ext],
          },
        ],
      });
      if (filePath) {
        await writeTextFile(filePath, content);
        setSuccessMsg(`Exported as .${ext}`);
      }
    } catch (e) {
      setError(`Export failed: ${String(e)}`);
    }
  }

  async function handlePostToJira() {
    if (!jiraIssueKey.trim()) return;
    clearMessages();
    setJiraPosting(true);
    try {
      const jiraConfig = await getJiraConfig();
      if (!jiraConfig.enabled || !jiraConfig.baseUrl) {
        throw new Error("JIRA is not configured. Please set up JIRA in Settings.");
      }
      const jiraToken = await getApiKey("jira");
      if (!jiraToken) {
        throw new Error("JIRA API token not found. Please configure in Settings.");
      }
      const commentBody = `*Session Summary*\n\n${markdown}`;
      await postJiraComment(
        jiraConfig.baseUrl,
        jiraConfig.email,
        jiraToken,
        jiraIssueKey.trim(),
        commentBody
      );
      setSuccessMsg(`Posted to ${jiraIssueKey.trim()}`);
      setShowJiraPrompt(false);
      setJiraIssueKey("");
    } catch (e) {
      setError(`JIRA post failed: ${String(e)}`);
    } finally {
      setJiraPosting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-full max-w-4xl h-full bg-gray-800 border-l border-gray-700 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="font-medium text-sm text-gray-200">
              Session Summary
            </span>
            {isLoaded && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/30">
                saved
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Topic field */}
        <div className="px-5 py-3 border-b border-gray-700/50 flex-shrink-0">
          <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
            Topic
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Summary topic (auto-extracted or custom)"
            className="w-full px-3 py-1.5 rounded bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        {/* Main content: editor + preview */}
        <div className="flex-1 min-h-0 flex">
          {/* Editor column */}
          <div className="w-1/2 flex flex-col border-r border-gray-700/50">
            <div className="px-4 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-700/30">
              Markdown
            </div>
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={
                isGenerating
                  ? "Generating summary..."
                  : "Click 'Generate Summary' or write markdown here..."
              }
              disabled={isGenerating}
              className="flex-1 px-4 py-3 bg-transparent text-sm text-gray-300 placeholder-gray-600 resize-none focus:outline-none font-mono leading-relaxed disabled:opacity-50"
            />
          </div>

          {/* Preview column */}
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-700/30">
              Preview
            </div>
            <div className="flex-1 px-4 py-3 overflow-y-auto text-sm text-gray-300 prose prose-invert prose-sm max-w-none">
              {markdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown}
                </ReactMarkdown>
              ) : (
                <p className="text-gray-600 italic">
                  Nothing to preview yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* JIRA prompt inline */}
        {showJiraPrompt && (
          <div className="px-5 py-3 border-t border-gray-700/50 bg-gray-900/40 flex items-center gap-2 flex-shrink-0">
            <input
              type="text"
              value={jiraIssueKey}
              onChange={(e) => setJiraIssueKey(e.target.value)}
              placeholder="JIRA issue key (e.g. PROJ-123)"
              className="flex-1 px-3 py-1.5 rounded bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePostToJira();
                if (e.key === "Escape") setShowJiraPrompt(false);
              }}
              autoFocus
            />
            <Button
              onClick={handlePostToJira}
              disabled={!jiraIssueKey.trim()}
              loading={jiraPosting}
              variant="primary"
              size="sm"
            >
              Post
            </Button>
            <Button
              onClick={() => setShowJiraPrompt(false)}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Messages */}
        {(error || successMsg) && (
          <div className="px-5 py-2 flex-shrink-0">
            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-1.5">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded px-3 py-1.5">
                {successMsg}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700 flex-shrink-0">
          {/* Left: Generate */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            loading={isGenerating}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-500"
          >
            Generate Summary
          </Button>

          {/* Right: Export + Save */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleCopyPlainText}
              disabled={!markdown}
              title="Copy Plain Text"
              variant="ghost"
              size="xs"
              icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              className="disabled:opacity-30"
            >
              Copy
            </Button>
            <Button
              onClick={() => handleExportFile("txt")}
              disabled={!markdown}
              title="Export .txt"
              variant="ghost"
              size="xs"
              icon={<FileText className="w-3.5 h-3.5" />}
              className="disabled:opacity-30"
            >
              .txt
            </Button>
            <Button
              onClick={() => handleExportFile("md")}
              disabled={!markdown}
              title="Export .md"
              variant="ghost"
              size="xs"
              icon={<FileDown className="w-3.5 h-3.5" />}
              className="disabled:opacity-30"
            >
              .md
            </Button>
            <Button
              onClick={() => setShowJiraPrompt(true)}
              disabled={!markdown}
              title="Post to JIRA"
              variant="ghost"
              size="xs"
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              className="disabled:opacity-30"
            >
              JIRA
            </Button>

            <div className="w-px h-5 bg-gray-700 mx-1" />

            <Button
              onClick={handleSave}
              disabled={!markdown.trim()}
              loading={isSaving}
              icon={<Save className="w-3.5 h-3.5" />}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500"
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
