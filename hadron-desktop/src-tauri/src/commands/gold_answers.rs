//! Gold Answer Tauri commands for Ask Hadron 2.0

use std::sync::Arc;

use crate::database::{Database, GoldAnswer};
use crate::error::CommandResult;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGoldAnswerRequest {
    pub question: String,
    pub answer: String,
    pub session_id: String,
    pub message_id: String,
    pub won_version: Option<String>,
    pub customer: Option<String>,
    pub tags: Option<String>,
    pub verified_by: Option<String>,
    pub tool_results_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportGoldRequest {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub customer: Option<String>,
    pub tags: Option<String>,
}

#[tauri::command]
pub async fn save_gold_answer(
    db: tauri::State<'_, Arc<Database>>,
    request: SaveGoldAnswerRequest,
) -> CommandResult<i64> {
    Ok(db.save_gold_answer(
        &request.question,
        &request.answer,
        &request.session_id,
        &request.message_id,
        request.won_version.as_deref(),
        request.customer.as_deref(),
        request.tags.as_deref(),
        request.verified_by.as_deref(),
        request.tool_results_json.as_deref(),
    )?)
}

#[tauri::command]
pub async fn list_gold_answers(
    db: tauri::State<'_, Arc<Database>>,
    limit: Option<i64>,
    offset: Option<i64>,
    customer: Option<String>,
    tag: Option<String>,
) -> CommandResult<Vec<GoldAnswer>> {
    Ok(db.list_gold_answers(
        limit.unwrap_or(50),
        offset.unwrap_or(0),
        customer.as_deref(),
        tag.as_deref(),
    )?)
}

#[tauri::command]
pub async fn search_gold_answers_cmd(
    db: tauri::State<'_, Arc<Database>>,
    query: String,
    limit: Option<i64>,
) -> CommandResult<Vec<GoldAnswer>> {
    Ok(db.search_gold_answers(&query, limit.unwrap_or(10))?)
}

#[tauri::command]
pub async fn delete_gold_answer_cmd(
    db: tauri::State<'_, Arc<Database>>,
    id: i64,
) -> CommandResult<()> {
    Ok(db.delete_gold_answer(id)?)
}

#[tauri::command]
pub async fn export_gold_answers_jsonl(
    db: tauri::State<'_, Arc<Database>>,
    request: ExportGoldRequest,
) -> CommandResult<String> {
    let answers = db.get_gold_answers_for_export(
        request.date_from.as_deref(),
        request.date_to.as_deref(),
        request.customer.as_deref(),
        request.tags.as_deref(),
    )?;

    // Build JSONL in OpenAI chat format
    let mut jsonl = String::new();
    for answer in &answers {
        let entry = serde_json::json!({
            "messages": [
                {"role": "system", "content": "You are Ask Hadron, an expert regarding the Mediagenix WHATS'ON broadcast management software."},
                {"role": "user", "content": answer.question},
                {"role": "assistant", "content": answer.answer},
            ],
            "_metadata": {
                "gold_answer_id": answer.id,
                "won_version": answer.won_version,
                "customer": answer.customer,
                "tags": answer.tags,
                "created_at": answer.created_at,
            }
        });
        jsonl.push_str(&serde_json::to_string(&entry).unwrap_or_default());
        jsonl.push('\n');
    }
    Ok(jsonl)
}
