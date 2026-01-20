/**
 * Crash Signature Service
 *
 * Handles crash signature operations for deduplication and tracking
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  CrashSignature,
  SignatureRegistrationResult,
  SignatureOccurrences,
} from "../types";

/**
 * Compute a crash signature without persisting
 */
export async function computeSignature(
  errorType: string,
  stackTrace: string | undefined,
  rootCause: string
): Promise<CrashSignature> {
  return await invoke<CrashSignature>("compute_crash_signature", {
    errorType,
    stackTrace: stackTrace || null,
    rootCause,
  });
}

/**
 * Register a crash signature for an analysis
 * Creates the signature if new, or increments occurrence count
 */
export async function registerSignature(
  analysisId: number,
  errorType: string,
  stackTrace: string | undefined,
  rootCause: string
): Promise<SignatureRegistrationResult> {
  return await invoke<SignatureRegistrationResult>("register_crash_signature", {
    analysisId,
    errorType,
    stackTrace: stackTrace || null,
    rootCause,
  });
}

/**
 * Get all occurrences of a crash signature
 */
export async function getSignatureOccurrences(
  hash: string
): Promise<SignatureOccurrences> {
  return await invoke<SignatureOccurrences>("get_signature_occurrences", {
    hash,
  });
}

/**
 * Get top crash signatures by occurrence count
 */
export async function getTopSignatures(
  limit?: number,
  status?: string
): Promise<CrashSignature[]> {
  return await invoke<CrashSignature[]>("get_top_signatures", {
    limit: limit ?? null,
    status: status ?? null,
  });
}

/**
 * Update signature status
 */
export async function updateSignatureStatus(
  hash: string,
  status: string,
  metadata?: string
): Promise<void> {
  await invoke("update_signature_status", {
    hash,
    status,
    metadata: metadata ?? null,
  });
}

/**
 * Link a JIRA ticket to a signature
 */
export async function linkTicketToSignature(
  hash: string,
  ticketId: string,
  ticketUrl?: string
): Promise<void> {
  await invoke("link_ticket_to_signature", {
    hash,
    ticketId,
    ticketUrl: ticketUrl ?? null,
  });
}

// Status display helpers
export const statusDisplayMap: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-gray-500" },
  investigating: { label: "Investigating", color: "bg-blue-500" },
  fix_in_progress: { label: "Fix in Progress", color: "bg-yellow-500" },
  fixed: { label: "Fixed", color: "bg-green-500" },
  wont_fix: { label: "Won't Fix", color: "bg-gray-400" },
  duplicate: { label: "Duplicate", color: "bg-purple-500" },
};

export function getStatusDisplay(status: string): { label: string; color: string } {
  return statusDisplayMap[status] || { label: status, color: "bg-gray-500" };
}
