import { useState, useEffect } from "react";

const mono = "'JetBrains Mono','Fira Code',monospace";
const sans = "'IBM Plex Sans',-apple-system,sans-serif";
const FC = { red: { bg: "rgba(239,68,68,0.08)", border: "#ef4444", text: "#fca5a5", dot: "#ef4444", label: "Crash cause" }, blue: { bg: "rgba(59,130,246,0.08)", border: "#3b82f6", text: "#93c5fd", dot: "#3b82f6", label: "Fix target" }, orange: { bg: "rgba(249,115,22,0.08)", border: "#f97316", text: "#fdba74", dot: "#f97316", label: "Query issue" }, gray: { bg: "rgba(107,114,128,0.06)", border: "#4b5563", text: "#9ca3af", dot: "#6b7280", label: "Infrastructure" } };
const SEV = { critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "CRITICAL" }, high: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "HIGH" }, medium: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", label: "MEDIUM" }, low: { color: "#10b981", bg: "rgba(16,185,129,0.12)", label: "LOW" } };
function clip(t) { navigator.clipboard?.writeText(t); }

const D = {
  metadata: { crash_id: "WCR_5-2_11-23-15", timestamp: "2025-02-05T11:23:15", site: "VRT", database: "mgx-db-28:1521/s28db13x", user: "akenk", username: "yannick.verrydt", computer: "MGX-RDS-14",
    versions: { whatson: "2024r8.000.002c", connector: "2024r8.000", smalltalk: "VisualWorks 9.3", oracle_server: "19c Enterprise", oracle_client: "12.1.0.2.0" },
    encoding: { database: "AL32UTF8", session: "utf_8", mismatch: false } },
  classification: { type: "VIOLATION ERROR", subtype: "Permission Denied", severity: "high", signature: "MgXViolationError + TxScheduleManagement + Editor", component: "TM2TrailerGridPlanner", operation: "doRemoveTxEvent" },
  cause: { type: "MgXViolationError", message: "Permission violation for TxScheduleManagement functionality", permission: { msg_id: "#msg_193", functionality: "TxScheduleManagement", level: "Editor" } },
  stackFrames: [
    { id: 1, method: "MgXViolations >> raiseIfAppropriate", color: "red", label: "Exception origin", source: "raiseIfAppropriate\n    self violations isEmpty ifFalse: [\n        MgXViolationError new violations: self violations; signal]" },
    { id: 2, method: "MgXUtilities class >> raisePermissionViolationWithMsg:functionalities:permission:", color: "red", label: "Permission violation raised", source: "raisePermissionViolationWithMsg: msgId functionalities: funcs permission: perm\n    | violations |\n    violations := MgXViolations new.\n    violations addViolation: (MgXPermissionViolation new\n        messageId: msgId; functionalities: funcs;\n        requiredPermission: perm).\n    violations raiseIfAppropriate" },
    { id: 3, method: "MgXViolations >> validatePermission:for:required:", color: "blue", label: "Permission validation — fix target" },
    { id: 4, method: "WOnActiveTxDaySchedule >> isModifiableWithNotification:minimalPlanningPermission:", color: "blue", label: "Modifiability check — guard candidate", source: "isModifiableWithNotification: aBoolean minimalPlanningPermission: aPermission\n    | result |\n    result := self checkPermission: aPermission\n        forFunctionality: #TxScheduleManagement.\n    result ifFalse: [\n        MgXUtilities raisePermissionViolationWithMsg: #msg_193\n            functionalities: #(#TxScheduleManagement)\n            permission: aPermission].\n    ^ result" },
    { id: 5, method: "WOnActiveTxDaySchedule >> checkPermission:forFunctionality:", color: "blue", label: "Permission enforcement" },
    { id: 6, method: "TM2TrailerGridPlanner_period >> doRemoveTxEvent", color: "blue", label: "Business logic — no pre-validation", source: "doRemoveTxEvent\n    | txEvent daySchedule |\n    txEvent := self selectedTxEvent.\n    txEvent isNil ifTrue: [^ self].\n    daySchedule := txEvent daySchedule.\n    daySchedule isModifiableWithNotification: true\n        minimalPlanningPermission: #Editor.\n    txEvent remove. self refreshGrid" },
    { id: 7, method: "TM2TrailerGridPlanner_period >> deleteKeyPressed:", color: "blue", label: "Entry point — FIX HERE", source: "deleteKeyPressed: event\n    \"Handle DELETE key press in the trailer grid.\"\n    self doRemoveTxEvent" },
    { id: 8, method: "MAF2Widget >> dispatchKeyEvent:", color: "gray", label: "UI framework dispatch" },
    { id: 9, method: "WidgetPolicy >> handleKeyboardEvent:", color: "gray", label: "Event handler" },
    { id: 10, method: "EventDispatcher >> dispatch:", color: "gray", label: "Event system" },
  ],
  userJourney: [
    { step: 1, action: "Logged into WHATS'ON as akenk (yannick.verrydt)" }, { step: 2, action: "Opened TM2 Trailer Grid Planner for a specific period" },
    { step: 3, action: "Selected a transmission event (TxEvent) in the grid" }, { step: 4, action: "Pressed DELETE key to remove the event" },
    { step: 5, action: "System checked day schedule modifiability" },
    { step: 6, action: "Permission validation failed — user lacks Editor for TxScheduleManagement", isFailure: true },
    { step: 7, action: "Unhandled MgXViolationError — application crash", isFailure: true },
  ],
  remediation: {
    p0: [{ title: "Add pre-action permission check", location: "TM2TrailerGridPlanner_period >> deleteKeyPressed:", time: "2-3 hours", risk: "Low",
      code: "deleteKeyPressed: event\n    self checkIsModifiable: #Editor ifNot: [\n        Dialog warn: 'You do not have permission'.\n        ^self].\n    self doRemoveTxEvent",
      before: "DELETE → doRemoveTxEvent → permission fails → CRASH", after: "DELETE → pre-check → friendly dialog → return" }],
    p1: [{ title: "UI-level permission awareness", time: "2-3 days", description: "Disable DELETE button when user lacks permission." },
      { title: "Framework exception handler", time: "3-4 hours", description: "Catch MgXViolationError at MAF2Widget level." },
      { title: "Permission audit logging", time: "1 day", description: "Log all permission violations." }],
    p2: [{ title: "Permission-aware UI framework", time: "3-4 months", description: "Redesign UI base classes to query/cache permissions." }],
  },
  reproduction: { steps: ["Log in with account lacking Editor for TxScheduleManagement", "Open TM2 Trailer Grid Planner", "Select any transmission event", "Press DELETE key"], expected: "Friendly dialog or disabled action", actual: "Application crashes with MgXViolationError" },
  similarCrashes: [
    { id: "WCR_3-15_09-41-02", site: "BBC", date: "2025-01-15", component: "ContinuityPlanner", similarity: 0.92, status: "fixed" },
    { id: "WCR_4-22_14-08-33", site: "VRT", date: "2025-01-22", component: "TM2TrailerGridPlanner", similarity: 0.97, status: "open" },
    { id: "WCR_1-8_16-55-11", site: "FTV", date: "2024-12-08", component: "MediaAssetPlanner", similarity: 0.85, status: "fixed" },
    { id: "WCR_2-28_10-12-44", site: "DISCO", date: "2025-02-01", component: "TM2TrailerGridPlanner", similarity: 0.94, status: "open" },
  ],
  envHealth: { temp: { used: 62, max: 100, unit: "GB", status: "ok" }, pool: { used: 18, max: 50, status: "ok" }, heap: { used: 1.2, max: 2.0, unit: "GB", status: "ok" }, version: { client: "12.1.0.2.0", server: "19c", warn: "Client 2 major versions behind" } },
  permissions: { granted: [{ fn: "TxScheduleManagement", level: "Viewer" }, { fn: "ContentManagement", level: "Editor" }, { fn: "ContractManagement", level: "Viewer" }, { fn: "Reporting", level: "Editor" }], required: { fn: "TxScheduleManagement", level: "Editor" } },
  sessionWindows: [{ id: 1, name: "Mediagenix Launcher", time: "11:15:02", status: "active" }, { id: 2, name: "TM2TrailerGridPlanner_period", time: "11:18:44", status: "crashed" }],
  blastRadius: [{ c: "TM2TrailerGridPlanner", s: "vulnerable" }, { c: "ContinuityPlanner", s: "vulnerable" }, { c: "MediaAssetPlanner", s: "vulnerable" }, { c: "ContractNavigator", s: "safe" }, { c: "ScheduleBrowser", s: "safe" }, { c: "RightsExplorer", s: "unknown" }],
  confidence: {
    confirmed: ["User lacks Editor permission for TxScheduleManagement (exception args)", "Crash path: deleteKeyPressed: → doRemoveTxEvent → isModifiableWithNotification: (stack)", "No permission pre-check in deleteKeyPressed: (code analysis)"],
    inferred: ["Other planners likely have the same missing pre-check (pattern)", "User intentionally restricted, not misconfigured (Viewer level = deliberate role)"],
    unknown: ["Whether site has custom override for TM2TrailerGridPlanner_period", "Whether user permission was recently changed", "Whether other VRT users have same restricted profile"],
  },
};

