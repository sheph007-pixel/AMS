"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Sparkles, Loader2, RotateCcw, Copy, Check, ChevronDown } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// ─── Suggested prompts ──────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  {
    category: "Overview",
    prompts: [
      "Give me a full executive summary of our book of business",
      "How has our total premium under management grown year over year?",
      "What's our client retention rate across all years?",
    ],
  },
  {
    category: "Production Analysis",
    prompts: [
      "Break down our revenue by carrier for each fiscal year",
      "Which clients generate the most premium? Top 10 by total premium",
      "What's our line of business mix — medical vs dental vs vision vs life?",
    ],
  },
  {
    category: "Due Diligence",
    prompts: [
      "Prepare a due diligence summary suitable for Reagan Consulting",
      "What's our carrier concentration risk? Are we too dependent on any single carrier?",
      "Analyze our fee income — break down PEPM vs commission revenue by year",
    ],
  },
  {
    category: "Trends & Insights",
    prompts: [
      "Are there any clients showing declining enrollment? Flag potential churn risks",
      "Which carriers have grown the most in our book over the last 4 years?",
      "What's our average premium per enrolled employee by year?",
    ],
  },
];

// ─── Markdown rendering ─────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  // Simple markdown renderer for chat messages
  let html = text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-900 text-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-bob-purple px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-bob-text mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-bob-text mt-4 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-bob-text mt-4 mb-2">$1</h1>')
    // Tables
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_match, header, body) => {
      const headers = header.split("|").map((h: string) => h.trim()).filter(Boolean);
      const rows = body.trim().split("\n").map((row: string) =>
        row.split("|").map((c: string) => c.trim()).filter(Boolean)
      );
      let table = '<div class="overflow-x-auto my-2"><table class="w-full text-xs border-collapse">';
      table += '<thead><tr class="border-b border-gray-200">';
      headers.forEach((h: string) => { table += `<th class="px-3 py-1.5 text-left font-semibold text-gray-600">${h}</th>`; });
      table += '</tr></thead><tbody>';
      rows.forEach((row: string[]) => {
        table += '<tr class="border-b border-gray-100">';
        row.forEach((c: string) => { table += `<td class="px-3 py-1.5 text-bob-text">${c}</td>`; });
        table += '</tr>';
      });
      table += '</tbody></table></div>';
      return table;
    })
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-sm text-bob-text list-disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-sm text-bob-text list-decimal">$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p class="text-sm text-bob-text mb-2">')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');

  return `<p class="text-sm text-bob-text mb-2">${html}</p>`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AnalystPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  async function sendMessage(content: string) {
    if (!content.trim() || isStreaming) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };

    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setIsStreaming(true);
    setShowSuggestions(false);

    try {
      const allMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: allMessages }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

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
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === "assistant") {
                    last.content += parsed.content;
                  }
                  return [...updated];
                });
              }
              if (parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred";
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "assistant" && !last.content) {
          last.content = `I encountered an error: ${errorMessage}. Please try again.`;
        }
        return [...updated];
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function copyMessage(id: string, content: string) {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function resetChat() {
    setMessages([]);
    setShowSuggestions(true);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bob-purple via-purple-500 to-bob-blue flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-bob-text">AI Analyst</h1>
              <p className="text-xs text-bob-text-soft">Powered by GPT-4o with full access to your book of business data</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={resetChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-bob-text-soft hover:text-bob-text hover:bg-gray-100 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> New Chat
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-bob-border bg-white mb-4">
        {/* Empty state with suggestions */}
        {showSuggestions && messages.length === 0 && (
          <div className="p-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bob-purple/10 to-bob-blue/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-bob-purple" />
              </div>
              <h2 className="text-lg font-bold text-bob-text mb-1">Ask anything about your book of business</h2>
              <p className="text-sm text-bob-text-soft max-w-md mx-auto">
                I have complete access to all {new Date().getFullYear() - 2022 + 1} years of enrollment data —
                clients, carriers, premiums, fees, and trends. Ask me anything.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
              {SUGGESTED_PROMPTS.map((category) => (
                <div key={category.category} className="space-y-2">
                  <h3 className="text-xs font-semibold text-bob-text-soft uppercase tracking-wide px-1">{category.category}</h3>
                  {category.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="w-full text-left px-3 py-2.5 rounded-xl border border-bob-border text-sm text-bob-text hover:border-bob-purple/30 hover:bg-purple-50/30 transition-all duration-200 group"
                    >
                      <span className="group-hover:text-bob-purple transition-colors">{prompt}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`px-6 py-4 ${
              message.role === "user"
                ? "bg-gray-50 border-b border-gray-100"
                : "bg-white border-b border-gray-100"
            }`}
          >
            <div className="max-w-3xl mx-auto">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    message.role === "user"
                      ? "bg-gray-200 text-gray-600"
                      : "bg-gradient-to-br from-bob-purple to-bob-blue text-white"
                  }`}
                >
                  {message.role === "user" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-bob-text">
                      {message.role === "user" ? "You" : "AI Analyst"}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  {message.role === "user" ? (
                    <p className="text-sm text-bob-text">{message.content}</p>
                  ) : message.content ? (
                    <div
                      className="prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-bob-text-soft">
                      <Loader2 className="w-4 h-4 animate-spin text-bob-purple" />
                      Analyzing your data...
                    </div>
                  )}

                  {/* Copy button for assistant messages */}
                  {message.role === "assistant" && message.content && !isStreaming && (
                    <button
                      onClick={() => copyMessage(message.id, message.content)}
                      className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-bob-purple transition-colors"
                    >
                      {copiedId === message.id ? (
                        <><Check className="w-3 h-3" /> Copied</>
                      ) : (
                        <><Copy className="w-3 h-3" /> Copy</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom indicator */}
      {messages.length > 3 && (
        <div className="relative">
          <button
            onClick={scrollToBottom}
            className="absolute -top-12 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white border border-bob-border shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors z-10"
          >
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="flex-shrink-0">
        <div className="bg-white rounded-2xl border border-bob-border shadow-sm p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about clients, premiums, carriers, trends, audits..."
              rows={1}
              className="flex-1 resize-none text-sm text-bob-text placeholder-gray-400 bg-transparent focus:outline-none py-1.5 px-2 max-h-[150px]"
              disabled={isStreaming}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isStreaming}
              className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                input.trim() && !isStreaming
                  ? "bg-bob-purple text-white hover:bg-bob-purple/90 shadow-sm"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 px-2">
            <p className="text-[10px] text-gray-400">
              GPT-4o with real-time access to Kennion AMS data. Press Enter to send, Shift+Enter for new line.
            </p>
            {isStreaming && (
              <span className="text-[10px] text-bob-purple font-medium animate-pulse">Streaming...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
