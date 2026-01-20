import { AlertTriangle, Shield, X, Mail, Globe, Key, FolderOpen, User } from "lucide-react";
import type { SensitiveContentResult } from "../types";

interface SensitiveContentWarningProps {
  result: SensitiveContentResult;
  onProceed: () => void;
  onEnableRedaction: () => void;
  onCancel: () => void;
}

const DETECTED_TYPE_ICONS: Record<string, JSX.Element> = {
  email: <Mail className="w-4 h-4" />,
  ip: <Globe className="w-4 h-4" />,
  token: <Key className="w-4 h-4" />,
  path: <FolderOpen className="w-4 h-4" />,
  credentials: <User className="w-4 h-4" />,
};

const DETECTED_TYPE_LABELS: Record<string, string> = {
  email: "Email Addresses",
  ip: "IP Addresses",
  token: "API Tokens/Keys",
  path: "User Directory Paths",
  credentials: "Usernames/Passwords",
};

const DETECTED_TYPE_DESCRIPTIONS: Record<string, string> = {
  email: "Email addresses can identify individuals and should not be shared with AI providers.",
  ip: "IP addresses can reveal network information and user locations.",
  token: "API keys and tokens are security credentials that must be protected.",
  path: "User directory paths can reveal usernames and system structure.",
  credentials: "Usernames and passwords are sensitive authentication data.",
};

export default function SensitiveContentWarning({
  result,
  onProceed,
  onEnableRedaction,
  onCancel,
}: SensitiveContentWarningProps) {
  if (!result.has_sensitive) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sensitive-warning-title"
    >
      <div className="bg-gray-800 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700 bg-yellow-500/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <h2 id="sensitive-warning-title" className="text-xl font-bold text-yellow-300">
                Sensitive Content Detected
              </h2>
              <p className="text-sm text-gray-400">Review before sending to AI</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            aria-label="Close warning"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-gray-300">
            The crash log you're about to analyze contains potentially sensitive information
            that will be sent to an AI provider:
          </p>

          {/* Detected Types */}
          <div className="space-y-2">
            {result.detected_types.map((type) => (
              <div
                key={type}
                className="flex items-start gap-3 p-3 bg-gray-900/50 border border-gray-700 rounded-lg"
              >
                <div className="p-2 bg-yellow-500/20 rounded-lg text-yellow-400 flex-shrink-0">
                  {DETECTED_TYPE_ICONS[type] || <AlertTriangle className="w-4 h-4" />}
                </div>
                <div>
                  <p className="font-medium text-yellow-300">
                    {DETECTED_TYPE_LABELS[type] || type}
                  </p>
                  <p className="text-sm text-gray-400">
                    {DETECTED_TYPE_DESCRIPTIONS[type] || "Potentially sensitive data detected."}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-300 mb-2">Warnings:</p>
              <ul className="space-y-1">
                {result.warnings.map((warning, index) => (
                  <li key={index} className="text-sm text-gray-400 flex items-start gap-2">
                    <span className="text-yellow-400 mt-0.5">•</span>
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendation */}
          <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-300">Recommendation</p>
              <p className="text-sm text-gray-400 mt-1">
                Enable PII redaction to automatically replace sensitive data with placeholders
                before sending to the AI provider. This protects privacy while still allowing
                effective crash analysis.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 p-6 border-t border-gray-700 bg-gray-900/30">
          <button
            onClick={onEnableRedaction}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Enable PII Redaction & Proceed
          </button>

          <div className="flex gap-3">
            <button
              onClick={onProceed}
              className="flex-1 px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 border border-yellow-600/50 rounded-lg font-medium transition"
            >
              Proceed Anyway
            </button>
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs text-gray-500 text-center mt-2">
            Your choice will apply to this analysis only. You can enable PII redaction
            permanently in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