// ═══ Small Components ═══
function CopyBtn({ text, label = "Copy" }) { const [ok, set] = useState(false); return <button onClick={() => { clip(text); set(true); setTimeout(() => set(false), 2000); }} style={{ background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`, color: ok ? "#6ee7b7" : "#9ca3af", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono, transition: "all .2s" }}>{ok ? "✓" : label}</button>; }
function Bdg({ severity }) { const s = SEV[severity] || SEV.medium; return <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: s.bg, color: s.color, padding: "3px 10px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, letterSpacing: ".08em", fontFamily: mono }}><span style={{ fontSize: "6px" }}>⬤</span>{s.label}</span>; }
function Crd({ label, value, accent }) { return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderTop: `2px solid ${accent}`, borderRadius: "0 0 6px 6px", padding: "12px" }}><div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono }}>{label}</div><div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "4px", fontFamily: mono }}>{value}</div></div>; }
function Tag({ text, color }) { return <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: mono, color, background: `${color}18`, padding: "2px 6px", borderRadius: "3px" }}>{text}</span>; }
function Sec({ title, children, actions, open: init = true }) { const [open, set] = useState(init); return <div style={{ marginBottom: "4px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? "12px" : "0", cursor: "pointer" }} onClick={() => set(!open)}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ color: "#6b7280", fontSize: "10px", transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform .15s", display: "inline-block" }}>▶</span><span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".12em", fontFamily: mono }}>{title}</span></div>{actions && open && <div onClick={e => e.stopPropagation()}>{actions}</div>}</div>{open && children}</div>; }
function SLabel({ text }) { return <div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono, marginBottom: "10px" }}>{text}</div>; }

// ═══ Standard Panels ═══
function MetaPanel() { const m = D.metadata; const R = ({ k, v, c }) => <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}><span style={{ color: "#6b7280", fontSize: "12px" }}>{k}</span><span style={{ color: c || "#d1d5db", fontSize: "12px", fontFamily: mono }}>{v}</span></div>; return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}><div><SLabel text="ENVIRONMENT" />{[["Crash ID", m.crash_id], ["Timestamp", new Date(m.timestamp).toLocaleString()], ["Site", `${m.site} (${m.database})`], ["User", `${m.username} (${m.user})`], ["Machine", m.computer]].map(([k, v]) => <R key={k} k={k} v={v} />)}</div><div><SLabel text="VERSIONS" />{Object.entries(m.versions).map(([k, v]) => <R key={k} k={k} v={v} />)}<div style={{ marginTop: "8px" }}><R k="Encoding" v={`${m.encoding.database} / ${m.encoding.session} ${m.encoding.mismatch ? "⚠" : "✓"}`} c={m.encoding.mismatch ? "#ef4444" : "#6ee7b7"} /></div></div></div>; }

function Stack({ exp }) {
  const [open, setO] = useState(new Set([1, 2, 6, 7]));
  const [ins, setIns] = useState(null);
  return <div><div style={{ display: "flex", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>{Object.entries(FC).map(([k, v]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: "5px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: v.dot }} /><span style={{ color: "#9ca3af", fontSize: "11px" }}>{v.label}</span></div>)}</div>
    <div style={{ display: "flex", gap: exp ? "16px" : 0 }}><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
      {D.stackFrames.map(f => { const c = FC[f.color]; const isO = open.has(f.id); const isI = ins === f.id; return <div key={f.id} style={{ background: isO || isI ? c.bg : "transparent", borderLeft: `3px solid ${isO || isI ? c.border : "transparent"}`, padding: "7px 12px", cursor: "pointer", borderRadius: "0 4px 4px 0", transition: "all .15s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={() => { const n = new Set(open); n.has(f.id) ? n.delete(f.id) : n.add(f.id); setO(n); }}>
          <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono, width: "24px", textAlign: "right" }}>[{f.id}]</span>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
          <span style={{ color: c.text, fontSize: "12.5px", fontFamily: mono, flex: 1 }}>{f.method}</span>
          {exp && f.source && <button onClick={e => { e.stopPropagation(); setIns(isI ? null : f.id); }} style={{ background: isI ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${isI ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`, color: isI ? "#d1d5db" : "#4b5563", padding: "2px 8px", borderRadius: "3px", fontSize: "10px", cursor: "pointer", fontFamily: mono }}>{isI ? "Close" : "Source"}</button>}
        </div>{isO && <div style={{ marginTop: "5px", marginLeft: "40px", color: "#9ca3af", fontSize: "12px" }}>{f.label}</div>}
      </div>; })}
    </div>
    {exp && ins && (() => { const f = D.stackFrames.find(x => x.id === ins); if (!f?.source) return null; const c = FC[f.color]; return <div style={{ width: "360px", flexShrink: 0, background: "rgba(0,0,0,0.3)", border: `1px solid ${c.border}33`, borderRadius: "8px", padding: "14px", alignSelf: "flex-start" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}><span style={{ color: c.text, fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>FRAME [{f.id}]</span><CopyBtn text={f.source} /></div><pre style={{ fontFamily: mono, fontSize: "11px", color: "#d1d5db", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>{f.source}</pre></div>; })()}
    </div></div>;
}

function Journey() { return <div style={{ position: "relative", paddingLeft: "24px" }}><div style={{ position: "absolute", left: "7px", top: "4px", bottom: "4px", width: "1px", background: "rgba(255,255,255,0.08)" }} />{D.userJourney.map((s, i) => <div key={s.step} style={{ position: "relative", paddingBottom: i < D.userJourney.length - 1 ? "14px" : "0" }}><div style={{ position: "absolute", left: "-20px", top: "4px", width: "11px", height: "11px", borderRadius: "50%", background: s.isFailure ? "#ef4444" : "rgba(255,255,255,0.08)", border: `2px solid ${s.isFailure ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.12)"}`, zIndex: 1 }} /><span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono, marginRight: "8px" }}>{s.step}.</span><span style={{ color: s.isFailure ? "#fca5a5" : "#d1d5db", fontSize: "13px" }}>{s.action}</span></div>)}</div>; }

function Remed() {
  const PS = { p0: { a: "#ef4444", l: "P0 — FIX TODAY" }, p1: { a: "#f59e0b", l: "P1 — THIS SPRINT" }, p2: { a: "#6b7280", l: "P2 — NEXT RELEASE" } };
  return <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>{Object.entries(PS).map(([k, s]) => { const items = D.remediation[k]; if (!items?.length) return null; return <div key={k}><div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: s.a, marginBottom: "8px", fontFamily: mono }}>{s.l}</div>{items.map((it, i) => <div key={i} style={{ background: `${s.a}0a`, border: `1px solid ${s.a}22`, borderRadius: "6px", padding: "12px", marginBottom: "6px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600 }}>{it.title}</span><div style={{ display: "flex", gap: "6px" }}>{it.risk && <Tag text={`Risk: ${it.risk}`} color="#9ca3af" />}{it.time && <Tag text={`⏱ ${it.time}`} color="#9ca3af" />}</div></div>{it.location && <div style={{ fontSize: "12px", color: "#93c5fd", fontFamily: mono, marginBottom: "6px" }}>📍 {it.location}</div>}{it.description && <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5 }}>{it.description}</div>}{it.code && <div style={{ marginTop: "8px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}><span style={{ fontSize: "10px", color: "#6b7280", fontFamily: mono }}>PROPOSED FIX</span><CopyBtn text={it.code} label="Copy" /></div><pre style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "4px", padding: "10px", fontSize: "11.5px", color: "#d1d5db", fontFamily: mono, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{it.code}</pre></div>}{it.before && <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}><div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "4px", padding: "8px" }}><div style={{ fontSize: "10px", color: "#ef4444", fontFamily: mono, marginBottom: "3px" }}>BEFORE</div><div style={{ fontSize: "11px", color: "#fca5a5", fontFamily: mono }}>{it.before}</div></div><div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "4px", padding: "8px" }}><div style={{ fontSize: "10px", color: "#10b981", fontFamily: mono, marginBottom: "3px" }}>AFTER</div><div style={{ fontSize: "11px", color: "#6ee7b7", fontFamily: mono }}>{it.after}</div></div></div>}</div>)}</div>; })}</div>;
}

function Repro() { return <div><div>{D.reproduction.steps.map((s, i) => <div key={i} style={{ display: "flex", gap: "8px", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}><span style={{ color: "#6b7280", fontSize: "12px", fontFamily: mono, width: "20px" }}>{i + 1}.</span><span style={{ color: "#d1d5db", fontSize: "13px" }}>{s}</span></div>)}</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "12px" }}><div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "6px", padding: "12px", borderLeft: "3px solid #10b981" }}><div style={{ color: "#10b981", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "5px", fontFamily: mono }}>EXPECTED</div><div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{D.reproduction.expected}</div></div><div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "6px", padding: "12px", borderLeft: "3px solid #ef4444" }}><div style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "5px", fontFamily: mono }}>ACTUAL</div><div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{D.reproduction.actual}</div></div></div></div>; }

