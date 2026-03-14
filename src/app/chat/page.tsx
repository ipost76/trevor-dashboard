"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Send, RefreshCw, Wifi, WifiOff, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { TypingDots } from "@/components/typing-dots";

type Message = { role: "user" | "assistant"; content: string; timestamp?: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<"ok" | "down" | "checking">("checking");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    safeFetch<{ ok?: boolean }>("/api/chat?scope=health", {}).then(d => setHealth(d.ok ? "ok" : "down"));
    safeFetch<{ messages?: Message[] }>("/api/chat?scope=history", {}).then(d => setMessages(d.messages || []));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);
    setMessages(prev => [...prev, { role: "user", content: msg, timestamp: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) {
        setMessages(prev => [...prev, { role: "assistant", content: "[Server error]", timestamp: new Date().toISOString() }]);
      } else {
        const data = await res.json();
        setMessages(prev => [...prev, { role: "assistant", content: data.response || data.error || "No response", timestamp: new Date().toISOString() }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "[Connection error]", timestamp: new Date().toISOString() }]);
    }
    setSending(false);
    inputRef.current?.focus();
  }, [input, sending]);

  return (
    <div className="flex-1 overflow-hidden p-2">
      <div className="panel h-full flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-3 w-3" />
            <span>TREVOR TERMINAL</span>
          </div>
          <div className="flex items-center gap-1.5">
            {health === "ok" ? (
              <><Wifi className="h-2.5 w-2.5 text-[var(--neon-green)]" /><span className="text-[9px] neon-green">CONNECTED</span></>
            ) : health === "down" ? (
              <><WifiOff className="h-2.5 w-2.5 text-[var(--neon-red)]" /><span className="text-[9px] neon-red">OFFLINE</span></>
            ) : (
              <><RefreshCw className="h-2.5 w-2.5 animate-spin text-muted-foreground" /><span className="text-[9px] text-muted-foreground">CONNECTING</span></>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3">
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Terminal className="h-8 w-8 opacity-20" />
              <span className="text-[11px]">Type a command or question below</span>
              <span className="text-[9px] opacity-50">e.g. &quot;analyze BTC&quot;, &quot;what&apos;s the market regime?&quot;</span>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[80%] rounded px-3 py-2 text-[12px] font-mono",
                m.role === "user"
                  ? "bg-[rgba(0,240,255,0.08)] border border-[rgba(0,240,255,0.15)] text-foreground"
                  : "bg-[var(--card)] border border-[var(--border)] text-foreground"
              )}>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                {m.timestamp && (
                  <div className="text-[8px] text-muted-foreground mt-1 text-right">
                    {new Date(m.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-[var(--card)] border border-[var(--border)] rounded px-3 py-2">
                <TypingDots size="sm" className="text-[var(--neon-cyan)]" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-[var(--border)] p-2">
          <div className="flex items-center gap-2">
            <span className="text-[var(--neon-cyan)] text-xs font-bold">&gt;</span>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Enter command..."
              disabled={sending || health === "down"}
              className="input-terminal flex-1"
              autoFocus
            />
            <button
              onClick={send}
              disabled={sending || !input.trim() || health === "down"}
              className="btn-primary disabled:opacity-30 flex items-center gap-1"
            >
              <Send className="h-3 w-3" /> SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
