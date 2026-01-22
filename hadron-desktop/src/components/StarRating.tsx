import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface StarRatingProps {
  analysisId: number;
  initialRating?: number;
  onRatingChange?: (rating: number) => void;
  size?: 'small' | 'medium' | 'large';
}

export const StarRating: React.FC<StarRatingProps> = ({
  analysisId,
  initialRating = 0,
  onRatingChange,
  size = 'medium'
}) => {
  const [rating, setRating] = useState(initialRating);
  const [hover, setHover] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(initialRating > 0);
  const [error, setError] = useState<string | null>(null);

  const handleRating = async (value: number) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      await invoke('submit_analysis_feedback', {
        feedback: {
          analysisId,
          feedbackType: 'rating',
          rating: value,
        }
      });
      setRating(value);
      setSubmitted(true);
      onRatingChange?.(value);
    } catch (err) {
      console.error('Failed to submit rating:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit rating');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`star-rating star-rating-${size}`} role="group" aria-label="Rate this analysis">
      <span className="rating-label" id="rating-label">
        {submitted ? 'Thanks for your feedback!' : 'Was this helpful?'}
      </span>
      {error && (
        <span className="rating-error" role="alert">{error}</span>
      )}
      <div className="stars" role="radiogroup" aria-labelledby="rating-label">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            className={`star ${star <= (hover || rating) ? 'filled' : ''}`}
            onClick={() => handleRating(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            disabled={isSubmitting}
            title={`${star} star${star > 1 ? 's' : ''}`}
            aria-label={`Rate ${star} out of 5 stars`}
            aria-pressed={star <= rating}
            role="radio"
            aria-checked={star === rating}
          >
            ★
          </button>
        ))}
      </div>
      {rating > 0 && (
        <span className="rating-value" aria-live="polite">{rating}/5</span>
      )}
    </div>
  );
};

export default StarRating;