// ═══ Expanded Panels ═══
function SimilarCrashes() {
  const sc = { fixed: "#10b981", open: "#f59e0b" };
  return <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>{D.similarCrashes.map(c => <div key={c.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "11px", display: "flex", alignItems: "center", gap: "12px" }}>
    <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: `conic-gradient(${c.similarity > 0.9 ? "#ef4444" : "#f59e0b"} ${c.similarity * 360}deg, rgba(255,255,255,0.04) 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#111114", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontFamily: mono, color: "#d1d5db", fontWeight: 700 }}>{Math.round(c.similarity * 100)}</div></div>
    <div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ color: "#e5e7eb", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{c.id}</span><Tag text={c.site} color="#8b5cf6" /><Tag text={c.status.toUpperCase()} color={sc[c.status]} /></div><div style={{ color: "#6b7280", fontSize: "11px", marginTop: "3px" }}>{c.component} · {c.date}</div></div>
  </div>)}</div>;
}

function HealthGauges() {
  const G = ({ label, val, max, unit, note }) => { const pct = Math.round(val / max * 100); const c = pct > 80 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#10b981"; return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "12px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ color: "#9ca3af", fontSize: "11px" }}>{label}</span><span style={{ color: c, fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>{val}{unit || ""} / {max}{unit || ""}</span></div><div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: c, borderRadius: "2px" }} /></div>{note && <div style={{ color: "#f59e0b", fontSize: "10px", marginTop: "5px" }}>⚠ {note}</div>}</div>; };
  const h = D.envHealth;
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
    <G label="TEMP Tablespace" val={h.temp.used} max={h.temp.max} unit=" GB" />
    <G label="Connection Pool" val={h.pool.used} max={h.pool.max} />
    <G label="Memory Heap" val={h.heap.used} max={h.heap.max} unit=" GB" />
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "12px" }}><span style={{ color: "#9ca3af", fontSize: "11px" }}>Oracle Version</span><div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: mono, marginTop: "6px" }}>Client {h.version.client} → Server {h.version.server}</div>{h.version.warn && <div style={{ color: "#f59e0b", fontSize: "10px", marginTop: "5px" }}>⚠ {h.version.warn}</div>}</div>
  </div>;
}

function PermMatrix() {
  return <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", padding: "8px 14px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}><span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>FUNCTIONALITY</span><span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>GRANTED</span><span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>REQUIRED</span></div>
    {D.permissions.granted.map(g => { const hit = g.fn === D.permissions.required.fn; return <div key={g.fn} style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", padding: "7px 14px", borderBottom: "1px solid rgba(255,255,255,0.03)", background: hit ? "rgba(239,68,68,0.06)" : "transparent" }}><span style={{ color: hit ? "#fca5a5" : "#d1d5db", fontSize: "12px", fontFamily: mono }}>{g.fn}</span><span style={{ color: hit ? "#fca5a5" : "#9ca3af", fontSize: "12px", fontFamily: mono }}>{g.level}</span><span style={{ color: hit ? "#ef4444" : "#4b5563", fontSize: "12px", fontFamily: mono, fontWeight: hit ? 700 : 400 }}>{hit ? `${D.permissions.required.level} ✗` : "—"}</span></div>; })}
  </div>;
}

function SessionTL() {
  return <div style={{ display: "flex", gap: "8px" }}>{D.sessionWindows.map((w, i) => { const bad = w.status === "crashed"; return <div key={w.id} style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}><div style={{ flex: 1, background: bad ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${bad ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: "8px", padding: "12px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}><span style={{ width: "18px", height: "18px", borderRadius: "4px", background: bad ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontFamily: mono, color: bad ? "#ef4444" : "#6b7280", fontWeight: 700 }}>{w.id}</span><span style={{ color: bad ? "#fca5a5" : "#d1d5db", fontSize: "12px", fontWeight: 600 }}>{w.name}</span></div><div style={{ display: "flex", gap: "8px" }}><span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{w.time}</span><Tag text={w.status.toUpperCase()} color={bad ? "#ef4444" : "#10b981"} /></div></div>{i < D.sessionWindows.length - 1 && <span style={{ color: "#4b5563", fontSize: "16px" }}>→</span>}</div>; })}</div>;
}

function Blast() {
  const sc = { vulnerable: { c: "#ef4444", i: "✗" }, safe: { c: "#10b981", i: "✓" }, unknown: { c: "#6b7280", i: "?" } };
  const groups = { vulnerable: D.blastRadius.filter(x => x.s === "vulnerable"), safe: D.blastRadius.filter(x => x.s === "safe"), unknown: D.blastRadius.filter(x => x.s === "unknown") };
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>{Object.entries(groups).map(([k, items]) => { if (!items.length) return null; const s = sc[k]; return <div key={k} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${s.c}22`, borderRadius: "8px", padding: "12px" }}><div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}><span style={{ color: s.c, fontWeight: 700, fontSize: "12px" }}>{s.i}</span><span style={{ color: s.c, fontSize: "10px", fontWeight: 700, letterSpacing: ".08em", fontFamily: mono, textTransform: "uppercase" }}>{k}</span><span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>({items.length})</span></div>{items.map(x => <div key={x.c} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", color: "#d1d5db", fontSize: "12px", fontFamily: mono }}>{x.c}</div>)}</div>; })}</div>;
}

function Confidence() {
  const S = [{ k: "confirmed", l: "CONFIRMED", c: "#10b981", i: "✓", d: "Direct evidence in WCR" }, { k: "inferred", l: "INFERRED", c: "#f59e0b", i: "~", d: "Pattern-based, not proven" }, { k: "unknown", l: "UNKNOWN", c: "#6b7280", i: "?", d: "Cannot determine from available data" }];
  return <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{S.map(s => <div key={s.k} style={{ background: `${s.c}08`, border: `1px solid ${s.c}22`, borderRadius: "8px", padding: "12px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}><span style={{ width: "16px", height: "16px", borderRadius: "3px", background: `${s.c}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: s.c, fontFamily: mono }}>{s.i}</span><span style={{ color: s.c, fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono }}>{s.l}</span><span style={{ color: "#4b5563", fontSize: "10px" }}>— {s.d}</span></div>{D.confidence[s.k].map((t, i) => <div key={i} style={{ padding: "3px 0 3px 22px", color: "#d1d5db", fontSize: "12px", lineHeight: 1.5, borderBottom: i < D.confidence[s.k].length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>{t}</div>)}</div>)}</div>;
}

function Notes() {
  const [notes, setN] = useState([]);
  const [v, setV] = useState("");
  const add = () => { if (!v.trim()) return; setN([...notes, { text: v.trim(), time: new Date().toLocaleTimeString() }]); setV(""); };
  return <div>{notes.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "10px" }}>{notes.map((n, i) => <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px", padding: "10px" }}><div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{n.text}</div><div style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono, marginTop: "3px" }}>analyst · {n.time}</div></div>)}</div>}<div style={{ display: "flex", gap: "8px" }}><input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Add investigation note..." style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "8px 12px", color: "#d1d5db", fontSize: "12px", fontFamily: sans, outline: "none" }} /><button onClick={add} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#9ca3af", padding: "8px 14px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>Add</button></div></div>;
}

// ═══ Tab Views ═══
function DevView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="CLASSIFICATION"><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}><Crd label="Exception" value={D.cause.type} accent="#ef4444" /><Crd label="Component" value={D.classification.component} accent="#3b82f6" /><Crd label="Operation" value={D.classification.operation} accent="#3b82f6" /></div><div style={{ marginTop: "10px", padding: "10px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}><div style={{ color: "#9ca3af", fontSize: "12px" }}><strong style={{ color: "#e5e7eb" }}>Signature:</strong> {D.classification.signature}</div><div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "3px" }}><strong style={{ color: "#e5e7eb" }}>Permission:</strong> {D.cause.permission.functionality} / {D.cause.permission.level} ({D.cause.permission.msg_id})</div></div></Sec>
  {exp && <Sec title="PERMISSION MATRIX"><PermMatrix /></Sec>}
  <Sec title="ENVIRONMENT"><MetaPanel /></Sec>
  {exp && <Sec title="ENVIRONMENT HEALTH"><HealthGauges /></Sec>}
  <Sec title="STACK TRACE"><Stack exp={exp} /></Sec>
  <Sec title="USER ACTION RECONSTRUCTION"><Journey /></Sec>
  {exp && <Sec title="SESSION WINDOWS"><SessionTL /></Sec>}
  <Sec title="REMEDIATION"><Remed /></Sec>
  {exp && <Sec title="BLAST RADIUS"><Blast /></Sec>}
  <Sec title="REPRODUCTION"><Repro /></Sec>
  {exp && <Sec title="SIMILAR CRASHES"><SimilarCrashes /></Sec>}
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
  {exp && <Sec title="INVESTIGATION NOTES"><Notes /></Sec>}
</div>; }

function SupView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="QUICK SUMMARY"><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}><Crd label="Site" value={D.metadata.site} accent="#8b5cf6" /><Crd label="Severity" value="HIGH" accent="#f59e0b" /><Crd label="Component" value={D.classification.component} accent="#3b82f6" /><Crd label="Fix ETA" value="Next patch" accent="#10b981" /></div></Sec>
  <Sec title="VERDICT"><div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "6px", padding: "14px" }}><div style={{ color: "#fca5a5", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>Bug — Unhandled Permission Violation</div><div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>User tried to delete a transmission event but lacks the required permission. System crashed instead of showing a message.</div></div></Sec>
  {exp && <Sec title="PERMISSION MATRIX"><PermMatrix /></Sec>}
  <Sec title="USER EXPERIENCE"><Journey /></Sec>
  {exp && <Sec title="SESSION WINDOWS"><SessionTL /></Sec>}
  <Sec title="WORKAROUND"><div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "6px", padding: "14px" }}><div style={{ color: "#6ee7b7", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>Immediate Resolution</div><ol style={{ margin: 0, paddingLeft: "20px", color: "#d1d5db", fontSize: "13px", lineHeight: 1.8 }}><li>Grant <strong>Editor</strong> for <strong>TxScheduleManagement</strong></li><li>User logs out and back in</li><li>Delete will succeed</li></ol></div></Sec>
  <Sec title="REPRODUCTION"><Repro /></Sec>
  {exp && <Sec title="SIMILAR CRASHES"><SimilarCrashes /></Sec>}
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
  {exp && <Sec title="INVESTIGATION NOTES"><Notes /></Sec>}
</div>; }

const custReply = `Dear colleague,

Thank you for reporting this issue.

SUMMARY
The application crashed when deleting a transmission event. The user account does not have the required "Editor" permission for Transmission Schedule Management.

WORKAROUND
Grant "Editor" permission for "TxScheduleManagement" to the user. Log out and back in.

RESOLUTION
A fix will be included in the next patch release.

Kind regards,
MediaGenix Support`;

function CustView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="CUSTOMER-FACING REPLY" actions={<CopyBtn text={custReply} label="Copy reply" />}><div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "20px" }}><pre style={{ fontFamily: sans, fontSize: "13px", color: "#d1d5db", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}>{custReply}</pre></div></Sec>
  <Sec title="SUMMARY TABLE"><div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>{[["Ticket", D.metadata.crash_id], ["Verdict", "Bug — crash instead of friendly message"], ["Affects", "TxEvent deletion in Trailer Grid Planner"], ["Workaround", "Grant Editor for TxScheduleManagement"], ["Fix scope", "Base product"], ["Severity", "HIGH"]].map(([k, v], i) => <div key={k} style={{ display: "flex", padding: "9px 14px", borderBottom: i < 5 ? "1px solid rgba(255,255,255,0.04)" : "none" }}><span style={{ color: "#6b7280", fontSize: "12px", width: "110px", flexShrink: 0 }}>{k}</span><span style={{ color: "#d1d5db", fontSize: "12px" }}>{v}</span></div>)}</div></Sec>
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
</div>; }

