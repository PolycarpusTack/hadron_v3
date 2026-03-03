/**
 * Code Analysis Service
 *
 * Extracts the AI prompt template and response parsing for code review
 * from App.tsx into a dedicated, testable module.
 */

import { translateTechnicalContent, getStoredModel, getStoredProvider, saveExternalAnalysis } from "./api";
import { getApiKey } from "./secure-storage";
import { getKeeperSecretForProvider } from "./keeper";
import logger from "./logger";
import type { CodeAnalysisResult, CodeIssue, CodeQualityScores } from "../types";

// ============================================================================
// Prompt Template
// ============================================================================

export function buildCodeAnalysisPrompt(code: string, filename: string, language: string): string {
  return `You are an expert code reviewer. Analyze this ${language} code and return a comprehensive JSON response.

FILENAME: ${filename}
LANGUAGE: ${language}

CODE:
${code}

Return a JSON object with this EXACT structure:
{
  "summary": "2-3 sentence description of what this code does and its purpose",
  "issues": [
    {
      "id": 1,
      "severity": "critical|high|medium|low",
      "category": "security|performance|error|best-practice",
      "line": <line number>,
      "title": "Short issue title",
      "description": "What's wrong and why it matters",
      "technical": "Technical details and evidence from the code",
      "fix": "Suggested fix with code example",
      "complexity": "Low|Medium|High",
      "impact": "Real-world impact if not fixed"
    }
  ],
  "walkthrough": [
    {
      "lines": "1-10",
      "title": "Section name (e.g., 'Imports', 'Main Function', 'Error Handling')",
      "code": "the actual code snippet for these lines",
      "whatItDoes": "Clear explanation of what this code does",
      "whyItMatters": "Why this section is important",
      "evidence": "Specific code tokens/patterns that support the explanation",
      "dependencies": [{"name": "dependency name", "type": "import|variable|function|table", "note": "brief note"}],
      "impact": "What happens if this code is changed or removed",
      "testability": "How to test this section",
      "eli5": "Simple analogy a beginner would understand",
      "quality": "Code quality observations for this section"
    }
  ],
  "optimizedCode": "Improved version of the full code with issues fixed, or null if no improvements needed",
  "qualityScores": {
    "overall": <0-100>,
    "security": <0-100>,
    "performance": <0-100>,
    "maintainability": <0-100>,
    "bestPractices": <0-100>
  },
  "glossary": [
    {"term": "Technical term used", "definition": "Clear definition"}
  ]
}

IMPORTANT INSTRUCTIONS:
1. Find ALL issues - security vulnerabilities, performance problems, bugs, and best practice violations
2. Create walkthrough sections for logical code blocks (imports, functions, classes, etc.)
3. Be specific with line numbers and code references
4. Provide actionable fixes with actual code
5. Return ONLY valid JSON, no markdown or additional text`;
}

// ============================================================================
// Response Parsing
// ============================================================================

const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_CATEGORIES = new Set(["security", "performance", "error", "best-practice"]);

const DEFAULT_SCORES: CodeQualityScores = {
  overall: 50,
  security: 50,
  performance: 50,
  maintainability: 50,
  bestPractices: 50,
};

function clampScores(raw: unknown): CodeQualityScores {
  const defaults = { overall: 50, security: 50, performance: 50, maintainability: 50, bestPractices: 50 };
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  const clamp = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 50));
  return {
    overall:         clamp(r.overall),
    security:        clamp(r.security),
    performance:     clamp(r.performance),
    maintainability: clamp(r.maintainability),
    bestPractices:   clamp(r.bestPractices),
  };
}

export function parseCodeAnalysisResponse(response: string): CodeAnalysisResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    summary: parsed.summary || "Analysis complete.",
    issues: (parsed.issues || []).map((issue: Record<string, unknown>, idx: number): CodeIssue => {
      const rawSeverity = String(issue.severity || "medium").toLowerCase();
      const rawCategory = String(issue.category || "best-practice").toLowerCase();
      return {
        id: Number(issue.id) || idx + 1,
        severity: (VALID_SEVERITIES.has(rawSeverity) ? rawSeverity : "medium") as CodeIssue["severity"],
        category: (VALID_CATEGORIES.has(rawCategory) ? rawCategory : "best-practice") as CodeIssue["category"],
        line: Number(issue.line) || 1,
        title: String(issue.title || ""),
        description: String(issue.description || ""),
        technical: String(issue.technical || ""),
        fix: String(issue.fix || ""),
        complexity: String(issue.complexity || ""),
        impact: String(issue.impact || "Review recommended"),
      };
    }),
    walkthrough: (parsed.walkthrough || []).map((section: Record<string, unknown>) => ({
      lines: String(section.lines || ""),
      title: String(section.title || ""),
      code: String(section.code || ""),
      whatItDoes: String(section.whatItDoes || ""),
      whyItMatters: String(section.whyItMatters || ""),
      evidence: String(section.evidence || ""),
      dependencies: Array.isArray(section.dependencies) ? section.dependencies : [],
      impact: String(section.impact || ""),
      testability: String(section.testability || ""),
      eli5: String(section.eli5 || ""),
      quality: String(section.quality || ""),
    })),
    optimizedCode: parsed.optimizedCode || null,
    qualityScores: clampScores(parsed.qualityScores),
    glossary: parsed.glossary || [],
  };
}

// ============================================================================
// Orchestrator
// ============================================================================

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export async function analyzeCode(
  code: string,
  filename: string,
  language: string,
): Promise<CodeAnalysisResult> {
  const model = getStoredModel();
  const provider = getStoredProvider();

  // Resolve API key (Keeper or manual)
  const keeperSecretUid = await getKeeperSecretForProvider(provider);
  let apiKey = "";
  if (!keeperSecretUid) {
    apiKey = (await getApiKey(provider)) || "";
    if (!apiKey && provider !== "llamacpp") {
      throw new Error("Please set your API key in Settings");
    }
  }

  logger.info("Starting code analysis", { filename, language, model, provider });

  const prompt = buildCodeAnalysisPrompt(code, filename, language);
  const response = await translateTechnicalContent(prompt, apiKey, model, provider);

  let result: CodeAnalysisResult;
  try {
    result = parseCodeAnalysisResponse(response);
  } catch (parseError) {
    logger.error("Failed to parse code analysis response", { error: parseError });
    const msg = parseError instanceof Error ? parseError.message : "Unknown parsing error";
    throw new Error(`Failed to parse AI response: ${msg}. The AI may have returned malformed JSON. Please try again.`);
  }

  // Persist to history (fire-and-forget)
  const topSeverity = result.issues
    .map((i) => (i.severity || "medium").toLowerCase())
    .reduce((cur, next) => ((SEVERITY_RANK[next] || 0) > (SEVERITY_RANK[cur] || 0) ? next : cur), "medium");

  saveExternalAnalysis({
    filename,
    file_size_kb: code.length / 1024,
    summary: result.summary,
    severity: topSeverity,
    analysis_type: "code",
    suggested_fixes: result.issues
      .map((i) => [i.title, i.fix].filter(Boolean).join(": "))
      .filter((f) => f.trim().length > 0),
    ai_model: model,
    ai_provider: provider,
    full_data: { ...result, language },
    component: language,
    error_type: "CodeReview",
  }).catch((e) => {
    logger.warn("Failed to save code analysis to history", {
      filename,
      error: e instanceof Error ? e.message : String(e),
    });
  });

  return result;
}
