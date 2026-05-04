/**
 * Analysis Progress Bar Component
 *
 * Shows real-time progress during crash log analysis,
 * including phase indicators and chunk progress for deep scan.
 */

import { useEffect, useState } from 'react';
import type { AnalysisProgress, AnalysisPhase } from '../types';
import logger from '../services/logger';

interface AnalysisProgressBarProps {
  isAnalyzing: boolean;
}

const PHASE_LABELS: Record<AnalysisPhase, string> = {
  reading: 'Reading File',
  planning: 'Planning Strategy',
  extracting: 'Extracting Evidence',
  chunking: 'Splitting Content',
  analyzing: 'AI Analysis',
  synthesizing: 'Synthesizing Results',
  saving: 'Saving Results',
  complete: 'Complete',
  failed: 'Failed',
};

const PHASE_ICONS: Record<AnalysisPhase, string> = {
  reading: '📂',
  planning: '🔍',
  extracting: '🔬',
  chunking: '✂️',
  analyzing: '🤖',
  synthesizing: '🧩',
  saving: '💾',
  complete: '✅',
  failed: '❌',
};

export function AnalysisProgressBar({ isAnalyzing }: AnalysisProgressBarProps) {
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  useEffect(() => {
    if (!isAnalyzing) {
      setProgress(null);
      return;
    }

    let cancelled = false;

    // Poll-based progress (P2.2) — avoids event bus / COM boundary crossings.
    // Polls every 200ms while analysis is active.
    const poll = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        while (!cancelled) {
          const state = await invoke<AnalysisProgress | null>('get_analysis_progress');
          if (cancelled) break;
          setProgress(state);
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn('Progress poll failed', { error: String(err) });
        }
      }
    };
    poll();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzing]);

  // Don't render if not analyzing or no progress yet
  if (!isAnalyzing || !progress) {
    return null;
  }

  const { phase, progress: percent, message, current_step, total_steps } = progress;

  return (
    <div className="analysis-progress-bar">
      <div className="progress-header">
        <span className="progress-icon">{PHASE_ICONS[phase]}</span>
        <span className="progress-phase">{PHASE_LABELS[phase]}</span>
        {current_step !== undefined && total_steps !== undefined && (
          <span className="progress-steps">
            Step {current_step} of {total_steps}
          </span>
        )}
        <span className="progress-percent">{Math.round(percent)}%</span>
      </div>

      <div className="progress-track">
        <div
          className={`progress-fill ${phase === 'complete' ? 'complete' : ''} ${phase === 'failed' ? 'failed' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="progress-message">{message}</div>
    </div>
  );
}

export default AnalysisProgressBar;
