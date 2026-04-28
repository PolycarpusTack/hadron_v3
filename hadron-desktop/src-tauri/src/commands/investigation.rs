//! Tauri commands wrapping hadron-investigation orchestrators.
//! SECURITY: credentials are read from the app store on the Rust side;
//! the JIRA API token never travels as an IPC argument.

use tauri_plugin_store::StoreExt;

use hadron_investigation::{
    atlassian::{
        confluence::{get_confluence_content, search_confluence},
        jira::{is_valid_ticket_key, quote_jql_literal},
        AtlassianClient, InvestigationConfig,
    },
    investigation::evidence::{ConfluenceDoc, InvestigationDossier},
    investigate_customer_history, investigate_expected_behavior,
    investigate_regression_family, investigate_ticket,
};

fn read_config(app: &tauri::AppHandle) -> Result<InvestigationConfig, String> {
    let store = app
        .get_store("settings.json")
        .ok_or_else(|| "Settings store not available".to_string())?;

    let get = |key: &str| -> String {
        store
            .get(key)
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default()
    };
    let get_opt = |key: &str| -> Option<String> {
        let v = get(key);
        if v.is_empty() { None } else { Some(v) }
    };

    let jira_base_url = get("jira_base_url");
    let jira_email = get("jira_email");
    let jira_api_token = get("jira_api_key");

    if jira_base_url.is_empty() || jira_email.is_empty() || jira_api_token.is_empty() {
        return Err("JIRA not configured".to_string());
    }

    Ok(InvestigationConfig {
        jira_base_url,
        jira_email,
        jira_api_token,
        confluence_base_url: get_opt("confluence_base_url"),
        confluence_email: get_opt("confluence_email"),
        confluence_api_token: get_opt("confluence_api_key"),
        whatson_kb_url: get_opt("whatson_kb_url"),
        mod_docs_homepage_id: get_opt("mod_docs_homepage_id"),
        mod_docs_space_path: get_opt("mod_docs_space_path"),
    })
}

#[tauri::command]
pub async fn investigate_jira_ticket(
    app: tauri::AppHandle,
    key: String,
) -> Result<InvestigationDossier, String> {
    if !is_valid_ticket_key(&key) {
        return Err("Invalid ticket key format".to_string());
    }
    log::debug!("cmd: investigate_jira_ticket key={}", key);
    let config = read_config(&app)?;
    investigate_ticket(config, &key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_regression_family(
    app: tauri::AppHandle,
    key: String,
) -> Result<InvestigationDossier, String> {
    if !is_valid_ticket_key(&key) {
        return Err("Invalid ticket key format".to_string());
    }
    log::debug!("cmd: investigate_jira_regression_family key={}", key);
    let config = read_config(&app)?;
    investigate_regression_family(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_expected_behavior(
    app: tauri::AppHandle,
    key: String,
    query: String,
) -> Result<InvestigationDossier, String> {
    if !key.is_empty() && !is_valid_ticket_key(&key) {
        return Err("Invalid ticket key format".to_string());
    }
    log::debug!("cmd: investigate_jira_expected_behavior key={} query={}", key, query);
    let config = read_config(&app)?;
    investigate_expected_behavior(config, &key, &query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn investigate_jira_customer_history(
    app: tauri::AppHandle,
    key: String,
) -> Result<InvestigationDossier, String> {
    if !is_valid_ticket_key(&key) {
        return Err("Invalid ticket key format".to_string());
    }
    log::debug!("cmd: investigate_jira_customer_history key={}", key);
    let config = read_config(&app)?;
    investigate_customer_history(config, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_confluence_docs(
    app: tauri::AppHandle,
    query: String,
    space_key: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ConfluenceDoc>, String> {
    log::debug!("cmd: search_confluence_docs query={}", query);
    let config = read_config(&app)?;
    let client = AtlassianClient::new(config);
    let cql = if let Some(space) = space_key.filter(|s| !s.is_empty()) {
        format!(
            "space = {} AND text ~ {}",
            quote_jql_literal(&space),
            quote_jql_literal(&query),
        )
    } else {
        format!("text ~ {}", quote_jql_literal(&query))
    };
    search_confluence(&client, &cql, limit.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_confluence_page(
    app: tauri::AppHandle,
    content_id: String,
) -> Result<ConfluenceDoc, String> {
    log::debug!("cmd: get_confluence_page id={}", content_id);
    let config = read_config(&app)?;
    let client = AtlassianClient::new(config);
    get_confluence_content(&client, &content_id)
        .await
        .map_err(|e| e.to_string())
}
