import { useState, useEffect } from "react";

const mono = "'JetBrains Mono','Fira Code',monospace";
const sans = "'IBM Plex Sans',-apple-system,sans-serif";
const SEV = { critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", l: "CRITICAL" }, high: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", l: "HIGH" }, medium: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", l: "MEDIUM" }, low: { color: "#10b981", bg: "rgba(16,185,129,0.12)", l: "LOW" } };
function clip(t) { navigator.clipboard?.writeText(t); }

// ═══ Mock Data — ORA-01652 TEMP Exhaustion (BBC Production) ═══
const Q = {
  meta: { id: "PERF-2025-0205-001", timestamp: "2025-02-05T14:32:18", site: "BBC", database: "bbc-db-12:1521/p12prod", schema: "WHATSON_BBC", engine: "Oracle", engineVersion: "19c Enterprise Edition 19.0.0.0.0", clientVersion: "12.1.0.2.0", encoding: "AL32UTF8" },
  severity: "high",
  issue: { type: "ORA-01652", label: "TEMP Tablespace Exhaustion", message: "ORA-01652: unable to extend temp segment by 128 in tablespace TEMP", component: "G4Browser / OOPLensQuery", origin: "CM2RunBrowser >> buildQuery" },
  query: {
    sql: `SELECT DISTINCT
    r.OID, r.TITLE, r.SERIES_TITLE, r.EPISODE_NR,
    r.DURATION, r.GENRE, r.PRODUCTION_YEAR,
    r.STATUS, r.CREATED_DATE, r.MODIFIED_DATE,
    c.OID AS CONTRACT_OID, c.CONTRACT_NR,
    c.LICENSOR, c.START_DATE, c.END_DATE,
    c.TERRITORY, c.LICENSE_TYPE,
    lw.OID AS LW_OID, lw.WINDOW_START,
    lw.WINDOW_END, lw.MAX_PLAYS, lw.PLAYS_USED
FROM CM2RUN r
    JOIN CM2CONTRACT c ON r.CONTRACT_OID = c.OID
    JOIN CM2LICENSE_WINDOW lw ON c.OID = lw.CONTRACT_OID
WHERE r.STATUS IN (:1, :2, :3)
    AND c.TERRITORY = :4
    AND lw.WINDOW_END > SYSDATE
ORDER BY r.TITLE, c.CONTRACT_NR`,
    bindValues: [{ pos: 1, val: "'ACTIVE'", type: "VARCHAR2" }, { pos: 2, val: "'PLANNED'", type: "VARCHAR2" }, { pos: 3, val: "'IN_PRODUCTION'", type: "VARCHAR2" }, { pos: 4, val: "'UK'", type: "VARCHAR2" }],
    projectedColumns: 22,
    distinctOnOid: "Logically equivalent — OID is unique per row",
    estimatedRows: 847000,
    estimatedRowWidth: 412,
  },
  temp: { current: { used: 94, total: 100, unit: "GB" }, sortOperation: "SORT ORDER BY + HASH UNIQUE (DISTINCT)", estimatedTempNeed: 142, peakUsage: "14:32:18", offender: "SID 2847, serial# 41523" },
  plan: [
    { id: 1, op: "SELECT STATEMENT", cost: 284712, rows: "847K", indent: 0 },
    { id: 2, op: "SORT ORDER BY", cost: 284712, rows: "847K", indent: 1, warn: "TEMP spill — estimated 142GB for sort" },
    { id: 3, op: "HASH UNIQUE (DISTINCT)", cost: 198400, rows: "847K", indent: 1, warn: "Redundant — OID already unique" },
    { id: 4, op: "HASH JOIN", cost: 12840, rows: "847K", indent: 2 },
    { id: 5, op: "HASH JOIN", cost: 8420, rows: "312K", indent: 3 },
    { id: 6, op: "TABLE ACCESS FULL", cost: 4210, rows: "1.2M", indent: 4, table: "CM2RUN", warn: "Full scan — no index on STATUS" },
    { id: 7, op: "TABLE ACCESS FULL", cost: 2890, rows: "89K", indent: 4, table: "CM2CONTRACT" },
    { id: 8, op: "INDEX RANGE SCAN", cost: 1420, rows: "2.1M", indent: 3, table: "CM2LICENSE_WINDOW", index: "IDX_LW_CONTRACT_OID" },
  ],
  indexes: {
    existing: [
      { name: "PK_CM2RUN", table: "CM2RUN", columns: "OID", type: "UNIQUE" },
      { name: "PK_CM2CONTRACT", table: "CM2CONTRACT", columns: "OID", type: "UNIQUE" },
      { name: "IDX_LW_CONTRACT_OID", table: "CM2LICENSE_WINDOW", columns: "CONTRACT_OID", type: "NON-UNIQUE" },
    ],
    recommended: [
      { table: "CM2RUN", columns: "STATUS, TITLE", reason: "Eliminates full table scan on CM2RUN. STATUS filters 60% of rows; TITLE supports ORDER BY.", impact: "High", effort: "Low", sql: "CREATE INDEX IDX_CM2RUN_STATUS_TITLE\n  ON CM2RUN (STATUS, TITLE);" },
      { table: "CM2LICENSE_WINDOW", columns: "CONTRACT_OID, WINDOW_END", reason: "Covers both join and filter predicate. Eliminates late WINDOW_END filter.", impact: "Medium", effort: "Low", sql: "CREATE INDEX IDX_LW_CONTRACT_WEND\n  ON CM2LICENSE_WINDOW (CONTRACT_OID, WINDOW_END);" },
      { table: "CM2CONTRACT", columns: "TERRITORY, OID", reason: "Supports TERRITORY filter + join back to contract OID.", impact: "Medium", effort: "Low", sql: "CREATE INDEX IDX_CM2CONTRACT_TERR\n  ON CM2CONTRACT (TERRITORY, OID);" },
    ],
  },
  glorp: { descriptorClass: "CM2RunDescriptor", queryBuilder: "OOPLensQuery", browserClass: "CM2RunBrowser", rootCause: "OOPLensQuery adds SELECT DISTINCT on ALL projected columns by default. For G4Browser subclasses joining CM2RUN + CM2CONTRACT + CM2LICENSE_WINDOW, this produces a 22-column DISTINCT sort — mathematically equivalent to DISTINCT on OID alone, but requiring ~142GB TEMP vs ~3.2GB.", structuralFix: "Modify OOPLensQuery >> buildDistinctClause to project DISTINCT on OID only when the root descriptor has a single primary key." },
  sessions: [
    { sid: 2847, user: "WHATSON_APP", program: "vw9.3.exe", tempMB: 48200, sql: "SELECT DISTINCT r.OID, r.TITLE...", status: "ACTIVE", duration: "00:12:34" },
    { sid: 1923, user: "WHATSON_APP", program: "vw9.3.exe", tempMB: 12400, sql: "SELECT DISTINCT c.OID, c.CON...", status: "ACTIVE", duration: "00:03:22" },
    { sid: 3102, user: "WHATSON_RPT", program: "sqlplus.exe", tempMB: 8900, sql: "SELECT /*+ PARALLEL(4) */ ...", status: "ACTIVE", duration: "00:45:11" },
  ],
  nPlusOne: [
    { pattern: "CM2RunBrowser iteration", outerQuery: "SELECT ... FROM CM2RUN WHERE ...", innerQuery: "SELECT ... FROM CM2CONTRACT WHERE OID = :1", iterations: 847, totalQueries: 848, fix: "Add alsoFetch: #contract to CM2RunDescriptor", severity: "high" },
    { pattern: "License window proxy resolution", outerQuery: "SELECT ... FROM CM2CONTRACT WHERE ...", innerQuery: "SELECT ... FROM CM2LICENSE_WINDOW WHERE CONTRACT_OID = :1", iterations: 312, totalQueries: 313, fix: "Add alsoFetch: #licenseWindows to CM2ContractDescriptor", severity: "medium" },
  ],
  tableStats: [
    { table: "CM2RUN", rows: "1.2M", sizeMB: 2840, avgRowLen: 248, lastAnalyzed: "2025-02-04" },
    { table: "CM2CONTRACT", rows: "89K", sizeMB: 124, avgRowLen: 186, lastAnalyzed: "2025-02-04" },
    { table: "CM2LICENSE_WINDOW", rows: "2.1M", sizeMB: 1640, avgRowLen: 96, lastAnalyzed: "2025-02-03" },
  ],
  waitEvents: [
    { event: "direct path write temp", waits: 48291, timeMs: 342000, pct: 68.4 },
    { event: "direct path read temp", waits: 31204, timeMs: 98000, pct: 19.6 },
    { event: "db file sequential read", waits: 8420, timeMs: 42000, pct: 8.4 },
    { event: "log file sync", waits: 124, timeMs: 1800, pct: 0.4 },
  ],
  remediation: {
    p0: [{ title: "Extend TEMP tablespace immediately", time: "15 min", risk: "None", sql: "ALTER TABLESPACE TEMP\n  ADD TEMPFILE '/u02/oradata/temp02.dbf'\n  SIZE 50G AUTOEXTEND ON MAXSIZE 100G;", note: "Buys time. Does NOT fix root cause." },
      { title: "Kill offending session", time: "1 min", risk: "Low — user loses unsaved work", sql: "ALTER SYSTEM KILL SESSION '2847,41523' IMMEDIATE;" }],
    p1: [{ title: "Add missing indexes", time: "30 min", risk: "Low — brief lock during creation", description: "Create the three recommended indexes. Reduces sort input by ~60%." },
      { title: "Modify OOPLensQuery DISTINCT clause", time: "2-3 hours", risk: "Medium — affects all G4Browser queries", description: "Change SELECT DISTINCT to project OID only. Mathematically equivalent but reduces TEMP from ~142GB to ~3.2GB." }],
    p2: [{ title: "Refactor OOPLensQuery architecture", time: "2-3 weeks", description: "Replace blanket DISTINCT with query-specific deduplication strategy. Allow descriptors to specify projection columns." }],
  },
  confidence: {
    confirmed: ["ORA-01652 raised at 14:32:18 on SID 2847 (from alert log)", "Query projects 22 columns through DISTINCT (from SQL text)", "TEMP usage peaked at 94GB / 100GB (from V$TEMP_SPACE_HEADER)", "DISTINCT on OID alone is logically equivalent (mathematical proof: OID is PK)"],
    inferred: ["All G4Browser subclasses generate the same DISTINCT pattern (structural analysis of OOPLensQuery)", "Index on CM2RUN.STATUS would reduce sort input by ~60% (based on column cardinality)"],
    unknown: ["Whether BBC has custom OOPLensQuery overrides (site corpus not checked)", "Current index statistics freshness (LAST_ANALYZED dates from mock)", "Whether concurrent sessions contributed to TEMP pressure"],
  },
};

