//! Citation Extraction, Validation & Post-Processing
//!
//! Extracts inline citations from LLM responses (e.g., [Analysis #42], [KB: Title])
//! and validates them against tool results.
//!
//! Also provides Michel-style grounded synthesis helpers:
//! - `restructure_tool_results_as_xml` — wraps tool results in `<source>` XML
//! - `postprocess_citations` — converts bare `[url]` citations into `[[n]](url)` + reference footer

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;

use crate::chat_tools::ToolResult;

// ============================================================================
// Constants
// ============================================================================

/// Citation format instructions to append to the system prompt (agent loop phase).
pub const CITATION_INSTRUCTIONS: &str = "\n\n## Citation Format\n\
    When tool results contain markdown links like [Text](url), copy them exactly into your response. \
    Do not strip the URL portion. Every factual claim MUST cite its source using one of these formats:\n\
    - Analysis references: [Analysis #42](hadron://analysis/42)\n\
    - Knowledge Base docs: [KB: Page Title](url)\n\
    - Release notes: [RN: vX.Y Title](url)\n\
    - JIRA tickets: [KEY-123](url)\n\
    Place citations inline, immediately after the claim they support.";

/// Strict grounding rules injected into the final synthesis prompt when XML sources are present.
pub const ANSWER_GENERATION_RULES: &str = "\n\n## Answer Generation Rules\n\
    1. **Relevance check**: Not all retrieved sources may be relevant. Before generating an answer, \
       evaluate the relevance of each `<documentation>` extract and each `<source>` block — only use \
       those that directly address the query. Do not mention that you are checking relevance.\n\
    2. **Grounding**: Base your response ONLY on information present in the retrieved sources. \
       Do NOT add facts not present in the sources. Do not make up information.\n\
    3. **Inline citations**: For EVERY factual claim, append the source URL in square brackets \
       immediately after the claim, e.g.:\n\
       - \"The crash was caused by a nil receiver [hadron://analysis/42]\"\n\
       - \"The scheduling engine handles conflicts via priority queues [https://kb.example.com/scheduling]\"\n\
       - \"This was fixed in WON-1234 [https://jira.example.com/browse/WON-1234]\"\n\
    4. **Structured answer format**: When the retrieved sources contain both BASE documentation/release \
       notes AND customer-specific release notes:\n\
       - First, summarize all relevant information from the BASE documentation and BASE release notes.\n\
       - Then, add a separate subsection with the format `#### [Customer Name]` summarizing any \
         customer-specific findings from the customer release notes.\n\
       - If no customer-specific documentation was found, explicitly state: \
         \"No customer-specific documentation was available for [customer].\"\n\
    5. **Unsupported claims**: If sources don't answer part of the question, say so. Never fabricate.\n\
    6. **Format**: Use markdown. Structure with headers, bullets, tables where appropriate.\n\
    7. **Detail**: Give the most detailed answer possible based on the retrieved sources and provide \
       any additional relevant information found in the documentation extracts.";

/// Safety cap for XML source injection (~50K chars).
/// Increased from 30K to accommodate separate base + customer RN sources.
const XML_SOURCE_MAX_CHARS: usize = 50_000;

// ============================================================================
// Regexes
// ============================================================================

// Match both plain [Analysis #42] and linked [Analysis #42](url) forms
static ANALYSIS_CITE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[Analysis #(\d+)\](?:\([^)]*\))?").expect("ANALYSIS_CITE_RE"));
static KB_CITE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[KB:\s*([^\]]+)\](?:\([^)]*\))?").expect("KB_CITE_RE"));
static RN_CITE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[RN:\s*([^\]]+)\](?:\([^)]*\))?").expect("RN_CITE_RE"));
static JIRA_CITE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[(?:JIRA:\s*)?([A-Z]+-\d+)\](?:\([^)]*\))?").expect("JIRA_CITE_RE"));

