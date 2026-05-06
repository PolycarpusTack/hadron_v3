import { useState, useMemo, useRef, useEffect } from "react";

const mono = "'JetBrains Mono','Fira Code',monospace";
const sans = "'IBM Plex Sans',-apple-system,sans-serif";

// ═══ Mock History Data ═══
const history = [
  { id: "WCR_5-2_11-23-15", type: "crash", site: "VRT", severity: "high", status: "open", component: "TM2TrailerGridPlanner", operation: "doRemoveTxEvent", exception: "MgXViolationError", signature: "VIOLATION-TxScheduleManagement-Editor", verdict: "bug", date: "2025-02-05", analyst: "yannick", tags: ["permission", "planner", "ui-crash"], summary: "Permission violation crash on DELETE — no pre-check in deleteKeyPressed:" },
  { id: "PERF-2025-0205-001", type: "db", site: "BBC", severity: "high", status: "open", component: "G4Browser / OOPLensQuery", operation: "buildQuery", exception: "ORA-01652", signature: "TEMP-DISTINCT-WIDE-PROJECTION", verdict: "bug", date: "2025-02-05", analyst: "yannick", tags: ["temp", "distinct", "oracle", "performance"], summary: "TEMP tablespace exhaustion — SELECT DISTINCT on 22 columns, OID-only equivalent" },
  { id: "WCR_4-22_14-08-33", type: "crash", site: "VRT", severity: "high", status: "open", component: "TM2TrailerGridPlanner", operation: "doRemoveTxEvent", exception: "MgXViolationError", signature: "VIOLATION-TxScheduleManagement-Editor", verdict: "bug", date: "2025-01-22", analyst: "yannick", tags: ["permission", "planner", "duplicate"], summary: "Same permission violation pattern — different user, same component" },
  { id: "FTV-MGX-55223", type: "investigation", site: "FTV", severity: "high", status: "fixed", component: "CM2AvailableRightCreator", operation: "createTempWindowsForTempFreeRerun:", exception: null, signature: "MISSING-LW-OVERLAP-CHECK", verdict: "bug", date: "2025-01-18", analyst: "yannick", tags: ["rights", "rerun", "license-window"], summary: "Missing LW overlap check in free rerun temp window creation" },
  { id: "WCR_3-15_09-41-02", type: "crash", site: "BBC", severity: "high", status: "fixed", component: "ContinuityPlanner", operation: "deleteKeyPressed:", exception: "MgXViolationError", signature: "VIOLATION-TxScheduleManagement-Editor", verdict: "bug", date: "2025-01-15", analyst: "yannick", tags: ["permission", "planner", "fixed"], summary: "Same permission pattern in ContinuityPlanner — fixed with pre-check guard" },
  { id: "RTLHU-MGX-57146", type: "investigation", site: "RTLHU", severity: "medium", status: "fixed", component: "CM2CostDefinitionSearchObject", operation: "seriesTitleSelection", exception: null, signature: "WRONG-PATH-SERIES-TITLE", verdict: "bug", date: "2025-01-12", analyst: "yannick", tags: ["cost", "search", "series-title"], summary: "seriesTitleSelection uses wrong path in CM2CostDefinitionSearchObject" },
  { id: "PERF-2025-0110-003", type: "db", site: "BBC", severity: "medium", status: "fixed", component: "CM2ContractBrowser", operation: "buildQuery", exception: "ORA-01652", signature: "TEMP-DISTINCT-WIDE-PROJECTION", verdict: "bug", date: "2025-01-10", analyst: "yannick", tags: ["temp", "distinct", "oracle"], summary: "Same TEMP pattern on CM2ContractBrowser — fewer columns but same root cause" },
  { id: "WCR_1-8_16-55-11", type: "crash", site: "FTV", severity: "medium", status: "fixed", component: "MediaAssetPlanner", operation: "doRemoveTxEvent", exception: "MgXViolationError", signature: "VIOLATION-TxScheduleManagement-Editor", verdict: "bug", date: "2024-12-08", analyst: "yannick", tags: ["permission", "planner", "fixed"], summary: "Permission violation in MediaAssetPlanner — same family as TM2 crashes" },
  { id: "DISCO-MGX-57761", type: "investigation", site: "DISCO", severity: "low", status: "closed", component: "CM2ProgramScheduleVersion", operation: "copyFormatTempPSDuration", exception: null, signature: "CONFIG-SP-COPY-FORMAT", verdict: "expected", date: "2024-12-05", analyst: "yannick", tags: ["configuration", "preference", "duration"], summary: "Expected behaviour — sp_copyFormatTempPSDuration = false; verify DB value" },
  { id: "PRMT-MGX-57816", type: "investigation", site: "PRMT", severity: "low", status: "closed", component: "CM2LotSelection", operation: "applyFilterCriteria:", exception: null, signature: "NO-AND-OPERATOR-LOT", verdict: "improvement", date: "2024-12-01", analyst: "yannick", tags: ["lot", "filter", "feature-request"], summary: "No AND operator for LOT selections — product improvement required" },
  { id: "WCR_11-28_08-12-44", type: "crash", site: "MTVNL", severity: "critical", status: "fixed", component: "WOnActiveTxDaySchedule", operation: "commitTransaction", exception: "OutOfMemory", signature: "OOM-UNBOUNDED-COLLECTION", verdict: "bug", date: "2024-11-28", analyst: "yannick", tags: ["memory", "oom", "collection-growth"], summary: "OutOfMemory from unbounded OrderedCollection growth in commit cycle" },
  { id: "PERF-2024-1120-002", type: "db", site: "VRT", severity: "medium", status: "open", component: "WOnScheduleBrowser", operation: "loadScheduleForDate:", exception: null, signature: "N+1-PROXY-CASCADE", verdict: "bug", date: "2024-11-20", analyst: "yannick", tags: ["n+1", "glorp", "proxy", "performance"], summary: "N+1 proxy cascade loading 847 contracts individually — needs alsoFetch:" },
  { id: "WCR_11-15_13-22-07", type: "crash", site: "XSTREAM", severity: "high", status: "fixed", component: "MAF2Widget", operation: "dispatchEvent:", exception: "MessageNotUnderstood", signature: "MNU-NIL-VALUE-MODEL", verdict: "bug", date: "2024-11-15", analyst: "yannick", tags: ["mnu", "value-model", "ui", "initialization"], summary: "doesNotUnderstand: sent to nil — value model not initialized before UI connect" },
  { id: "WCR_11-10_07-45-33", type: "crash", site: "BBC", severity: "medium", status: "fixed", component: "ImageStartup", operation: "initializeSubsystems", exception: "MessageNotUnderstood", signature: "STARTUP-ORDERING-DEFECT", verdict: "bug", date: "2024-11-10", analyst: "yannick", tags: ["startup", "initialization", "ordering"], summary: "Startup ordering defect — subsystem accessed before prerequisite loaded" },
  { id: "WCR_2-28_10-12-44", type: "crash", site: "DISCO", severity: "high", status: "open", component: "TM2TrailerGridPlanner", operation: "doRemoveTxEvent", exception: "MgXViolationError", signature: "VIOLATION-TxScheduleManagement-Editor", verdict: "bug", date: "2025-02-01", analyst: "yannick", tags: ["permission", "planner"], summary: "Permission violation at DISCO — identical to VRT/BBC pattern" },
  { id: "PERF-2024-1105-001", type: "db", site: "FTV", severity: "low", status: "closed", component: "CM2RightsBrowser", operation: "executeSearch", exception: null, signature: "MISSING-INDEX-RIGHTS", verdict: "bug", date: "2024-11-05", analyst: "yannick", tags: ["index", "rights", "performance"], summary: "Full table scan on CM2RIGHTS — missing index on TERRITORY + STATUS" },
];

