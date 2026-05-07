import { useState, useCallback, useEffect } from "react";
import { FileDown } from "lucide-react";
import { open } from "../../lib/tauri-dialog-shim";

interface WidgetDropZoneProps {
  onFileSelected: (filePath: string) => void;
  disabled: boolean;
}

const ACCEPTED_EXTENSIONS = new Set(["txt", "log", "dmp", "wcr"]);

function getExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export default function WidgetDropZone({ onFileSelected, disabled }: WidgetDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);

  // Auto-clear rejection message after 2 seconds
  useEffect(() => {
    if (!rejectMsg) return;
    const t = setTimeout(() => setRejectMsg(null), 2000);
    return () => clearTimeout(t);
  }, [rejectMsg]);

  const handleClick = useCallback(async () => {
    if (disabled) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Crash Logs", extensions: ["txt", "log", "dmp", "wcr"] }],
      });
      if (selected) {
        onFileSelected(typeof selected === "string" ? selected : selected[0]);
      }
    } catch {
      // Dialog cancelled or failed — silently ignore
    }
  }, [disabled, onFileSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = getExtension(file.name);
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      setRejectMsg(`Unsupported file type .${ext || "?"}`);
      return;
    }

    // Electron exposes the real filesystem path via the path property
    const filePath = (file as File & { path?: string }).path ?? file.name;
    onFileSelected(filePath);
  }, [disabled, onFileSelected]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      aria-label="Quick scan a log file"
      className={`mx-4 mb-3 w-[calc(100%-2rem)] border border-dashed rounded-lg px-3 py-2 text-center text-xs
        transition-colors select-none
        ${disabled
          ? "border-white/[0.06] text-gray-700 cursor-not-allowed"
          : rejectMsg
            ? "border-red-500/40 text-red-400 bg-red-500/5 cursor-pointer"
            : isDragging
              ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10 cursor-copy"
              : "border-white/[0.1] text-gray-500 hover:border-emerald-500/30 hover:text-emerald-400/70 hover:bg-emerald-500/5 cursor-pointer"
        }`}
    >
      <FileDown className="w-3.5 h-3.5 inline mr-1.5" />
      {disabled ? "Analyzing..." : rejectMsg ?? (isDragging ? "Drop to scan" : "Quick scan a log file")}
    </div>
  );
}
