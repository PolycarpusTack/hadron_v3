import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

interface StackFrame {
  index: number;
  method: string;
  class?: string;
  line?: string;
  raw: string;
}

interface StackTraceViewerProps {
  stackTrace: string;
  title?: string;
}

export default function StackTraceViewer({ stackTrace, title = "Stack Trace" }: StackTraceViewerProps) {
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set([0, 1, 2])); // Expand first 3
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Parse stack trace into frames
  const parseStackTrace = (trace: string): StackFrame[] => {
    const lines = trace.split("\n").filter((line) => line.trim());
    const frames: StackFrame[] = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      // Try to parse Smalltalk stack frame patterns
      // Common patterns:
      // 1. ClassName>>methodName
      // 2. Object>>methodName line:123
      // 3. methodName (ClassName)

      const classMethodMatch = trimmed.match(/^(.+?)>>(.+?)(?:\s+line:(\d+))?$/);
      if (classMethodMatch) {
        frames.push({
          index,
          class: classMethodMatch[1].trim(),
          method: classMethodMatch[2].trim(),
          line: classMethodMatch[3],
          raw: trimmed,
        });
        return;
      }

      // Try bracket notation: methodName (ClassName)
      const bracketMatch = trimmed.match(/^(.+?)\s+\((.+?)\)$/);
      if (bracketMatch) {
        frames.push({
          index,
          method: bracketMatch[1].trim(),
          class: bracketMatch[2].trim(),
          raw: trimmed,
        });
        return;
      }

      // Fallback: treat as simple method name
      frames.push({
        index,
        method: trimmed,
        raw: trimmed,
      });
    });

    return frames;
  };

  const frames = parseStackTrace(stackTrace);

  const toggleFrame = (index: number) => {
    const newExpanded = new Set(expandedFrames);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedFrames(newExpanded);
  };

  const expandAll = () => {
    setExpandedFrames(new Set(frames.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpandedFrames(new Set());
  };

  const copyFrame = (frame: StackFrame) => {
    navigator.clipboard.writeText(frame.raw);
    setCopiedIndex(frame.index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyAll = () => {
    navigator.clipboard.writeText(stackTrace);
    setCopiedIndex(-1);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">{title}</h3>
          <span className="text-sm text-gray-400">
            {frames.length} {frames.length === 1 ? "frame" : "frames"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition"
          >
            Collapse All
          </button>
          <button
            onClick={copyAll}
            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition flex items-center gap-2"
          >
            {copiedIndex === -1 ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy All
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stack Frames */}
      <div className="divide-y divide-gray-700">
        {frames.length === 0 ? (
          <div className="p-6 text-center text-gray-400">
            No stack trace available
          </div>
        ) : (
          frames.map((frame) => {
            const isExpanded = expandedFrames.has(frame.index);

            return (
              <div key={frame.index} className="hover:bg-gray-750 transition">
                {/* Frame Header */}
                <div className="flex items-center justify-between p-3">
                  <button
                    onClick={() => toggleFrame(frame.index)}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-blue-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}

                    <span className="text-gray-500 font-mono text-sm">#{frame.index}</span>

                    {frame.class && (
                      <span className="text-blue-400 font-mono">{frame.class}</span>
                    )}

                    {frame.class && frame.method && (
                      <span className="text-gray-500">&gt;&gt;</span>
                    )}

                    <span className="text-green-400 font-mono">{frame.method}</span>

                    {frame.line && (
                      <span className="text-gray-500 text-sm">
                        line:{frame.line}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => copyFrame(frame)}
                    className="p-1 hover:bg-gray-600 rounded transition"
                    title="Copy frame"
                  >
                    {copiedIndex === frame.index ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </div>

                {/* Frame Details (Expanded) */}
                {isExpanded && (
                  <div className="px-3 pb-3 pl-12">
                    <div className="bg-gray-900 rounded p-3 font-mono text-sm">
                      <code className="text-gray-300">{frame.raw}</code>
                    </div>

                    {frame.class && (
                      <div className="mt-2 text-sm text-gray-400">
                        <span className="font-semibold">Class:</span>{" "}
                        <span className="font-mono">{frame.class}</span>
                      </div>
                    )}

                    {frame.method && (
                      <div className="mt-1 text-sm text-gray-400">
                        <span className="font-semibold">Method:</span>{" "}
                        <span className="font-mono">{frame.method}</span>
                      </div>
                    )}

                    {frame.line && (
                      <div className="mt-1 text-sm text-gray-400">
                        <span className="font-semibold">Line:</span>{" "}
                        <span className="font-mono">{frame.line}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