/// Match [url] citations (both bare and markdown-linked).
/// Captures hadron:// and http(s):// URLs inside square brackets.
/// To distinguish bare `[url]` from markdown `[url](...)`, callers
/// must check whether `(` follows at the match end position.
static URL_CITE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[((hadron://[^\]]+)|(https?://[^\]]+))\]").expect("URL_CITE_RE"));

/// Match markdown links [text](url) to build url->title map.
static MD_LINK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[([^\]]+)\]\(((hadron://[^)]+)|(https?://[^)]+))\)").expect("MD_LINK_RE"));

// ============================================================================
// Original Citation Types (unchanged)
// ============================================================================

/// A citation found in LLM output.
#[derive(Debug, Clone, Serialize)]
pub struct Citation {
    /// The full citation text (e.g., "[Analysis #42]")
    pub raw: String,
    /// Citation type
    pub citation_type: CitationType,
    /// The referenced identifier
    pub reference: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum CitationType {
    Analysis,
    KnowledgeBase,
    ReleaseNote,
    Jira,
}

/// A citation that could not be validated against tool results.
#[derive(Debug, Clone, Serialize)]
pub struct InvalidCitation {
    pub citation: Citation,
    pub reason: String,
}

// ============================================================================
// New Post-Processing Types
// ============================================================================

/// A numbered reference produced by postprocess_citations.
#[derive(Debug, Clone, Serialize)]
pub struct NumberedReference {
    pub index: usize,
    pub url: String,
    pub title: String,
}

/// Result of postprocess_citations: transformed content + reference list.
#[derive(Debug, Clone, Serialize)]
pub struct PostProcessedContent {
    pub content: String,
    pub references: Vec<NumberedReference>,
}

// ============================================================================
// Original Functions (unchanged)
// ============================================================================

/// Extract all inline citations from an LLM response text.
pub fn extract_citations(text: &str) -> Vec<Citation> {
    let mut citations = Vec::new();

    for cap in ANALYSIS_CITE_RE.captures_iter(text) {
        citations.push(Citation {
            raw: cap[0].to_string(),
            citation_type: CitationType::Analysis,
            reference: cap[1].to_string(),
        });
    }

    for cap in KB_CITE_RE.captures_iter(text) {
        citations.push(Citation {
            raw: cap[0].to_string(),
            citation_type: CitationType::KnowledgeBase,
            reference: cap[1].trim().to_string(),
        });
    }

    for cap in RN_CITE_RE.captures_iter(text) {
        citations.push(Citation {
            raw: cap[0].to_string(),
            citation_type: CitationType::ReleaseNote,
            reference: cap[1].trim().to_string(),
        });
    }

    for cap in JIRA_CITE_RE.captures_iter(text) {
        citations.push(Citation {
            raw: cap[0].to_string(),
            citation_type: CitationType::Jira,
            reference: cap[1].to_string(),
        });
    }

    citations
}

/// Validate citations against the tool results that were returned during the session.
///
/// Returns a list of invalid citations (referenced but not found in tool output).
pub fn validate_citations(
    citations: &[Citation],
    tool_results: &[ToolResult],
) -> Vec<InvalidCitation> {
    let combined_output: String = tool_results
        .iter()
        .filter(|r| !r.is_error)
        .map(|r| r.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    citations
        .iter()
        .filter_map(|cite| {
            let found = match cite.citation_type {
                CitationType::Analysis => {
                    combined_output.contains(&format!("Analysis #{}", cite.reference))
                }
                CitationType::KnowledgeBase => {
                    combined_output.contains(&cite.reference)
                }
                CitationType::ReleaseNote => {
                    combined_output.contains(&cite.reference)
                }
                CitationType::Jira => {
                    combined_output.contains(&cite.reference)
                }
            };

            if found {
                None
            } else {
                Some(InvalidCitation {
                    citation: cite.clone(),
                    reason: format!(
                        "Citation {} not found in tool results",
                        cite.raw
                    ),
                })
            }
        })
        .collect()
}

// ============================================================================
// New Functions: XML Source Injection
// ============================================================================

/// Wrap each non-error, non-empty tool result in `<source>` XML tags for injection
/// into the final synthesis system prompt.
///
/// Returns a formatted string starting with `"\n\n## Retrieved Sources\n"`, or an
/// empty string if no useful results exist.
pub fn restructure_tool_results_as_xml(
    tool_results: &[ToolResult],
    tool_names: &[String],
) -> String {
    let mut xml = String::new();
    let mut total_len = 0usize;

    for (i, result) in tool_results.iter().enumerate() {
        if result.is_error {
            continue;
        }

        let content = &result.content;

        // Skip empty / "no results" responses (reuse evidence_gate patterns)
        if content.contains("No analyses found")
            || content.contains("No Knowledge Base documents found")
            || content.contains("No similar crashes found")
            || content.contains("No JIRA issues found")
            || content.contains("No crash signatures found")
            || content.contains("No data for the last")
            || content.contains("No error patterns found")
            || content.contains("No signature found")
            || content.trim().is_empty()
        {
            continue;
        }

        let tool_name = tool_names.get(i).map(|s| s.as_str()).unwrap_or("unknown");

        let source_block = format!(
            "<source tool=\"{}\">\n<content>\n{}\n</content>\n</source>\n\n",
            tool_name, content
        );

        // Safety cap: don't exceed ~30K chars
        if total_len + source_block.len() > XML_SOURCE_MAX_CHARS {
            xml.push_str("<source tool=\"_truncated\">\n<content>\n[Additional sources truncated to fit context window]\n</content>\n</source>\n");
            break;
        }

        total_len += source_block.len();
        xml.push_str(&source_block);
    }

    if xml.is_empty() {
        String::new()
    } else {
        format!("\n\n## Retrieved Sources\n{}", xml)
    }
}

// ============================================================================
// Dual Synthesis: Partitioned XML Sources
// ============================================================================

/// Check if a tool result content is effectively empty / "no results".
fn is_empty_tool_result(content: &str) -> bool {
    content.contains("No analyses found")
        || content.contains("No Knowledge Base documents found")
        || content.contains("No similar crashes found")
        || content.contains("No JIRA issues found")
        || content.contains("No crash signatures found")
        || content.contains("No data for the last")
        || content.contains("No error patterns found")
        || content.contains("No signature found")
        || content.trim().is_empty()
}

/// Build partitioned XML sources for dual synthesis (base vs customer).
///
/// Splits `search_kb` tool results at the `### Customer-Specific Release Notes` marker.
/// Non-KB tool results (analyses, JIRA, etc.) go to the base set only.
///
/// Returns `(base_xml, customer_xml)` — each either a formatted XML block or empty string.
pub fn build_partitioned_xml_sources(
    tool_results: &[ToolResult],
    tool_names: &[String],
) -> (String, String) {
    let mut base_xml = String::new();
    let mut customer_xml = String::new();
    let mut base_len = 0usize;
    let mut customer_len = 0usize;

    for (i, result) in tool_results.iter().enumerate() {
        if result.is_error {
            continue;
        }

        let content = &result.content;
        if is_empty_tool_result(content) {
            continue;
        }

        let tool_name = tool_names.get(i).map(|s| s.as_str()).unwrap_or("unknown");

        if tool_name == "search_kb" {
            // Split KB results at the customer marker
            let customer_marker = "### Customer-Specific Release Notes";
            if let Some(pos) = content.find(customer_marker) {
                let base_part = content[..pos].trim_end();
                let customer_part = &content[pos..];

                if !base_part.is_empty() {
                    let block = format!(
                        "<source tool=\"search_kb\" scope=\"base\">\n<content>\n{}\n</content>\n</source>\n\n",
                        base_part
                    );
                    if base_len + block.len() <= XML_SOURCE_MAX_CHARS {
                        base_len += block.len();
                        base_xml.push_str(&block);
                    }
                }

                if !customer_part.is_empty() {
                    let block = format!(
                        "<source tool=\"search_kb\" scope=\"customer\">\n<content>\n{}\n</content>\n</source>\n\n",
                        customer_part
                    );
                    if customer_len + block.len() <= XML_SOURCE_MAX_CHARS {
                        customer_len += block.len();
                        customer_xml.push_str(&block);
                    }
                }
            } else {
                // No customer section in this KB result — all base
                let block = format!(
                    "<source tool=\"search_kb\" scope=\"base\">\n<content>\n{}\n</content>\n</source>\n\n",
                    content
                );
                if base_len + block.len() <= XML_SOURCE_MAX_CHARS {
                    base_len += block.len();
                    base_xml.push_str(&block);
                }
            }
        } else {
            // Non-KB tool results go to base set (analyses, JIRA, signatures, etc.)
            let block = format!(
                "<source tool=\"{}\">\n<content>\n{}\n</content>\n</source>\n\n",
                tool_name, content
            );
            if base_len + block.len() <= XML_SOURCE_MAX_CHARS {
                base_len += block.len();
                base_xml.push_str(&block);
            }
        }
    }

    let base = if base_xml.is_empty() {
        String::new()
    } else {
        format!("\n\n## Retrieved Sources (BASE)\n{}", base_xml)
    };

    let customer = if customer_xml.is_empty() {
        String::new()
    } else {
        format!(
            "\n\n## Retrieved Sources (Customer-Specific)\n{}",
            customer_xml
        )
    };

    (base, customer)
}

// ============================================================================
// New Functions: URL Title Map
// ============================================================================

/// Scan tool results for markdown links `[text](url)` and return a map of url -> title text.
pub fn build_url_title_map(tool_results: &[ToolResult]) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for result in tool_results {
        if result.is_error {
            continue;
        }
        for cap in MD_LINK_RE.captures_iter(&result.content) {
            let title = cap[1].to_string();
            let url = cap[2].to_string();
            // First occurrence wins (don't overwrite with later, potentially less specific titles)
            map.entry(url).or_insert(title);
        }
    }

    map
}

// ============================================================================
// New Functions: Citation Post-Processing
// ============================================================================

/// Check if a `[url]` match at a given position is bare (not followed by `(`).
fn is_bare_url_cite(content: &str, match_end: usize) -> bool {
    content.as_bytes().get(match_end).copied() != Some(b'(')
}

/// Michel-style post-processing: convert bare `[url]` citations to `[[n]](url)` + reference footer.
///
/// - Finds all unique bare `[url]` citations (not already part of markdown links)
/// - Assigns sequential numbers
/// - Replaces `[url]` -> `[[n]](url)`
/// - Appends a reference footer with numbered entries
///
/// If no bare citations are found, returns content unchanged with empty references.
pub fn postprocess_citations(
    content: &str,
    url_title_map: &HashMap<String, String>,
) -> PostProcessedContent {
    // First pass: collect unique bare URLs in order of first appearance
    let mut seen_urls: Vec<String> = Vec::new();
    for m in URL_CITE_RE.captures_iter(content) {
        let full_match = m.get(0).unwrap();
        if !is_bare_url_cite(content, full_match.end()) {
            continue; // This is part of a markdown link [url](...), skip
        }
        let url = m[1].to_string();
        if !seen_urls.contains(&url) {
            seen_urls.push(url);
        }
    }

    if seen_urls.is_empty() {
        return PostProcessedContent {
            content: content.to_string(),
            references: Vec::new(),
        };
    }

    // Build numbered references
    let references: Vec<NumberedReference> = seen_urls
        .iter()
        .enumerate()
        .map(|(i, url)| {
            let title = url_title_map
                .get(url)
                .cloned()
                .unwrap_or_else(|| derive_title_from_url(url));
            NumberedReference {
                index: i + 1,
                url: url.clone(),
                title,
            }
        })
        .collect();

    // Build url -> index lookup for replacement
    let url_to_index: HashMap<&str, usize> = seen_urls
        .iter()
        .enumerate()
        .map(|(i, url)| (url.as_str(), i + 1))
        .collect();

    // Second pass: replace bare [url] with [[n]](url), working backwards to preserve offsets
    let mut output = content.to_string();
    let matches: Vec<_> = URL_CITE_RE
        .captures_iter(content)
        .filter_map(|caps| {
            let full = caps.get(0)?;
            if !is_bare_url_cite(content, full.end()) {
                return None; // Skip markdown links
            }
            let url = caps[1].to_string();
            let idx = *url_to_index.get(url.as_str())?;
            Some((full.start(), full.end(), url, idx))
        })
        .collect();

    // Replace in reverse order to preserve byte offsets
    for (start, end, url, idx) in matches.into_iter().rev() {
        let replacement = format!("[[{}]]({})", idx, url);
        output.replace_range(start..end, &replacement);
    }

    // Append reference footer
    output.push_str("\n\n---\n\n**References**\n\n");
    for r in &references {
        output.push_str(&format!("[{}] [{}]({})\n\n", r.index, r.title, r.url));
    }

    PostProcessedContent {
        content: output,
        references,
    }
}

/// Derive a human-readable title from a URL when no title is available from tool results.
pub fn derive_title_from_url(url: &str) -> String {
    // hadron://analysis/42 -> "Analysis #42"
    if let Some(rest) = url.strip_prefix("hadron://analysis/") {
        return format!("Analysis #{}", rest);
    }

    // hadron://other/path -> "Other: path"
    if let Some(rest) = url.strip_prefix("hadron://") {
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 {
            let category = parts[0];
            let id = parts[1];
            let cap = category
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default()
                + &category[1..];
            return format!("{}: {}", cap, id);
        }
    }

    // JIRA-style: https://jira.example.com/browse/WON-123 -> "WON-123"
    if url.contains("/browse/") {
        if let Some(key) = url.rsplit("/browse/").next() {
            let key = key.trim_end_matches('/');
            if !key.is_empty() {
                return key.to_string();
            }
        }
    }

    // Fallback: last meaningful path segment
    if let Some(path) = url.split('?').next() {
        let path = path.trim_end_matches('/');
        if let Some(segment) = path.rsplit('/').next() {
            if !segment.is_empty() && segment != "http:" && segment != "https:" {
                return segment.to_string();
            }
        }
    }

    url.to_string()
}

/// Extract all URLs from markdown links in a string. Returns `Vec<String>`.
pub fn extract_urls_from_markdown(text: &str) -> Vec<String> {
    MD_LINK_RE
        .captures_iter(text)
        .map(|cap| cap[2].to_string())
        .collect()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- Original tests (unchanged) ---

    #[test]
    fn test_extract_analysis_citations() {
        let text = "Based on [Analysis #42] and [Analysis #108], the root cause is...";
        let cites = extract_citations(text);
        assert_eq!(cites.len(), 2);
        assert_eq!(cites[0].reference, "42");
        assert_eq!(cites[1].reference, "108");
    }

    #[test]
    fn test_extract_kb_citations() {
        let text = "According to [KB: PSI Scheduling Configuration], the module...";
        let cites = extract_citations(text);
        assert_eq!(cites.len(), 1);
        assert_eq!(cites[0].citation_type, CitationType::KnowledgeBase);
        assert_eq!(cites[0].reference, "PSI Scheduling Configuration");
    }

    #[test]
    fn test_extract_mixed_citations() {
        let text = "See [Analysis #5], [KB: API Guide], [RN: v6.5 Hotfix], and [JIRA: WON-1234].";
        let cites = extract_citations(text);
        assert_eq!(cites.len(), 4);
    }

    #[test]
    fn test_extract_linked_citations() {
        let text = "See [Analysis #5](hadron://analysis/5), [KB: API Guide](https://example.com), and [WON-1234](https://jira.example.com/browse/WON-1234).";
        let cites = extract_citations(text);
        assert_eq!(cites.len(), 3);
        assert_eq!(cites[0].reference, "5");
        assert_eq!(cites[1].reference, "API Guide");
        assert_eq!(cites[2].reference, "WON-1234");
    }

    #[test]
    fn test_validate_citations_valid() {
        let cites = vec![Citation {
            raw: "[Analysis #42](hadron://analysis/42)".to_string(),
            citation_type: CitationType::Analysis,
            reference: "42".to_string(),
        }];
        let results = vec![ToolResult {
            tool_use_id: "t1".to_string(),
            content: "Found 1 analyses:\n\n**[Analysis #42](hadron://analysis/42)** — crash.log".to_string(),
            is_error: false,
        }];
        let invalid = validate_citations(&cites, &results);
        assert!(invalid.is_empty());
    }

    #[test]
    fn test_validate_citations_invalid() {
        let cites = vec![Citation {
            raw: "[Analysis #999](hadron://analysis/999)".to_string(),
            citation_type: CitationType::Analysis,
            reference: "999".to_string(),
        }];
        let results = vec![ToolResult {
            tool_use_id: "t1".to_string(),
            content: "Found 1 analyses:\n\n**[Analysis #42](hadron://analysis/42)** — crash.log".to_string(),
            is_error: false,
        }];
        let invalid = validate_citations(&cites, &results);
        assert_eq!(invalid.len(), 1);
    }

    #[test]
    fn test_no_citations() {
        let text = "The system crashed due to a memory leak.";
        let cites = extract_citations(text);
        assert!(cites.is_empty());
    }

    // --- New tests: restructure_tool_results_as_xml ---

    fn make_result(content: &str, is_error: bool) -> ToolResult {
        ToolResult {
            tool_use_id: "test".to_string(),
            content: content.to_string(),
            is_error,
        }
    }

    #[test]
    fn test_xml_sources_basic() {
        let results = vec![make_result(
            "Found 2 analyses:\n\n**[Analysis #42](hadron://analysis/42)** — crash.log\n**[Analysis #43](hadron://analysis/43)** — error.log",
            false,
        )];
        let names = vec!["search_analyses".to_string()];
        let xml = restructure_tool_results_as_xml(&results, &names);
        assert!(xml.contains("## Retrieved Sources"));
        assert!(xml.contains("<source tool=\"search_analyses\">"));
        assert!(xml.contains("Analysis #42"));
        assert!(xml.contains("</source>"));
    }

    #[test]
    fn test_xml_sources_skips_errors() {
        let results = vec![
            make_result("Error: connection refused", true),
            make_result("Found 1 analyses:\n\n**Analysis #10** — test.log", false),
        ];
        let names = vec!["search_kb".to_string(), "search_analyses".to_string()];
        let xml = restructure_tool_results_as_xml(&results, &names);
        assert!(!xml.contains("search_kb"));
        assert!(xml.contains("search_analyses"));
    }

    #[test]
    fn test_xml_sources_skips_no_results() {
        let results = vec![make_result("No analyses found matching the query.", false)];
        let names = vec!["search_analyses".to_string()];
        let xml = restructure_tool_results_as_xml(&results, &names);
        assert!(xml.is_empty());
    }

    #[test]
    fn test_xml_sources_empty() {
        let xml = restructure_tool_results_as_xml(&[], &[]);
        assert!(xml.is_empty());
    }

    #[test]
    fn test_xml_sources_truncation() {
        // Generate a result larger than XML_SOURCE_MAX_CHARS
        let big_content = "x".repeat(XML_SOURCE_MAX_CHARS + 1000);
        let results = vec![
            make_result(&big_content, false),
            make_result("This should be truncated", false),
        ];
        let names = vec!["tool_a".to_string(), "tool_b".to_string()];
        let xml = restructure_tool_results_as_xml(&results, &names);
        assert!(xml.contains("_truncated"));
    }

    // --- New tests: build_url_title_map ---

    #[test]
    fn test_url_title_map_basic() {
        let results = vec![make_result(
            "See [Analysis #42](hadron://analysis/42) and [KB: Scheduling](https://kb.example.com/scheduling)",
            false,
        )];
        let map = build_url_title_map(&results);
        assert_eq!(map.get("hadron://analysis/42"), Some(&"Analysis #42".to_string()));
        assert_eq!(map.get("https://kb.example.com/scheduling"), Some(&"KB: Scheduling".to_string()));
    }

    #[test]
    fn test_url_title_map_first_wins() {
        let results = vec![
            make_result("[Analysis #42](hadron://analysis/42)", false),
            make_result("[Crash Report 42](hadron://analysis/42)", false),
        ];
        let map = build_url_title_map(&results);
        assert_eq!(map.get("hadron://analysis/42"), Some(&"Analysis #42".to_string()));
    }

    #[test]
    fn test_url_title_map_skips_errors() {
        let results = vec![make_result("[Link](https://example.com)", true)];
        let map = build_url_title_map(&results);
        assert!(map.is_empty());
    }

    // --- New tests: derive_title_from_url ---

    #[test]
    fn test_derive_title_analysis() {
        assert_eq!(derive_title_from_url("hadron://analysis/42"), "Analysis #42");
    }

    #[test]
    fn test_derive_title_jira() {
        assert_eq!(
            derive_title_from_url("https://jira.example.com/browse/WON-123"),
            "WON-123"
        );
    }

    #[test]
    fn test_derive_title_kb_url() {
        assert_eq!(
            derive_title_from_url("https://kb.example.com/docs/scheduling"),
            "scheduling"
        );
    }

    #[test]
    fn test_derive_title_hadron_other() {
        assert_eq!(
            derive_title_from_url("hadron://kb/scheduling-guide"),
            "Kb: scheduling-guide"
        );
    }

    // --- New tests: postprocess_citations ---

    #[test]
    fn test_postprocess_basic() {
        let content = "The crash was caused by a nil receiver [hadron://analysis/42]. It was also seen in [hadron://analysis/43].";
        let map = HashMap::new();
        let result = postprocess_citations(content, &map);
        assert_eq!(result.references.len(), 2);
        assert!(result.content.contains("[[1]](hadron://analysis/42)"));
        assert!(result.content.contains("[[2]](hadron://analysis/43)"));
        assert!(result.content.contains("**References**"));
        assert!(result.content.contains("[1] [Analysis #42](hadron://analysis/42)"));
        assert!(result.content.contains("[2] [Analysis #43](hadron://analysis/43)"));
    }

    #[test]
    fn test_postprocess_with_title_map() {
        let content = "See [https://kb.example.com/scheduling] for details.";
        let mut map = HashMap::new();
        map.insert(
            "https://kb.example.com/scheduling".to_string(),
            "KB: Scheduling Configuration".to_string(),
        );
        let result = postprocess_citations(content, &map);
        assert_eq!(result.references.len(), 1);
        assert!(result.content.contains("[[1]](https://kb.example.com/scheduling)"));
        assert!(result.content.contains("[1] [KB: Scheduling Configuration](https://kb.example.com/scheduling)"));
    }

    #[test]
    fn test_postprocess_deduplication() {
        let content = "First [hadron://analysis/42] and again [hadron://analysis/42].";
        let map = HashMap::new();
        let result = postprocess_citations(content, &map);
        assert_eq!(result.references.len(), 1);
        // Both occurrences should get the same number
        assert_eq!(result.content.matches("[[1]]").count(), 2);
    }

    #[test]
    fn test_postprocess_skips_markdown_links() {
        // Content that has [text](url) should NOT be treated as bare [url] citation
        let content = "See [Analysis #42](hadron://analysis/42) for details.";
        let map = HashMap::new();
        let result = postprocess_citations(content, &map);
        // No bare citations found -> no references, content unchanged
        assert!(result.references.is_empty());
        assert_eq!(result.content, content);
    }

    #[test]
    fn test_postprocess_no_citations() {
        let content = "The system crashed due to a memory leak.";
        let map = HashMap::new();
        let result = postprocess_citations(content, &map);
        assert!(result.references.is_empty());
        assert_eq!(result.content, content);
    }

    #[test]
    fn test_postprocess_mixed_urls() {
        let content = "Analysis [hadron://analysis/42] and JIRA [https://jira.example.com/browse/WON-123].";
        let map = HashMap::new();
        let result = postprocess_citations(content, &map);
        assert_eq!(result.references.len(), 2);
        assert_eq!(result.references[0].title, "Analysis #42");
        assert_eq!(result.references[1].title, "WON-123");
    }

    // --- New tests: extract_urls_from_markdown ---

    #[test]
    fn test_extract_urls_basic() {
        let text = "See [Analysis #42](hadron://analysis/42) and [KB: Guide](https://kb.example.com/guide).";
        let urls = extract_urls_from_markdown(text);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0], "hadron://analysis/42");
        assert_eq!(urls[1], "https://kb.example.com/guide");
    }

    #[test]
    fn test_extract_urls_empty() {
        let urls = extract_urls_from_markdown("No links here.");
        assert!(urls.is_empty());
    }
}
