import { describe, it, expect } from 'vitest'

interface AnalysisProgress {
  phase: string; progress: number; message: string; current_step?: number; total_steps?: number
}

describe('analysis progress state', () => {
  it('transitions through expected phases', () => {
    const phases: AnalysisProgress[] = []
    const setProgress = (p: AnalysisProgress) => phases.push({ ...p })

    setProgress({ phase: 'reading', progress: 10, message: 'Reading file…' })
    setProgress({ phase: 'analyzing', progress: 40, message: 'Analyzing with AI…' })
    setProgress({ phase: 'saving', progress: 90, message: 'Saving result…' })
    setProgress({ phase: 'complete', progress: 100, message: 'Done' })

    expect(phases[0].phase).toBe('reading')
    expect(phases[3].progress).toBe(100)
    expect(phases.map(p => p.phase)).toEqual(['reading', 'analyzing', 'saving', 'complete'])
  })
})
