"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { Activity, Clock, CheckCircle, XCircle, Send, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { usePolling } from "@/lib/use-polling";

/* ── Types ─────────────────────────────────────────────────────── */

type LiveData = {
  xp: number;
  rank: string;
  totalInsights: number;
  recentSignals: Array<{
    id: number; ticker: string; signal_type: string; confidence: number;
    outcome: string | null; timestamp: string; direction?: string;
    entry_price?: number; target_price?: number; stop_price?: number;
  }>;
  outcomes: { wins: number; losses: number };
  watchlist: Array<{ ticker: string; priority: number; mode: string; asset_type: string }>;
  trainingStats: { trades: number; observations: number; sentiment: number };
  todayCost: number;
  logTail: string[];
  dbSizeMB: number;
};

type ActiveTrade = {
  symbol: string; direction: string; entry: number | null;
  leverage: number; track: string; opened_at: string;
  stop: number | null; target: number | null;
};

type ChatMsg = { role: "user" | "assistant"; content: string; timestamp?: string };

/* ── Shared UI pieces ──────────────────────────────────────────── */

function WidgetCard({ title, children, className, style }: {
  title: string; children: React.ReactNode; className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("panel flex flex-col overflow-hidden min-h-[200px]", className)} style={style}>
      <div className="panel-header"><span>{title}</span></div>
      <div className="flex-1 overflow-auto p-2">{children}</div>
    </div>
  );
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-3 space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="h-4 rounded-sm animate-skeleton" style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function StatBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="stat-label">{label}</div>
      <div className={cn("stat-value", color || "text-foreground")}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DirectionBadge({ dir }: { dir: string }) {
  const isLong = dir?.toLowerCase() === "long" || dir?.toLowerCase() === "buy";
  return <span className={isLong ? "badge-long" : "badge-short"}>{isLong ? "LONG" : "SHORT"}</span>;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 70 ? "var(--neon-green)" : pct >= 50 ? "var(--neon-amber)" : "var(--neon-red)";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 rounded-full bg-[rgba(255,255,255,0.06)]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>
    </div>
  );
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Active Trades Widget ──────────────────────────────────────── */

