import { useState, useRef } from 'react';

interface Props {
  onAnalyze: (content: string, filename: string) => void;
  loading: boolean;
}

export function PerformanceFileUpload({ onAnalyze, loading }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFileError(null);
    if (!file) { setSelectedFile(null); return; }
    if (file.size > MAX_SIZE) {
      setFileError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 10 MB.`);
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setSelectedFile(file);
  }

  function handleAnalyze() {
    if (!selectedFile || loading) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      onAnalyze(content, selectedFile.name);
    };
    reader.readAsText(selectedFile);
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 flex flex-col gap-4">
      <p className="text-slate-400 text-sm">
        Upload a performance trace log (.log or .txt) to analyze CPU hotspots, GC pressure, and method distribution.
      </p>

      <div className="flex flex-col gap-2">
        <label className="text-slate-300 text-sm font-medium">Select trace file</label>
        <input
          ref={inputRef}
          type="file"
          accept=".log,.txt"
          onChange={handleFileChange}
          disabled={loading}
          className="block w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-teal-700 file:text-white hover:file:bg-teal-600 disabled:opacity-50 cursor-pointer"
        />
      </div>

      {fileError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded px-3 py-2 text-sm">
          {fileError}
        </div>
      )}

      {selectedFile && !fileError && (
        <div className="bg-slate-700/50 rounded px-3 py-2 text-sm text-slate-300 flex items-center gap-2">
          <span className="text-teal-400">&#128196;</span>
          <span className="font-medium truncate">{selectedFile.name}</span>
          <span className="text-slate-500 ml-auto whitespace-nowrap">
            {(selectedFile.size / 1024).toFixed(1)} KB
          </span>
        </div>
      )}

      <button
        onClick={handleAnalyze}
        disabled={!selectedFile || !!fileError || loading}
        className="self-start px-5 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors flex items-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Analyzing…
          </>
        ) : (
          'Analyze'
        )}
      </button>
    </div>
  );
}
