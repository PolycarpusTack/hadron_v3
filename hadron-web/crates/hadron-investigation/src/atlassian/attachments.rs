use crate::investigation::evidence::ExtractionStatus;

pub struct AttachmentExtractResult {
    pub text: Option<String>,
    pub status: ExtractionStatus,
}

pub async fn extract_attachment(
    _client: &super::AtlassianClient,
    _url: &str,
    _filename: &str,
) -> AttachmentExtractResult {
    AttachmentExtractResult {
        text: None,
        status: ExtractionStatus::Skipped,
    }
}
