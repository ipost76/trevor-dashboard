import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import {
  fetchHeartbeatOpenSet,
  type HeartbeatOpenPosition,
} from "@/lib/heartbeat-open-set";

// GET /api/auto/profit-risk — S1-P06 read-only Profit-Taking + Risk feed.
//
// Backs the Hub "Profit-Taking + Risk" panel (Auto → Dashboard tab). Returns,
// for each OPEN live trade, its Stage-1 exit posture (breakeven armed?, ratchet
// floor R, partials taken + realized partial P&L, intended risk $/%), plus the
// consolidated circuit-breaker state (entries allowed?, active breakers, each
// breaker's reading vs its limit).
//
// READ-ONLY. There is NO write surface here — the panel never sends commands to
// the bot. Backed by query_profit_risk.py which reads auto_trades (sqlite RO)
// and circuit_breaker.CircuitBreakerSystem().get_status(). Auth:
// middleware-enforced cookie session.
//
// B2-CARD-HEARTBEAT-MERGE (2026-06-30): the open-trade LIST now derives its
// MEMBERSHIP from the live Observatory heartbeat (the SAME source the AUTO
// CAPITAL header uses), mirroring /api/auto/trades?type=open. Previously the
// list was the ~15-min-stale litestream replica `auto_trades WHERE status='open'`
// ONLY, so a genuinely-live (or not-yet-synced) position rendered as "No open
// positions". Now membership = heartbeat; a position not yet in the replica
// renders as a THIN "syncing" card (heartbeat fields only) instead of vanishing.
// OPEN-NOTIONAL (`open_notional`) is Σ notional_usd over the deduped+evicted
// merged set. `live:true` ⇒ heartbeat-sourced; `live:false` ⇒ heartbeat
// unavailable, replica fallback (behavior unchanged). The breakers block is
// untouched. Still READ-ONLY.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OpenTrade {
  id: number;
  ticker: string;
  direction: string;
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  leverage: number | null;
  notional_usd: number | null;
  original_notional_usd: number | null;
  opened_at: string | null;
  peak_pnl_pct: number | null;
  breakeven_armed: boolean;
  ratchet_locked_r: number;
  partials_taken: number;
  partial_pnl_realized: number;
  risk_dollars: number | null;
  risk_pct: number | null;
  // B2: true ⇒ live-from-heartbeat but not yet replicated (thin "syncing" card).
  thin?: boolean;
}

interface BreakerGauge {
  key: string;
  label: string;
  status: "OK" | "YELLOW" | "RED";
  value: number;
  limit: number;
  unit: string;
}

interface ActiveBreaker {
  key: string;
  label: string;
  status: string;
  detail: string;
}

interface BreakerState {
  overall_status: "OK" | "YELLOW" | "RED" | "OFF" | "UNKNOWN";
  override_active: boolean;
  entries_allowed: boolean;
  // RD-B7 (2026-07-25): freshness of the breaker's EVALUATION. The breaker is
  // signal-driven (Gate 0.5, per-signal), so a stale evaluation means UNKNOWN —
  // "not asked" — never FAILED. `last_eval_at` is the load-bearing field: this
  // response is served through the SWR cache below, so a server-computed age can
  // freeze while still looking fresh (a 16h48m-old body was observed served as
  // current). The panel recomputes the displayed age from `last_eval_at`.
  last_eval_at?: string | null;
  last_eval_age_s?: number | null;
  last_eval_stale?: boolean;
  last_eval_stale_after_s?: number;
  active: ActiveBreaker[];
  all: BreakerGauge[];
  error?: string;
}

interface ProfitRiskResponse {
  data_available: boolean;
  ts: number;
  open_count: number;
  // B2: Σ notional_usd over the merged (deduped + closed-id-evicted) open set.
  open_notional: number;
  open_trades: OpenTrade[];
  breakers: BreakerState;
  // B2: open-set tier. true ⇒ live heartbeat membership; false ⇒ heartbeat
  // unavailable, replica fallback (list/notional unchanged from the legacy path).
  live?: boolean;
  error?: string;
}

const FALLBACK: ProfitRiskResponse = {
  data_available: false,
  ts: 0,
  open_count: 0,
  open_notional: 0,
  open_trades: [],
  breakers: {
    overall_status: "UNKNOWN",
    override_active: false,
    entries_allowed: false,
    // RD-B7 fail-safe: a fallback shape can never claim a datable evaluation.
    last_eval_at: null,
    last_eval_age_s: null,
    last_eval_stale: true,
    active: [],
    all: [],
  },
};

