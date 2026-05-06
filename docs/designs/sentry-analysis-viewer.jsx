import { useState, useMemo } from "react";

const mono = "'JetBrains Mono','Fira Code',monospace";
const sans = "'IBM Plex Sans',-apple-system,sans-serif";

// ═══ Sentry Issue Mock Data ═══
const S = {
  issue: { id: "3847291056", shortId: "WHATSON-4A7", url: "https://mediagenix.sentry.io/issues/3847291056/", firstSeen: "2025-04-18T09:14:22Z", lastSeen: "2025-04-28T14:47:03Z", events: 37, users: 5, status: "unresolved", priority: "high", level: "error", platform: "java", assignedTo: null },
  release: { version: "whatson@2024r8.000.003a", env: "production", firstRelease: "whatson@2024r8.000.002c", deploy: "BBC-PROD-2025-04-18" },
  tags: { site: "BBC-Production", server: "mgx-app-bbc-03", oracle: "19c", module: "CM2RUN", browser: "G4BrowserCM2Run", role: "planner", windowCount: "4" },
  exception: { type: "ORA-01652", value: "unable to extend temp segment by 128 in tablespace TEMP", mechanism: "oracleSQLException", module: "MediaGeniX.OracleDatabaseConnector" },
  frames: [
    { fn: "oracle.jdbc.driver.T4CTTIoer.processError", file: "T4CTTIoer.java:450", cat: "oracle" },
    { fn: "oracle.jdbc.driver.T4CTTIoer.processError", file: "T4CTTIoer.java:399", cat: "oracle" },
    { fn: "MediaGeniX.OOPLensQuery >> executeOn:", file: null, cat: "app" },
    { fn: "MediaGeniX.G4BrowserCM2Run >> refreshBrowserContents", file: null, cat: "app" },
    { fn: "MediaGeniX.G4Browser >> doSearch", file: null, cat: "app" },
  ],
  breadcrumbs: [
    { ts: "14:46:41", cat: "ui.click", msg: "User clicked 'Search' in CM2Run browser", level: "info" },
    { ts: "14:46:41", cat: "query", msg: "OOPLensQuery building SELECT DISTINCT on CM2RUN", level: "info" },
    { ts: "14:46:42", cat: "db", msg: "Executing query against Oracle 19c — TEMP at 94%", level: "warning" },
    { ts: "14:47:03", cat: "db.error", msg: "ORA-01652: unable to extend temp segment by 128 in tablespace TEMP", level: "error" },
  ],
  contexts: {
    oracle: { temp_size_gb: 32, temp_pct: 100, active_sessions: 48, largest_sid: 1247, query_sec: 21 },
    app: { active_users: 23, open_browsers: 67, jvm_heap_used: 3104, jvm_heap_max: 4096 },
  },
  fingerprint: ["ORA-01652", "TEMP", "CM2RUN", "G4Browser", "SELECT-DISTINCT"],
  eventTimeline: [
    { date: "04-18", count: 1 }, { date: "04-19", count: 0 }, { date: "04-20", count: 0 },
    { date: "04-21", count: 2 }, { date: "04-22", count: 3 }, { date: "04-23", count: 4 },
    { date: "04-24", count: 5 }, { date: "04-25", count: 6 }, { date: "04-26", count: 0 },
    { date: "04-27", count: 0 }, { date: "04-28", count: 8 },
  ],
  hourDistribution: [
    { range: "06–09", count: 3, pct: 8 }, { range: "09–12", count: 14, pct: 38 },
    { range: "12–15", count: 12, pct: 32 }, { range: "15–18", count: 8, pct: 22 },
    { range: "18–06", count: 0, pct: 0 },
  ],
  tagFacets: [
    { tag: "browser.window", values: [{ v: "G4BrowserCM2Run", pct: 78 }, { v: "G4BrowserCM2Contract", pct: 22 }] },
    { tag: "user.role", values: [{ v: "planner", pct: 100 }] },
    { tag: "site", values: [{ v: "BBC-Production", pct: 100 }] },
  ],
  similarIssues: [
    { id: "WHATSON-3F2", title: "ORA-01652 on G4BrowserCM2Contract", events: 18, users: 3, similarity: 0.92, status: "unresolved" },
    { id: "WHATSON-2B9", title: "Query timeout in G4BrowserCM2MediaAsset", events: 9, users: 2, similarity: 0.71, status: "resolved" },
  ],
  remediation: {
    p0: [
      { title: "Fix DISTINCT to OID-only", location: "OOPLensQuery >> buildSelectClause", time: "4-6 hours", risk: "Low", before: "SELECT DISTINCT all_columns → 800MB TEMP/query → 5 concurrent = 4GB → exhaustion", after: "SELECT DISTINCT oid_only → 12MB TEMP/query → 50 concurrent = 600MB → healthy" },
      { title: "Extend TEMP tablespace", time: "30 min", risk: "None", sql: "ALTER TABLESPACE TEMP ADD TEMPFILE\n  '/u02/oradata/temp03.dbf'\n  SIZE 16G AUTOEXTEND ON MAXSIZE 32G;" },
    ],
    p1: [
      { title: "Oracle Resource Manager TEMP quota", time: "1 day", description: "Cap per-session TEMP at 2GB. Prevents single query from starving all others." },
      { title: "Query timeout + graceful error handling", time: "4 hours", description: "30-second timeout with user-friendly message. Sentry event with diagnostic context." },
      { title: "Sentry context enrichment", time: "1 day", description: "Add Oracle health metrics to every database event. Enable trend dashboards." },
    ],
    p2: [
      { title: "Server-side pagination", time: "3-4 months", description: "FETCH FIRST N ROWS ONLY pattern. Eliminates unbounded result sets entirely." },
    ],
  },
  alerts: [
    { name: "ORA-01652 TEMP Exhaustion", condition: "≥3 events in 1h", target: "#whatson-prod-alerts", severity: "critical" },
    { name: "TEMP Usage Above 80%", condition: "avg(oracle.temp_usage_pct) > 80 for 15m", target: "#whatson-dba", severity: "warning" },
    { name: "G4Browser Error Spike", condition: "≥10 events in 30m", target: "PagerDuty: whatson-l2", severity: "high" },
  ],
  confidence: {
    confirmed: ["ORA-01652 raised on SID 1247 at 14:47:03 (Sentry event data)", "37 events over 10 days, 5 unique users (Sentry aggregation)", "100% correlation with G4Browser search + OOPLensQuery (stack trace + breadcrumbs)", "TEMP at 100% at time of crash (Sentry oracle context)"],
    inferred: ["All G4Browser subclasses share OOPLensQuery — same vulnerability (code analysis)", "BBC-only due to dataset size — smaller sites don't hit threshold (tag facet: 100% BBC)"],
    unknown: ["Whether BBC has custom OOPLensQuery overrides", "Whether extending TEMP alone would prevent recurrence under future data growth"],
  },
};

