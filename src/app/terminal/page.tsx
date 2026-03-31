"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Send, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { TypingDots } from "@/components/typing-dots";

type Message = { role: "user" | "assistant"; content: string; timestamp: number; tokens?: { input: number; output: number } };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, sending]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sending || msg.length > 500) return;
    setInput("");
    setSending(true);

    const userMsg: Message = { role: "user", content: msg, timestamp: Date.now() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);

    try {
      const apiMessages = newMsgs.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Server error" }));
        setMessages(prev => [...prev, { role: "assistant", content: errData.error || "Server error", timestamp: Date.now() }]);
      } else {
        const data = await res.json();
        setMessages(prev => [...prev, {
          role: "assistant",
          content: data.reply || data.response || "No response.",
          timestamp: Date.now(),
          tokens: data.tokens,
        }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error. Try again.", timestamp: Date.now() }]);
    }
    setSending(false);
    inputRef.current?.focus();
  }, [input, sending, messages]);

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {/* Termius-blue theme scoped to this page */}
      <style>{`
        html, body { background: #0d1117 !important; background-image: none !important; }
        body > div, body > div > div, body > div > div > div { background: #0d1117 !important; }
        body::before, body::after { display: none !important; }
        [class*="bg-background"] { background-color: #0d1117 !important; }
        header { background: #1c2333 !important; border-color: #30363d !important; }
        main { background: #0d1117 !important; }
        main > * { background: #0d1117 !important; }
        footer, [class*="status-bar"], [class*="StatusBar"] { background: #1c2333 !important; border-color: #30363d !important; }
        aside { background: #0d1117 !important; border-color: #30363d !important; }
        nav[class*="fixed"] { background: #161b22 !important; border-color: #30363d !important; }
      `}</style>

      <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "#0d1117" }}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b sticky top-0 z-40" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(6,7,10,0.95)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <span style={{ color: "#00ff88", fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, letterSpacing: "0.04em" }}>
            &gt;_ TREVOR CHAT
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-[pulseLive_2s_ease-in-out_infinite]" style={{ background: "#00ff88", boxShadow: "0 0 4px #00ff88" }} />
            <span style={{ color: "#00ff88", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>ONLINE</span>
          </div>
        </div>
        {/* Blue accent line */}
        <div className="shrink-0" style={{ height: 1, background: "linear-gradient(90deg, transparent, #58a6ff, transparent)" }} />

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-4 pb-6 space-y-3 flex flex-col justify-end min-h-0" style={{ background: "#0d1117" }}>
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: "#8b949e" }}>
              <MessageSquare className="h-10 w-10 opacity-20" />
              <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>Hey Ghost. What do you want to know?</span>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {["How am I doing?", "Analyze BTC", "AutoTrader status"].map(q => (
                  <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="px-2.5 py-1 rounded text-xs transition-colors"
                    style={{ background: "#1a2332", border: "1px solid #30363d", color: "#58a6ff", fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className="max-w-[85%] md:max-w-[70%]">
                <div className="mb-1" style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const,
                  color: m.role === "assistant" ? "#00ff88" : "#58a6ff",
                  textAlign: m.role === "user" ? "right" : "left",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {m.role === "user" ? "GHOST" : ">_ TREVOR"}
                </div>
                <div className="px-3.5 py-2.5" style={{
                  background: m.role === "user" ? "rgba(0,100,200,0.08)" : "rgba(10,11,16,0.8)",
                  border: `1px solid ${m.role === "user" ? "rgba(0,150,255,0.12)" : "rgba(255,255,255,0.06)"}`,
                  borderLeft: m.role === "assistant" ? "3px solid #00ff88" : undefined,
                  borderRight: m.role === "user" ? "3px solid rgba(0,150,255,0.4)" : undefined,
                  borderRadius: m.role === "assistant" ? "2px 10px 10px 10px" : "10px 2px 10px 10px",
                  color: "#e0e0e0",
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
                  lineHeight: 1.65,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                }}>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 4, textAlign: m.role === "user" ? "right" : "left", paddingLeft: m.role === "assistant" ? 4 : 0, paddingRight: m.role === "user" ? 4 : 0 }}>
                  {formatTime(m.timestamp)}
                  {m.tokens && <span style={{ marginLeft: 8, opacity: 0.6 }}>{m.tokens.input + m.tokens.output} tok</span>}
                </div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[85%] md:max-w-[70%]">
                <div className="mb-1" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "#00ff88", fontFamily: "'JetBrains Mono', monospace" }}>&gt;_ TREVOR</div>
                <div className="px-3.5 py-2.5" style={{ background: "rgba(10,11,16,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderLeft: "3px solid #00ff88", borderRadius: "2px 10px 10px 10px", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
                  <TypingDots size="sm" className="text-[#58a6ff]" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input — fixed above mobile tab bar */}
        <div className="shrink-0 p-2 pb-14 md:pb-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(6,7,10,0.95)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div className="flex items-center gap-2">
            <span style={{ color: "#00ff88", fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>&gt;</span>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value.slice(0, 500))}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask TREVOR anything..."
              disabled={sending}
              maxLength={500}
              autoFocus
              className="flex-1 outline-none transition-all duration-150"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#e0e0e0",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
                minHeight: 44,
              }}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(0,255,136,0.3)"; (e.target as HTMLInputElement).style.boxShadow = "0 0 0 2px rgba(0,255,136,0.06), inset 0 1px 2px rgba(0,0,0,0.2)"; }}
              onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.target as HTMLInputElement).style.boxShadow = "none"; }}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="flex items-center justify-center disabled:opacity-30 transition-all shrink-0 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #00cc66 0%, #00ff88 100%)",
                color: "#06070a",
                border: "none",
                borderRadius: 10,
                width: 44,
                height: 44,
                fontSize: 14,
                fontWeight: 700,
                cursor: sending || !input.trim() ? "not-allowed" : "pointer",
                boxShadow: "0 2px 6px rgba(0,255,136,0.2)",
              }}>
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
