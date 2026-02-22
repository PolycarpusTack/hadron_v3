import { useEffect, useCallback } from "react";
import FocusTrap from "focus-trap-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidth = "max-w-3xl",
  className = "",
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,15,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          escapeDeactivates: false,
          fallbackFocus: '[role="dialog"]',
        }}
      >
        <div
          className={`${maxWidth} w-full ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </FocusTrap>
    </div>
  );
}

/**
 * Bottom-sheet variant for ConsoleViewer and similar panels.
 * Uses items-end instead of items-center positioning.
 */
export function BottomSheetModal({
  isOpen,
  onClose,
  children,
  className = "",
  closeOnBackdrop = true,
  closeOnEscape = true,
}: Omit<ModalProps, "maxWidth">) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          escapeDeactivates: false,
          fallbackFocus: '[role="dialog"]',
        }}
      >
        <div
          className={`w-full ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </FocusTrap>
    </div>
  );
}