// ═══ Primitives ═══
function CopyBtn({ text, label = "Copy" }) { const [ok, s] = useState(false); return <button onClick={() => { clip(text); s(true); setTimeout(() => s(false), 2000); }} style={{ background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`, color: ok ? "#6ee7b7" : "#9ca3af", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>{ok ? "✓" : label}</button>; }
function Bdg({ severity }) { const s = SEV[severity]; return <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: s.bg, color: s.color, padding: "3px 10px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, letterSpacing: ".08em", fontFamily: mono }}><span style={{ fontSize: "6px" }}>⬤</span>{s.l}</span>; }
function Tag({ text, color }) { return <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: mono, color, background: `${color}18`, padding: "2px 6px", borderRadius: "3px" }}>{text}</span>; }
function Crd({ label, value, accent, sub }) { return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderTop: `2px solid ${accent}`, borderRadius: "0 0 6px 6px", padding: "12px" }}><div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono }}>{label}</div><div style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 600, marginTop: "4px", fontFamily: mono }}>{value}</div>{sub && <div style={{ color: "#6b7280", fontSize: "10px", marginTop: "3px" }}>{sub}</div>}</div>; }
function Sec({ title, children, actions, open: init = true }) { const [o, s] = useState(init); return <div style={{ marginBottom: "4px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: o ? "12px" : 0, cursor: "pointer" }} onClick={() => s(!o)}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ color: "#6b7280", fontSize: "10px", transform: o ? "rotate(90deg)" : "rotate(0)", transition: "transform .15s", display: "inline-block" }}>▶</span><span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".12em", fontFamily: mono }}>{title}</span></div>{actions && o && <div onClick={e => e.stopPropagation()}>{actions}</div>}</div>{o && children}</div>; }
function Gauge({ label, val, max, unit = "", warn, color: forceColor }) { const pct = Math.round(val / max * 100); const c = forceColor || (pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#10b981"); return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "12px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ color: "#9ca3af", fontSize: "11px" }}>{label}</span><span style={{ color: c, fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>{val}{unit} / {max}{unit} ({pct}%)</span></div><div style={{ height: "6px", background: "rgba(255,255,255,0.06)", borderRadius: "3px", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: c, borderRadius: "3px", transition: "width .6s" }} /></div>{warn && <div style={{ color: "#ef4444", fontSize: "10px", marginTop: "5px" }}>⚠ {warn}</div>}</div>; }

// ═══ SQL Display with keyword highlighting ═══
function SqlView({ sql, bindValues }) {
  const keywords = ["SELECT", "DISTINCT", "FROM", "JOIN", "ON", "WHERE", "AND", "OR", "IN", "ORDER BY", "GROUP BY", "AS", "SYSDATE", "LEFT", "RIGHT", "INNER", "OUTER"];
  const highlighted = sql.replace(new RegExp(`\\b(${keywords.join("|")})\\b`, "gi"), m => `§KW§${m}§/KW§`);
  const parts = highlighted.split(/§\/?KW§/);
  return <div>
    <pre style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: "6px", padding: "16px", fontFamily: mono, fontSize: "12px", lineHeight: 1.7, margin: 0, overflowX: "auto", whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => i % 2 === 1 ? <span key={i} style={{ color: "#22d3ee", fontWeight: 700 }}>{p}</span> : <span key={i} style={{ color: "#d1d5db" }}>{p}</span>)}
    </pre>
    {bindValues && <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {bindValues.map(b => <div key={b.pos} style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: "5px", padding: "5px 10px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "#22d3ee", fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>:{b.pos}</span>
        <span style={{ color: "#d1d5db", fontSize: "11px", fontFamily: mono }}>{b.val}</span>
        <span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>{b.type}</span>
      </div>)}
    </div>}
  </div>;
}

// ═══ Execution Plan ═══
function PlanTree({ plan }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
    {plan.map(p => <div key={p.id} style={{ background: p.warn ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.02)", borderLeft: `3px solid ${p.warn ? "#ef4444" : p.table ? "#22d3ee" : "rgba(255,255,255,0.06)"}`, borderRadius: "0 4px 4px 0", padding: "8px 12px", marginLeft: p.indent * 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono, width: "16px" }}>{p.id}</span>
        <span style={{ color: p.warn ? "#fca5a5" : "#d1d5db", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{p.op}</span>
        {p.table && <Tag text={p.table} color="#22d3ee" />}
        {p.index && <Tag text={p.index} color="#8b5cf6" />}
        <span style={{ marginLeft: "auto", color: "#6b7280", fontSize: "10px", fontFamily: mono }}>Cost: {p.cost.toLocaleString()} | Rows: {p.rows}</span>
      </div>
      {p.warn && <div style={{ marginTop: "4px", marginLeft: "24px", color: "#ef4444", fontSize: "11px" }}>⚠ {p.warn}</div>}
    </div>)}
  </div>;
}

// ═══ Index Recommendations ═══
function IndexPanel({ indexes }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
    <div><div style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "8px" }}>EXISTING INDEXES</div>
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
        {indexes.existing.map((ix, i) => <div key={ix.name} style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr 80px", padding: "7px 12px", borderBottom: i < indexes.existing.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
          <span style={{ color: "#d1d5db", fontSize: "12px", fontFamily: mono }}>{ix.name}</span>
          <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{ix.table}</span>
          <span style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono }}>{ix.columns}</span>
          <Tag text={ix.type} color="#6b7280" />
        </div>)}
      </div>
    </div>
    <div><div style={{ color: "#22d3ee", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono, marginBottom: "8px" }}>↑ RECOMMENDED INDEXES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {indexes.recommended.map((ix, i) => <div key={i} style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.12)", borderRadius: "6px", padding: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <Tag text={ix.table} color="#22d3ee" />
            <span style={{ color: "#e5e7eb", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{ix.columns}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}><Tag text={`Impact: ${ix.impact}`} color="#f59e0b" /><Tag text={`Effort: ${ix.effort}`} color="#10b981" /></div>
          </div>
          <div style={{ color: "#9ca3af", fontSize: "11px", lineHeight: 1.5, marginBottom: "8px" }}>{ix.reason}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <pre style={{ background: "rgba(0,0,0,0.3)", borderRadius: "4px", padding: "8px 10px", fontFamily: mono, fontSize: "11px", color: "#22d3ee", margin: 0, flex: 1, whiteSpace: "pre-wrap" }}>{ix.sql}</pre>
            <div style={{ marginLeft: "8px" }}><CopyBtn text={ix.sql} label="Copy SQL" /></div>
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}

// ═══ Expanded: Sessions ═══
function SessionMonitor() {
  return <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "60px 100px 120px 100px 200px 70px 80px", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)", gap: "8px" }}>
      {["SID", "User", "Program", "TEMP (MB)", "SQL (truncated)", "Status", "Duration"].map(h => <span key={h} style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{h}</span>)}
    </div>
    {Q.sessions.map(s => <div key={s.sid} style={{ display: "grid", gridTemplateColumns: "60px 100px 120px 100px 200px 70px 80px", padding: "7px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)", gap: "8px", background: s.tempMB > 40000 ? "rgba(239,68,68,0.04)" : "transparent" }}>
      <span style={{ color: s.tempMB > 40000 ? "#fca5a5" : "#d1d5db", fontSize: "11px", fontFamily: mono }}>{s.sid}</span>
      <span style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono }}>{s.user}</span>
      <span style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono }}>{s.program}</span>
      <span style={{ color: s.tempMB > 40000 ? "#ef4444" : "#d1d5db", fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>{(s.tempMB / 1024).toFixed(1)} GB</span>
      <span style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sql}</span>
      <Tag text={s.status} color={s.status === "ACTIVE" ? "#f59e0b" : "#10b981"} />
      <span style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono }}>{s.duration}</span>
    </div>)}
  </div>;
}

// ═══ Expanded: N+1 Detection ═══
function NPlusOne() {
  return <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
    {Q.nPlusOne.map((n, i) => <div key={i} style={{ background: n.severity === "high" ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)", border: `1px solid ${n.severity === "high" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)"}`, borderRadius: "8px", padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600 }}>{n.pattern}</span>
        <Tag text={`${n.totalQueries} queries`} color="#ef4444" />
        <Tag text={n.severity.toUpperCase()} color={n.severity === "high" ? "#ef4444" : "#f59e0b"} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "4px", padding: "8px" }}><div style={{ color: "#6b7280", fontSize: "9px", fontFamily: mono, marginBottom: "3px" }}>OUTER (1×)</div><div style={{ color: "#9ca3af", fontSize: "10px", fontFamily: mono }}>{n.outerQuery}</div></div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}><span style={{ color: "#ef4444", fontSize: "18px" }}>→</span><span style={{ color: "#ef4444", fontSize: "10px", fontFamily: mono }}>×{n.iterations}</span></div>
        <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "4px", padding: "8px" }}><div style={{ color: "#6b7280", fontSize: "9px", fontFamily: mono, marginBottom: "3px" }}>INNER (N×)</div><div style={{ color: "#fca5a5", fontSize: "10px", fontFamily: mono }}>{n.innerQuery}</div></div>
      </div>
      <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "4px", padding: "8px" }}><span style={{ color: "#10b981", fontSize: "10px", fontFamily: mono, fontWeight: 700 }}>FIX: </span><span style={{ color: "#6ee7b7", fontSize: "11px", fontFamily: mono }}>{n.fix}</span></div>
    </div>)}
  </div>;
}

