import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ChatMessage,
  ChatSession,
} from "../../services/api";
import { useToast } from "../Toast";
import { ToolResultCard } from "./ToolResultCard";

interface ChatViewProps {
  apiKey: string;
  model: string;
  provider: string;
}

export function ChatView({ apiKey, model, provider }: ChatViewProps) {
  const toast = useToast();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [toolActivity, setToolActivity] = useState<{
    name: string;
    result?: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load sessions
  useEffect(() => {
    api
      .getChatSessions()
      .then(setSessions)
      .catch((e) =>
        toast.error(
          e instanceof Error ? e.message : "Failed to load sessions",
        ),
      );
  }, []);

  // Load messages when session changes
  useEffect(() => {
    if (activeSessionId) {
      api
        .getChatMessages(activeSessionId)
        .then(setMessages)
        .catch((e) =>
          toast.error(
            e instanceof Error ? e.message : "Failed to load messages",
          ),
        );
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Please configure an API key in Settings." },
      ]);
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setStreamContent("");
    setToolActivity(null);

    try {
      let fullResponse = "";
      const allMessages = [...messages, userMsg];

      for await (const event of api.chatStream(allMessages, {
        sessionId: activeSessionId || undefined,
        model,
        provider,
        apiKey,
      })) {
        switch (event.type) {
          case "token":
            if (event.content) {
              fullResponse += event.content;
              setStreamContent(fullResponse);
            }
            break;
          case "toolUse":
            setToolActivity({
              name: event.toolName || "unknown",
            });
            break;
          case "toolResult":
            setToolActivity({
              name: event.toolName || "unknown",
              result: event.content,
            });
            break;
          case "done":
            if (event.sessionId && !activeSessionId) {
              setActiveSessionId(event.sessionId);
              api
                .getChatSessions()
                .then(setSessions)
                .catch(() => {});
            }
            break;
          case "error":
            fullResponse = `Error: ${event.message || "Unknown error"}`;
            break;
        }
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fullResponse },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${msg}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
      setStreamContent("");
    }
  }, [input, isStreaming, messages, activeSessionId, apiKey, model, provider]);

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
  };

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* Sessions sidebar */}
      <div className="w-64 shrink-0 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-700 p-3">
          <span className="text-sm font-medium text-slate-300">Sessions</span>
          <button
            onClick={handleNewChat}
            className="rounded-md px-2 py-1 text-xs text-blue-400 hover:bg-slate-700"
          >
            + New
          </button>
        </div>
        <div className="space-y-0.5 p-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                activeSessionId === s.id
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              <div className="truncate">{s.title}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {new Date(s.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-500">
              No conversations yet
            </p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col rounded-lg border border-slate-700 bg-slate-800">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <h3 className="mb-1 text-lg font-medium text-slate-300">
                  Ask Hadron
                </h3>
                <p className="text-sm text-slate-500">
                  Ask about crash logs, debugging, or WHATS'ON issues
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-200"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {/* Streaming message */}
            {isStreaming && streamContent && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-slate-700 px-4 py-2.5 text-sm text-slate-200">
                  <div className="whitespace-pre-wrap">{streamContent}</div>
                  <span className="inline-block h-4 w-1 animate-pulse bg-blue-400" />
                </div>
              </div>
            )}

            {/* Tool activity indicator */}
            {isStreaming && toolActivity && (
              <div className="flex justify-start">
                <div className="max-w-[80%]">
                  {toolActivity.result ? (
                    <ToolResultCard
                      toolName={toolActivity.name}
                      content={toolActivity.result}
                    />
                  ) : (
                    <div className="rounded-lg bg-slate-700 px-4 py-2.5 text-sm text-blue-400">
                      Searching: {toolActivity.name}...
                    </div>
                  )}
                </div>
              </div>
            )}

            {isStreaming && !streamContent && !toolActivity && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-slate-700 px-4 py-2.5 text-sm text-slate-400">
                  Thinking...
                </div>
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-700 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Hadron..."
              disabled={isStreaming}
              className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
