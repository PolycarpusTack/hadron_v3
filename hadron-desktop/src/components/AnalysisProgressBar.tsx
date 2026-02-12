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

    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    // Setup event listener
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        unlistenFn = await listen<AnalysisProgress>('analysis-progress', (event) => {
          if (!cancelled) {
            setProgress(event.payload);
          }
        });
        // If cancelled during the await, clean up immediately
        if (cancelled && unlistenFn) {
          unlistenFn();
          unlistenFn = null;
        }
      } catch (err) {
        logger.warn('Failed to setup progress listener', { error: String(err) });
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
      }
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
