/**
 * FloatingElena — floating action button (FAB) with expandable chat panel.
 *
 * Adapts the desktop Elena hover button for the web app.
 * - FAB: 48×48 circular button, bottom-right, draggable, breathing glow
 * - Right-click: quick-action menu (4 templates)
 * - Left-click: expand to 380×480 chat panel with streaming AI responses
 * - Ctrl/Cmd+Shift+H: toggle FAB visibility
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAiStream, ChatStreamEvent } from '../../hooks/useAiStream';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'fab' | 'panel' | 'menu';

interface Position {
  x: number;
  y: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface QuickAction {
  label: string;
  prompt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'hadron-elena-position';
const SESSION_KEY = 'hadron-elena-session';

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Explain this error',
    prompt: 'Please explain this error: [paste your error here]',
  },
  {
    label: 'Summarize for JIRA',
    prompt: 'Summarize this error for a JIRA ticket: [paste content]',
  },
  {
    label: 'Suggest a fix',
    prompt: 'Suggest a fix for this issue: [paste content]',
  },
  {
    label: 'Find similar issues',
    prompt: 'Search for similar issues to: [paste content]',
  },
];

function defaultPosition(): Position {
  return {
    x: window.innerWidth - 72,
    y: window.innerHeight - 72,
  };
}

function loadPosition(): Position {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Position;
      // Clamp to viewport in case the window was resized
      return {
        x: Math.min(Math.max(parsed.x, 24), window.innerWidth - 24),
        y: Math.min(Math.max(parsed.y, 24), window.innerHeight - 24),
      };
    }
  } catch {
    // ignore
  }
  return defaultPosition();
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ToolEventBadge({ event }: { event: ChatStreamEvent }) {
  if (event.type === 'toolUse') {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-900/50 text-amber-300 border border-amber-700/50">
        <span>⚙</span>
        <span>{event.toolName ?? 'tool'}</span>
      </span>
    );
  }
  if (event.type === 'toolResult') {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-blue-900/50 text-blue-300 border border-blue-700/50">
        <span>✓</span>
        <span>result</span>
      </span>
    );
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function FloatingElena() {
  const [mode, setMode] = useState<Mode>('fab');
  const [visible, setVisible] = useState(true);
  const [position, setPosition] = useState<Position>(loadPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(
    () => sessionStorage.getItem(SESSION_KEY),
  );

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevIsStreaming = useRef(false);

  const { streamAi, content, isStreaming, error, events, reset } = useAiStream();

  // ── Keyboard shortcut ────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (modKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Auto-scroll messages ──────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, content]);

  // ── Append assistant message on stream completion ─────────────────────────────

  useEffect(() => {
    const wasStreaming = prevIsStreaming.current;
    prevIsStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming && content) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content },
      ]);
      reset();
    }
  }, [isStreaming, content, reset]);

  // ── Persist session id from done events ──────────────────────────────────────

  useEffect(() => {
    const doneEvent = events.find((e) => e.type === 'done' && e.sessionId);
    if (doneEvent?.sessionId && doneEvent.sessionId !== sessionId) {
      setSessionId(doneEvent.sessionId);
      sessionStorage.setItem(SESSION_KEY, doneEvent.sessionId);
    }
  }, [events, sessionId]);

  // ── Drag handlers ─────────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) return; // right-click handled separately
    didDrag.current = false;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragStart.current) return;
    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;
    // Mark as dragged if moved more than 4px
    if (Math.abs(newX - position.x) > 4 || Math.abs(newY - position.y) > 4) {
      didDrag.current = true;
    }
    setPosition({ x: newX, y: newY });
  }, [isDragging, position]);

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
      dragStart.current = null;
    }
  }, [isDragging, position]);

  // ── FAB click ────────────────────────────────────────────────────────────────

  const handleFabClick = useCallback(() => {
    if (didDrag.current) return; // was a drag, not a click
    setMode('panel');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // ── Context menu ────────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMode('menu');
  }, []);

  const handleQuickAction = useCallback((action: QuickAction) => {
    setInputText(action.prompt);
    setMode('panel');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const newMessage: Message = { role: 'user', content: trimmed };
    const nextMessages = [...messages, newMessage];
    setMessages(nextMessages);
    setInputText('');

    streamAi('/chat', {
      messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
      session_id: sessionId,
    });
  }, [messages, isStreaming, sessionId, streamAi]);

  const handleSend = useCallback(() => {
    sendMessage(inputText);
  }, [inputText, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  }, [inputText, sendMessage]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!visible) return null;

  // Panel expands upward from FAB position
  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x - 380 + 48, window.innerWidth - 388),
    top: Math.max(position.y - 480 - 8, 8),
    zIndex: 9999,
    width: 380,
    height: 480,
  };

  const fabStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x - 24,
    top: position.y - 24,
    zIndex: 10000,
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
    touchAction: 'none',
  };

  // Collect tool events (toolUse/toolResult) that happened during streaming
  const toolEvents = events.filter(
    (ev) => ev.type === 'toolUse' || ev.type === 'toolResult',
  );

  return (
    <>
      {/* Quick actions menu */}
      {mode === 'menu' && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setMode('fab')}
          />
          <div
            className="fixed z-[9999] w-48 rounded-lg border border-slate-600 bg-slate-800 py-1 shadow-xl"
            style={{
              left: Math.min(position.x - 24, window.innerWidth - 196),
              top: position.y - 24 - 8 - (QUICK_ACTIONS.length * 36 + 8),
            }}
          >
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action)}
                className="w-full px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-slate-700"
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Chat panel */}
      {mode === 'panel' && (
        <div
          style={panelStyle}
          className="flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <span>❄️</span>
              <span>Hadron Quick</span>
            </span>
            <button
              onClick={() => setMode('fab')}
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              title="Minimize"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
            {messages.length === 0 && !isStreaming && (
              <p className="text-center text-xs text-slate-500 mt-8">
                Ask anything — right-click the button for quick templates.
              </p>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-800 text-slate-100'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Streaming response */}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-sm leading-relaxed text-slate-100">
                  {toolEvents.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {toolEvents.map((ev, i) => (
                        <ToolEventBadge key={i} event={ev} />
                      ))}
                    </div>
                  )}
                  {content || (
                    <span className="inline-flex gap-1 text-slate-500">
                      <span className="animate-pulse">·</span>
                      <span className="animate-pulse delay-75">·</span>
                      <span className="animate-pulse delay-150">·</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-red-900/40 border border-red-700/50 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-slate-700 p-2">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask something… (Enter to send)"
                disabled={isStreaming}
                className="flex-1 resize-none rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || !inputText.trim()}
                className="self-end rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isStreaming ? (
                  <svg
                    className="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <div
        style={fabStyle}
        className="relative"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleFabClick}
        onContextMenu={handleContextMenu}
      >
        <button
          className="elena-fab relative flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-2xl border border-emerald-600/40 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          tabIndex={0}
          aria-label="Open Hadron Quick Chat"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMode('panel');
            }
          }}
        >
          ❄️
        </button>
      </div>
    </>
  );
}
