/**
 * Console Viewer Component
 * Displays application logs in a developer-friendly panel
 * Toggle with Ctrl+Y
 *
 * Features:
 * - Filter by level, category, and source
 * - Search through logs
 * - Expandable metadata and stack traces
 * - Copy individual entries
 * - Export in multiple formats (JSON, Text, CSV)
 * - Pause/resume live updates
 * - Relative timestamps
 * - Keyboard shortcuts
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Trash2, Download, Filter, Terminal, Copy, Check,
  ChevronDown, ChevronRight, Pause, Play, Clock, BarChart3,
  AlertCircle, Info, Bug, AlertTriangle
} from "lucide-react";
import logger, { LogEntry, LogLevel, LogCategory } from "../services/logger";

interface ConsoleViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "text-gray-400",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

const LOG_LEVEL_BG: Record<LogLevel, string> = {
  debug: "bg-gray-500/10",
  info: "bg-blue-500/10",
  warn: "bg-yellow-500/10",
  error: "bg-red-500/10",
};

const LOG_LEVEL_ICONS: Record<LogLevel, typeof Info> = {
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const CATEGORY_COLORS: Record<LogCategory, string> = {
  api: "bg-purple-500/20 text-purple-400",
  ui: "bg-blue-500/20 text-blue-400",
  parser: "bg-green-500/20 text-green-400",
  db: "bg-orange-500/20 text-orange-400",
  export: "bg-cyan-500/20 text-cyan-400",
  perf: "bg-pink-500/20 text-pink-400",
  system: "bg-gray-500/20 text-gray-400",
  user: "bg-indigo-500/20 text-indigo-400",
  error: "bg-red-500/20 text-red-400",
};

// Format relative time
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  if (diff < 1000) return "now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// Format absolute timestamp
function formatAbsoluteTime(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${time}.${ms}`;
}

// Individual log entry component
function LogEntryRow({
  log,
  showRelativeTime,
  onCopy,
}: {
  log: LogEntry;
  showRelativeTime: boolean;
  onCopy: (text: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetails = log.meta || log.stack || log.correlationId;
  const Icon = LOG_LEVEL_ICONS[log.level];

  const handleCopy = () => {
    const text = [
      `[${log.timestamp}] ${log.level.toUpperCase()} ${log.message}`,
      log.source && `Source: ${log.source}`,
      log.category && `Category: ${log.category}`,
      log.correlationId && `Correlation ID: ${log.correlationId}`,
      log.duration && `Duration: ${log.duration}ms`,
      log.meta && `Meta: ${JSON.stringify(log.meta, null, 2)}`,
      log.stack && `Stack:\n${log.stack}`,
    ].filter(Boolean).join('\n');

    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`group rounded ${LOG_LEVEL_BG[log.level]} hover:bg-gray-800/50`}>
      <div className="flex items-start gap-2 px-2 py-1.5">
        {/* Expand button */}
        {hasDetails ? (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-300 mt-0.5 flex-shrink-0"
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Level icon */}
        <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${LOG_LEVEL_COLORS[log.level]}`} />

        {/* Timestamp */}
        <span className="text-gray-500 flex-shrink-0 w-20 text-xs" title={log.timestamp}>
          {showRelativeTime ? formatRelativeTime(log.timestamp) : formatAbsoluteTime(log.timestamp)}
        </span>

        {/* Level badge */}
        <span className={`flex-shrink-0 w-12 text-xs uppercase font-semibold ${LOG_LEVEL_COLORS[log.level]}`}>
          {log.level}
        </span>

        {/* Source */}
        {log.source && (
          <span className="flex-shrink-0 text-xs bg-gray-700/50 text-gray-300 px-1.5 py-0.5 rounded">
            {log.source}
          </span>
        )}

        {/* Category */}
        {log.category && (
          <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[log.category]}`}>
            {log.category}
          </span>
        )}

        {/* Duration */}
        {log.duration !== undefined && (
          <span className="flex-shrink-0 text-xs text-pink-400 font-mono">
            {log.duration}ms
          </span>
        )}

        {/* Message */}
        <span className="text-gray-200 flex-1 break-all text-xs">
          {log.message}
        </span>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300 flex-shrink-0 p-1 transition-opacity"
          title="Copy log entry"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* Expanded details */}
      {isExpanded && hasDetails && (
        <div className="px-8 py-2 border-t border-gray-700/50 space-y-2 text-xs">
          {log.correlationId && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-24">Correlation ID:</span>
              <span className="text-gray-300 font-mono">{log.correlationId}</span>
            </div>
          )}
          {log.meta && Object.keys(log.meta).length > 0 && (
            <div>
              <span className="text-gray-500">Metadata:</span>
              <pre className="mt-1 p-2 bg-gray-900/50 rounded text-gray-300 overflow-x-auto">
                {JSON.stringify(log.meta, null, 2)}
              </pre>
            </div>
          )}
          {log.stack && (
            <div>
              <span className="text-gray-500">Stack Trace:</span>
              <pre className="mt-1 p-2 bg-gray-900/50 rounded text-red-300/80 overflow-x-auto whitespace-pre-wrap">
                {log.stack}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConsoleViewer({ isOpen, onClose }: ConsoleViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<LogCategory | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [showRelativeTime, setShowRelativeTime] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'text' | 'csv'>('json');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to log updates
  useEffect(() => {
    const updateLogs = () => {
      if (!isPaused) {
        setLogs(logger.getLogs());
      }
    };
    updateLogs();
    const unsubscribe = logger.subscribe(updateLogs);
    return unsubscribe;
  }, [isPaused]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current && !isPaused) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, isPaused]);

  // Update relative times periodically
  useEffect(() => {
    if (!showRelativeTime) return;
    const interval = setInterval(() => {
      // Force re-render to update relative times
      setLogs(prev => [...prev]);
    }, 10000);
    return () => clearInterval(interval);
  }, [showRelativeTime]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Ctrl+F to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Ctrl+K to clear
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        handleClear();
        return;
      }

      // Space to toggle pause (when not in input)
      if (e.key === " " && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        togglePause();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // Get unique sources from logs
  const uniqueSources = [...new Set(logs.map(l => l.source).filter(Boolean))] as string[];
  const uniqueCategories = [...new Set(logs.map(l => l.category).filter(Boolean))] as LogCategory[];

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== "all" && log.level !== levelFilter) return false;
    if (categoryFilter !== "all" && log.category !== categoryFilter) return false;
    if (sourceFilter !== "all" && log.source !== sourceFilter) return false;
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.source?.toLowerCase().includes(searchLower) ||
        log.category?.toLowerCase().includes(searchLower) ||
        JSON.stringify(log.meta || {}).toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  // Toggle pause
  const togglePause = useCallback(() => {
    setIsPaused(prev => {
      const newValue = !prev;
      if (newValue) {
        logger.pause();
      } else {
        logger.resume();
        setLogs(logger.getLogs());
      }
      return newValue;
    });
  }, []);

  // Export logs
  const handleExport = () => {
    const data = logger.export(exportFormat);
    const mimeTypes = {
      json: 'application/json',
      text: 'text/plain',
      csv: 'text/csv',
    };
    const extensions = { json: 'json', text: 'txt', csv: 'csv' };

    const blob = new Blob([data], { type: mimeTypes[exportFormat] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hadron-logs-${new Date().toISOString().slice(0, 19)}.${extensions[exportFormat]}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy to clipboard
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  // Clear logs
  const handleClear = () => {
    logger.clearLogs();
  };

  // Get stats
  const stats = logger.getStats();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center">
      <div className="bg-gray-900 w-full h-[70vh] rounded-t-xl shadow-2xl flex flex-col border-t border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-green-400" />
            <h2 className="text-lg font-semibold text-white">Console</h2>
            <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
              {filteredLogs.length} / {logs.length} entries
            </span>
            {isPaused && (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded flex items-center gap-1">
                <Pause className="w-3 h-3" /> Paused
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search... (Ctrl+F)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-green-500 w-40"
            />

            {/* Level filter */}
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as LogLevel | "all")}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>

            {/* Category filter */}
            {uniqueCategories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as LogCategory | "all")}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
              >
                <option value="all">All Categories</option>
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}

            {/* Source filter */}
            {uniqueSources.length > 0 && (
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
              >
                <option value="all">All Sources</option>
                {uniqueSources.map(src => (
                  <option key={src} value={src}>{src}</option>
                ))}
              </select>
            )}

            {/* Time toggle */}
            <button
              onClick={() => setShowRelativeTime(!showRelativeTime)}
              className={`p-2 rounded-lg transition ${showRelativeTime ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              title={showRelativeTime ? "Show absolute time" : "Show relative time"}
            >
              <Clock className="w-4 h-4" />
            </button>

            {/* Stats toggle */}
            <button
              onClick={() => setShowStats(!showStats)}
              className={`p-2 rounded-lg transition ${showStats ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              title="Toggle statistics"
            >
              <BarChart3 className="w-4 h-4" />
            </button>

            {/* Pause/Resume button */}
            <button
              onClick={togglePause}
              className={`p-2 rounded-lg transition ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              title={isPaused ? "Resume (Space)" : "Pause (Space)"}
            >
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>

            {/* Export dropdown */}
            <div className="flex items-center gap-1">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'json' | 'text' | 'csv')}
                className="bg-gray-700 border border-gray-600 rounded-l px-2 py-1.5 text-sm text-white focus:outline-none"
              >
                <option value="json">JSON</option>
                <option value="text">Text</option>
                <option value="csv">CSV</option>
              </select>
              <button
                onClick={handleExport}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-r border border-l-0 border-gray-600 transition text-gray-400 hover:text-white"
                title="Export logs"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>

            {/* Clear button */}
            <button
              onClick={handleClear}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-red-400"
              title="Clear logs (Ctrl+K)"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
              title="Close (Esc or Ctrl+Y)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {showStats && (
          <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/30 flex items-center gap-6 text-xs">
            <div className="flex items-center gap-4">
              <span className="text-gray-500">By Level:</span>
              <span className="text-gray-400">Debug: {stats.byLevel.debug}</span>
              <span className="text-blue-400">Info: {stats.byLevel.info}</span>
              <span className="text-yellow-400">Warn: {stats.byLevel.warn}</span>
              <span className="text-red-400">Error: {stats.byLevel.error}</span>
            </div>
            {Object.keys(stats.byCategory).length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Categories:</span>
                {Object.entries(stats.byCategory).map(([cat, count]) => (
                  <span key={cat} className="text-gray-300">{cat}: {count}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Logs */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto font-mono p-2 space-y-0.5"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No logs to display</p>
                {(levelFilter !== "all" || categoryFilter !== "all" || sourceFilter !== "all" || searchTerm) && (
                  <p className="text-xs mt-1">Try adjusting the filters</p>
                )}
              </div>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <LogEntryRow
                key={log.id}
                log={log}
                showRelativeTime={showRelativeTime}
                onCopy={handleCopy}
              />
            ))
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/30 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span>Ctrl+Y toggle</span>
            <span>Esc close</span>
            <span>Ctrl+F search</span>
            <span>Ctrl+K clear</span>
            <span>Space pause</span>
          </div>
          <span>
            {autoScroll ? "Auto-scrolling" : "Scroll paused"} • Buffer: {logs.length}/{1000}
          </span>
        </div>
      </div>
    </div>
  );
}
