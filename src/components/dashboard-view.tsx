"use client";
import { useEffect, useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { fmtDollarPrice, fmtPctSigned } from "@/lib/format";
import Link from "next/link";
import { DirectionBadge } from "@/components/ui/direction-badge";
// RemindersWidget removed 2026-04-25 — channel cleanup

/* ── Types (unchanged) ── */
type Signal = {
  ticker: string; direction?: string; confidence: number;
  signal_type?: string; outcome?: string; timestamp?: string; created_at?: string;
};
type ActiveTrade = {
  ticker: string; direction: string; entry_price: number;
  current_price?: number; pnl_pct?: number; leverage?: number;
  leveraged_pnl_pct?: number; confidence?: number; trade_id?: string;
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
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null);
  const [closeStatus, setCloseStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [filterCount, setFilterCount] = useState(0);
  const [filters, setFilters] = useState<{ rule_type: string; ticker?: string; direction?: string; value?: string; reason?: string }[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [streak, setStreak] = useState(0);
  const [lastPnl, setLastPnl] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [pnlCutoffDate, setPnlCutoffDate] = useState<string | null>(null);
  const [adminCapital, setAdminCapital] = useState(50);
  const [adminNewCap, setAdminNewCap] = useState("");
  const [adminModal, setAdminModal] = useState<"capital" | "pnl" | "xp" | "history" | "aggressive_on" | "aggressive_off" | null>(null);
  const [adminConfirmText, setAdminConfirmText] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminHistory, setAdminHistory] = useState<Array<{ id: number; reset_type: string; reset_at: string; old_value: string | null; new_value: string; notes: string | null }>>([]);
  const [aggressive, setAggressive] = useState<{
    enabled: boolean;
    threshold_delta: number;
    revert_at?: string | null;
    minutes_until_revert?: number | null;
    total_signals_fired?: number;
    cb_overall_status?: string;
    last_event?: { event_type: string; actor: string; timestamp: string } | null;
  } | null>(null);
  const [aggressiveDelta, setAggressiveDelta] = useState("-5");
  const [aggressiveHours, setAggressiveHours] = useState("48");

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
    setPnlCutoffDate(sq?.overall?.pnlCutoffDate ?? null);
    // Fetch admin state
    try {
      const adminState = await safeFetch<{ currentCapital?: number }>("/api/admin/current-state", { currentCapital: 50 });
      if (adminState?.currentCapital) setAdminCapital(adminState.currentCapital);
    } catch { /* non-critical */ }
    setLoading(false);
    setLastUpdated(Date.now());
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

  // Fetch filter rules + streak
  useEffect(() => {
    fetch("/api/nav-badges").then(r => r.json()).then(d => {
      setFilterCount(d.filterCount || 0);
      setFilters(d.filters || []);
      setStreak(d.streak || 0);
      setLastPnl(d.lastPnl || 0);
    }).catch(() => {});
  }, []);

  // Fetch Aggressive Mode status (poll every 30s — matches /api/aggressive cache TTL window)
  useEffect(() => {
    const fetchAggressive = async () => {
      try {
        const res = await fetch("/api/aggressive");
        const d = await res.json();
        setAggressive(d);
      } catch { /* non-critical */ }
    };
    fetchAggressive();
    const iv = setInterval(fetchAggressive, 30000);
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

  const CONFIDENCE_BANDS = [
    { min: 0, max: 44, label: "Low", wr: 40.0 },
    { min: 45, max: 54, label: "Medium", wr: 61.9 },
    { min: 55, max: 64, label: "High", wr: 40.0 },
    { min: 65, max: 100, label: "Very High", wr: 50.0 },
  ];

  const handleQuickClose = async (tradeId: string, exitPrice: number) => {
    if (!exitPrice || exitPrice <= 0) return;
    setCloseStatus("submitting");
    try {
      await fetch("/api/trades/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId, exit_price: exitPrice }),
      });
      setCloseStatus("done");
      setCloseConfirm(null);
      setTimeout(() => { setCloseStatus("idle"); fetchDashboard(); }, 2000);
    } catch { setCloseStatus("idle"); }
  };

  const edgeFix = data.expectancy < 0 && data.rrRatio < 1
    ? "WR and R:R both underwater"
    : data.expectancy < 0 && data.rrRatio > 0
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
              {ksConfirm === "activate" ? "This will halt ALL signal generation." : "Resume all signal generation?"}
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

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 90 }}>

        <div style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* ─── SYSTEM STATUS STRIP (sticky) ─── */}
          <div style={{
            position: "sticky", top: 0, zIndex: 20,
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
              <FreshnessDot ts={lastUpdated} />
              {filterCount > 0 && (
                <button onClick={() => setShowFilters(!showFilters)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 4,
                  border: "1px solid rgba(0,170,255,0.3)", background: "rgba(0,170,255,0.08)", color: "#00aaff",
                  fontFamily: "var(--font-mono)", fontSize: 10, cursor: "pointer", fontWeight: 600,
                }}>
                  🛡 {filterCount}
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {!killSwitch.active && (
                <button onClick={() => setKsConfirm("activate")} style={{
                  background: "transparent", border: `1px solid rgba(255,59,92,0.25)`, borderRadius: 4,
                  padding: "3px 8px", fontSize: 9, fontWeight: 700, color: "rgba(255,59,92,0.7)",
                  fontFamily: "var(--font-mono)", letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer",
                }}>STOP</button>
              )}
            </div>
          </div>
          {showFilters && filters.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 8, padding: "8px 12px", fontSize: 10, fontFamily: "var(--font-mono)", color: C.textSecondary }}>
              {filters.map((f, i) => (
                <div key={i} style={{ padding: "3px 0", borderBottom: i < filters.length - 1 ? "1px solid rgba(0,255,136,0.06)" : "none" }}>
                  {f.rule_type === "BLOCK_DIRECTION" ? `🚫 ${f.ticker} ${f.direction} blocked` : f.rule_type === "CONFIDENCE_FLOOR" ? `📊 Confidence floor: ${f.value}` : f.rule_type === "DIRECTION_THRESHOLD_BOOST" ? `📈 ${f.direction} threshold +${f.value}` : `${f.rule_type}: ${f.value}`}
                  {f.reason && <span style={{ color: C.textTertiary, marginLeft: 6 }}>— {f.reason}</span>}
                </div>
              ))}
            </div>
          )}

          {/* ─── 3. ACTIVE TRADES ─── */}
          <Link href="/trading?tab=trades" style={{ textDecoration: "none", color: "inherit", animation: "slideUp 0.4s ease" }}>
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
                  const conf = Number(t.confidence || 0);
                  const band = CONFIDENCE_BANDS.find(b => conf >= b.min && conf <= b.max);
                  return (
                    <div key={i} style={{
                      background: C.surfaceRaised, border: `1px solid ${C.borderSolid}`, borderRadius: 8,
                      padding: "10px 12px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ fontFamily: "Orbitron, sans-serif", fontSize: 15, fontWeight: 700, color: C.textPrimary, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tk}</span>
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
                          {t.trade_id && (
                            <button
                              onClick={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                if (closeConfirm === t.trade_id) {
                                  handleQuickClose(t.trade_id, lp || t.current_price || 0);
                                } else {
                                  setCloseConfirm(t.trade_id ?? null);
                                  setTimeout(() => setCloseConfirm(c => c === t.trade_id ? null : c), 3000);
                                }
                              }}
                              disabled={closeStatus === "submitting"}
                              style={{
                                background: "transparent",
                                border: closeConfirm === t.trade_id ? "1px solid #ff3355" : "1px solid rgba(255,51,85,0.3)",
                                borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 700,
                                color: closeConfirm === t.trade_id ? "#ff3355" : "rgba(255,51,85,0.6)",
                                fontFamily: "var(--font-mono)", cursor: "pointer", whiteSpace: "nowrap",
                              }}
                            >
                              {closeStatus === "submitting" ? "..." : closeStatus === "done" ? "Done" : closeConfirm === t.trade_id ? "Confirm?" : "✕"}
                            </button>
                          )}
                        </div>
                      </div>
                      {band && conf > 0 && (
                        <div style={{ marginTop: 4, fontSize: 9, fontFamily: "var(--font-mono)", color: band.wr >= 50 ? "#00ff88" : band.wr >= 40 ? "#ffaa00" : "#ff3355" }}>
                          Conf: {conf} — Band {band.min}–{band.max} ({band.label}) — {band.wr}% WR
                        </div>
                      )}
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
            {pnlCutoffDate && (
              <div style={{ fontSize: 9, color: C.textTertiary, fontFamily: "var(--font-mono)", marginTop: -10, marginBottom: 8 }}>
                Since: {new Date(pnlCutoffDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}
              </div>
            )}

            {/* W/L Counts */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: C.accent }}>{data.wins}<span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>W</span></span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: C.textTertiary }}>·</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: C.red }}>{data.losses}<span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>L</span></span>
            </div>

            {/* W/L Visual Bar */}
            <div style={{ width: "100%", height: 6, borderRadius: 3, background: "#151d28", display: "flex", overflow: "hidden" }}>
              <div style={{ width: `${winBarPct}%`, background: C.accent, borderRadius: "3px 0 0 3px" }} />
              <div style={{ flex: 1, background: "rgba(255,59,92,0.6)", borderRadius: "0 3px 3px 0" }} />
            </div>

            {/* Streak indicator */}
            {(Math.abs(streak) >= 3 || lastPnl !== 0) && (
              <div style={{ textAlign: "center", marginTop: 10 }}>
                {Math.abs(streak) >= 3 ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 4,
                    background: streak > 0 ? "rgba(0,255,136,0.08)" : "rgba(255,51,85,0.08)",
                    border: `1px solid ${streak > 0 ? "rgba(0,255,136,0.2)" : "rgba(255,51,85,0.2)"}`,
                    color: streak > 0 ? C.accent : C.red, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                  }}>
                    {streak > 0 ? "🔥" : "❄️"} {Math.abs(streak)} streak
                  </span>
                ) : lastPnl !== 0 ? (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: lastPnl > 0 ? C.accent : C.red }}>
                    Last: {lastPnl > 0 ? "+" : ""}{lastPnl.toFixed(2)}% ({lastPnl > 0 ? "W" : "L"})
                  </span>
                ) : null}
              </div>
            )}

            <div style={{ height: 1, background: C.borderSolid, margin: "14px 0 12px" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>
              <MiniStat label="WIN RATE" value={`${winPct.toFixed(1)}%`} color={C.accent} />
              <MiniStat label="TRADES" value={String(data.totalTrades)} color={C.textPrimary} />
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
          <Link href="/intelligence?tab=signals" style={{ textDecoration: "none", color: "inherit", animation: "slideUp 0.65s ease" }}>
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

          {/* ─── 8. REMINDERS removed 2026-04-25 — channel cleanup ─── */}

          {/* ─── 9. ADMIN ─── */}
          <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 10, padding: 16, animation: "slideUp 0.5s ease" }}>
            <SectionHeader icon="⚙️" label="ADMIN" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 12 }}>
              {/* Capital */}
              <div style={{ background: C.bg, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", fontFamily: "var(--font-mono)", letterSpacing: 0.5 }}>Capital</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, fontFamily: "var(--font-mono)", margin: "6px 0" }}>${adminCapital.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                <button onClick={() => { setAdminModal("capital"); setAdminConfirmText(""); setAdminNewCap(String(adminCapital)); }}
                  style={{ width: "100%", padding: "6px 0", fontSize: 10, fontFamily: "var(--font-mono)", background: C.redDim, color: C.red, border: `1px solid ${C.red}33`, borderRadius: 6, cursor: "pointer", fontWeight: 600, letterSpacing: 0.5 }}>
                  Reset Capital
                </button>
              </div>
              {/* P&L Stats */}
              <div style={{ background: C.bg, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", fontFamily: "var(--font-mono)", letterSpacing: 0.5 }}>P&L Stats</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, fontFamily: "var(--font-mono)", margin: "6px 0" }}>
                  {pnlCutoffDate ? `Since ${new Date(pnlCutoffDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}` : "All-time"}
                </div>
                <button onClick={() => { setAdminModal("pnl"); setAdminConfirmText(""); }}
                  style={{ width: "100%", padding: "6px 0", fontSize: 10, fontFamily: "var(--font-mono)", background: C.redDim, color: C.red, border: `1px solid ${C.red}33`, borderRadius: 6, cursor: "pointer", fontWeight: 600, letterSpacing: 0.5 }}>
                  Reset P&L Stats
                </button>
              </div>
              {/* XP */}
              <div style={{ background: C.bg, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", fontFamily: "var(--font-mono)", letterSpacing: 0.5 }}>XP</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.cyan, fontFamily: "var(--font-mono)", margin: "4px 0 2px" }}>{data.xp}</div>
                <div style={{ fontSize: 9, color: C.textTertiary, fontFamily: "var(--font-mono)", marginBottom: 6 }}>{data.rank}</div>
                <button onClick={() => { setAdminModal("xp"); setAdminConfirmText(""); }}
                  style={{ width: "100%", padding: "6px 0", fontSize: 10, fontFamily: "var(--font-mono)", background: C.redDim, color: C.red, border: `1px solid ${C.red}33`, borderRadius: 6, cursor: "pointer", fontWeight: 600, letterSpacing: 0.5 }}>
                  Reset XP
                </button>
                <div style={{ fontSize: 8, color: C.textTertiary, fontFamily: "var(--font-mono)", marginTop: 4, textAlign: "center" }}>Lifetime XP preserved</div>
              </div>
            </div>
            {/* Aggressive Mode — full-width card below 3-col admin row (2026-04-10) */}
            <div style={{
              background: C.bg,
              borderRadius: 8,
              padding: 12,
              marginTop: 12,
              border: `1px solid ${aggressive?.enabled ? "#ffa502" : C.borderSolid}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: C.textTertiary, textTransform: "uppercase", fontFamily: "var(--font-mono)", letterSpacing: 0.5 }}>
                    ⚡ Aggressive Mode
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: aggressive?.enabled ? "#ffa502" : C.textSecondary, fontFamily: "var(--font-mono)", marginTop: 4 }}>
                    {aggressive?.enabled ? `ON · Δ${aggressive.threshold_delta}` : "OFF"}
                  </div>
                  {aggressive?.enabled && aggressive.minutes_until_revert != null && (
                    <div style={{ fontSize: 10, color: C.textTertiary, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                      Reverts in {(aggressive.minutes_until_revert / 60).toFixed(1)}h
                    </div>
                  )}
                  {aggressive && (aggressive.total_signals_fired || 0) > 0 && (
                    <div style={{ fontSize: 10, color: C.textTertiary, fontFamily: "var(--font-mono)" }}>
                      Signals tagged: {aggressive.total_signals_fired}
                    </div>
                  )}
                  {aggressive?.cb_overall_status && aggressive.cb_overall_status !== "GREEN" && (
                    <div style={{ fontSize: 10, color: "#ff4757", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                      ⚠ CB: {aggressive.cb_overall_status}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (aggressive?.enabled) {
                      setAdminModal("aggressive_off");
                    } else {
                      setAggressiveDelta("-5");
                      setAggressiveHours("48");
                      setAdminModal("aggressive_on");
                    }
                    setAdminConfirmText("");
                  }}
                  style={{
                    padding: "8px 14px",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    background: aggressive?.enabled ? C.redDim : "#ffa50220",
                    color: aggressive?.enabled ? C.red : "#ffa502",
                    border: `1px solid ${aggressive?.enabled ? C.red : "#ffa502"}66`,
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    minHeight: 36,
                  }}
                >
                  {aggressive?.enabled ? "Disable" : "Enable"}
                </button>
              </div>
              <div style={{ fontSize: 9, color: C.textTertiary, fontFamily: "var(--font-mono)", marginTop: 8, lineHeight: 1.4 }}>
                Data acquisition only · Signals tagged for filter-out · Auto-revert 48h · CB-protected
              </div>
            </div>
            <button onClick={async () => { setAdminModal("history"); const r = await safeFetch<{ resets: typeof adminHistory }>("/api/admin/reset-history", { resets: [] }); if (r?.resets) setAdminHistory(r.resets); }}
              style={{ display: "block", margin: "10px auto 0", fontSize: 10, color: C.textSecondary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", textDecoration: "underline" }}>
              View Reset History →
            </button>
          </div>

        </div>
      </div>

      {/* ─── ADMIN MODALS ─── */}
      {adminModal && adminModal !== "history" && (() => {
        const isAggressiveOn = adminModal === "aggressive_on";
        const isAggressiveOff = adminModal === "aggressive_off";
        const isAggressive = isAggressiveOn || isAggressiveOff;
        const magicWord = isAggressiveOn ? "ENABLE" : isAggressiveOff ? "DISABLE" : "RESET";
        const matched = adminConfirmText === magicWord;
        const accentColor = isAggressiveOn ? "#ffa502" : C.red;
        const title = isAggressiveOn
          ? "Enable Aggressive Mode"
          : isAggressiveOff
          ? "Disable Aggressive Mode"
          : "Confirm Reset";
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setAdminModal(null)}>
          <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 12, padding: 24, maxWidth: 400, width: "100%" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontFamily: "Orbitron, sans-serif", fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 12 }}>{title}</div>
            <div style={{ fontSize: 12, color: C.textSecondary, fontFamily: "var(--font-mono)", marginBottom: 12, lineHeight: 1.6 }}>
              {adminModal === "capital"
                ? `Capital: $${adminCapital.toLocaleString()} → $${Number(adminNewCap || 0).toLocaleString()}`
                : adminModal === "xp"
                ? `Displayed XP will reset to 0. Rank will show Intern Quant. Lifetime XP is preserved.`
                : adminModal === "pnl"
                ? `P&L stats will rebase to today. Past trades hidden from stats.`
                : isAggressiveOn
                ? `Lower per-ticker confidence thresholds by Δ for the duration. Auto-reverts to normal afterward. Every signal that fires under aggressive mode is tagged for filter-out from quality metrics.`
                : `Aggressive mode will turn OFF immediately. Already-tagged signals stay tagged. Threshold returns to normal on next scan cycle (≤ 3 min).`}
            </div>
            {adminModal === "capital" && (
              <input type="number" value={adminNewCap} onChange={(e) => setAdminNewCap(e.target.value)} min={1} step={0.01} placeholder="New capital ($)"
                style={{ width: "100%", padding: "8px 10px", marginBottom: 10, background: C.bg, border: `1px solid ${C.borderSolid}`, borderRadius: 6, color: C.textPrimary, fontFamily: "var(--font-mono)", fontSize: 13 }} />
            )}
            {isAggressiveOn && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: C.textTertiary, fontFamily: "var(--font-mono)", marginBottom: 4 }}>Delta (−15 to 0)</div>
                    <input type="number" value={aggressiveDelta} onChange={(e) => setAggressiveDelta(e.target.value)} min={-15} max={0} step={1}
                      style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.borderSolid}`, borderRadius: 6, color: C.textPrimary, fontFamily: "var(--font-mono)", fontSize: 13 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: C.textTertiary, fontFamily: "var(--font-mono)", marginBottom: 4 }}>Hours (max 72)</div>
                    <input type="number" value={aggressiveHours} onChange={(e) => setAggressiveHours(e.target.value)} min={1} max={72} step={1}
                      style={{ width: "100%", padding: "8px 10px", background: C.bg, border: `1px solid ${C.borderSolid}`, borderRadius: 6, color: C.textPrimary, fontFamily: "var(--font-mono)", fontSize: 13 }} />
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#ffa502", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
                  ⚠ Data acquisition only. Quality metrics WILL be polluted until follow-up filter-out sweep. Circuit breaker non-GREEN will block enable.
                </div>
              </>
            )}
            {!isAggressive && (
              <div style={{ fontSize: 11, color: C.red, fontFamily: "var(--font-mono)", marginBottom: 10 }}>This cannot be undone. Trades are not affected.</div>
            )}
            <input type="text" value={adminConfirmText} onChange={(e) => setAdminConfirmText(e.target.value)} placeholder={`Type ${magicWord} to confirm`}
              style={{ width: "100%", padding: "8px 10px", marginBottom: 14, background: C.bg, border: `1px solid ${C.borderSolid}`, borderRadius: 6, color: C.textPrimary, fontFamily: "var(--font-mono)", fontSize: 13, letterSpacing: 1 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setAdminModal(null)}
                style={{ flex: 1, padding: "8px 0", fontSize: 11, fontFamily: "var(--font-mono)", background: "none", color: C.textSecondary, border: `1px solid ${C.borderSolid}`, borderRadius: 6, cursor: "pointer" }}>Cancel</button>
              <button disabled={!matched || adminLoading}
                onClick={async () => {
                  setAdminLoading(true);
                  try {
                    if (adminModal === "capital") {
                      await fetch("/api/admin/reset-capital", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newCapital: Number(adminNewCap), confirmText: "RESET" }) });
                      setAdminCapital(Number(adminNewCap));
                    } else if (adminModal === "xp") {
                      await fetch("/api/admin/reset-xp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmText: "RESET" }) });
                    } else if (adminModal === "pnl") {
                      await fetch("/api/admin/reset-pnl-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmText: "RESET" }) });
                    } else if (isAggressiveOn) {
                      await fetch("/api/aggressive", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "enable",
                          delta: parseInt(aggressiveDelta, 10),
                          hours: parseFloat(aggressiveHours),
                          reason: "hub_toggle",
                        }),
                      });
                    } else if (isAggressiveOff) {
                      await fetch("/api/aggressive", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "disable", reason: "hub_toggle" }),
                      });
                    }
                    setAdminModal(null);
                    if (!isAggressive) fetchDashboard();
                    // Refetch aggressive snapshot after a short delay so the UI reflects the
                    // bot-side state once the hub_commands queue picks up the change (~10s).
                    if (isAggressive) {
                      setTimeout(() => {
                        fetch("/api/aggressive").then(r => r.json()).then(d => setAggressive(d)).catch(() => {});
                      }, 12000);
                    }
                  } catch { /* error handled by API */ }
                  setAdminLoading(false);
                }}
                style={{ flex: 1, padding: "8px 0", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, background: matched ? accentColor : `${accentColor}22`, color: matched ? "#fff" : `${accentColor}66`, border: `1px solid ${accentColor}33`, borderRadius: 6, cursor: matched ? "pointer" : "not-allowed", opacity: matched ? 1 : 0.5 }}>
                {adminLoading ? "..." : isAggressiveOn ? "Confirm Enable" : isAggressiveOff ? "Confirm Disable" : "Confirm Reset"}</button>
            </div>
          </div>
        </div>
        );
      })()}

      {adminModal === "history" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setAdminModal(null)}>
          <div style={{ background: C.surface, border: `1px solid ${C.borderSolid}`, borderRadius: 12, padding: 24, maxWidth: 500, width: "100%", maxHeight: "70vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "Orbitron, sans-serif", fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Reset History</div>
              <button onClick={() => setAdminModal(null)} style={{ background: "none", border: "none", color: C.textSecondary, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            {adminHistory.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textTertiary, fontFamily: "var(--font-mono)", textAlign: "center", padding: 20 }}>No resets recorded.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.borderSolid}` }}>
                    <th style={{ textAlign: "left", padding: "6px 4px", color: C.textTertiary, fontWeight: 500 }}>Date (ET)</th>
                    <th style={{ textAlign: "left", padding: "6px 4px", color: C.textTertiary, fontWeight: 500 }}>Type</th>
                    <th style={{ textAlign: "left", padding: "6px 4px", color: C.textTertiary, fontWeight: 500 }}>Old → New</th>
                  </tr>
                </thead>
                <tbody>
                  {adminHistory.map((r) => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.borderSolid}22` }}>
                      <td style={{ padding: "6px 4px", color: C.textSecondary }}>{new Date(r.reset_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}</td>
                      <td style={{ padding: "6px 4px", color: r.reset_type === "capital" ? C.cyan : C.yellow }}>{r.reset_type === "capital" ? "Capital" : "P&L Stats"}</td>
                      <td style={{ padding: "6px 4px", color: C.textSecondary }}>{r.old_value || "—"} → {r.new_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Sub-Components ── */

function FreshnessDot({ ts }: { ts: number }) {
  const [ago, setAgo] = useState("");
  useEffect(() => {
    const update = () => {
      if (!ts) return;
      const s = Math.floor((Date.now() - ts) / 1000);
      if (s < 10) setAgo("just now");
      else if (s < 60) setAgo(`${s}s ago`);
      else if (s < 3600) setAgo(`${Math.floor(s / 60)}m ago`);
      else setAgo(`${Math.floor(s / 3600)}h ago`);
    };
    update();
    const iv = setInterval(update, 5000);
    return () => clearInterval(iv);
  }, [ts]);
  const stale = ts && (Date.now() - ts > 120000);
  if (!ts) return null;
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: stale ? "#ff3355" : "#3d6b4a", letterSpacing: 0.3 }}>
      {stale ? "⚠ " : "● "}{ago}
    </span>
  );
}

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
