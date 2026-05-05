import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import type { DimensionStatus } from "../../hooks/useReadinessStatus";

interface StatusPopoverProps {
  dimension: DimensionStatus;
  onOpenSettings: (section: string) => void;
  onClose: () => void;
  anchorEl: HTMLElement | null;
}

export default function StatusPopover({ dimension, onOpenSettings, onClose, anchorEl }: StatusPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const needsAction = dimension.state === "warning" || dimension.state === "not-configured";

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, anchorEl]);

  useEffect(() => {
    // When there is no actionable button, focus the container so Escape works for keyboard users.
    if (!needsAction) popoverRef.current?.focus();
  }, []); // mount only — dimension.state is stable for the popover's open lifetime

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${dimension.label} status`}
      tabIndex={needsAction ? undefined : -1}
      className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 rounded-lg shadow-xl p-3"
      style={{
        background: "var(--hd-bg-raised)",
        border: "1px solid var(--hd-border)",
      }}
    >
      <p className="text-xs mb-2" style={{ color: "var(--hd-text-muted)" }}>
        {dimension.detail}
      </p>
      {needsAction && (
        <button
          autoFocus
          onClick={() => { onOpenSettings(dimension.settingsSection); onClose(); }}
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: "var(--hd-accent)" }}
        >
          <ExternalLink className="w-3 h-3" />
          Fix this →
        </button>
      )}
    </div>
  );
}
