//! Server-Sent Events for streaming chat and long-running operations.

use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use hadron_core::models::ChatStreamEvent;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// Create an SSE response from a channel receiver.
///
/// The caller spawns a task that sends `ChatStreamEvent` into the `tx` side.
/// This function wraps the `rx` side into an Axum SSE response.
pub fn chat_stream_response(
    rx: mpsc::Receiver<ChatStreamEvent>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().data(data))
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

// Re-export for convenience
use futures::StreamExt;
