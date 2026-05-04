import { IpcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import * as XLSX from 'xlsx'

// ============================================================================
// Types
// ============================================================================

interface ExportRequest {
  crash_content: string
  file_name: string
  format: string
  audience?: string
  title?: string
  include_sections?: string[]
  footer_text?: string
}

interface ExportResponse {
  content: string
  suggested_filename: string
  format: string
}

interface GenericSection {
  id: string
  label: string
  content: string
}

interface GenericExportRequest {
  source_type: string
  source_name: string
  format: string
  audience?: string
  title?: string
  sections: GenericSection[]
  footer_text?: string
}

interface SensitiveContentResult {
  has_sensitive: boolean
  warnings: string[]
  detected_types: string[]
}

interface ReportMeta {
  generated_at: string
  report_id: string
  source?: string
  source_type?: string
  source_name?: string
}

// ============================================================================
// PII detection (ported from export/sanitizer.rs)
// ============================================================================

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const TOKEN_RE = /(?:api[_-]?key|token|secret|password|pwd|auth)[^\s]*\s*[=:]\s*\S+/gi
const PATH_RE = /(?:\/home\/|\/Users\/|C:\\Users\\)[^\s/\\]+/gi
const CREDENTIAL_RE = /(?:username|user|login)\s*[=:]\s*\S+/gi

function detectPiiTypes(content: string): string[] {
  const types: string[] = []
  const tests: [RegExp, string][] = [
    [EMAIL_RE, 'email'],
    [IP_RE, 'ip'],
    [TOKEN_RE, 'token'],
    [PATH_RE, 'path'],
    [CREDENTIAL_RE, 'credentials'],
  ]
  for (const [re, label] of tests) {
    re.lastIndex = 0
    if (re.test(content)) types.push(label)
    re.lastIndex = 0
  }
  return types
}

function redactPii(content: string): string {
  TOKEN_RE.lastIndex = 0
  CREDENTIAL_RE.lastIndex = 0
  return content
    .replace(new RegExp(EMAIL_RE.source, 'g'), '[EMAIL]')
    .replace(new RegExp(IP_RE.source, 'g'), '[IP]')
    .replace(new RegExp(TOKEN_RE.source, 'gi'), (m) => m.replace(/([=:])\s*\S+/, '$1 [REDACTED]'))
    .replace(new RegExp(PATH_RE.source, 'g'), '[USER_PATH]')
    .replace(new RegExp(CREDENTIAL_RE.source, 'gi'), (m) => m.replace(/([=:])\s*\S+/, '$1 [REDACTED]'))
}

function simplifyTechnicalTerms(text: string): string {
  const replacements: [RegExp, string][] = [
    [/SubscriptOutOfBoundsError/gi, 'Application Error'],
    [/NullPointerException/gi, 'Application Error'],
    [/OutOfMemoryError/gi, 'Memory Issue'],
    [/StackOverflowError/gi, 'Application Error'],
    [/ConnectionRefusedException/gi, 'Connection Error'],
    [/SQLException/gi, 'Database Error'],
  ]
  let result = text
  for (const [re, replacement] of replacements) result = result.replace(re, replacement)
  return result
}

function applyAudienceFilter(content: string, audience: string): string {
  if (audience === 'customer' || audience === 'executive') {
    return simplifyTechnicalTerms(redactPii(content))
  }
  return redactPii(content)
}

// ============================================================================
// HTML helpers
// ============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const BASE_CSS = `
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:2rem;line-height:1.6}
.container{max-width:900px;margin:0 auto}
h1{color:#60a5fa;border-bottom:2px solid #334155;padding-bottom:.5rem}
h2{color:#93c5fd;margin-top:1.5rem}
.meta{color:#94a3b8;font-size:.9rem;margin-bottom:1.5rem}
.section{background:#1e293b;border-radius:8px;padding:1.25rem;margin-bottom:1rem;white-space:pre-wrap;word-break:break-word}
.footer{border-top:1px solid #334155;margin-top:2rem;padding-top:1rem;color:#64748b;font-style:italic}
`

function htmlDoc(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body><div class="container">${body}</div></body>
</html>`
}

// ============================================================================
// Format generators
// ============================================================================

function toMarkdown(title: string, sections: GenericSection[], meta: ReportMeta, footer?: string): string {
  let md = `# ${title}\n\n`
  md += `**Generated:** ${meta.generated_at}  \n**Report ID:** ${meta.report_id}  \n`
  if (meta.source) md += `**Source:** ${meta.source}  \n`
  md += '\n'
  for (const s of sections) md += `## ${s.label}\n\n${s.content}\n\n`
  if (footer) md += `---\n*${footer}*\n`
  return md
}

function toHtml(title: string, sections: GenericSection[], meta: ReportMeta, footer?: string): string {
  const metaHtml = [
    `<div>Generated: ${escapeHtml(meta.generated_at)}</div>`,
    `<div>Report ID: ${escapeHtml(meta.report_id)}</div>`,
    meta.source ? `<div>Source: ${escapeHtml(meta.source)}</div>` : '',
  ].filter(Boolean).join('\n')

  const sectionsHtml = sections.map(s =>
    `<h2>${escapeHtml(s.label)}</h2><div class="section">${escapeHtml(s.content)}</div>`
  ).join('\n')

  const footerHtml = footer ? `<div class="footer">${escapeHtml(footer)}</div>` : ''

  return htmlDoc(title, `
<h1>${escapeHtml(title)}</h1>
<div class="meta">${metaHtml}</div>
${sectionsHtml}
${footerHtml}`)
}

function toHtmlInteractive(title: string, sections: GenericSection[], meta: ReportMeta, footer?: string): string {
  const tabButtons = sections.map((s, i) =>
    `<button class="tab${i === 0 ? ' active' : ''}" onclick="show(${i})">${escapeHtml(s.label)}</button>`
  ).join('\n')

  const tabPanels = sections.map((s, i) =>
    `<div class="panel${i === 0 ? ' active' : ''}" id="p${i}"><pre>${escapeHtml(s.content)}</pre></div>`
  ).join('\n')

  const footerHtml = footer ? `<div class="footer">${escapeHtml(footer)}</div>` : ''

  const interactiveCss = `
.tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
.tab{background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:.4rem .9rem;border-radius:6px;cursor:pointer;font-size:.9rem}
.tab.active,.tab:hover{background:#3b82f6;color:#fff;border-color:#3b82f6}
.panel{display:none;background:#1e293b;border-radius:8px;padding:1.25rem}
.panel.active{display:block}
pre{margin:0;white-space:pre-wrap;word-break:break-word;color:#e2e8f0}
`

  const script = `
function show(i){
  document.querySelectorAll('.tab').forEach((t,j)=>t.classList.toggle('active',i===j));
  document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',i===j));
}
`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${interactiveCss}</style>
</head>
<body>
<div class="container">
<h1>${escapeHtml(title)}</h1>
<div class="meta">
  <div>Generated: ${escapeHtml(meta.generated_at)}</div>
  <div>Report ID: ${escapeHtml(meta.report_id)}</div>
  ${meta.source ? `<div>Source: ${escapeHtml(meta.source)}</div>` : ''}
</div>
<div class="tabs">${tabButtons}</div>
${tabPanels}
${footerHtml}
</div>
<script>${script}</script>
</body>
</html>`
}

function toJson(title: string, sections: GenericSection[], meta: ReportMeta): string {
  return JSON.stringify({ title, metadata: meta, sections }, null, 2)
}

function toTxt(title: string, sections: GenericSection[], meta: ReportMeta, footer?: string): string {
  const bar = '='.repeat(Math.min(title.length, 80))
  let txt = `${title}\n${bar}\n\nGenerated: ${meta.generated_at}\nReport ID: ${meta.report_id}\n`
  if (meta.source) txt += `Source: ${meta.source}\n`
  txt += '\n'
  for (const s of sections) {
    const dashes = '-'.repeat(Math.min(s.label.length, 80))
    txt += `${s.label}\n${dashes}\n${s.content}\n\n`
  }
  if (footer) txt += `---\n${footer}\n`
  return txt
}

function toXlsx(title: string, sections: GenericSection[], meta: ReportMeta): string {
  const wb = XLSX.utils.book_new()

  // Metadata sheet
  const metaRows = [
    ['Report Title', title],
    ['Generated', meta.generated_at],
    ['Report ID', meta.report_id],
    ...(meta.source ? [['Source', meta.source]] : []),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), 'Info')

  // One sheet per section (max 31-char sheet names, Excel limit)
  for (const section of sections) {
    const sheetName = section.label.slice(0, 31).replace(/[[\]\\/?*:]/g, '_')
    const rows = section.content.split('\n').map(line => [line])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName)
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(buf).toString('base64')
}

// ============================================================================
// Report dispatch
// ============================================================================

function makeReportId(): string {
  return crypto.randomUUID()
}

function formatReport(
  title: string,
  sections: GenericSection[],
  format: string,
  meta: ReportMeta,
  footer?: string
): { content: string; extension: string } {
  switch (format.toLowerCase()) {
    case 'html':
      return { content: toHtml(title, sections, meta, footer), extension: 'html' }
    case 'html_interactive':
      return { content: toHtmlInteractive(title, sections, meta, footer), extension: 'html' }
    case 'json':
      return { content: toJson(title, sections, meta), extension: 'json' }
    case 'txt':
    case 'text':
      return { content: toTxt(title, sections, meta, footer), extension: 'txt' }
    case 'xlsx':
    case 'excel':
      return { content: toXlsx(title, sections, meta), extension: 'xlsx' }
    default:
      return { content: toMarkdown(title, sections, meta, footer), extension: 'md' }
  }
}

// ============================================================================
// IPC handler registration
// ============================================================================

export function registerExportHandlers(ipc: IpcMain): void {
  // File write aliases used by ExportDialog / ExportMenu
  ipc.handle('write_export_text', async (_e, args: { path: string; content: string }) => {
    await fs.writeFile(args.path, args.content, 'utf-8')
  })

  ipc.handle('write_export_bytes', async (_e, args: { path: string; data: number[] }) => {
    await fs.writeFile(args.path, Buffer.from(args.data))
  })

  // Static data
  ipc.handle('get_export_formats', () => [
    { id: 'markdown', name: 'Markdown', extension: 'md', description: 'Plain text with formatting, ideal for documentation' },
    { id: 'html', name: 'HTML', extension: 'html', description: 'Styled web page, can be opened in any browser' },
    { id: 'html_interactive', name: 'Interactive HTML', extension: 'html', description: 'Interactive page with tabbed navigation per section' },
    { id: 'json', name: 'JSON', extension: 'json', description: 'Structured data, ideal for integrations' },
    { id: 'txt', name: 'Plain Text', extension: 'txt', description: 'Simple text format without formatting' },
    { id: 'xlsx', name: 'Excel (XLSX)', extension: 'xlsx', description: 'Multi-sheet spreadsheet with tabbed sections', isBinary: true },
  ])

  ipc.handle('get_audience_options', () => [
    { id: 'technical', name: 'Technical', description: 'Full details for developers' },
    { id: 'support', name: 'Support', description: 'Actionable info for support engineers' },
    { id: 'customer', name: 'Customer', description: 'Sanitized summary for end users' },
    { id: 'executive', name: 'Executive', description: 'High-level summary for management' },
  ])

  // PII detection and sanitization
  ipc.handle('check_sensitive_content', (_e, args: { content: string }): SensitiveContentResult => {
    const types = detectPiiTypes(args.content)
    const WARNINGS: Record<string, string> = {
      email: 'Email addresses detected in content',
      ip: 'IP addresses detected in content',
      token: 'API tokens or keys detected in content',
      path: 'User directory paths detected in content',
      credentials: 'Credentials detected in content',
    }
    return {
      has_sensitive: types.length > 0,
      warnings: types.map(t => WARNINGS[t] ?? `${t} detected in content`),
      detected_types: types,
    }
  })

  ipc.handle('sanitize_content', (_e, args: { content: string; audience: string }): string => {
    return applyAudienceFilter(args.content, args.audience)
  })

  // generate_report — for crash sourceType in ExportDialog
  ipc.handle('generate_report', (_e, args: { request: ExportRequest }): ExportResponse => {
    const { request } = args
    const audience = request.audience ?? 'technical'
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const title = request.title ?? 'Crash Analysis Report'
    const baseName = path.basename(request.file_name, path.extname(request.file_name))

    const body = applyAudienceFilter(request.crash_content, audience)
    const sections: GenericSection[] = [{ id: 'analysis', label: 'Analysis', content: body }]
    const meta: ReportMeta = {
      generated_at: now,
      report_id: makeReportId(),
      source: request.file_name,
    }

    const { content, extension } = formatReport(title, sections, request.format, meta, request.footer_text)
    return { content, suggested_filename: `${baseName}_report.${extension}`, format: request.format }
  })

  // export_generic_report — for code/sentry/jira analyzers
  ipc.handle('export_generic_report', (_e, args: { request: GenericExportRequest }): ExportResponse => {
    const { request } = args
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const title = request.title ?? `${request.source_type} Report`
    const baseName = request.source_name.replace(/[/\\:*?"<>|]/g, '_')

    const audience = request.audience ?? 'technical'
    const sections: GenericSection[] = request.sections.map(s => ({
      ...s,
      content: applyAudienceFilter(s.content, audience),
    }))

    const meta: ReportMeta = {
      generated_at: now,
      report_id: makeReportId(),
      source: `${request.source_type} (${request.source_name})`,
      source_type: request.source_type,
      source_name: request.source_name,
    }

    const { content, extension } = formatReport(title, sections, request.format, meta, request.footer_text)
    return {
      content,
      suggested_filename: `${baseName}_${request.source_type}_report.${extension}`,
      format: request.format,
    }
  })

  // preview_report — returns HTML string for in-app preview
  ipc.handle('preview_report', (_e, args: {
    crash_content: string
    file_name: string
    format: string
    audience: string
    title?: string
  }): string => {
    const body = applyAudienceFilter(args.crash_content, args.audience ?? 'technical')
    const sections: GenericSection[] = [{ id: 'analysis', label: 'Analysis', content: body }]
    const meta: ReportMeta = {
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      report_id: makeReportId(),
      source: args.file_name,
    }
    return toHtml(args.title ?? 'Report Preview', sections, meta)
  })
}
