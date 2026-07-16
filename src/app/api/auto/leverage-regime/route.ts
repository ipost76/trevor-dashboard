import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import {
  fetchHeartbeatOpenSet,
  type HeartbeatOpenPosition,
} from "@/lib/heartbeat-open-set";

// GET /api/auto/leverage-regime — S2-P05 read-only Leverage + Regime feed.
//
// Backs the Hub "Leverage + Regime" panel (Auto → Dashboard tab, below the
// S1-P06 Profit-Taking + Risk panel). Returns, read-only:
//   1. Per OPEN live trade — the Stage-2 dynamic-leverage posture: chosen
//      leverage (leverage_at_entry), the maintenance-margin liquidation distance
//      (liq_distance_at_entry), the conf/regime/vol multiplier breakdown
//      (lev_weight_breakdown_json), and the ≥ k×stop liquidation-safety check.
//   2. Current HMM regime per ticker (latest hmm_inference_log row per ticker).
//   3. Margin utilization — reconstructed from the replica (B2-MARGIN-REPLICA):
//      Σ auto_trades.notional_usd (the POSTED MARGIN, NOT ÷ leverage) over open
//      live trades, ÷ latest equity_snapshots.equity. The Observatory heartbeat
//      that formerly fed this was decommissioned in RM-DECOM (~2026-07-08).
//   4. Regime-exit shadow comparison (exit_engine_shadow — would-be vs actual).
//
// READ-ONLY. There is NO write surface here — the panel never sends commands to
// the bot. Backed entirely by query_leverage_regime.py which reads auto_trades /
// equity_snapshots / hmm_inference_log / exit_engine_shadow / auto_config
// (sqlite RO); no network I/O. Auth: middleware-enforced cookie session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LevBreakdown {
  liq_safe_cap?: number;
  conf_mult?: number;
  regime_mult?: number;
  vol_mult?: number;
  weighted_target?: number;
  final?: number;
  confidence?: number;
  regime?: string;
  atr_pct?: number;
}

interface LevTrade {
  id: number;
  ticker: string;
  direction: string;
  leverage: number | null;
  leverage_at_entry: number | null;
  liq_distance_at_entry: number | null;
  entry_price: number | null;
  stop_price: number | null;
  notional_usd: number | null;
  regime_at_entry: string | null;
  opened_at: string | null;
  stop_fraction: number | null;
  required_liq_distance: number | null;
  liq_safe: boolean | null;
  breakdown: LevBreakdown | null;
  // B2: true ⇒ live-from-heartbeat but not yet replicated (thin "syncing" card).
  thin?: boolean;
}

interface RegimeRow {
  ticker: string;
  state: string | null;
  prob: number | null;
  all_probs: Record<string, number>;
  ts: number | null;
  age_seconds: number | null;
}

interface MarginState {
  available: boolean;
  account_value: number;
  margin_used: number;
  utilization_pct: number;
  total_ntl_pos: number;
  // B2-MARGIN-REPLICA: age (seconds, UTC clock) of the equity snapshot backing
  // this reading — the panel badges it `REPLICA ~Nm`. Absent when degraded.
  age_seconds?: number;
  error?: string;
}

interface ShadowRow {
  id: number;
  trade_id: number | null;
  ticker: string;
  direction: string | null;
  regime: string | null;
  check_time: string | null;
  old_exit_action: string | null;
  new_exit_action: string | null;
  old_stop_price: number | null;
  new_stop_price: number | null;
  current_price: number | null;
  pnl_pct: number | null;
  divergent: boolean;
}

interface RegimeExitShadow {
  available: boolean;
  total: number;
  divergent: number;
  recent: ShadowRow[];
  error?: string;
}

interface LeverageRegimeResponse {
  data_available: boolean;
  ts: number;
  open_count: number;
  // B2: Σ notional_usd over the merged (deduped + closed-id-evicted) open set —
  // the LIST subtotal. (Distinct from margin.total_ntl_pos, which is the live
  // heartbeat-sourced utilization denominator; the two agree absent a ghost.)
  open_notional: number;
  leverage_dynamic_enabled: boolean;
  leverage_weighting_enabled: boolean;
  autotrader_enabled: boolean;
  liq_buffer_k: number;
  open_trades: LevTrade[];
  regimes: RegimeRow[];
  margin: MarginState;
  regime_exit_shadow: RegimeExitShadow;
  // B2: open-set tier. true ⇒ live heartbeat membership; false ⇒ heartbeat
  // unavailable, replica fallback (list/notional unchanged from the legacy path).
  live?: boolean;
  error?: string;
}

const FALLBACK: LeverageRegimeResponse = {
  data_available: false,
  ts: 0,
  open_count: 0,
  open_notional: 0,
  leverage_dynamic_enabled: false,
  leverage_weighting_enabled: false,
  autotrader_enabled: false,
  liq_buffer_k: 2.5,
  open_trades: [],
  regimes: [],
  margin: {
    available: false,
    account_value: 0,
    margin_used: 0,
    utilization_pct: 0,
    total_ntl_pos: 0,
  },
  regime_exit_shadow: { available: false, total: 0, divergent: 0, recent: [] },
};

