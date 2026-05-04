/**
 * TagBadge Component
 * Displays a single tag with its color styling
 * Used in history list items and tag pickers
 */

import { Tag, getTagColorClasses } from '../types';

interface TagBadgeProps {
  tag: Tag;
  size?: 'sm' | 'md';
  onRemove?: () => void;
  onClick?: () => void;
}

export function TagBadge({ tag, size = 'sm', onRemove, onClick }: TagBadgeProps) {
  const colorClasses = getTagColorClasses(tag.color);

  const sizeClasses = size === 'sm'
    ? 'text-xs px-1.5 py-0.5'
    : 'text-sm px-2 py-1';

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full font-medium
        ${colorClasses.bg} ${colorClasses.text} ${colorClasses.border}
        border ${sizeClasses}
        ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
      `}
      onClick={onClick}
    >
      <span className="truncate max-w-[80px]">{tag.name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-60 ml-0.5"
          aria-label={`Remove tag ${tag.name}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

export default TagBadge;
