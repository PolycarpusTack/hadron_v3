import { useState } from "react";

export function OptimizedTab({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!code) {
    return (
      <div className="py-12 text-center text-slate-400">
        No improvements suggested — the code looks good.
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
