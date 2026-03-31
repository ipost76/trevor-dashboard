"use client";
import { useEffect, useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import Link from "next/link";
import { DirectionBadge } from "@/components/ui/direction-badge";

/* ── Types (unchanged) ── */
type Signal = {
  ticker: string; direction?: string; confidence: number;
  signal_type?: string; outcome?: string; timestamp?: string; created_at?: string;
};
type ActiveTrade = {
  ticker: string; direction: string; entry_price: number;
  current_price?: number; pnl_pct?: number; leverage?: number;
  leveraged_pnl_pct?: number;
};
type AutoData = {
  status: string;
  positions: Array<Record<string, unknown>>;
  recentTrades: Array<Record<string, unknown>>;
  recentSignals: Array<Record<string, unknown>>;
  stats: { total: number; wins: number; losses: number; winRate: number; profitFactor: number; totalPnl: number };
  dailyPnl: number;
  budget: { spent: number; remaining: number; calls: number; exceeded: boolean };
};

type DashboardData = {
  xp: number; rank: string; totalInsights: number; todayCost: number;
  recentSignals: Signal[]; activeTrades: ActiveTrade[];
  logTail: string[];
  winRate: number; totalTrades: number; profitFactor: number | null;
  avgPnl: number; totalPnl: number; wins: number; losses: number;
  avgWin: number; avgLoss: number; rrRatio: number; expectancy: number;
  bestTrade: number; worstTrade: number;
  calibration: Record<string, { trades: number; wins: number; winRate: number | null }>;
  chatMessages: Array<{ role: string; content: string; timestamp?: string }>;
  chatHealth: boolean;
  auto: AutoData | null;
};

const EMPTY: DashboardData = {
  xp: 0, rank: "Unknown", totalInsights: 0, todayCost: 0,
  recentSignals: [], activeTrades: [], logTail: [],
  winRate: 0, totalTrades: 0, profitFactor: null, avgPnl: 0,
  totalPnl: 0, wins: 0, losses: 0,
  avgWin: 0, avgLoss: 0, rrRatio: 0, expectancy: 0,
  bestTrade: 0, worstTrade: 0,
  calibration: {},
  chatMessages: [], chatHealth: false,
  auto: null,
};

type KillSwitchState = { active: boolean; activated_at?: string; reason?: string };
type SystemHealth = {
  scanner?: { status: string; last_signal_at: string | null };
  signals?: { today: number; seven_day_avg: number; change_pct: number };
  api?: { hyperliquid: { healthy: boolean; latency_ms: number } };
  kill_switch?: { active: boolean };
  autotrader_paused?: { active: boolean; reason?: string };
};

/* ── Colors ── */
const C = {
  bg: "#0a0e14",
  surface: "var(--card)",
  surfaceRaised: "#161e28",
  border: "var(--border)",
  borderSolid: "#1e2a3a",
  accent: "#00ff88",
  accentDim: "rgba(0,255,136,0.12)",
  accentGlow: "rgba(0,255,136,0.25)",
  red: "#ff3b5c",
  redDim: "rgba(255,59,92,0.12)",
  redGlow: "rgba(255,59,92,0.2)",
  yellow: "#ffb800",
  yellowDim: "rgba(255,184,0,0.12)",
  cyan: "#00d4ff",
  cyanDim: "rgba(0,212,255,0.1)",
  textPrimary: "#e8edf4",
  textSecondary: "#7a8a9e",
  textTertiary: "#4a5568",
};

/* ── Main Component ── */
export function DashboardView() {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState<KillSwitchState>({ active: false });
  const [health, setHealth] = useState<SystemHealth>({});
  const [ksConfirm, setKsConfirm] = useState<"activate" | "deactivate" | null>(null);
  const [ksLoading, setKsLoading] = useState(false);
  const [clock, setClock] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchDashboard = useCallback(async () => {
    const [live, sq] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/live", null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeFetch<any>("/api/signal-quality", null),
    ]);
    setData({
      xp: live?.xp ?? 0,
      rank: live?.rank ?? "Unknown",
      totalInsights: live?.signals?.total ?? live?.totalInsights ?? 0,
      todayCost: live?.todayCost ?? live?.cost_today ?? 0,
      recentSignals: live?.recentSignals ?? [],
      activeTrades: live?.activeTrades ?? live?.activeScalps ?? [],
      logTail: live?.logTail ?? live?.logs ?? [],
      winRate: sq?.overall?.winRate ?? 0,
      totalTrades: sq?.overall?.totalTrades ?? 0,
      profitFactor: sq?.overall?.profitFactor ?? null,
      avgPnl: sq?.overall?.avgPnl ?? 0,
      totalPnl: sq?.overall?.totalPnl ?? 0,
      wins: sq?.overall?.wins ?? 0,
      losses: sq?.overall?.losses ?? 0,
      avgWin: sq?.overall?.avgWin ?? 0,
      avgLoss: sq?.overall?.avgLoss ?? 0,
      rrRatio: sq?.overall?.rrRatio ?? 0,
      expectancy: sq?.overall?.expectancy ?? 0,
      bestTrade: sq?.overall?.bestTrade ?? 0,
      worstTrade: sq?.overall?.worstTrade ?? 0,
      calibration: sq?.calibration ?? {},
      chatMessages: [],
      chatHealth: false,
      auto: null,
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchDashboard(); const i = setInterval(fetchDashboard, 30000); return () => clearInterval(i); }, [fetchDashboard]);

  useEffect(() => {
    const fetchKs = async () => {
      const [ks, sh] = await Promise.all([
        safeFetch<KillSwitchState>("/api/kill-switch", { active: false }),
        safeFetch<SystemHealth>("/api/system-health", {}),
      ]);
      if (ks) setKillSwitch(ks);
      if (sh) setHealth(sh);
    };
    fetchKs();
    const iv = setInterval(fetchKs, 10000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" }));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const toggleKillSwitch = async () => {
    setKsLoading(true);
    try {
      const action = killSwitch.active ? "deactivate" : "activate";
      const res = await fetch("/api/kill-switch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: `${action === "activate" ? "Emergency stop" : "Resumed"} via Hub` }),
      });
      const d = await res.json();
      setKillSwitch({ active: d.active });
    } catch { /* ignore */ }
    setKsLoading(false);
    setKsConfirm(null);
  };

  useEffect(() => {
    if (!data.activeTrades.length) return;
    const tickers = [...new Set(data.activeTrades.map(t => t.ticker?.replace("-PERP", "").replace("/USD", "")))].filter(Boolean).join(",");
    if (!tickers) return;
    const fp = async () => {
      try {
        const res = await fetch(`/api/prices?tickers=${tickers}`);
        const d = await res.json();
        const p: Record<string, number> = {};
        for (const [k, v] of Object.entries(d.prices || {})) p[k] = (v as { price: number }).price;
        setLivePrices(p);
      } catch { /* ignore */ }
    };
    fp(); const iv = setInterval(fp, 30000); return () => clearInterval(iv);
  }, [data.activeTrades]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textTertiary, fontFamily: "var(--font-mono)", fontSize: 12 }}>
        Loading...
      </div>
    );
  }

  const decided = data.wins + data.losses;
  const winPct = decided > 0 ? ((data.wins / decided) * 100) : 0;
  const winBarPct = decided > 0 ? (data.wins / decided) * 100 : 50;
  const apiMs = health.api?.hyperliquid?.latency_ms ?? 0;
  const apiOk = health.api?.hyperliquid?.healthy ?? false;
  const hasActive = data.activeTrades.length > 0;

  const edgeFix = data.expectancy < 0 && data.rrRatio < 1
    ? "WR and R:R both underwater"
    : data.expectancy < 0
    ? `Need WR > ${(1 / (1 + data.rrRatio) * 100).toFixed(0)}%`
    : null;
  const asymmetric = Math.abs(data.worstTrade) > data.bestTrade;

  return (
    <>
      <style>{`
        @keyframes pulseRing { 0% { transform: scale(0.5); opacity: 0.4; } 100% { transform: scale(1.3); opacity: 0; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Kill Switch Dialog */}
      {ksConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)" }}>
          <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 10, padding: 16, maxWidth: 340, width: "calc(100% - 32px)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
              {ksConfirm === "activate" ? "HALT ALL SYSTEMS?" : "RESUME ALL SYSTEMS?"}
            </div>
            <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 14, lineHeight: 1.4 }}>
              {ksConfirm === "activate" ? "This will halt ALL signal generation and AutoTrader execution." : "Resume all signal generation and AutoTrader execution?"}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setKsConfirm(null)} style={{ padding: "6px 12px", fontSize: 11, borderRadius: 4, border: `1px solid ${C.borderSolid}`, background: "transparent", color: C.textSecondary, cursor: "pointer" }}>Cancel</button>
              <button onClick={toggleKillSwitch} disabled={ksLoading} style={{ padding: "6px 12px", fontSize: 11, borderRadius: 4, border: "none", background: ksConfirm === "activate" ? "#dc2626" : "#16a34a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {ksLoading ? "..." : ksConfirm === "activate" ? "CONFIRM HALT" : "CONFIRM RESUME"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 90 }}>

        {/* ─── 1. TOP BAR (sticky) ─── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 100, padding: "12px 16px 8px",
          background: `linear-gradient(to bottom, ${C.bg} 70%, transparent)`,
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ position: "relative", width: 7, height: 7 }}>
              <span style={{ position: "absolute", inset: -4, borderRadius: "50%", background: C.accent, opacity: 0.25, animation: "pulseRing 2s ease-out infinite" }} />
              <span style={{ display: "block", width: 7, height: 7, borderRadius: "50%", background: C.accent, boxShadow: `0 0 6px ${C.accent}` }} />
            </span>
            <span style={{ fontFamily: "Orbitron, sans-serif", fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 1 }}>LIVE</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.textTertiary }}>{clock}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: C.cyan }}>⚡{data.xp}</span>
          </div>
        </div>

        <div style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* ─── 2. SYSTEM STATUS STRIP ─── */}
          <div style={{
            background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 8,
            padding: "8px 12px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 6,
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {killSwitch.active ? (
                <Badge color={C.red} bg={C.redDim} onClick={() => setKsConfirm("deactivate")}>HALTED</Badge>
              ) : (
                <Badge color={C.accent} bg={C.accentDim}>Scanner {health.scanner?.status === "running" ? "OK" : "?"}</Badge>
              )}
              <Badge color={apiOk && apiMs <= 200 ? C.accent : C.yellow} bg={apiOk && apiMs <= 200 ? C.accentDim : C.yellowDim}>
                API {apiMs}ms
              </Badge>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.textSecondary }}>
                {health.signals?.today ?? 0} signals
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {health.autotrader_paused?.active && (
                <Badge color={C.yellow} bg={C.yellowDim} glow>AT: PAUSED</Badge>
              )}
              {!killSwitch.active && (
                <button onClick={() => setKsConfirm("activate")} style={{
                  background: "transparent", border: `1px solid rgba(255,59,92,0.25)`, borderRadius: 4,
                  padding: "3px 8px", fontSize: 9, fontWeight: 700, color: "rgba(255,59,92,0.7)",
                  fontFamily: "var(--font-mono)", letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer",
                }}>STOP</button>
              )}
            </div>
          </div>

          {/* ─── 3. ACTIVE TRADES ─── */}
          <Link href="/trades" style={{ textDecoration: "none", color: "inherit", animation: "slideUp 0.4s ease" }}>
            <div style={{
              background: C.surface, borderRadius: 10, padding: "14px 16px",
              border: hasActive ? `1px solid rgba(0,255,136,0.25)` : `1px solid ${C.borderSolid}`,
              boxShadow: hasActive ? `0 0 20px ${C.accentGlow}, inset 0 1px 0 rgba(0,255,136,0.1)` : undefined,
            }}>
              <SectionHeader icon="⚡" label="ACTIVE TRADES" count={data.activeTrades.length} chevron />
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {hasActive ? data.activeTrades.map((t, i) => {
                  const tk = t.ticker?.replace("-PERP", "").replace("/USD", "") || "";
                  const lp = livePrices[tk] || t.current_price;
                  let pnl = t.leveraged_pnl_pct ?? t.pnl_pct ?? 0;
                  if (lp && t.entry_price && t.entry_price > 0) {
                    const raw = t.direction?.toUpperCase() === "SHORT"
                      ? ((t.entry_price - lp) / t.entry_price) * 100
                      : ((lp - t.entry_price) / t.entry_price) * 100;
                    pnl = raw * (t.leverage || 1);
                  }
                  return (
                    <div key={i} style={{
                      background: C.surfaceRaised, border: `1px solid ${C.borderSolid}`, borderRadius: 8,
                      padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "Orbitron, sans-serif", fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{tk}</span>
                        <DirectionBadge dir={t.direction} />
                        {t.leverage && t.leverage > 1 && (
                          <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 600 }}>{t.leverage}x</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {lp && <span style={{ fontSize: 11, color: C.textSecondary, fontFamily: "var(--font-mono)" }}>{fmtDollarPrice(lp)}</span>}
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: pnl >= 0 ? C.accent : C.red }}>
                          {fmtPctSigned(pnl)}%
                        </span>
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ textAlign: "center", padding: "12px 0", color: C.textTertiary, fontSize: 11, fontStyle: "italic" }}>
                    No active trades
                  </div>
                )}
              </div>
            </div>
          </Link>

          {/* ─── 4. P&L HERO ─── */}
          <div style={{
            background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 10,
            padding: "20px 16px 18px", textAlign: "center", animation: "slideUp 0.5s ease",
          }}>
            <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 1.2, textTransform: "uppercase", color: C.textTertiary, fontFamily: "var(--font-mono)" }}>TOTAL P&L</div>
            <div style={{
              fontFamily: "Orbitron, sans-serif", fontSize: 38, fontWeight: 800, letterSpacing: -1,
              color: data.totalPnl >= 0 ? C.accent : C.red, margin: "6px 0 14px",
              textShadow: `0 0 30px ${data.totalPnl >= 0 ? C.accentGlow : C.redGlow}`,
            }}>
              {fmtPctSigned(data.totalPnl)}%
            </div>

            {/* W/L Visual Bar */}
            <div style={{ width: "100%", height: 4, borderRadius: 2, background: "#151d28", display: "flex", overflow: "hidden" }}>
              <div style={{ width: `${winBarPct}%`, background: C.accent, borderRadius: "2px 0 0 2px" }} />
              <div style={{ flex: 1, background: "rgba(255,59,92,0.6)", borderRadius: "0 2px 2px 0" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: C.accent }}>{data.wins}W</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: C.textTertiary }}>{winPct.toFixed(1)}%</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: C.red }}>{data.losses}L</span>
            </div>

            <div style={{ height: 1, background: C.borderSolid, margin: "14px 0 12px" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, textAlign: "center" }}>
              <MiniStat label="WIN RATE" value={`${winPct.toFixed(1)}%`} color={C.accent} />
              <MiniStat label="ACTIVE" value={String(data.activeTrades.length)} color={C.textPrimary} />
            </div>
          </div>

          {/* ─── 5. XP / SIGNALS / AVG P&L ─── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, animation: "slideUp 0.55s ease" }}>
            <CompactCard label="XP" value={String(data.xp)} sub={data.rank} valueColor={C.cyan} />
            <CompactCard label="SIGNALS" value={String(data.totalInsights)} sub="Lifetime" />
            <CompactCard label="AVG P&L" value={`${fmtPctSigned(data.avgPnl)}%`} sub="Per trade" valueColor={data.avgPnl >= 0 ? C.accent : C.red} />
          </div>

          {/* ─── 6. EDGE ANALYSIS ─── */}
          {data.totalTrades > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 10, padding: "14px 16px", animation: "slideUp 0.6s ease" }}>
              <SectionHeader icon="🔬" label="EDGE ANALYSIS" />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "12px 0 14px" }}>
                {/* R:R Ratio */}
                <div style={{ background: C.surfaceRaised, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.borderSolid}` }}>
                  <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono)" }}>R:R RATIO</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: data.rrRatio >= 1 ? C.accent : C.red, marginTop: 2 }}>
                    {data.rrRatio.toFixed(2)}R
                  </div>
                  <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 6, display: "flex", gap: 4 }}>
                    <span style={{ color: C.accent }}>W: +{data.avgWin}%</span>
                    <span style={{ color: C.textTertiary }}>·</span>
                    <span style={{ color: C.red }}>L: {data.avgLoss}%</span>
                  </div>
                </div>

                {/* Expectancy */}
                <div style={{ background: C.surfaceRaised, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.borderSolid}` }}>
                  <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono)" }}>EXPECTANCY</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)", color: data.expectancy >= 0 ? C.accent : C.red, marginTop: 2 }}>
                    {fmtPctSigned(data.expectancy)}%
                  </div>
                  {/* Expectancy bar */}
                  <div style={{ marginTop: 6, position: "relative", height: 4, background: "#151d28", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: "50%", top: -1, width: 1, height: 6, background: C.textTertiary }} />
                    {data.expectancy < 0 ? (
                      <div style={{ position: "absolute", right: "50%", top: 0, height: 4, width: `${Math.min(Math.abs(data.expectancy), 10) / 20 * 100}%`, background: C.red, borderRadius: 2 }} />
                    ) : (
                      <div style={{ position: "absolute", left: "50%", top: 0, height: 4, width: `${Math.min(data.expectancy, 10) / 20 * 100}%`, background: C.accent, borderRadius: 2 }} />
                    )}
                  </div>
                </div>
              </div>

              {/* Advisory Banner */}
              {edgeFix && (
                <div style={{
                  background: C.yellowDim, border: "1px solid rgba(255,184,0,0.25)", borderRadius: 6,
                  padding: "8px 10px", marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 6,
                }}>
                  <span style={{ fontSize: 11, marginTop: 1 }}>⚠️</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: C.yellow, fontWeight: 500, lineHeight: 1.4 }}>
                    Fix: {edgeFix}
                  </span>
                </div>
              )}

              {/* Best / Worst */}
              <div style={{
                background: C.surfaceRaised, border: `1px solid ${C.borderSolid}`, borderRadius: 6,
                padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono)" }}>BEST</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: "var(--font-mono)" }}>+{data.bestTrade}%</div>
                </div>
                <div style={{ width: 1, height: 28, background: C.borderSolid }} />
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono)" }}>WORST</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.red, fontFamily: "var(--font-mono)" }}>{data.worstTrade}%</div>
                </div>
                {asymmetric && (
                  <Badge color={C.red} bg={C.redDim} small>asymmetric ↓</Badge>
                )}
              </div>
            </div>
          )}

          {/* ─── 7. SIGNALS & QUALITY ─── */}
          <Link href="/signals" style={{ textDecoration: "none", color: "inherit", animation: "slideUp 0.65s ease" }}>
            <div style={{
              background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 10,
              padding: "14px 16px", cursor: "pointer",
            }}>
              <SectionHeader icon="⚡" label="SIGNALS & QUALITY" chevron />
              {data.totalTrades > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, textAlign: "center", marginTop: 12 }}>
                  <MiniStat label="WIN %" value={`${data.winRate}%`} color={C.accent} />
                  <MiniStat label="TRADES" value={String(data.totalTrades)} color={C.textPrimary} />
                  <MiniStat label="PF" value={data.profitFactor != null ? data.profitFactor.toFixed(1) : "\u2014"} color={data.profitFactor != null && data.profitFactor >= 1 ? C.accent : C.red} />
                  <MiniStat label="P&L" value={`${fmtPctSigned(data.totalPnl)}%`} color={data.totalPnl >= 0 ? C.accent : C.red} />
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "12px 0", fontSize: 11, color: C.textTertiary }}>No trade data yet</div>
              )}
            </div>
          </Link>

        </div>
      </div>
    </>
  );
}

/* ── Sub-Components ── */

function Badge({ color, bg, glow, small, children, onClick }: {
  color: string; bg: string; glow?: boolean; small?: boolean; children: React.ReactNode; onClick?: () => void;
}) {
  return (
    <span onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: small ? "2px 6px" : "3px 8px", borderRadius: 4,
      fontSize: small ? 9 : 10, fontWeight: 600, fontFamily: "var(--font-mono)",
      letterSpacing: 0.5, textTransform: "uppercase",
      color, background: bg,
      boxShadow: glow ? `0 0 12px ${bg}` : undefined,
      cursor: onClick ? "pointer" : undefined,
    }}>
      {children}
    </span>
  );
}

function SectionHeader({ icon, label, count, chevron }: {
  icon: string; label: string; count?: number; chevron?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.textSecondary }}>{label}</span>
        {count != null && count > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, background: C.accentDim, color: C.accent, borderRadius: 4, padding: "1px 5px" }}>{count}</span>
        )}
      </div>
      {chevron && <ChevronRight size={14} color={C.textTertiary} />}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || C.textPrimary, fontFamily: "var(--font-mono)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CompactCard({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "var(--font-mono)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: valueColor || C.textPrimary, fontFamily: "var(--font-mono)", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 8, color: valueColor ? `${valueColor}99` : C.textTertiary, marginTop: 3, fontFamily: "var(--font-mono)" }}>{sub}</div>}
    </div>
  );
}