// ═══ Primitives ═══
function clip(t) { navigator.clipboard?.writeText(t); }
function CopyBtn({ text, label = "Copy" }) { const [ok, s] = useState(false); return <button onClick={() => { clip(text); s(true); setTimeout(() => s(false), 2000); }} style={{ background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`, color: ok ? "#6ee7b7" : "#9ca3af", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>{ok ? "✓" : label}</button>; }
function Tag({ text, color }) { return <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: mono, color, background: `${color}18`, padding: "2px 6px", borderRadius: "3px", whiteSpace: "nowrap" }}>{text}</span>; }
function Crd({ label, value, accent, sub }) { return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderTop: `2px solid ${accent}`, borderRadius: "0 0 6px 6px", padding: "12px" }}><div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono }}>{label}</div><div style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 600, marginTop: "4px", fontFamily: mono }}>{value}</div>{sub && <div style={{ color: "#6b7280", fontSize: "10px", marginTop: "3px" }}>{sub}</div>}</div>; }
function Sec({ title, children, actions, open: init = true }) { const [o, s] = useState(init); return <div style={{ marginBottom: "4px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: o ? "12px" : 0, cursor: "pointer" }} onClick={() => s(!o)}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ color: "#6b7280", fontSize: "10px", transform: o ? "rotate(90deg)" : "rotate(0)", transition: "transform .15s", display: "inline-block" }}>▶</span><span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".12em", fontFamily: mono }}>{title}</span></div>{actions && o && <div onClick={e => e.stopPropagation()}>{actions}</div>}</div>{o && children}</div>; }

// ═══ Sentry-Specific Panels ═══

function EventTimeline() {
  const max = Math.max(...S.eventTimeline.map(d => d.count), 1);
  return <div><div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", padding: "0 4px" }}>
    {S.eventTimeline.map(d => <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
      <span style={{ color: d.count > 5 ? "#ef4444" : d.count > 0 ? "#f59e0b" : "#4b5563", fontSize: "10px", fontFamily: mono, fontWeight: 700 }}>{d.count || ""}</span>
      <div style={{ width: "100%", height: `${Math.max((d.count / max) * 60, d.count > 0 ? 4 : 0)}px`, background: d.count > 5 ? "#ef4444" : d.count > 0 ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.03)", borderRadius: "2px 2px 0 0", transition: "height .3s" }} />
    </div>)}
  </div>
  <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>{S.eventTimeline.map(d => <div key={d.date} style={{ flex: 1, textAlign: "center", color: "#4b5563", fontSize: "9px", fontFamily: mono }}>{d.date}</div>)}</div>
  <div style={{ color: "#6b7280", fontSize: "10px", textAlign: "center", marginTop: "6px" }}>Trend: <span style={{ color: "#ef4444", fontWeight: 700 }}>↑ accelerating</span> — 2/week → 8/week</div>
  </div>;
}

function HourDistribution() {
  return <div style={{ display: "flex", gap: "6px" }}>
    {S.hourDistribution.map(h => <div key={h.range} style={{ flex: 1, textAlign: "center" }}>
      <div style={{ height: "50px", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: "40px", height: `${Math.max(h.pct * 0.5, h.count > 0 ? 3 : 0)}px`, background: h.pct > 30 ? "#f59e0b" : h.pct > 0 ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.03)", borderRadius: "2px 2px 0 0" }} />
      </div>
      <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginTop: "4px" }}>{h.range}</div>
      <div style={{ color: h.pct > 30 ? "#f59e0b" : "#4b5563", fontSize: "10px", fontFamily: mono }}>{h.pct}%</div>
    </div>)}
  </div>;
}

function Breadcrumbs() {
  const catStyles = { "ui.click": { color: "#3b82f6", icon: "⊡" }, "query": { color: "#8b5cf6", icon: "⊞" }, "db": { color: "#22d3ee", icon: "⛁" }, "db.error": { color: "#ef4444", icon: "✗" } };
  return <div style={{ position: "relative", paddingLeft: "20px" }}>
    <div style={{ position: "absolute", left: "7px", top: "6px", bottom: "6px", width: "1px", background: "rgba(255,255,255,0.08)" }} />
    {S.breadcrumbs.map((b, i) => { const cs = catStyles[b.cat] || { color: "#6b7280", icon: "·" }; return <div key={i} style={{ position: "relative", paddingBottom: i < S.breadcrumbs.length - 1 ? "12px" : 0, display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <div style={{ position: "absolute", left: "-16px", top: "3px", width: "13px", height: "13px", borderRadius: "3px", background: `${cs.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", color: cs.color, zIndex: 1 }}>{cs.icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{b.ts}</span>
          <Tag text={b.cat} color={cs.color} />
        </div>
        <div style={{ color: b.level === "error" ? "#fca5a5" : b.level === "warning" ? "#fde68a" : "#d1d5db", fontSize: "12px", marginTop: "3px", lineHeight: 1.5 }}>{b.msg}</div>
      </div>
    </div>; })}
  </div>;
}