function ExecView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <div style={{ background: "linear-gradient(135deg,rgba(239,68,68,0.08),rgba(245,158,11,0.06))", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "10px", padding: "20px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div><div style={{ color: "#e5e7eb", fontSize: "18px", fontWeight: 700, marginBottom: "5px" }}>Application Crash — Permission Handling</div><div style={{ color: "#9ca3af", fontSize: "13px", lineHeight: 1.6, maxWidth: "520px" }}>User action caused crash. Permission enforcement works; UI error handling does not.</div></div><Bdg severity="high" /></div></div>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>{[{ l: "IMPACT", v: "Single User", s: "Restricted permissions" }, { l: "DATA RISK", v: "None", s: "Fails before data change", c: "#6ee7b7" }, { l: "FIX EFFORT", v: "2-3 Hours", s: "Low risk", c: "#f59e0b" }].map(c => <div key={c.l} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "14px", textAlign: "center" }}><div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono, marginBottom: "6px" }}>{c.l}</div><div style={{ color: c.c || "#e5e7eb", fontSize: "14px", fontWeight: 600 }}>{c.v}</div><div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "3px" }}>{c.s}</div></div>)}</div>
  <Sec title="RESOLUTION PATH"><div style={{ display: "flex", gap: "10px" }}>{[{ p: "Now", l: "Workaround", d: "Grant permission", c: "#10b981" }, { p: "This week", l: "P0 Fix", d: "Permission pre-check", c: "#f59e0b" }, { p: "Sprint", l: "Harden", d: "Framework exception handling", c: "#3b82f6" }].map(it => <div key={it.p} style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: `1px solid ${it.c}33`, borderTop: `3px solid ${it.c}`, borderRadius: "0 0 6px 6px", padding: "12px" }}><div style={{ color: it.c, fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{it.p.toUpperCase()}</div><div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "5px" }}>{it.l}</div><div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "3px" }}>{it.d}</div></div>)}</div></Sec>
  {exp && <Sec title="BLAST RADIUS"><Blast /></Sec>}
  {exp && <Sec title="SIMILAR CRASHES"><SimilarCrashes /></Sec>}
