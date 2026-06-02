import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// GET /api/auto/leverage-regime — S2-P05 read-only Leverage + Regime feed.
//
// Backs the Hub "Leverage + Regime" panel (Auto → Dashboard tab, below the
// S1-P06 Profit-Taking + Risk panel). Returns, read-only:
//   1. Per OPEN live trade — the Stage-2 dynamic-leverage posture: chosen
//      leverage (leverage_at_entry), the maintenance-margin liquidation distance
//      (liq_distance_at_entry), the conf/regime/vol multiplier breakdown
//      (lev_weight_breakdown_json), and the ≥ k×stop liquidation-safety check.
//   2. Current HMM regime per ticker (latest hmm_inference_log row per ticker).
//   3. Margin utilization (live HL marginSummary.totalMarginUsed / accountValue).
//   4. Regime-exit shadow comparison (exit_engine_shadow — would-be vs actual).
//
// READ-ONLY. There is NO write surface here — the panel never sends commands to
// the bot. Backed by query_leverage_regime.py which reads auto_trades /
// hmm_inference_log / exit_engine_shadow / auto_config (sqlite RO) + one live HL
// user_state round-trip. Auth: middleware-enforced cookie session.

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
  leverage_dynamic_enabled: boolean;
  leverage_weighting_enabled: boolean;
  autotrader_enabled: boolean;
  liq_buffer_k: number;
  open_trades: LevTrade[];
  regimes: RegimeRow[];
  margin: MarginState;
  regime_exit_shadow: RegimeExitShadow;
  error?: string;
}

const FALLBACK: LeverageRegimeResponse = {
  data_available: false,
  ts: 0,
  open_count: 0,
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

export async function GET() {
  try {
    const { value } = await cache.swr("leverage-regime", async () => {
      // 20s timeout: the live HL round-trip can be slower than a pure sqlite read.
      const raw = await runPython("query_leverage_regime.py", [], { timeout: 20_000 });
      return safeJsonParse<LeverageRegimeResponse>(raw, FALLBACK);
    });
    return NextResponse.json(value);
  } catch (e) {
    // Fail-safe: never 500 the panel. Serve last-good if we have it.
    const stale = cache.peek("leverage-regime");
    if (stale) return NextResponse.json(stale.value);
    return NextResponse.json({ ...FALLBACK, error: String(e) }, { status: 200 });
  }
}
