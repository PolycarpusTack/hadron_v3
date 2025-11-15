import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  badge?: ReactNode;
}

export default function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
  className = "",
  badge,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-lg overflow-hidden ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon && <div className="text-blue-400">{icon}</div>}
          <h3 className="text-lg font-semibold">{title}</h3>
          {badge && <div>{badge}</div>}
        </div>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-gray-700/50">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}
