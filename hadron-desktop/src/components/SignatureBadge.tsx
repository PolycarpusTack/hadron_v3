import { useState } from "react";
import { Hash, Repeat, Ticket, ExternalLink } from "lucide-react";
import type { CrashSignature } from "../types";
import { getStatusDisplay } from "../services/signature";

interface SignatureBadgeProps {
  signature: CrashSignature;
  showOccurrences?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

/**
 * Displays a crash signature badge with status, occurrence count, and ticket link
 */
export default function SignatureBadge({
  signature,
  showOccurrences = true,
  compact = false,
  onClick,
}: SignatureBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const statusInfo = getStatusDisplay(signature.status);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono
          bg-gray-700 border border-gray-600 hover:border-gray-500 transition
          ${onClick ? "cursor-pointer" : ""}`}
        onClick={onClick}
        title={signature.canonical}
      >
        <Hash className="w-3 h-3 text-gray-400" />
        <span className="text-gray-200">{signature.hash}</span>
        {showOccurrences && signature.occurrenceCount > 1 && (
          <span className="text-gray-400">×{signature.occurrenceCount}</span>
        )}
      </span>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border
        bg-gray-800 border-gray-700 transition
        ${onClick ? "cursor-pointer hover:border-gray-500 hover:bg-gray-750" : ""}
        ${isHovered ? "shadow-md" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hash badge */}
      <code className="flex items-center gap-1 text-xs font-mono bg-gray-900 px-2 py-1 rounded">
        <Hash className="w-3 h-3 text-gray-500" />
        <span className="text-emerald-400">{signature.hash}</span>
      </code>

      {/* Status indicator */}
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color} text-white`}
      >
        {statusInfo.label}
      </span>

      {/* Occurrence count */}
      {showOccurrences && signature.occurrenceCount > 1 && (
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Repeat className="w-3 h-3" />
          {signature.occurrenceCount}×
        </span>
      )}

      {/* Linked ticket */}
      {signature.linkedTicket && (
        <a
          href={signature.linkedTicketUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <Ticket className="w-3 h-3" />
          {signature.linkedTicket}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </div>
  );
}

interface SignatureTooltipProps {
  signature: CrashSignature;
}

/**
 * Full signature details for tooltip or expanded view
 */
export function SignatureTooltip({ signature }: SignatureTooltipProps) {
  const statusInfo = getStatusDisplay(signature.status);

  return (
    <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 max-w-md">
      <div className="flex items-center gap-2 mb-3">
        <code className="text-sm font-mono text-emerald-400">{signature.hash}</code>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color} text-white`}
        >
          {statusInfo.label}
        </span>
      </div>

      <p className="text-sm text-gray-300 font-mono mb-3 break-all">
        {signature.canonical}
      </p>

      <dl className="text-xs space-y-1">
        <div className="flex">
          <dt className="text-gray-500 w-24">Exception:</dt>
          <dd className="text-gray-300 font-mono">{signature.components.exceptionType}</dd>
        </div>
        {signature.components.affectedModule && (
          <div className="flex">
            <dt className="text-gray-500 w-24">Module:</dt>
            <dd className="text-gray-300">{signature.components.affectedModule}</dd>
          </div>
        )}
        {signature.components.databaseBackend && (
          <div className="flex">
            <dt className="text-gray-500 w-24">Database:</dt>
            <dd className="text-gray-300">{signature.components.databaseBackend}</dd>
          </div>
        )}
        <div className="flex">
          <dt className="text-gray-500 w-24">Occurrences:</dt>
          <dd className="text-gray-300">{signature.occurrenceCount}</dd>
        </div>
        <div className="flex">
          <dt className="text-gray-500 w-24">First seen:</dt>
          <dd className="text-gray-300">
            {new Date(signature.firstSeen).toLocaleDateString()}
          </dd>
        </div>
        <div className="flex">
          <dt className="text-gray-500 w-24">Last seen:</dt>
          <dd className="text-gray-300">
            {new Date(signature.lastSeen).toLocaleDateString()}
          </dd>
        </div>
      </dl>

      {signature.components.applicationFrames.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <p className="text-xs text-gray-500 mb-1">Stack Frames:</p>
          <ul className="text-xs text-gray-400 font-mono space-y-0.5">
            {signature.components.applicationFrames.map((frame, i) => (
              <li key={i}>→ {frame}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