function TagFacets() {
  return <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
    {S.tagFacets.map(f => <div key={f.tag}>
      <div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "5px" }}>{f.tag}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        {f.values.map(v => <div key={v.v} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.04)", borderRadius: "3px", overflow: "hidden" }}><div style={{ height: "100%", width: `${v.pct}%`, background: v.pct === 100 ? "#f59e0b" : "#3b82f6", borderRadius: "3px" }} /></div>
          <span style={{ color: "#d1d5db", fontSize: "11px", fontFamily: mono, width: "200px" }}>{v.v}</span>
          <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono, width: "35px", textAlign: "right" }}>{v.pct}%</span>
        </div>)}
      </div>
    </div>)}
  </div>;
}

function ContextPanels() {
  const o = S.contexts.oracle; const a = S.contexts.app;
  const Gauge = ({ label, val, max, unit, warn }) => { const pct = Math.round(val / max * 100); const c = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#10b981"; return <div style={{ padding: "8px 0" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}><span style={{ color: "#9ca3af", fontSize: "11px" }}>{label}</span><span style={{ color: c, fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>{val}{unit} / {max}{unit}</span></div><div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px" }}><div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: c, borderRadius: "2px" }} /></div></div>; };
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
    <div style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.12)", borderRadius: "8px", padding: "14px" }}>
      <div style={{ color: "#22d3ee", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "8px" }}>⛁ ORACLE CONTEXT</div>
      <Gauge label="TEMP Tablespace" val={o.temp_pct} max={100} unit="%" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
        {[["TEMP Size", `${o.temp_size_gb} GB`], ["Active Sessions", o.active_sessions], ["Largest Consumer", `SID ${o.largest_sid}`], ["Query Duration", `${o.query_sec}s`]].map(([k, v]) => <div key={k}><div style={{ color: "#6b7280", fontSize: "9px", fontFamily: mono }}>{k}</div><div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{v}</div></div>)}
      </div>
    </div>
    <div style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: "8px", padding: "14px" }}>
      <div style={{ color: "#c4b5fd", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "8px" }}>⊞ APPLICATION CONTEXT</div>
      <Gauge label="JVM Heap" val={a.jvm_heap_used} max={a.jvm_heap_max} unit=" MB" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
        {[["Active Users", a.active_users], ["Open Browsers", a.open_browsers]].map(([k, v]) => <div key={k}><div style={{ color: "#6b7280", fontSize: "9px", fontFamily: mono }}>{k}</div><div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{v}</div></div>)}
      </div>
    </div>
  </div>;
}

