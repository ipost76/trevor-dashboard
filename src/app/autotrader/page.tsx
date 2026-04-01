"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Zap, TrendingDown, Target, DollarSign, Activity,
  BarChart3, Clock, AlertTriangle, Brain, ChevronDown, ChevronUp,
} from "lucide-react";
import { fmtDollarPrice, fmtPctSigned, fmtPrice, fmtDollar } from "@/lib/format";
import { StyledLineChart } from "@/components/charts/StyledLineChart";

/* ─── Types ─────────────────────────────────────────────── */

type Summary = {
  total_trades: number; wins: number; losses: number; win_rate: number;
  total_pnl: number; profit_factor: number; avg_win: number; avg_loss: number;
  largest_win: number; largest_loss: number; avg_hold_minutes: number;
  starting_equity: number; current_equity: number; max_drawdown_pct: number;
};
type TimeSlot = { hour: number; win_rate: number; trade_count: number };
type DaySlot = { day: string; win_rate: number; trade_count: number };
type HeatCell = { day: number; block: number; day_label: string; hour_label: string; trades: number; wins: number; pnl: number };
type AssetRow = { ticker: string; trades: number; wins: number; losses: number; win_rate: number; pnl: number };
type ExitRow = { reason: string; trades: number; wins: number; win_rate: number; pnl: number };
type Streak = { start_date: string; end_date: string; consecutive_losses: number; total_pnl: number; tickers: string[] };
type Trade = {
  ticker: string; side: string; entry_price: number; exit_price: number;
  pnl: number; pnl_pct: number; exit_reason: string; entry_time: string;
  exit_time: string; signal_score: number; hold_minutes: number; regime: string;
};
type EqPoint = { date: string; equity: number; trade_count: number };
type AgentData = { available: boolean; reason?: string; agents: unknown[]; consensus_analysis: unknown };
type RetroData = {
  status: string; paused_reason?: string; paused_at?: string;
  summary: Summary;
  time_analysis: { best_hour: TimeSlot; worst_hour: TimeSlot; best_day: DaySlot; worst_day: DaySlot; heatmap: HeatCell[] };
  asset_breakdown: AssetRow[];
  exit_analysis: ExitRow[];
  loss_streaks: Streak[];
  equity_curve: EqPoint[];
  recent_trades: Trade[];
  insights: string[];
  lessons: { ticker: string; lesson_type: string; lesson_text: string; pnl_pct: number; created_at: string }[];
};

/* ─── Helpers ───────────────────────────────────────────── */

function fmtHold(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtDate(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts.endsWith("Z") ? ts : ts.includes("+") ? ts : ts + "Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  } catch { return ts.slice(0, 10); }
}

function fmtTime(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts.endsWith("Z") ? ts : ts.includes("+") ? ts : ts + "Z");
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  } catch { return ""; }
}

function wrColor(wr: number): string {
  if (wr >= 55) return "text-green-400";
  if (wr >= 40) return "text-yellow-400";
  return "text-red-400";
}

function pnlColor(v: number): string {
  return v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-muted-foreground";
}

function heatColor(trades: number, wins: number): string {
  if (trades === 0) return "bg-[rgba(255,255,255,0.03)]";
  const wr = wins / trades;
  if (wr >= 0.5) return "bg-green-500/20 border-green-500/30";
  if (wr >= 0.3) return "bg-yellow-500/15 border-yellow-500/20";
  return "bg-red-500/20 border-red-500/30";
}

/* ─── Main Component ────────────────────────────────────── */

