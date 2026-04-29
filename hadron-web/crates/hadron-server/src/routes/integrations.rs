//! Integration handlers — OpenSearch, Jira, and Sentry.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthenticatedUser;
use crate::db;
use crate::integrations::{jira, opensearch, sentry};
use crate::middleware::require_role;
use crate::AppState;
use hadron_core::models::{Role, SentryConfig};

use super::AppError;

// ============================================================================
// OpenSearch
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSearchRequest {
    url: String,
    username: Option<String>,
    password: Option<String>,
    index: String,
    query: String,
    size: Option<u32>,
    from: Option<u32>,
}

/// Validate an OpenSearch index name/pattern — allows lowercase alphanumeric,
/// hyphens, underscores, dots, and `*` wildcards. Rejects slashes and dots
/// at the start to prevent path traversal into other API endpoints.
fn validate_opensearch_index(index: &str) -> Result<(), AppError> {
    if index.is_empty() || index.starts_with('.') || index.starts_with('-') {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Invalid OpenSearch index name",
        )));
    }
    if index.chars().any(|c| !matches!(c, 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '*')) {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Invalid OpenSearch index name",
        )));
    }
    Ok(())
}

pub async fn opensearch_search(
    user: AuthenticatedUser,
    Json(req): Json<OpenSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    ensure_opensearch_host_allowed(&req.url)?;
    validate_opensearch_index(&req.index)?;

    let config = opensearch::OpenSearchConfig {
        url: req.url,
        username: req.username,
        password: req.password,
        index_pattern: req.index.clone(),
    };

    let query = opensearch::build_text_query(&req.query);
    let result =
        opensearch::search(&config, &req.index, &query, req.size.unwrap_or(20), req.from.unwrap_or(0))
            .await?;

    Ok(Json(result))
}

/// Reject URLs whose host is not in `{env_var}`, fail-closed on missing/empty.
///
/// `label` appears in error messages and logs so operators can tell which
/// integration rejected the URL. An entry containing ':' is port-pinned
/// (must match `host:port`); a bare entry matches any port on that host.
/// Scheme must be http or https. The host check uses the parsed URL's host
/// component (not userinfo), which rejects `user@good@evil` smuggling.
pub(crate) fn ensure_integration_host_allowed(
    raw_url: &str,
    label: &str,
    env_var: &str,
) -> Result<(), AppError> {
    let parsed = reqwest::Url::parse(raw_url).map_err(|_| {
        AppError(hadron_core::error::HadronError::validation(format!(
            "Invalid {label} URL"
        )))
    })?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(AppError(hadron_core::error::HadronError::validation(
                format!("{label} URL must use http or https"),
            )));
        }
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::validation(format!(
                "{label} URL missing host"
            )))
        })?
        .to_ascii_lowercase();

    // Derive host:port so the allowlist can pin a specific port if it wants to.
    // `port_or_known_default` returns 80 for http and 443 for https when the
    // URL has no explicit port; that keeps `https://host.example` matchable
    // as `host.example:443` without requiring the operator to spell it out.
    let host_port = parsed
        .port_or_known_default()
        .map(|p| format!("{host}:{p}"));

    let allowed = std::env::var(env_var).unwrap_or_default();
    let entries: Vec<String> = allowed
        .split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    if entries.is_empty() {
        tracing::warn!(
            "{env_var} is empty — rejecting {label} request for host {host}"
        );
        return Err(AppError(hadron_core::error::HadronError::forbidden(
            format!("{label} host allowlist not configured"),
        )));
    }

    let matched = entries.iter().any(|e| {
        if e.contains(':') {
            host_port.as_deref() == Some(e.as_str())
        } else {
            e == &host
        }
    });

    if !matched {
        return Err(AppError(hadron_core::error::HadronError::forbidden(
            format!("{label} host not permitted by allowlist"),
        )));
    }

    Ok(())
}

