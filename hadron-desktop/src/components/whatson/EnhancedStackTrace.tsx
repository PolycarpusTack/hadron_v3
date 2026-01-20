import { Layers, AlertCircle, Code, Box, Library } from "lucide-react";
import type { StackTraceAnalysis } from "../../types";
import { getFrameTypeColor } from "../../utils/whatsOnParser";

interface EnhancedStackTraceProps {
  stackTrace?: StackTraceAnalysis;
  rawStackTrace?: string;
}

export default function EnhancedStackTrace({ stackTrace, rawStackTrace }: EnhancedStackTraceProps) {
  const getFrameIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "error":
        return <AlertCircle className="w-4 h-4" />;
      case "application":
        return <Code className="w-4 h-4" />;
      case "framework":
        return <Box className="w-4 h-4" />;
      case "library":
        return <Library className="w-4 h-4" />;
      default:
        return <Code className="w-4 h-4" />;
    }
  };

  // If we have structured stack trace data
  if (stackTrace && stackTrace.frames && stackTrace.frames.length > 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-semibold">Stack Trace</h3>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-400">{stackTrace.totalFrames} frames</span>
            {stackTrace.errorFrame && (
              <code className="px-2 py-1 bg-red-500/20 text-red-400 rounded">
                {stackTrace.errorFrame}
              </code>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-700 flex items-center gap-4 text-xs">
          <span className="text-gray-400">Frame types:</span>
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle className="w-3 h-3" /> Error
          </span>
          <span className="flex items-center gap-1 text-blue-400">
            <Code className="w-3 h-3" /> Application
          </span>
          <span className="flex items-center gap-1 text-purple-400">
            <Box className="w-3 h-3" /> Framework
          </span>
          <span className="flex items-center gap-1 text-gray-400">
            <Library className="w-3 h-3" /> Library
          </span>
        </div>

        <div className="p-4 space-y-1 max-h-[600px] overflow-y-auto">
          {stackTrace.frames.map((frame, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 p-2 rounded border-l-4 ${getFrameTypeColor(frame.type)} ${
                frame.isErrorOrigin ? "ring-1 ring-red-500/50" : ""
              }`}
            >
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-500 w-6 text-right">{frame.index}</span>
                <div
                  className={`${
                    frame.type === "error"
                      ? "text-red-400"
                      : frame.type === "application"
                      ? "text-blue-400"
                      : frame.type === "framework"
                      ? "text-purple-400"
                      : "text-gray-400"
                  }`}
                >
                  {getFrameIcon(frame.type)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <code className="text-sm font-mono text-gray-200 break-all">{frame.method}</code>
                {frame.context && (
                  <p className="text-xs text-gray-500 mt-1">{frame.context}</p>
                )}
              </div>
              {frame.isErrorOrigin && (
                <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs font-semibold rounded shrink-0">
                  ERROR ORIGIN
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback to raw stack trace
  if (rawStackTrace) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <Layers className="w-5 h-5 text-indigo-400" />
          <h3 className="text-lg font-semibold">Stack Trace</h3>
        </div>
        <div className="p-4">
          <pre className="p-4 bg-gray-900 rounded-lg text-sm font-mono text-gray-300 overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre-wrap">
            {rawStackTrace}
          </pre>
        </div>
      </div>
    );
  }

  // No stack trace available
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-4">
        <Layers className="w-5 h-5 text-indigo-400" />
        <h3 className="text-lg font-semibold">Stack Trace</h3>
      </div>
      <div className="text-center py-8 text-gray-400">
        <Layers className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No stack trace information available</p>
      </div>
    </div>
  );
}