export default function AutoTraderPage() {
  const [retro, setRetro] = useState<RetroData | null>(null);
  const [agents, setAgents] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradesExpanded, setTradesExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [retroRes, agentRes] = await Promise.all([
        fetch("/api/autotrader/retrospective"),
        fetch("/api/autotrader/agent-analysis"),
      ]);
      if (retroRes.ok) {
        setRetro(await retroRes.json());
        setError(null);
      } else {
        setError("Failed to load retrospective data");
      }
      if (agentRes.ok) setAgents(await agentRes.json());
    } catch {
      setError("API unreachable");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120000); // 2min poll (data is mostly static)
    return () => clearInterval(iv);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading AutoTrader Analytics...</div>
      </div>
    );
  }

  if (error && !retro) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-muted-foreground text-sm">{error}</div>
        <button onClick={fetchData} className="btn-primary text-xs px-4 py-2">Retry</button>
      </div>
    );
  }

  const s = retro?.summary ?? {} as Summary;
  const ta = retro?.time_analysis;
  const assets = retro?.asset_breakdown ?? [];
  const exits = retro?.exit_analysis ?? [];
  const streaks = retro?.loss_streaks ?? [];
  const eqCurve = retro?.equity_curve ?? [];
  const trades = retro?.recent_trades ?? [];
  const insights = retro?.insights ?? [];
  const lessons = retro?.lessons ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">

      {/* ── Status Banner ── */}
      {retro?.status === "paused" ? (
        <div className="panel border-amber-500/50 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">&#x23F8;&#xFE0F;</span>
            <span className="text-xs font-bold neon-amber tracking-wider">AUTOTRADER PAUSED FOR REVIEW</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {retro.paused_at && <span>Paused: {fmtDate(retro.paused_at)}</span>}
            <span>Paper P&L: <span className={pnlColor(s.total_pnl)}>{fmtDollar(s.total_pnl)}</span></span>
            <span>Win Rate: <span className={wrColor(s.win_rate)}>{s.win_rate}%</span></span>
            <span>PF: <span className="text-red-400">{fmtPrice(s.profit_factor)}</span></span>
          </div>
          {retro.paused_reason && (
            <p className="text-[10px] text-muted-foreground/70 mt-1">{retro.paused_reason}</p>
          )}
        </div>
      ) : (
        <div className="panel border-[rgba(0,240,255,0.3)] bg-[rgba(0,240,255,0.03)] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">&#x25B6;&#xFE0F;</span>
            <span className="text-xs font-bold neon-text tracking-wider">AUTOTRADER ACTIVE (PAPER)</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Equity: <span className="text-foreground">{fmtDollar(s.current_equity)}</span></span>
            <span>P&L: <span className={pnlColor(s.total_pnl)}>{fmtDollar(s.total_pnl)}</span></span>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-[rgba(0,240,255,0.1)] border border-[rgba(0,240,255,0.3)]">
          <Zap className="h-4 w-4 neon-text" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-[0.1em] neon-text">AUTOTRADER RETROSPECTIVE</h1>
          <p className="text-[10px] text-muted-foreground tracking-wide uppercase">Paper Trading Analytics — Alpaca</p>
        </div>
      </div>

      {/* ── Section A: Performance Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total P&L" value={fmtDollar(s.total_pnl)} color={pnlColor(s.total_pnl)} icon={DollarSign} />
        <StatCard label="Win Rate" value={`${s.win_rate ?? 0}%`} color={wrColor(s.win_rate ?? 0)} icon={Target} />
        <StatCard label="Profit Factor" value={fmtPrice(s.profit_factor)} color={s.profit_factor >= 1 ? "text-green-400" : "text-red-400"} icon={BarChart3} />
        <StatCard label="Avg Win / Loss" value={`${fmtDollar(s.avg_win)} / ${fmtDollar(s.avg_loss)}`} color="text-foreground" icon={Activity} />
        <StatCard label="Max Drawdown" value={`${s.max_drawdown_pct ?? 0}%`} color={Math.abs(s.max_drawdown_pct ?? 0) > 10 ? "text-red-400" : "text-yellow-400"} icon={TrendingDown} />
        <StatCard label="Trades" value={`${s.total_trades ?? 0}`} sub={`${s.wins ?? 0}W / ${s.losses ?? 0}L`} color="text-[var(--neon-cyan)]" icon={Activity} />
      </div>

      {/* ── Section B: Equity Curve ── */}
      {eqCurve.length > 1 && (
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">EQUITY CURVE</div>
          <StyledLineChart
            data={eqCurve}
            lines={[{ dataKey: "equity", name: "Equity" }]}
            xKey="date"
            height={200}
            showArea
            splitColorAtZero={false}
            referenceLine={s.starting_equity}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Start: {fmtDollar(s.starting_equity)}</span>
            <span>Current: <span className={pnlColor(s.total_pnl)}>{fmtDollar(s.current_equity)}</span></span>
            <span>Avg hold: {fmtHold(s.avg_hold_minutes ?? 0)}</span>
          </div>
        </div>
      )}

      {/* ── Auto-generated Insights ── */}
      {insights.length > 0 && (
        <div className="panel border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[10px] font-bold tracking-wider text-amber-400">INSIGHTS</span>
          </div>
          {insights.map((ins, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">{ins}</p>
          ))}
        </div>
      )}

      {/* ── Section D: Time Heatmap ── */}
      {ta && (
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">TIME ANALYSIS</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[10px]">
              <thead>
                <tr>
                  <th className="text-left text-muted-foreground font-normal pb-1 pr-2">ET</th>
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                    <th key={d} className="text-center text-muted-foreground font-normal pb-1 px-1">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0,4,8,12,16,20].map(block => (
                  <tr key={block}>
                    <td className="text-muted-foreground pr-2 py-0.5 font-mono">{String(block).padStart(2,"0")}-{String(block+3).padStart(2,"0")}</td>
                    {[0,1,2,3,4,5,6].map(day => {
                      const cell = (ta.heatmap ?? []).find(c => c.day === day && c.block === block);
                      const t = cell?.trades ?? 0;
                      const w = cell?.wins ?? 0;
                      return (
                        <td key={day} className="px-0.5 py-0.5 text-center">
                          <div className={`rounded px-1 py-0.5 border border-transparent ${heatColor(t, w)}`}
                               title={t > 0 ? `${w}/${t} wins (${Math.round(w/t*100)}%) P&L: $${(cell?.pnl ?? 0).toFixed(0)}` : "No trades"}>
                            {t > 0 ? (
                              <span className={wrColor(t > 0 ? w/t*100 : 0)}>{w}/{t}</span>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-muted-foreground">
            <span>Best: <span className="text-green-400">{ta.best_day.day} {ta.best_hour.hour}:00</span> ({ta.best_hour.win_rate}% WR, {ta.best_hour.trade_count} trades)</span>
            <span>Worst: <span className="text-red-400">{ta.worst_day.day} {ta.worst_hour.hour}:00</span> ({ta.worst_hour.win_rate}% WR, {ta.worst_hour.trade_count} trades)</span>
          </div>
        </div>
      )}

      {/* ── Section E: Asset + Exit Breakdown ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Asset P&L */}
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">ASSET P&L BREAKDOWN</div>
          <div className="space-y-1.5">
            {assets.map(a => {
              const maxPnl = Math.max(...assets.map(x => Math.abs(x.pnl)), 1);
              const pct = Math.abs(a.pnl) / maxPnl * 100;
              return (
                <div key={a.ticker} className="flex items-center gap-2 text-[10px]">
                  <span className="w-16 font-bold truncate">{a.ticker.replace("/USD","")}</span>
                  <div className="flex-1 h-3 rounded-full bg-[rgba(255,255,255,0.03)] overflow-hidden">
                    <div className={`h-full rounded-full ${a.pnl >= 0 ? "bg-green-500/50" : "bg-red-500/50"}`}
                         style={{ width: `${Math.max(pct, 3)}%` }} />
                  </div>
                  <span className={`w-14 text-right font-mono ${pnlColor(a.pnl)}`}>{fmtDollar(a.pnl)}</span>
                  <span className="w-16 text-right text-muted-foreground">{a.trades}t {a.win_rate}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Exit Reason */}
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">EXIT REASON BREAKDOWN</div>
          <div className="space-y-1.5">
            {exits.map(e => (
              <div key={e.reason} className="flex items-center justify-between text-[10px] py-1 px-2 rounded bg-[rgba(255,255,255,0.02)]">
                <span className="font-mono">{e.reason}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{e.trades} trades</span>
                  <span className={wrColor(e.win_rate)}>{e.win_rate}% WR</span>
                  <span className={`font-mono ${pnlColor(e.pnl)}`}>{fmtDollar(e.pnl)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section F: Swarm Agent Analysis ── */}
      <div className="glass rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Brain className="h-3.5 w-3.5 text-[var(--neon-cyan)]" />
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground">SWARM AGENT ANALYSIS</span>
        </div>
        {!agents?.available ? (
          <div className="panel border-[rgba(0,240,255,0.15)] bg-[rgba(0,240,255,0.03)] p-3 text-center space-y-1">
            <p className="text-[11px] text-muted-foreground">Agent decisions are not currently stored.</p>
            <p className="text-[10px] text-muted-foreground/60">
              {agents?.reason || "Add agent_votes table to autotrader.db to capture individual agent predictions for retrospective analysis."}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Agent data available — analysis pending implementation.</p>
        )}
      </div>

      {/* ── Section G: Loss Streaks ── */}
      {streaks.length > 0 && (
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">LOSS STREAKS</div>
          <div className="space-y-1.5">
            {streaks.map((ls, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] py-1.5 px-2 rounded bg-[rgba(255,51,102,0.04)] border border-[rgba(255,51,102,0.1)]">
                <span className="text-red-400 font-bold">{ls.consecutive_losses} consecutive losses</span>
                <span className="text-muted-foreground">{ls.start_date} → {ls.end_date}</span>
                <span className="text-red-400 font-mono">{fmtDollar(ls.total_pnl)}</span>
                <span className="text-muted-foreground">{ls.tickers.join(", ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section H: Recent Trades Table ── */}
      <div className="glass rounded-lg p-3">
        <button className="flex items-center justify-between w-full mb-2"
                onClick={() => setTradesExpanded(!tradesExpanded)}>
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground">
            RECENT TRADES ({trades.length})
          </div>
          {tradesExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {tradesExpanded && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-[10px]">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left font-normal text-muted-foreground py-1 pr-2">Date</th>
                  <th className="text-left font-normal text-muted-foreground py-1 pr-2">Ticker</th>
                  <th className="text-left font-normal text-muted-foreground py-1 pr-2">Dir</th>
                  <th className="text-right font-normal text-muted-foreground py-1 pr-2">Entry</th>
                  <th className="text-right font-normal text-muted-foreground py-1 pr-2">Exit</th>
                  <th className="text-right font-normal text-muted-foreground py-1 pr-2">P&L</th>
                  <th className="text-right font-normal text-muted-foreground py-1 pr-2">%</th>
                  <th className="text-right font-normal text-muted-foreground py-1 pr-2">Hold</th>
                  <th className="text-left font-normal text-muted-foreground py-1 pr-2">Exit</th>
                  <th className="text-right font-normal text-muted-foreground py-1">Score</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]">
                    <td className="py-1 pr-2 text-muted-foreground">{fmtDate(t.entry_time)} {fmtTime(t.entry_time)}</td>
                    <td className="py-1 pr-2 font-bold">{t.ticker.replace("/USD","")}</td>
                    <td className="py-1 pr-2">
                      <span className={`px-1 rounded ${t.side === "BUY" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {t.side === "BUY" ? "LONG" : "SHORT"}
                      </span>
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{fmtDollarPrice(t.entry_price)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{fmtDollarPrice(t.exit_price)}</td>
                    <td className={`py-1 pr-2 text-right font-mono ${pnlColor(t.pnl)}`}>{fmtDollar(t.pnl)}</td>
                    <td className={`py-1 pr-2 text-right font-mono ${pnlColor(t.pnl_pct)}`}>{fmtPctSigned(t.pnl_pct)}%</td>
                    <td className="py-1 pr-2 text-right text-muted-foreground">{fmtHold(t.hold_minutes)}</td>
                    <td className="py-1 pr-2 text-muted-foreground">{t.exit_reason}</td>
                    <td className="py-1 text-right font-mono">{t.signal_score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Lessons Learned ── */}
      {lessons.length > 0 && (
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground mb-2">LESSONS LEARNED (Recent)</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {lessons.map((l, i) => (
              <div key={i} className="text-[10px] py-1 px-2 rounded bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)]">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`px-1 rounded font-bold ${l.lesson_type === "win" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {l.lesson_type?.toUpperCase()}
                  </span>
                  <span className="font-bold">{l.ticker}</span>
                  <span className={`font-mono ${pnlColor(l.pnl_pct)}`}>{fmtPctSigned(l.pnl_pct)}%</span>
                  <span className="text-muted-foreground ml-auto">{fmtDate(l.created_at)}</span>
                </div>
                <p className="text-muted-foreground leading-snug">{l.lesson_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Stat Card ─────────────────────────────────────────── */

function StatCard({ label, value, color, icon: Icon, sub }: {
  label: string; value: string; color: string;
  icon: React.ComponentType<{ className?: string }>; sub?: string;
}) {
  return (
    <div className="glass rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