function ActiveTradesWidget({ trades, loading }: { trades: ActiveTrade[]; loading: boolean }) {
  if (loading) return <Skeleton rows={3} />;
  if (!trades || trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1 py-8">
        <Activity className="h-5 w-5 opacity-20" />
        <span className="text-[10px]">No open positions</span>
      </div>
    );
  }
  return (
    <div className="space-y-0">
      {trades.map((t, i) => (
        <div key={i} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]">
          <span className="font-bold text-foreground w-20 truncate text-[11px]">{t.symbol}</span>
          <DirectionBadge dir={t.direction} />
          <span className="text-[10px] text-muted-foreground w-6 text-right">{t.leverage}x</span>
          <span className="text-[10px] text-foreground flex-1 text-right font-mono">
            {t.entry != null ? `$${t.entry.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
          </span>
          <span className="text-[9px] text-muted-foreground w-14 text-right">{timeAgo(t.opened_at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Signal Feed Widget ────────────────────────────────────────── */

function SignalFeedWidget({ signals, loading }: { signals: LiveData["recentSignals"]; loading: boolean }) {
  if (loading) return <Skeleton rows={6} />;
  if (!signals || signals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1 py-8">
        <Activity className="h-5 w-5 opacity-20" />
        <span className="text-[10px]">No signals yet</span>
      </div>
    );
  }
  return (
    <div className="space-y-0">
      {signals.slice(0, 15).map((s, i) => (
        <div key={s.id || i} className="flex items-center gap-2 data-cell hover:bg-[rgba(0,240,255,0.03)]">
          <span className="font-bold text-foreground w-16 truncate">{s.ticker}</span>
          <DirectionBadge dir={s.direction || "long"} />
          <span className="text-[9px] text-muted-foreground flex-1 truncate">{s.signal_type}</span>
          <ConfidenceBar value={s.confidence} />
          {s.outcome?.toLowerCase() === "win" && <CheckCircle className="h-3 w-3 text-[var(--neon-green)]" />}
          {s.outcome?.toLowerCase() === "loss" && <XCircle className="h-3 w-3 text-[var(--neon-red)]" />}
          {(!s.outcome || !["win", "loss"].includes(s.outcome.toLowerCase())) && <Clock className="h-3 w-3 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

/* ── Chat Widget ───────────────────────────────────────────────── */

function ChatWidget() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<"ok" | "down" | "checking">("checking");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    safeFetch<{ online?: boolean }>("/api/chat?action=health", {}).then(d =>
      setHealth(d.online ? "ok" : "down")
    );
    safeFetch<{ messages?: ChatMsg[] }>("/api/chat?action=history&sessionId=default&limit=8", {}).then(d =>
      setMessages(d.messages || [])
    );
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
        body: JSON.stringify({ message: msg, sessionId: "default" }),
      });
      const data = res.ok ? await res.json() : { response: "[Server error]" };
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.response || data.error || "No response",
        timestamp: new Date().toISOString(),
      }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "[Connection error]", timestamp: new Date().toISOString() }]);
    }
    setSending(false);
  }, [input, sending]);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-1.5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
            <Terminal className="h-4 w-4 opacity-20" />
            <span className="text-[9px]">Ask TREVOR anything</span>
          </div>
        )}
        {messages.slice(-8).map((m, i) => (
          <div key={i} className={cn("text-[11px] font-mono px-2 py-1 rounded-sm", m.role === "user"
            ? "text-[var(--neon-cyan)] bg-[rgba(0,212,255,0.04)]"
            : "text-[var(--neon-green)] bg-[rgba(0,255,136,0.04)]"
          )}>
            <span className="text-[9px] text-muted-foreground mr-1">{m.role === "user" ? ">" : "T:"}</span>
            <span className="break-words">{m.content.length > 200 ? m.content.slice(0, 200) + "…" : m.content}</span>
          </div>
        ))}
        {sending && (
          <div className="text-[11px] font-mono px-2 py-1 text-muted-foreground animate-pulse">T: thinking...</div>
        )}
      </div>
      <div className="border-t border-[var(--border)] p-1.5 flex items-center gap-1.5">
        <span className="text-[var(--neon-cyan)] text-[10px] font-bold">&gt;</span>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={health === "down" ? "offline..." : "ask trevor..."}
          disabled={sending || health === "down"}
          className="input-terminal flex-1 text-[11px] py-1 px-2"
        />
        <button onClick={send} disabled={sending || !input.trim() || health === "down"}
          className="btn-primary py-1 px-2 text-[9px] disabled:opacity-30">
          <Send className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Watchlist Widget ──────────────────────────────────────────── */

function WatchlistWidget({ watchlist, loading }: { watchlist: LiveData["watchlist"]; loading: boolean }) {
  if (loading) return <Skeleton rows={8} />;
  const sorted = [...(watchlist || [])].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (sorted.length === 0) {
    return <div className="text-[10px] text-muted-foreground text-center py-4">No watchlist items</div>;
  }
  return (
    <div className="space-y-0">
      {sorted.map((w, i) => (
        <div key={i} className={cn(
          "flex items-center gap-2 px-2 py-[5px]",
          i % 2 === 0 ? "bg-transparent" : "bg-[rgba(255,255,255,0.015)]"
        )}>
          <span className="font-bold text-foreground text-[11px] w-20 truncate">{w.ticker}</span>
          <span className={cn(
            "text-[8px] font-bold px-1.5 py-[1px] rounded-sm uppercase tracking-wider",
            w.mode === "scalp"
              ? "bg-[rgba(255,0,102,0.12)] text-[#ff0066] border border-[rgba(255,0,102,0.25)]"
              : w.mode === "both"
              ? "bg-[rgba(255,170,0,0.1)] text-[var(--neon-amber)] border border-[rgba(255,170,0,0.2)]"
              : "bg-[rgba(0,212,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,212,255,0.2)]"
          )}>
            {w.mode === "both" ? "S+LT" : w.mode === "scalp" ? "SCALP" : "LT"}
          </span>
          <span className="text-[9px] text-muted-foreground flex-1 text-right">{w.asset_type}</span>
        </div>
      ))}
    </div>
  );
}

/* ── System Log Widget ─────────────────────────────────────────── */

function SystemLogWidget({ logs, loading }: { logs: string[]; loading: boolean }) {
  if (loading) return <Skeleton rows={10} />;
  if (!logs || logs.length === 0) {
    return <div className="text-muted-foreground text-center py-4 text-[10px]">No log entries</div>;
  }
  return (
    <div className="font-mono text-[10px] space-y-0.5">
      {logs.slice(-20).map((line, i) => {
        const isError = line.includes("ERROR") || line.includes("CRITICAL");
        const isWarn = line.includes("WARNING");
        return (
          <div key={i} className={cn(
            "px-1 py-0.5 rounded-sm truncate",
            isError ? "text-[var(--neon-red)] bg-[rgba(255,51,102,0.05)]" :
            isWarn ? "text-[var(--neon-amber)] bg-[rgba(255,170,0,0.05)]" :
            "text-muted-foreground"
          )}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Dashboard ────────────────────────────────────────────── */

export function DashboardView() {
  const [data, setData] = useState<LiveData | null>(null);
  const [trades, setTrades] = useState<ActiveTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    const [raw, tradesRaw] = await Promise.all([
      safeFetch<Record<string, unknown> | null>("/api/live", null),
      safeFetch<{ trades?: ActiveTrade[] } | null>("/api/active-trades", null),
    ]);
    if (raw) {
      setData({
        xp: (raw.xp as number) ?? 0,
        rank: (raw.rank as string) ?? "Intern Quant",
        totalInsights: (raw.signals as Record<string, number>)?.total ?? 0,
        recentSignals: ((raw.recentSignals as Record<string, unknown>[]) ?? []).map((s) => ({
          ...s,
          timestamp: (s.timestamp || s.created_at || "") as string,
        })) as LiveData["recentSignals"],
        outcomes: {
          wins: (raw.signals as Record<string, number>)?.wins ?? 0,
          losses: (raw.signals as Record<string, number>)?.losses ?? 0,
        },
        watchlist: ((raw.watchlist as Record<string, unknown>[]) ?? []).map((w) => ({
          ticker: w.ticker as string,
          priority: (w.priority as number) ?? 2,
          mode: (w.mode as string) ?? "lt",
          asset_type: (w.asset_type as string) ?? "stock",
        })),
        trainingStats: {
          trades: (raw.trainingStats as Record<string, number>)?.trades ?? 0,
          observations: (raw.trainingStats as Record<string, number>)?.observations ?? 0,
          sentiment: (raw.trainingStats as Record<string, number>)?.sentiment ?? 0,
        },
        todayCost: (raw.costToday ?? raw.cost_today ?? 0) as number,
        logTail: (raw.logs as string[]) ?? [],
        dbSizeMB: (raw.dbSizeMB as number) ?? 0,
      });
      setError(false);
    } else {
      setError(true);
    }
    setTrades(tradesRaw?.trades ?? []);
    setLoading(false);
    setTradesLoading(false);
  }, []);

  usePolling(fetchData, 15000);

  const winCount = data?.outcomes?.wins || 0;
  const lossCount = data?.outcomes?.losses || 0;
  const decided = winCount + lossCount;
  const winRate = decided > 0 ? Math.round((winCount / decided) * 100) : 0;

  return (
    <div className="flex-1 overflow-hidden p-2 flex flex-col">
      {/* Portfolio Overview — untouched */}
      <div className="panel mb-2 stagger-cards">
        <div className="panel-header">PORTFOLIO OVERVIEW</div>
        <div className="flex items-center gap-6 p-3 flex-wrap">
          <StatBlock label="Win / Loss" value={`${winCount}W ${lossCount}L`} sub={`${winRate}% win rate`} />
          <StatBlock label="Signals" value={String(data?.totalInsights || 0)} color="neon-text" />
          <StatBlock label="Training Data" value={(data?.trainingStats?.trades || 0).toLocaleString()} sub={`${(data?.trainingStats?.observations || 0).toLocaleString()} obs`} />
          <StatBlock label="XP" value={String(data?.xp || 0)} sub={data?.rank || "Intern Quant"} color="neon-text" />
          <StatBlock label="Cost Today" value={`$${(data?.todayCost || 0).toFixed(3)}`} sub="/ $0.250 budget" />
          <StatBlock label="DB Size" value={`${data?.dbSizeMB || 0} MB`} />
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-[var(--neon-red)] text-center py-1 mb-1">
          Connection lost — retrying...
        </div>
      )}

      {/* 6-widget grid */}
      <div className="flex-1 grid gap-2 stagger-cards" style={{
        gridTemplateColumns: "1fr 1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        minHeight: 0,
      }}>
        {/* Top-left: Active Trades */}
        <WidgetCard title="ACTIVE TRADES" style={{ gridColumn: 1, gridRow: 1 }}>
          <ActiveTradesWidget trades={trades} loading={tradesLoading} />
        </WidgetCard>

        {/* Top-middle: Signal Feed */}
        <WidgetCard title="SIGNAL FEED" style={{ gridColumn: 2, gridRow: 1 }}>
          <SignalFeedWidget signals={data?.recentSignals || []} loading={loading} />
        </WidgetCard>

        {/* Right column: System Log (spans 2 rows) */}
        <WidgetCard title="SYSTEM LOG" style={{ gridColumn: 3, gridRow: "1 / 3" }}>
          <SystemLogWidget logs={data?.logTail || []} loading={loading} />
        </WidgetCard>

        {/* Bottom-left: Chat */}
        <div className="panel flex flex-col overflow-hidden min-h-[200px]" style={{ gridColumn: 1, gridRow: 2 }}>
          <div className="panel-header">CHAT</div>
          <ChatWidget />
        </div>

        {/* Bottom-middle: Watchlist */}
        <WidgetCard title={`WATCHLIST (${data?.watchlist?.length || 0})`} style={{ gridColumn: 2, gridRow: 2 }}>
          <WatchlistWidget watchlist={data?.watchlist || []} loading={loading} />
        </WidgetCard>
      </div>
    </div>
  );
}
