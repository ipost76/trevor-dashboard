import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

// GET /api/auto/signals — W4b (2026-07-30), the SIGNAL surface.
//
// 🚨 WHY. During 18 hours of zero entries the Hub showed an empty screen, and
// three completely different situations render identically:
//     (a) no signals were produced
//     (b) signals were produced and none converted
//     (c) the replica has not caught up
// Ghost had no way to tell them apart, and the truth was (b) — the system was
// producing ~26 signals normally and dying at the last gate. This route exists
// to make the three distinguishable.
//
// Backed entirely by query_signals.py against the READ-ONLY replica. See that
// script's header for what the DB can and cannot honestly show — in particular
// that per-candidate Stage-A kill reasons live only in journals the Hub cannot
// read, and that `entry_failed` names no specific gate.
//
// 🚨 NO MODE DERIVATION HERE. The Hub has exactly one mode authority
// (src/lib/trading-mode.ts, W4a). This route reports `trade_mode` per row as
// data and derives nothing from it — a second derivation is the defect W4a
// closed. It also applies NO trade_mode filter: W4a removed that filter from
// five readers because it made the paper run invisible, and adding one back on
// a new surface would recreate the bug.
//
// READ-ONLY. Auth: middleware enforces the session cookie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which of the three states this window is in. Staleness is deliberately NOT a
 * member — it is a separate boolean, because a view can be stale AND showing
 * signals, and collapsing them would force a false choice.
 */
export type SignalState =
  | "converting"
  | "signals_no_trades"
  | "no_signals"
  | "scanner_silent";

interface SignalRow {
  signal_id: number;
  ticker: string;
  direction: string | null;
  confidence: number | null;
  /** confidence x100 (0-100), precomputed server-side. */
  score: number | null;
  quality_tier: string | null;
  regime: string | null;
  strategy: string | null;
  /** 🚨 REAL UTC — never re-localize an ET column with this. */
  created_at_utc: string;
  converted: boolean;
  trade_id: number | null;
  trade_mode: string | null;
  trade_status: string | null;
  /** FINAL-LEG net only. Realised net is `pnl_usd + (partial_pnl_realized ?? 0)`. */
  pnl_usd: number | null;
  /** B6-LEDGER: banked scale-out profit. Never render `pnl_usd` without it. */
  partial_pnl_realized: number | null;
  /**
   * B6-LEDGER: PAPER per the authority (`lib/paper_mode.py`, mirroring the VM's
   * `_is_paper_position`) — NOT `trade_mode`, which is stamped 'live' on seven
   * post-cutover paper rows. Branch the badge on this.
   */
  is_paper: boolean;
  exit_reason: string | null;
  exit_layer: number | null;
  /** null => no entry decision was ever recorded for this signal. */
  decision_action: string | null;
  /** Verbatim bot reason. `entry_failed` names no gate — do not prettify it. */
  decision_reason: string | null;
}

interface SignalsResponse {
  window_hours: number;
  replica_age_seconds: number | null;
  state: SignalState;
  replica_stale: boolean;
  /** Scanner quiet-time with replica lag subtracted; null when unknowable. */
  scanner_silent_seconds: number | null;
  scanner: {
    cycles: number;
    ticker_scans: number;
    candidates: number;
    signals_posted: number;
    newest_scan_utc: string | null;
    scan_age_seconds: number | null;
  };
  funnel: {
    signals: number;
    with_decision: number;
    rejected: number;
    converted: number;
    /** Signals with NO recorded decision — the honest gap, shown not hidden. */
    unexplained: number;
  };
  reject_reasons: Array<{ reason: string | null; n: number }>;
  signals: SignalRow[];
  data_available: boolean;
  error?: string;
}

// 🚨 FAIL-SAFE SHAPE. `state: "scanner_silent"` is the correct default for a
// failed read: it is the one value that claims nothing happened rather than
// asserting "no signals" (which would look like a working system finding
// nothing) or "converting" (which would look like success). `data_available`
// false is what the client keys the honest error state off.
const FALLBACK: SignalsResponse = {
  window_hours: 24,
  replica_age_seconds: null,
  state: "scanner_silent",
  replica_stale: false,
  scanner_silent_seconds: null,
  scanner: {
    cycles: 0,
    ticker_scans: 0,
    candidates: 0,
    signals_posted: 0,
    newest_scan_utc: null,
    scan_age_seconds: null,
  },
  funnel: { signals: 0, with_decision: 0, rejected: 0, converted: 0, unexplained: 0 },
  reject_reasons: [],
  signals: [],
  data_available: false,
};

const VALID_STATES: ReadonlyArray<SignalState> = [
  "converting",
  "signals_no_trades",
  "no_signals",
  "scanner_silent",
];

// 20s TTL — the scanner cadence is ~3 min and the replica publishes on a
// ~15 min timer, so anything tighter just re-spawns Python for identical rows.
const cache = createSwrCache<SignalsResponse>({ defaultTtl: 20_000, concurrency: 2 });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawHours = Number(url.searchParams.get("hours"));
  const hours =
    Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 168
      ? Math.floor(rawHours)
      : 24;

  try {
    const { value } = await cache.swr(`signals:${hours}`, async () => {
      const raw = await runPython("query_signals.py", [String(hours), "60"], {
        timeout: 10_000,
      });
      return safeJsonParse<SignalsResponse>(raw, {
        ...FALLBACK,
        window_hours: hours,
        error: "unparseable signals response",
      });
    });

    // 🚨 Validate the state at the boundary rather than trusting it. An older
    // query_signals.py or a truncated payload would leave `state` undefined,
    // and an undefined state renders as whichever branch the client checks
    // last — silently. Anything unrecognised collapses to "scanner_silent",
    // the value that asserts the least. Same discipline as W4a's
    // normalizePaperWindowState; the failure mode it prevents is identical.
    const state: SignalState = VALID_STATES.includes(value.state)
      ? value.state
      : "scanner_silent";

    return NextResponse.json({ ...value, state });
  } catch (err) {
    // Never 500 — a broken signals read must degrade to an honest "couldn't
    // load", which the client renders distinctly from a genuinely quiet window.
    return NextResponse.json(
      { ...FALLBACK, window_hours: hours, error: String(err) },
      { status: 200 },
    );
  }
}
