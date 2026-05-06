import { wrapField } from './prompt-helpers'

export type CrashPromptMode = 'quick' | 'comprehensive' | 'complete' | 'specialized'

interface CrashPromptInput {
  analysisType?: string
  analysisMode?: string
  filename: string
  crashLog: string
  wasCompacted: boolean
  originalCharCount: number
}

interface CrashPrompt {
  mode: CrashPromptMode
  systemPrompt: string
  userPrompt: string
  maxTokens: number
}

const FLAT_FIELDS = `The JSON must include these flat fields for database storage:
"error_type" — exception class or error type string
"error_message" — exact error message, or null
"severity" — "CRITICAL", "HIGH", "MEDIUM", or "LOW"
"component" — primary affected class, module, or component
"root_cause" — one-paragraph plain-English explanation
"suggested_fixes" — array of 2-4 brief fix strings
"confidence" — "HIGH", "MEDIUM", or "LOW"
"stack_trace" — raw stack trace extracted from the log, or null`

const WHATSON_SYSTEM_PROMPT = `You are an expert VisualWorks Smalltalk developer with 20+ years of experience specializing in the WHATS'ON broadcast management system (MediaGeniX/Mediagenix).

VisualWorks expertise:
- Message-passing semantics, method lookup chains, and doesNotUnderstand: handling
- Block closures, continuations, non-local returns, and exception handling
- Memory management: oldSpace, newSpace, perm space, and garbage collection
- Process scheduling, semaphores, shared queues, and UI/process interaction

WHATS'ON domain knowledge:
- PSI.*: Program Schedule Interface and core scheduling engine
- BM.*: Broadcast Management, transmission, playout, duration calculations
- PL.*: Playlist management and automation
- WOn.*: WHATS'ON application framework
- EX.*: External integrations and adapters
- Core.*: Foundation classes and utilities

Key entities and workflows:
- PSITxBlock, BMProgramSegmentDurations, BMScheduleEntry, PLPlaylistItem, PSIChannel, BMAsRunLog, WOnTransaction
- Schedule publication, playlist generation, conflict resolution, rights validation, traffic/scheduling workflows, automation integration
- Oracle database session state and transaction boundaries are common contributors.

Analysis approach:
1. Identify the exact failure point in the WHATS'ON class hierarchy.
2. Trace the business operation being performed.
3. Consider database/session state, memory pressure, object lifecycle, and process scheduling.
4. Map technical errors to user/business impact.
5. Provide actionable fixes with Smalltalk-oriented code guidance when evidence supports it.

Return ONLY valid JSON. No markdown fences, no prose outside JSON.
Use "unknown", null, or [] for unavailable evidence. Do not invent specific facts not supported by the log.`

const QUICK_SYSTEM_PROMPT = `You are an expert VisualWorks Smalltalk developer. Quickly analyze crash logs and provide focused, actionable information.

You understand VisualWorks Smalltalk runtime behavior, message passing, stack traces, common crash patterns, and the WHATS'ON broadcast scheduling domain.

Keep the response concise. Focus on cause, immediate workaround, proper fix, and why the fix addresses the root cause.
Return ONLY valid JSON. No markdown fences, no prose outside JSON.`

const COMPLETE_SYSTEM_PROMPT = `You are an expert VisualWorks Smalltalk developer with deep production incident experience.

Provide a complete crash analysis that is useful for developers, support engineers, and management.
Cover error classification, user action reconstruction, technical root cause, functional impact, remediation, reproduction, monitoring, similar patterns, and validation.
Return ONLY valid JSON. No markdown fences, no prose outside JSON.`

const SPECIALIZED_SYSTEM_PROMPT = `You are an expert VisualWorks Smalltalk developer specialized in deep crash log analysis.

Analyze the crash from multiple perspectives: pattern classification, recommendations, memory, database, performance, deep root cause, general incident summary, and basic support summary.
Return ONLY valid JSON. No markdown fences, no prose outside JSON.`

function modeForAnalysisType(analysisType?: string): CrashPromptMode {
  const normalized = (analysisType ?? 'comprehensive').toLowerCase()
  if (normalized === 'quick') return 'quick'
  if (normalized === 'complete') return 'complete'
  if (normalized === 'specialized') return 'specialized'
  return 'comprehensive'
}

function modeForInput(input: CrashPromptInput): CrashPromptMode {
  const requestedMode = (input.analysisMode ?? '').toLowerCase()
  if (requestedMode === 'quick') return 'quick'
  return modeForAnalysisType(input.analysisType)
}

function formatCompactionNote(input: CrashPromptInput): string {
  if (!input.wasCompacted) return ''
  return `\n\nNOTE: Hadron compacted this crash log from ${input.originalCharCount.toLocaleString()} characters to fit the selected model context window. The supplied log preserves the beginning, high-signal error/stack lines, and the end of the original file.`
}

