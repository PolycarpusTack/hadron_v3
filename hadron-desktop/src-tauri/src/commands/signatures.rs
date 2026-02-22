//! Crash signature commands

use crate::signature;
use super::common::DbState;
use std::sync::Arc;

/// Compute a crash signature from analysis data (does not persist)
#[tauri::command]
pub fn compute_crash_signature(
    error_type: String,
    stack_trace: Option<String>,
    root_cause: String,
) -> Result<signature::CrashSignature, String> {
    log::debug!("cmd: compute_crash_signature");
    log::debug!("Computing crash signature for: {}", error_type);
    let config = signature::SignatureConfig::default();
    Ok(signature::compute_signature(
        &error_type,
        stack_trace.as_deref(),
        &root_cause,
        &config,
    ))
}

/// Register a crash signature for an analysis (compute, persist, and link)
#[tauri::command]
pub async fn register_crash_signature(
    analysis_id: i64,
    error_type: String,
    stack_trace: Option<String>,
    root_cause: String,
    db: DbState<'_>,
) -> Result<signature::SignatureRegistrationResult, String> {
    log::debug!("cmd: register_crash_signature");
    log::info!("Registering crash signature for analysis {}", analysis_id);

    let config = signature::SignatureConfig::default();
    let sig =
        signature::compute_signature(&error_type, stack_trace.as_deref(), &root_cause, &config);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        // Upsert signature
        let is_new = db_clone
            .upsert_signature(&sig)
            .map_err(|e| format!("Failed to upsert signature: {}", e))?;

        // Link analysis to signature
        db_clone
            .link_analysis_to_signature(analysis_id, &sig.hash)
            .map_err(|e| format!("Failed to link analysis to signature: {}", e))?;

        // Get updated signature with occurrence count
        let updated_sig = db_clone
            .find_signature_by_hash(&sig.hash)
            .map_err(|e| format!("Failed to retrieve signature: {}", e))?
            .unwrap_or(sig);

        Ok(signature::SignatureRegistrationResult {
            signature: updated_sig.clone(),
            is_new,
            occurrence_count: updated_sig.occurrence_count,
            linked_ticket: updated_sig.linked_ticket,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Get all analyses that share a signature
#[tauri::command]
pub async fn get_signature_occurrences(
    hash: String,
    db: DbState<'_>,
) -> Result<signature::SignatureOccurrences, String> {
    log::debug!("cmd: get_signature_occurrences");
    log::debug!("Getting occurrences for signature: {}", hash);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        let sig = db_clone
            .find_signature_by_hash(&hash)
            .map_err(|e| format!("Failed to find signature: {}", e))?
            .ok_or_else(|| "Signature not found".to_string())?;

        let files = db_clone
            .get_analyses_for_signature(&hash)
            .map_err(|e| format!("Failed to get analyses for signature: {}", e))?;

        Ok(signature::SignatureOccurrences {
            signature: sig,
            files,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Get top crash signatures by occurrence count
#[tauri::command]
pub async fn get_top_signatures(
    limit: Option<usize>,
    status: Option<String>,
    db: DbState<'_>,
) -> Result<Vec<signature::CrashSignature>, String> {
    log::debug!("cmd: get_top_signatures");
    log::debug!(
        "Getting top signatures (limit: {:?}, status: {:?})",
        limit,
        status
    );

    let db_clone = Arc::clone(&db);
    let limit_val = limit.unwrap_or(20);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.get_top_signatures(limit_val, status.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to get top signatures: {}", e))
}

/// Update signature status
#[tauri::command]
pub async fn update_signature_status(
    hash: String,
    status: String,
    metadata: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: update_signature_status");
    log::info!("Updating signature {} status to {}", hash, status);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.update_signature_status(&hash, &status, metadata.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to update signature status: {}", e))
}

/// Link a ticket to a signature
#[tauri::command]
pub async fn link_ticket_to_signature(
    hash: String,
    ticket_key: String,
    ticket_url: Option<String>,
    db: DbState<'_>,
) -> Result<(), String> {
    log::debug!("cmd: link_ticket_to_signature");
    log::info!("Linking ticket {} to signature {}", ticket_key, hash);

    let db_clone = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || {
        db_clone.link_ticket_to_signature(&hash, &ticket_key, ticket_url.as_deref())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| format!("Failed to link ticket to signature: {}", e))
}
