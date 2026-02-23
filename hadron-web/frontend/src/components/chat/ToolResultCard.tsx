interface ToolResultCardProps {
  toolName: string;
  content: string;
}

export function ToolResultCard({ toolName, content }: ToolResultCardProps) {
  let parsed: unknown[] | null = null;
  try {
    const data = JSON.parse(content);
    parsed = Array.isArray(data) ? data : [data];
  } catch {
    // Not JSON — show as raw text
  }

  return (
    <div className="rounded-md border border-slate-600 bg-slate-800 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-blue-600/20 px-1.5 py-0.5 text-xs text-blue-400">
          Tool
        </span>
        <span className="text-xs font-medium text-slate-400">{toolName}</span>
      </div>
      {parsed ? (
        <div className="space-y-1">
          {parsed.map((item, i) => {
            const obj = item as Record<string, unknown>;
            return (
              <div
                key={i}
                className="rounded bg-slate-900 px-2 py-1.5 text-xs text-slate-300"
              >
                {obj.filename != null && (
                  <div className="font-medium text-slate-200">
                    {String(obj.filename)}
                  </div>
                )}
                {obj.error_type != null && (
                  <span className="mr-2 text-red-400">
                    {String(obj.error_type)}
                  </span>
                )}
                {obj.severity != null && (
                  <span className="text-yellow-400">
                    {String(obj.severity)}
                  </span>
                )}
                {obj.root_cause != null && (
                  <div className="mt-0.5 text-slate-400">
                    {String(obj.root_cause).slice(0, 150)}
                    {String(obj.root_cause).length > 150 ? "..." : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-400">
          {content}
        </pre>
      )}
    </div>
  );
}
