import { useState, useRef } from "react";
import { Check, Copy } from "lucide-react";

export default function OptimizedTab({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyCode = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!code) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No optimized code available for this analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Optimized Code */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
          <span className="text-gray-300 text-sm font-mono">optimized_code</span>
          <button
            onClick={copyCode}
            className="text-gray-400 hover:text-white flex items-center gap-1 text-sm"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? " Copied!" : " Copy"}
          </button>
        </div>
        <pre className="p-4 text-sm text-green-400 font-mono overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>
    </div>
  );
}
