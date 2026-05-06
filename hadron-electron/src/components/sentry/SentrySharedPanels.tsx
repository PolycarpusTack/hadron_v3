import { useState } from "react";
import type { SentryFullData } from "./sentryTypes";
import { groupFixesByPriority } from "./sentryTypes";

const MONO = "'JetBrains Mono','Fira Code',monospace";

// ─── EventTimeline ─────────────────────────────────────────────────────────────

export function EventTimeline({ eventStats }: { eventStats: Array<[number, number]> }) {
  if (!eventStats.length) {
    return (
      <div style={{ color: "#6b7280", fontSize: "12px", padding: "20px 0", textAlign: "center" }}>
        No event history available
      </div>
    );
  }
  const max = Math.max(...eventStats.map(([, c]) => c), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", padding: "0 4px" }}>
        {eventStats.map(([epoch, count]) => (
          <div key={epoch} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
            <span style={{ color: count > 5 ? "#ef4444" : count > 0 ? "#f59e0b" : "#4b5563", fontSize: "10px", fontFamily: MONO, fontWeight: 700 }}>
              {count > 0 ? count : ""}
            </span>
            <div style={{
              width: "100%",
              height: `${Math.max((count / max) * 60, count > 0 ? 4 : 0)}px`,
              background: count > 5 ? "#ef4444" : count > 0 ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.03)",
              borderRadius: "2px 2px 0 0",
              transition: "height 0.3s ease",
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
        {eventStats.map(([epoch]) => {
          const d = new Date(epoch * 1000);
          return (
            <div key={epoch} style={{ flex: 1, textAlign: "center", color: "#4b5563", fontSize: "9px", fontFamily: MONO }}>
              {`${d.getMonth() + 1}/${d.getDate()}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BreadcrumbTimeline ────────────────────────────────────────────────────────

const CAT_STYLE: Record<string, { color: string; icon: string }> = {
  "ui.click":   { color: "#3b82f6", icon: "⊡" },
  "ui.input":   { color: "#3b82f6", icon: "⌨" },
  "navigation": { color: "#3b82f6", icon: "▶" },
  "query":      { color: "#8b5cf6", icon: "⊞" },
  "db":         { color: "#22d3ee", icon: "⛁" },
  "db.error":   { color: "#ef4444", icon: "✗" },
  "http":       { color: "#10b981", icon: "→" },
  "fetch":      { color: "#10b981", icon: "→" },
  "xhr":        { color: "#10b981", icon: "→" },
  "console":    { color: "#6b7280", icon: ">" },
  "error":      { color: "#ef4444", icon: "✗" },
};

function catStyle(cat?: string) {
  if (!cat) return { color: "#6b7280", icon: "·" };
  return CAT_STYLE[cat] ?? CAT_STYLE[cat.split(".")[0]] ?? { color: "#6b7280", icon: "·" };
}

export function BreadcrumbTimeline({
  breadcrumbs,
  breadcrumbAnalysis,
}: {
  breadcrumbs: SentryFullData["breadcrumbs"];
  breadcrumbAnalysis?: string;
}) {
  const displayCrumbs = breadcrumbs.slice(-20);
  if (!displayCrumbs.length) {
    return (
      <div style={{ color: "#6b7280", fontSize: "12px", padding: "20px 0", textAlign: "center" }}>
        No breadcrumbs available
      </div>
    );
  }

  function fmtTs(ts?: string) {
    if (!ts) return "";
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" } as Intl.DateTimeFormatOptions); }
    catch { return ts; }
  }

  return (
    <div>
      {breadcrumbAnalysis && (
        <div style={{ padding: "10px 12px", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: "6px", marginBottom: "12px", color: "#93c5fd", fontSize: "12px", lineHeight: 1.6 }}>
          {breadcrumbAnalysis}
        </div>
      )}
      <div style={{ position: "relative", paddingLeft: "20px" }}>
        <div style={{ position: "absolute", left: "7px", top: "6px", bottom: "6px", width: "1px", background: "rgba(255,255,255,0.08)" }} />
        {displayCrumbs.map((b, i) => {
          const cs = catStyle(b.category);
          const isLast = i === displayCrumbs.length - 1;
          return (
            <div key={i} style={{ position: "relative", paddingBottom: isLast ? 0 : "10px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <div style={{ position: "absolute", left: "-16px", top: "4px", width: "13px", height: "13px", borderRadius: "3px", background: `${cs.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: cs.color, zIndex: 1 }}>
                {cs.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: MONO }}>{fmtTs(b.timestamp)}</span>
                  <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: MONO, color: cs.color, background: `${cs.color}18`, padding: "2px 6px", borderRadius: "3px" }}>
                    {b.category || "default"}
                  </span>
                  {b.level && b.level !== "info" && (
                    <span style={{ fontSize: "9px", fontWeight: 700, fontFamily: MONO, color: b.level === "error" ? "#ef4444" : "#f59e0b", background: b.level === "error" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", padding: "2px 6px", borderRadius: "3px" }}>
                      {b.level.toUpperCase()}
                    </span>
                  )}
                </div>
                {b.message && (
                  <div style={{ color: b.level === "error" ? "#fca5a5" : b.level === "warning" ? "#fde68a" : "#d1d5db", fontSize: "12px", marginTop: "2px", lineHeight: 1.5 }}>
                    {b.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TagsPanel ─────────────────────────────────────────────────────────────────

export function TagsPanel({ tags }: { tags: SentryFullData["tags"] }) {
  if (!tags.length) return <div style={{ color: "#6b7280", fontSize: "12px" }}>No tags</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {tags.slice(0, 30).map((t, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "0", borderRadius: "4px", overflow: "hidden", fontSize: "11px" }}>
          <span style={{ background: "rgba(255,255,255,0.04)", color: "#6b7280", padding: "3px 7px", fontFamily: MONO }}>{t.key}</span>
          <span style={{ background: "rgba(255,255,255,0.08)", color: "#d1d5db", padding: "3px 7px", fontFamily: MONO }}>{t.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── ContextPanels ─────────────────────────────────────────────────────────────

function Gauge({ label, val, max, unit }: { label: string; val: number; max: number; unit: string }) {
  const pct = Math.min(Math.round((val / max) * 100), 100);
  const c = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#10b981";
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
        <span style={{ color: "#9ca3af", fontSize: "11px" }}>{label}</span>
        <span style={{ color: c, fontSize: "11px", fontFamily: MONO, fontWeight: 700 }}>
          {val}{unit} / {max}{unit}
        </span>
      </div>
      <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: c, borderRadius: "2px", transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

export function ContextPanels({ contexts }: { contexts: Record<string, unknown> | null | undefined }) {
  if (!contexts) return <div style={{ color: "#6b7280", fontSize: "12px" }}>No context data</div>;
  const entries = Object.entries(contexts).filter(([, v]) => v && typeof v === "object");
  if (!entries.length) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
      {entries.slice(0, 4).map(([key, val]) => {
        const ctx = val as Record<string, unknown>;
        const accent = key === "oracle" || key === "db" ? "#22d3ee"
          : key === "app" || key === "application" ? "#c4b5fd"
          : key === "runtime" ? "#6ee7b7"
          : key === "os" ? "#93c5fd"
          : "#9ca3af";
        const icon = key === "oracle" || key === "db" ? "⛁"
          : key === "app" || key === "application" ? "⊞"
          : key === "runtime" ? "⌘"
          : "◉";

        const heapUsed = Number(ctx.jvm_heap_used ?? ctx.heap_used ?? ctx.memory_used ?? 0);
        const heapMax  = Number(ctx.jvm_heap_max  ?? ctx.heap_max  ?? ctx.memory_max  ?? 0);
        const tempPct  = Number(ctx.temp_pct ?? ctx.usage_pct ?? 0);
        const hasGauges = (heapUsed > 0 && heapMax > 0) || (tempPct > 0 && tempPct <= 100);

        const kvPairs = Object.entries(ctx)
          .filter(([, v]) => typeof v === "string" || typeof v === "number")
          .slice(0, 6);

        return (
          <div key={key} style={{ background: `${accent}08`, border: `1px solid ${accent}18`, borderRadius: "8px", padding: "12px" }}>
            <div style={{ color: accent, fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: MONO, marginBottom: "8px" }}>
              {icon} {key.toUpperCase()} CONTEXT
            </div>
            {hasGauges && (
              <>
                {tempPct > 0 && <Gauge label="Usage" val={tempPct} max={100} unit="%" />}
                {heapUsed > 0 && heapMax > 0 && <Gauge label="Memory" val={heapUsed} max={heapMax} unit="MB" />}
              </>
            )}
            {kvPairs.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: hasGauges ? "6px" : 0 }}>
                {kvPairs.map(([k, v]) => (
                  <div key={k}>
                    <div style={{ color: "#6b7280", fontSize: "9px", fontFamily: MONO }}>{k}</div>
                    <div style={{ color: "#d1d5db", fontSize: "11px", fontFamily: MONO, fontWeight: 600 }}>{String(v)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── FingerprintChips ──────────────────────────────────────────────────────────

export function FingerprintChips({ fingerprint }: { fingerprint: string[] | undefined }) {
  if (!fingerprint?.length) return null;
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {fingerprint.map((f, i) => (
        <span key={i} style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.2)", color: "#fb923c", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", fontFamily: MONO, fontWeight: 600 }}>
          {f}
        </span>
      ))}
    </div>
  );
}

// ─── ConfidenceBreakdown ───────────────────────────────────────────────────────

export function ConfidenceBreakdown({
  breakdown,
}: {
  breakdown: { confirmed: string[]; inferred: string[]; unknown: string[] } | undefined;
}) {
  if (!breakdown) return null;
  const tiers = [
    { key: "confirmed" as const, label: "CONFIRMED", color: "#10b981", icon: "✓" },
    { key: "inferred"  as const, label: "INFERRED",  color: "#f59e0b", icon: "~" },
    { key: "unknown"   as const, label: "UNKNOWN",   color: "#6b7280", icon: "?" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {tiers.map(t => {
        const items = breakdown[t.key];
        if (!items?.length) return null;
        return (
          <div key={t.key} style={{ background: `${t.color}08`, border: `1px solid ${t.color}22`, borderRadius: "6px", padding: "10px" }}>
            <div style={{ color: t.color, fontSize: "10px", fontWeight: 700, fontFamily: MONO, marginBottom: "5px" }}>
              {t.icon} {t.label}
            </div>
            {items.map((text, i) => (
              <div key={i} style={{ padding: "3px 0 3px 18px", color: "#d1d5db", fontSize: "12px", lineHeight: 1.5, borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {text}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── AlertRulesPanel ───────────────────────────────────────────────────────────

export function AlertRulesPanel({
  alerts,
}: {
  alerts: Array<{ name: string; condition: string; target?: string; severity?: string }>;
}) {
  if (!alerts.length) {
    return (
      <div style={{ color: "#6b7280", fontSize: "12px", padding: "12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
        No alert rules were generated for this issue. Re-analyze to generate monitoring recommendations.
      </div>
    );
  }
  const SEV_COLOR: Record<string, string> = {
    critical: "#ef4444", high: "#f59e0b", warning: "#f59e0b", medium: "#3b82f6", info: "#10b981",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {alerts.map((a, i) => {
        const c = SEV_COLOR[a.severity?.toLowerCase() ?? ""] ?? "#6b7280";
        return (
          <div key={i} style={{ background: `${c}08`, border: `1px solid ${c}22`, borderRadius: "6px", padding: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: MONO, color: c, background: `${c}18`, padding: "2px 6px", borderRadius: "3px" }}>
                  {(a.severity ?? "INFO").toUpperCase()}
                </span>
                <span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{a.name}</span>
              </div>
              {a.target && (
                <span style={{ color: "#6b7280", fontSize: "10px", fontFamily: MONO }}>{a.target}</span>
              )}
            </div>
            <div style={{ color: "#9ca3af", fontSize: "11px", fontFamily: MONO, marginTop: "6px" }}>
              Trigger: {a.condition}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── RemediationList ───────────────────────────────────────────────────────────

const PRIORITY_META = {
  P0: { label: "P0 — IMMEDIATE",  color: "#ef4444", bg: "rgba(239,68,68,0.06)"   },
  P1: { label: "P1 — THIS SPRINT", color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
  P2: { label: "P2 — STRUCTURAL", color: "#6b7280", bg: "rgba(107,114,128,0.06)" },
};

function FixAccordion({ priority, fixes }: { priority: "P0" | "P1" | "P2"; fixes: string[] }) {
  const [open, setOpen] = useState(priority === "P0");
  const meta = PRIORITY_META[priority];
  return (
    <div style={{ border: `1px solid ${meta.color}22`, borderRadius: "8px", overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: meta.bg, border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ color: meta.color, fontSize: "11px", fontWeight: 700, fontFamily: MONO }}>
          {meta.label}
        </span>
        <span style={{ marginLeft: "auto", color: "#6b7280", fontSize: "11px" }}>
          {fixes.length} {fixes.length === 1 ? "fix" : "fixes"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", background: "rgba(0,0,0,0.15)" }}>
          {fixes.map((fix, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "20px", height: "20px", borderRadius: "50%", background: `${meta.color}22`, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, fontFamily: MONO, marginTop: "1px" }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, fontSize: "13px", color: "#d1d5db", lineHeight: 1.6 }}>
                {fix}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RemediationList({ fixes }: { fixes: string[] }) {
  if (!fixes.length) {
    return <div style={{ color: "#6b7280", fontSize: "13px" }}>No remediation data available.</div>;
  }
  const grouped = groupFixesByPriority(fixes);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {(["P0", "P1", "P2"] as const).map(p =>
        grouped[p].length > 0 ? <FixAccordion key={p} priority={p} fixes={grouped[p]} /> : null
      )}
    </div>
  );
}
