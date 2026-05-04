export const MAX_FILE_SIZE_BYTES = 200_000; // ~200 KB — warn before hitting Rust's 1 MB hard cap
export const SOFT_TOKEN_WARN_BYTES = 50_000; // ~12K tokens; warn before hitting model context limits

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  sql: "SQL",
  tsx: "React",
  jsx: "React",
  ts: "TypeScript",
  js: "JavaScript",
  st: "Smalltalk",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  rb: "Ruby",
};

export function warnIfLargeFile(file: File): boolean {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return window.confirm(
      `"${file.name}" is ${(file.size / 1024).toFixed(0)} KB. ` +
      `Large files may exceed AI context limits and produce incomplete results. ` +
      `Continue anyway?`
    );
  }
  return true;
}