/// OpenSearch-specific wrapper kept for readability at the call sites and
/// for backwards-compat with the existing unit tests.
fn ensure_opensearch_host_allowed(raw_url: &str) -> Result<(), AppError> {
    ensure_integration_host_allowed(raw_url, "OpenSearch", "OPENSEARCH_ALLOWED_HOSTS")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // All env-mutating tests in this module share this mutex so
    // cargo-test's parallel runner can't interleave them and corrupt
    // each other's OPENSEARCH_ALLOWED_HOSTS / JIRA_ALLOWED_HOSTS /
    // SENTRY_ALLOWED_HOSTS state.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_allowlist<T>(value: &str, f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("OPENSEARCH_ALLOWED_HOSTS", value);
        let result = f();
        std::env::remove_var("OPENSEARCH_ALLOWED_HOSTS");
        result
    }

    #[test]
    fn empty_allowlist_rejects_everything() {
        with_allowlist("", || {
            assert!(ensure_opensearch_host_allowed("https://os.example").is_err());
        });
    }

    #[test]
    fn bare_host_entry_matches_any_port() {
        with_allowlist("os.example", || {
            assert!(ensure_opensearch_host_allowed("https://os.example").is_ok());
            assert!(ensure_opensearch_host_allowed("https://os.example:9200").is_ok());
            assert!(ensure_opensearch_host_allowed("http://os.example:80").is_ok());
            // Wrong host still rejected.
            assert!(ensure_opensearch_host_allowed("https://evil.example").is_err());
        });
    }

    #[test]
    fn port_pinned_entry_rejects_other_ports() {
        with_allowlist("os.example:9200", || {
            assert!(ensure_opensearch_host_allowed("https://os.example:9200").is_ok());
            assert!(ensure_opensearch_host_allowed("https://os.example").is_err());
            assert!(ensure_opensearch_host_allowed("https://os.example:443").is_err());
            assert!(ensure_opensearch_host_allowed("http://os.example:22").is_err());
        });
    }

    #[test]
    fn mixed_allowlist_evaluates_each_entry_independently() {
        with_allowlist("primary.example,secondary.example:9200", || {
            // Bare-host entry: any port ok.
            assert!(ensure_opensearch_host_allowed("https://primary.example").is_ok());
            assert!(ensure_opensearch_host_allowed("https://primary.example:443").is_ok());
            // Port-pinned entry: only that port.
            assert!(ensure_opensearch_host_allowed("https://secondary.example:9200").is_ok());
            assert!(ensure_opensearch_host_allowed("https://secondary.example").is_err());
            assert!(ensure_opensearch_host_allowed("https://secondary.example:443").is_err());
        });
    }

    #[test]
    fn rejects_non_http_schemes_before_allowlist_check() {
        with_allowlist("os.example", || {
            assert!(ensure_opensearch_host_allowed("file:///etc/passwd").is_err());
            assert!(ensure_opensearch_host_allowed("ftp://os.example").is_err());
        });
    }

    #[test]
    fn userinfo_smuggling_is_rejected() {
        // https://user@good.example@evil.example/ parses with host=evil.example.
        with_allowlist("good.example", || {
            assert!(
                ensure_opensearch_host_allowed("https://user@good.example@evil.example/").is_err()
            );
        });
    }

    #[test]
    fn case_insensitive_host_match() {
        with_allowlist("OS.Example", || {
            assert!(ensure_opensearch_host_allowed("https://os.example").is_ok());
            assert!(ensure_opensearch_host_allowed("https://OS.EXAMPLE").is_ok());
        });
    }

    #[test]
    fn shared_helper_reads_per_integration_env_var() {
        // JIRA and OpenSearch allowlists are independent: setting one does
        // not unlock the other. This guards against a regression where a
        // single global allowlist gets threaded through by mistake.
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("OPENSEARCH_ALLOWED_HOSTS", "os.example");
        std::env::set_var("JIRA_ALLOWED_HOSTS", "jira.example");

        assert!(
            ensure_integration_host_allowed(
                "https://os.example",
                "OpenSearch",
                "OPENSEARCH_ALLOWED_HOSTS"
            )
            .is_ok()
        );
        // OpenSearch host not allowed through the JIRA env var.
        assert!(
            ensure_integration_host_allowed(
                "https://os.example",
                "JIRA",
                "JIRA_ALLOWED_HOSTS"
            )
            .is_err()
        );
        assert!(
            ensure_integration_host_allowed(
                "https://jira.example",
                "JIRA",
                "JIRA_ALLOWED_HOSTS"
            )
            .is_ok()
        );
        // Missing env var fails closed with a distinct label in the error.
        std::env::remove_var("SENTRY_ALLOWED_HOSTS");
        assert!(
            ensure_integration_host_allowed(
                "https://sentry.example",
                "Sentry",
                "SENTRY_ALLOWED_HOSTS"
            )
            .is_err()
        );

        std::env::remove_var("OPENSEARCH_ALLOWED_HOSTS");
        std::env::remove_var("JIRA_ALLOWED_HOSTS");
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSearchTestRequest {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

pub async fn opensearch_test(
    user: AuthenticatedUser,
    Json(req): Json<OpenSearchTestRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    // F3 (2026-04-20 audit): apply the same host allowlist as the real
    // search endpoint so the test endpoint can't be turned into an SSRF
    // oracle against internal services.
    ensure_opensearch_host_allowed(&req.url)?;
    let config = opensearch::OpenSearchConfig {
        url: req.url,
        username: req.username,
        password: req.password,
        index_pattern: "*".to_string(),
    };

    let ok = opensearch::test_connection(&config).await?;
    Ok(Json(serde_json::json!({ "connected": ok })))
}

// ============================================================================
// Jira
// ============================================================================

pub async fn jira_create_ticket(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<JiraCreateRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;

    let mut config = db::get_jira_config_from_poller(&state.db).await?;
    config.project_key = req.project_key;

    let ticket_req = jira::CreateTicketRequest {
        config_id: None,
        summary: req.summary,
        description: req.description,
        priority: req.priority,
        labels: req.labels,
        issue_type: req.issue_type,
        analysis_id: req.analysis_id,
    };

    let result = jira::create_ticket(&config, &ticket_req).await?;

    // Audit log
    let _ = db::write_audit_log(
        &state.db,
        user.user.id,
        "jira.create_ticket",
        "jira_ticket",
        Some(&result.key),
        &serde_json::json!({ "analysis_id": req.analysis_id }),
        None,
    )
    .await;

    Ok((StatusCode::CREATED, Json(result)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateRequest {
    project_key: String,
    summary: String,
    description: String,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    issue_type: Option<String>,
    analysis_id: Option<i64>,
}

pub async fn jira_search(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Json(req): Json<JiraSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;

    let mut config = crate::db::get_jira_config_from_poller(&state.db).await?;
    if let Some(pk) = &req.project_key {
        config.project_key = pk.clone();
    }

    // User-supplied JQL is never forwarded to JIRA: the search stays scoped to
    // the configured project via `text` + project_key. Allowing raw JQL would
    // let any authenticated user pivot queries across projects.
    if req.jql.is_some() {
        tracing::warn!(
            "jira_search: ignoring user-supplied JQL (user_id {}, project {})",
            user.user.id,
            config.project_key
        );
    }

    let result = jira::search_issues(
        &config,
        None,
        req.text.as_deref(),
        req.max_results.unwrap_or(20),
    )
    .await?;

    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSearchRequest {
    pub project_key: Option<String>,
    pub jql: Option<String>,
    pub text: Option<String>,
    pub max_results: Option<u32>,
}

pub async fn jira_test(
    user: AuthenticatedUser,
    Json(req): Json<JiraTestRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    // F3 (2026-04-20 audit): the JIRA test endpoint accepts an attacker-
    // controlled base_url and returns response bodies inside errors — that
    // was a classic SSRF oracle. Gate outbound calls with a host allowlist.
    ensure_integration_host_allowed(&req.base_url, "JIRA", "JIRA_ALLOWED_HOSTS")?;
    let config = jira::JiraConfig {
        base_url: req.base_url,
        email: req.email,
        api_token: req.api_token,
        project_key: String::new(),
    };

    let ok = jira::test_connection(&config).await?;
    Ok(Json(serde_json::json!({ "connected": ok })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTestRequest {
    base_url: String,
    email: String,
    api_token: String,
}

/// Validate a JIRA project key — uppercase alphanumeric + underscore, 2–10 chars.
fn validate_jira_project_key(key: &str) -> Result<(), AppError> {
    let valid = !key.is_empty()
        && key.len() <= 10
        && key.chars().next().map_or(false, |c| c.is_ascii_uppercase())
        && key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    if !valid {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Invalid JIRA project key",
        )));
    }
    Ok(())
}

/// Validate a Sentry issue ID — numeric only.
fn validate_sentry_issue_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError(hadron_core::error::HadronError::validation(
            "Invalid Sentry issue ID",
        )));
    }
    Ok(())
}

pub async fn jira_fix_versions(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(project): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    validate_jira_project_key(&project)?;
    let mut config = crate::db::get_jira_config_from_poller(&state.db)
        .await
        .map_err(AppError)?;
    config.project_key = project.clone();
    let versions = jira::list_fix_versions(&config, &project)
        .await
        .map_err(AppError)?;
    Ok(Json(versions))
}

// ============================================================================
// Sentry
// ============================================================================

pub async fn sentry_test(
    user: AuthenticatedUser,
    Json(config): Json<SentryConfig>,
) -> Result<impl IntoResponse, AppError> {
    crate::middleware::require_role(&user, hadron_core::models::Role::Lead)
        .map_err(|_| AppError(hadron_core::error::HadronError::forbidden("Only leads and admins can test Sentry connections.")))?;
    // F3 (2026-04-20 audit): apply allowlist to stop sentry_test being
    // used as an SSRF oracle into the internal network.
    ensure_integration_host_allowed(&config.base_url, "Sentry", "SENTRY_ALLOWED_HOSTS")?;
    let ok = sentry::test_connection(&config)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(serde_json::json!({ "connected": ok })))
}

pub async fn sentry_projects(
    user: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let projects = sentry::list_projects(&config)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(projects))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentryIssuesQuery {
    project: String,
    limit: Option<usize>,
}

pub async fn sentry_issues(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Query(params): Query<SentryIssuesQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let issues = sentry::list_issues(&config, &params.project, params.limit.unwrap_or(25))
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(issues))
}

pub async fn sentry_issue(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    validate_sentry_issue_id(&issue_id)?;
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let issue = sentry::fetch_issue(&config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(issue))
}

pub async fn sentry_event(
    user: AuthenticatedUser,
    State(state): State<AppState>,
    Path(issue_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_role(&user, Role::Lead)?;
    validate_sentry_issue_id(&issue_id)?;
    let config = crate::db::get_sentry_config(&state.db)
        .await
        .map_err(|e| AppError(e))?
        .ok_or_else(|| {
            AppError(hadron_core::error::HadronError::Validation(
                "Sentry is not configured. Ask an admin to configure it.".to_string(),
            ))
        })?;
    let event = sentry::fetch_latest_event(&config, &issue_id)
        .await
        .map_err(|e| AppError(e))?;
    Ok(Json(event))
}
