/**
 * Toast Notification System
 *
 * Provides non-intrusive feedback notifications that auto-dismiss.
 * Supports success, error, warning, and info variants.
 */

import { useState, useCallback, useEffect, createContext, useContext, ReactNode } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

// ============================================================================
// Context
// ============================================================================

const ToastContext = createContext<ToastContextValue | null>(null);

// ============================================================================
// Toast Provider
// ============================================================================

interface ToastProviderProps {
  children: ReactNode;
  /** Maximum number of toasts to show at once */
  maxToasts?: number;
  /** Default duration in milliseconds */
  defaultDuration?: number;
}

export function ToastProvider({
  children,
  maxToasts = 5,
  defaultDuration = 4000,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, duration?: number) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const toast: Toast = {
        id,
        type,
        message,
        duration: duration ?? defaultDuration,
      };

      setToasts((prev) => {
        // Remove oldest if at max capacity
        const newToasts = prev.length >= maxToasts ? prev.slice(1) : prev;
        return [...newToasts, toast];
      });
    },
    [defaultDuration, maxToasts]
  );

  // Convenience methods
  const success = useCallback(
    (message: string, duration?: number) => addToast("success", message, duration),
    [addToast]
  );
  const error = useCallback(
    (message: string, duration?: number) => addToast("error", message, duration ?? 6000),
    [addToast]
  );
  const warning = useCallback(
    (message: string, duration?: number) => addToast("warning", message, duration ?? 5000),
    [addToast]
  );
  const info = useCallback(
    (message: string, duration?: number) => addToast("info", message, duration),
    [addToast]
  );

  const value: ToastContextValue = {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// ============================================================================
// Toast Container
// ============================================================================

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

// ============================================================================
// Toast Item
// ============================================================================

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  // Auto-dismiss after duration
  useEffect(() => {
    if (!toast.duration) return;

    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, toast.duration - 300); // Start exit animation before removal

    const removeTimer = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onRemove]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  // Style variants
  const variants = {
    success: {
      bg: "bg-green-900/90 border-green-500/30",
      icon: <CheckCircle className="w-5 h-5 text-green-400" />,
      text: "text-green-100",
    },
    error: {
      bg: "bg-red-900/90 border-red-500/30",
      icon: <AlertCircle className="w-5 h-5 text-red-400" />,
      text: "text-red-100",
    },
    warning: {
      bg: "bg-yellow-900/90 border-yellow-500/30",
      icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
      text: "text-yellow-100",
    },
    info: {
      bg: "bg-blue-900/90 border-blue-500/30",
      icon: <Info className="w-5 h-5 text-blue-400" />,
      text: "text-blue-100",
    },
  };

  const variant = variants[toast.type];

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border backdrop-blur-sm shadow-lg
        ${variant.bg}
        ${isExiting ? "animate-slide-out-right" : "animate-slide-in-right"}
      `}
      role="alert"
    >
      <div className="flex-shrink-0">{variant.icon}</div>
      <p className={`flex-1 text-sm ${variant.text}`}>{toast.message}</p>
      <button
        onClick={handleClose}
        className="flex-shrink-0 text-gray-400 hover:text-white transition"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access the toast notification system
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}

// ============================================================================
// CSS Animations (add to styles.css)
// ============================================================================

/*
Add these animations to your styles.css:

@keyframes slide-in-right {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slide-out-right {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}

.animate-slide-in-right {
  animation: slide-in-right 0.3s ease-out forwards;
}

.animate-slide-out-right {
  animation: slide-out-right 0.3s ease-in forwards;
}
*/

export default ToastProvider;
