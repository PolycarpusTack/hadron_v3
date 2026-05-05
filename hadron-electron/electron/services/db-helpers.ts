export function ftsPhrase(input: unknown): string {
  if (!input || typeof input !== 'string') return '""'
  return '"' + input.replace(/"/g, '""') + '"'
}
