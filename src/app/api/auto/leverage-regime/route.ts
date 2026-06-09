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

// ─────────────────────────────────────────────────────────────────────────────
// W-H-P4-HUB (2026-06-09): margin utilization sourced from the Observatory
// heartbeat, NOT a live HL call.
//
// The Hub box has NO `hyperliquid` module / HL creds, so the script's old
// `info.user_state` margin read ALWAYS failed with ModuleNotFoundError and pinned
// the panel to "margin read degraded". The heartbeat (same upstream as
// src/app/api/heartbeat/route.ts + src/app/api/auto/state/route.ts) carries the
// live `account_value_usd` plus, per open position, `notional_usd` + `leverage`.
// The bot runs ISOLATED margin, where each position's posted (initial) margin =
// notional / leverage and totalMarginUsed = Σ of those (confirmed in the bot's
// live_executor.py). So margin utilization is reconstructed exactly, credential-
// free:
//     account_value   = account_value_usd
//     total_ntl_pos   = Σ open_positions[].notional_usd
//     margin_used      = Σ (open_positions[].notional_usd / leverage)
//     utilization_pct = margin_used / account_value * 100
// Flat (no open positions) → 0% used / $<account_value> acct. The entry-notional
// basis drifts negligibly from live mark as price moves (isolated margin is locked
// at entry) — a faithful gauge, and infinitely better than "unavailable".
const OBSERVATORY_HEARTBEAT_URL =
  "https://trevor-prime.tail068f72.ts.net:8443/api/heartbeat";

// Own cache so a heartbeat hiccup serves the last-known margin (stale) WITHOUT
// poisoning — independent of the auto-state (Python) cache above.
const marginCache = createSwrCache<MarginState>({ defaultTtl: 10_000, concurrency: 2 });

interface HbPosition {
  notional_usd?: number | null;
  leverage?: number | null;
}
interface HbMarginPayload {
  account_value_usd?: number | null;
  categories?: {
    autotrader?: {
      account_value_usd?: number | null;
      open_positions?: HbPosition[] | null;
    };
  };
}

async function resolveHeartbeatMargin(): Promise<MarginState> {
  try {
    const { value } = await marginCache.swr("hb-margin", async () => {
      const res = await fetch(OBSERVATORY_HEARTBEAT_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`heartbeat ${res.status}`);
      const hb = (await res.json()) as HbMarginPayload;
      const av = hb?.account_value_usd ?? hb?.categories?.autotrader?.account_value_usd;
      // Account value is required — absent/NaN ⇒ throw so swr keeps serving the
      // last-known margin (stale) instead of caching a bad number.
      if (typeof av !== "number" || !Number.isFinite(av)) {
        throw new Error("account_value_usd absent");
      }
      const positions = hb?.categories?.autotrader?.open_positions ?? [];
      let totalNtl = 0;
      let marginUsed = 0;
      for (const p of positions) {
        const ntl =
          typeof p?.notional_usd === "number" && Number.isFinite(p.notional_usd)
            ? p.notional_usd
            : 0;
        const lev =
          typeof p?.leverage === "number" && Number.isFinite(p.leverage) && p.leverage > 0
            ? p.leverage
            : 0;
        totalNtl += ntl;
        if (lev > 0) marginUsed += ntl / lev; // isolated initial margin = notional / leverage
      }
      const utilization = av > 0 ? (marginUsed / av) * 100 : 0;
      return {
        available: true,
        account_value: av,
        margin_used: marginUsed,
        utilization_pct: utilization,
        total_ntl_pos: totalNtl,
      };
    });
    return value;
  } catch {
    // Cold + heartbeat unreachable. Surface "degraded" honestly (the panel shows
    // a gold note) rather than a fake number — but with no ModuleNotFoundError.
    return {
      available: false,
      account_value: 0,
      margin_used: 0,
      utilization_pct: 0,
      total_ntl_pos: 0,
      error: "heartbeat unavailable",
    };
  }
}

export async function GET() {
  try {
    // Python supplies open_trades / regimes / shadow (sqlite RO); the heartbeat
    // supplies the live margin block (the Hub has no HL creds). Run in parallel.
    const [state, margin] = await Promise.all([
      cache.swr("leverage-regime", async () => {
        // 20s timeout preserved for the sqlite-heavy script (HL call now removed).
        const raw = await runPython("query_leverage_regime.py", [], { timeout: 20_000 });
        return safeJsonParse<LeverageRegimeResponse>(raw, FALLBACK);
      }),
      resolveHeartbeatMargin(),
    ]);
    // W-H-P4-HUB: discard the script's (sentinel) margin; use the heartbeat block.
    return NextResponse.json({ ...state.value, margin });
  } catch (e) {
    // Fail-safe: never 500 the panel. Serve last-good if we have it.
    const stale = cache.peek("leverage-regime");
    if (stale) return NextResponse.json(stale.value);
    return NextResponse.json({ ...FALLBACK, error: String(e) }, { status: 200 });
  }
}