// ═══ Constants ═══
const typeConfig = { crash: { color: "#ef4444", label: "Crash", icon: "⚡" }, db: { color: "#22d3ee", label: "Database", icon: "⛁" }, investigation: { color: "#8b5cf6", label: "Investigation", icon: "◎" } };
const sevConfig = { critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" }, high: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" }, medium: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" }, low: { color: "#10b981", bg: "rgba(16,185,129,0.12)" } };
const statusConfig = { open: { color: "#f59e0b", label: "Open" }, fixed: { color: "#10b981", label: "Fixed" }, closed: { color: "#6b7280", label: "Closed" } };
const verdictConfig = { bug: { color: "#ef4444", label: "Bug" }, expected: { color: "#3b82f6", label: "Expected" }, improvement: { color: "#8b5cf6", label: "Improvement" } };
const sites = [...new Set(history.map(h => h.site))].sort();
const signatures = [...new Set(history.map(h => h.signature))].sort();
const sortOptions = [{ id: "date-desc", label: "Newest first" }, { id: "date-asc", label: "Oldest first" }, { id: "severity", label: "Severity" }, { id: "site", label: "Site" }];
const groupOptions = [{ id: "none", label: "No grouping" }, { id: "site", label: "By site" }, { id: "signature", label: "By pattern" }, { id: "type", label: "By type" }, { id: "status", label: "By status" }];

