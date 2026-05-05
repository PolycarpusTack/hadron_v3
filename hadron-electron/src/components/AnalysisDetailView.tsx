import { useState, useEffect, useRef } from "react"
import { format } from "date-fns"
import type { Analysis } from "../services/api"
import type { ExportSource } from "../types"
import JiraTicketModal from "./JiraTicketModal"
import ExportDialog from "./ExportDialog"
import LinkedTickets from "./LinkedTickets"
import JiraSyncStatus from "./JiraSyncStatus"
import { isJiraEnabled } from "../services/jira"
import { openExternal as open } from "../utils/openExternal"

// ─── Fonts already loaded in index.html ────────────────────────────────────
const mono = "'JetBrains Mono','Fira Code',monospace"
const sans = "'IBM Plex Sans',-apple-system,sans-serif"

// ─── Color tables (mirrors mockup) ─────────────────────────────────────────
const FC: Record<string, { bg: string; border: string; text: string; dot: string; label: string }> = {
  red:    { bg: "rgba(239,68,68,0.08)",   border: "#ef4444", text: "#fca5a5", dot: "#ef4444", label: "Crash cause" },
  blue:   { bg: "rgba(59,130,246,0.08)",  border: "#3b82f6", text: "#93c5fd", dot: "#3b82f6", label: "Fix target" },
  orange: { bg: "rgba(249,115,22,0.08)",  border: "#f97316", text: "#fdba74", dot: "#f97316", label: "Query / DB" },
  gray:   { bg: "rgba(107,114,128,0.06)", border: "#4b5563", text: "#9ca3af", dot: "#6b7280", label: "Infrastructure" },
}
const SEV: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)",  label: "CRITICAL" },
  high:     { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "HIGH" },
  medium:   { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", label: "MEDIUM" },
  low:      { color: "#10b981", bg: "rgba(16,185,129,0.12)", label: "LOW" },
}

// ─── WCR data types ─────────────────────────────────────────────────────────
interface StackFrame {
  id: number
  color: string
  method: string
  label: string
  source?: string
}
interface RemediationItem {
  title: string
  location?: string
  time?: string
  risk?: string
  code?: string
  before?: string
  after?: string
  description?: string
}
interface WcrData {
  crash_id?: string
  site?: string
  user?: string
  username?: string
  timestamp?: string
  rootCause?: {
    technical?: string
    plainEnglish?: string
    affectedMethod?: string
    affectedModule?: string
    triggerCondition?: string
  }
  stackFrames?: StackFrame[]
  userScenario?: {
    steps: Array<{ step: number; action: string; isFailure?: boolean }>
    expectedResult?: string
    actualResult?: string
  }
  remediation?: {
    p0?: RemediationItem[]
    p1?: RemediationItem[]
    p2?: RemediationItem[]
  }
  similarCrashes?: Array<{
    id: string; site?: string; date?: string; component?: string
    similarity: number; status: string; fixVersion?: string
  }>
  blastRadius?: Array<{ c: string; s: string }>
  confidenceAssessment?: {
    confirmed?: string[]
    inferred?: string[]
    unknown?: string[]
  }
  impactAnalysis?: {
    dataAtRisk?: string
    directlyAffected?: Array<{ feature: string; module?: string; severity?: string; description?: string }>
    potentiallyAffected?: Array<{ feature: string; module?: string; severity?: string; description?: string }>
  }
  reproduction?: {
    steps?: string[]
    expected?: string
    actual?: string
  }
  environment?: {
    application?: { version?: string; build?: string }
    database?: { type?: string; connectionInfo?: string }
  }
}

function parseWcrData(fullData: unknown): WcrData | null {
  if (!fullData) return null
  try {
    const d = typeof fullData === "string" ? JSON.parse(fullData) : fullData
    if (typeof d !== "object" || !d) return null
    const r = d as Record<string, unknown>
    // Consider "rich" when we have structured rootCause or stackFrames
    if (!r.rootCause && !Array.isArray(r.stackFrames)) return null
    return r as WcrData
  } catch {
    return null
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface AnalysisDetailViewProps {
  analysis: Analysis
  onBack: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
//  PRIMITIVE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000) }}
      style={{
        background: ok ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
        color: ok ? "#6ee7b7" : "#9ca3af",
        padding: "4px 10px", borderRadius: "4px", fontSize: "11px",
        cursor: "pointer", fontFamily: mono, transition: "all .2s",
      }}
    >{ok ? "✓ Copied" : label}</button>
  )
}

function SevBadge({ severity }: { severity: string }) {
  const s = SEV[severity?.toLowerCase()] ?? SEV.medium
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      background: s.bg, color: s.color,
      padding: "3px 10px", borderRadius: "4px",
      fontSize: "11px", fontWeight: 700, letterSpacing: ".08em", fontFamily: mono,
    }}>
      <span style={{ fontSize: "6px" }}>⬤</span>{s.label}
    </span>
  )
}

function Card({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderTop: `2px solid ${accent}`,
      borderRadius: "0 0 6px 6px", padding: "12px",
    }}>
      <div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono }}>{label}</div>
      <div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "4px", fontFamily: mono }}>{value}</div>
      {sub && <div style={{ color: "#6b7280", fontSize: "10px", marginTop: "3px" }}>{sub}</div>}
    </div>
  )
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", fontFamily: mono,
      color, background: `${color}18`, padding: "2px 6px", borderRadius: "3px",
    }}>{text}</span>
  )
}