function quickUserPrompt(input: CrashPromptInput): string {
  return `Analyze this crash log quickly and provide ONLY the essential information.

${wrapField('FILENAME', input.filename)}
${formatCompactionNote(input)}

Return this JSON structure:
{
  ${JSON.stringify('error_type')}: "MessageNotUnderstood or other brief classification",
  ${JSON.stringify('error_message')}: "Exact message, or null",
  ${JSON.stringify('severity')}: "CRITICAL|HIGH|MEDIUM|LOW",
  ${JSON.stringify('component')}: "Class/method/module that failed",
  ${JSON.stringify('root_cause')}: "One-paragraph plain-English explanation",
  ${JSON.stringify('suggested_fixes')}: ["Fix 1", "Fix 2"],
  ${JSON.stringify('confidence')}: "HIGH|MEDIUM|LOW",
  ${JSON.stringify('stack_trace')}: "Key stack trace, or null",
  "rootCause": {
    "title": "Brief title, max 10 words",
    "technical": "Technical explanation, 2-3 sentences",
    "plainEnglish": "Simple explanation, 1-2 sentences",
    "affectedComponent": "The class or method that failed"
  },
  "workaround": {
    "available": false,
    "steps": [],
    "limitations": "What this workaround does not fix"
  },
  "solution": {
    "summary": "One sentence describing the proper fix",
    "steps": ["Implementation step 1", "Implementation step 2"],
    "codeExample": "Optional short Smalltalk example if supported by evidence",
    "complexity": "Low|Medium|High"
  },
  "explanation": {
    "whyThisWorks": "Why the solution addresses the root cause",
    "prevention": "How to prevent this in future"
  },
  "errorType": "Brief error type classification"
}

${wrapField('CRASH_LOG', input.crashLog)}`
}

function whatsonUserPrompt(input: CrashPromptInput): string {
  return `Analyze this WHATS'ON/VisualWorks Smalltalk crash log and provide a comprehensive structured WCR analysis.

${wrapField('FILENAME', input.filename)}
${formatCompactionNote(input)}

${FLAT_FIELDS}

Return this JSON structure:
{
  "error_type": "MessageNotUnderstood",
  "error_message": "Receiver does not understand selector",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "component": "ClassName or WHATS'ON module",
  "root_cause": "Plain-English summary copied from rootCause.plainEnglish",
  "suggested_fixes": ["P0/P1/P2 fix summaries"],
  "confidence": "HIGH|MEDIUM|LOW",
  "stack_trace": "Raw/key stack trace, or null",
  "summary": {
    "title": "Brief descriptive title, max 50 chars",
    "severity": "critical|high|medium|low",
    "category": "scheduling|playout|database|memory|integration|ui|rights|timing|other",
    "confidence": "high|medium|low",
    "affectedWorkflow": "Business workflow affected"
  },
  "rootCause": {
    "technical": "Detailed technical explanation with class/method names and exact failure mode",
    "plainEnglish": "Non-technical explanation suitable for support/business users",
    "affectedMethod": "ClassName>>methodName where the error originated",
    "affectedModule": "WHATS'ON namespace/module, e.g. PSI.ScheduleEngine",
    "triggerCondition": "Specific condition that triggered this crash"
  },
  "userScenario": {
    "description": "What the user was trying to accomplish",
    "workflow": "Workflow being executed",
    "steps": [
      { "step": 1, "action": "User action", "details": "Context", "isCrashPoint": false },
      { "step": 2, "action": "Action where crash occurred", "details": "Failure point", "isCrashPoint": true }
    ],
    "expectedResult": "What should have happened",
    "actualResult": "What happened instead",
    "reproductionLikelihood": "always|often|sometimes|rarely|unknown"
  },
  "suggestedFix": {
    "summary": "One-line recommended fix",
    "reasoning": "Why this fix addresses the root cause",
    "explanation": "Detailed fix approach",
    "codeChanges": [
      {
        "file": "ClassName or method location",
        "description": "What needs to change",
        "before": "Problematic code/state if identifiable",
        "after": "Suggested Smalltalk fix if evidence supports it",
        "priority": "P0|P1|P2"
      }
    ],
    "complexity": "simple|moderate|complex",
    "estimatedEffort": "hours|days|weeks",
    "riskLevel": "low|medium|high"
  },
  "systemWarnings": [
    {
      "source": "memory|database|process|network|configuration|other",
      "severity": "critical|warning|info",
      "title": "Short warning title",
      "description": "Detailed warning description",
      "recommendation": "What to do",
      "contributedToCrash": false
    }
  ],
  "impactAnalysis": {
    "dataAtRisk": "none|low|moderate|high|critical",
    "dataRiskDescription": "What data may have been affected",
    "directlyAffected": [
      { "feature": "Feature name", "module": "Module", "description": "Impact", "severity": "critical|high|medium|low" }
    ],
    "potentiallyAffected": []
  },
  "testScenarios": [
    {
      "id": "TC001",
      "name": "Test scenario",
      "priority": "P0|P1|P2",
      "type": "regression|smoke|integration|unit",
      "description": "What this validates",
      "steps": "Step-by-step procedure",
      "expectedResult": "Expected outcome",
      "dataRequirements": "Test data needed"
    }
  ],
  "environment": {
    "application": { "version": null, "build": null, "configuration": "Relevant config details" },
    "platform": { "os": null, "memory": null, "user": null },
    "database": { "type": "Oracle|other|unknown", "connectionInfo": null, "sessionState": null }
  },
  "context": {
    "receiver": { "class": "Receiver class", "state": "Known state", "description": "Object meaning" },
    "arguments": [],
    "relatedObjects": []
  },
  "memoryAnalysis": {
    "oldSpace": { "used": null, "total": null, "percentUsed": 0 },
    "newSpace": { "used": null, "total": null, "percentUsed": 0 },
    "permSpace": { "used": null, "total": null, "percentUsed": 0 },
    "warnings": []
  },
  "databaseAnalysis": {
    "connections": [],
    "activeSessions": [],
    "warnings": [],
    "transactionState": "open|committed|rolled_back|unknown"
  },
  "stackTrace": {
    "frames": [
      {
        "index": 0,
        "method": "ClassName>>methodName",
        "type": "error|application|framework|library",
        "isErrorOrigin": true,
        "context": "Frame context"
      }
    ],
    "totalFrames": 0,
    "errorFrame": "ClassName>>methodName"
  }
}

Guidelines:
1. Extract as much information as possible from the log.
2. Be specific about WHATS'ON classes, namespaces, and business workflow.
3. Consider Oracle database specifics common in WHATS'ON deployments.
4. Provide code examples only when supported by evidence.
5. Map technical issues to business impact.

${wrapField('CRASH_LOG', input.crashLog)}`
}

