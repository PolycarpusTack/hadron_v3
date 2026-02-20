import { useEffect, useRef, useState, useCallback } from "react";
import { X, Zap } from "lucide-react";

interface ClipboardWatcherProps {
  onAnalyze: (content: string) => void;
  enabled: boolean;
}

// Patterns that suggest a stack trace or error was copied
const ERROR_PATTERNS = [
  /^\s*at\s+[\w.$]+\(/m,                    // Java/JS stack frame
  /Traceback \(most recent call last\)/,      // Python traceback
  /^\[?\d+\]\s+\w+>>/m,                      // Smalltalk stack frame
  /Exception|Error|FATAL|panic|Unhandled/i,   // Error keywords
  /^\s*(NullPointer|ClassCast|ArrayIndexOutOfBounds|IllegalArgument)/m,
];

function looksLikeError(text: string): boolean {
  if (text.length < 30 || text.length > 50000) return false;
  return ERROR_PATTERNS.some((p) => p.test(text));
}

const DISMISS_COOLDOWN_MS = 60_000;
const MAX_DISMISSED_ENTRIES = 100;

export default function ClipboardWatcher({ onAnalyze, enabled }: ClipboardWatcherProps) {
  const [detected, setDetected] = useState<string | null>(null);
  const lastClipRef = useRef("");
  const dismissedRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);

  const checkClipboard = useCallback(async () => {
    if (!enabled) return;
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const text = await readText();
      if (!text || text === lastClipRef.current) return;
      lastClipRef.current = text;

      // Skip if dismissed within cooldown period
      const hash = text.slice(0, 200);
      const dismissedAt = dismissedRef.current.get(hash);
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;
      if (dismissedAt) dismissedRef.current.delete(hash);

      if (looksLikeError(text) && mountedRef.current) {
        setDetected(text);
        // Auto-dismiss after 10 seconds
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setDetected(null), 10_000);
      }
    } catch {
      // Clipboard read can fail if empty or permission denied — ignore silently
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(checkClipboard, 2000);
    return () => clearInterval(interval);
  }, [enabled, checkClipboard]);

  // Cleanup timer and mounted flag on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleDismiss = () => {
    if (detected) {
      const hash = detected.slice(0, 200);
      dismissedRef.current.set(hash, Date.now());
      // Evict oldest entries when exceeding max size
      if (dismissedRef.current.size > MAX_DISMISSED_ENTRIES) {
        const [oldest] = dismissedRef.current.keys();
        dismissedRef.current.delete(oldest);
      }
    }
    setDetected(null);
  };

  const handleAnalyze = () => {
    if (detected) {
      onAnalyze(detected);
      setDetected(null);
    }
  };

  if (!detected) return null;

  const preview = detected.split("\n").slice(0, 3).join("\n");

  return (
    <div className="absolute bottom-full mb-2 right-0 w-[300px] rounded-xl overflow-hidden
                    border border-emerald-500/30 shadow-2xl animate-in slide-in-from-bottom-2"
         style={{ background: "rgba(6,13,27,0.97)", backdropFilter: "blur(12px)" }}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Error detected in clipboard
          </span>
          <button onClick={handleDismiss} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <pre className="text-[11px] text-gray-400 bg-white/[0.04] rounded-lg p-2 mb-3 overflow-hidden
                        max-h-[60px] font-mono leading-tight">
          {preview}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={handleAnalyze}
            className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg
                       bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
          >
            Analyze
          </button>
          <button
            onClick={handleDismiss}
            className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg
                       bg-white/[0.06] text-gray-400 hover:bg-white/10 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
