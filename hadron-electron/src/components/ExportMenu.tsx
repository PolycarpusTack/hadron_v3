/**
 * ExportMenu — Reusable dropdown menu for export actions
 *
 * Two modes via union type:
 * - Session mode: export full conversation as Markdown, Text, or HTML
 * - Message mode: copy single message formatted, plain, or as quote
 *
 * Uses Tauri save dialog for file exports and clipboard API for copy.
 */

import { useState, useEffect, useRef } from "react";
import {
  Download,
  Copy,
  FileText,
  FileCode,
  Globe,
  Quote,
  Check,
  ChevronDown,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../services/chat";

// ============================================================================
// Types
// ============================================================================

interface SessionModeProps {
  mode: "session";
  messages: ChatMessage[];
  sessionTitle: string;
}

interface MessageModeProps {
  mode: "message";
  content: string;
  timestamp: number;
}

type ExportMenuProps = SessionModeProps | MessageModeProps;

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function formatTimestampFull(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

/**
 * Build a full markdown transcript from a message list.
 */
function buildMarkdownTranscript(
  messages: ChatMessage[],
  title: string
): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    const role = msg.role === "user" ? "User" : "Ask Hadron";
    const time = formatTimestampFull(msg.timestamp);
    lines.push(`## ${role} — ${time}`, "", msg.content, "");
  }
  return lines.join("\n");
}

/**
 * Build a plain text transcript.
 */
function buildTextTranscript(messages: ChatMessage[], title: string): string {
  const lines: string[] = [title, "=".repeat(title.length), ""];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    const role = msg.role === "user" ? "User" : "Ask Hadron";
    const time = formatTimestampFull(msg.timestamp);
    lines.push(`[${role}] ${time}`, "-".repeat(40), msg.content, "");
  }
  return lines.join("\n");
}

/**
 * Build a self-contained interactive HTML page with dark theme.
 */
function buildHtmlTranscript(messages: ChatMessage[], title: string): string {
  const escaped = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const messageBlocks = messages
    .filter((m) => m.role !== "system")
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Ask Hadron";
      const time = formatTimestampFull(msg.timestamp);
      const bgColor = msg.role === "user" ? "#1e293b" : "#111827";
      const borderColor = msg.role === "user" ? "#334155" : "#1f2937";
      const roleColor = msg.role === "user" ? "#60a5fa" : "#34d399";
      return `
    <div class="message" style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:12px 16px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="this.parentElement.querySelector('.content').classList.toggle('collapsed')">
        <span style="color:${roleColor};font-weight:600;font-size:13px;">${escaped(role)}</span>
        <span style="color:#6b7280;font-size:11px;">${escaped(time)}</span>
      </div>
      <div class="content" style="margin-top:8px;color:#d1d5db;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escaped(msg.content)}</div>
    </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaped(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 18px; color: #f1f5f9; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  .content.collapsed { display: none; }
</style>
</head>
<body>
<h1>${escaped(title)}</h1>
<div class="subtitle">Exported from Ask Hadron &middot; ${escaped(formatTimestampFull(Date.now()))}</div>
${messageBlocks}
</body>
</html>`;
}

// ============================================================================
// Component
// ============================================================================

export default function ExportMenu(props: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Auto-clear status
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  function showSuccess(msg: string) {
    setStatus(msg);
    setIsOpen(false);
  }

  // ----------------------------
  // Session-level actions
  // ----------------------------

  async function exportMarkdown() {
    if (props.mode !== "session") return;
    try {
      const content = buildMarkdownTranscript(
        props.messages,
        props.sessionTitle
      );
      const filePath = await save({
        defaultPath: "chat-export.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await invoke("write_export_text", { path: filePath, content });
        showSuccess("Exported as Markdown");
      }
    } catch {
      setStatus("Export failed");
    }
  }

  async function exportText() {
    if (props.mode !== "session") return;
    try {
      const content = buildTextTranscript(props.messages, props.sessionTitle);
      const filePath = await save({
        defaultPath: "chat-export.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (filePath) {
        await invoke("write_export_text", { path: filePath, content });
        showSuccess("Exported as Text");
      }
    } catch {
      setStatus("Export failed");
    }
  }

  async function exportHtml() {
    if (props.mode !== "session") return;
    try {
      const content = buildHtmlTranscript(props.messages, props.sessionTitle);
      const filePath = await save({
        defaultPath: "chat-export.html",
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (filePath) {
        await invoke("write_export_text", { path: filePath, content });
        showSuccess("Exported as HTML");
      }
    } catch {
      setStatus("Export failed");
    }
  }

  // ----------------------------
  // Message-level actions
  // ----------------------------

  async function copyFormatted() {
    if (props.mode !== "message") return;
    try {
      await navigator.clipboard.writeText(props.content);
      showSuccess("Copied");
    } catch {
      setStatus("Copy failed");
    }
  }

  async function copyPlainText() {
    if (props.mode !== "message") return;
    try {
      // Strip markdown formatting for plain text
      const plain = props.content
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").trim())
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
        .replace(/^#{1,6}\s+/gm, "");
      await navigator.clipboard.writeText(plain);
      showSuccess("Copied plain text");
    } catch {
      setStatus("Copy failed");
    }
  }

  async function copyAsQuote() {
    if (props.mode !== "message") return;
    try {
      const date = formatTimestamp(props.timestamp);
      const truncated =
        props.content.length > 200
          ? props.content.slice(0, 200) + "..."
          : props.content;
      const quote = `> [Ask Hadron, ${date}] ${truncated}`;
      await navigator.clipboard.writeText(quote);
      showSuccess("Copied as quote");
    } catch {
      setStatus("Copy failed");
    }
  }

  // ----------------------------
  // Render
  // ----------------------------

  const sessionMode = props.mode === "session";

  return (
    <div ref={menuRef} className="relative inline-block">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition"
        title={sessionMode ? "Export session" : "Copy message"}
      >
        {status ? (
          <>
            <Check className="w-3 h-3 text-emerald-400" />
            <span className="text-emerald-400">{status}</span>
          </>
        ) : (
          <>
            <Download className="w-3 h-3" />
            <ChevronDown className="w-2.5 h-2.5" />
          </>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg bg-gray-800 border border-gray-700 shadow-xl py-1">
          {sessionMode ? (
            <>
              <MenuButton
                icon={FileText}
                label="Export as Markdown"
                onClick={exportMarkdown}
              />
              <MenuButton
                icon={FileCode}
                label="Export as Text"
                onClick={exportText}
              />
              <MenuButton
                icon={Globe}
                label="Export as HTML"
                onClick={exportHtml}
              />
            </>
          ) : (
            <>
              <MenuButton
                icon={Copy}
                label="Copy Formatted"
                onClick={copyFormatted}
              />
              <MenuButton
                icon={FileText}
                label="Copy Plain Text"
                onClick={copyPlainText}
              />
              <MenuButton
                icon={Quote}
                label="Copy as Quote"
                onClick={copyAsQuote}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MenuButton sub-component
// ============================================================================

function MenuButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition text-left"
    >
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      {label}
    </button>
  );
}
