import { LANGUAGE_EXTENSIONS } from "./constants";

export function detectLanguage(code: string, filename: string): string {
  // Check file extension first
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && LANGUAGE_EXTENSIONS[ext]) {
    return LANGUAGE_EXTENSIONS[ext];
  }

  // Pattern-based detection
  if (/SELECT\s+.+\s+FROM\s+/i.test(code)) return "SQL";
  if (/import\s+React|from\s+['"]react['"]/i.test(code)) return "React";
  if (/def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/i.test(code)) return "Python";
  if (/\|\s*\w+\s*\||\w+\s*>>\s*\w+|ifTrue:|ifFalse:/i.test(code)) return "Smalltalk";
  if (/fn\s+\w+|let\s+mut|impl\s+/i.test(code)) return "Rust";
  if (/func\s+\w+|package\s+main/i.test(code)) return "Go";
  if (/<\w+[^>]*>|<\/\w+>/i.test(code)) return "XML";

  return "Plaintext";
}
