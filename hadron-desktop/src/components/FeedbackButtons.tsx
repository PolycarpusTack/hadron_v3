import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import logger from '../services/logger';

interface FeedbackButtonsProps {
  analysisId: number;
  fieldName: string;
  currentValue: string;
  onFeedbackSubmitted?: () => void;
}

export const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({
  analysisId,
  fieldName,
  currentValue,
  onFeedbackSubmitted
}) => {
  const [status, setStatus] = useState<'idle' | 'accepted' | 'rejected'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitFeedback = async (type: 'accept' | 'reject') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await invoke('submit_analysis_feedback', {
        feedback: {
          analysisId,
          feedbackType: type,
          fieldName,
          originalValue: currentValue,
        }
      });
      setStatus(type === 'accept' ? 'accepted' : 'rejected');
      onFeedbackSubmitted?.();
    } catch (err) {
      logger.error('Failed to submit feedback', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status !== 'idle') {
    return (
      <span className={`feedback-status ${status}`} role="status" aria-live="polite">
        {status === 'accepted' ? '✓ Marked correct' : '✗ Marked incorrect'}
      </span>
    );
  }

  return (
    <div className="feedback-buttons" role="group" aria-label="Feedback buttons">
      {error && (
        <span className="feedback-error" role="alert">{error}</span>
      )}
      <button
        className="feedback-btn accept"
        onClick={() => submitFeedback('accept')}
        disabled={isSubmitting}
        title="This is correct"
        aria-label="Mark this analysis as correct"
      >
        👍
      </button>
      <button
        className="feedback-btn reject"
        onClick={() => submitFeedback('reject')}
        disabled={isSubmitting}
        title="This is incorrect"
        aria-label="Mark this analysis as incorrect"
      >
        👎
      </button>
    </div>
  );
};

export default FeedbackButtons;
