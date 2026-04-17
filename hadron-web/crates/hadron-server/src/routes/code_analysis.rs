//! Code analysis handlers — AI-powered code review.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::ai;
use crate::auth::AuthenticatedUser;
use crate::sse;
use crate::AppState;

use super::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAnalysisRequest {
    pub code: String,
    pub language: Option<String>,
    pub filename: Option<String>,
}

const MAX_CODE_SIZE: usize = 512 * 1024;

/// POST /api/code-analysis — non-streaming code analysis.
pub async fn analyze_code(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CodeAnalysisRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.code.len() > MAX_CODE_SIZE {
        return Err(AppError(hadron_core::error::HadronError::FileTooLarge {
            size: req.code.len() as u64,
            max: MAX_CODE_SIZE as u64,
        }));
    }

    let filename = req.filename.unwrap_or_else(|| "untitled".to_string());
    let language = req.language.unwrap_or_else(|| {
        hadron_core::ai::detect_language(&req.code, &filename)
    });

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    let messages = hadron_core::ai::build_code_analysis_messages(&req.code, &filename, &language);

    let raw_response = ai::complete(
        &ai_config,
        messages,
        None,
    )
    .await?;

    let result = hadron_core::ai::parse_code_analysis(&raw_response)?;

    Ok(Json(result))
}

/// POST /api/code-analysis/stream — SSE streaming code analysis.
pub async fn analyze_code_stream(
    _user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<CodeAnalysisRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.code.len() > MAX_CODE_SIZE {
        return Err(AppError(hadron_core::error::HadronError::FileTooLarge {
            size: req.code.len() as u64,
            max: MAX_CODE_SIZE as u64,
        }));
    }

    let filename = req.filename.unwrap_or_else(|| "untitled".to_string());
    let language = req.language.unwrap_or_else(|| {
        hadron_core::ai::detect_language(&req.code, &filename)
    });

    let ai_config = super::analyses::resolve_ai_config(&state.db).await?;

    let messages = hadron_core::ai::build_code_analysis_messages(&req.code, &filename, &language);

    Ok(sse::stream_ai_completion(ai_config, messages, None))
}
