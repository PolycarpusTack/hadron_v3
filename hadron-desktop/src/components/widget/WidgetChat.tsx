import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Loader2, Square } from "lucide-react";
import {
  sendChatMessage,
  cancelChat,
  subscribeToChatStream,
  subscribeToChatFinalContent,
  createRequestId,
  createMessageId,
  type ChatMessage,
  type ChatStreamEvent,
} from "../../services/chat";
import WidgetDropZone from "./WidgetDropZone";

interface WidgetChatProps {
  initialMessage?: string | null;
  onInitialMessageConsumed?: () => void;
  initialInput?: string | null;
  onInitialInputConsumed?: () => void;
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

export default function WidgetChat({ initialMessage, onInitialMessageConsumed, initialInput, onInitialInputConsumed, onMessagesChange }: WidgetChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const isLoadingRef = useRef(false);
  const streamingRef = useRef("");
  const [displayContent, setDisplayContent] = useState("");
  const rafRef = useRef<number | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const unsubStreamRef = useRef<(() => void) | null>(null);
  const unsubFinalRef = useRef<(() => void) | null>(null);
  const scanningRef = useRef(false);
  const initialMessageHandledRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep messagesRef in sync with state and notify parent
  useEffect(() => {
    messagesRef.current = messages;
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Cleanup listeners and rAF on unmount
  useEffect(() => {
    return () => {
      unsubStreamRef.current?.();
      unsubFinalRef.current?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!text || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    streamingRef.current = "";
    setDisplayContent("");

    const reqId = createRequestId();
    requestIdRef.current = reqId;

    // Subscribe to streaming tokens and final content in parallel
    let accumulated = "";
    let finalContent: string | null = null;
    const [unsubStream, unsubFinal] = await Promise.all([
      subscribeToChatStream((event: ChatStreamEvent) => {
        if (event.error) {
          streamingRef.current = `Error: ${event.error}`;
          setDisplayContent(streamingRef.current);
          return;
        }
        accumulated += event.token;
        streamingRef.current = accumulated;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            setDisplayContent(streamingRef.current);
            rafRef.current = null;
          });
        }
      }, reqId),
      subscribeToChatFinalContent((event) => {
        finalContent = event.content;
      }, reqId),
    ]);
    unsubStreamRef.current = unsubStream;
    unsubFinalRef.current = unsubFinal;

    try {
      await sendChatMessage([...messagesRef.current, userMsg], {
        useRag: true,
        useKb: false,
        requestId: reqId,
        verbosity: "concise",
      });

      const assistantMsg: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: finalContent || accumulated,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: `Sorry, something went wrong: ${String(e)}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
      streamingRef.current = "";
      setDisplayContent("");
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      requestIdRef.current = null;
      unsubStream();
      unsubStreamRef.current = null;
      unsubFinal();
      unsubFinalRef.current = null;
    }
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (text) sendText(text);
  }, [input, sendText]);

  // When an initialMessage arrives (e.g. from clipboard watcher), auto-send it
  useEffect(() => {
    if (initialMessage && initialMessage !== initialMessageHandledRef.current) {
      initialMessageHandledRef.current = initialMessage;
      sendText(initialMessage);
      onInitialMessageConsumed?.();
    }
  }, [initialMessage, sendText, onInitialMessageConsumed]);

  // When an initialInput arrives (e.g. from quick action template), pre-fill the input
  useEffect(() => {
    if (initialInput) {
      setInput(initialInput);
      onInitialInputConsumed?.();
      inputRef.current?.focus();
    }
  }, [initialInput, onInitialInputConsumed]);

  const handleCancel = useCallback(() => {
    if (requestIdRef.current) {
      cancelChat(requestIdRef.current);
    }
  }, []);

  const handleQuickScan = useCallback(async (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || "file";
    const scanMsg: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: `Quick scanning: ${fileName}`,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, scanMsg]);
    scanningRef.current = true;
    setIsLoading(true);

    try {
      const { analyzeCrashLog, getStoredModel, getStoredProvider } = await import("../../services/api");
      const { getApiKey } = await import("../../services/secure-storage");
      const provider = getStoredProvider();
      const model = getStoredModel();
      const apiKey = await getApiKey(provider) || "";

      const result = await analyzeCrashLog(filePath, apiKey, model, provider, "quick", "quick", false);

      const resultMsg: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: result.analysis || "Analysis complete — no summary available.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, resultMsg]);
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: `Quick scan failed: ${String(e)}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      scanningRef.current = false;
      setIsLoading(false);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
        {messages.length === 0 && !isLoading && (
          <div className="text-gray-500 text-center mt-8">
            <p className="text-emerald-400/70 font-medium mb-1">Ask anything</p>
            <p className="text-xs text-gray-600">Quick questions get quick answers</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : ""}>
            {msg.role === "user" ? (
              <div className="inline-block bg-emerald-500/20 text-emerald-100 rounded-lg px-3 py-2 max-w-[85%] text-left">
                {msg.content}
              </div>
            ) : (
              <div className="text-gray-300 leading-relaxed prose prose-sm prose-invert max-w-none
                              [&_pre]:bg-white/5 [&_pre]:rounded-lg [&_pre]:p-2 [&_pre]:text-xs
                              [&_code]:text-emerald-300 [&_a]:text-emerald-400">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
        {isLoading && displayContent && (
          <div className="text-gray-300 leading-relaxed prose prose-sm prose-invert max-w-none
                          [&_pre]:bg-white/5 [&_pre]:rounded-lg [&_pre]:p-2 [&_pre]:text-xs
                          [&_code]:text-emerald-300 [&_a]:text-emerald-400">
            <ReactMarkdown>{displayContent}</ReactMarkdown>
            <span className="inline-block w-1.5 h-4 bg-emerald-400 animate-pulse ml-0.5 align-text-bottom" />
          </div>
        )}
        {isLoading && !displayContent && (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <WidgetDropZone onFileSelected={handleQuickScan} disabled={isLoading} />

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/[0.08]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something..."
            rows={1}
            className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-lg px-3 py-2
                       text-sm text-gray-200 placeholder-gray-500 resize-none
                       focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30
                       transition-colors"
            disabled={isLoading}
          />
          {isLoading ? (
            scanningRef.current ? (
              <div className="p-2 text-emerald-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : (
              <button
                onClick={handleCancel}
                className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                title="Cancel"
              >
                <Square className="w-4 h-4" />
              </button>
            )
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
