use crate::atlassian::jira::IssueFullContext;
use crate::investigation::evidence::{Confidence, EvidenceClaim, EvidenceCategory, Hypothesis};
use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

/// Strip model-specific control tokens from JIRA/Confluence text that could
/// be used for prompt injection if the content is passed to an LLM.
pub fn sanitize_for_prompt(s: &str) -> String {
    const CONTROL_TOKENS: &[&str] = &[
        "<|endoftext|>", "<|im_start|>", "<|im_end|>",
        "[INST]", "[/INST]", "<<SYS>>", "<</SYS>>",
        "\u{0000}", "\u{E000}",
    ];
    let mut out = s.to_string();
    for token in CONTROL_TOKENS {
        out = out.replace(token, "");
    }
    out
}

static ENTITY_RE: OnceLock<Regex> = OnceLock::new();

fn entity_re() -> &'static Regex {
    ENTITY_RE.get_or_init(|| {
        Regex::new(r"\b([A-Z][A-Z0-9_]+-\d+|[A-Z]{2,}[A-Z0-9_]+)\b").unwrap()
    })
}

pub fn build_claims_from_issue(issue: &IssueFullContext) -> Vec<EvidenceClaim> {
    let mut claims = Vec::new();

    if !issue.description.is_empty() {
        let desc = sanitize_for_prompt(&issue.description);
        claims.push(EvidenceClaim {
            text: format!("Description: {}", truncate_claim(&desc, 400)),
            category: EvidenceCategory::ObservedBehavior,
            entities: extract_entities(&desc),
        });
    }

    for (key, summary, rel) in &issue.issue_links {
        if !key.is_empty() {
            claims.push(EvidenceClaim {
                text: format!("Linked issue {}: {} ({})", key, sanitize_for_prompt(summary), rel),
                category: EvidenceCategory::LinkedContext,
                entities: vec![key.clone()],
            });
        }
    }

    for link in &issue.remote_links {
        claims.push(EvidenceClaim {
            text: format!("Remote link: {}", sanitize_for_prompt(link)),
            category: EvidenceCategory::LinkedContext,
            entities: vec![],
        });
    }

    for comment in &issue.comments {
        let clean = sanitize_for_prompt(comment);
        claims.push(EvidenceClaim {
            text: truncate_claim(&clean, 300),
            category: EvidenceCategory::IssueComment,
            entities: extract_entities(&clean),
        });
    }

    for entry in &issue.changelog_entries {
        claims.push(EvidenceClaim {
            text: sanitize_for_prompt(entry),
            category: EvidenceCategory::LinkedContext,
            entities: vec![],
        });
    }

    claims
}

pub fn build_hypotheses(
    issue: &IssueFullContext,
    claims: &[EvidenceClaim],
    related_count: usize,
) -> (Vec<Hypothesis>, Vec<String>, Vec<String>) {
    let mut hypotheses = Vec::new();
    let mut open_questions = Vec::new();
    let mut next_checks = Vec::new();

    if related_count > 0 {
        let supporting: Vec<String> = claims
            .iter()
            .filter(|c| c.category == EvidenceCategory::HistoricalMatch)
            .take(3)
            .map(|c| truncate_claim(&c.text, 80))
            .collect();
        hypotheses.push(Hypothesis {
            text: format!(
                "This may be a regression of a previously seen issue ({} related found).",
                related_count
            ),
            confidence: if related_count >= 3 {
                Confidence::High
            } else {
                Confidence::Medium
            },
            supporting_claims: supporting,
        });
    }

    let all_text = format!(
        "{} {} {}",
        issue.description,
        issue.summary,
        issue.comments.join(" ")
    )
    .to_lowercase();

    if all_text.contains("null") || all_text.contains("nullpointer") || all_text.contains("npe") {
        hypotheses.push(Hypothesis {
            text: "A null pointer / uninitialized reference may be the root cause.".into(),
            confidence: Confidence::Medium,
            supporting_claims: vec!["Null/NPE keyword found in issue text".into()],
        });
        next_checks.push("Review stack trace for null dereference location.".into());
    }

    if all_text.contains("timeout") || all_text.contains("timed out") {
        hypotheses.push(Hypothesis {
            text: "A timeout may be causing the failure — check network or DB latency.".into(),
            confidence: Confidence::Medium,
            supporting_claims: vec!["Timeout keyword found in issue text".into()],
        });
        next_checks.push("Check infrastructure metrics around the reported time.".into());
    }

    if issue.assignee.is_none() {
        open_questions.push("Who is responsible for investigating this issue?".into());
    }
    if issue.fix_versions.is_empty() {
        open_questions.push("Which release version is targeted for the fix?".into());
    }
    if issue.components.is_empty() {
        open_questions.push("Which component or module is affected?".into());
    }
    if !issue.attachments.is_empty() {
        next_checks.push(format!(
            "Review {} attachment(s) for additional signals.",
            issue.attachments.len()
        ));
    }
    next_checks.push(
        "Verify the fix in the test environment with the exact steps to reproduce.".into(),
    );

    (hypotheses, open_questions, next_checks)
}

fn truncate_claim(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.len() <= max {
        return s.to_string();
    }
    let mut boundary = max;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}…", &s[..boundary])
}

fn extract_entities(text: &str) -> Vec<String> {
    entity_re()
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .take(10)
        .collect()
}