// The helper spawns a bot-side python import (circuit_breaker) + an sqlite read.
// PERF-02 (2026-06-02): single-flight + SWR (10s) so the panel's poll interval
// can't stampede the bridge — concurrent expired-hits collapse to ONE refresh.
// SWR already serves last-good while revalidating; the catch handles the cold
// (no value) path, preserving the prior fail-safe (never 500 the panel).
const cache = createSwrCache<ProfitRiskResponse>({ defaultTtl: 10_000, concurrency: 2 });

// B2 — replica closed-history cross-check (inlined, mirrors trades/route.ts). The
// staleness ceiling in heartbeat-open-set.ts only catches a DEAD heartbeat; this
// catches a heartbeat that is ALIVE but (wrongly/stalely) reports a CLOSED id as
// open — the −17% HYPE ghost (closed row 101112) — so it can never become a thin
// card. Returns the subset of `ids` the replica explicitly marks status='closed';
// NEVER an id merely ABSENT from the replica (absence ≠ closed → a fast-syncing
// live position survives). Fails OPEN: any error → evict nothing.
interface ClosedIdsResponse {
  closed_ids?: number[];
}
async function fetchClosedIds(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  try {
    const raw = await runPython("query_closed_ids.py", [ids.join(",")], {
      timeout: 5_000,
    });
    const parsed = safeJsonParse<ClosedIdsResponse>(raw, { closed_ids: [] });
    return new Set((parsed.closed_ids ?? []).filter((n) => typeof n === "number"));
  } catch {
    return new Set();
  }
}

function sumNotional(rows: OpenTrade[]): number {
  return rows.reduce(
    (s, t) =>
      s +
      (typeof t.notional_usd === "number" && Number.isFinite(t.notional_usd)
        ? t.notional_usd
        : 0),
    0,
  );
}

// A heartbeat-only ("thin") open position: the heartbeat carries only id/ticker/
// direction/entry/leverage/notional — the Stage-1 exit/risk detail lives in the
// replica row and arrives null until it replicates (rendered "syncing" client-side).
function buildThinTrade(h: HeartbeatOpenPosition): OpenTrade {
  return {
    id: h.id,
    ticker: h.ticker,
    direction: h.direction,
    entry_price: h.entry_price,
    stop_price: null,
    target_price: null,
    leverage: h.leverage,
    notional_usd: h.notional_usd,
    original_notional_usd: null,
    opened_at: null,
    peak_pnl_pct: null,
    breakeven_armed: false,
    ratchet_locked_r: 0,
    partials_taken: 0,
    partial_pnl_realized: 0,
    risk_dollars: null,
    risk_pct: null,
    thin: true,
  };
}

// B2 — merge the live heartbeat open-SET into the replica `open_trades`, exactly
// mirroring /api/auto/trades?type=open. Membership = heartbeat; replica detail
// wins for a synced id; a heartbeat-only id → thin card; closed ids evicted.
async function mergeOpenSet(py: ProfitRiskResponse): Promise<ProfitRiskResponse> {
  const replica = py.open_trades ?? [];
  const liveSet = await fetchHeartbeatOpenSet();
  // Heartbeat down / stale past the ceiling → keep the replica set (never blank),
  // flag the tier; open_notional from the replica. Behavior unchanged from legacy.
  if (!liveSet) {
    return { ...py, open_notional: sumNotional(replica), live: false };
  }
  // Dedup by id: liveSet is already deduped by id, and byId maps replica rows, so
  // each heartbeat id yields EXACTLY ONE merged row (replica detail or thin).
  const byId = new Map(replica.map((t) => [t.id, t]));
  let merged: OpenTrade[] = liveSet.map((h) => {
    const r = byId.get(h.id);
    return r ? { ...r, thin: false } : buildThinTrade(h);
  });
  const closedIds = await fetchClosedIds(merged.map((t) => t.id));
  if (closedIds.size > 0) merged = merged.filter((t) => !closedIds.has(t.id));
  merged.sort((a, b) => b.id - a.id); // newest-first (id monotonic with opened_at)
  return {
    ...py,
    open_trades: merged,
    open_count: merged.length,
    open_notional: sumNotional(merged),
    live: true,
  };
}

export async function GET() {
  try {
    const { value } = await cache.swr("profit-risk", async () => {
      const raw = await runPython("query_profit_risk.py", [], { timeout: 12_000 });
      const py = safeJsonParse<ProfitRiskResponse>(raw, FALLBACK);
      return mergeOpenSet(py);
    });
    return NextResponse.json(value);
  } catch (e) {
    // Fail-safe: never 500 the panel. Serve last-good if we have it.
    const stale = cache.peek("profit-risk");
    if (stale) return NextResponse.json(stale.value);
    return NextResponse.json(
      { ...FALLBACK, error: String(e) },
      { status: 200 },
    );
  }
}