// ═══ Expanded: GLORP Mapping ═══
function GlorpMapping() {
  const g = Q.glorp;
  return <div style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: "8px", padding: "16px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
      <div><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono }}>DESCRIPTOR</div><div style={{ color: "#c4b5fd", fontSize: "12px", fontFamily: mono, fontWeight: 600, marginTop: "3px" }}>{g.descriptorClass}</div></div>
      <div><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono }}>QUERY BUILDER</div><div style={{ color: "#c4b5fd", fontSize: "12px", fontFamily: mono, fontWeight: 600, marginTop: "3px" }}>{g.queryBuilder}</div></div>
      <div><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono }}>BROWSER</div><div style={{ color: "#c4b5fd", fontSize: "12px", fontFamily: mono, fontWeight: 600, marginTop: "3px" }}>{g.browserClass}</div></div>
    </div>
    <div style={{ marginBottom: "12px" }}><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "4px" }}>ROOT CAUSE (ORM LEVEL)</div><div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.6 }}>{g.rootCause}</div></div>
    <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "6px", padding: "10px" }}><div style={{ color: "#10b981", fontSize: "10px", fontFamily: mono, fontWeight: 700, marginBottom: "4px" }}>STRUCTURAL FIX</div><div style={{ color: "#6ee7b7", fontSize: "12px", lineHeight: 1.5 }}>{g.structuralFix}</div></div>
  </div>;
}

