/**
 * Generates an annotated WHATS'ON Crash Report (.docx) from structured analysis data.
 *
 * Color scheme (from WCR prompt):
 *   Red    #CC0000 / bg #FFF0F0 — crash-causing frames, error lines
 *   Blue   #0055CC / bg #F0F5FF — fix annotations (▶ FIX:)
 *   Orange #CC6600 / bg #FFF8F0 — query warnings (⚠ QUERY ISSUE:)
 *   Gray   #666666 / no bg      — collapsed/less-relevant frames
 *   Black  #000000 / no bg      — normal content
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  ShadingType,
  BorderStyle,
  TableLayoutType,
  PageOrientation,
} from "docx";
import type { WhatsOnEnhancedAnalysis, StackFrame } from "../types";
import type { Analysis } from "../services/api";

type DocElement = Paragraph | Table;

// ── Colour constants ──────────────────────────────────────────────────────────
const C_RED_TEXT = "CC0000";
const C_RED_BG = "FFF0F0";
const C_BLUE_TEXT = "0055CC";
const C_BLUE_BG = "F0F5FF";
const C_ORANGE_TEXT = "CC6600";
const C_ORANGE_BG = "FFF8F0";
const C_GRAY_TEXT = "666666";
const C_HEADER_BG = "1B2A4A";
const C_HEADER_TEXT = "FFFFFF";
const C_BORDER = "CCCCCC";

// ── Font sizes (half-points in docx) ─────────────────────────────────────────
const MONO_SIZE = 17; // 8.5pt
const BODY_SIZE = 18; // 9pt
const PLAIN_SIZE = 22; // 11pt
const HEADING_SIZE = 24; // 12pt

// ── Helpers ───────────────────────────────────────────────────────────────────

function monoRun(text: string, color = "000000"): TextRun {
  return new TextRun({ text, font: "Consolas", size: MONO_SIZE, color });
}

function bodyRun(text: string, opts?: { bold?: boolean; italic?: boolean; color?: string }): TextRun {
  return new TextRun({
    text,
    font: "Arial",
    size: BODY_SIZE,
    bold: opts?.bold,
    italics: opts?.italic,
    color: opts?.color ?? "000000",
  });
}

function plainRun(text: string, opts?: { bold?: boolean; color?: string }): TextRun {
  return new TextRun({
    text,
    font: "Arial",
    size: PLAIN_SIZE,
    bold: opts?.bold,
    color: opts?.color ?? "000000",
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 240, after: 120 },
  });
}

function emptyLine(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: "" })] });
}

function redParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [monoRun(text, C_RED_TEXT)],
    shading: { type: ShadingType.SOLID, color: C_RED_BG, fill: C_RED_BG },
    spacing: { before: 60, after: 60 },
  });
}

function blueParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [bodyRun(text, { italic: true, color: C_BLUE_TEXT })],
    shading: { type: ShadingType.SOLID, color: C_BLUE_BG, fill: C_BLUE_BG },
    spacing: { before: 60, after: 60 },
  });
}

function orangeParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [bodyRun(text, { italic: true, color: C_ORANGE_TEXT })],
    shading: { type: ShadingType.SOLID, color: C_ORANGE_BG, fill: C_ORANGE_BG },
    spacing: { before: 60, after: 60 },
  });
}

function grayParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [monoRun(text, C_GRAY_TEXT)],
    spacing: { before: 60, after: 60 },
  });
}

function darkHeaderRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map(
      (text) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text, font: "Arial", size: BODY_SIZE, bold: true, color: C_HEADER_TEXT }),
              ],
            }),
          ],
          shading: { type: ShadingType.SOLID, color: C_HEADER_BG, fill: C_HEADER_BG },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
            left: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
            right: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
          },
        })
    ),
  });
}

function dataRow(cells: string[], highlight?: string): TableRow {
  return new TableRow({
    children: cells.map(
      (text) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text, font: "Arial", size: BODY_SIZE, color: highlight ?? "000000" })],
            }),
          ],
          shading: highlight
            ? { type: ShadingType.SOLID, color: C_RED_BG, fill: C_RED_BG }
            : undefined,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
            left: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
            right: { style: BorderStyle.SINGLE, size: 1, color: C_BORDER },
          },
        })
    ),
  });
}

function simpleTable(headers: string[], rows: string[][]): Table {
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      darkHeaderRow(headers),
      ...rows.map((row) =>
        dataRow(row, row.some((c) => /critical|crash|root|error/i.test(c)) ? C_RED_TEXT : undefined)
      ),
    ],
  });
}

function colorLegendTable(): Table {
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      darkHeaderRow(["Colour", "Hex", "Background", "Used for"]),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Red", font: "Arial", size: BODY_SIZE, color: C_RED_TEXT, bold: true })] })],
            shading: { type: ShadingType.SOLID, color: C_RED_BG, fill: C_RED_BG },
          }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#CC0000")] })] }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#FFF0F0")] })] }),
          new TableCell({ children: [new Paragraph({ children: [bodyRun("Crash-causing frames, failing queries, dangerous configurations")] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Blue", font: "Arial", size: BODY_SIZE, color: C_BLUE_TEXT, bold: true })] })],
            shading: { type: ShadingType.SOLID, color: C_BLUE_BG, fill: C_BLUE_BG },
          }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#0055CC")] })] }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#F0F5FF")] })] }),
          new TableCell({ children: [new Paragraph({ children: [bodyRun("▶ FIX: annotations — code changes, user actions, DBA tasks")] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Orange", font: "Arial", size: BODY_SIZE, color: C_ORANGE_TEXT, bold: true })] })],
            shading: { type: ShadingType.SOLID, color: C_ORANGE_BG, fill: C_ORANGE_BG },
          }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#CC6600")] })] }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#FFF8F0")] })] }),
          new TableCell({ children: [new Paragraph({ children: [bodyRun("⚠ QUERY ISSUE: SQL performance, missing indexes, plan concerns")] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Gray", font: "Arial", size: BODY_SIZE, color: C_GRAY_TEXT, bold: true })] })],
          }),
          new TableCell({ children: [new Paragraph({ children: [monoRun("#666666")] })] }),
          new TableCell({ children: [new Paragraph({ children: [bodyRun("—")] })] }),
          new TableCell({ children: [new Paragraph({ children: [bodyRun("Collapsed/less-relevant stack frames")] })] }),
        ],
      }),
    ],
  });
}

// ── Severity helper ───────────────────────────────────────────────────────────
function severityToP(sev: string): string {
  switch (sev.toLowerCase()) {
    case "critical": return "P1 Critical";
    case "high":     return "P2 High";
    case "medium":   return "P3 Medium";
    default:         return "P4 Low";
  }
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildSection0(ed: WhatsOnEnhancedAnalysis): DocElement[] {
  const paras: Paragraph[] = [
    heading("Plain Language Summary", HeadingLevel.HEADING_1),
    new Paragraph({
      children: [plainRun("This section is written for non-technical readers. No jargon.", { color: C_GRAY_TEXT })],
    }),
    emptyLine(),
    new Paragraph({ children: [plainRun("What happened:", { bold: true })] }),
    new Paragraph({ children: [plainRun(ed.userScenario.description)] }),
    emptyLine(),
    new Paragraph({ children: [plainRun("Why it happened:", { bold: true })] }),
    new Paragraph({ children: [plainRun(ed.rootCause.plainEnglish)] }),
    emptyLine(),
  ];

  // What the user can do right now — reproduction steps
  if (ed.userScenario.steps.length > 0) {
    paras.push(new Paragraph({ children: [plainRun("What the user can do right now:", { bold: true })] }));
    paras.push(
      new Paragraph({
        children: [plainRun("• Close unused screens and restart the application if it becomes unresponsive.")],
      })
    );
    paras.push(emptyLine());
  }

  // What IT/Development needs to fix
  paras.push(new Paragraph({ children: [plainRun("What IT / Development needs to fix:", { bold: true })] }));
  paras.push(new Paragraph({ children: [plainRun(ed.suggestedFix.summary)] }));
  paras.push(emptyLine());

  // Severity and impact
  paras.push(new Paragraph({ children: [plainRun("Severity and impact:", { bold: true })] }));
  paras.push(
    new Paragraph({
      children: [
        plainRun(`Severity: ${severityToP(ed.summary.severity)} | Data at risk: ${ed.impactAnalysis.dataAtRisk} | Confidence: ${ed.summary.confidence}`),
      ],
    })
  );

  return paras;
}

function buildSection1(ed: WhatsOnEnhancedAnalysis, filename: string): DocElement[] {
  return [
    heading("Title Block", HeadingLevel.HEADING_1),
    new Paragraph({
      children: [
        new TextRun({ text: ed.summary.title, font: "Arial", size: HEADING_SIZE, bold: true, color: C_RED_TEXT }),
      ],
    }),
    new Paragraph({
      children: [bodyRun(`File: ${filename} | Category: ${ed.summary.category} | Confidence: ${ed.summary.confidence}`)],
    }),
    emptyLine(),
    new Paragraph({ children: [bodyRun("Annotation colour legend:", { bold: true })] }),
  ];
}

function buildSection2(ed: WhatsOnEnhancedAnalysis, analysis: Analysis): DocElement[] {
  const env = ed.environment;
  const lines: string[] = [
    `File:      ${analysis.filename}`,
    `Error:     ${analysis.error_type || "—"}`,
    env?.application?.version  ? `Version:   ${env.application.version}`  : null,
    env?.application?.build    ? `Build:     ${env.application.build}`    : null,
    env?.platform?.os          ? `OS:        ${env.platform.os}`          : null,
    env?.platform?.user        ? `User:      ${env.platform.user}`        : null,
    env?.database?.type        ? `Database:  ${env.database.type}`        : null,
    env?.database?.sessionState ? `DB State:  ${env.database.sessionState}` : null,
    `Model:     ${analysis.ai_model}`,
    `Analyzed:  ${analysis.analyzed_at}`,
  ].filter((l): l is string => l !== null);

  return [
    heading("System Information", HeadingLevel.HEADING_1),
    ...lines.map((l) => new Paragraph({ children: [monoRun(l)] })),
  ];
}

function buildSection3(ed: WhatsOnEnhancedAnalysis, analysis: Analysis): DocElement[] {
  const paras: DocElement[] = [heading("Exception / Cause of Dump", HeadingLevel.HEADING_1)];

  // Red: exception line
  paras.push(redParagraph(`EXCEPTION: ${analysis.error_type || "Unknown Exception"}`));
  if (analysis.error_message) {
    paras.push(redParagraph(analysis.error_message));
  }

  // Blue: fix annotation
  paras.push(blueParagraph(`▶ FIX: ${ed.suggestedFix.summary}`));
  if (ed.rootCause.triggerCondition) {
    paras.push(
      blueParagraph(`▶ TRIGGER: ${ed.rootCause.triggerCondition}`)
    );
  }

  return paras;
}

function frameCategory(frame: StackFrame): "red" | "gray" | "black" {
  if (frame.isErrorOrigin || frame.type === "error") return "red";
  if (frame.type === "framework" || frame.type === "library") return "gray";
  return "black";
}

function buildSection4(ed: WhatsOnEnhancedAnalysis, analysis: Analysis): DocElement[] {
  const paras: DocElement[] = [heading("Context Stack — Annotated", HeadingLevel.HEADING_1)];

  const frames = ed.stackTrace?.frames ?? [];

  if (frames.length === 0 && analysis.stack_trace) {
    // Fallback: render raw stack trace in mono
    const lines = analysis.stack_trace.split("\n").slice(0, 60);
    for (const line of lines) {
      paras.push(new Paragraph({ children: [monoRun(line)] }));
    }
    return paras;
  }

  let grayStart = -1;
  let grayEnd = -1;
  let grayBuf: string[] = [];

  const flushGray = () => {
    if (grayBuf.length > 0) {
      paras.push(grayParagraph(`[${grayStart}–${grayEnd}] ... ${grayBuf[0]} ${grayBuf.length > 1 ? `(+${grayBuf.length - 1} frames)` : ""}`));
      grayBuf = [];
      grayStart = -1;
      grayEnd = -1;
    }
  };

  for (const frame of frames) {
    const cat = frameCategory(frame);
    if (cat === "gray") {
      if (grayStart === -1) grayStart = frame.index;
      grayEnd = frame.index;
      grayBuf.push(frame.method);
    } else {
      flushGray();
      const text = `[${frame.index}] ${frame.method}${frame.context ? ` — ${frame.context}` : ""}`;
      if (cat === "red") {
        paras.push(redParagraph(text));
        // Inline blue fix after error frames
        if (frame.isErrorOrigin) {
          paras.push(blueParagraph(`▶ FIX: This is the crash origin frame. ${ed.suggestedFix.reasoning || ed.suggestedFix.summary}`));
        }
      } else {
        paras.push(new Paragraph({ children: [monoRun(text)] }));
      }
    }
  }
  flushGray();

  return paras;
}

function buildSection5(ed: WhatsOnEnhancedAnalysis): DocElement[] {
  const db = ed.databaseAnalysis;
  if (!db) return [];

  const paras: DocElement[] = [heading("Database / Query Analysis", HeadingLevel.HEADING_1)];

  if (db.warnings && db.warnings.length > 0) {
    for (const w of db.warnings) {
      paras.push(orangeParagraph(`⚠ QUERY ISSUE: ${w}`));
    }
  }

  if (db.connections && db.connections.length > 0) {
    paras.push(new Paragraph({ children: [bodyRun("Active connections:", { bold: true })] }));
    paras.push(
      simpleTable(
        ["Name", "Status", "Database"],
        db.connections.map((c) => [c.name, c.status, c.database ?? "—"])
      )
    );
    paras.push(emptyLine());
  }

  if (db.activeSessions && db.activeSessions.length > 0) {
    // Flag session overload
    if (db.activeSessions.length > 200) {
      paras.push(redParagraph(`${db.activeSessions.length} active sessions — exceeds recommended limit of 200`));
    }
  }

  if (db.transactionState) {
    paras.push(new Paragraph({ children: [bodyRun(`Transaction state: ${db.transactionState}`)] }));
  }

  return paras;
}

function buildSection8(ed: WhatsOnEnhancedAnalysis): DocElement[] {
  const mem = ed.memoryAnalysis;
  if (!mem) return [];

  const paras: DocElement[] = [heading("Memory Report", HeadingLevel.HEADING_1)];

  const rows: string[][] = [];
  if (mem.oldSpace)  rows.push(["Old Space",  mem.oldSpace.used  ?? "—", mem.oldSpace.total  ?? "—", mem.oldSpace.percentUsed  != null ? `${mem.oldSpace.percentUsed}%`  : "—"]);
  if (mem.newSpace)  rows.push(["New Space",  mem.newSpace.used  ?? "—", mem.newSpace.total  ?? "—", mem.newSpace.percentUsed  != null ? `${mem.newSpace.percentUsed}%`  : "—"]);
  if (mem.permSpace) rows.push(["Perm Space", mem.permSpace.used ?? "—", mem.permSpace.total ?? "—", mem.permSpace.percentUsed != null ? `${mem.permSpace.percentUsed}%` : "—"]);

  if (rows.length > 0) {
    paras.push(simpleTable(["Space", "Used", "Total", "% Used"], rows));
    paras.push(emptyLine());
  }

  if (mem.warnings && mem.warnings.length > 0) {
    for (const w of mem.warnings) {
      const isHigh = /7[0-9]%|8\d%|9\d%|100%/i.test(w);
      paras.push(isHigh ? redParagraph(w) : orangeParagraph(w));
    }
  }

  paras.push(
    blueParagraph(
      `▶ FIX: Memory pressure ${
        mem.oldSpace?.percentUsed && mem.oldSpace.percentUsed > 70
          ? "is a contributing factor — restart the client periodically and reduce open windows."
          : "does not appear to be a contributing factor in this crash."
      }`
    )
  );

  return paras;
}

function buildSection9(ed: WhatsOnEnhancedAnalysis, analysis: Analysis): DocElement[] {
  return [
    heading("Root Cause Summary", HeadingLevel.HEADING_1),
    simpleTable(
      ["Category", "Detail"],
      [
        ["Exception",                  analysis.error_type || "—"],
        ["Direct Cause",               ed.rootCause.technical],
        ["Contributing (User)",        ed.userScenario.description],
        ["Contributing (Database)",    ed.databaseAnalysis?.warnings?.[0] ?? "—"],
        ["Error Handling Gap",         `${ed.rootCause.affectedMethod} in ${ed.rootCause.affectedModule}`],
        ["Memory Pressure",            ed.memoryAnalysis?.warnings?.[0] ?? "Not contributing"],
      ]
    ),
  ];
}

function buildSection10(ed: WhatsOnEnhancedAnalysis): DocElement[] {
  const paras: DocElement[] = [heading("Recommended Fixes by Priority", HeadingLevel.HEADING_1)];

  const changes = ed.suggestedFix.codeChanges;
  const p0 = changes.filter((c) => c.priority === "P0");
  const p1 = changes.filter((c) => c.priority === "P1");
  const p2 = changes.filter((c) => c.priority === "P2");

  if (p0.length > 0) {
    paras.push(new Paragraph({ children: [bodyRun("IMMEDIATE (P0):", { bold: true, color: C_RED_TEXT })] }));
    for (const c of p0) {
      paras.push(blueParagraph(`▶ FIX [${c.file}]: ${c.description}`));
      if (c.before && c.after) {
        paras.push(new Paragraph({ children: [monoRun(`Before: ${c.before}`)] }));
        paras.push(new Paragraph({ children: [monoRun(`After:  ${c.after}`, C_BLUE_TEXT)] }));
      }
    }
  }

  if (p1.length > 0) {
    paras.push(new Paragraph({ children: [bodyRun("SHORT-TERM (P1):", { bold: true })] }));
    for (const c of p1) {
      paras.push(blueParagraph(`▶ FIX [${c.file}]: ${c.description}`));
    }
  }

  if (p2.length > 0) {
    paras.push(new Paragraph({ children: [bodyRun("MEDIUM-TERM (P2):", { bold: true, color: C_GRAY_TEXT })] }));
    for (const c of p2) {
      paras.push(new Paragraph({ children: [bodyRun(`• [${c.file}]: ${c.description}`)] }));
    }
  }

  return paras;
}

function buildSection11(ed: WhatsOnEnhancedAnalysis): DocElement[] {
  const paras: DocElement[] = [heading("Plain Language Fix Checklist", HeadingLevel.HEADING_1)];

  paras.push(new Paragraph({ children: [plainRun("FOR THE USER:", { bold: true })] }));
  paras.push(new Paragraph({ children: [plainRun("☐ Close screens you are not actively using")] }));
  paras.push(new Paragraph({ children: [plainRun("☐ Restart the application periodically to free accumulated resources")] }));
  if (ed.userScenario.steps.some((s) => s.isCrashPoint)) {
    const crashStep = ed.userScenario.steps.find((s) => s.isCrashPoint);
    if (crashStep) {
      paras.push(new Paragraph({ children: [plainRun(`☐ Avoid the action that triggers the crash: ${crashStep.action}`)] }));
    }
  }

  paras.push(emptyLine());
  paras.push(new Paragraph({ children: [plainRun("FOR SUPPORT / IT:", { bold: true })] }));
  paras.push(new Paragraph({ children: [plainRun(`☐ Log a ticket for Development — ${ed.suggestedFix.summary}`)] }));
  paras.push(new Paragraph({ children: [plainRun(`☐ Complexity: ${ed.suggestedFix.complexity} | Effort: ${ed.suggestedFix.estimatedEffort} | Risk: ${ed.suggestedFix.riskLevel}`)] }));

  if (ed.databaseAnalysis?.warnings && ed.databaseAnalysis.warnings.length > 0) {
    paras.push(new Paragraph({ children: [plainRun("☐ Ask the DBA to review database warnings (see Section 5)")] }));
  }

  paras.push(emptyLine());
  paras.push(new Paragraph({ children: [plainRun("FOR DEVELOPMENT:", { bold: true })] }));
  for (const c of ed.suggestedFix.codeChanges.filter((c) => c.priority === "P0")) {
    paras.push(new Paragraph({ children: [plainRun(`☐ [${c.file}] ${c.description}`)] }));
  }

  return paras;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateAnnotatedWcrDocx(
  ed: WhatsOnEnhancedAnalysis,
  analysis: Analysis
): Promise<Blob> {
  const docChildren: DocElement[] = [
    // Section 0 — Plain language summary
    ...buildSection0(ed),
    emptyLine(),

    // Section 1 — Title block + legend
    ...buildSection1(ed, analysis.filename),
    colorLegendTable(),
    emptyLine(),

    // Section 2 — System info
    ...buildSection2(ed, analysis),
    emptyLine(),

    // Section 3 — Exception
    ...buildSection3(ed, analysis),
    emptyLine(),

    // Section 4 — Context stack
    ...buildSection4(ed, analysis),
    emptyLine(),

    // Section 5 — Database / Query
    ...buildSection5(ed),
    emptyLine(),

    // Section 8 — Memory
    ...buildSection8(ed),
    emptyLine(),

    // Section 9 — Root cause summary table
    ...buildSection9(ed, analysis),
    emptyLine(),

    // Section 10 — Recommended fixes
    ...buildSection10(ed),
    emptyLine(),

    // Section 11 — Plain language checklist
    ...buildSection11(ed),

    // Footer
    emptyLine(),
    new Paragraph({
      children: [
        new TextRun({ text: "Generated by Hadron — WHATS'ON Crash Analyzer", font: "Arial", size: BODY_SIZE, color: C_GRAY_TEXT, italics: true }),
      ],
      alignment: AlignmentType.CENTER,
    }),
  ];

  const doc = new Document({
    creator: "Hadron",
    title: `Annotated WCR — ${analysis.filename}`,
    description: `WHATS'ON crash analysis: ${ed.summary.title}`,
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.PORTRAIT,
              width: 12240, // US Letter
              height: 15840,
            },
            margin: {
              top: 1100,
              right: 1100,
              bottom: 1100,
              left: 1100,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return await Packer.toBlob(doc);
}
