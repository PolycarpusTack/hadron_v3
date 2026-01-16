/**
 * Console Viewer Component
 * Displays application logs in a developer-friendly panel
 * Toggle with Ctrl+Y
 */

import { useState, useEffect, useRef } from "react";
import { X, Trash2, Download, Filter, Terminal } from "lucide-react";
import logger, { LogEntry, LogLevel } from "../services/logger";

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

export default function ConsoleViewer({ isOpen, onClose }: ConsoleViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Subscribe to log updates
  useEffect(() => {
    const updateLogs = () => setLogs(logger.getLogs());
    updateLogs(); // Initial load
    const unsubscribe = logger.subscribe(updateLogs);
    return unsubscribe;
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (filter !== "all" && log.level !== filter) return false;
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        log.message.toLowerCase().includes(searchLower) ||
        JSON.stringify(log.meta || {}).toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  // Export logs as JSON
  const handleExport = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hadron-logs-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear logs
  const handleClear = () => {
    logger.clearLogs();
  };

  // Format timestamp for display
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return `${time}.${ms}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center">
      <div className="bg-gray-900 w-full h-[60vh] rounded-t-xl shadow-2xl flex flex-col border-t border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-green-400" />
            <h2 className="text-lg font-semibold text-white">Console</h2>
            <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
              {filteredLogs.length} / {logs.length} entries
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-green-500 w-48"
            />

            {/* Level filter */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as LogLevel | "all")}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>

            {/* Export button */}
            <button
              onClick={handleExport}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
              title="Export logs"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Clear button */}
            <button
              onClick={handleClear}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-red-400"
              title="Clear logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
              title="Close (Ctrl+Y)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Logs */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-1"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No logs to display</p>
                {filter !== "all" && (
                  <p className="text-xs mt-1">Try changing the filter</p>
                )}
              </div>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className={`flex gap-2 px-2 py-1 rounded ${LOG_LEVEL_BG[log.level]} hover:bg-gray-800/50`}
              >
                <span className="text-gray-500 flex-shrink-0 w-24">
                  {formatTime(log.timestamp)}
                </span>
                <span
                  className={`flex-shrink-0 w-14 uppercase font-semibold ${LOG_LEVEL_COLORS[log.level]}`}
                >
                  {log.level}
                </span>
                <span className="text-gray-200 flex-1 break-all">
                  {log.message}
                  {log.meta && Object.keys(log.meta).length > 0 && (
                    <span className="text-gray-500 ml-2">
                      {JSON.stringify(log.meta)}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/30 flex items-center justify-between text-xs text-gray-500">
          <span>Press Ctrl+Y to toggle console</span>
          <span>
            {autoScroll ? "Auto-scrolling enabled" : "Auto-scroll paused (scroll to bottom to resume)"}
          </span>
        </div>
      </div>
    </div>
  );
}