function completeUserPrompt(input: CrashPromptInput): string {
  return `Analyze this VisualWorks Smalltalk crash log with a complete 10-part incident-analysis approach.

${wrapField('FILENAME', input.filename)}
${formatCompactionNote(input)}

${FLAT_FIELDS}

Return JSON with flat fields plus:
{
  "completeAnalysis": {
    "errorClassification": "Error type, severity, component",
    "userActionReconstruction": "What the user was trying to do",
    "technicalRootCause": "Detailed causal chain",
    "functionalRootCause": "Business/user explanation",
    "developerRemediation": ["P0/P1/P2 fixes with code examples where supported"],
    "userRemediation": ["Workarounds and support guidance"],
    "reproductionSteps": ["How to reproduce"],
    "monitoringDetection": ["Metrics, alerts, log patterns"],
    "similarIssues": ["Pattern signature and related issues"],
    "validationStrategy": ["How to verify the fix"]
  }
}

${wrapField('CRASH_LOG', input.crashLog)}`
}

function specializedUserPrompt(input: CrashPromptInput): string {
  return `Analyze this VisualWorks Smalltalk crash log using a specialized multi-perspective analysis suite.

${wrapField('FILENAME', input.filename)}
${formatCompactionNote(input)}

${FLAT_FIELDS}

Return JSON with flat fields plus:
{
  "specializedAnalyses": {
    "patternAnalysis": "Pattern classification, clustering, recurrence indicators",
    "recommendationsAnalysis": ["P0/P1/P2 recommendations"],
    "memoryAnalysis": "Memory evidence or why none applies",
    "databaseAnalysis": "Database/session evidence or why none applies",
    "performanceAnalysis": "Performance evidence or why none applies",
    "deepRootCauseAnalysis": "Failure point, causal chain, confidence",
    "generalAnalysis": "Incident summary and impact",
    "basicAnalysis": "Short support-friendly summary"
  }
}

${wrapField('CRASH_LOG', input.crashLog)}`
}

export function buildCrashAnalysisPrompt(input: CrashPromptInput): CrashPrompt {
  const mode = modeForInput(input)
  if (mode === 'quick') {
    return {
      mode,
      systemPrompt: QUICK_SYSTEM_PROMPT,
      userPrompt: quickUserPrompt(input),
      maxTokens: 4096,
    }
  }
  if (mode === 'complete') {
    return {
      mode,
      systemPrompt: COMPLETE_SYSTEM_PROMPT,
      userPrompt: completeUserPrompt(input),
      maxTokens: 8192,
    }
  }
  if (mode === 'specialized') {
    return {
      mode,
      systemPrompt: SPECIALIZED_SYSTEM_PROMPT,
      userPrompt: specializedUserPrompt(input),
      maxTokens: 8192,
    }
  }
  return {
    mode,
    systemPrompt: WHATSON_SYSTEM_PROMPT,
    userPrompt: whatsonUserPrompt(input),
    maxTokens: 8192,
  }
}
