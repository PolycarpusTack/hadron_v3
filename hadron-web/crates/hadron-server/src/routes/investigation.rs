//! Investigation API route handlers.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use hadron_investigation::{
    atlassian::{
        confluence::{get_confluence_content, search_confluence},
        AtlassianClient, InvestigationConfig,
    },
    investigate_customer_history, investigate_expected_behavior,
    investigate_regression_family, investigate_ticket,
};

#[derive(Deserialize)]
pub struct TicketRequest {
    pub ticket_key: String,
}

#[derive(Deserialize)]
pub struct ExpectedBehaviorRequest {
    pub ticket_key: Option<String>,
    pub query: String,
}

#[derive(Deserialize)]
pub struct ConfluenceSearchRequest {
    pub query: String,
    pub space_key: Option<String>,
    pub limit: Option<u32>,
}

async fn load_config(state: &AppState) -> Result<InvestigationConfig, (StatusCode, String)> {
    let row = db::get_poller_config(&state.db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load JIRA config: {}", e),
        )
    })?;

    if row.jira_base_url.is_empty() || row.jira_email.is_empty() || row.jira_api_token.is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "JIRA not configured".into()));
    }

    let jira_api_token = crate::crypto::decrypt_value(&row.jira_api_token).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to decrypt JIRA token: {}", e),
        )
    })?;

    Ok(InvestigationConfig {
        jira_base_url: row.jira_base_url,
        jira_email: row.jira_email,
        jira_api_token,
        confluence_base_url: None,
        confluence_email: None,
        confluence_api_token: None,
        whatson_kb_url: None,
        mod_docs_homepage_id: None,
        mod_docs_space_path: None,
    })
}

pub async fn post_investigate_ticket(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<TicketRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    match investigate_ticket(config, &body.ticket_key).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_investigate_regression(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<TicketRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    match investigate_regression_family(config, &body.ticket_key).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_investigate_expected(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<ExpectedBehaviorRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let key = body.ticket_key.as_deref().unwrap_or("");
    match investigate_expected_behavior(config, key, &body.query).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_investigate_customer(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<TicketRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    match investigate_customer_history(config, &body.ticket_key).await {
        Ok(dossier) => Json(dossier).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn post_confluence_search(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Json(body): Json<ConfluenceSearchRequest>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let client = AtlassianClient::new(config);
    let cql = if let Some(space) = body.space_key.filter(|s| !s.is_empty()) {
        format!(
            "space = \"{}\" AND text ~ \"{}\"",
            space,
            body.query.replace('"', "'")
        )
    } else {
        format!("text ~ \"{}\"", body.query.replace('"', "'"))
    };
    match search_confluence(&client, &cql, body.limit.unwrap_or(10)).await {
        Ok(docs) => Json(docs).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

pub async fn get_confluence_page_handler(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let config = match load_config(&state).await {
        Ok(c) => c,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let client = AtlassianClient::new(config);
    match get_confluence_content(&client, &id).await {
        Ok(doc) => Json(doc).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}
