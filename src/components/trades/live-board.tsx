"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, X, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type LiveTicker = {
  ticker: string;
  direction: string;
  confidence: number;
  regime: string;
  current_price: number;
  momentum_score: number;
  trend_score: number;
  volume_score: number;
  volatility_score: number;
  microstructure_score: number;
  insight_line: string;
  updated_at: string;
};

function scoreColor(v: number): string {
  if (v >= 60) return "var(--neon-green)";
  if (v >= 40) return "var(--neon-amber)";
  return "var(--neon-red)";
}

function confColor(v: number): string {
  if (v >= 60) return "neon-green";
  if (v >= 40) return "neon-amber";
  return "neon-red";
}

function dirEmoji(d: string) {
  if (d === "LONG") return "🟢";
  if (d === "SHORT") return "🔴";
  return "⚪";
}

function dirColor(d: string) {
  if (d === "LONG") return "var(--neon-green)";
  if (d === "SHORT") return "var(--neon-red)";
  return "#8b9bb4";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function LiveBoard() {
  const [tickers, setTickers] = useState<LiveTicker[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [addError, setAddError] = useState("");
  const [enteringTrade, setEnteringTrade] = useState<string | null>(null);
  const [enterResult, setEnterResult] = useState<Record<string, "ok" | "fail">>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [tradeStats, setTradeStats] = useState<Record<string, { wins: number; losses: number; trades: number; wr: number }>>({});
  const [blockedCombos, setBlockedCombos] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/live-board");
      const data = await res.json();
      setTickers(data.tickers || []);
      setLastScan(data.last_scan || null);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // Fetch historical trade stats
  useEffect(() => {
    fetch("/api/trade-stats").then(r => r.json()).then(d => {
      setTradeStats(d.stats || {});
      setBlockedCombos(d.blocked || []);
    }).catch(() => {});
  }, []);

  const handleAdd = async () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    setAddError("");
    try {
      const res = await fetch("/api/live-board/ticker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ADD", ticker: t }),
      });
      const data = await res.json();
      if (data.error) {
        setAddError(data.error);
        return;
      }
      setShowAdd(false);
      setNewTicker("");
      fetchData();
    } catch {
      setAddError("Network error");
    }
  };

  const handleRemove = async (ticker: string) => {
    setConfirmRemove(null);
    try {
      await fetch("/api/live-board/ticker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REMOVE", ticker }),
      });
      fetchData();
    } catch {
      /* ignore */
    }
  };

  const handleEnter = async (t: LiveTicker) => {
    if (enteringTrade) return;
    setEnteringTrade(t.ticker);
    setEnterResult((p) => ({ ...p, [t.ticker]: undefined as unknown as "ok" }));
    try {
      const res = await fetch("/api/live-board/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: t.ticker,
          direction: t.direction === "NEUTRAL" ? "LONG" : t.direction,
          current_price: t.current_price,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setEnterResult((p) => ({ ...p, [t.ticker]: "fail" }));
      } else {
        setEnterResult((p) => ({ ...p, [t.ticker]: "ok" }));
      }
    } catch {
      setEnterResult((p) => ({ ...p, [t.ticker]: "fail" }));
    } finally {
      setEnteringTrade(null);
      setTimeout(() => {
        setEnterResult((p) => {
          const next = { ...p };
          delete next[t.ticker];
          return next;
        });
      }, 2000);
    }
  };

  if (loading) {
    return (
      <div className="p-3 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 max-w-[600px] mx-auto">
      {/* Header toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-mono">
          Last scan: {relativeTime(lastScan)}
          {lastScan && (() => {
            const ms = Date.now() - new Date(lastScan).getTime();
            if (ms > 180000) return <span style={{ color: "#ff3355", marginLeft: 6 }}>⚠ stale</span>;
            return null;
          })()}
        </span>
        {showAdd ? (
          <div className="flex items-center gap-1.5">
            <input
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="TICKER"
              maxLength={10}
              className="input-terminal text-[11px] w-24 px-2 py-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <button
              onClick={handleAdd}
              className="text-[9px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(0,255,136,0.1)] text-[var(--neon-green)] border border-[rgba(0,255,136,0.3)] rounded hover:bg-[rgba(0,255,136,0.2)] transition-colors"
            >
              ADD
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setNewTicker("");
                setAddError("");
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
            {addError && (
              <span className="text-[9px] neon-red">{addError}</span>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-[9px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(0,255,136,0.1)] text-[var(--neon-green)] border border-[rgba(0,255,136,0.3)] rounded hover:bg-[rgba(0,255,136,0.2)] transition-colors"
          >
            <Plus className="h-3 w-3" /> Add Ticker
          </button>
        )}
      </div>

      {/* Ticker cards */}
      {tickers.length === 0 ? (
        <EmptyState
          icon={Radio}
          message="No tickers on the Live Board yet."
          sub='Tap "+ Add Ticker" above to get started.'
        />
      ) : (
        tickers.map((t) => {
          const isNeutral = t.direction === "NEUTRAL";
          const enterState = enterResult[t.ticker];
          const isEntering = enteringTrade === t.ticker;

          return (
            <div
              key={t.ticker}
              className={cn(
                "panel rounded-lg p-4 space-y-3 border border-[var(--border)]",
                isNeutral && "opacity-60",
                enterState === "ok" && "border-[var(--neon-green)] transition-colors duration-500"
              )}
            >
              {/* Row 1: Ticker + Price + Remove */}
              <div className="flex items-center justify-between">
                <span className="font-bold text-lg tracking-wider neon-green">
                  {t.ticker}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-base text-foreground">
                    {fmtDollarPrice(t.current_price)}
                  </span>
                  {confirmRemove === t.ticker ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRemove(t.ticker)}
                        className="text-[8px] px-1.5 py-0.5 neon-red border border-[rgba(255,51,102,0.3)] rounded"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="text-[8px] px-1.5 py-0.5 text-muted-foreground border border-[var(--border)] rounded"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemove(t.ticker)}
                      className="text-[#3d4f5f] hover:text-muted-foreground transition-colors"
                      title="Remove from watchlist"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="border-t border-[#1a2332]" />

              {/* Row 2: Direction + Confidence + Regime */}
              <div className="flex items-center gap-4 text-[13px] font-mono">
                <span className="font-bold" style={{ color: dirColor(t.direction) }}>
                  {dirEmoji(t.direction)} {t.direction}
                </span>
                <span>
                  CONF:{" "}
                  <span className={confColor(t.confidence)}>
                    {t.confidence.toFixed(1)}%
                  </span>
                </span>
                <span className="text-muted-foreground">
                  REGIME: {t.regime}
                </span>
              </div>

              <div className="border-t border-[#1a2332]" />

              {/* Row 3: 5 Confluence Scores */}
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[12px] font-mono">
                {[
                  { label: "MOM", val: t.momentum_score },
                  { label: "TRD", val: t.trend_score },
                  { label: "VOL", val: t.volume_score },
                  { label: "VLT", val: t.volatility_score },
                  { label: "MIC", val: t.microstructure_score },
                ].map((s) => (
                  <span key={s.label}>
                    <span className="text-muted-foreground">{s.label}:</span>{" "}
                    <span style={{ color: scoreColor(s.val) }}>
                      {s.val.toFixed(1)}
                    </span>
                  </span>
                ))}
              </div>

              <div className="border-t border-[#1a2332]" />

              {/* Row 4: Historical win rate */}
              {(() => {
                const key = `${t.ticker}_${t.direction}`;
                const stat = tradeStats[key];
                if (stat) {
                  const wrColor = stat.wr >= 55 ? "#00ff88" : stat.wr >= 40 ? "#ffaa00" : "#ff3355";
                  return (
                    <div className="text-[12px] font-mono" style={{ color: wrColor }}>
                      📊 {t.ticker} {t.direction}: {stat.wins}W/{stat.losses}L ({stat.wr}% WR)
                    </div>
                  );
                }
                return (
                  <div className="text-[12px] font-mono" style={{ color: t.insight_line ? "#a0b0c0" : "#3d4f5f" }}>
                    📊 {t.insight_line || "No trade history"}
                  </div>
                );
              })()}

              <div className="border-t border-[#1a2332]" />

              {/* Row 5: ENTER button or BLOCKED badge */}
              {blockedCombos.includes(`${t.ticker}_${t.direction}`) ? (
                <div className="w-full py-2.5 min-h-[44px] flex items-center justify-center font-mono font-bold text-sm tracking-wider rounded border border-[rgba(255,51,85,0.3)] bg-[rgba(255,51,85,0.06)] text-[var(--neon-red)]">
                  🚫 BLOCKED
                </div>
              ) : (
                <button
                  onClick={() => handleEnter(t)}
                  disabled={isEntering || !!enterState}
                  className={cn(
                    "w-full py-2.5 min-h-[44px] font-mono font-bold text-sm tracking-wider rounded border transition-all duration-200",
                    enterState === "ok"
                      ? "bg-[var(--neon-green)] text-[#0a0a0f] border-[var(--neon-green)]"
                      : enterState === "fail"
                        ? "border-[var(--neon-red)] text-[var(--neon-red)] bg-transparent"
                        : isEntering
                          ? "border-[#3d6b4a] text-[#3d6b4a] bg-transparent cursor-wait"
                          : "border-[var(--neon-green)] text-[var(--neon-green)] bg-transparent hover:bg-[var(--neon-green)] hover:text-[#0a0a0f]"
                  )}
                >
                  {enterState === "ok"
                    ? "✓ ENTERED"
                    : enterState === "fail"
                      ? "✗ FAILED"
                      : isEntering
                        ? "ENTERING..."
                        : "ENTER"}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
