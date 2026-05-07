import type { ReactNode } from 'react';

interface HdToggleProps {
  checked: boolean;
  onChange: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}

export default function HdToggle({ checked, onChange, icon, disabled, 'aria-label': ariaLabel }: HdToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      className={`hd-toggle ${checked ? 'bg-blue-600' : 'bg-gray-600'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className={`hd-toggle-knob${icon ? ' hd-toggle-knob-icon' : ''} ${checked ? 'translate-x-7' : 'translate-x-1'}`}>
        {icon}
      </div>
    </button>
  );
}
