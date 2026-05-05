// Characters that look like our delimiters must be substituted before wrapping
// to prevent a crafted field value from escaping the data block.
const LT3 = '‹‹‹' // ‹‹‹  (single angle quotation marks)
const GT3 = '›››' // ›››

export function sanitiseForPrompt(value: unknown): string {
  if (!value || typeof value !== 'string') return ''
  return value.replace(/<<</g, LT3).replace(/>>>/g, GT3)
}

export function wrapField(fieldName: string, value: unknown): string {
  const sanitised = sanitiseForPrompt(value)
  return `<<<FIELD:${fieldName}>>>\n${sanitised}\n<<<END:${fieldName}>>>`
}