// ═══ Expanded: Wait Events ═══
function WaitEvents() {
  return <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
    {Q.waitEvents.map(w => <div key={w.event} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0" }}>
      <span style={{ color: "#d1d5db", fontSize: "12px", fontFamily: mono, width: "220px" }}>{w.event}</span>
      <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.04)", borderRadius: "4px", overflow: "hidden" }}><div style={{ height: "100%", width: `${w.pct}%`, background: w.pct > 50 ? "#ef4444" : w.pct > 15 ? "#f59e0b" : "#3b82f6", borderRadius: "4px" }} /></div>
      <span style={{ color: w.pct > 50 ? "#ef4444" : "#9ca3af", fontSize: "11px", fontFamily: mono, fontWeight: 700, width: "50px", textAlign: "right" }}>{w.pct}%</span>
      <span style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, width: "80px", textAlign: "right" }}>{(w.timeMs / 1000).toFixed(1)}s</span>
    </div>)}
  </div>;
}

// ═══ Expanded: Table Stats ═══
function TableStats() {
  return <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 100px", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      {["Table", "Rows", "Size MB", "Avg Row Len", "Last Analyzed"].map(h => <span key={h} style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{h}</span>)}
    </div>
    {Q.tableStats.map(t => <div key={t.table} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 100px", padding: "7px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span style={{ color: "#22d3ee", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{t.table}</span>
      <span style={{ color: "#d1d5db", fontSize: "11px", fontFamily: mono }}>{t.rows}</span>
      <span style={{ color: "#d1d5db", fontSize: "11px", fontFamily: mono }}>{t.sizeMB.toLocaleString()}</span>
      <span style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono }}>{t.avgRowLen}B</span>
      <span style={{ color: "#9ca3af", fontSize: "11px", fontFamily: mono }}>{t.lastAnalyzed}</span>
    </div>)}
  </div>;
}

