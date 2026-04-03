/**
 * useProgressStream — React hook for streaming structured progress events via SSE.
 *
 * Uses fetch() + ReadableStream (not EventSource) so we can POST with auth headers.
 * Parses SSE `data:` lines into ProgressEvent objects.
 *
 * Key differences from useAiStream:
 * - No content accumulation (progress events, not tokens)
 * - Tracks progress (0-100), phase, and message
 * - completedData holds the final "complete" event (which carries releaseNoteId)
 */

import { useState, useRef, useCallback } from 'react';
import { acquireToken } from '../auth/msal';

const DEV_MODE = import.meta.env.VITE_AUTH_MODE === 'dev';
const API_BASE = '/api';

export interface ProgressEvent {
  phase: string;
  progress: number;
  message: string;
  ticketCount?: number;
  releaseNoteId?: number;
}

interface UseProgressStreamReturn {
  startStream: (path: string, body: object) => void;
  progress: number;
  phase: string;
  message: string;
  isStreaming: boolean;
  error: string | null;
  completedData: ProgressEvent | null;
  reset: () => void;
}

export function useProgressStream(): UseProgressStreamReturn {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedData, setCompletedData] = useState<ProgressEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(0);
    setPhase('');
    setMessage('');
    setIsStreaming(false);
    setError(null);
    setCompletedData(null);
  }, []);

  const startStream = useCallback(async (path: string, body: object) => {
    // Abort any in-flight request
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setProgress(0);
    setPhase('');
    setMessage('');
    setIsStreaming(true);
    setError(null);
    setCompletedData(null);

    try {
      const token = DEV_MODE ? 'dev' : await acquireToken();

      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
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
        setError('No response body');
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event: ProgressEvent = JSON.parse(data);

              setProgress(event.progress);
              setPhase(event.phase);
              setMessage(event.message);

              if (event.phase === 'complete') {
                setCompletedData(event);
                setIsStreaming(false);
              } else if (event.phase === 'error' || event.phase === 'failed') {
                setError(event.message || 'Generation failed');
                setIsStreaming(false);
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      // Stream ended without explicit complete/error event
      setIsStreaming(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — not an error
        setIsStreaming(false);
        return;
      }
      setError(err instanceof Error ? err.message : 'Stream failed');
      setIsStreaming(false);
    }
  }, []);

  return { startStream, progress, phase, message, isStreaming, error, completedData, reset };
}
