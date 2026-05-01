"use client";

import * as React from "react";
import { Send, Sparkles, AlertTriangle } from "lucide-react";
import { Pill, HapticButton } from "@/components/ui";
import { ChatEmptyState } from "./chat-empty-state";
import { ChatMessage } from "./chat-message";

interface Message {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

interface BudgetState {
  used_tokens: number;
  budget_tokens: number;
  available_tokens: number;
  pct_used: number;
  blocked: boolean;
}

export function ChatPanel(_: { onClose: () => void }) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<number | null>(null);
  const [budget, setBudget] = React.useState<BudgetState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Initial budget read
  React.useEffect(() => {
    fetch("/api/chat/budget", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setBudget(j))
      .catch(() => {});
  }, []);

  // Auto-scroll on new content
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const refreshBudget = React.useCallback(() => {
    fetch("/api/chat/budget", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setBudget(j))
      .catch(() => {});
  }, []);

  const send = React.useCallback(
    async (text: string) => {
      const userMsg = text.trim();
      if (!userMsg || streaming) return;
      if (budget?.blocked) {
        setError("Daily Anthropic budget exhausted. Resets at local midnight.");
        return;
      }

      setError(null);
      setMessages((m) => [
        ...m,
        { role: "user", content: userMsg },
        { role: "assistant", content: "", pending: true },
      ]);
      setInput("");
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, user_message: userMsg }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          // Each SSE event ends in \n\n; keep last (possibly partial) chunk.
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          for (const ev of events) {
            const lines = ev.split("\n");
            let name = "message";
            let data = "";
            for (const ln of lines) {
              if (ln.startsWith("event: ")) name = ln.slice(7).trim();
              else if (ln.startsWith("data: ")) data += ln.slice(6);
            }
            if (!data) continue;
            let payload: { session_id?: number; text?: string; error?: string; tokens_in?: number; tokens_out?: number };
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }

            if (name === "session" && typeof payload.session_id === "number") {
              setSessionId(payload.session_id);
            } else if (name === "token" && typeof payload.text === "string") {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = {
                    ...last,
                    content: last.content + payload.text,
                    pending: true,
                  };
                }
                return next;
              });
            } else if (name === "done") {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, pending: false };
                }
                return next;
              });
              refreshBudget();
            } else if (name === "warn") {
              // Non-fatal: assistant message persisted with caveat
              refreshBudget();
            } else if (name === "error") {
              setError(
                payload.error === "budget"
                  ? "Daily Anthropic budget exhausted. Resets at local midnight."
                  : `Stream failed: ${payload.error ?? "unknown"}`,
              );
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && !last.content) {
                  next.pop();
                } else if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, pending: false };
                }
                return next;
              });
            }
          }
        }
      } catch (err: unknown) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort) setError(`Stream failed: ${String(err)}`);
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && !last.content) next.pop();
          else if (last && last.role === "assistant")
            next[next.length - 1] = { ...last, pending: false };
          return next;
        });
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, budget, sessionId, refreshBudget],
  );

  const stopStream = () => {
    abortRef.current?.abort();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const budgetTone: "red" | "amber" | "green" =
    budget && budget.pct_used > 90 ? "red" : budget && budget.pct_used > 70 ? "amber" : "green";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent-cyan" />
          <span className="text-caption font-bold uppercase tracking-[0.18em] text-fg-muted">
            TREVOR Chat
          </span>
        </div>
        {budget && (
          <div className="flex items-center gap-1.5">
            <Pill tone={budgetTone} size="sm">
              {budget.pct_used.toFixed(0)}% used
            </Pill>
            <span className="hidden text-micro text-fg-muted md:inline">
              {budget.available_tokens.toLocaleString()} left
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <ChatEmptyState onPick={(label) => send(label)} />
        ) : (
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6">
            {messages.map((m, i) => (
              <ChatMessage key={i} role={m.role} content={m.content} pending={m.pending} />
            ))}
          </div>
        )}
      </div>

      {/* Error pill */}
      {error && (
        <div className="border-t border-accent-red/30 bg-accent-red/10 px-4 py-2 text-caption text-accent-red flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-none" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="text-fg-muted hover:text-fg-primary"
          >
            ×
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border-subtle bg-bg-primary px-3 py-3 md:px-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={budget?.blocked ? "Budget exhausted — try tomorrow" : "Ask anything…"}
            disabled={budget?.blocked || streaming}
            rows={1}
            className={[
              "flex-1 resize-none rounded-md border border-border-subtle bg-bg-elevated",
              "px-3 py-2 text-caption text-fg-primary",
              "max-h-32 min-h-[44px] font-mono",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-cyan/60",
              "disabled:opacity-60",
            ].join(" ")}
          />
          {streaming ? (
            <HapticButton variant="ghost" size="md" onClick={stopStream}>
              Stop
            </HapticButton>
          ) : (
            <HapticButton
              variant="primary"
              size="md"
              onClick={() => send(input)}
              disabled={!input.trim() || budget?.blocked}
            >
              <Send size={14} />
            </HapticButton>
          )}
        </div>
      </div>
    </div>
  );
}
