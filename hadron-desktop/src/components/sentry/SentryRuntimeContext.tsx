/**
 * Sentry Runtime Context
 * Displays OS, browser, device, and runtime environment information
 */

import { Monitor, Globe, Cpu, Server } from "lucide-react";

interface SentryRuntimeContextProps {
  contexts?: Record<string, unknown>;
  tags?: Array<{ key: string; value: string }>;
}

export default function SentryRuntimeContext({
  contexts,
  tags,
}: SentryRuntimeContextProps) {
  const contextObj = contexts && typeof contexts === "object" ? contexts : {};

  const renderContextSection = (
    name: string,
    data: Record<string, unknown>,
    icon: React.ReactNode,
    color: string
  ) => {
    const entries = Object.entries(data).filter(
      ([k]) => k !== "type" && k !== "Type"
    );
    if (entries.length === 0) return null;

    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className={color}>{icon}</div>
          <h4 className="text-sm font-semibold text-gray-300 capitalize">{name}</h4>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {entries.map(([key, value]) => (
            <div key={key}>
              <span className="text-gray-500">{key}: </span>
              <span className="text-gray-300">{String(value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const getContextIcon = (name: string) => {
    switch (name) {
      case "os":
        return { icon: <Monitor className="w-4 h-4" />, color: "text-blue-400" };
      case "browser":
        return { icon: <Globe className="w-4 h-4" />, color: "text-green-400" };
      case "device":
        return { icon: <Cpu className="w-4 h-4" />, color: "text-purple-400" };
      case "runtime":
        return { icon: <Server className="w-4 h-4" />, color: "text-orange-400" };
      default:
        return { icon: <Server className="w-4 h-4" />, color: "text-gray-400" };
    }
  };

  const relevantContexts = ["os", "browser", "runtime", "device"];
  const contextEntries = relevantContexts
    .filter((name) => contextObj[name] && typeof contextObj[name] === "object")
    .map((name) => ({
      name,
      data: contextObj[name] as Record<string, unknown>,
      ...getContextIcon(name),
    }));

  // Filter useful tags (exclude internal sentry tags)
  const displayTags = (tags || []).filter(
    (t) =>
      !t.key.startsWith("sentry:") &&
      t.key !== "handled" &&
      t.key !== "mechanism"
  );

  const hasContent = contextEntries.length > 0 || displayTags.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Server className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <p>No runtime context available</p>
        <p className="text-xs mt-1">
          Runtime context includes OS, browser, device, and environment details
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Runtime Contexts */}
      {contextEntries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {contextEntries.map(({ name, data, icon, color }) =>
            renderContextSection(name, data, icon, color)
          )}
        </div>
      )}

      {/* Tags */}
      {displayTags.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Tags</h4>
          <div className="flex flex-wrap gap-2">
            {displayTags.map((tag, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-700/50 border border-gray-600 rounded-lg text-xs"
              >
                <span className="text-gray-400">{tag.key}:</span>
                <span className="text-gray-200 font-mono">{tag.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
