/**
 * Embedded Console Viewer Component
 * A lighter version of ConsoleViewer designed for embedding in Settings panel
 * Shows application logs with filtering and export capabilities
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Trash2, Download, Filter, Copy, Check,
  ChevronDown, ChevronRight, Pause, Play, Clock, BarChart3,
  AlertCircle, Info, Bug, AlertTriangle, Terminal
} from "lucide-react";
import logger, { LogEntry, LogLevel, LogCategory } from "../services/logger";

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
      <div className="flex items-start gap-2 px-2 py-1">
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

        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${LOG_LEVEL_COLORS[log.level]}`} />

        <span className="text-gray-500 flex-shrink-0 w-16 text-xs" title={log.timestamp}>
          {showRelativeTime ? formatRelativeTime(log.timestamp) : formatAbsoluteTime(log.timestamp)}
        </span>

        <span className={`flex-shrink-0 w-10 text-xs uppercase font-semibold ${LOG_LEVEL_COLORS[log.level]}`}>
          {log.level}
        </span>

        {log.source && (
          <span className="flex-shrink-0 text-xs bg-gray-700/50 text-gray-300 px-1 py-0.5 rounded">
            {log.source}
          </span>
        )}

        {log.category && (
          <span className={`flex-shrink-0 text-xs px-1 py-0.5 rounded ${CATEGORY_COLORS[log.category]}`}>
            {log.category}
          </span>
        )}

        {log.duration !== undefined && (
          <span className="flex-shrink-0 text-xs text-pink-400 font-mono">
            {log.duration}ms
          </span>
        )}

        <span className="text-gray-200 flex-1 break-all text-xs truncate">
          {log.message}
        </span>

        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300 flex-shrink-0 p-0.5 transition-opacity"
          title="Copy log entry"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {isExpanded && hasDetails && (
        <div className="px-6 py-2 border-t border-gray-700/50 space-y-2 text-xs">
          {log.correlationId && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20">Correlation:</span>
              <span className="text-gray-300 font-mono">{log.correlationId}</span>
            </div>
          )}
          {log.meta && Object.keys(log.meta).length > 0 && (
            <div>
              <span className="text-gray-500">Metadata:</span>
              <pre className="mt-1 p-2 bg-gray-900/50 rounded text-gray-300 overflow-x-auto text-xs">
                {JSON.stringify(log.meta, null, 2)}
              </pre>
            </div>
          )}
          {log.stack && (
            <div>
              <span className="text-gray-500">Stack Trace:</span>
              <pre className="mt-1 p-2 bg-gray-900/50 rounded text-red-300/80 overflow-x-auto whitespace-pre-wrap text-xs">
                {log.stack}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EmbeddedConsoleViewer({
  defaultAutoScroll = true,
  parentScrollRef,
}: {
  defaultAutoScroll?: boolean;
  parentScrollRef?: React.RefObject<HTMLElement>;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<LogCategory | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoScroll, setAutoScroll] = useState(defaultAutoScroll);
  const [isPaused, setIsPaused] = useState(false);
  const [showRelativeTime, setShowRelativeTime] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'text' | 'csv'>('json');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (autoScroll && containerRef.current && !isPaused) {
      // Keep scrolling within the log container only to avoid page jumps.
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, isPaused]);

  useEffect(() => {
    const parent = parentScrollRef?.current;
    if (!parent) return;
    const handleParentScroll = () => setAutoScroll(false);
    parent.addEventListener("scroll", handleParentScroll, { passive: true });
    return () => parent.removeEventListener("scroll", handleParentScroll);
  }, [parentScrollRef]);

  useEffect(() => {
    if (!showRelativeTime) return;
    const interval = setInterval(() => {
      setLogs(prev => [...prev]);
    }, 10000);
    return () => clearInterval(interval);
  }, [showRelativeTime]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const uniqueCategories = [...new Set(logs.map(l => l.category).filter(Boolean))] as LogCategory[];

  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== "all" && log.level !== levelFilter) return false;
    if (categoryFilter !== "all" && log.category !== categoryFilter) return false;
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

  const handleExport = () => {
    const data = logger.export(exportFormat);
    const mimeTypes = { json: 'application/json', text: 'text/plain', csv: 'text/csv' };
    const extensions = { json: 'json', text: 'txt', csv: 'csv' };

    const blob = new Blob([data], { type: mimeTypes[exportFormat] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hadron-logs-${new Date().toISOString().slice(0, 19)}.${extensions[exportFormat]}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const handleClear = () => {
    logger.clearLogs();
  };

  const stats = logger.getStats();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-green-400" />
          <h3 className="font-semibold text-white">Application Console</h3>
          <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
            {filteredLogs.length} / {logs.length}
          </span>
          {isPaused && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded flex items-center gap-1">
              <Pause className="w-3 h-3" /> Paused
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">Also available via Ctrl+Y</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-green-500 w-32"
        />

        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LogLevel | "all")}
          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          <option value="all">All Levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>

        {uniqueCategories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as LogCategory | "all")}
            className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none"
          >
            <option value="all">All Categories</option>
            {uniqueCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowRelativeTime(!showRelativeTime)}
          className={`p-1.5 rounded transition ${showRelativeTime ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          title={showRelativeTime ? "Show absolute time" : "Show relative time"}
        >
          <Clock className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowStats(!showStats)}
          className={`p-1.5 rounded transition ${showStats ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          title="Toggle statistics"
        >
          <BarChart3 className="w-4 h-4" />
        </button>

        <button
          onClick={togglePause}
          className={`p-1.5 rounded transition ${isPaused ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400 hover:text-white'}`}
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>

        <div className="flex items-center gap-1 ml-auto">
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'json' | 'text' | 'csv')}
            className="bg-gray-900 border border-gray-600 rounded-l px-2 py-1 text-sm text-white focus:outline-none"
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
            <option value="csv">CSV</option>
          </select>
          <button
            onClick={handleExport}
            className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-r border border-l-0 border-gray-600 transition text-gray-400 hover:text-white"
            title="Export logs"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleClear}
          className="p-1.5 hover:bg-gray-700 rounded transition text-gray-400 hover:text-red-400"
          title="Clear logs"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Stats bar */}
      {showStats && (
        <div className="p-2 bg-gray-900/50 rounded border border-gray-700 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Levels:</span>
            <span className="text-gray-400">D:{stats.byLevel.debug}</span>
            <span className="text-blue-400">I:{stats.byLevel.info}</span>
            <span className="text-yellow-400">W:{stats.byLevel.warn}</span>
            <span className="text-red-400">E:{stats.byLevel.error}</span>
          </div>
          {Object.keys(stats.byCategory).length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Categories:</span>
              {Object.entries(stats.byCategory).slice(0, 4).map(([cat, count]) => (
                <span key={cat} className="text-gray-300">{cat}:{count}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Logs container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-80 overflow-y-auto font-mono bg-gray-900/50 rounded border border-gray-700 p-2 space-y-0.5"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Filter className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No logs to display</p>
              {(levelFilter !== "all" || categoryFilter !== "all" || searchTerm) && (
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
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Buffer: {logs.length}/1000</span>
        <span>{autoScroll ? "Auto-scrolling" : "Scroll paused"}</span>
      </div>
    </div>
  );
}
