/**
 * useAiStream — shared React hook for streaming AI responses via SSE.
 *
 * Uses fetch() + ReadableStream (not EventSource) so we can POST with auth headers.
 * Parses SSE `data:` lines into ChatStreamEvent objects.
 */

import { useCallback, useRef, useState } from "react";
import { acquireToken } from "../auth/msal";

const DEV_MODE = import.meta.env.VITE_AUTH_MODE === "dev";
const API_BASE = "/api";

export interface ChatStreamEvent {
  type: "token" | "toolUse" | "toolResult" | "done" | "error";
  content?: string;
  toolName?: string;
  args?: string;
  sessionId?: string;
  message?: string;
}

export interface UseAiStreamReturn {
  /** Start streaming from the given API path with the given request body. */
  streamAi: (path: string, body: object) => void;
  /** Accumulated text content from token events. */
  content: string;
  /** Whether we are currently receiving tokens. */
  isStreaming: boolean;
  /** Error message if the stream failed. */
  error: string | null;
  /** Raw stream events (all types, not just tokens). */
  events: ChatStreamEvent[];
  /** Reset state for a new request. */
  reset: () => void;
}

export function useAiStream(): UseAiStreamReturn {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatStreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setContent("");
    setIsStreaming(false);
    setError(null);
    setEvents([]);
  }, []);

  const streamAi = useCallback(
    async (path: string, body: object) => {
      // Abort any in-flight request
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      setContent("");
      setIsStreaming(true);
      setError(null);
      setEvents([]);

      try {
        const token = DEV_MODE ? "dev" : await acquireToken();

        const response = await fetch(`${API_BASE}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({
            error: `HTTP ${response.status}`,
          }));
          setError(err.error || `HTTP ${response.status}`);
          setIsStreaming(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError("No response body");
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const event: ChatStreamEvent = JSON.parse(data);
                setEvents((prev) => [...prev, event]);

                switch (event.type) {
                  case "token":
                    if (event.content) {
                      setContent((prev) => prev + event.content);
                    }
                    break;
                  case "done":
                    setIsStreaming(false);
                    break;
                  case "error":
                    setError(event.message || "Stream error");
                    setIsStreaming(false);
                    break;
                }
              } catch {
                // Skip malformed events
              }
            }
          }
        }

        // Stream ended without explicit done event
        setIsStreaming(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled — not an error
          setIsStreaming(false);
          return;
        }
        setError(err instanceof Error ? err.message : "Stream failed");
        setIsStreaming(false);
      }
    },
    [],
  );

  return { streamAi, content, isStreaming, error, events, reset };
}
