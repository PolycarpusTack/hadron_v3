use crate::atlassian::InvestigationConfig;
use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct KbIndex {
    #[serde(default)]
    topics: Vec<KbTopic>,
}

#[derive(Debug, Deserialize)]
struct KbTopic {
    title: String,
    #[serde(default)]
    chunks: Vec<String>,
}

pub async fn search_kb(config: &InvestigationConfig, query: &str) -> Vec<String> {
    let base_url = config.whatson_kb_url();
    let index_url = format!("{}/index.json", base_url.trim_end_matches('/'));

    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let index: KbIndex = match client.get(&index_url).send().await {
        Ok(resp) => match resp.json().await {
            Ok(idx) => idx,
            Err(_) => return vec![],
        },
        Err(_) => return vec![],
    };

    let query_tokens: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|t| t.len() >= 3)
        .map(String::from)
        .collect();

    if query_tokens.is_empty() {
        return vec![];
    }

    let mut scored: Vec<(usize, String)> = index
        .topics
        .iter()
        .filter_map(|topic| {
            let title_lower = topic.title.to_lowercase();
            let title_score = query_tokens
                .iter()
                .filter(|t| title_lower.contains(t.as_str()))
                .count();

            let chunk_score: usize = topic
                .chunks
                .iter()
                .map(|c| {
                    let cl = c.to_lowercase();
                    query_tokens
                        .iter()
                        .filter(|t| cl.contains(t.as_str()))
                        .count()
                })
                .sum();

            let total = title_score * 2 + chunk_score;
            if total == 0 {
                return None;
            }

            let excerpt = topic.chunks.first().map(|c| c.as_str()).unwrap_or("");
            Some((total, format!("{}: {}", topic.title, excerpt)))
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(5).map(|(_, s)| s).collect()
}
