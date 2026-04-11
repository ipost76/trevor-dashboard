"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──
type QualityPattern = {
  id: number;
  pattern_type: string;
  pattern_key: string;
  sample_size: number;
  wins: number;
  losses: number;
  win_rate: number;
  wilson_lower: number;
  wilson_upper: number;
  avg_pnl_pct: number;
  median_pnl_pct: number;
  sharpe_estimate: number;
  p_value: number;
  test_method: string;
  significance: string;
  recommendation: string;
  evidence_summary: string;
  source_paper: number;
  source_backfill: number;
  source_live: number;
  source_bias_flag: string | null;
  active: number;
  approved_at: string | null;
  approved_by: string | null;
  discovered_at: string;
};

type Summary = {
  total: number;
  active: number;
  by_significance: Record<string, number>;
  by_recommendation: Record<string, number>;
  last_discovery: string | null;
  top_boost: QualityPattern[];
  top_block: QualityPattern[];
  source_counts: { paper: number; backfill: number; live: number; total: number };
};

type ByTickerRow = { ticker: string; direction: string; n: number; wins: number; win_rate: number; avg_pnl: number };
type ByConfidenceRow = { bucket: string; n: number; wins: number; win_rate: number; avg_pnl: number };
type RecentMatch = {
  id: number;
  signal_id: number | null;
  pattern_id: number;
  matched_at: string;
  pattern_recommendation: string;
  pattern_type: string | null;
  pattern_key: string | null;
  win_rate: number | null;
  sample_size: number | null;
  significance: string | null;
};

// ── Helpers ──
const sigColor = (sig: string) => {
  switch (sig) {
    case "HIGH": return "#00ff88";
    case "MEDIUM": return "#00d4ff";
    case "LOW": return "#ffa502";
    case "INSUFFICIENT": return "#8888a0";
    case "NOT_SIGNIFICANT": return "#5d5d75";
    default: return "#e8e8f0";
  }
};

const recColor = (rec: string) => {
  switch (rec) {
    case "BOOST": return "#00ff88";
    case "BLOCK": return "#ff4757";
    case "NEUTRAL": return "#8888a0";
    case "NEEDS_MORE_DATA": return "#5d5d75";
    default: return "#e8e8f0";
  }
};