</div>; }

// ═══ Quick Actions ═══
function QActions({ onExport }) {
  const [a, setA] = useState(null);
  const items = [{ id: "jira", l: "Create JIRA", i: "⊞" }, { id: "assign", l: "Assign to Dev", i: "→" }, { id: "reply", l: "Send Reply", i: "✉" }, { id: "pattern", l: "Add to Patterns", i: "◎" }];
  return <div style={{ position: "sticky", bottom: 0, background: "#0d0d10", borderTop: "1px solid rgba(255,255,255,0.08)", padding: "10px 24px", display: "flex", justifyContent: "space-between", zIndex: 50 }}>
    <div style={{ display: "flex", gap: "6px" }}>{items.map(x => <button key={x.id} onClick={() => { setA(x.id); setTimeout(() => setA(null), 2000); }} style={{ background: a === x.id ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${a === x.id ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.08)"}`, color: a === x.id ? "#6ee7b7" : "#d1d5db", padding: "6px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: "5px", transition: "all .15s" }}><span>{x.i}</span>{a === x.id ? "✓" : x.l}</button>)}</div>
    <button onClick={onExport} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#d1d5db", padding: "6px 14px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>↗ Export…</button>
  </div>;
}

// ═══ Export Drawer ═══
function genDev(d) { return `# Developer Brief — ${d.metadata.crash_id}\nSite: ${d.metadata.site} | ${d.classification.severity.toUpperCase()}\n\n## Root Cause\n${d.cause.message}\n${d.classification.component} >> ${d.classification.operation}\n\n## Stack\n${d.stackFrames.map(f => `[${f.id}] ${f.method} — ${f.label}`).join("\n")}\n\n## P0 Fix\n${d.remediation.p0[0].location}\n\`\`\`\n${d.remediation.p0[0].code}\n\`\`\``; }
function genCust() { return custReply; }
function genSupp(d) { return `# Support Summary — ${d.metadata.crash_id}\nSite: ${d.metadata.site} | Severity: HIGH\nVerdict: Bug — unhandled permission violation\nWorkaround: Grant Editor for TxScheduleManagement\nFix: Next patch (2-3h)`; }
function genFull(d) { return `# Full Report — ${d.metadata.crash_id}\nGenerated: ${new Date().toLocaleString()}\n\n## Environment\nSite: ${d.metadata.site} | User: ${d.metadata.username}\nWHATS'ON: ${d.metadata.versions.whatson} | Oracle: ${d.metadata.versions.oracle_server}\n\n## Classification\n${d.classification.type} | ${d.classification.severity.toUpperCase()}\nSignature: ${d.classification.signature}\n\n## Stack Trace\n${d.stackFrames.map(f => `[${f.id}] [${f.color.toUpperCase()}] ${f.method}\n    → ${f.label}`).join("\n")}\n\n## Remediation\n### P0: ${d.remediation.p0[0].title}\nLocation: ${d.remediation.p0[0].location}\n\`\`\`\n${d.remediation.p0[0].code}\n\`\`\`\n\n## Reproduction\n${d.reproduction.steps.map((s,i)=>`${i+1}. ${s}`).join("\n")}\nExpected: ${d.reproduction.expected}\nActual: ${d.reproduction.actual}`; }
function dlBlob(c, f, t) { const b = new Blob([c], { type: t }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = f; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }
function genDocx(d) { const md = genFull(d); let h = ""; let ic = false; for (const l of md.split("\n")) { if (l.startsWith("```")) { ic = !ic; if (ic) h += '<pre style="background:#f3f4f6;padding:10px;font-family:Consolas;font-size:10pt;">'; else h += "</pre>"; continue; } if (ic) { h += l + "\n"; continue; } if (l.startsWith("# ")) h += `<h1 style="font-size:16pt;border-bottom:2px solid #111;">${l.slice(2)}</h1>`; else if (l.startsWith("## ")) h += `<h2 style="font-size:13pt;color:#1e3a5f;">${l.slice(3)}</h2>`; else if (l.startsWith("### ")) h += `<h3 style="font-size:11pt;">${l.slice(4)}</h3>`; else if (l.trim() === "") h += "<br>"; else h += `<p style="font-size:10pt;line-height:1.5;">${l}</p>`; } return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>@page{size:A4;margin:2.5cm}body{font-family:Calibri}</style></head><body>${h}</body></html>`; }

function ExportDrawer({ isOpen, onClose }) {
  const [cp, setCp] = useState(null);
  const [dl, setDl] = useState(null);
  const [pv, setPv] = useState(null);
  const clips = [
    { id: "dev", l: "Developer Brief", f: "MD", d: "Stack, root cause, P0 fix, repro", fn: genDev, a: "#3b82f6" },
    { id: "sup", l: "Support Summary", f: "MD", d: "Verdict, workaround, handoff", fn: genSupp, a: "#8b5cf6" },
    { id: "cust", l: "Customer Reply", f: "TXT", d: "Ready-to-send email", fn: () => genCust(), a: "#10b981" },
    { id: "jira", l: "JIRA Ticket", f: "MD", d: "Pre-formatted bug report", fn: d => `**${d.metadata.crash_id}** | ${d.metadata.site} | HIGH\n${d.cause.message}\n\nRepro:\n${d.reproduction.steps.map((s,i)=>`${i+1}. ${s}`).join("\n")}\n\nFix: ${d.remediation.p0[0].location}\nWorkaround: Grant Editor → re-login`, a: "#f59e0b" },
    { id: "slack", l: "Slack Message", f: "TXT", d: "Channel summary", fn: d => `🔴 *${d.metadata.crash_id}* — ${d.metadata.site} — HIGH\n\`${d.classification.component}\`\nPermission violation crash. Fix: pre-check in deleteKeyPressed (2-3h). Workaround: grant permission.`, a: "#e879f9" },
  ];
  const dls = [
    { id: "docx", l: "Full Report", f: "DOCX", d: "Word document", a: "#3b82f6", fn: () => dlBlob(genDocx(D), `${D.metadata.crash_id}_report.doc`, "application/msword") },
    { id: "md", l: "Full Report", f: "MD", d: "Markdown file", a: "#6b7280", fn: () => dlBlob(genFull(D), `${D.metadata.crash_id}_report.md`, "text/markdown") },
  ];
  const copy = it => { clip(it.fn(D)); setCp(it.id); setTimeout(() => setCp(null), 2200); };
  const down = it => { it.fn(); setDl(it.id); setTimeout(() => setDl(null), 2500); };
  const pvItem = pv ? clips.find(x => x.id === pv) : null;
  if (!isOpen) return null;
  return <><div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, backdropFilter: "blur(2px)" }} />
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: pvItem ? "700px" : "370px", background: "#111114", borderLeft: "1px solid rgba(255,255,255,0.08)", zIndex: 201, display: "flex", flexDirection: "column", transition: "width .25s", boxShadow: "-20px 0 60px rgba(0,0,0,0.4)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 600 }}>Export Analysis</div><div style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{D.metadata.crash_id}</div></div><button onClick={onClose} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#9ca3af", width: "26px", height: "26px", borderRadius: "5px", cursor: "pointer", fontSize: "13px" }}>×</button></div>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: pvItem ? "0 0 370px" : "1", overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div><div style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "8px" }}>⎘ COPY TO CLIPBOARD</div><div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {clips.map(it => { const ok = cp === it.id; const isPv = pv === it.id; return <div key={it.id} style={{ background: ok ? "rgba(16,185,129,0.08)" : isPv ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${ok ? "rgba(16,185,129,0.2)" : isPv ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)"}`, borderRadius: "7px", padding: "10px", transition: "all .15s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{it.l}</span><Tag text={it.f} color={it.a} /></div>
              <div style={{ color: "#6b7280", fontSize: "11px", marginTop: "3px" }}>{it.d}</div>
              <div style={{ display: "flex", gap: "5px", marginTop: "8px" }}>
                <button onClick={() => copy(it)} style={{ background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)", border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`, color: ok ? "#6ee7b7" : "#d1d5db", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono, transition: "all .15s" }}>{ok ? "✓ Copied" : "Copy"}</button>
                <button onClick={() => setPv(isPv ? null : it.id)} style={{ background: isPv ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${isPv ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`, color: isPv ? "#d1d5db" : "#6b7280", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>{isPv ? "Hide" : "Preview"}</button>
              </div></div>; })}
          </div></div>
          <div><div style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "8px" }}>↓ DOWNLOAD FILE</div><div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {dls.map(it => { const ok = dl === it.id; return <div key={it.id} style={{ background: ok ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${ok ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.04)"}`, borderRadius: "7px", padding: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}><span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{it.l}</span><Tag text={it.f} color={it.a} /></div>
              <div style={{ color: "#6b7280", fontSize: "11px", marginBottom: "8px" }}>{it.d}</div>
              <button onClick={() => down(it)} style={{ background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)", border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`, color: ok ? "#6ee7b7" : "#d1d5db", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>{ok ? "✓ Downloaded" : `↓ .${it.f.toLowerCase()}`}</button>
            </div>; })}</div></div>
        </div>
        {pvItem && <div style={{ flex: 1, borderLeft: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}><div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{pvItem.l}</span><button onClick={() => copy(pvItem)} style={{ background: cp === pvItem.id ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: cp === pvItem.id ? "#6ee7b7" : "#d1d5db", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>{cp === pvItem.id ? "✓" : "Copy"}</button></div><div style={{ flex: 1, overflow: "auto", padding: "14px" }}><pre style={{ fontFamily: mono, fontSize: "11px", color: "#9ca3af", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>{pvItem.fn(D)}</pre></div></div>}
      </div>
    </div></>;
}

// ═══ Main ═══
const tabs = [{ id: "support", l: "Support Engineer", i: "◎" }, { id: "developer", l: "Developer", i: "⌘" }, { id: "customer", l: "Customer-Facing", i: "✉" }, { id: "executive", l: "Executive", i: "◈" }];

export default function App() {
  const [tab, setTab] = useState("support");
  const [exp, setExp] = useState(false);
  const [xport, setXport] = useState(false);
  useEffect(() => { const h = e => { if (e.key === "Escape") setXport(false); }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);
  const sev = SEV[D.classification.severity];
  return <div style={{ background: "#0a0a0c", color: "#d1d5db", minHeight: "100vh", fontFamily: sans, display: "flex", flexDirection: "column" }}>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
    <ExportDrawer isOpen={xport} onClose={() => setXport(false)} />
    {/* Header */}
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "11px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}><div style={{ width: "8px", height: "8px", borderRadius: "2px", background: sev.color }} /><span style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 700, fontFamily: mono }}>{D.metadata.crash_id}</span></div>
        <Bdg severity={D.classification.severity} />
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{D.metadata.site}</span>
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{D.classification.component}</span>
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{new Date(D.metadata.timestamp).toLocaleDateString()}</span>
      </div>
      <div style={{ display: "flex", gap: "7px" }}>
        <button onClick={() => setExp(!exp)} style={{ background: exp ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${exp ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.1)"}`, color: exp ? "#c4b5fd" : "#9ca3af", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono, transition: "all .2s" }}>{exp ? "◉ Expanded" : "○ Standard"}</button>
        <button onClick={() => setXport(true)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#d1d5db", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>↗ Export</button>
      </div>
    </div>
    {/* Cause */}
    <div style={{ padding: "9px 24px", background: "rgba(239,68,68,0.04)", borderBottom: "1px solid rgba(239,68,68,0.1)", display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "#ef4444", fontSize: "12px", fontFamily: mono, fontWeight: 700 }}>{D.cause.type}</span><span style={{ color: "#4b5563" }}>—</span><span style={{ color: "#fca5a5", fontSize: "12px" }}>{D.cause.message}</span></div>
    {/* Tabs */}
    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", background: "rgba(255,255,255,0.01)" }}>{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", padding: "10px 18px", color: tab === t.id ? "#e5e7eb" : "#6b7280", fontSize: "12px", cursor: "pointer", borderBottom: tab === t.id ? "2px solid #e5e7eb" : "2px solid transparent", fontFamily: sans, fontWeight: tab === t.id ? 600 : 400, display: "flex", alignItems: "center", gap: "5px", marginBottom: "-1px", transition: "all .15s" }}><span style={{ fontSize: "11px", opacity: tab === t.id ? 1 : 0.5 }}>{t.i}</span>{t.l}</button>)}</div>
    {/* Content */}
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", maxWidth: "1060px" }}>
      {tab === "support" && <SupView exp={exp} />}
      {tab === "developer" && <DevView exp={exp} />}
      {tab === "customer" && <CustView exp={exp} />}
      {tab === "executive" && <ExecView exp={exp} />}
    </div>
    {exp && <QActions onExport={() => setXport(true)} />}
  </div>;
}