function SimilarIssues() {
  const sc = { unresolved: "#f59e0b", resolved: "#10b981" };
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    {S.similarIssues.map(si => <div key={si.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "6px", padding: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: `conic-gradient(${si.similarity > 0.85 ? "#ef4444" : "#f59e0b"} ${si.similarity * 360}deg, rgba(255,255,255,0.04) 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#0d0e12", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontFamily: mono, color: "#d1d5db", fontWeight: 700 }}>{Math.round(si.similarity * 100)}</div></div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ color: "#e5e7eb", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{si.id}</span><Tag text={`${si.events} events`} color="#6b7280" /><Tag text={`${si.users} users`} color="#6b7280" /><Tag text={si.status.toUpperCase()} color={sc[si.status]} /></div>
        <div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "3px" }}>{si.title}</div>
      </div>
    </div>)}
  </div>;
}

function AlertRules() {
  const sc = { critical: "#ef4444", high: "#f59e0b", warning: "#3b82f6" };
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    {S.alerts.map((a, i) => <div key={i} style={{ background: `${sc[a.severity]}08`, border: `1px solid ${sc[a.severity]}22`, borderRadius: "6px", padding: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><Tag text={a.severity.toUpperCase()} color={sc[a.severity]} /><span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{a.name}</span></div>
        <span style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono }}>{a.target}</span>
      </div>
      <div style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono, marginTop: "6px" }}>Trigger: {a.condition}</div>
    </div>)}
  </div>;
}

function Fingerprint() {
  return <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
    {S.fingerprint.map(f => <span key={f} style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.2)", color: "#fb923c", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", fontFamily: mono, fontWeight: 600 }}>{f}</span>)}
  </div>;
}

function StackFrames() {
  const catC = { oracle: { color: "#22d3ee", bg: "rgba(6,182,212,0.06)" }, app: { color: "#f97316", bg: "rgba(249,115,22,0.06)" } };
  return <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
    {S.frames.map((f, i) => { const c = catC[f.cat]; return <div key={i} style={{ background: c.bg, borderLeft: `3px solid ${c.color}`, borderRadius: "0 4px 4px 0", padding: "7px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono, width: "16px" }}>{i + 1}</span>
      <span style={{ color: c.color, fontSize: "12px", fontFamily: mono }}>{f.fn}</span>
      {f.file && <span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono, marginLeft: "auto" }}>{f.file}</span>}
    </div>; })}
  </div>;
}

function Confidence() {
  const S2 = [{ k: "confirmed", l: "CONFIRMED", c: "#10b981", i: "✓" }, { k: "inferred", l: "INFERRED", c: "#f59e0b", i: "~" }, { k: "unknown", l: "UNKNOWN", c: "#6b7280", i: "?" }];
  return <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{S2.map(s => <div key={s.k} style={{ background: `${s.c}08`, border: `1px solid ${s.c}22`, borderRadius: "6px", padding: "10px" }}><div style={{ color: s.c, fontSize: "10px", fontWeight: 700, fontFamily: mono, marginBottom: "5px" }}>{s.i} {s.l}</div>{S.confidence[s.k].map((t, i) => <div key={i} style={{ padding: "3px 0 3px 18px", color: "#d1d5db", fontSize: "12px", lineHeight: 1.5, borderBottom: i < S.confidence[s.k].length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>{t}</div>)}</div>)}</div>;
}

function Remed() {
  const PS = { p0: { a: "#ef4444", l: "P0 — IMMEDIATE" }, p1: { a: "#f59e0b", l: "P1 — THIS SPRINT" }, p2: { a: "#6b7280", l: "P2 — STRUCTURAL" } };
  return <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{Object.entries(PS).map(([k, st]) => { const items = S.remediation[k]; if (!items?.length) return null; return <div key={k}><div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: st.a, marginBottom: "8px", fontFamily: mono }}>{st.l}</div>{items.map((it, i) => <div key={i} style={{ background: `${st.a}0a`, border: `1px solid ${st.a}22`, borderRadius: "6px", padding: "12px", marginBottom: "6px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600 }}>{it.title}</span><div style={{ display: "flex", gap: "6px" }}>{it.risk && <Tag text={`Risk: ${it.risk}`} color="#9ca3af" />}<Tag text={`⏱ ${it.time}`} color="#9ca3af" /></div></div>
    {it.location && <div style={{ fontSize: "12px", color: "#93c5fd", fontFamily: mono, marginBottom: "6px" }}>📍 {it.location}</div>}
    {it.description && <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5 }}>{it.description}</div>}
    {it.sql && <div style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><pre style={{ background: "rgba(0,0,0,0.3)", borderRadius: "4px", padding: "8px 10px", fontFamily: mono, fontSize: "11px", color: "#22d3ee", margin: 0, flex: 1, whiteSpace: "pre-wrap" }}>{it.sql}</pre><div style={{ marginLeft: "8px" }}><CopyBtn text={it.sql} /></div></div>}
    {it.before && <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}><div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "4px", padding: "8px" }}><div style={{ fontSize: "10px", color: "#ef4444", fontFamily: mono, marginBottom: "3px" }}>BEFORE</div><div style={{ fontSize: "11px", color: "#fca5a5", fontFamily: mono }}>{it.before}</div></div><div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "4px", padding: "8px" }}><div style={{ fontSize: "10px", color: "#10b981", fontFamily: mono, marginBottom: "3px" }}>AFTER</div><div style={{ fontSize: "11px", color: "#6ee7b7", fontFamily: mono }}>{it.after}</div></div></div>}
  </div>)}</div>; })}</div>;
}

// ═══ Tab Views ═══
function OverviewTab({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="ISSUE METRICS"><div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "10px" }}><Crd label="Events" value={S.issue.events} accent="#f97316" sub={`${Math.round(S.issue.events / 10)} / day avg`} /><Crd label="Users" value={S.issue.users} accent="#8b5cf6" sub="planner role" /><Crd label="First Seen" value="Apr 18" accent="#6b7280" sub={S.release.firstRelease} /><Crd label="Last Seen" value="Apr 28" accent="#f59e0b" sub="10 days active" /><Crd label="Trend" value="↑ 4×" accent="#ef4444" sub="2/wk → 8/wk" /></div></Sec>
  <Sec title="EVENT TIMELINE"><EventTimeline /></Sec>
  <Sec title="BREADCRUMB TRAIL"><Breadcrumbs /></Sec>
  <Sec title="SYSTEM CONTEXT AT FAILURE"><ContextPanels /></Sec>
  {exp && <Sec title="HOUR-OF-DAY DISTRIBUTION"><HourDistribution /></Sec>}
  {exp && <Sec title="TAG FACETS"><TagFacets /></Sec>}
  {exp && <Sec title="FINGERPRINT"><Fingerprint /></Sec>}
  {exp && <Sec title="RELEASE TRACKING"><div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px", padding: "12px" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px" }}>{[["Version", S.release.version], ["Environment", S.release.env], ["First Release", S.release.firstRelease], ["Deploy", S.release.deploy]].map(([k, v]) => <div key={k}><div style={{ color: "#6b7280", fontSize: "9px", fontFamily: mono }}>{k}</div><div style={{ color: "#d1d5db", fontSize: "12px", fontFamily: mono, fontWeight: 600, marginTop: "2px" }}>{v}</div></div>)}</div><div style={{ color: "#f59e0b", fontSize: "11px", marginTop: "8px" }}>⚠ Persists across releases — not a regression, structural defect</div></div></Sec>}
  {exp && <Sec title="SIMILAR ISSUES"><SimilarIssues /></Sec>}
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
</div>; }

function TechnicalTab({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="EXCEPTION"><div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: "6px", padding: "14px" }}><div style={{ color: "#fca5a5", fontSize: "14px", fontFamily: mono, fontWeight: 700 }}>{S.exception.type}</div><div style={{ color: "#d1d5db", fontSize: "12px", marginTop: "4px" }}>{S.exception.value}</div><div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><Tag text={S.exception.mechanism} color="#f97316" /><Tag text={S.exception.module} color="#8b5cf6" /></div></div></Sec>
  <Sec title="STACK TRACE"><StackFrames /></Sec>
  <Sec title="ROOT CAUSE"><div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "16px" }}><div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>OOPLensQuery generates <code style={{ color: "#22d3ee", background: "rgba(6,182,212,0.1)", padding: "1px 4px", borderRadius: "3px" }}>SELECT DISTINCT</code> on all projected columns for G4Browser searches. On large tables (CM2RUN at BBC: millions of rows), this forces Oracle to create massive TEMP sort segments. Under concurrent load, TEMP (32GB) is exhausted.</div><div style={{ marginTop: "12px", background: "rgba(16,185,129,0.06)", borderRadius: "6px", padding: "10px" }}><span style={{ color: "#10b981", fontSize: "11px", fontWeight: 700, fontFamily: mono }}>FIX: </span><span style={{ color: "#6ee7b7", fontSize: "12px" }}>DISTINCT on OID only is mathematically equivalent. Reduces TEMP from ~800MB to ~12MB per query.</span></div></div></Sec>
  <Sec title="REMEDIATION"><Remed /></Sec>
  {exp && <Sec title="BREADCRUMB TRAIL"><Breadcrumbs /></Sec>}
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
</div>; }

function MonitoringTab({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="RECOMMENDED ALERT RULES"><AlertRules /></Sec>
  <Sec title="EVENT TIMELINE"><EventTimeline /></Sec>
  {exp && <Sec title="HOUR-OF-DAY DISTRIBUTION"><HourDistribution /></Sec>}
  <Sec title="TAG FACETS"><TagFacets /></Sec>
  <Sec title="SYSTEM CONTEXT AT FAILURE"><ContextPanels /></Sec>
  <Sec title="SIMILAR ISSUES IN SENTRY"><SimilarIssues /></Sec>
  <Sec title="FINGERPRINT RULE"><Fingerprint /><div style={{ marginTop: "8px", background: "rgba(0,0,0,0.3)", borderRadius: "4px", padding: "10px" }}><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "4px" }}>SENTRY FINGERPRINT RULE</div><pre style={{ fontFamily: mono, fontSize: "11px", color: "#fb923c", margin: 0 }}>{`fingerprint = ["ora-01652-temp-g4browser"]`}</pre><CopyBtn text='fingerprint = ["ora-01652-temp-g4browser"]' /></div></Sec>
  {exp && <Sec title="SENTRY DASHBOARD WIDGETS"><div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>{[["ORA-01652 Events / Hour", "Time Series", "exception.type:ORA-01652 by tags.site"], ["Top Affected Users", "Table", "issue:WHATSON-4A7 group by user.username"], ["TEMP Usage Distribution", "Bar Chart", "custom metric: oracle.temp_usage_pct histogram"], ["G4Browser Errors by Subclass", "Pie Chart", "tags.browser.window:G4Browser* group by tag"], ["Query Duration Percentiles", "Time Series", "oracle.query_elapsed_sec p50, p95, p99"]].map(([name, type, query], i, arr) => <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", padding: "8px 12px", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}><span style={{ color: "#d1d5db", fontSize: "12px" }}>{name}</span><Tag text={type} color="#6b7280" /><span style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono }}>{query}</span></div>)}</div></Sec>}
</div>; }

function ActionTab({ exp }) {
  const reply = `The application experienced errors when searching for contract runs due to temporary database storage being fully utilised during peak hours.\n\nWORKAROUND\n• Narrow your search criteria before clicking Search\n• Avoid running large searches between 10:00–14:00\n• If the error occurs, wait 2–3 minutes and retry\n\nRESOLUTION\nWe have identified the root cause and a fix is being deployed in the next patch. We are also increasing database capacity as an immediate measure.\n\nReference: WHATSON-4A7`;
  return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="VERDICT"><div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "6px", padding: "14px" }}><div style={{ color: "#fca5a5", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>Database Performance Issue — TEMP Tablespace Exhaustion</div><div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>A structural query optimization issue causes database temporary storage to be exhausted during concurrent content browser searches. Affects BBC Production during peak hours. 37 events across 5 users over 10 days. Trend is accelerating.</div></div></Sec>
  <Sec title="CUSTOMER REPLY" actions={<CopyBtn text={reply} label="Copy reply" />}><div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "20px" }}><pre style={{ fontFamily: sans, fontSize: "13px", color: "#d1d5db", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}>{reply}</pre></div></Sec>
  <Sec title="WORKAROUND"><div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "6px", padding: "14px" }}><ol style={{ margin: 0, paddingLeft: "20px", color: "#d1d5db", fontSize: "13px", lineHeight: 1.8 }}><li>Narrow search criteria to reduce result set</li><li>Avoid peak hours (10:00–14:00) for large searches</li><li>If error occurs, wait 2–3 minutes and retry</li></ol></div></Sec>
  <Sec title="REMEDIATION"><Remed /></Sec>
  <Sec title="SENTRY ACTIONS"><div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{[{ l: "Assign Issue", i: "→" }, { l: "Link to JIRA", i: "⊞" }, { l: "Mark Resolved in Release", i: "✓" }, { l: "Create Alert Rule", i: "⊡" }, { l: "Ignore Until Fix", i: "⊘" }].map(a => <button key={a.l} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#d1d5db", padding: "6px 12px", borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: "5px" }}><span style={{ fontSize: "12px" }}>{a.i}</span>{a.l}</button>)}</div></Sec>
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
</div>; }

// ═══ Main ═══
const tabs = [{ id: "action", l: "Support / Action", i: "◎" }, { id: "overview", l: "Issue Overview", i: "◉" }, { id: "technical", l: "Technical", i: "⌘" }, { id: "monitoring", l: "Monitoring", i: "⊡" }];

export default function SentryViewer() {
  const [tab, setTab] = useState("action");
  const [exp, setExp] = useState(false);
  return <div style={{ background: "#0b0c10", color: "#d1d5db", minHeight: "100vh", fontFamily: sans, display: "flex", flexDirection: "column" }}>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
    {/* Header */}
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "11px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}><div style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#f97316" }} /><span style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 700, fontFamily: mono }}>{S.issue.shortId}</span></div>
        <Tag text={S.issue.priority.toUpperCase()} color="#f59e0b" />
        <Tag text={`${S.issue.events} events`} color="#f97316" />
        <Tag text={`${S.issue.users} users`} color="#8b5cf6" />
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{S.tags.site}</span>
        <span style={{ color: "#4b5563" }}>│</span><Tag text={S.tags.module} color="#22d3ee" />
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{S.issue.status}</span>
      </div>
      <div style={{ display: "flex", gap: "7px" }}>
        <a href={S.issue.url} target="_blank" rel="noopener noreferrer" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", color: "#fb923c", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", fontFamily: mono, textDecoration: "none", display: "flex", alignItems: "center", gap: "5px" }}>↗ Sentry</a>
        <button onClick={() => setExp(!exp)} style={{ background: exp ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${exp ? "rgba(249,115,22,0.3)" : "rgba(255,255,255,0.1)"}`, color: exp ? "#fdba74" : "#9ca3af", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono, transition: "all .2s" }}>{exp ? "◉ Expanded" : "○ Standard"}</button>
      </div>
    </div>
    {/* Exception Banner */}
    <div style={{ padding: "9px 24px", background: "rgba(239,68,68,0.04)", borderBottom: "1px solid rgba(239,68,68,0.1)", display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ color: "#ef4444", fontSize: "12px", fontFamily: mono, fontWeight: 700 }}>{S.exception.type}</span>
      <span style={{ color: "#4b5563" }}>—</span>
      <span style={{ color: "#fca5a5", fontSize: "12px" }}>{S.exception.value}</span>
      <span style={{ color: "#4b5563", marginLeft: "auto" }}>│</span>
      <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{S.exception.module}</span>
    </div>
    {/* Tabs */}
    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", background: "rgba(255,255,255,0.01)" }}>{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", padding: "10px 18px", color: tab === t.id ? "#e5e7eb" : "#6b7280", fontSize: "12px", cursor: "pointer", borderBottom: tab === t.id ? "2px solid #f97316" : "2px solid transparent", fontFamily: sans, fontWeight: tab === t.id ? 600 : 400, display: "flex", alignItems: "center", gap: "5px", marginBottom: "-1px", transition: "all .15s" }}><span style={{ fontSize: "11px", opacity: tab === t.id ? 1 : 0.5 }}>{t.i}</span>{t.l}</button>)}</div>
    {/* Content */}
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", maxWidth: "1080px" }}>
      {tab === "overview" && <OverviewTab exp={exp} />}
      {tab === "technical" && <TechnicalTab exp={exp} />}
      {tab === "monitoring" && <MonitoringTab exp={exp} />}
      {tab === "action" && <ActionTab exp={exp} />}
    </div>
  </div>;
}
