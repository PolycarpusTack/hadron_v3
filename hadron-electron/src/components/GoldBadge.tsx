import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import logger from '../services/logger';

interface GoldBadgeProps {
  analysisId: number;
  isGold: boolean;
  onPromoted?: () => void;
}

export const GoldBadge: React.FC<GoldBadgeProps> = ({
  analysisId,
  isGold,
  onPromoted
}) => {
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(isGold);

  const handlePromote = async () => {
    if (promoting || promoted) return;
    setPromoting(true);

    try {
      await invoke('promote_to_gold', { analysisId });
      setPromoted(true);
      onPromoted?.();
    } catch (error) {
      logger.error('Failed to promote to gold', { error });
    } finally {
      setPromoting(false);
    }
  };

  if (promoted) {
    return (
      <span className="gold-badge is-gold" title="Gold Standard Analysis">
        ⭐ Gold
      </span>
    );
  }

  return (
    <button
      className="gold-badge promote"
      onClick={handlePromote}
      disabled={promoting}
      title="Promote to Gold Standard"
    >
      {promoting ? '...' : '☆ Promote'}
    </button>
  );
};

export default GoldBadge;