// ═══ Confidence ═══
function Confidence() {
  const S = [{ k: "confirmed", l: "CONFIRMED", c: "#10b981", i: "✓" }, { k: "inferred", l: "INFERRED", c: "#f59e0b", i: "~" }, { k: "unknown", l: "UNKNOWN", c: "#6b7280", i: "?" }];
  return <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{S.map(s => <div key={s.k} style={{ background: `${s.c}08`, border: `1px solid ${s.c}22`, borderRadius: "6px", padding: "10px" }}><div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}><span style={{ color: s.c, fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{s.i} {s.l}</span></div>{Q.confidence[s.k].map((t, i) => <div key={i} style={{ padding: "3px 0 3px 18px", color: "#d1d5db", fontSize: "12px", lineHeight: 1.5, borderBottom: i < Q.confidence[s.k].length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>{t}</div>)}</div>)}</div>;
}

// ═══ Notes ═══
function Notes() { const [ns, sN] = useState([]); const [v, sV] = useState(""); const add = () => { if (!v.trim()) return; sN([...ns, { t: v.trim(), d: new Date().toLocaleTimeString() }]); sV(""); }; return <div>{ns.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>{ns.map((n, i) => <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "5px", padding: "8px" }}><div style={{ color: "#d1d5db", fontSize: "12px" }}>{n.t}</div><div style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono, marginTop: "2px" }}>dba · {n.d}</div></div>)}</div>}<div style={{ display: "flex", gap: "8px" }}><input value={v} onChange={e => sV(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Add DBA note..." style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "8px 12px", color: "#d1d5db", fontSize: "12px", fontFamily: sans, outline: "none" }} /><button onClick={add} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#9ca3af", padding: "8px 14px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>Add</button></div></div>; }

// ═══ Remediation ═══
function Remed() {
  const PS = { p0: { a: "#ef4444", l: "P0 — IMMEDIATE" }, p1: { a: "#f59e0b", l: "P1 — THIS SPRINT" }, p2: { a: "#6b7280", l: "P2 — STRUCTURAL" } };
  return <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{Object.entries(PS).map(([k, s]) => { const items = Q.remediation[k]; if (!items?.length) return null; return <div key={k}><div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: s.a, marginBottom: "8px", fontFamily: mono }}>{s.l}</div>{items.map((it, i) => <div key={i} style={{ background: `${s.a}0a`, border: `1px solid ${s.a}22`, borderRadius: "6px", padding: "12px", marginBottom: "6px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600 }}>{it.title}</span><div style={{ display: "flex", gap: "6px" }}>{it.risk && <Tag text={`Risk: ${it.risk}`} color="#9ca3af" />}{it.time && <Tag text={`⏱ ${it.time}`} color="#9ca3af" />}</div></div>{it.description && <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5, marginBottom: "8px" }}>{it.description}</div>}{it.note && <div style={{ fontSize: "11px", color: "#f59e0b", marginBottom: "8px" }}>⚠ {it.note}</div>}{it.sql && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><pre style={{ background: "rgba(0,0,0,0.3)", borderRadius: "4px", padding: "8px 10px", fontFamily: mono, fontSize: "11px", color: "#22d3ee", margin: 0, flex: 1, whiteSpace: "pre-wrap" }}>{it.sql}</pre><div style={{ marginLeft: "8px" }}><CopyBtn text={it.sql} label="Copy" /></div></div>}</div>)}</div>; })}</div>;
}

// ═══ Tab Views ═══
function DBAView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="PERFORMANCE SUMMARY"><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}><Crd label="TEMP Used" value={`${Q.temp.current.used}GB / ${Q.temp.current.total}GB`} accent="#ef4444" sub="94% — critical" /><Crd label="TEMP Needed" value={`~${Q.temp.estimatedTempNeed}GB`} accent="#f59e0b" sub="For current DISTINCT" /><Crd label="Result Set" value={`${(Q.query.estimatedRows / 1000).toFixed(0)}K rows`} accent="#22d3ee" sub={`${Q.query.projectedColumns} columns projected`} /><Crd label="DISTINCT Waste" value="~139GB" accent="#ef4444" sub="142GB → 3.2GB with OID-only" /></div></Sec>
  <Sec title="TEMP TABLESPACE"><Gauge label="TEMP Usage" val={Q.temp.current.used} max={Q.temp.current.total} unit=" GB" warn={`Sort operation requires ~${Q.temp.estimatedTempNeed}GB — exceeds available TEMP`} /></Sec>
  <Sec title="OFFENDING QUERY" actions={<CopyBtn text={Q.query.sql} label="Copy SQL" />}><SqlView sql={Q.query.sql} bindValues={Q.query.bindValues} /><div style={{ marginTop: "10px", background: "rgba(239,68,68,0.06)", borderRadius: "6px", padding: "10px", borderLeft: "3px solid #ef4444" }}><span style={{ color: "#ef4444", fontSize: "11px", fontWeight: 700, fontFamily: mono }}>DISTINCT ON {Q.query.projectedColumns} COLUMNS</span><span style={{ color: "#9ca3af", fontSize: "11px", marginLeft: "8px" }}>→ {Q.query.distinctOnOid}</span></div></Sec>
  <Sec title="EXECUTION PLAN"><PlanTree plan={Q.plan} /></Sec>
  <Sec title="INDEX ANALYSIS"><IndexPanel indexes={Q.indexes} /></Sec>
  <Sec title="REMEDIATION"><Remed /></Sec>
  {exp && <Sec title="SESSION MONITOR"><SessionMonitor /></Sec>}
  {exp && <Sec title="WAIT EVENTS"><WaitEvents /></Sec>}
  {exp && <Sec title="TABLE STATISTICS"><TableStats /></Sec>}
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
  {exp && <Sec title="DBA NOTES"><Notes /></Sec>}
</div>; }

function DevView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="ORM ROOT CAUSE"><GlorpMapping /></Sec>
  <Sec title="QUERY (GENERATED BY GLORP)" actions={<CopyBtn text={Q.query.sql} label="Copy SQL" />}><SqlView sql={Q.query.sql} bindValues={Q.query.bindValues} /><div style={{ marginTop: "10px", background: "rgba(139,92,246,0.06)", borderRadius: "6px", padding: "10px" }}><span style={{ color: "#c4b5fd", fontSize: "11px", fontFamily: mono }}>Generated by {Q.glorp.queryBuilder} via {Q.glorp.browserClass} >> buildQuery</span></div></Sec>
  {exp && <Sec title="N+1 CASCADE DETECTION"><NPlusOne /></Sec>}
  <Sec title="EXECUTION PLAN"><PlanTree plan={Q.plan} /></Sec>
  <Sec title="REMEDIATION"><Remed /></Sec>
  {exp && <Sec title="TABLE STATISTICS"><TableStats /></Sec>}
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
  {exp && <Sec title="INVESTIGATION NOTES"><Notes /></Sec>}
</div>; }

function SupView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <Sec title="QUICK SUMMARY"><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}><Crd label="Site" value={Q.meta.site} accent="#8b5cf6" /><Crd label="Severity" value="HIGH" accent="#f59e0b" /><Crd label="Issue" value="TEMP Exhaustion" accent="#ef4444" /><Crd label="Fix ETA" value="Immediate + sprint" accent="#10b981" /></div></Sec>
  <Sec title="VERDICT"><div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "6px", padding: "14px" }}><div style={{ color: "#fca5a5", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>Database Performance Issue — TEMP Tablespace Exhaustion</div><div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>A query generated by the content browser is using 94GB of TEMP tablespace (100GB available) because it applies DISTINCT across 22 columns when only 1 column (the record ID) is needed. This is a known structural issue in the query generation layer that affects all sites with large datasets.</div></div></Sec>
  <Sec title="IMPACT"><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}><div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "6px", padding: "12px", borderLeft: "3px solid #ef4444" }}><div style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700, fontFamily: mono, marginBottom: "4px" }}>USER IMPACT</div><div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>Content browsers freeze or error when querying large result sets. Affects any user running searches across contracts and license windows.</div></div><div style={{ background: "rgba(245,158,11,0.06)", borderRadius: "6px", padding: "12px", borderLeft: "3px solid #f59e0b" }}><div style={{ color: "#f59e0b", fontSize: "10px", fontWeight: 700, fontFamily: mono, marginBottom: "4px" }}>SYSTEM IMPACT</div><div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>TEMP tablespace exhaustion can block other database operations. Other users may experience slowdowns or failures when TEMP is full.</div></div></div></Sec>
  <Sec title="WORKAROUND"><div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: "6px", padding: "14px" }}><div style={{ color: "#6ee7b7", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>Immediate Actions</div><ol style={{ margin: 0, paddingLeft: "20px", color: "#d1d5db", fontSize: "13px", lineHeight: 1.8 }}><li>DBA extends TEMP tablespace to 200GB (15 min)</li><li>Users narrow search criteria to reduce result set size</li><li>Schedule large exports for off-peak hours</li></ol></div></Sec>
  {exp && <Sec title="ANALYSIS CONFIDENCE"><Confidence /></Sec>}
</div>; }

function ExecView({ exp }) { return <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
  <div style={{ background: "linear-gradient(135deg,rgba(239,68,68,0.08),rgba(6,182,212,0.06))", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "10px", padding: "20px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div><div style={{ color: "#e5e7eb", fontSize: "18px", fontWeight: 700, marginBottom: "5px" }}>Database Performance Degradation</div><div style={{ color: "#9ca3af", fontSize: "13px", lineHeight: 1.6, maxWidth: "520px" }}>A query optimization issue causes the database to consume all available temporary storage. Affects content browsing at sites with large catalogues. Structural fix available.</div></div><Bdg severity="high" /></div></div>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "14px", textAlign: "center" }}><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "6px" }}>STORAGE WASTE</div><div style={{ color: "#ef4444", fontSize: "20px", fontWeight: 700 }}>139 GB</div><div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "2px" }}>Per query execution</div></div>
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "14px", textAlign: "center" }}><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "6px" }}>AFFECTED SITES</div><div style={{ color: "#f59e0b", fontSize: "20px", fontWeight: 700 }}>All</div><div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "2px" }}>BBC most impacted (largest data)</div></div>
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "14px", textAlign: "center" }}><div style={{ color: "#6b7280", fontSize: "10px", fontFamily: mono, marginBottom: "6px" }}>FIX EFFORT</div><div style={{ color: "#10b981", fontSize: "20px", fontWeight: 700 }}>2-3h</div><div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "2px" }}>ORM change, medium risk</div></div>
  </div>
  <Sec title="RESOLUTION PATH"><div style={{ display: "flex", gap: "10px" }}>{[{ p: "Now", l: "Extend TEMP", d: "Add 50GB TEMP tablespace", c: "#ef4444" }, { p: "This week", l: "Add Indexes", d: "Reduce sort input by 60%", c: "#f59e0b" }, { p: "Sprint", l: "Fix ORM Query", d: "DISTINCT on OID only", c: "#10b981" }].map(it => <div key={it.p} style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: `1px solid ${it.c}33`, borderTop: `3px solid ${it.c}`, borderRadius: "0 0 6px 6px", padding: "12px" }}><div style={{ color: it.c, fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{it.p.toUpperCase()}</div><div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "5px" }}>{it.l}</div><div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "3px" }}>{it.d}</div></div>)}</div></Sec>