const wrColor = (wr: number) => {
  if (wr >= 0.55) return "#00ff88";
  if (wr >= 0.45) return "#ffa502";
  return "#ff4757";
};

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPnl = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// ── Component ──
export default function QualityPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [patterns, setPatterns] = useState<QualityPattern[]>([]);
  const [byTicker, setByTicker] = useState<ByTickerRow[]>([]);
  const [byConfidence, setByConfidence] = useState<ByConfidenceRow[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "boost" | "block" | "high">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPatternId, setBusyPatternId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const emptySummary: Summary = {
        total: 0, active: 0,
        by_significance: {}, by_recommendation: {},
        last_discovery: null, top_boost: [], top_block: [],
        source_counts: { paper: 0, backfill: 0, live: 0, total: 0 },
      };
      const [s, p, t, c, r] = await Promise.all([
        safeFetch<Summary>("/api/quality?scope=summary", emptySummary),
        safeFetch<QualityPattern[]>("/api/quality?scope=patterns", []),
        safeFetch<ByTickerRow[]>("/api/quality?scope=by_ticker", []),
        safeFetch<ByConfidenceRow[]>("/api/quality?scope=by_confidence", []),
        safeFetch<RecentMatch[]>("/api/quality?scope=recent_matches&limit=15", []),
      ]);
      setSummary(s);
      setPatterns(Array.isArray(p) ? p : []);
      setByTicker(Array.isArray(t) ? t : []);
      setByConfidence(Array.isArray(c) ? c : []);
      setRecentMatches(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 60_000);
    return () => clearInterval(id);
  }, [loadAll]);

  const handleApprove = async (pid: number) => {
    setBusyPatternId(pid);
    try {
      await fetch(`/api/quality/${pid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      await new Promise((r) => setTimeout(r, 800));
      await loadAll();
    } catch (e) {
      setError(`approve failed: ${e}`);
    } finally {
      setBusyPatternId(null);
    }
  };

  const handleReject = async (pid: number) => {
    setBusyPatternId(pid);
    try {
      await fetch(`/api/quality/${pid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      await new Promise((r) => setTimeout(r, 800));
      await loadAll();
    } catch (e) {
      setError(`reject failed: ${e}`);
    } finally {
      setBusyPatternId(null);
    }
  };

  const filteredPatterns = patterns.filter((p) => {
    if (filter === "active") return p.active === 1;
    if (filter === "boost") return p.recommendation === "BOOST";
    if (filter === "block") return p.recommendation === "BLOCK";
    if (filter === "high") return p.significance === "HIGH";
    return true;
  });

  if (loading && !summary) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          message="Quality data unavailable"
          sub={error}
        />
      </div>
    );
  }

  if (!summary || summary.total === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          message="No patterns mined yet"
          sub="Run !quality run in Discord (or python3 run_quality_analysis.py) to generate the first batch of patterns."
        />
      </div>
    );
  }

  const lastDiscovery = summary.last_discovery
    ? summary.last_discovery.substring(0, 16).replace("T", " ")
    : "never";

  // Training-bias banner: compute dominant source if any crosses SOURCE_BIAS_THRESHOLD (0.80).
  // Matches trevor/quality_intelligence.py:compute_source_bias() — kept in sync manually.
  const _sc = summary.source_counts;
  const _scTotal = _sc?.total || 0;
  let biasFlag: string | null = null;
  let biasPct = 0;
  if (_scTotal > 0) {
    const _bf = (_sc.backfill || 0) / _scTotal;
    const _pp = (_sc.paper || 0) / _scTotal;
    const _lv = (_sc.live || 0) / _scTotal;
    if (_bf >= 0.80) { biasFlag = "BACKFILL_HEAVY"; biasPct = _bf; }
    else if (_pp >= 0.80) { biasFlag = "PAPER_HEAVY"; biasPct = _pp; }
    else if (_lv >= 0.80) { biasFlag = "LIVE_HEAVY"; biasPct = _lv; }
  }

  return (
    <div className="space-y-4 p-4">
      {/* ── Hero Status Card ── */}
      <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ fontFamily: "Orbitron" }}>
            Signal Quality Intelligence
          </h2>
          <button
            onClick={loadAll}
            className="text-xs text-[#8888a0] hover:text-[#00ff88] flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
        {biasFlag && (
          <div className="mb-3 bg-[#ffa502]/10 border border-[#ffa502]/50 rounded p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#ffa502] flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px] leading-tight">
              <div className="text-[#ffa502] font-bold uppercase tracking-wider" style={{ fontFamily: "Orbitron" }}>
                ⚠ Training Bias: {biasFlag} ({Math.round(biasPct * 100)}%)
              </div>
              <div className="text-[#ffa502]/80 mt-1">
                All {summary.total} patterns inherit this source distribution (paper {_sc.paper} · backfill {_sc.backfill} · live {_sc.live}). Threshold ≥80%. Bias fades as live data accumulates.
              </div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase text-[#8888a0]">Patterns</div>
            <div className="text-xl font-bold text-[#e8e8f0]">{summary.total}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#8888a0]">Active</div>
            <div className="text-xl font-bold text-[#00ff88]">{summary.active}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#8888a0]">BOOST / BLOCK</div>
            <div className="text-base font-bold">
              <span className="text-[#00ff88]">{summary.by_recommendation.BOOST || 0}</span>
              <span className="text-[#5d5d75]"> / </span>
              <span className="text-[#ff4757]">{summary.by_recommendation.BLOCK || 0}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#8888a0]">Last discovery</div>
            <div className="text-xs text-[#e8e8f0]">{lastDiscovery}</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-[#1e2030] text-[10px] text-[#8888a0]">
          Source: paper={summary.source_counts.paper} \u00b7 backfill={summary.source_counts.backfill} \u00b7 live={summary.source_counts.live} \u00b7 total={summary.source_counts.total}
          {" \u00b7 "}
          Significance: {Object.entries(summary.by_significance).map(([k, v]) => `${k}=${v}`).join(" \u00b7 ")}
        </div>
      </div>

      {/* ── Top BOOST + BLOCK ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[#00ff88]" />
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ fontFamily: "Orbitron" }}>
              Top BOOST Candidates
            </h3>
          </div>
          {summary.top_boost.length === 0 ? (
            <div className="text-xs text-[#8888a0] italic">
              No BOOST candidates. Gates: significance HIGH/MEDIUM AND wilson_lower &gt; 55% AND avg_pnl &gt; 0.5%
            </div>
          ) : (
            <div className="space-y-2">
              {summary.top_boost.map((p) => (
                <PatternRow
                  key={p.id}
                  pattern={p}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  busy={busyPatternId === p.id}
                />
              ))}
            </div>
          )}
        </div>
        <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-[#ff4757]" />
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ fontFamily: "Orbitron" }}>
              Top BLOCK Candidates
            </h3>
          </div>
          {summary.top_block.length === 0 ? (
            <div className="text-xs text-[#8888a0] italic">
              No BLOCK candidates. Gates: significance HIGH/MEDIUM AND wilson_upper &lt; 40% AND avg_pnl &lt; -0.5%
            </div>
          ) : (
            <div className="space-y-2">
              {summary.top_block.map((p) => (
                <PatternRow
                  key={p.id}
                  pattern={p}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  busy={busyPatternId === p.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Confidence Calibration ── */}
      <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ fontFamily: "Orbitron" }}>
          Confidence Calibration (does confidence predict outcomes?)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8888a0] uppercase text-[10px]">
                <th className="text-left py-1">Bucket</th>
                <th className="text-right py-1">n</th>
                <th className="text-right py-1">Wins</th>
                <th className="text-right py-1">WR</th>
                <th className="text-right py-1">Avg P&L</th>
                <th className="text-left pl-3 py-1">Bar</th>
              </tr>
            </thead>
            <tbody>
              {byConfidence.map((b) => (
                <tr key={b.bucket} className="border-t border-[#1e2030]">
                  <td className="py-1 text-[#e8e8f0]">{b.bucket}</td>
                  <td className="py-1 text-right text-[#e8e8f0]">{b.n}</td>
                  <td className="py-1 text-right text-[#e8e8f0]">{b.wins}</td>
                  <td className="py-1 text-right" style={{ color: wrColor(b.win_rate) }}>
                    {b.n > 0 ? fmtPct(b.win_rate) : "\u2014"}
                  </td>
                  <td className="py-1 text-right" style={{ color: b.avg_pnl >= 0 ? "#00ff88" : "#ff4757" }}>
                    {b.n > 0 ? fmtPnl(b.avg_pnl) : "\u2014"}
                  </td>
                  <td className="pl-3 py-1">
                    <div className="w-32 bg-[#1e2030] h-2 rounded">
                      <div
                        className="h-2 rounded"
                        style={{
                          width: `${Math.min(100, (b.win_rate || 0) * 100)}%`,
                          backgroundColor: wrColor(b.win_rate),
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Win Rate by Ticker × Direction ── */}
      <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ fontFamily: "Orbitron" }}>
          Win Rate by Ticker x Direction
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8888a0] uppercase text-[10px]">
                <th className="text-left py-1">Ticker</th>
                <th className="text-left py-1">Dir</th>
                <th className="text-right py-1">n</th>
                <th className="text-right py-1">Wins</th>
                <th className="text-right py-1">WR</th>
                <th className="text-right py-1">Avg P&L</th>
              </tr>
            </thead>
            <tbody>
              {byTicker.map((row, idx) => (
                <tr key={idx} className="border-t border-[#1e2030]">
                  <td className="py-1 text-[#e8e8f0]">{row.ticker}</td>
                  <td className="py-1" style={{ color: row.direction === "LONG" ? "#00ff88" : "#ff4757" }}>
                    {row.direction}
                  </td>
                  <td className="py-1 text-right text-[#e8e8f0]">{row.n}</td>
                  <td className="py-1 text-right text-[#e8e8f0]">{row.wins}</td>
                  <td className="py-1 text-right" style={{ color: wrColor(row.win_rate) }}>
                    {fmtPct(row.win_rate)}
                  </td>
                  <td className="py-1 text-right" style={{ color: row.avg_pnl >= 0 ? "#00ff88" : "#ff4757" }}>
                    {fmtPnl(row.avg_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── All Patterns Table with Filter ── */}
      <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ fontFamily: "Orbitron" }}>
            All Patterns ({filteredPatterns.length})
          </h3>
          <div className="flex gap-1 flex-wrap text-[10px]">
            {(["all", "active", "boost", "block", "high"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2 py-1 rounded uppercase",
                  filter === f
                    ? "bg-[#00ff88] text-[#0a0a0f]"
                    : "bg-[#1e2030] text-[#8888a0] hover:text-[#e8e8f0]"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#12131a]">
              <tr className="text-[#8888a0] uppercase text-[10px]">
                <th className="text-left py-1">ID</th>
                <th className="text-left py-1">Type</th>
                <th className="text-left py-1">Key</th>
                <th className="text-right py-1">WR</th>
                <th className="text-right py-1">CI</th>
                <th className="text-right py-1">n</th>
                <th className="text-right py-1">P&L</th>
                <th className="text-left py-1">Sig</th>
                <th className="text-left py-1">Rec</th>
                <th className="text-left py-1">Source</th>
                <th className="text-center py-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatterns.slice(0, 100).map((p) => (
                <tr key={p.id} className="border-t border-[#1e2030] hover:bg-[#1e2030]/30">
                  <td className="py-1 text-[#8888a0]">#{p.id}</td>
                  <td className="py-1 text-[#8888a0]">{p.pattern_type.replace("_", " ")}</td>
                  <td className="py-1 text-[#e8e8f0] font-mono text-[10px]">{p.pattern_key}</td>
                  <td className="py-1 text-right" style={{ color: wrColor(p.win_rate) }}>
                    {fmtPct(p.win_rate)}
                  </td>
                  <td className="py-1 text-right text-[#8888a0] text-[10px]">
                    [{(p.wilson_lower * 100).toFixed(0)}-{(p.wilson_upper * 100).toFixed(0)}]
                  </td>
                  <td className="py-1 text-right text-[#e8e8f0]">{p.sample_size}</td>
                  <td className="py-1 text-right" style={{ color: p.avg_pnl_pct >= 0 ? "#00ff88" : "#ff4757" }}>
                    {fmtPnl(p.avg_pnl_pct)}
                  </td>
                  <td className="py-1" style={{ color: sigColor(p.significance) }}>
                    {p.significance}
                  </td>
                  <td className="py-1" style={{ color: recColor(p.recommendation) }}>
                    {p.recommendation}
                  </td>
                  <td className="py-1 text-[10px] text-[#8888a0]">
                    {p.source_bias_flag || `P${p.source_paper}/B${p.source_backfill}/L${p.source_live}`}
                  </td>
                  <td className="py-1 text-center">
                    {p.active === 1 ? (
                      <button
                        onClick={() => handleReject(p.id)}
                        disabled={busyPatternId === p.id}
                        className="text-[#ff4757] hover:text-[#ff6b75] disabled:opacity-50"
                        title="Deactivate"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleApprove(p.id)}
                        disabled={busyPatternId === p.id}
                        className="text-[#00ff88] hover:text-[#33ff99] disabled:opacity-50"
                        title="Activate"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Recent Matches ── */}
      {recentMatches.length > 0 && (
        <div className="bg-[#12131a] border border-[#1e2030] rounded-lg p-4">
          <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ fontFamily: "Orbitron" }}>
            Recent Pattern Matches
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#8888a0] uppercase text-[10px]">
                  <th className="text-left py-1">Time</th>
                  <th className="text-left py-1">Pattern</th>
                  <th className="text-right py-1">WR</th>
                  <th className="text-right py-1">n</th>
                  <th className="text-left py-1">Rec</th>
                  <th className="text-left py-1">Signal</th>
                </tr>
              </thead>
              <tbody>
                {recentMatches.map((m) => (
                  <tr key={m.id} className="border-t border-[#1e2030]">
                    <td className="py-1 text-[#8888a0] text-[10px]">
                      {(m.matched_at || "").substring(5, 16).replace("T", " ")}
                    </td>
                    <td className="py-1 text-[#e8e8f0] font-mono text-[10px]">
                      {m.pattern_key || `#${m.pattern_id}`}
                    </td>
                    <td className="py-1 text-right text-[#e8e8f0]">
                      {m.win_rate !== null ? fmtPct(m.win_rate) : "\u2014"}
                    </td>
                    <td className="py-1 text-right text-[#e8e8f0]">{m.sample_size ?? "\u2014"}</td>
                    <td className="py-1" style={{ color: recColor(m.pattern_recommendation) }}>
                      {m.pattern_recommendation}
                    </td>
                    <td className="py-1 text-[#8888a0]">
                      {m.signal_id ? `sig#${m.signal_id}` : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pattern Row Component (used in BOOST/BLOCK card lists) ──
function PatternRow({
  pattern,
  onApprove,
  onReject,
  busy,
}: {
  pattern: QualityPattern;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  busy: boolean;
}) {
  return (
    <div className="bg-[#0a0a0f] border border-[#1e2030] rounded p-2 flex items-center justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono text-[#e8e8f0] truncate">
          #{pattern.id} {pattern.pattern_key}
        </div>
        <div className="text-[10px] text-[#8888a0]">
          WR {fmtPct(pattern.win_rate)} \u00b7 n={pattern.sample_size} \u00b7
          <span style={{ color: sigColor(pattern.significance) }}> {pattern.significance}</span>
          {pattern.source_bias_flag && (
            <span className="text-[#ffa502]"> \u00b7 {pattern.source_bias_flag}</span>
          )}
        </div>
      </div>
      <div className="flex gap-1">
        {pattern.active === 1 ? (
          <button
            onClick={() => onReject(pattern.id)}
            disabled={busy}
            className="px-2 py-1 text-[10px] uppercase rounded bg-[#ff4757]/10 text-[#ff4757] hover:bg-[#ff4757]/20 disabled:opacity-50"
          >
            Deactivate
          </button>
        ) : (
          <button
            onClick={() => onApprove(pattern.id)}
            disabled={busy}
            className="px-2 py-1 text-[10px] uppercase rounded bg-[#00ff88]/10 text-[#00ff88] hover:bg-[#00ff88]/20 disabled:opacity-50"
          >
            Approve
          </button>
        )}
      </div>
    </div>
  );
}
