use crate::investigation::evidence::ExtractionStatus;
use super::AtlassianClient;

const MAX_BYTES: usize = 8 * 1024; // 8 KB per extracted output
const ENTRY_HARD_CAP: u64 = 64 * 1024; // 64 KB max uncompressed read per entry (matches output budget)
const MAX_ZIP_ENTRIES: usize = 512; // guard against archives with millions of entries

pub struct AttachmentExtractResult {
    pub text: Option<String>,
    pub status: ExtractionStatus,
}

pub async fn extract_attachment(
    client: &AtlassianClient,
    url: &str,
    filename: &str,
) -> AttachmentExtractResult {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Skip images immediately — no bytes needed
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "tiff" | "webp" => {
            return AttachmentExtractResult {
                text: None,
                status: ExtractionStatus::Skipped,
            };
        }
        _ => {}
    }

    let bytes = match client.jira_get_bytes(url).await {
        Ok(b) => b,
        Err(e) => {
            return AttachmentExtractResult {
                text: None,
                status: ExtractionStatus::Failed(e.to_string()),
            };
        }
    };

    let (text, status) = match ext.as_str() {
        "txt" | "log" | "json" | "xml" | "csv" | "yaml" | "yml" | "md" | "toml" => {
            extract_text_utf8(&bytes)
        }
        "html" | "htm" => extract_html(&bytes),
        "zip" => extract_zip(&bytes),
        "docx" => extract_docx(&bytes),
        "pdf" => extract_pdf(&bytes),
        _ => (None, ExtractionStatus::Skipped),
    };

    AttachmentExtractResult { text, status }
}

fn truncate(s: String) -> String {
    if s.len() <= MAX_BYTES {
        return s;
    }
    let mut boundary = MAX_BYTES;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}… [truncated]", &s[..boundary])
}

fn extract_text_utf8(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let s = String::from_utf8_lossy(bytes).into_owned();
    (Some(truncate(s)), ExtractionStatus::Success)
}

fn extract_html(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let html = String::from_utf8_lossy(bytes);
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut in_script = false;
    let mut tag_buf = String::new();
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag_buf.clear();
            }
            '>' => {
                let tag_lower = tag_buf.trim().to_lowercase();
                if tag_lower.starts_with("script") {
                    in_script = true;
                } else if tag_lower.starts_with("/script") {
                    in_script = false;
                }
                in_tag = false;
            }
            _ if in_tag => tag_buf.push(ch),
            _ if !in_script => out.push(ch),
            _ => {}
        }
    }
    let collapsed: String = out.split_whitespace().collect::<Vec<_>>().join(" ");
    (Some(truncate(collapsed)), ExtractionStatus::Success)
}

fn extract_zip(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => return (None, ExtractionStatus::Failed(format!("zip open: {e}"))),
    };
    let mut parts: Vec<String> = Vec::new();
    let mut total = 0usize;
    let entry_count = archive.len().min(MAX_ZIP_ENTRIES);
    for i in 0..entry_count {
        if total >= MAX_BYTES {
            break;
        }
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_lowercase();
        let is_text = ["txt", "log", "json", "xml", "csv", "md", "yaml", "yml"]
            .iter()
            .any(|ext| name.ends_with(ext));
        if !is_text {
            continue;
        }
        use std::io::Read;
        let mut buf = Vec::new();
        if entry.by_ref().take(ENTRY_HARD_CAP).read_to_end(&mut buf).is_ok() {
            let s = String::from_utf8_lossy(&buf).to_string();
            total += s.len();
            parts.push(format!("=== {} ===\n{}", entry.name(), s));
        }
    }
    if parts.is_empty() {
        (None, ExtractionStatus::Skipped)
    } else {
        (Some(truncate(parts.join("\n"))), ExtractionStatus::Success)
    }
}

fn extract_docx(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => return (None, ExtractionStatus::Failed(format!("docx open: {e}"))),
    };
    let mut xml_content = String::new();
    match archive.by_name("word/document.xml") {
        Ok(mut entry) => {
            use std::io::Read;
            if entry.by_ref().take(ENTRY_HARD_CAP).read_to_string(&mut xml_content).is_err() {
                return (None, ExtractionStatus::Failed("docx read failed".into()));
            }
        }
        Err(_) => return (None, ExtractionStatus::Failed("word/document.xml not found".into())),
    }
    match roxmltree::Document::parse(&xml_content) {
        Ok(doc) => {
            let text: String = doc
                .descendants()
                .filter(|n| n.is_text())
                .map(|n| n.text().unwrap_or(""))
                .collect::<Vec<_>>()
                .join(" ");
            let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
            (Some(truncate(collapsed)), ExtractionStatus::Success)
        }
        Err(e) => (None, ExtractionStatus::Failed(format!("docx xml: {e}"))),
    }
}

fn extract_pdf(bytes: &[u8]) -> (Option<String>, ExtractionStatus) {
    match lopdf::Document::load_mem(bytes) {
        Ok(doc) => {
            let mut parts: Vec<String> = Vec::new();
            let pages: Vec<u32> = doc.get_pages().keys().cloned().collect();
            for page_num in pages {
                if let Ok(text) = doc.extract_text(&[page_num]) {
                    parts.push(text);
                }
            }
            if parts.is_empty() {
                (None, ExtractionStatus::Skipped)
            } else {
                (Some(truncate(parts.join("\n"))), ExtractionStatus::Success)
            }
        }
        Err(e) => (None, ExtractionStatus::Failed(format!("pdf: {e}"))),
    }
}
