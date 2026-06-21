import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import { getLifetimeNetDeposits } from "@/lib/hl-deposits";

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
  // WA-P2: present only when the request carries a valid ?start&end custom range.
  custom?: number;
}

// WA-P1 (2026-06-12): per-window realized % / start-of-window base. A window
// whose start-of-window equity base is missing or ≤floor is `null` (UI renders
// "—") rather than a garbage number — so these are nullable, unlike `realized`.
interface NullableWindows {
  today: number | null;
  yesterday: number | null;
  week: number | null;
  month: number | null;
  all: number | null;
  custom?: number | null; // WA-P2
}

interface AutoStateResponse {
  // realized-only model
  equity_usd: number;
  realized: RealizedWindows;
  realized_pct: NullableWindows;
  // WA-P1: realized-basis account equity at each window's START (the % denominator).
  realized_base: NullableWindows;
  realized_count: { today: number; yesterday: number; week: number; month: number; all: number; custom?: number };
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
// WA-P1: pct/base default to null (no data → UI shows "—"), never a misleading 0.
const NULL_WINDOWS: NullableWindows = {
  today: null,
  yesterday: null,
  week: null,
  month: null,
  all: null,
};

const FALLBACK: AutoStateResponse = {
  equity_usd: 0,
  realized: { ...ZERO_WINDOWS },
  realized_pct: { ...NULL_WINDOWS },
  realized_base: { ...NULL_WINDOWS },
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

// ─────────────────────────────────────────────────────────────────────────────
// EQT-A3 (2026-06-07): the dashboard equity readout MIRRORS real HL.
//
// This Hub box has NO Hyperliquid credentials, so the local `query_auto_state.py`
// `_fetch_hl()` cannot reach HL — it degrades to the DB realized-PnL sum (the old
// "virtual" ~−$28 number). We therefore IGNORE the script's `equity_usd` entirely
// and source the equity figure from the Observatory heartbeat field
// `account_value_usd` (real-HL accountValue, published VM-side by Wave A1).
//
// Fail-safe contract (never a silent wrong number, never the DB sum):
//   · field present + fresh   → real-HL value          (equity_source "real-hl")
//   · upstream briefly down,
//     but we have a prior value → last-known value      (equity_source "stale")
//   · never seen a value
//     (A1 not yet live / null)  → null, available:false (equity_source "unavailable")
//
// Same heartbeat upstream as src/app/api/heartbeat/route.ts. A1's exact nesting
// is not finalized, so we accept the field at top level OR under
// categories.autotrader — whichever A1 ships, A3 consumes without a re-coordination.
const OBSERVATORY_HEARTBEAT_URL =
  "https://trevor-prime.tail2bf7a3.ts.net:8443/api/heartbeat";

// Own cache so a heartbeat hiccup serves the last-known equity (stale) WITHOUT
// poisoning — independent of the auto-state (Python) cache above.
const equityCache = createSwrCache<HeartbeatEquity>({ defaultTtl: 10_000, concurrency: 2 });

// W-H-P2-HUB: the badge's staleness must be an AGE check, NOT the SWR per-call flag
// (see resolveRealHlEquity below). 60s sits comfortably above the 15s client poll, so a
// normally-refreshing value is never flagged, while a genuinely stalled heartbeat is.
const EQUITY_STALE_AGE_MS = 60_000;

type EquitySource = "real-hl" | "stale" | "unavailable";
interface RealHlEquity {
  value: number | null; // real-HL accountValue; null when never observed
  unrealized: number | null; // real-HL floating PnL (same heartbeat); null when unavailable
  source: EquitySource;
  stale: boolean;
  ts: number; // epoch-ms the served value was produced (last-success on stale)
  // W-H-P4-HUB: live OPEN numbers from the SAME heartbeat. null ⇒ heartbeat never
  // observed ⇒ caller keeps the replica (Python) values rather than overriding.
  openCount: number | null;
  openExposure: number | null; // Σ open_positions[].notional_usd (deployed)
}

interface HeartbeatPosition {
  notional_usd?: number | null;
}
interface HeartbeatPayload {
  account_value_usd?: number | null;
  categories?: {
    autotrader?: {
      account_value_usd?: number | null;
      unrealized_pnl_usd?: number | null;
      // W-H-P4-HUB: live open-count + open positions (each carries notional_usd).
      open_count?: number | null;
      open_positions?: HeartbeatPosition[] | null;
    };
  };
}

// W-H-P3-HUB: one heartbeat fetch now carries BOTH the required account value AND
// the best-effort floating PnL. The Hub has no HL credentials, so the Python
// script's own `unrealized_usd` is always 0 — the real floating number lives in
// the heartbeat's autotrader category (computed live VM-side each collect). The
// account value is required (a missing/NaN value fails the fetch so swr serves the
// last-known number); `unrealized` is optional (a flat account legitimately has 0).
interface HeartbeatEquity {
  equity: number;
  unrealized: number | null;
  // W-H-P4-HUB: live open-count + deployed notional, from the SAME heartbeat.
  openCount: number | null;
  openExposure: number | null;
}

async function resolveRealHlEquity(): Promise<RealHlEquity> {
  try {
    const { value, ts } = await equityCache.swr("real-hl-equity", async () => {
      const res = await fetch(OBSERVATORY_HEARTBEAT_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`heartbeat ${res.status}`);
      const hb = (await res.json()) as HeartbeatPayload;
      const av = hb?.account_value_usd ?? hb?.categories?.autotrader?.account_value_usd;
      // Absent/null/NaN ⇒ throw so swr keeps serving the last-known value (stale)
      // instead of caching a bad number. Cold + throw ⇒ caught below ⇒ unavailable.
      if (typeof av !== "number" || !Number.isFinite(av)) {
        throw new Error("account_value_usd absent");
      }
      // Floating PnL from the SAME heartbeat (best-effort). Absent/NaN ⇒ null so a
      // flat account never fails the fetch; the UI falls back to the script value.
      const u = hb?.categories?.autotrader?.unrealized_pnl_usd;
      const unrealized = typeof u === "number" && Number.isFinite(u) ? u : null;
      // W-H-P4-HUB: live OPEN numbers from the SAME heartbeat — kills the ≤15min
      // litestream-replica lag (phantom open-count + deployed). `open_count` is the
      // LIVE count; `open_exposure` (deployed) = Σ open_positions[].notional_usd.
      // Absent ⇒ null so the caller keeps the replica value (never invents 0).
      const oc = hb?.categories?.autotrader?.open_count;
      const openCount = typeof oc === "number" && Number.isFinite(oc) ? oc : null;
      const positions = hb?.categories?.autotrader?.open_positions ?? null;
      const openExposure = positions
        ? positions.reduce((sum, p) => {
            const n = p?.notional_usd;
            return sum + (typeof n === "number" && Number.isFinite(n) ? n : 0);
          }, 0)
        : null;
      return { equity: av, unrealized, openCount, openExposure };
    });
    // W-H-P2-HUB FIX: the SWR per-call `stale` flag is `true` on EVERY poll because the
    // equity cache TTL (10s) is shorter than the client poll interval (15s) — so the cache
    // is always expired at poll time and the badge was pinned to "STALE" forever even though
    // the served value is live (single-flight refreshes it every poll). Decide staleness by
    // the WALL-CLOCK AGE of the served value instead: fresh in steady state (ts stays within
    // ~15s), and only genuinely stale when the heartbeat actually stops updating for >60s —
    // in which case we keep showing the last-known number, correctly flagged stale.
    const ageStale = Date.now() - ts > EQUITY_STALE_AGE_MS;
    return {
      value: value.equity,
      unrealized: value.unrealized,
      source: ageStale ? "stale" : "real-hl",
      stale: ageStale,
      ts,
      openCount: value.openCount,
      openExposure: value.openExposure,
    };
  } catch {
    // Cold (never observed) AND upstream failed/absent. NEVER substitute the
    // Python DB realized-PnL sum — surface "unavailable" so the UI shows a
    // placeholder, not a virtual number. open numbers null ⇒ caller keeps the
    // replica (Python) open-count / deployed rather than inventing 0.
    return {
      value: null,
      unrealized: null,
      source: "unavailable",
      stale: false,
      ts: 0,
      openCount: null,
      openExposure: null,
    };
  }
}

// WA-P2 (2026-06-12): a calendar date-range picker can request an arbitrary span
// via ?start=YYYY-MM-DD&end=YYYY-MM-DD. It rides this SAME route + helper: the two
// dates are passed as argv to query_auto_state.py, which adds a `custom` window via
// the SAME compute_windows + get_equity_at path (no new P&L/denominator math). The
// presets are still always computed — `custom` is purely additive.
//
// Cache-key discipline: a custom request is keyed `auto-state:<start>:<end>` so its
// payload NEVER pollutes or is served from the preset "auto-state" entry (and two
// distinct ranges don't collide). Presets stay on the constant key. Shape (here)
// is validated only — the Python re-validates and emits NO `custom` key on a bad
// span, so a malformed range degrades to a clean preset-only response.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const custom =
    start && end && DATE_RE.test(start) && DATE_RE.test(end)
      ? { start, end }
      : null;

  try {
    const [state, equity, lifetimeDeposits] = await Promise.all([
      cache.swr(custom ? `auto-state:${custom.start}:${custom.end}` : "auto-state", async () => {
        // Python still supplies realized windows / counts / exposure / unrealized
        // / flags. Its own equity is DISCARDED below (see EQT-A3). When `custom` is
        // set, the two dates ride through as argv and add a `custom` window.
        const args = custom ? [custom.start, custom.end] : [];
        const raw = await runPython("query_auto_state.py", args, { timeout: 10_000 });
        return safeJsonParse<AutoStateResponse>(raw, FALLBACK);
      }),
      resolveRealHlEquity(),
      getLifetimeNetDeposits(),
    ]);

    const value = state.value;
    const available = equity.value !== null;
    const realHlEquity = equity.value ?? 0;

    // BASE-B2 (2026-06-20): repoint the realized-% base to ONE fixed figure =
    // lifetime HL NET DEPOSITS (all capital in − out, ever; src/lib/hl-deposits.ts),
    // replacing WA-P1's per-window start-of-window equity. The old per-window base
    // shifted window-to-window and could exceed −100% (impossible vs real capital);
    // a single fixed base makes equal dollar P&L read as equal %. The Python's
    // `realized` numerator is untouched (denominator-only change). When the base is
    // unavailable (HL unreachable / no address), `lifetimeDeposits` is null → every
    // window's % stays null → renders "—" (fail-open from BASE-B1/B3) — NEVER a
    // wrong number off a stored proxy ($50 / $70.91). `equity_usd`/`equity` still
    // mirror real HL (the live account-value line is correct as-is — EQT-A3 intact).
    const rebasedPct: NullableWindows = { ...NULL_WINDOWS };
    const rebasedBase: NullableWindows = { ...NULL_WINDOWS };
    if (lifetimeDeposits !== null && lifetimeDeposits > 0) {
      const base = lifetimeDeposits;
      const realized = value.realized;
      (Object.keys(realized) as (keyof RealizedWindows)[]).forEach((k) => {
        const v = realized[k];
        if (typeof v === "number") {
          rebasedBase[k] = base;
          // match the Python 4-dp rounding the old realized_pct used.
          rebasedPct[k] = Math.round((v / base) * 100 * 1e4) / 1e4;
        }
      });
    }

    return NextResponse.json({
      ...value,
      ts: state.ts,
      // ── real-HL equity: single source of truth, never the DB realized sum ──
      equity_usd: realHlEquity,
      equity: realHlEquity, // legacy alias kept in sync
      // W-H-P3-HUB: floating PnL also mirrors real HL — prefer the heartbeat's
      // unrealized (the Hub has no HL creds, so the script's own value is always
      // 0). Falls back to the script value only when the heartbeat is unavailable.
      unrealized_usd: equity.unrealized ?? value.unrealized_usd,
      // W-H-P4-HUB: OPEN/live numbers mirror the heartbeat (live), NOT the ≤15min
      // litestream replica the Python script reads — this kills the transient
      // phantom open-count + deployed (e.g. a just-closed #100444 lingering for one
      // restore window). `open_exposure_usd` (deployed) = Σ heartbeat
      // open_positions[].notional_usd. Closed history / realized stay on the replica
      // (fine at 15min). Fall back to the replica value only when the heartbeat was
      // never observed (openCount/openExposure null).
      open_count: equity.openCount ?? value.open_count,
      open_positions_count: equity.openCount ?? value.open_positions_count,
      open_exposure_usd: equity.openExposure ?? value.open_exposure_usd,
      // BASE-B2: OVERRIDE realized_pct + realized_base onto the fixed
      // lifetime-net-deposits base (rebased above) — the Python's snapshot-based
      // values from `...value` are intentionally replaced. The legacy
      // `pnl_today_pct` tracks the same rebased today value.
      realized_pct: rebasedPct,
      realized_base: rebasedBase,
      pnl_today_pct: rebasedPct.today ?? 0,
      equity_available: available,
      equity_stale: equity.stale,
      equity_source: equity.source,
      equity_ts: equity.ts,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ...FALLBACK,
        equity_available: false,
        equity_stale: false,
        equity_source: "unavailable" as EquitySource,
        equity_ts: 0,
        error: String(err),
      },
      { status: 200 },
    );
  }
}
