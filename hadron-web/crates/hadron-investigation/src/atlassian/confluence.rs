use crate::investigation::evidence::ConfluenceDoc;
use super::{AtlassianClient, InvestigationError};

pub async fn search_confluence(
    client: &AtlassianClient,
    cql: &str,
    limit: u32,
) -> Result<Vec<ConfluenceDoc>, InvestigationError> {
    let path = format!(
        "/wiki/rest/api/search?cql={}&limit={}",
        urlencoded(cql),
        limit
    );
    let data = client.confluence_get(&path).await?;
    let results = data["results"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let content = r.get("content")?;
                    let id = content["id"].as_str().map(String::from)?;
                    let title = content["title"].as_str().unwrap_or("").to_string();
                    let excerpt = r["excerpt"].as_str().unwrap_or("").to_string();
                    let space_key = content["space"]["key"].as_str().map(String::from);
                    let base = client.config.confluence_base_url().trim_end_matches('/');
                    let space = space_key.as_deref().unwrap_or("");
                    let url = format!("{}/wiki/spaces/{}/pages/{}", base, space, id);
                    Some(ConfluenceDoc {
                        id,
                        title,
                        excerpt,
                        url,
                        space_key,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(results)
}

pub async fn get_confluence_content(
    client: &AtlassianClient,
    id: &str,
) -> Result<ConfluenceDoc, InvestigationError> {
    let path = format!("/wiki/rest/api/content/{}?expand=body.storage,space", id);
    let data = client.confluence_get(&path).await?;
    let title = data["title"].as_str().unwrap_or("").to_string();
    let space_key = data["space"]["key"].as_str().map(String::from);
    let body_html = data["body"]["storage"]["value"].as_str().unwrap_or("");
    let excerpt = strip_tags(body_html)
        .split_whitespace()
        .take(80)
        .collect::<Vec<_>>()
        .join(" ");
    let base = client.config.confluence_base_url().trim_end_matches('/');
    let space = space_key.as_deref().unwrap_or("");
    let url = format!("{}/wiki/spaces/{}/pages/{}", base, space, id);
    Ok(ConfluenceDoc {
        id: id.to_string(),
        title,
        excerpt,
        url,
        space_key,
    })
}

pub async fn get_related_content(
    client: &AtlassianClient,
    entities: &[String],
    limit: u32,
) -> Vec<ConfluenceDoc> {
    if entities.is_empty() {
        return vec![];
    }
    let terms: Vec<String> = entities
        .iter()
        .take(4)
        .map(|e| format!("\"{}\"", e))
        .collect();
    let cql = format!("text ~ ({})", terms.join(" OR "));
    search_confluence(client, &cql, limit)
        .await
        .unwrap_or_default()
}

pub async fn search_mod_docs(
    client: &AtlassianClient,
    query: &str,
    limit: u32,
) -> Vec<ConfluenceDoc> {
    let homepage_id = client.config.mod_docs_homepage_id().to_string();
    let cql = format!(
        "ancestor = {} AND text ~ \"{}\"",
        homepage_id,
        query.replace('"', "'")
    );
    search_confluence(client, &cql, limit)
        .await
        .unwrap_or_default()
}

pub async fn get_mod_page(
    client: &AtlassianClient,
    id: &str,
) -> Result<ConfluenceDoc, InvestigationError> {
    let resolved_id = if id.is_empty() {
        client.config.mod_docs_homepage_id()
    } else {
        id
    };
    get_confluence_content(client, resolved_id).await
}

fn urlencoded(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => '+'.to_string(),
            '"' => "%22".to_string(),
            '&' => "%26".to_string(),
            '=' => "%3D".to_string(),
            '+' => "%2B".to_string(),
            _ => c.to_string(),
        })
        .collect()
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}
