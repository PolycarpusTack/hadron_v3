import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, AlertTriangle } from "lucide-react";
import { CURATED_MODELS } from "../../constants/providers";

export interface ModelOption {
  id: string;
  label: string;
  context?: number;
  suitableForHadron?: boolean;
  category?: string;
}

interface ModelPickerProps {
  provider: string;
  value: string;
  models: ModelOption[];
  onChange: (modelId: string) => void;
  className?: string;
}

function formatCtx(tokens: number): string {
  if (!tokens) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

export default function ModelPicker({ provider, value, models, onChange, className = "" }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Merge curated data into the passed models list. Caller's values take precedence via ??.
  const curated = CURATED_MODELS[provider] ?? [];
  const enriched: ModelOption[] = models.map((m) => {
    const entry = curated.find((entry) => entry.id === m.id);
    return {
      ...m,
      suitableForHadron: m.suitableForHadron ?? entry?.suitableForHadron,
      context: m.context ?? entry?.context,
    };
  });

  // Mutually exclusive groups — order: local → recommended → mayTruncate
  const local = enriched.filter((m) => (!m.context || m.context === 0) && m.suitableForHadron !== true);
  const recommended = enriched.filter((m) => m.suitableForHadron === true);
  const mayTruncate = enriched.filter((m) => m.suitableForHadron !== true && m.context && m.context > 0);

  const selected = enriched.find((m) => m.id === value);

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-left"
        style={{ background: "var(--hd-bg)", border: "1px solid var(--hd-border)", color: "var(--hd-text)" }}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--hd-text-muted)" }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Model options"
          className="absolute z-50 mt-1 w-full rounded-lg shadow-xl overflow-y-auto max-h-72"
          style={{ background: "var(--hd-bg-raised)", border: "1px solid var(--hd-border)" }}
        >
          {recommended.length > 0 && (
            <>
              <div className="px-3 py-1.5" style={{ background: "rgba(0,0,0,0.3)", borderBottom: "1px solid var(--hd-border-subtle)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--hd-accent)" }}>
                  Recommended for Hadron
                </span>
              </div>
              {recommended.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={(id) => { onChange(id); setOpen(false); }} />
              ))}
            </>
          )}
          {mayTruncate.length > 0 && (
            <>
              <div
                className="px-3 py-1.5 flex items-center gap-1.5"
                style={{ background: "rgba(239,68,68,0.06)", borderTop: "1px solid var(--hd-border-subtle)", borderBottom: "1px solid var(--hd-border-subtle)" }}
              >
                <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
                  May truncate your logs
                </span>
              </div>
              {mayTruncate.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={(id) => { onChange(id); setOpen(false); }} muted />
              ))}
            </>
          )}
          {local.length > 0 && (
            <>
              <div className="px-3 py-1.5" style={{ background: "rgba(0,0,0,0.2)", borderTop: "1px solid var(--hd-border-subtle)", borderBottom: "1px solid var(--hd-border-subtle)" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--hd-text-dim)" }}>
                  Local
                </span>
              </div>
              {local.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === value} onSelect={(id) => { onChange(id); setOpen(false); }} muted />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
  muted = false,
}: {
  model: ModelOption;
  selected: boolean;
  onSelect: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(model.id)}
      className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-white/5 transition-colors"
      style={{ color: muted ? "var(--hd-text-dim)" : "var(--hd-text)" }}
    >
      <span className="flex items-center gap-2">
        {selected ? (
          <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
        ) : (
          <span className="w-3 h-3 flex-shrink-0" />
        )}
        <span className="truncate">{model.label}</span>
      </span>
      {model.context ? (
        <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: "var(--hd-text-dim)" }}>
          {formatCtx(model.context)}
        </span>
      ) : null}
    </button>
  );
}
