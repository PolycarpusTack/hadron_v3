//! Session Summary Tauri commands for Ask Hadron 2.0

use std::sync::Arc;

use crate::ai_service::{
    build_chat_request_anthropic, build_chat_request_openai, call_provider_chat, ChatMessage,
};
use crate::database::{Database, SessionSummary};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSummaryRequest {
    pub session_id: String,
    pub provider: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummaryRequest {
    pub session_id: String,
    pub summary_markdown: String,
    pub topic: String,
    pub won_version: Option<String>,
    pub customer: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummariesRequest {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub customer: Option<String>,
    pub unexported_only: Option<bool>,
}

#[tauri::command]
pub async fn generate_session_summary(
    db: tauri::State<'_, Arc<Database>>,
    request: GenerateSummaryRequest,
) -> Result<String, String> {
    log::debug!("cmd: generate_session_summary");
    // Load all messages for session
    let messages = db
        .get_chat_messages(&request.session_id)
        .map_err(|e| e.to_string())?;
    if messages.is_empty() {
        return Err("No messages in session".to_string());
    }

    // Build conversation transcript
    let mut transcript = String::new();
    for msg in &messages {
        let role_label = match msg.role.as_str() {
            "user" => "User",
            "assistant" => "Hadron",
            _ => continue,
        };
        transcript.push_str(&format!("**{}:** {}\n\n", role_label, msg.content));
    }

    // Build summarization prompt
    let system_prompt = "You are a technical writer. Summarize the following support conversation into a structured document. Use this exact format:\n\n## Topic\n[One-line description]\n\n## Context\n- WON Version: [if mentioned]\n- Customer: [if mentioned]\n- Related Analyses: [#IDs if any]\n\n## Question\n[The core question or problem]\n\n## Answer\n[Condensed key findings]\n\n## Sources\n[KB docs, analysis IDs, JIRA tickets cited]\n\n## Resolution\n[Action taken or recommended]\n\nBe concise. Only include sections that have content.";

    let chat_messages = vec![ChatMessage {
        role: "user".to_string(),
        content: transcript,
    }];

    let body = match request.provider.as_str() {
        "anthropic" => build_chat_request_anthropic(
            &chat_messages,
            system_prompt,
            &request.model,
            4000,
            false,
        ),
        _ => build_chat_request_openai(
            &chat_messages,
            system_prompt,
            &request.model,
            4000,
            false,
        ),
    };

    let response = call_provider_chat(&request.provider, body, &request.api_key).await?;

    Ok(response.content)
}

#[tauri::command]
pub async fn save_session_summary(
    db: tauri::State<'_, Arc<Database>>,
    request: SaveSummaryRequest,
) -> Result<i64, String> {
    log::debug!("cmd: save_session_summary");
    db.save_session_summary(
        &request.session_id,
        &request.summary_markdown,
        Some(&request.topic),
        request.won_version.as_deref(),
        request.customer.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_session_summary(
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
) -> Result<Option<SessionSummary>, String> {
    log::debug!("cmd: get_session_summary");
    db.get_session_summary(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_summaries_bundle(
    db: tauri::State<'_, Arc<Database>>,
    request: ExportSummariesRequest,
) -> Result<String, String> {
    log::debug!("cmd: export_summaries_bundle");
    let summaries = db
        .get_summaries_for_export(
            request.date_from.as_deref(),
            request.date_to.as_deref(),
            request.customer.as_deref(),
            request.unexported_only.unwrap_or(false),
        )
        .map_err(|e| e.to_string())?;

    let mut bundle: Vec<serde_json::Value> = Vec::new();
    for summary in &summaries {
        // Build a sanitized filename from date + topic
        let date_part = summary
            .created_at
            .split(' ')
            .next()
            .unwrap_or("unknown-date");
        let topic_part = summary
            .topic
            .as_deref()
            .unwrap_or("untitled")
            .to_lowercase()
            .replace(' ', "-")
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-')
            .take(50)
            .collect::<String>();
        let filename = format!("{}-{}.md", date_part, topic_part);

        bundle.push(serde_json::json!({
            "filename": filename,
            "content": summary.summary_markdown,
        }));
    }

    serde_json::to_string(&bundle).map_err(|e| e.to_string())
}
