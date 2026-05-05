import { describe, it, expect } from 'vitest'

describe('KB doc indexing', () => {
  it('chunks text into ≤2000 char segments', () => {
    const chunkText = (text: string, maxChars: number): string[] => {
      const chunks: string[] = []
      const paragraphs = text.split(/\n{2,}/)
      let current = ''
      for (const para of paragraphs) {
        if ((current + '\n\n' + para).length > maxChars && current) {
          chunks.push(current.trim())
          current = para
        } else {
          current = current ? current + '\n\n' + para : para
        }
      }
      if (current.trim()) chunks.push(current.trim())
      return chunks
    }

    const longText = 'paragraph\n\n'.repeat(300)
    const chunks = chunkText(longText, 2000)
    expect(chunks.every(c => c.length <= 2000)).toBe(true)
    expect(chunks.length).toBeGreaterThan(1)
  })
})
