//! Tauri commands wrapping hadron-investigation orchestrators.

use hadron_investigation::{
    atlassian::{
        confluence::{get_confluence_content, search_confluence},
        AtlassianClient, InvestigationConfig,
    },
    investigation::evidence::{ConfluenceDoc, InvestigationDossier},
    investigate_customer_history, investigate_expected_behavior,
    investigate_regression_family, investigate_ticket,
};

fn make_config(
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> InvestigationConfig {
    InvestigationConfig {
        jira_base_url: base_url,
        jira_email: email,
        jira_api_token: api_token,
        confluence_base_url: confluence_url.filter(|s| !s.is_empty()),
        confluence_email: confluence_email.filter(|s| !s.is_empty()),
        confluence_api_token: confluence_token.filter(|s| !s.is_empty()),
        whatson_kb_url: whatson_kb_url.filter(|s| !s.is_empty()),
        mod_docs_homepage_id: mod_docs_homepage_id.filter(|s| !s.is_empty()),
        mod_docs_space_path: mod_docs_space_path.filter(|s| !s.is_empty()),
    }
}

#[tauri::command]
pub async fn investigate_jira_ticket(
    key: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_ticket key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_ticket(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_regression_family(
    key: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_regression_family key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_regression_family(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_expected_behavior(
    key: String,
    query: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_expected_behavior key={} query={}", key, query);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_expected_behavior(config, &key, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_customer_history(
    key: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
    whatson_kb_url: Option<String>,
    mod_docs_homepage_id: Option<String>,
    mod_docs_space_path: Option<String>,
) -> Result<InvestigationDossier, String> {
    log::debug!("cmd: investigate_jira_customer_history key={}", key);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        whatson_kb_url, mod_docs_homepage_id, mod_docs_space_path,
    );
    investigate_customer_history(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_confluence_docs(
    query: String,
    space_key: Option<String>,
    limit: Option<u32>,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
) -> Result<Vec<ConfluenceDoc>, String> {
    log::debug!("cmd: search_confluence_docs query={}", query);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        None, None, None,
    );
    let client = AtlassianClient::new(config);
    let cql = if let Some(space) = space_key.filter(|s| !s.is_empty()) {
        format!("space = \"{}\" AND text ~ \"{}\"", space, query.replace('"', "'"))
    } else {
        format!("text ~ \"{}\"", query.replace('"', "'"))
    };
    search_confluence(&client, &cql, limit.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_confluence_page(
    content_id: String,
    base_url: String,
    email: String,
    api_token: String,
    confluence_url: Option<String>,
    confluence_email: Option<String>,
    confluence_token: Option<String>,
) -> Result<ConfluenceDoc, String> {
    log::debug!("cmd: get_confluence_page id={}", content_id);
    let config = make_config(
        base_url, email, api_token,
        confluence_url, confluence_email, confluence_token,
        None, None, None,
    );
    let client = AtlassianClient::new(config);
    get_confluence_content(&client, &content_id)
        .await
        .map_err(|e| e.to_string())
}