function Sec({
  title, children, actions, defaultOpen = true,
}: { title: string; children: React.ReactNode; actions?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: "4px" }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? "12px" : 0, cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen(!open)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#6b7280", fontSize: "10px", transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform .15s", display: "inline-block" }}>▶</span>
          <span style={{ color: "#6b7280", fontSize: "10px", fontWeight: 700, letterSpacing: ".12em", fontFamily: mono }}>{title}</span>
        </div>
        {actions && open && <div onClick={e => e.stopPropagation()}>{actions}</div>}
      </div>
      {open && children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  SECTION COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function StackTrace({ frames, expanded }: { frames: StackFrame[]; expanded: boolean }) {
  const [expandedIds, setExpandedIds] = useState(new Set([1, 2, 3]))
  const [inspector, setInspector] = useState<number | null>(null)

  const toggle = (id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "14px", marginBottom: "12px", flexWrap: "wrap" }}>
        {Object.entries(FC).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: v.dot, display: "inline-block" }} />
            <span style={{ color: "#9ca3af", fontSize: "11px" }}>{v.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: expanded ? "14px" : 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
          {frames.map(f => {
            const c = FC[f.color] ?? FC.gray
            const isE = expandedIds.has(f.id)
            const isI = inspector === f.id
            return (
              <div
                key={f.id}
                style={{
                  background: isE || isI ? c.bg : "transparent",
                  borderLeft: `3px solid ${isE || isI ? c.border : "transparent"}`,
                  padding: "7px 12px", cursor: "pointer",
                  borderRadius: "0 4px 4px 0", transition: "all .15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={() => toggle(f.id)}>
                  <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono, width: "22px", textAlign: "right" }}>[{f.id}]</span>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: c.dot, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ color: c.text, fontSize: "12.5px", fontFamily: mono, flex: 1 }}>{f.method}</span>
                  {expanded && f.source && (
                    <button
                      onClick={e => { e.stopPropagation(); setInspector(isI ? null : f.id) }}
                      style={{
                        background: isI ? "rgba(255,255,255,0.08)" : "transparent",
                        border: `1px solid ${isI ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}`,
                        color: isI ? "#d1d5db" : "#4b5563",
                        padding: "2px 8px", borderRadius: "3px", fontSize: "10px",
                        cursor: "pointer", fontFamily: mono,
                      }}
                    >{isI ? "Hide" : "Source"}</button>
                  )}
                </div>
                {isE && <div style={{ marginTop: "4px", marginLeft: "38px", color: "#9ca3af", fontSize: "12px" }}>{f.label}</div>}
              </div>
            )
          })}
        </div>
        {expanded && inspector && (() => {
          const f = frames.find(x => x.id === inspector)
          if (!f?.source) return null
          const c = FC[f.color] ?? FC.gray
          return (
            <div style={{
              width: "340px", flexShrink: 0,
              background: "rgba(0,0,0,0.3)",
              border: `1px solid ${c.border}33`,
              borderRadius: "8px", padding: "14px", alignSelf: "flex-start",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ color: c.text, fontSize: "11px", fontFamily: mono, fontWeight: 700 }}>FRAME [{f.id}]</span>
                <CopyBtn text={f.source} />
              </div>
              <pre style={{ fontFamily: mono, fontSize: "11px", color: "#d1d5db", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>{f.source}</pre>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function Journey({ scenario }: { scenario: NonNullable<WcrData["userScenario"]> }) {
  return (
    <div style={{ position: "relative", paddingLeft: "24px" }}>
      <div style={{ position: "absolute", left: "7px", top: "4px", bottom: "4px", width: "1px", background: "rgba(255,255,255,0.08)" }} />
      {scenario.steps.map((s, i) => (
        <div key={s.step} style={{ position: "relative", paddingBottom: i < scenario.steps.length - 1 ? "14px" : 0 }}>
          <div style={{
            position: "absolute", left: "-20px", top: "4px",
            width: "11px", height: "11px", borderRadius: "50%",
            background: s.isFailure ? "#ef4444" : "rgba(255,255,255,0.08)",
            border: `2px solid ${s.isFailure ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.12)"}`,
            zIndex: 1,
          }} />
          <span style={{ color: "#6b7280", fontSize: "11px", fontFamily: mono, marginRight: "8px" }}>{s.step}.</span>
          <span style={{ color: s.isFailure ? "#fca5a5" : "#d1d5db", fontSize: "13px" }}>{s.action}</span>
        </div>
      ))}
      {(scenario.expectedResult || scenario.actualResult) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "14px" }}>
          {scenario.expectedResult && (
            <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "6px", padding: "10px", borderLeft: "3px solid #10b981" }}>
              <div style={{ color: "#10b981", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "4px", fontFamily: mono }}>EXPECTED</div>
              <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{scenario.expectedResult}</div>
            </div>
          )}
          {scenario.actualResult && (
            <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "6px", padding: "10px", borderLeft: "3px solid #ef4444" }}>
              <div style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "4px", fontFamily: mono }}>ACTUAL</div>
              <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{scenario.actualResult}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Remediation({ remediation }: { remediation: NonNullable<WcrData["remediation"]> }) {
  const TIERS = [
    { key: "p0" as const, accent: "#ef4444", label: "P0 — FIX TODAY" },
    { key: "p1" as const, accent: "#f59e0b", label: "P1 — THIS SPRINT" },
    { key: "p2" as const, accent: "#6b7280", label: "P2 — NEXT RELEASE" },
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {TIERS.map(({ key, accent, label }) => {
        const items = remediation[key]
        if (!items?.length) return null
        return (
          <div key={key}>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", color: accent, marginBottom: "8px", fontFamily: mono }}>{label}</div>
            {items.map((it, i) => (
              <div key={i} style={{
                background: `${accent}0a`, border: `1px solid ${accent}22`,
                borderRadius: "6px", padding: "12px", marginBottom: "6px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600 }}>{it.title}</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {it.risk && <Tag text={`Risk: ${it.risk}`} color="#9ca3af" />}
                    {it.time && <Tag text={`⏱ ${it.time}`} color="#9ca3af" />}
                  </div>
                </div>
                {it.location && <div style={{ fontSize: "12px", color: "#93c5fd", fontFamily: mono, marginBottom: "6px" }}>📍 {it.location}</div>}
                {it.description && <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5 }}>{it.description}</div>}
                {it.code && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", marginBottom: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#6b7280", fontFamily: mono }}>PROPOSED FIX</span>
                      <CopyBtn text={it.code} />
                    </div>
                    <pre style={{
                      background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "4px", padding: "10px", fontSize: "11.5px",
                      color: "#d1d5db", fontFamily: mono, lineHeight: 1.6,
                      margin: 0, whiteSpace: "pre-wrap",
                    }}>{it.code}</pre>
                  </>
                )}
                {(it.before || it.after) && (
                  <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {it.before && (
                      <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "4px", padding: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#ef4444", fontFamily: mono, marginBottom: "3px" }}>BEFORE</div>
                        <div style={{ fontSize: "11px", color: "#fca5a5", fontFamily: mono }}>{it.before}</div>
                      </div>
                    )}
                    {it.after && (
                      <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "4px", padding: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#10b981", fontFamily: mono, marginBottom: "3px" }}>AFTER</div>
                        <div style={{ fontSize: "11px", color: "#6ee7b7", fontFamily: mono }}>{it.after}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function SimilarCrashes({ crashes }: { crashes: NonNullable<WcrData["similarCrashes"]> }) {
  const sc: Record<string, string> = { fixed: "#10b981", open: "#f59e0b" }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      {crashes.map(c => (
        <div key={c.id} style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: "6px", padding: "11px", display: "flex", alignItems: "center", gap: "12px",
        }}>
          <div style={{
            width: "38px", height: "38px", borderRadius: "50%",
            background: `conic-gradient(${c.similarity > 0.9 ? "#ef4444" : "#f59e0b"} ${c.similarity * 360}deg, rgba(255,255,255,0.04) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <div style={{
              width: "28px", height: "28px", borderRadius: "50%", background: "#111114",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", fontFamily: mono, color: "#d1d5db", fontWeight: 700,
            }}>{Math.round(c.similarity * 100)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#e5e7eb", fontSize: "12px", fontFamily: mono, fontWeight: 600 }}>{c.id}</span>
              {c.site && <Tag text={c.site} color="#8b5cf6" />}
              <Tag text={c.status.toUpperCase()} color={sc[c.status] ?? "#6b7280"} />
              {c.fixVersion && <Tag text={`Fixed ${c.fixVersion}`} color="#10b981" />}
            </div>
            <div style={{ color: "#6b7280", fontSize: "11px", marginTop: "3px" }}>
              {[c.component, c.date].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function BlastRadius({ components }: { components: NonNullable<WcrData["blastRadius"]> }) {
  const sc: Record<string, { c: string; i: string }> = {
    vulnerable: { c: "#ef4444", i: "✗" },
    safe:       { c: "#10b981", i: "✓" },
    unknown:    { c: "#6b7280", i: "?" },
  }
  const groups: Record<string, typeof components> = {
    vulnerable: components.filter(x => x.s === "vulnerable"),
    safe:       components.filter(x => x.s === "safe"),
    unknown:    components.filter(x => x.s === "unknown"),
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
      {Object.entries(groups).map(([k, items]) => {
        if (!items.length) return null
        const s = sc[k]
        return (
          <div key={k} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${s.c}22`, borderRadius: "8px", padding: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}>
              <span style={{ color: s.c, fontWeight: 700, fontSize: "12px" }}>{s.i}</span>
              <span style={{ color: s.c, fontSize: "10px", fontWeight: 700, letterSpacing: ".08em", fontFamily: mono, textTransform: "uppercase" }}>{k}</span>
              <span style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono }}>({items.length})</span>
            </div>
            {items.map(x => (
              <div key={x.c} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", color: "#d1d5db", fontSize: "12px", fontFamily: mono }}>{x.c}</div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ConfidenceAssessment({ conf }: { conf: NonNullable<WcrData["confidenceAssessment"]> }) {
  const tiers = [
    { key: "confirmed" as const, label: "CONFIRMED", color: "#10b981", icon: "✓", desc: "Direct evidence in WCR" },
    { key: "inferred"  as const, label: "INFERRED",  color: "#f59e0b", icon: "~", desc: "Pattern-based, not proven" },
    { key: "unknown"   as const, label: "UNKNOWN",   color: "#6b7280", icon: "?", desc: "Cannot determine from available data" },
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {tiers.map(t => {
        const items = conf[t.key] ?? []
        if (!items.length) return null
        return (
          <div key={t.key} style={{ background: `${t.color}08`, border: `1px solid ${t.color}22`, borderRadius: "8px", padding: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "3px", background: `${t.color}22`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: t.color, fontFamily: mono }}>{t.icon}</span>
              <span style={{ color: t.color, fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", fontFamily: mono }}>{t.label}</span>
              <span style={{ color: "#4b5563", fontSize: "10px" }}>— {t.desc}</span>
            </div>
            {items.map((text, i) => (
              <div key={i} style={{ padding: "3px 0 3px 22px", color: "#d1d5db", fontSize: "12px", lineHeight: 1.5, borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>{text}</div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function Notes() {
  const [notes, setNotes] = useState<Array<{ text: string; time: string }>>([])
  const [value, setValue] = useState("")
  const add = () => {
    if (!value.trim()) return
    setNotes(prev => [...prev, { text: value.trim(), time: new Date().toLocaleTimeString() }])
    setValue("")
  }
  return (
    <div>
      {notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "10px" }}>
          {notes.map((n, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px", padding: "10px" }}>
              <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{n.text}</div>
              <div style={{ color: "#4b5563", fontSize: "10px", fontFamily: mono, marginTop: "3px" }}>analyst · {n.time}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="Add investigation note…"
          style={{
            flex: 1, background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "6px", padding: "8px 12px",
            color: "#d1d5db", fontSize: "12px", fontFamily: sans, outline: "none",
          }}
        />
        <button onClick={add} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#9ca3af", padding: "8px 14px", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>Add</button>
      </div>
    </div>
  )
}

function AiMeta({ analysis }: { analysis: Analysis }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.04)", marginTop: "8px", flexWrap: "wrap" }}>
      <Tag text="Hadron AI" color="#8b5cf6" />
      {analysis.ai_model && <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{analysis.ai_model}</span>}
      <span style={{ color: "#4b5563" }}>│</span>
      <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{analysis.tokens_used?.toLocaleString() ?? 0} tokens</span>
      <span style={{ color: "#4b5563" }}>│</span>
      <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>${(analysis.cost ?? 0).toFixed(3)}</span>
      {analysis.analysis_duration_ms && (
        <>
          <span style={{ color: "#4b5563" }}>│</span>
          <span style={{ color: "#4b5563", fontSize: "11px", fontFamily: mono }}>{(analysis.analysis_duration_ms / 1000).toFixed(1)}s</span>
        </>
      )}
      {analysis.analysis_mode && <Tag text={analysis.analysis_mode} color="#6b7280" />}
      {analysis.confidence && <Tag text={analysis.confidence} color="#6b7280" />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB VIEWS
// ═══════════════════════════════════════════════════════════════════════════

function SupportView({ data, analysis, expanded }: { data: WcrData; analysis: Analysis; expanded: boolean }) {
  const rc = data.rootCause
  const p0time = data.remediation?.p0?.[0]?.time
  const p0title = data.remediation?.p0?.[0]?.title

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Sec title="QUICK SUMMARY">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
          <Card label="SITE"      value={data.site ?? analysis.filename?.split("_")[1] ?? "–"} accent="#8b5cf6" />
          <Card label="SEVERITY"  value={(analysis.severity ?? "MEDIUM").toUpperCase()}         accent={SEV[analysis.severity?.toLowerCase() ?? "medium"]?.color ?? "#3b82f6"} />
          <Card label="MODULE"    value={rc?.affectedModule ?? analysis.component ?? "–"}        accent="#3b82f6" sub={rc?.affectedMethod} />
          <Card label="FIX ETA"   value={p0time ?? "–"}                                          accent="#10b981" sub={p0title} />
        </div>
      </Sec>

      {rc?.plainEnglish && (
        <Sec title="VERDICT">
          <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "6px", padding: "14px" }}>
            <div style={{ color: "#fca5a5", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
              {analysis.error_type ?? "Crash"} — {rc.affectedModule ?? analysis.component}
            </div>
            <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.6 }}>{rc.plainEnglish}</div>
          </div>
        </Sec>
      )}

      {data.userScenario && (
        <Sec title="USER EXPERIENCE"><Journey scenario={data.userScenario} /></Sec>
      )}

      {data.reproduction && (
        <Sec title="REPRODUCTION">
          {data.reproduction.steps && data.reproduction.steps.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              {data.reproduction.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <span style={{ color: "#6b7280", fontSize: "12px", fontFamily: mono, width: "20px" }}>{i + 1}.</span>
                  <span style={{ color: "#d1d5db", fontSize: "13px" }}>{s}</span>
                </div>
              ))}
            </div>
          )}
          {(data.reproduction.expected || data.reproduction.actual) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {data.reproduction.expected && (
                <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: "6px", padding: "12px", borderLeft: "3px solid #10b981" }}>
                  <div style={{ color: "#10b981", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "5px", fontFamily: mono }}>EXPECTED</div>
                  <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{data.reproduction.expected}</div>
                </div>
              )}
              {data.reproduction.actual && (
                <div style={{ background: "rgba(239,68,68,0.06)", borderRadius: "6px", padding: "12px", borderLeft: "3px solid #ef4444" }}>
                  <div style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "5px", fontFamily: mono }}>ACTUAL</div>
                  <div style={{ color: "#d1d5db", fontSize: "12px", lineHeight: 1.5 }}>{data.reproduction.actual}</div>
                </div>
              )}
            </div>
          )}
        </Sec>
      )}

      {expanded && data.similarCrashes && data.similarCrashes.length > 0 && (
        <Sec title="SIMILAR CRASHES"><SimilarCrashes crashes={data.similarCrashes} /></Sec>
      )}
      {expanded && data.confidenceAssessment && (
        <Sec title="ANALYSIS CONFIDENCE"><ConfidenceAssessment conf={data.confidenceAssessment} /></Sec>
      )}
      {expanded && <Sec title="INVESTIGATION NOTES"><Notes /></Sec>}
      <AiMeta analysis={analysis} />
    </div>
  )
}

function DevView({ data, analysis, expanded }: { data: WcrData; analysis: Analysis; expanded: boolean }) {
  const rc = data.rootCause

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Sec title="CLASSIFICATION">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <Card label="EXCEPTION" value={analysis.error_type ?? "–"}              accent="#ef4444" />
          <Card label="MODULE"    value={rc?.affectedModule ?? analysis.component ?? "–"} accent="#3b82f6" sub={analysis.component} />
          <Card label="TRIGGER"   value={rc?.triggerCondition?.slice(0, 30) ?? "–"} accent="#f59e0b" />
        </div>
        {(rc?.affectedMethod || rc?.triggerCondition) && (
          <div style={{ marginTop: "10px", padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
            {rc?.affectedMethod && (
              <div style={{ color: "#9ca3af", fontSize: "12px", marginBottom: "4px" }}>
                <strong style={{ color: "#e5e7eb" }}>Affected method:</strong>{" "}
                <span style={{ fontFamily: mono, color: "#93c5fd" }}>{rc.affectedMethod}</span>
              </div>
            )}
            {rc?.triggerCondition && (
              <div style={{ color: "#9ca3af", fontSize: "12px" }}>
                <strong style={{ color: "#e5e7eb" }}>Trigger condition:</strong> {rc.triggerCondition}
              </div>
            )}
          </div>
        )}
      </Sec>

      {rc?.technical && (
        <Sec title="ROOT CAUSE (TECHNICAL)">
          <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)", borderRadius: "6px", padding: "14px", borderLeft: "3px solid #3b82f6" }}>
            <div style={{ color: "#d1d5db", fontSize: "13px", lineHeight: 1.7 }}>{rc.technical}</div>
          </div>
        </Sec>
      )}

      {data.stackFrames && data.stackFrames.length > 0 && (
        <Sec title="STACK TRACE">
          <StackTrace frames={data.stackFrames} expanded={expanded} />
        </Sec>
      )}

      {data.remediation && (
        <Sec title="REMEDIATION"><Remediation remediation={data.remediation} /></Sec>
      )}

      {expanded && data.blastRadius && data.blastRadius.length > 0 && (
        <Sec title="BLAST RADIUS"><BlastRadius components={data.blastRadius} /></Sec>
      )}
      {expanded && data.similarCrashes && data.similarCrashes.length > 0 && (
        <Sec title="SIMILAR CRASHES"><SimilarCrashes crashes={data.similarCrashes} /></Sec>
      )}
      {expanded && data.confidenceAssessment && (
        <Sec title="ANALYSIS CONFIDENCE"><ConfidenceAssessment conf={data.confidenceAssessment} /></Sec>
      )}
      {expanded && <Sec title="INVESTIGATION NOTES"><Notes /></Sec>}
      <AiMeta analysis={analysis} />
    </div>
  )
}

function CustomerView({ data, analysis }: { data: WcrData; analysis: Analysis }) {
  const userName = data.username?.split("@")[0]?.replace(".", " ")?.replace(/\b\w/g, c => c.toUpperCase()) ?? "User"
  const plainEnglish = data.rootCause?.plainEnglish ?? analysis.root_cause ?? ""
  const workaround = data.remediation?.p0?.[0]?.title ?? "A fix has been identified."

  const reply = `Dear ${userName},

Thank you for reporting this issue.

SUMMARY
${plainEnglish}

WORKAROUND
${workaround}

RESOLUTION
A fix has been identified and is scheduled for the next patch release.

Kind regards,
Hadron Support`

  const tableRows = [
    ["Severity", (analysis.severity ?? "MEDIUM").toUpperCase()],
    ["Component", analysis.component ?? data.rootCause?.affectedModule ?? "–"],
    ["Error", analysis.error_type ?? "–"],
    ["Workaround", workaround],
    analysis.analysis_duration_ms ? ["Analysis duration", `${(analysis.analysis_duration_ms / 1000).toFixed(1)}s`] : null,
  ].filter(Boolean) as string[][]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Sec title="CUSTOMER-FACING REPLY" actions={<CopyBtn text={reply} label="Copy reply" />}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "20px" }}>
          <pre style={{ fontFamily: sans, fontSize: "13px", color: "#d1d5db", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}>{reply}</pre>
        </div>
      </Sec>
      <Sec title="SUMMARY TABLE">
        <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
          {tableRows.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", padding: "9px 14px", borderBottom: i < tableRows.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <span style={{ color: "#6b7280", fontSize: "12px", width: "140px", flexShrink: 0 }}>{k}</span>
              <span style={{ color: "#d1d5db", fontSize: "12px" }}>{v}</span>
            </div>
          ))}
        </div>
      </Sec>
    </div>
  )
}

function ExecView({ data, analysis, expanded }: { data: WcrData; analysis: Analysis; expanded: boolean }) {
  const rc = data.rootCause
  const sev = SEV[analysis.severity?.toLowerCase() ?? "medium"] ?? SEV.medium
  const impact = data.impactAnalysis

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "10px", padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#e5e7eb", fontSize: "18px", fontWeight: 700, marginBottom: "5px" }}>
              {analysis.error_type ?? "Application Crash"}
            </div>
            <div style={{ color: "#9ca3af", fontSize: "13px", lineHeight: 1.6, maxWidth: "520px" }}>
              {rc?.plainEnglish ?? analysis.root_cause ?? ""}
            </div>
          </div>
          <SevBadge severity={analysis.severity ?? "medium"} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
        {[
          { label: "USER IMPACT",  value: impact?.directlyAffected?.[0]?.feature ?? (analysis.component ?? "Affected users"), sub: impact?.directlyAffected?.[0]?.description ?? "",                    color: "#f59e0b" },
          { label: "DATA RISK",    value: impact?.dataAtRisk ?? "Unknown",                                                       sub: "",                                                                  color: impact?.dataAtRisk === "none" ? "#6ee7b7" : "#f59e0b" },
          { label: "FIX EFFORT",   value: data.remediation?.p0?.[0]?.time ?? "–",                                                sub: data.remediation?.p0?.[0]?.risk ? `Risk: ${data.remediation.p0![0].risk}` : "", color: "#10b981" },
        ].map(c => (
          <div key={c.label} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "14px", textAlign: "center" }}>
            <div style={{ color: "#6b7280", fontSize: "10px", letterSpacing: ".1em", fontFamily: mono, marginBottom: "6px" }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: "14px", fontWeight: 600 }}>{c.value}</div>
            {c.sub && <div style={{ color: "#9ca3af", fontSize: "11px", marginTop: "3px" }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {data.remediation && (
        <Sec title="RESOLUTION PATH">
          <div style={{ display: "flex", gap: "10px" }}>
            {[
              { p: "Now",        l: "Workaround",       d: data.remediation.p2?.[0]?.description ?? "Identify affected users",    c: "#10b981" },
              { p: "This week",  l: "P0 Fix",            d: `${data.remediation.p0?.[0]?.title ?? "Critical fix"} (${data.remediation.p0?.[0]?.time ?? "–"})`, c: "#f59e0b" },
              { p: "Sprint",     l: "Harden",           d: data.remediation.p1?.map(x => x.title).join("; ") ?? "Hardening tasks", c: "#3b82f6" },
            ].map(it => (
              <div key={it.p} style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: `1px solid ${it.c}33`, borderTop: `3px solid ${it.c}`, borderRadius: "0 0 6px 6px", padding: "12px" }}>
                <div style={{ color: it.c, fontSize: "10px", fontWeight: 700, fontFamily: mono }}>{it.p.toUpperCase()}</div>
                <div style={{ color: "#e5e7eb", fontSize: "13px", fontWeight: 600, marginTop: "5px" }}>{it.l}</div>
                <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "3px" }}>{it.d}</div>
              </div>
            ))}
          </div>
        </Sec>
      )}

      {impact && (impact.directlyAffected?.length || impact.potentiallyAffected?.length) && (
        <Sec title="IMPACT ANALYSIS">
          {impact.directlyAffected && impact.directlyAffected.length > 0 && (
            <div style={{ marginBottom: "10px" }}>
              <div style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "6px", fontFamily: mono }}>DIRECTLY AFFECTED</div>
              {impact.directlyAffected.map((x, i) => (
                <div key={i} style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)", borderRadius: "6px", padding: "10px", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                    <span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{x.feature}</span>
                    {x.module && <Tag text={x.module} color="#8b5cf6" />}
                    {x.severity && <Tag text={x.severity.toUpperCase()} color={SEV[x.severity]?.color ?? "#9ca3af"} />}
                  </div>
                  {x.description && <div style={{ color: "#9ca3af", fontSize: "11px" }}>{x.description}</div>}
                </div>
              ))}
            </div>
          )}
          {impact.potentiallyAffected && impact.potentiallyAffected.length > 0 && (
            <div>
              <div style={{ color: "#f59e0b", fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", marginBottom: "6px", fontFamily: mono }}>POTENTIALLY AFFECTED</div>
              {impact.potentiallyAffected.map((x, i) => (
                <div key={i} style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.1)", borderRadius: "6px", padding: "10px", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                    <span style={{ color: "#e5e7eb", fontSize: "12px", fontWeight: 600 }}>{x.feature}</span>
                    {x.module && <Tag text={x.module} color="#8b5cf6" />}
                    {x.severity && <Tag text={x.severity.toUpperCase()} color={SEV[x.severity]?.color ?? "#9ca3af"} />}
                  </div>
                  {x.description && <div style={{ color: "#9ca3af", fontSize: "11px" }}>{x.description}</div>}
                </div>
              ))}
            </div>
          )}
        </Sec>
      )}

      {expanded && data.blastRadius && data.blastRadius.length > 0 && (
        <Sec title="BLAST RADIUS"><BlastRadius components={data.blastRadius} /></Sec>
      )}
      {expanded && data.similarCrashes && data.similarCrashes.length > 0 && (
        <Sec title="SIMILAR CRASHES"><SimilarCrashes crashes={data.similarCrashes} /></Sec>
      )}
      <AiMeta analysis={analysis} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  WCR MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "support",   label: "Support Engineer", icon: "◎" },
  { id: "developer", label: "Developer",         icon: "⌘" },
  { id: "customer",  label: "Customer-Facing",   icon: "✉" },
  { id: "executive", label: "Executive",          icon: "◈" },
]

function WcrView({
  analysis, data, onBack,
  showJiraModal, setShowJiraModal,
  showExportDialog, setShowExportDialog,
  jiraEnabled,
  suggestedFixes,
}: {
  analysis: Analysis
  data: WcrData
  onBack: () => void
  showJiraModal: boolean
  setShowJiraModal: (v: boolean) => void
  showExportDialog: boolean
  setShowExportDialog: (v: boolean) => void
  jiraEnabled: boolean
  suggestedFixes: string[]
}) {
  const [tab, setTab] = useState("support")
  const [expanded, setExpanded] = useState(false)
  const sev = SEV[analysis.severity?.toLowerCase() ?? "medium"] ?? SEV.medium

  return (
    <div style={{ background: "#0a0a0c", color: "#d1d5db", minHeight: "100vh", fontFamily: sans, display: "flex", flexDirection: "column" }}>

      {/* Back / breadcrumb */}
      <div style={{ padding: "8px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={onBack}
            style={{ background: "none", border: "none", color: "#6b7280", fontSize: "12px", cursor: "pointer", fontFamily: mono, padding: 0, display: "inline-flex", alignItems: "center", gap: "4px" }}
          >◀ Back to History</button>
          <span style={{ color: "#4b5563" }}>│</span>
          <span style={{ color: "#4b5563", fontSize: "12px", fontFamily: mono }}>{analysis.filename}</span>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {jiraEnabled && (
            <button onClick={() => setShowJiraModal(true)} style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#6ee7b7", padding: "4px 10px", borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>⊞ JIRA</button>
          )}
          <button onClick={() => setShowExportDialog(true)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#d1d5db", padding: "4px 10px", borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontFamily: mono }}>↗ Export…</button>
        </div>
      </div>

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "11px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.01)", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: sev.color }} />
            <span style={{ color: "#e5e7eb", fontSize: "14px", fontWeight: 700, fontFamily: mono }}>
              {data.crash_id ?? `HAD-${analysis.id}`}
            </span>
          </div>
          <SevBadge severity={analysis.severity ?? "medium"} />
          {data.site && <><span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{data.site}</span></>}
          {analysis.component && <><span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{analysis.component}</span></>}
          {analysis.analyzed_at && <><span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px" }}>{new Date(analysis.analyzed_at).toLocaleDateString()}</span></>}
          {data.user && <><span style={{ color: "#4b5563" }}>│</span><span style={{ color: "#6b7280", fontSize: "12px", fontFamily: mono }}>{data.user}</span></>}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: expanded ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${expanded ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.1)"}`,
            color: expanded ? "#c4b5fd" : "#9ca3af",
            padding: "5px 12px", borderRadius: "6px", fontSize: "11px",
            cursor: "pointer", fontFamily: mono, transition: "all .2s",
          }}
        >{expanded ? "◉ Expanded" : "○ Standard"}</button>
      </div>

      {/* Error banner */}
      {(analysis.error_type || analysis.error_message) && (
        <div style={{ padding: "9px 24px", background: "rgba(239,68,68,0.04)", borderBottom: "1px solid rgba(239,68,68,0.1)", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {analysis.error_type && <span style={{ color: "#ef4444", fontSize: "12px", fontFamily: mono, fontWeight: 700 }}>{analysis.error_type}</span>}
          {analysis.error_message && <><span style={{ color: "#4b5563" }}>—</span><span style={{ color: "#fca5a5", fontSize: "12px" }}>{analysis.error_message}</span></>}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", background: "rgba(255,255,255,0.01)", overflowX: "auto" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "none", border: "none",
              padding: "10px 18px",
              color: tab === t.id ? "#e5e7eb" : "#6b7280",
              fontSize: "12px", cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid #e5e7eb" : "2px solid transparent",
              fontFamily: sans, fontWeight: tab === t.id ? 600 : 400,
              display: "inline-flex", alignItems: "center", gap: "5px",
              marginBottom: "-1px", transition: "color .15s", whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: "11px", opacity: tab === t.id ? 1 : 0.5 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", maxWidth: "1060px", width: "100%" }}>
        {tab === "support"   && <SupportView  data={data} analysis={analysis} expanded={expanded} />}
        {tab === "developer" && <DevView      data={data} analysis={analysis} expanded={expanded} />}
        {tab === "customer"  && <CustomerView data={data} analysis={analysis} />}
        {tab === "executive" && <ExecView     data={data} analysis={analysis} expanded={expanded} />}
      </div>

      {/* Modals */}
      <JiraTicketModal analysis={analysis} isOpen={showJiraModal} onClose={() => setShowJiraModal(false)} />
      <ExportDialog
        source={{
          sourceType: "crash",
          sourceName: analysis.filename,
          defaultTitle: "Crash Analysis Report",
          sections: [
            { id: "summary",   label: "Summary",         content: `Error Type: ${analysis.error_type}\nSeverity: ${analysis.severity}${analysis.error_message ? `\nError: ${analysis.error_message}` : ""}${analysis.component ? `\nComponent: ${analysis.component}` : ""}`, defaultOn: true },
            { id: "root_cause", label: "Root Cause",     content: data.rootCause?.technical ?? analysis.root_cause ?? "", defaultOn: true },
            { id: "suggested_fix", label: "Suggested Fixes", content: suggestedFixes.map((f, i) => `${i + 1}. ${f}`).join("\n"), defaultOn: true },
            { id: "stack_trace",   label: "Stack Trace", content: analysis.stack_trace ?? "", defaultOn: false },
          ].filter(s => s.content.length > 0),
        } satisfies ExportSource}
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  FLAT (LEGACY) VIEW — used when full_data has no rich structure
// ═══════════════════════════════════════════════════════════════════════════

import { ArrowLeft, Download, Copy, Check, AlertCircle, Package, Wrench, Activity, Info, Ticket, Settings2, Zap, Search, Gauge, Link2, ExternalLink, Shield, Database, BookOpen, Tag as TagIcon } from "lucide-react"
import Button from "./ui/Button"
import StackTraceViewer from "./StackTraceViewer"
import CollapsibleSection from "./CollapsibleSection"
import MultiPartAnalysisViewer from "./MultiPartAnalysisViewer"
import { getSeverityBadgeClasses } from "../utils/severity"

interface SentryMeta { issueId?: string; shortId?: string; permalink?: string; level?: string; status?: string; platform?: string; count?: string; userCount?: number }
interface JiraMeta { jiraKey?: string; jiraSummary?: string; jiraPriority?: string; jiraStatus?: string; jiraComponents?: string[]; jiraLabels?: string[]; descriptionChars?: number; commentCount?: number; ragEnabled?: boolean; ragCaseCount?: number; kbEnabled?: boolean; kbDocCount?: number; kbReleaseNoteCount?: number }

function parseSentryMeta(fd: string): SentryMeta | null {
  try {
    const d = JSON.parse(fd)
    return { issueId: d.sentry_issue_id, shortId: d.sentry_short_id, permalink: d.sentry_permalink, level: d.sentry_level, status: d.sentry_status, platform: d.sentry_platform, count: d.sentry_count, userCount: d.sentry_user_count }
  } catch { return null }
}

function parseJiraMeta(fd: string): JiraMeta | null {
  try {
    const d = JSON.parse(fd)
    const t = d.analysis_trace?.context ?? {}
    return { jiraKey: d.jira_key, jiraSummary: d.jira_summary, jiraPriority: d.jira_priority, jiraStatus: d.jira_status, jiraComponents: d.jira_components, jiraLabels: d.jira_labels, descriptionChars: d.description_chars, commentCount: d.comment_count, ragEnabled: t.rag_enabled, ragCaseCount: t.rag_case_count, kbEnabled: t.kb_enabled, kbDocCount: t.kb_doc_count, kbReleaseNoteCount: t.kb_release_note_count }
  } catch { return null }
}

function patternBadgeColor(pt: string) {
  switch (pt) {
    case "deadlock": return "bg-red-500/20 text-red-400 border-red-500/30"
    case "n_plus_one": return "bg-orange-500/20 text-orange-400 border-orange-500/30"
    case "memory_leak": return "bg-purple-500/20 text-purple-400 border-purple-500/30"
    case "unhandled_promise": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    default: return "bg-gray-500/20 text-gray-400 border-gray-500/30"
  }
}

function patternLabel(pt: string) {
  switch (pt) {
    case "deadlock": return "Deadlock"
    case "n_plus_one": return "N+1 Query"
    case "memory_leak": return "Memory Leak"
    case "unhandled_promise": return "Unhandled Promise"
    default: return pt
  }
}

function FlatView({
  analysis, onBack,
  showJiraModal, setShowJiraModal,
  showExportDialog, setShowExportDialog,
  jiraEnabled, suggestedFixes,
}: {
  analysis: Analysis
  onBack: () => void
  showJiraModal: boolean
  setShowJiraModal: (v: boolean) => void
  showExportDialog: boolean
  setShowExportDialog: (v: boolean) => void
  jiraEnabled: boolean
  suggestedFixes: string[]
}) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) } }, [])

  const handleCopy = () => {
    const text = `Analysis Report - ${analysis.filename}\n${"=".repeat(40)}\n\nError Type: ${analysis.error_type}\nSeverity: ${analysis.severity.toUpperCase()}\nAnalyzed: ${format(new Date(analysis.analyzed_at), "MMMM d, yyyy 'at' h:mm a")}\nModel: ${analysis.ai_model}\nCost: $${analysis.cost.toFixed(4)}\n\nROOT CAUSE\n----------\n${analysis.root_cause}\n\nSUGGESTED FIXES\n---------------\n${suggestedFixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n---\nGenerated by Hadron`.trim()
    navigator.clipboard.writeText(text)
    setCopied(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const handleExportMarkdown = () => {
    const md = `# Analysis Report: ${analysis.filename}\n\n**Error Type:** ${analysis.error_type}\n**Severity:** ${analysis.severity.toUpperCase()}\n**Analyzed:** ${format(new Date(analysis.analyzed_at), "MMMM d, yyyy 'at' h:mm a")}\n**Model:** ${analysis.ai_model}\n**Cost:** $${analysis.cost.toFixed(4)}\n\n## Root Cause\n\n${analysis.root_cause}\n\n## Suggested Fixes\n\n${suggestedFixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n---\n\n*Generated by Hadron*\n`
    const blob = new Blob([md], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${analysis.filename.replace(/\.(txt|log)$/i, "")}-analysis.md`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const sentryData = analysis.analysis_type === "sentry" && analysis.full_data ? parseSentryMeta(analysis.full_data) : null
  const isJiraAnalysis = analysis.analysis_type === "jira" || analysis.analysis_type === "jira_ticket"
  const jiraData = isJiraAnalysis && analysis.full_data ? parseJiraMeta(analysis.full_data) : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-1.5 text-sm">
          <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> History
          </button>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400 truncate max-w-xs">{analysis.filename}</span>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleCopy} icon={copied ? <Check className="text-green-400" /> : <Copy />}>{copied ? "Copied!" : "Copy Report"}</Button>
          <Button variant="secondary" onClick={handleExportMarkdown} icon={<Download />} title="Quick export to Markdown">Quick Export</Button>
          <Button variant="primary" onClick={() => setShowExportDialog(true)} icon={<Settings2 />}>Export Options</Button>
          {jiraEnabled && <Button variant="success" onClick={() => setShowJiraModal(true)} icon={<Ticket />}>Create JIRA Ticket</Button>}
          {sentryData?.permalink && <Button variant="warning" onClick={() => open(sentryData.permalink!)} icon={<ExternalLink />}>View in Sentry</Button>}
        </div>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold mb-2">{analysis.filename}</h2>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span>{format(new Date(analysis.analyzed_at), "MMMM d, yyyy 'at' h:mm a")}</span>
              <span>•</span><span>{analysis.file_size_kb.toFixed(1)} KB</span>
              <span>•</span><span>{analysis.ai_model}</span>
              <span>•</span><span>${analysis.cost.toFixed(4)}</span>
            </div>
          </div>
          <span className={`px-4 py-2 rounded-lg text-sm font-semibold border ${getSeverityBadgeClasses(analysis.severity)}`}>{analysis.severity.toUpperCase()}</span>
        </div>

        {sentryData && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400"><Shield className="w-3.5 h-3.5" /> Sentry Issue</span>
            {sentryData.shortId && <span className="text-gray-400"><span className="text-gray-500">ID:</span> <span className="font-mono text-gray-300">{sentryData.shortId}</span></span>}
            {sentryData.platform && <span className="text-gray-400"><span className="text-gray-500">Platform:</span> {sentryData.platform}</span>}
            {sentryData.count && <span className="text-gray-400"><span className="text-gray-500">Events:</span> {sentryData.count}</span>}
            {sentryData.userCount != null && sentryData.userCount > 0 && <span className="text-gray-400"><span className="text-gray-500">Users:</span> {sentryData.userCount}</span>}
            {sentryData.level && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${sentryData.level === "fatal" ? "bg-red-600 text-white" : sentryData.level === "error" ? "bg-red-500/20 text-red-400" : sentryData.level === "warning" ? "bg-yellow-500/20 text-yellow-400" : "bg-gray-500/20 text-gray-400"}`}>{sentryData.level}</span>}
          </div>
        )}

        {jiraData && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-500/10 border border-sky-500/20 rounded-lg text-sky-400"><Ticket className="w-3.5 h-3.5" />{jiraData.jiraKey ?? "JIRA"}</span>
            {jiraData.jiraPriority && <span className="text-gray-400"><span className="text-gray-500">Priority:</span> {jiraData.jiraPriority}</span>}
            {jiraData.jiraStatus && <span className="text-gray-400"><span className="text-gray-500">Status:</span> {jiraData.jiraStatus}</span>}
            {jiraData.jiraComponents?.length && <span className="flex items-center gap-1 text-gray-400"><Package className="w-3 h-3 text-gray-500" />{jiraData.jiraComponents.map(c => <span key={c} className="px-1.5 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded text-xs text-sky-300">{c}</span>)}</span>}
            {jiraData.jiraLabels?.length && <span className="flex items-center gap-1 text-gray-400"><TagIcon className="w-3 h-3 text-gray-500" />{jiraData.jiraLabels.map(l => <span key={l} className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300">{l}</span>)}</span>}
            {jiraData.ragEnabled && (jiraData.ragCaseCount ?? 0) > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-xs text-emerald-400"><Database className="w-3 h-3" />RAG: {jiraData.ragCaseCount} case{jiraData.ragCaseCount !== 1 ? "s" : ""}</span>}
            {jiraData.kbEnabled && ((jiraData.kbDocCount ?? 0) > 0 || (jiraData.kbReleaseNoteCount ?? 0) > 0) && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-xs text-purple-400"><BookOpen className="w-3 h-3" />KB: {jiraData.kbDocCount} doc{jiraData.kbDocCount !== 1 ? "s" : ""}{(jiraData.kbReleaseNoteCount ?? 0) > 0 ? `, ${jiraData.kbReleaseNoteCount} RN` : ""}</span>}
          </div>
        )}

        {analysis.analysis_mode && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${analysis.analysis_mode === "Deep Scan" ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" : analysis.analysis_mode?.includes("Extracted") ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-green-500/20 text-green-400 border border-green-500/30"}`}>
              {analysis.analysis_mode === "Deep Scan" ? <Search className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}{analysis.analysis_mode}
            </span>
            {analysis.token_utilization !== undefined && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${analysis.token_utilization > 80 ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : analysis.token_utilization > 50 ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"}`}>
                <Gauge className="w-3.5 h-3.5" />{analysis.token_utilization.toFixed(0)}% Token Usage
              </span>
            )}
            {analysis.coverage_summary && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700/50 text-gray-300 border border-gray-600"><Info className="w-3.5 h-3.5" />{analysis.coverage_summary}</span>}
          </div>
        )}

        {analysis.analysis_type === "sentry" && analysis.full_data && (() => {
          try {
            const d = JSON.parse(analysis.full_data)
            const patterns = d?.detected_patterns
            if (!Array.isArray(patterns) || !patterns.length) return null
            return (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 mr-1">Detected:</span>
                {patterns.map((p: { patternType: string; confidence: number; evidence: string[] }, i: number) => (
                  <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${patternBadgeColor(p.patternType)}`} title={p.evidence?.join("; ") ?? ""}>
                    {patternLabel(p.patternType)} <span className="opacity-60">{Math.round(p.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
            )
          } catch { return null }
        })()}

        {analysis.was_truncated && <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-400">⚠️ This file was truncated for analysis. Large portions may have been omitted.</div>}
      </div>

      <CollapsibleSection title="Error Type" icon={<AlertCircle className="w-5 h-5" />} badge={<span className={`px-3 py-1 rounded-lg text-xs font-semibold border ${getSeverityBadgeClasses(analysis.severity)}`}>{analysis.severity.toUpperCase()}</span>}>
        <p className="text-gray-300 text-lg font-medium">{analysis.error_type}</p>
        {analysis.error_message && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"><div className="flex items-start gap-2"><AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" /><p className="text-sm text-red-300">{analysis.error_message}</p></div></div>}
        {analysis.component && <div className="mt-3 flex items-center gap-2 text-sm"><Package className="w-4 h-4 text-blue-400" /><span className="text-gray-400">Affected Component:</span><span className="text-blue-400 font-mono">{analysis.component}</span></div>}
      </CollapsibleSection>

      {analysis.stack_trace && (
        <CollapsibleSection title="Stack Trace" icon={<Activity className="w-5 h-5" />} defaultOpen={false}>
          <StackTraceViewer stackTrace={analysis.stack_trace} />
        </CollapsibleSection>
      )}

      <MultiPartAnalysisViewer rootCause={analysis.root_cause} />

      <CollapsibleSection title="Suggested Fixes" icon={<Wrench className="w-5 h-5" />} badge={<span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-semibold">{suggestedFixes.length} {suggestedFixes.length === 1 ? "Fix" : "Fixes"}</span>}>
        <div className="space-y-3">
          {suggestedFixes.map((fix, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-semibold">{i + 1}</div>
              <p className="text-gray-300 flex-1">{fix}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Analysis Metadata" icon={<Info className="w-5 h-5" />} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-400">Analysis ID:</span><span className="ml-2 font-mono">{analysis.id}</span></div>
          <div><span className="text-gray-400">Tokens Used:</span><span className="ml-2">{analysis.tokens_used.toLocaleString()}</span></div>
          <div><span className="text-gray-400">Model:</span><span className="ml-2">{analysis.ai_model}</span></div>
          {analysis.ai_provider && <div><span className="text-gray-400">Provider:</span><span className="ml-2 capitalize">{analysis.ai_provider}</span></div>}
          {analysis.confidence && <div><span className="text-gray-400">Confidence:</span><span className={`ml-2 font-semibold ${analysis.confidence === "HIGH" ? "text-green-400" : analysis.confidence === "MEDIUM" ? "text-yellow-400" : "text-orange-400"}`}>{analysis.confidence}</span></div>}
          <div><span className="text-gray-400">Cost:</span><span className="ml-2 text-green-400 font-semibold">${analysis.cost.toFixed(4)}</span></div>
          {analysis.analysis_duration_ms && <div><span className="text-gray-400">Duration:</span><span className="ml-2 text-blue-400 font-semibold">{(analysis.analysis_duration_ms / 1000).toFixed(2)}s</span></div>}
          <div><span className="text-gray-400">File Size:</span><span className="ml-2">{analysis.file_size_kb.toFixed(2)} KB</span></div>
          <div><span className="text-gray-400">Truncated:</span><span className="ml-2">{analysis.was_truncated ? "Yes" : "No"}</span></div>
          {analysis.is_favorite && <div><span className="text-gray-400">Favorite:</span><span className="ml-2 text-yellow-400">★ Yes</span></div>}
          {analysis.view_count > 0 && <div><span className="text-gray-400">Views:</span><span className="ml-2">{analysis.view_count}</span></div>}
        </div>
      </CollapsibleSection>

      {jiraEnabled && (
        <CollapsibleSection title="Linked JIRA Tickets" icon={<Link2 className="w-5 h-5" />} defaultOpen={true} headerContent={<JiraSyncStatus compact />}>
          <LinkedTickets analysisId={analysis.id} />
        </CollapsibleSection>
      )}

      <JiraTicketModal analysis={analysis} isOpen={showJiraModal} onClose={() => setShowJiraModal(false)} />
      <ExportDialog
        source={{
          sourceType: "crash",
          sourceName: analysis.filename,
          defaultTitle: "Crash Analysis Report",
          sections: [
            { id: "summary",       label: "Summary",         content: `Error Type: ${analysis.error_type}\nSeverity: ${analysis.severity}${analysis.error_message ? `\nError Message: ${analysis.error_message}` : ""}${analysis.component ? `\nComponent: ${analysis.component}` : ""}`, defaultOn: true },
            { id: "root_cause",    label: "Root Cause",      content: analysis.root_cause ?? "", defaultOn: true },
            { id: "suggested_fix", label: "Suggested Fixes", content: suggestedFixes.map((f, i) => `${i + 1}. ${f}`).join("\n"), defaultOn: true },
            { id: "stack_trace",   label: "Stack Trace",     content: analysis.stack_trace ?? "", defaultOn: false },
            { id: "environment",   label: "Environment",     content: `File: ${analysis.filename}\nSize: ${analysis.file_size_kb} KB\nModel: ${analysis.ai_model}`, defaultOn: true },
          ].filter(s => s.content.length > 0),
        } satisfies ExportSource}
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default function AnalysisDetailView({ analysis, onBack }: AnalysisDetailViewProps) {
  const [showJiraModal, setShowJiraModal] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [jiraEnabled, setJiraEnabled] = useState(false)

  useEffect(() => { isJiraEnabled().then(setJiraEnabled) }, [])

  const suggestedFixes: string[] = (() => {
    const sf = analysis.suggested_fixes
    if (!sf) return []
    if (Array.isArray(sf)) return sf as string[]
    const trimmed = (sf as string).trim()
    if (trimmed.startsWith("[")) { try { return JSON.parse(trimmed) as string[] } catch {} }
    return trimmed.split("\n").filter((l: string) => l.trim())
  })()

  const wcrData = parseWcrData(analysis.full_data)

  if (wcrData) {
    return (
      <WcrView
        analysis={analysis}
        data={wcrData}
        onBack={onBack}
        showJiraModal={showJiraModal}
        setShowJiraModal={setShowJiraModal}
        showExportDialog={showExportDialog}
        setShowExportDialog={setShowExportDialog}
        jiraEnabled={jiraEnabled}
        suggestedFixes={suggestedFixes}
      />
    )
  }

  return (
    <FlatView
      analysis={analysis}
      onBack={onBack}
      showJiraModal={showJiraModal}
      setShowJiraModal={setShowJiraModal}
      showExportDialog={showExportDialog}
      setShowExportDialog={setShowExportDialog}
      jiraEnabled={jiraEnabled}
      suggestedFixes={suggestedFixes}
    />
  )
}
