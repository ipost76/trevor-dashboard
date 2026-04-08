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
  cg_funding_divergence: number | null;
  cg_oi_change_pct: number | null;
  cg_liq_magnet: string | null;
  cg_adjustment: number;
  lev_recommended: number | null;
  lev_vol_tier: string | null;
  lev_atr_percentile: number | null;
  mtf_h1_trend: string | null;
  mtf_h4_trend: string | null;
  mtf_alignment: string | null;
  mtf_adjustment: number;
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

function volTierColor(tier: string | null): string {
  if (!tier) return "#8b9bb4";
  if (tier === "CALM") return "#00ff88";
  if (tier === "NORMAL") return "#ffaa00";
  if (tier === "HIGH") return "#ff8800";
  return "#ff3355"; // EXTREME
}

function alignmentColor(align: string | null): string {
  if (!align) return "#8b9bb4";
  if (align === "FULL_ALIGNED") return "#00ff88";
  if (align === "PARTIAL") return "#ffaa00";
  if (align === "NEUTRAL") return "#8b9bb4";
  if (align === "CONFLICT") return "#ff8800";
  return "#ff3355"; // FULL_CONFLICT
}

function alignmentLabel(align: string | null): string {
  if (!align) return "—";
  const labels: Record<string, string> = {
    FULL_ALIGNED: "ALIGNED",
    PARTIAL: "PARTIAL",
    NEUTRAL: "NEUTRAL",
    CONFLICT: "CONFLICT",
    FULL_CONFLICT: "OPPOSED",
  };
  return labels[align] || align;
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
  const [confirmTrade, setConfirmTrade] = useState<LiveTicker | null>(null);
  const [preflight, setPreflight] = useState<{ capital: number; currentMargin: number; percentUsed: number; record: { total: number; wins: number; losses: number; wr: number }; blocked: boolean; blockReason: string | null } | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

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

              {/* Row 3.5: CoinGlass Derivatives Intel (BTC/ETH/SOL only) */}
              {(t.cg_funding_divergence !== null || t.cg_oi_change_pct !== null || t.cg_liq_magnet) && (
                <>
                  <div className="border-t border-[#1a2332]" />
                  <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[12px] font-mono">
                    <span>
                      <span className="text-muted-foreground">FR:</span>{" "}
                      <span style={{ color: (t.cg_funding_divergence || 0) > 0.02 ? "#ff4444" : (t.cg_funding_divergence || 0) < -0.02 ? "#00ff88" : "#8b9bb4" }}>
                        {t.cg_funding_divergence !== null ? `${(t.cg_funding_divergence * 100).toFixed(2)}%` : "—"}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">OI:</span>{" "}
                      <span style={{ color: (t.cg_oi_change_pct || 0) > 0 ? "#00ff88" : (t.cg_oi_change_pct || 0) < 0 ? "#ff4444" : "#8b9bb4" }}>
                        {t.cg_oi_change_pct !== null ? `${t.cg_oi_change_pct > 0 ? "+" : ""}${t.cg_oi_change_pct.toFixed(1)}%` : "—"}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">LIQ:</span>{" "}
                      <span style={{ color: t.cg_liq_magnet === "UP" ? "#00ff88" : t.cg_liq_magnet === "DOWN" ? "#ff4444" : "#8b9bb4" }}>
                        {t.cg_liq_magnet === "UP" ? "↑" : t.cg_liq_magnet === "DOWN" ? "↓" : "—"}
                      </span>
                    </span>
                  </div>
                  {t.cg_adjustment !== 0 && (
                    <div className="text-[10px] font-mono" style={{ color: t.cg_adjustment > 0 ? "#00ff88" : "#ff4444" }}>
                      🔮 CG: {t.cg_adjustment > 0 ? "+" : ""}{t.cg_adjustment} derivatives signal
                    </div>
                  )}
                </>
              )}

              {/* Row 3.6: Leverage Engine + MTF Alignment */}
              {(t.lev_recommended !== null || (t.mtf_alignment && t.mtf_alignment !== "NEUTRAL")) && (
                <>
                  <div className="border-t border-[#1a2332]" />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] font-mono">
                    {t.lev_recommended !== null && (
                      <span>
                        <span className="text-muted-foreground">LEV:</span>{" "}
                        <span style={{ color: volTierColor(t.lev_vol_tier) }}>
                          {t.lev_recommended.toFixed(1)}x
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          {" "}{t.lev_vol_tier} (p{t.lev_atr_percentile?.toFixed(0)})
                        </span>
                      </span>
                    )}
                    {t.mtf_alignment && t.mtf_alignment !== "NEUTRAL" && (
                      <span>
                        <span className="text-muted-foreground">MTF:</span>{" "}
                        <span style={{ color: alignmentColor(t.mtf_alignment) }}>
                          {alignmentLabel(t.mtf_alignment)}
                        </span>
                        {t.mtf_adjustment !== 0 && (
                          <span style={{ color: t.mtf_adjustment > 0 ? "#00ff88" : "#ff4444" }}>
                            {" "}{t.mtf_adjustment > 0 ? "+" : ""}{t.mtf_adjustment}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {(t.mtf_h1_trend || t.mtf_h4_trend) && (t.mtf_alignment && t.mtf_alignment !== "NEUTRAL") && (
                    <div className="text-[10px] font-mono text-muted-foreground">
                      1h: {t.mtf_h1_trend || "—"} · 4h: {t.mtf_h4_trend || "—"}
                    </div>
                  )}
                </>
              )}

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
                  onClick={() => {
                    if (enterState) return;
                    setConfirmTrade(t);
                    setPreflightLoading(true);
                    setPreflight(null);
                    const dir = t.direction === "NEUTRAL" ? "LONG" : t.direction;
                    fetch(`/api/entry-preflight?ticker=${t.ticker}&direction=${dir}`)
                      .then(r => r.json())
                      .then(d => setPreflight(d))
                      .catch(() => setPreflight({ capital: 50, currentMargin: 0, percentUsed: 0, record: { total: 0, wins: 0, losses: 0, wr: 0 }, blocked: false, blockReason: null }))
                      .finally(() => setPreflightLoading(false));
                  }}
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

      {/* Entry Confirmation Modal */}
      {confirmTrade && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmTrade(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="panel w-full max-w-sm pointer-events-auto rounded-xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-center text-sm font-bold tracking-wider uppercase neon-text" style={{ fontFamily: "Orbitron, sans-serif" }}>
                Confirm Entry
              </h3>

              {/* Trade summary */}
              <div className="text-center space-y-1">
                <div className="text-lg font-bold" style={{ fontFamily: "Orbitron, sans-serif" }}>
                  {confirmTrade.ticker} <span style={{ color: confirmTrade.direction === "SHORT" ? "var(--neon-red)" : "var(--neon-green)" }}>
                    {confirmTrade.direction === "NEUTRAL" ? "LONG" : confirmTrade.direction}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  @ {fmtDollarPrice(confirmTrade.current_price)} · Conf: {confirmTrade.confidence.toFixed(1)}% · {confirmTrade.regime}
                </div>
              </div>

              <div className="border-t border-[var(--border)]" />

              {/* Pre-flight checklist */}
              {preflightLoading ? (
                <div className="text-center py-4 text-[11px] text-muted-foreground font-mono">Loading pre-flight data...</div>
              ) : preflight ? (
                <div className="space-y-3 text-[11px] font-mono">
                  {/* Confidence band */}
                  {(() => {
                    const conf = confirmTrade.confidence;
                    const bands = [
                      { min: 0, max: 44, label: "Low", wr: 40.0 },
                      { min: 45, max: 54, label: "Medium", wr: 61.9 },
                      { min: 55, max: 64, label: "High", wr: 40.0 },
                      { min: 65, max: 100, label: "Very High", wr: 50.0 },
                    ];
                    const band = bands.find(b => conf >= b.min && conf <= b.max);
                    if (!band) return null;
                    return (
                      <div className="py-2 border-b border-[rgba(0,255,136,0.06)]">
                        <div className="text-muted-foreground mb-1">📊 Confidence Band</div>
                        <div style={{ color: band.wr >= 50 ? "#00ff88" : band.wr >= 40 ? "#ffaa00" : "#ff3355" }}>
                          {band.min}–{band.max} ({band.label}) — {band.wr}% WR historically
                        </div>
                      </div>
                    );
                  })()}

                  {/* Exposure */}
                  <div className="py-2 border-b border-[rgba(0,255,136,0.06)]">
                    <div className="text-muted-foreground mb-1">💰 Exposure</div>
                    <div className="text-foreground">
                      ${preflight.currentMargin} / ${preflight.capital} ({preflight.percentUsed}% used)
                    </div>
                    {preflight.percentUsed >= 60 && (
                      <div className="mt-1 text-[10px] font-bold" style={{ color: "#ff3355" }}>⚠ HEAVY EXPOSURE</div>
                    )}
                    {preflight.percentUsed >= 40 && preflight.percentUsed < 60 && (
                      <div className="mt-1 text-[10px] font-bold" style={{ color: "#ffaa00" }}>⚠ CAUTION</div>
                    )}
                  </div>

                  {/* Track record */}
                  <div className="py-2 border-b border-[rgba(0,255,136,0.06)]">
                    <div className="text-muted-foreground mb-1">📈 Track Record: {confirmTrade.ticker} {confirmTrade.direction === "NEUTRAL" ? "LONG" : confirmTrade.direction}</div>
                    {preflight.record.total > 0 ? (
                      <div style={{ color: preflight.record.wr >= 50 ? "#00ff88" : preflight.record.wr >= 40 ? "#ffaa00" : "#ff3355" }}>
                        {preflight.record.wins}W / {preflight.record.losses}L ({preflight.record.wr}% WR)
                      </div>
                    ) : (
                      <div className="text-muted-foreground">No trade history</div>
                    )}
                  </div>

                  {/* Block status */}
                  {preflight.blocked && (
                    <div className="py-2 text-[var(--neon-red)] font-bold">
                      🚫 BLOCKED: {preflight.blockReason || "Filter rule active"}
                    </div>
                  )}
                  {!preflight.blocked && (
                    <div className="py-2 text-[#3d6b4a]">
                      🛡 No filter blocks for this entry
                    </div>
                  )}
                </div>
              ) : null}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setConfirmTrade(null)}
                  className="flex-1 py-3 min-h-[44px] rounded border border-[var(--border)] text-muted-foreground font-mono text-xs hover:bg-[rgba(0,240,255,0.04)] transition-colors"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => {
                    if (preflight?.blocked) return;
                    const trade = confirmTrade;
                    setConfirmTrade(null);
                    handleEnter(trade);
                  }}
                  disabled={preflight?.blocked}
                  className={cn(
                    "flex-1 py-3 min-h-[44px] rounded border font-mono text-xs font-bold transition-colors",
                    preflight?.blocked
                      ? "border-[rgba(255,51,85,0.3)] text-[var(--neon-red)] bg-[rgba(255,51,85,0.06)] opacity-50 cursor-not-allowed"
                      : "border-[var(--neon-green)] text-[var(--neon-green)] bg-[rgba(0,255,136,0.1)] hover:bg-[rgba(0,255,136,0.2)]"
                  )}
                >
                  {preflight?.blocked ? "BLOCKED" : "CONFIRM ENTRY"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
