/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 *
 * React error boundaries must be class components as they rely on
 * lifecycle methods not available in function components.
 */

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Bug, ChevronDown, ChevronUp } from "lucide-react";
import logger from "../services/logger";

// ============================================================================
// Types
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional name for this boundary (for logging) */
  name?: string;
  /** Optional custom fallback component */
  fallback?: ReactNode;
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Whether to show error details (useful for development) */
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  detailsExpanded: boolean;
}

// ============================================================================
// Error Boundary Component
// ============================================================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      detailsExpanded: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { name, onError } = this.props;

    // Log the error with context
    logger.error(`ErrorBoundary${name ? ` [${name}]` : ""} caught error`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Store error info for display
    this.setState({ errorInfo });

    // Call custom error handler if provided
    onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      detailsExpanded: false,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ detailsExpanded: !prev.detailsExpanded }));
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, detailsExpanded } = this.state;
    const { children, fallback, showDetails = true, name } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-red-500/20 rounded-full">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-red-400 mb-1">
                Something went wrong
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                {name
                  ? `An error occurred in the ${name} component.`
                  : "An unexpected error occurred while rendering this section."}
              </p>

              {/* Action buttons */}
              <div className="flex gap-3 mb-4">
                <button
                  onClick={this.handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition text-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
                <button
                  onClick={this.handleReload}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition text-sm"
                >
                  Reload App
                </button>
              </div>

              {/* Error details (collapsible) */}
              {showDetails && error && (
                <div className="border-t border-red-500/20 pt-4">
                  <button
                    onClick={this.toggleDetails}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition"
                  >
                    <Bug className="w-4 h-4" />
                    <span>Technical Details</span>
                    {detailsExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {detailsExpanded && (
                    <div className="mt-3 space-y-3">
                      {/* Error message */}
                      <div className="bg-gray-900/50 p-3 rounded font-mono text-xs">
                        <div className="text-red-400 font-semibold mb-1">
                          {error.name}: {error.message}
                        </div>
                      </div>

                      {/* Stack trace */}
                      {error.stack && (
                        <div className="bg-gray-900/50 p-3 rounded">
                          <div className="text-gray-500 text-xs mb-1">Stack Trace:</div>
                          <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-words">
                            {error.stack}
                          </pre>
                        </div>
                      )}

                      {/* Component stack */}
                      {errorInfo?.componentStack && (
                        <div className="bg-gray-900/50 p-3 rounded">
                          <div className="text-gray-500 text-xs mb-1">Component Stack:</div>
                          <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-words">
                            {errorInfo.componentStack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

// ============================================================================
// Specialized Error Boundaries
// ============================================================================

/**
 * Error boundary for the main application shell
 * Shows a full-page error with reload option
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      name="Application"
      onError={(error) => {
        // Could send to error reporting service here
        logger.error("Critical application error", { error: error.message });
      }}
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center">
            <div className="p-4 bg-red-500/20 rounded-full w-20 h-20 mx-auto mb-6 flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">
              Application Error
            </h1>
            <p className="text-gray-400 mb-6">
              The application encountered an unexpected error and cannot continue.
              Please reload to try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
            >
              <RefreshCw className="w-5 h-5" />
              Reload Application
            </button>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Error boundary for individual view sections
 * Shows a smaller inline error with retry option
 */
export function ViewErrorBoundary({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) {
  return (
    <ErrorBoundary name={name} showDetails={true}>
      {children}
    </ErrorBoundary>
  );
}

/**
 * Error boundary for non-critical components
 * Silently fails and shows minimal UI
 */
export function SilentErrorBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <ErrorBoundary
      showDetails={false}
      fallback={fallback || <div className="text-gray-500 text-sm">Unable to load</div>}
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
