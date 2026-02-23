import { useCallback, useRef, useState } from "react";

interface FileUploadZoneProps {
  onFileSelected: (file: File) => void;
  onContentPasted: (content: string, filename: string) => void;
  disabled?: boolean;
}

export function FileUploadZone({
  onFileSelected,
  onContentPasted,
  disabled,
}: FileUploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) onFileSelected(file);
    },
    [disabled, onFileSelected],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelected(file);
    },
    [onFileSelected],
  );

  const handlePasteSubmit = useCallback(() => {
    if (pasteContent.trim()) {
      onContentPasted(pasteContent, "pasted_content.txt");
      setPasteContent("");
      setPasteMode(false);
    }
  }, [pasteContent, onContentPasted]);

  if (pasteMode) {
    return (
      <div className="rounded-lg border border-slate-600 bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-300">
            Paste crash log content
          </span>
          <button
            onClick={() => setPasteMode(false)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
        <textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          placeholder="Paste crash log content here..."
          className="mb-3 h-48 w-full rounded-md border border-slate-600 bg-slate-900 p-3 font-mono text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          disabled={disabled}
        />
        <button
          onClick={handlePasteSubmit}
          disabled={disabled || !pasteContent.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          Analyze
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
        isDragOver
          ? "border-blue-500 bg-blue-500/10"
          : "border-slate-600 bg-slate-800/50 hover:border-slate-500"
      } ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      onClick={() => !disabled && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileInput}
        className="hidden"
        accept=".txt,.log,.wcr,.crash,.stacktrace"
      />
      <div className="mb-3 text-4xl text-slate-500">
        {isDragOver ? "\u{1F4E5}" : "\u{1F4C4}"}
      </div>
      <p className="mb-1 text-sm font-medium text-slate-300">
        Drop a crash log file here or click to browse
      </p>
      <p className="text-xs text-slate-500">
        Supports .txt, .log, .wcr, .crash files (max 10 MB)
      </p>
      <div className="mt-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPasteMode(true);
          }}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          Or paste content directly
        </button>
      </div>
    </div>
  );
}