</div>; }

// ═══ Quick Actions ═══
function QActions() { const [a, sA] = useState(null); const items = [{ id: "jira", l: "Create JIRA", i: "⊞" }, { id: "extend", l: "Extend TEMP (DBA)", i: "↑" }, { id: "kill", l: "Kill Session", i: "✗" }, { id: "idx", l: "Copy All Index SQL", i: "⎘" }]; return <div style={{ position: "sticky", bottom: 0, background: "#0a0b0e", borderTop: "1px solid rgba(255,255,255,0.08)", padding: "10px 24px", display: "flex", gap: "6px", zIndex: 50 }}>{items.map(x => <button key={x.id} onClick={() => { if (x.id === "idx") { clip(Q.indexes.recommended.map(r => r.sql).join("\n\n")); } sA(x.id); setTimeout(() => sA(null), 2000); }} style={{ background: a === x.id ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${a === x.id ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.08)"}`, color: a === x.id ? "#6ee7b7" : "#d1d5db", padding: "6px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono, display: "flex", alignItems: "center", gap: "5px", transition: "all .15s" }}><span>{x.i}</span>{a === x.id ? "✓" : x.l}</button>)}</div>; }

// ═══ Main ═══
const tabs = [{ id: "dba", l: "DBA", i: "⛁" }, { id: "dev", l: "Developer", i: "⌘" }, { id: "support", l: "Support", i: "◎" }, { id: "exec", l: "Executive", i: "◈" }];

export default function DBPerfViewer() {
  const [tab, setTab] = useState("dba");
  const [exp, setExp] = useState(false);
  useEffect(() => { const h = e => { if (e.key === "Escape") {} }; document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);
  return <div style={{ background: "#090a0d", color: "#d1d5db", minHeight: "100vh", fontFamily: sans, display: "flex", flexDirection: "column" }}>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
    {/* Header */}
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "11px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}><div style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#ef4444" }} /><span style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 700, fontFamily: mono }}>{Q.meta.id}</span></div>
        <Bdg severity={Q.severity} />
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{Q.meta.site}</span>
        <span style={{ color: "#4b5563" }}>│</span><Tag text={Q.meta.engine} color="#22d3ee" /><span style={{ color: "#6b7280", fontSize: "12px" }}>{Q.meta.engineVersion}</span>
        <span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{new Date(Q.meta.timestamp).toLocaleString()}</span>
      </div>
      <button onClick={() => setExp(!exp)} style={{ background: exp ? "rgba(6,182,212,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${exp ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.1)"}`, color: exp ? "#67e8f9" : "#9ca3af", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono, transition: "all .2s" }}>{exp ? "◉ Expanded" : "○ Standard"}</button>
    </div>
    {/* Issue Banner */}
    <div style={{ padding: "9px 24px", background: "rgba(239,68,68,0.04)", borderBottom: "1px solid rgba(239,68,68,0.1)", display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ color: "#ef4444", fontSize: "12px", fontFamily: mono, fontWeight: 700 }}>{Q.issue.type}</span>
      <span style={{ color: "#4b5563" }}>—</span>
      <span style={{ color: "#fca5a5", fontSize: "12px" }}>{Q.issue.message}</span>
      <span style={{ color: "#4b5563", marginLeft: "auto" }}>│</span>
      <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono }}>{Q.issue.component}</span>
    </div>
    {/* Tabs */}
    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", background: "rgba(255,255,255,0.01)" }}>{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", padding: "10px 18px", color: tab === t.id ? "#e5e7eb" : "#6b7280", fontSize: "12px", cursor: "pointer", borderBottom: tab === t.id ? "2px solid #22d3ee" : "2px solid transparent", fontFamily: sans, fontWeight: tab === t.id ? 600 : 400, display: "flex", alignItems: "center", gap: "5px", marginBottom: "-1px", transition: "all .15s" }}><span style={{ fontSize: "12px", opacity: tab === t.id ? 1 : 0.5 }}>{t.i}</span>{t.l}</button>)}</div>
    {/* Content */}
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", maxWidth: "1080px" }}>
      {tab === "dba" && <DBAView exp={exp} />}
      {tab === "dev" && <DevView exp={exp} />}
      {tab === "support" && <SupView exp={exp} />}
      {tab === "exec" && <ExecView exp={exp} />}
    </div>
    {exp && <QActions />}
  </div>;
}