// The helper spawns a bot-side HL user_state call + an sqlite read.
// PERF-02 (2026-06-02): single-flight + SWR (10s) so the panel's 15s poll can't
// stampede the bridge — concurrent expired-hits collapse to ONE refresh. SWR
// already serves last-good while revalidating; the catch handles the cold (no
// value) path, preserving the prior fail-safe (never 500 the panel).
const cache = createSwrCache<LeverageRegimeResponse>({ defaultTtl: 10_000, concurrency: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// B2-CARD-HEARTBEAT-MERGE (2026-06-30): merge the live heartbeat open-SET into
// the replica per-trade LEVERAGE list, mirroring /api/auto/trades?type=open and
// the sibling profit-risk route. Previously the Leverage card's list was the
// ~15-min-stale replica `auto_trades WHERE status='open'` ONLY, so a live (or
// not-yet-synced) position rendered as "No open positions". Now membership =
// heartbeat; a heartbeat-only id renders as a THIN "syncing" card; closed ids
// are evicted; open_notional is Σ over the deduped+evicted merged set. The
// Margin Utilization block is now reconstructed from the replica inside
// query_leverage_regime.py (B2-MARGIN-REPLICA) — the Observatory heartbeat that
// formerly fed it is decommissioned; the route no longer fetches it.
interface ClosedIdsResponse {
  closed_ids?: number[];
}
// Replica closed-history cross-check (inlined, mirrors trades/route.ts) — catches
// a heartbeat that is ALIVE but reports a CLOSED id as open (the −17% HYPE ghost,
// row 101112) so it never becomes a thin card. NEVER an id merely ABSENT from the
// replica (absence ≠ closed → a fast-syncing live position survives). Fails OPEN.
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

function sumNotional(rows: LevTrade[]): number {
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
// direction/entry/leverage/notional — the Stage-2 leverage detail (liq distance,
// breakdown, regime_at_entry) lives in the replica row and arrives null until it
// replicates. leverage_at_entry stays null (we don't fabricate the S2-P01 column);
// the panel falls back to `leverage` (the live heartbeat lev) via `?? `.
function buildThinTrade(h: HeartbeatOpenPosition): LevTrade {
  return {
    id: h.id,
    ticker: h.ticker,
    direction: h.direction,
    leverage: h.leverage,
    leverage_at_entry: null,
    liq_distance_at_entry: null,
    entry_price: h.entry_price,
    stop_price: null,
    notional_usd: h.notional_usd,
    regime_at_entry: null,
    opened_at: null,
    stop_fraction: null,
    required_liq_distance: null,
    liq_safe: null,
    breakdown: null,
    thin: true,
  };
}

// Membership = heartbeat; replica detail wins for a synced id; heartbeat-only id
// → thin card; closed ids evicted. Dedup by id (liveSet already deduped + byId
// map → EXACTLY ONE merged row per heartbeat id; no double-count in list/notional).
async function mergeOpenSet(py: LeverageRegimeResponse): Promise<LeverageRegimeResponse> {
  const replica = py.open_trades ?? [];
  const liveSet = await fetchHeartbeatOpenSet();
  if (!liveSet) {
    // Heartbeat down / stale → keep the replica list (never blank); open_notional
    // from the replica; flag the tier. Behavior unchanged from the legacy path.
    return { ...py, open_notional: sumNotional(replica), live: false };
  }
  const byId = new Map(replica.map((t) => [t.id, t]));
  let merged: LevTrade[] = liveSet.map((h) => {
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
    // query_leverage_regime.py supplies the WHOLE payload from the read-only
    // replica: open_trades / regimes / shadow AND the margin block
    // (B2-MARGIN-REPLICA — margin reconstructed from auto_trades.notional_usd
    // [the posted margin] + equity_snapshots; the Observatory heartbeat that
    // formerly fed margin is decommissioned, so the route no longer fetches it).
    const state = await cache.swr("leverage-regime", async () => {
      // 20s timeout preserved for the sqlite-heavy script.
      const raw = await runPython("query_leverage_regime.py", [], { timeout: 20_000 });
      const py = safeJsonParse<LeverageRegimeResponse>(raw, FALLBACK);
      // B2: merge the live heartbeat open-set into the per-trade leverage list.
      return mergeOpenSet(py);
    });
    return NextResponse.json(state.value);
  } catch (e) {
    // Fail-safe: never 500 the panel. Serve last-good if we have it.
    const stale = cache.peek("leverage-regime");
    if (stale) return NextResponse.json(stale.value);
    return NextResponse.json({ ...FALLBACK, error: String(e) }, { status: 200 });
  }
}