function Tag({ text, color }) { return <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: mono, color, background: `${color}18`, padding: "2px 6px", borderRadius: "3px", whiteSpace: "nowrap" }}>{text}</span>; }

// ═══ Filter Dropdown ═══
function FilterDrop({ label, options, value, onChange, counts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const active = value !== "all";
  return <div ref={ref} style={{ position: "relative" }}>
    <button onClick={() => setOpen(!open)} style={{ background: active ? "rgba(6,182,212,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${active ? "rgba(6,182,212,0.25)" : "rgba(255,255,255,0.08)"}`, color: active ? "#67e8f9" : "#9ca3af", padding: "5px 10px", borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: "5px" }}>
      {label}{active && `: ${value}`} <span style={{ fontSize: "8px", opacity: 0.6 }}>▼</span>
    </button>
    {open && <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#151518", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "4px", minWidth: "160px", zIndex: 100, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
      <button onClick={() => { onChange("all"); setOpen(false); }} style={{ display: "flex", justifyContent: "space-between", width: "100%", background: value === "all" ? "rgba(255,255,255,0.06)" : "transparent", border: "none", color: "#d1d5db", padding: "6px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono, textAlign: "left" }}>All <span style={{ color: "#4b5563" }}>{history.length}</span></button>
      {options.map(opt => { const ct = counts?.[opt] || 0; return <button key={opt} onClick={() => { onChange(opt); setOpen(false); }} style={{ display: "flex", justifyContent: "space-between", width: "100%", background: value === opt ? "rgba(255,255,255,0.06)" : "transparent", border: "none", color: value === opt ? "#e5e7eb" : "#9ca3af", padding: "6px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono, textAlign: "left" }}>{opt} <span style={{ color: "#4b5563" }}>{ct}</span></button>; })}
    </div>}
  </div>;
}

// ═══ History Entry Row ═══
function EntryRow({ item, selected, onSelect, onOpen }) {
  const tc = typeConfig[item.type];
  const sc = sevConfig[item.severity];
  const st = statusConfig[item.status];
  const vc = verdictConfig[item.verdict];
  return <div
    onClick={() => onOpen(item)}
    style={{ background: selected ? "rgba(6,182,212,0.06)" : "rgba(255,255,255,0.015)", border: `1px solid ${selected ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.04)"}`, borderRadius: "6px", padding: "12px 14px", cursor: "pointer", transition: "all .12s" }}
    onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
    onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.015)"; }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
      <input type="checkbox" checked={selected} onChange={e => { e.stopPropagation(); onSelect(item.id); }} onClick={e => e.stopPropagation()} style={{ accentColor: "#22d3ee", width: "14px", height: "14px", cursor: "pointer" }} />
      <span style={{ color: tc.color, fontSize: "11px" }}>{tc.icon}</span>
      <span style={{ color: "#e5e7eb", fontSize: "13px", fontFamily: mono, fontWeight: 600 }}>{item.id}</span>
      <Tag text={item.site} color="#8b5cf6" />
      <Tag text={item.severity.toUpperCase()} color={sc.color} />
      <Tag text={st.label} color={st.color} />
      <Tag text={vc.label} color={vc.color} />
      {item.exception && <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{item.exception}</span>}
      <span style={{ marginLeft: "auto", color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{item.date}</span>
    </div>
    <div style={{ marginLeft: "24px", display: "flex", flexDirection: "column", gap: "3px" }}>
      <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{item.summary}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
        <span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>{item.component}</span>
        {item.tags.slice(0, 4).map(t => <span key={t} style={{ fontSize: "9px", color: "#4b5563", fontFamily: mono, background: "rgba(255,255,255,0.03)", padding: "1px 5px", borderRadius: "3px" }}>#{t}</span>)}
        <span style={{ marginLeft: "auto", color: "#4b5563", fontSize: "10px", fontFamily: mono }}>{item.analyst}</span>
      </div>
    </div>
  </div>;
}

// ═══ Entry Card (card view) ═══
function EntryCard({ item, selected, onSelect, onOpen }) {
  const tc = typeConfig[item.type]; const sc = sevConfig[item.severity]; const st = statusConfig[item.status]; const vc = verdictConfig[item.verdict];
  return <div onClick={() => onOpen(item)} style={{ background: selected ? "rgba(6,182,212,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${selected ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.05)"}`, borderTop: `2px solid ${tc.color}`, borderRadius: "0 0 8px 8px", padding: "14px", cursor: "pointer", transition: "all .12s", display: "flex", flexDirection: "column", gap: "8px" }}
    onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.035)"; }}
    onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input type="checkbox" checked={selected} onChange={e => { e.stopPropagation(); onSelect(item.id); }} onClick={e => e.stopPropagation()} style={{ accentColor: "#22d3ee" }} />
        <span style={{ color: tc.color, fontSize: "11px" }}>{tc.icon}</span>
        <span style={{ color: "#e5e7eb", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{item.id}</span>
      </div>
      <Tag text={item.severity.toUpperCase()} color={sc.color} />
    </div>
    <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{item.summary}</div>
    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}><Tag text={item.site} color="#8b5cf6" /><Tag text={st.label} color={st.color} /><Tag text={vc.label} color={vc.color} /></div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto" }}><span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>{item.component}</span><span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>{item.date}</span></div>
  </div>;
}

// ═══ Group Header ═══
function GroupHeader({ label, count, color }) {
  return <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", marginTop: "8px" }}>
    <div style={{ width: "4px", height: "16px", borderRadius: "2px", background: color || "#6b7280" }} />
    <span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600, fontFamily: mono }}>{label}</span>
    <span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>({count})</span>
    <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
  </div>;
}

// ═══ Pattern Sidebar ═══
function PatternSidebar({ items, activeSignature, onSelect }) {
  const patterns = useMemo(() => {
    const map = {};
    items.forEach(it => { if (!map[it.signature]) map[it.signature] = { sig: it.signature, count: 0, severity: "low", sites: new Set(), latest: it.date }; map[it.signature].count++; map[it.signature].sites.add(it.site); if (["critical", "high"].includes(it.severity)) map[it.signature].severity = it.severity; if (it.date > map[it.signature].latest) map[it.signature].latest = it.date; });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [items]);
  return <div style={{ width: "280px", borderRight: "1px solid rgba(255,255,255,0.06)", padding: "12px", overflowY: "auto", flexShrink: 0 }}>
    <div style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".12em", fontFamily: mono, marginBottom: "10px" }}>PATTERN CLUSTERS</div>
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <button onClick={() => onSelect(null)} style={{ background: !activeSignature ? "rgba(255,255,255,0.06)" : "transparent", border: "1px solid rgba(255,255,255,0.04)", borderRadius: "5px", padding: "8px 10px", cursor: "pointer", textAlign: "left", color: "#d1d5db", fontSize: "11px", fontFamily: mono }}>All patterns <span style={{ color: "#4b5563" }}>({items.length})</span></button>
      {patterns.map(p => { const active = activeSignature === p.sig; return <button key={p.sig} onClick={() => onSelect(active ? null : p.sig)} style={{ background: active ? "rgba(6,182,212,0.08)" : "rgba(255,255,255,0.015)", border: `1px solid ${active ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.04)"}`, borderRadius: "5px", padding: "8px 10px", cursor: "pointer", textAlign: "left", transition: "all .12s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: active ? "#67e8f9" : "#d1d5db", fontSize: "11px", fontWeight: 600, fontFamily: mono }}>{p.count}×</span>
          <Tag text={p.severity.toUpperCase()} color={sevConfig[p.severity].color} />
        </div>
        <div style={{ color: "#9ca3af", fontSize: "10px", fontFamily: mono, marginTop: "4px", wordBreak: "break-all" }}>{p.sig}</div>
        <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>{[...p.sites].map(s => <Tag key={s} text={s} color="#8b5cf6" />)}</div>
      </button>; })}
    </div>
  </div>;
}

// ═══ Stats Bar ═══
function StatsBar({ items }) {
  const open = items.filter(i => i.status === "open").length;
  const crashes = items.filter(i => i.type === "crash").length;
  const db = items.filter(i => i.type === "db").length;
  const inv = items.filter(i => i.type === "investigation").length;
  return <div style={{ display: "flex", gap: "16px", padding: "8px 0", alignItems: "center" }}>
    <span style={{ color: "#9ca3af", fontSize: "12px" }}><strong style={{ color: "#e5e7eb" }}>{items.length}</strong> analyses</span>
    <span style={{ color: "#4b5563" }}>·</span>
    <span style={{ color: "#f59e0b", fontSize: "12px" }}>{open} open</span>
    <span style={{ color: "#4b5563" }}>·</span>
    <span style={{ fontSize: "11px", display: "flex", gap: "8px" }}>
      <span style={{ color: "#ef4444" }}>{crashes} crash</span>
      <span style={{ color: "#22d3ee" }}>{db} db</span>
      <span style={{ color: "#8b5cf6" }}>{inv} investigation</span>
    </span>
  </div>;
}

// ═══ Main ═══
export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [sevFilter, setSevFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("date-desc");
  const [group, setGroup] = useState("none");
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(new Set());
  const [patternFilter, setPatternFilter] = useState(null);
  const [showPatterns, setShowPatterns] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => { const h = e => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); } }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);

  const toggleSelect = id => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = items => setSelected(new Set(items.map(i => i.id)));
  const clearSelection = () => setSelected(new Set());

  const filtered = useMemo(() => {
    let r = history;
    if (search) { const s = search.toLowerCase(); r = r.filter(i => i.id.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s) || i.component.toLowerCase().includes(s) || i.tags.some(t => t.includes(s)) || (i.exception || "").toLowerCase().includes(s) || i.signature.toLowerCase().includes(s)); }
    if (typeFilter !== "all") r = r.filter(i => i.type === typeFilter);
    if (siteFilter !== "all") r = r.filter(i => i.site === siteFilter);
    if (sevFilter !== "all") r = r.filter(i => i.severity === sevFilter);
    if (statusFilter !== "all") r = r.filter(i => i.status === statusFilter);
    if (patternFilter) r = r.filter(i => i.signature === patternFilter);
    return r;
  }, [search, typeFilter, siteFilter, sevFilter, statusFilter, patternFilter]);

  const sorted = useMemo(() => {
    const s = [...filtered];
    if (sort === "date-desc") s.sort((a, b) => b.date.localeCompare(a.date));
    else if (sort === "date-asc") s.sort((a, b) => a.date.localeCompare(b.date));
    else if (sort === "severity") { const o = { critical: 0, high: 1, medium: 2, low: 3 }; s.sort((a, b) => o[a.severity] - o[b.severity]); }
    else if (sort === "site") s.sort((a, b) => a.site.localeCompare(b.site));
    return s;
  }, [filtered, sort]);

  const grouped = useMemo(() => {
    if (group === "none") return [{ key: "all", label: null, items: sorted }];
    const map = {};
    sorted.forEach(i => {
      let k;
      if (group === "site") k = i.site;
      else if (group === "signature") k = i.signature;
      else if (group === "type") k = i.type;
      else if (group === "status") k = i.status;
      else k = "other";
      if (!map[k]) map[k] = [];
      map[k].push(i);
    });
    return Object.entries(map).map(([k, items]) => {
      let color = "#6b7280";
      if (group === "type" && typeConfig[k]) color = typeConfig[k].color;
      if (group === "status" && statusConfig[k]) color = statusConfig[k].color;
      if (group === "site") color = "#8b5cf6";
      if (group === "signature") color = "#22d3ee";
      return { key: k, label: k, color, items };
    });
  }, [sorted, group]);

  const siteCounts = useMemo(() => { const c = {}; history.forEach(i => { c[i.site] = (c[i.site] || 0) + 1; }); return c; }, []);

  const handleOpen = (item) => { /* would navigate to viewer */ };

  return <div style={{ background: "#090a0d", color: "#d1d5db", minHeight: "100vh", fontFamily: sans, display: "flex", flexDirection: "column" }}>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

    {/* Header */}
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ color: "#22d3ee", fontSize: "16px", fontWeight: 700, fontFamily: mono }}>HADRON</span>
        <span style={{ color: "#4b5563" }}>│</span>
        <span style={{ color: "#9ca3af", fontSize: "13px" }}>Analysis History</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Search */}
        <div style={{ position: "relative" }}>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search analyses..." style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "6px 12px 6px 30px", color: "#d1d5db", fontSize: "12px", fontFamily: sans, outline: "none", width: "280px" }} />
          <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#4b5563", fontSize: "12px" }}>⌕</span>
          {!search && <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "#4b5563", fontSize: "9px", fontFamily: mono, background: "rgba(255,255,255,0.04)", padding: "1px 4px", borderRadius: "3px" }}>⌘K</span>}
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#6b7280", fontSize: "12px", cursor: "pointer", padding: "2px" }}>×</button>}
        </div>
      </div>
    </div>

    {/* Toolbar */}
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "8px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <FilterDrop label="Type" options={["crash", "db", "investigation"]} value={typeFilter} onChange={setTypeFilter} counts={{ crash: history.filter(i => i.type === "crash").length, db: history.filter(i => i.type === "db").length, investigation: history.filter(i => i.type === "investigation").length }} />
        <FilterDrop label="Site" options={sites} value={siteFilter} onChange={setSiteFilter} counts={siteCounts} />
        <FilterDrop label="Severity" options={["critical", "high", "medium", "low"]} value={sevFilter} onChange={setSevFilter} />
        <FilterDrop label="Status" options={["open", "fixed", "closed"]} value={statusFilter} onChange={setStatusFilter} />
        {(typeFilter !== "all" || siteFilter !== "all" || sevFilter !== "all" || statusFilter !== "all" || patternFilter) && <button onClick={() => { setTypeFilter("all"); setSiteFilter("all"); setSevFilter("all"); setStatusFilter("all"); setPatternFilter(null); setSearch(""); }} style={{ background: "none", border: "none", color: "#6b7280", fontSize: "11px", cursor: "pointer", fontFamily: mono, textDecoration: "underline" }}>Clear all</button>}
      </div>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {/* Sort */}
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "5px", padding: "5px 8px", color: "#9ca3af", fontSize: "11px", fontFamily: mono, cursor: "pointer", outline: "none" }}>
          {sortOptions.map(s => <option key={s.id} value={s.id} style={{ background: "#151518" }}>{s.label}</option>)}
        </select>
        {/* Group */}
        <select value={group} onChange={e => setGroup(e.target.value)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "5px", padding: "5px 8px", color: "#9ca3af", fontSize: "11px", fontFamily: mono, cursor: "pointer", outline: "none" }}>
          {groupOptions.map(g => <option key={g.id} value={g.id} style={{ background: "#151518" }}>{g.label}</option>)}
        </select>
        <span style={{ color: "#4b5563" }}>│</span>
        {/* View toggle */}
        {["list", "card"].map(v => <button key={v} onClick={() => setView(v)} style={{ background: view === v ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${view === v ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}`, color: view === v ? "#e5e7eb" : "#6b7280", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>{v === "list" ? "≡" : "⊞"}</button>)}
        <button onClick={() => setShowPatterns(!showPatterns)} style={{ background: showPatterns ? "rgba(6,182,212,0.1)" : "transparent", border: `1px solid ${showPatterns ? "rgba(6,182,212,0.25)" : "rgba(255,255,255,0.06)"}`, color: showPatterns ? "#67e8f9" : "#6b7280", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>◎ Patterns</button>
      </div>
    </div>

    {/* Selection bar */}
    {selected.size > 0 && <div style={{ padding: "6px 24px", background: "rgba(6,182,212,0.06)", borderBottom: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ color: "#67e8f9", fontSize: "11px", fontFamily: mono }}>{selected.size} selected</span>
      <button onClick={() => selectAll(sorted)} style={{ background: "none", border: "none", color: "#67e8f9", fontSize: "11px", cursor: "pointer", fontFamily: mono, textDecoration: "underline" }}>Select all ({sorted.length})</button>
      <button onClick={clearSelection} style={{ background: "none", border: "none", color: "#6b7280", fontSize: "11px", cursor: "pointer", fontFamily: mono, textDecoration: "underline" }}>Clear</button>
      <span style={{ color: "#4b5563" }}>│</span>
      {[{ l: "Export batch", i: "↗" }, { l: "Mark duplicate", i: "⊘" }, { l: "Change status", i: "◑" }].map(a => <button key={a.l} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#d1d5db", padding: "3px 10px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: "4px" }}><span>{a.i}</span>{a.l}</button>)}
    </div>}

    {/* Main content */}
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Pattern sidebar */}
      {showPatterns && <PatternSidebar items={history} activeSignature={patternFilter} onSelect={setPatternFilter} />}

      {/* Results area */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 24px" }}>
        <StatsBar items={sorted} />

        {sorted.length === 0 ? <div style={{ textAlign: "center", padding: "60px 0" }}><div style={{ color: "#4b5563", fontSize: "14px" }}>No analyses match your filters</div><button onClick={() => { setTypeFilter("all"); setSiteFilter("all"); setSevFilter("all"); setStatusFilter("all"); setPatternFilter(null); setSearch(""); }} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#9ca3af", padding: "6px 14px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontFamily: mono, marginTop: "12px" }}>Clear filters</button></div> :

        view === "list" ? <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {grouped.map(g => <div key={g.key}>
            {g.label && <GroupHeader label={g.label} count={g.items.length} color={g.color} />}
            {g.items.map(item => <EntryRow key={item.id} item={item} selected={selected.has(item.id)} onSelect={toggleSelect} onOpen={handleOpen} />)}
          </div>)}
        </div> :

        <div>
          {grouped.map(g => <div key={g.key}>
            {g.label && <GroupHeader label={g.label} count={g.items.length} color={g.color} />}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "8px", marginBottom: "8px" }}>
              {g.items.map(item => <EntryCard key={item.id} item={item} selected={selected.has(item.id)} onSelect={toggleSelect} onOpen={handleOpen} />)}
            </div>
          </div>)}
        </div>}
      </div>
    </div>
  </div>;
}
