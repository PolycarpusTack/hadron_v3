use super::{adf::adf_to_text, AtlassianClient, InvestigationError};

pub struct IssueFullContext {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub assignee: Option<String>,
    pub reporter: Option<String>,
    pub project_key: String,
    pub comments: Vec<String>,
    pub changelog_entries: Vec<String>,
    pub worklogs: Vec<String>,
    pub remote_links: Vec<String>,
    pub issue_links: Vec<(String, String, String)>, // (key, summary, relation_name)
    pub attachments: Vec<(String, String)>,           // (filename, content_url)
    pub sprint_name: Option<String>,
    pub fix_versions: Vec<String>,
    pub labels: Vec<String>,
    pub components: Vec<String>,
}

pub async fn get_issue_full(
    client: &AtlassianClient,
    key: &str,
) -> Result<IssueFullContext, InvestigationError> {
    let issue = client
        .jira_get(&format!("/rest/api/3/issue/{}", key))
        .await?;

    let fields = &issue["fields"];
    let summary = fields["summary"].as_str().unwrap_or("").to_string();
    let status = fields["status"]["name"].as_str().unwrap_or("").to_string();
    let assignee = fields["assignee"]["displayName"].as_str().map(String::from);
    let reporter = fields["reporter"]["displayName"].as_str().map(String::from);
    let project_key = fields["project"]["key"].as_str().unwrap_or("").to_string();

    let description = if let Some(adf) = fields.get("description") {
        if !adf.is_null() {
            adf_to_text(adf)
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let components: Vec<String> = fields["components"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let labels: Vec<String> = fields["labels"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|l| l.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let fix_versions: Vec<String> = fields["fixVersions"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let issue_links: Vec<(String, String, String)> = fields["issuelinks"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|link| {
                    let rel = link["type"]["name"].as_str().unwrap_or("").to_string();
                    if let Some(inward) = link.get("inwardIssue") {
                        let k = inward["key"].as_str().unwrap_or("").to_string();
                        let s = inward["fields"]["summary"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        Some((k, s, rel))
                    } else if let Some(outward) = link.get("outwardIssue") {
                        let k = outward["key"].as_str().unwrap_or("").to_string();
                        let s = outward["fields"]["summary"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        Some((k, s, rel))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let attachments: Vec<(String, String)> = fields["attachment"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let name = a["filename"].as_str().map(String::from)?;
                    let url = a["content"].as_str().map(String::from)?;
                    Some((name, url))
                })
                .collect()
        })
        .unwrap_or_default();

    let sprint_name = fields["customfield_10020"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|s| s["name"].as_str())
        .map(String::from);

    // Parallel fetch of changelog, comments, worklogs, remote links
    let changelog_path = format!("/rest/api/3/issue/{}/changelog", key);
    let comments_path = format!("/rest/api/3/issue/{}/comment?expand=renderedBody", key);
    let worklog_path = format!("/rest/api/3/issue/{}/worklog", key);
    let remote_links_path = format!("/rest/api/3/issue/{}/remotelink", key);
    let changelog_fut = client.jira_get(&changelog_path);
    let comments_fut = client.jira_get(&comments_path);
    let worklog_fut = client.jira_get(&worklog_path);
    let remote_links_fut = client.jira_get(&remote_links_path);

    let (changelog_res, comments_res, worklog_res, remote_links_res) =
        tokio::join!(changelog_fut, comments_fut, worklog_fut, remote_links_fut);

    let changelog_entries: Vec<String> = changelog_res
        .ok()
        .and_then(|v| v["values"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .map(|entry| {
                    let author = entry["author"]["displayName"]
                        .as_str()
                        .unwrap_or("unknown");
                    let created = entry["created"].as_str().unwrap_or("");
                    let items: Vec<String> = entry["items"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .map(|item| {
                                    format!(
                                        "{}: {} → {}",
                                        item["field"].as_str().unwrap_or(""),
                                        item["fromString"].as_str().unwrap_or(""),
                                        item["toString"].as_str().unwrap_or("")
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    format!("[{}] {} — {}", created, author, items.join("; "))
                })
                .collect()
        })
        .unwrap_or_default();

    let comments: Vec<String> = comments_res
        .ok()
        .and_then(|v| v["comments"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    let author = c["author"]["displayName"].as_str().unwrap_or("unknown");
                    let created = c["created"].as_str().unwrap_or("");
                    let body = if let Some(adf) = c.get("body") {
                        if !adf.is_null() {
                            adf_to_text(adf)
                        } else {
                            c["renderedBody"].as_str().unwrap_or("").to_string()
                        }
                    } else {
                        String::new()
                    };
                    format!("[{}] {}: {}", created, author, body.trim())
                })
                .collect()
        })
        .unwrap_or_default();

    let worklogs: Vec<String> = worklog_res
        .ok()
        .and_then(|v| v["worklogs"].as_array().cloned())
        .map(|arr| {
            arr.iter()
                .map(|w| {
                    let author = w["author"]["displayName"].as_str().unwrap_or("unknown");
                    let started = w["started"].as_str().unwrap_or("");
                    let seconds = w["timeSpentSeconds"].as_u64().unwrap_or(0);
                    let hours = seconds / 3600;
                    let comment = if let Some(adf) = w.get("comment") {
                        if !adf.is_null() {
                            adf_to_text(adf)
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };
                    format!(
                        "[{}] {} logged {}h — {}",
                        started,
                        author,
                        hours,
                        comment.trim()
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    let remote_links: Vec<String> = remote_links_res
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|rl| {
                    let title = rl["object"]["title"].as_str()?;
                    let url = rl["object"]["url"].as_str().unwrap_or("");
                    // Reject non-https URLs (javascript:, data:, etc.)
                    if !url.starts_with("https://") {
                        return None;
                    }
                    Some(format!("{} ({})", title, url))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(IssueFullContext {
        key: key.to_string(),
        summary,
        description,
        status,
        assignee,
        reporter,
        project_key,
        comments,
        changelog_entries,
        worklogs,
        remote_links,
        issue_links,
        attachments,
        sprint_name,
        fix_versions,
        labels,
        components,
    })
}

/// Escape a value for use as a quoted JQL/CQL string literal.
/// Per Atlassian docs, backslash and double-quote must be escaped;
/// control characters are dropped.
pub fn quote_jql_literal(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    out.push('"');
    for ch in input.chars() {
        match ch {
            '\\' | '"' => { out.push('\\'); out.push(ch); }
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Validate that a string is a well-formed JIRA ticket key (e.g. MGX-123).
/// Returns true if the key matches [A-Z][A-Z0-9_]{1,9}-[0-9]{1,12}.
pub fn is_valid_ticket_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    let dash = match bytes.iter().position(|&b| b == b'-') {
        Some(i) => i,
        None => return false,
    };
    if dash < 1 || dash > 10 {
        return false;
    }
    if !bytes[..dash][0].is_ascii_uppercase() {
        return false;
    }
    if !bytes[..dash].iter().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || *b == b'_') {
        return false;
    }
    let num_part = &bytes[dash + 1..];
    !num_part.is_empty() && num_part.len() <= 12 && num_part.iter().all(|b| b.is_ascii_digit())
}

/// Search Jira issues using JQL. Returns (key, summary, status) for each result.
pub async fn search_jql(
    client: &AtlassianClient,
    jql: &str,
    max_results: u32,
) -> Result<Vec<(String, String, String)>, InvestigationError> {
    let body = serde_json::json!({
        "jql": jql,
        "maxResults": max_results,
        "fields": ["summary", "status"]
    });
    let url = format!(
        "{}/rest/api/3/search",
        client.config.jira_base_url.trim_end_matches('/')
    );
    let resp = client
        .client
        .post(&url)
        .header("Authorization", {
            use base64::Engine;
            let raw = format!("{}:{}", client.config.jira_email, client.config.jira_api_token);
            format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(raw))
        })
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(InvestigationError::Http)?;

    if !resp.status().is_success() {
        return Err(InvestigationError::JiraApi(format!(
            "JQL search returned {}",
            resp.status()
        )));
    }
    let data: serde_json::Value = resp.json().await.map_err(InvestigationError::Http)?;
    let issues = data["issues"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|i| {
                    let key = i["key"].as_str().map(String::from)?;
                    let summary = i["fields"]["summary"].as_str().unwrap_or("").to_string();
                    let status = i["fields"]["status"]["name"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    Some((key, summary, status))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(issues)
}
