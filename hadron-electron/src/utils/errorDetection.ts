// Patterns that suggest text contains a stack trace or error
const ERROR_PATTERNS = [
  /^\s*at\s+[\w.$]+\(/m,                    // Java/JS stack frame
  /Traceback \(most recent call last\)/,      // Python traceback
  /^\[?\d+\]\s+\w+>>/m,                      // Smalltalk stack frame
  /Exception|Error|FATAL|panic|Unhandled/i,   // Error keywords
  /^\s*(NullPointer|ClassCast|ArrayIndexOutOfBounds|IllegalArgument)/m,
];

export function looksLikeError(text: string): boolean {
  if (text.length < 30 || text.length > 50000) return false;
  return ERROR_PATTERNS.some((p) => p.test(text));
}
