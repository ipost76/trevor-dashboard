import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// GET /api/auto/state — consolidated AUTO state.
//
// RM-PNL P01 (2026-05-29): REALIZED-ONLY headline P&L model.
//   - `realized`/`realized_pct`/`realized_count` are bucketed across
//     today/yesterday/week/month/all on EASTERN-calendar boundaries; they sum
//     ONLY closed-trade `pnl_usd` — never unrealized.
//   - `unrealized_usd` is a SEPARATE field for the greyed secondary line only.
//   - `open_exposure_usd` is deployed notional (neutral), never P&L.
//   - `equity_usd` is the live HL account value (floats with open positions).
//   - `realized_unknown_count` surfaces closed rows that never booked a pnl.
//   Legacy fields (`equity`, `pnl_today_*`, `trades_*`, `open_positions_count`,
//   flags) are preserved for back-compat.
//
// RM-DASH (2026-05-29): wrapped in createSwrCache (10s TTL, single-flight,
// per-origin cap 2) — this route fans out to a live HL `user_state` network
// call AND a runPython spawn, exactly the stampede shape the residual-wedge
// wave targets. The existing try/catch around swr() preserves the fail-safe
// FALLBACK contract (a transient warm failure serves the last good value
// instead of the all-zero fallback — strictly better).
//
// READ-ONLY against the system. Auth: middleware enforces the session cookie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RealizedWindows {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  all: number;
}

interface AutoStateResponse {
  // realized-only model
  equity_usd: number;
  realized: RealizedWindows;
  realized_pct: RealizedWindows;
  realized_count: { today: number; yesterday: number; week: number; month: number; all: number };
  realized_unknown_count: number;
  open_exposure_usd: number;
  unrealized_usd: number;
  open_count: number;
  ts: number;
  // legacy / shared back-compat
  capital_usd: number;
  live_capital_usd: number;
  equity: number;
  pnl_today_usd: number;
  pnl_today_pct: number;
  trades_today: number;
  trades_total: number;
  open_positions_count: number;
  auto_enabled: boolean;
  live_enabled: boolean;
  killswitch_on: boolean;
  per_ticker_thresholds_enabled: boolean;
  data_available: boolean;
  error?: string;
}

const ZERO_WINDOWS: RealizedWindows = { today: 0, yesterday: 0, week: 0, month: 0, all: 0 };

const FALLBACK: AutoStateResponse = {
  equity_usd: 0,
  realized: { ...ZERO_WINDOWS },
  realized_pct: { ...ZERO_WINDOWS },
  realized_count: { today: 0, yesterday: 0, week: 0, month: 0, all: 0 },
  realized_unknown_count: 0,
  open_exposure_usd: 0,
  unrealized_usd: 0,
  open_count: 0,
  ts: 0,
  capital_usd: 0,
  live_capital_usd: 0,
  equity: 0,
  pnl_today_usd: 0,
  pnl_today_pct: 0,
  trades_today: 0,
  trades_total: 0,
  open_positions_count: 0,
  auto_enabled: false,
  live_enabled: false,
  killswitch_on: false,
  per_ticker_thresholds_enabled: false,
  data_available: false,
};

// 10s TTL: shorter than the 15s client poll so each tick gets fresh-ish data,
// but same-tick bursts (capital-hero + scalper-header both poll /api/auto/state)
// collapse to ONE upstream HL+Python chain.
const cache = createSwrCache<AutoStateResponse>({ defaultTtl: 10_000, concurrency: 2 });

export async function GET() {
  try {
    const { value, ts } = await cache.swr("auto-state", async () => {
      // timeout absorbs the live HL info.user_state() round-trip (3-5s cold).
      const raw = await runPython("query_auto_state.py", [], { timeout: 10_000 });
      return safeJsonParse<AutoStateResponse>(raw, FALLBACK);
    });
    // ts = epoch-ms the value was produced (stamped by the cache, not the script).
    return NextResponse.json({ ...value, ts });
  } catch (err) {
    return NextResponse.json(
      { ...FALLBACK, error: String(err) },
      { status: 200 },
    );
  }
}
