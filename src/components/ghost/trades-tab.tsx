"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import { Modal, Input, TextArea, Select, timeAgo, badge } from "./shared";

interface TrevorTrade {
  trade_id?: string; id?: number; ticker: string; direction: string;
  entry_price: number | null; exit_price?: number | null; pnl_pct?: number | null;
  outcome?: string | null; leverage: number; confidence?: number;
  track?: string; opened_at: string; closed_at?: string | null;
  hold_duration?: string; source: string; stop_price?: number | null;
  target_price?: number | null; margin_usd?: number | null; notes?: string | null;
}
interface Stats {
  total: number; wins: number; losses: number; winRate: number;
  avgPnl: number; totalPnl: number; activeCount: number;
  bestTrade: { ticker: string; pnl_pct: number } | null;
  worstTrade: { ticker: string; pnl_pct: number } | null;
}

type Filter = "ALL" | "WINS" | "LOSSES";

export function TradesTab() {
  const [active, setActive] = useState<TrevorTrade[]>([]);
  const [history, setHistory] = useState<TrevorTrade[]>([]);
  const [manual, setManual] = useState<TrevorTrade[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0, activeCount: 0, bestTrade: null, worstTrade: null });
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showCount, setShowCount] = useState(20);
  const [showManual, setShowManual] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [closeId, setCloseId] = useState<number | null>(null);
  const [closePrice, setClosePrice] = useState("");
  const [form, setForm] = useState({ ticker: "", direction: "LONG", entry_price: "", leverage: "1", stop_loss: "", target: "", notes: "" });

  const load = useCallback(() => {
    safeFetch<{ active: TrevorTrade[]; history: TrevorTrade[]; manual: TrevorTrade[]; stats: Stats }>(
      "/api/ghost/trevor-trades",
      { active: [], history: [], manual: [], stats: { total: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0, activeCount: 0, bestTrade: null, worstTrade: null } }
    ).then(d => {
      setActive(d.active);
      setHistory(d.history);
      setManual(d.manual);
      if (d.stats) setStats(d.stats);
    });
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

  const createManual = async () => {
    if (!form.ticker) return;
    await fetch("/api/ghost/trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: form.ticker, direction: form.direction, entry_price: form.entry_price ? parseFloat(form.entry_price) : null, leverage: parseFloat(form.leverage) || 1, stop_loss: form.stop_loss ? parseFloat(form.stop_loss) : null, target: form.target ? parseFloat(form.target) : null, notes: form.notes || null }) });
    setForm({ ticker: "", direction: "LONG", entry_price: "", leverage: "1", stop_loss: "", target: "", notes: "" });
    setShowForm(false);
    load();
  };

  const closeManual = async () => {
    if (!closeId || !closePrice) return;
    await fetch(`/api/ghost/trades/${closeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exit_price: parseFloat(closePrice), _action: "close" }) });
    setCloseId(null); setClosePrice("");
    load();
  };

  const deleteManual = async (id: number) => {
    if (!confirm("Delete this trade?")) return;
    await fetch(`/api/ghost/trades/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filter === "ALL" ? history
    : filter === "WINS" ? history.filter(t => (t.pnl_pct ?? 0) > 0)
    : history.filter(t => (t.pnl_pct ?? 0) <= 0);
  const visible = filtered.slice(0, showCount);

  const openManual = manual.filter(t => !t.outcome || t.outcome === "OPEN");
  const closedManual = manual.filter(t => t.outcome && t.outcome !== "OPEN");

  return (
    <div className="space-y-3 overflow-y-auto pb-32">
      {/* ── Stats Bar ── */}
      <div className="panel px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-3 text-[11px] font-mono flex-wrap">
          <span className="text-foreground font-bold">{stats.total} trades</span>
          <span className="neon-green">{stats.wins}W</span>
          <span className="neon-red">{stats.losses}L</span>
          <span className={cn("font-bold", stats.winRate >= 50 ? "neon-green" : "neon-red")}>{stats.winRate}% WR</span>
          <span className={cn(stats.avgPnl >= 0 ? "neon-green" : "neon-red")}>Avg {fmtPctSigned(stats.avgPnl)}%</span>
          <span className={cn("font-bold", stats.totalPnl >= 0 ? "neon-green" : "neon-red")}>Total {fmtPctSigned(stats.totalPnl)}%</span>
        </div>
        {(stats.bestTrade || stats.worstTrade) && (
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {stats.bestTrade && <span>Best: <span className="neon-green">{stats.bestTrade.ticker} {fmtPctSigned(stats.bestTrade.pnl_pct)}%</span></span>}
            {stats.worstTrade && <span>Worst: <span className="neon-red">{stats.worstTrade.ticker} {fmtPctSigned(stats.worstTrade.pnl_pct)}%</span></span>}
          </div>
        )}
      </div>

      {/* ── Active Positions ── */}
      {active.length > 0 && (
        <div className="panel p-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground mb-2">Active Positions ({active.length})</div>
          <div className="space-y-2">
            {active.map((t, i) => (
              <div key={i} className="p-2.5 rounded bg-[#141a24] border-l-[3px] border-l-amber-400">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-400 text-[10px]">⚡</span>
                  <span className="text-xs font-bold">{t.ticker}</span>
                  {badge(t.direction, t.direction === "LONG" ? "text-green-400 border-green-400/30 bg-green-400/10" : "text-red-400 border-red-400/30 bg-red-400/10")}
                  {t.leverage > 1 && <span className="text-[9px] neon-amber">{t.leverage}x</span>}
                  {t.confidence ? <span className="text-[9px] text-muted-foreground">Conf: {t.confidence}%</span> : null}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>Entry: {t.entry_price ? fmtDollarPrice(t.entry_price) : <span className="text-red-400 font-bold">⚠️ NO ENTRY</span>}</span>
                  {t.stop_price && <span>Stop: {fmtDollarPrice(t.stop_price)}</span>}
                  {t.target_price && <span>Target: {fmtDollarPrice(t.target_price)}</span>}
                  <span>Opened: {timeAgo(t.opened_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Trade History ── */}
      <div className="panel p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">Trade History</span>
          <div className="flex gap-1">
            {(["ALL", "WINS", "LOSSES"] as Filter[]).map(f => (
              <button key={f} onClick={() => { setFilter(f); setShowCount(20); }}
                className={cn("px-2 py-1 rounded text-[9px] font-bold uppercase transition-colors",
                  filter === f ? "bg-[rgba(0,255,136,0.15)] text-[#00ff88] border border-[rgba(0,255,136,0.3)]" : "text-muted-foreground hover:text-foreground hover:bg-[rgba(0,240,255,0.04)]"
                )}>{f}</button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No trades.</div>
        ) : (
          <div className="space-y-1">
            {visible.map((t, i) => {
              const pnl = t.pnl_pct ?? 0;
              const icon = pnl > 0 ? "\u2705" : pnl < 0 ? "\u274c" : "\u2796";
              return (
                <div key={i} className="px-3 py-2 rounded hover:bg-[rgba(0,240,255,0.03)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{icon}</span>
                      <span className="text-xs font-bold">{t.ticker}</span>
                      {badge(t.direction, t.direction === "LONG" ? "text-green-400 border-green-400/30 bg-green-400/10" : "text-red-400 border-red-400/30 bg-red-400/10")}
                      <span className={cn("text-xs font-mono font-bold", pnl >= 0 ? "neon-green" : "neon-red")}>{fmtPctSigned(pnl)}%</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(t.closed_at ?? null)}</span>
                  </div>
                  <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5 ml-7">
                    {t.entry_price != null && t.exit_price != null && <span>{fmtDollarPrice(t.entry_price)} → {fmtDollarPrice(t.exit_price)}</span>}
                    {t.leverage > 1 && <span>{t.leverage}x</span>}
                    {t.hold_duration && <span>{t.hold_duration}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {filtered.length > showCount && (
          <button onClick={() => setShowCount(c => c + 20)} className="w-full mt-2 py-2 text-[10px] text-muted-foreground hover:text-foreground text-center rounded hover:bg-[rgba(0,240,255,0.04)]">
            Load More ({filtered.length - showCount} remaining)
          </button>
        )}
      </div>

      {/* ── Manual Journal ── */}
      <div className="panel p-3">
        <button onClick={() => setShowManual(!showManual)} className="flex items-center gap-2 w-full text-left">
          {showManual ? <ChevronDown className="h-3 w-3 neon-text" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">Manual Journal ({manual.length})</span>
        </button>
        {showManual && (
          <div className="mt-3 space-y-2">
            <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Trade</button>

            {openManual.length > 0 && (
              <div className="space-y-1">
                <div className="text-[9px] text-muted-foreground uppercase mt-2">Open</div>
                {openManual.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded bg-[rgba(0,240,255,0.03)] border border-[rgba(0,240,255,0.08)]">
                    <div>
                      <span className="font-bold text-xs">{t.ticker}</span> {badge(t.direction, t.direction === "LONG" ? "text-green-400 border-green-400/30 bg-green-400/10" : "text-red-400 border-red-400/30 bg-red-400/10")}
                      <div className="text-[10px] text-muted-foreground mt-1">{t.entry_price ? fmtDollarPrice(t.entry_price) : "\u2014"} {t.leverage}x {timeAgo(t.opened_at)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setCloseId(t.id!); setClosePrice(""); }} className="text-[10px] px-2 py-1 rounded border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10">Close</button>
                      <button onClick={() => deleteManual(t.id!)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {closedManual.length > 0 && (
              <div className="space-y-1">
                <div className="text-[9px] text-muted-foreground uppercase mt-2">Closed</div>
                {closedManual.map(t => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-[rgba(0,240,255,0.03)]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{t.outcome === "WIN" ? "\u2705" : t.outcome === "LOSS" ? "\u274c" : "\u2796"}</span>
                      <span className="text-xs font-bold">{t.ticker} {t.direction}</span>
                      {t.pnl_pct != null && <span className={cn("text-xs font-mono", t.pnl_pct >= 0 ? "neon-green" : "neon-red")}>{fmtPctSigned(t.pnl_pct)}%</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">manual</span>
                      <button onClick={() => deleteManual(t.id!)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Manual Trade">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Ticker" value={form.ticker} onChange={e => setForm(p => ({ ...p, ticker: e.target.value }))} placeholder="BTC" />
          <Select label="Direction" options={["LONG", "SHORT"]} value={form.direction} onChange={e => setForm(p => ({ ...p, direction: e.target.value }))} />
          <Input label="Entry Price" type="number" step="any" value={form.entry_price} onChange={e => setForm(p => ({ ...p, entry_price: e.target.value }))} />
          <Input label="Leverage" type="number" step="any" value={form.leverage} onChange={e => setForm(p => ({ ...p, leverage: e.target.value }))} />
          <Input label="Stop Loss" type="number" step="any" value={form.stop_loss} onChange={e => setForm(p => ({ ...p, stop_loss: e.target.value }))} />
          <Input label="Target" type="number" step="any" value={form.target} onChange={e => setForm(p => ({ ...p, target: e.target.value }))} />
        </div>
        <TextArea label="Notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        <button onClick={createManual} className="btn-primary w-full py-2 text-xs mt-2">Create Trade</button>
      </Modal>

      <Modal open={closeId !== null} onClose={() => setCloseId(null)} title="Close Trade">
        <Input label="Exit Price" type="number" step="any" value={closePrice} onChange={e => setClosePrice(e.target.value)} autoFocus />
        <button onClick={closeManual} className="btn-primary w-full py-2 text-xs mt-2">Close & Calculate P&L</button>
      </Modal>
    </div>
  );
}
