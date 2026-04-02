//! Server-Sent Events for streaming AI responses and long-running operations.

use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use futures::StreamExt;
use hadron_core::models::ChatStreamEvent;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// Create an SSE response from a channel receiver.
///
/// The caller spawns a task that sends `ChatStreamEvent` into the `tx` side.
/// This function wraps the `rx` side into an Axum SSE response.
pub fn stream_response(
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

/// Convenience: spawn an AI streaming call and return the SSE response.
///
/// This eliminates the channel-setup boilerplate in every streaming route.
pub fn stream_ai_completion(
    config: hadron_core::ai::AiConfig,
    messages: Vec<hadron_core::ai::AiMessage>,
    system_prompt: Option<String>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = mpsc::channel::<ChatStreamEvent>(100);

    tokio::spawn(async move {
        let result = crate::ai::stream_completion(
            &config,
            messages,
            system_prompt.as_deref(),
            tx.clone(),
        )
        .await;

        match result {
            Ok(_) => {
                let _ = tx
                    .send(ChatStreamEvent::Done {
                        session_id: String::new(),
                    })
                    .await;
            }
            Err(e) => {
                let _ = tx
                    .send(ChatStreamEvent::Error {
                        message: e.client_message(),
                    })
                    .await;
            }
        }
    });

    stream_response(rx)
}
