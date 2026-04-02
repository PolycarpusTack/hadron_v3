//! Pattern matching engine — admin-managed rules stored in global_settings.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use regex::Regex;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::*;

use super::AppError;

const PATTERNS_KEY: &str = "pattern_rules";

async fn load_rules(state: &AppState) -> Result<Vec<PatternRule>, super::AppError> {
    let val = db::get_global_setting_json(&state.db, PATTERNS_KEY).await?;
    match val {
        Some(v) => {
            let rules: Vec<PatternRule> = serde_json::from_value(v)
                .map_err(|e| AppError(hadron_core::error::HadronError::internal(e.to_string())))?;
            Ok(rules)
        }
        None => Ok(Vec::new()),
    }
}

async fn save_rules(state: &AppState, rules: &[PatternRule]) -> Result<(), super::AppError> {
    let val = serde_json::to_value(rules)
        .map_err(|e| AppError(hadron_core::error::HadronError::internal(e.to_string())))?;
    db::set_global_setting_json(&state.db, PATTERNS_KEY, &val).await?;
    Ok(())
}

pub async fn list_patterns(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let rules = load_rules(&state).await?;
    Ok(Json(rules))
}

pub async fn create_pattern(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(rule): Json<PatternRule>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    // Validate regex
    Regex::new(&rule.pattern).map_err(|e| {
        AppError(hadron_core::error::HadronError::validation(format!(
            "Invalid regex pattern: {e}"
        )))
    })?;

    let mut rules = load_rules(&state).await?;
    rules.push(rule);
    save_rules(&state, &rules).await?;
    Ok((StatusCode::CREATED, Json(rules)))
}

pub async fn update_pattern(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(updated): Json<PatternRule>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;

    Regex::new(&updated.pattern).map_err(|e| {
        AppError(hadron_core::error::HadronError::validation(format!(
            "Invalid regex pattern: {e}"
        )))
    })?;

    let mut rules = load_rules(&state).await?;
    if let Some(pos) = rules.iter().position(|r| r.id == id) {
        rules[pos] = updated;
        save_rules(&state, &rules).await?;
        Ok(Json(rules))
    } else {
        Err(AppError(hadron_core::error::HadronError::not_found(
            format!("Pattern rule {id} not found"),
        )))
    }
}

pub async fn delete_pattern(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let mut rules = load_rules(&state).await?;
    let len_before = rules.len();
    rules.retain(|r| r.id != id);
    if rules.len() == len_before {
        return Err(AppError(hadron_core::error::HadronError::not_found(
            format!("Pattern rule {id} not found"),
        )));
    }
    save_rules(&state, &rules).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestPatternRequest {
    pub content: String,
    pub error_type: Option<String>,
}

pub async fn test_patterns(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<TestPatternRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Admin)?;
    let rules = load_rules(&state).await?;
    let matches = evaluate_patterns(&req.content, req.error_type.as_deref(), &rules);
    Ok(Json(matches))
}

/// Evaluate pattern rules against content. Used during analysis.
pub fn evaluate_patterns(
    content: &str,
    error_type: Option<&str>,
    rules: &[PatternRule],
) -> Vec<PatternMatch> {
    let mut matches = Vec::new();

    for rule in rules {
        if !rule.enabled {
            continue;
        }

        let text = match rule.pattern_type.as_str() {
            "error_type" => error_type.unwrap_or(""),
            _ => content,
        };

        if let Ok(re) = Regex::new(&rule.pattern) {
            if re.is_match(text) {
                matches.push(PatternMatch {
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    severity: rule.severity.clone(),
                    component: rule.component.clone(),
                });
            }
        }
    }

    matches
}
