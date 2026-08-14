import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import { fetchHeartbeatOpenSet } from "@/lib/heartbeat-open-set";

// GET /api/auto/trades?type=open|closed&limit=N — D3 consolidated trades view.
//
// type=open    -> { type, count, positions: [...], live }
// type=closed  -> { type, count, trades: [...] }
//
// limit is clamped to 1..200 (default 10). READ-ONLY.
//
// KPI-RECON (2026-06-29): type=open now derives its open SET from the live
// Observatory heartbeat (W-H-P4-HUB) — the SAME source the AUTO CAPITAL header
// (`/api/auto/state`) uses for open-count / deployed / floating — and ENRICHES
// each card from the litestream replica `auto_trades WHERE status='open'` row
// where it exists. Previously this route returned the replica set directly,
// which lags real HL by up to ~15min, so a position opened inside a sync window
// (counted live in the header) was silently absent from the ACTIVE card list.
// Now: membership = live heartbeat; a position not yet replicated renders as a
// THIN live card (`thin:true`, heartbeat fields only) rather than being dropped.
// `live:true` ⇒ heartbeat-sourced (cluster badges LIVE); `live:false` ⇒ the
// heartbeat was unavailable and we fell back to the replica set (badges REPLICA).
// type=closed is UNCHANGED — closed history correctly stays on the replica.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TradesResponse {
  type: "open" | "closed";
  count: number;
  /** W4a: replica lag measured when this payload was BUILT (a duration). */
  replica_age_seconds?: number | null;
  /**
   * B2-RM-PROFIT: the ABSOLUTE replica watermark (real UTC epoch SECONDS) the
   * freshness stamp derives from. Deliberately ABSENT from `fallback` below —
   * a failed read has no watermark, and <ReplicaAge> renders AGE UNKNOWN for
   * it rather than inventing a fresh-looking one.
   */
  replica_mtime_epoch_s?: number | null;
  positions?: Record<string, unknown>[];
  trades?: Record<string, unknown>[];
  // KPI-RECON: open-set freshness tier. true ⇒ live heartbeat-sourced;
  // false ⇒ heartbeat unavailable, replica fallback. Drives the card's badge.
  live?: boolean;
  error?: string;
}

// KPI-RECON: a merged open position. Replica rows carry the rich detail; a
// heartbeat-only ("thin") position has the detail fields null until it
// replicates. The index signature keeps it spread-/JSON-compatible with the
// loose `positions?: Record<string, unknown>[]` contract above.
interface OpenPositionRow {
  id: number;
  ticker?: string;
  direction?: string;
  entry_price?: number | null;
  stop_price?: number | null;
  target_price?: number | null;
  leverage?: number | null;
  confidence?: number | null;
  notional_usd?: number | null;
  opened_at?: string | null;
  peak_pnl_pct?: number | null;
  exit_signals_log?: string | null;
  trade_mode?: string | null;
  /**
   * B6-LEDGER: PAPER per the authority (`lib/paper_mode.py`, mirroring the VM's
   * `_is_paper_position`) — NOT `trade_mode`, which is stamped 'live' on seven
   * post-cutover paper rows. **`undefined` is load-bearing**: a thin heartbeat
   * card has no replica row yet, so its mode is genuinely unknown and the card
   * must render MODE?, never a confident LIVE. Same discipline as `trade_mode`
   * being null there rather than hardcoded.
   */
  is_paper?: boolean;
  thin?: boolean;
  [k: string]: unknown;
}

// PERF-02: 15s SWR cache, keyed by `${type}:${limit}` so open/closed and each
// limit hold independent entries. concurrency:2 per spec.
const cache = createSwrCache<TradesResponse>({ defaultTtl: 15_000, concurrency: 2 });

// B1 HEARTBEAT-FAILSAFE (2026-06-30): replica closed-history cross-check.
interface ClosedIdsResponse {
  closed_ids?: number[];
}

// Return the subset of `ids` the litestream replica explicitly marks
// status='closed' (query_closed_ids.py, mode=ro). NEVER ids merely ABSENT from
// the replica — absence ≠ closed, so a fast-syncing live position not yet
// replicated (FARTCOIN #101066) is never evicted. Fails OPEN: any error → empty
// set (evict nothing); the Phase-2 staleness ceiling in heartbeat-open-set.ts is
// the complementary bound, so a replica hiccup can never blank the live list.
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const typeParam = (url.searchParams.get("type") ?? "closed").toLowerCase();
  if (typeParam !== "open" && typeParam !== "closed") {
    return NextResponse.json(
      { error: "type must be 'open' or 'closed'" },
      { status: 400 },
    );
  }
  const type = typeParam as "open" | "closed";
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  // B2 (2026-07-15): ceiling 200 -> 2000 so a full closed-trades ET date range
  // (1W ~203, MAX ~482 post-cutover) is returned without silent truncation. The
  // RECENT tab is the ONLY type=closed caller; type=open callers pass <=50, so the
  // raised ceiling never bites there. Perf is a non-issue (sub-ms full scan+sort).
  const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? limitRaw : 10));

  // B2: OPTIONAL inclusive ET date-range params (closed path only) — matching the
  // capital-hero -> query_auto_state convention (?start=&end=, inclusive picked
  // dates; the exclusive +1-day upper bound is applied Python-side). validDate is
  // a strict shape + real-calendar-date round-trip guard: it rejects injection,
  // non-padded, and semantically-invalid dates (2026-13-99, 2026-02-30). A
  // malformed value is DROPPED to null (fail-open to the cutover-floored default) —
  // never a 400, never interpolated (runPython passes an argv array, no shell).
  const validDate = (s: string | null): s is string => {
    if (s === null || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  const startRaw = url.searchParams.get("start");
  const endRaw = url.searchParams.get("end");
  // Both must be valid to form a range; anything else -> null (keys as no-range).
  const start = validDate(startRaw) ? startRaw : null;
  const end = validDate(endRaw) ? endRaw : null;

  const fallback: TradesResponse =
    type === "open"
      ? { type, count: 0, positions: [] }
      : { type, count: 0, trades: [] };

  // ── type=open: live heartbeat membership + replica enrichment (KPI-RECON) ──
  if (type === "open") {
    try {
      const { value } = await cache.swr(`open:${limit}`, async () => {
        // Replica rows carry the rich per-card detail (stop/target/confidence/
        // opened_at/peak/exit_signals_log). Keyed by id for enrichment below.
        const raw = await runPython("query_auto_trades.py", ["open", String(limit)], {
          timeout: 5_000,
        });
        const replica = safeJsonParse<TradesResponse>(raw, fallback);
        const replicaPositions = (replica.positions ?? []) as OpenPositionRow[];

        // LIVE membership = the heartbeat open-set — the SAME source the header's
        // open-count / deployed read. Null ⇒ heartbeat down ⇒ keep the replica
        // set unchanged (never blank) and flag the tier so the card badges REPLICA.
        const liveSet = await fetchHeartbeatOpenSet();
        if (!liveSet) {
          return { ...replica, live: false };
        }

        const byId = new Map(replicaPositions.map((p) => [p.id, p]));
        const merged: OpenPositionRow[] = liveSet.map((h) => {
          const r = byId.get(h.id);
          if (r) {
            // Synced: full replica detail (its notional matches the heartbeat's).
            return { ...r, thin: false };
          }
          // Thin live card — heartbeat fields only; detail not yet replicated.
          // Rendered with a "syncing" hint client-side; NEVER dropped.
          return {
            id: h.id,
            ticker: h.ticker,
            direction: h.direction,
            entry_price: h.entry_price,
            leverage: h.leverage,
            notional_usd: h.notional_usd,
            stop_price: null,
            target_price: null,
            confidence: null,
            opened_at: null,
            peak_pnl_pct: null,
            exit_signals_log: null,
            // 🚨 W4a: was hardcoded `"live"`. A thin card is built from heartbeat
            // fields ONLY — the replica row that carries `trade_mode` has not
            // arrived yet, so the mode is genuinely unknown here and asserting
            // "live" was a fabricated claim that would have labelled a paper
            // position as real money. null => the card renders an explicit
            // unconfirmed pill, never a confident LIVE. NEVER hardcode a mode.
            trade_mode: null,
            thin: true,
          };
        });
        // B1 HEARTBEAT-FAILSAFE: replica cross-check eviction — drop any heartbeat
        // "open" id the replica explicitly marks status='closed' (the −17% HYPE
        // ghost, closed row 101112) so a stale/persistent-cache ghost can never
        // render as an open card. ONE batched query over the candidate ids;
        // absence ≠ closed, so a fast-syncing live position not yet replicated
        // (FARTCOIN #101066) survives. Fails OPEN (evict nothing on any error).
        const closedIds = await fetchClosedIds(merged.map((p) => p.id));
        const surviving =
          closedIds.size > 0 ? merged.filter((p) => !closedIds.has(p.id)) : merged;
        // Newest-first (id is monotonic with opened_at), then clamp to the limit.
        surviving.sort((a, b) => b.id - a.id);
        const positions = surviving.slice(0, limit);
        return { type: "open", count: positions.length, positions, live: true };
      });
      return NextResponse.json(value);
    } catch (err) {
      return NextResponse.json({ ...fallback, error: String(err) }, { status: 200 });
    }
  }

  // ── type=closed: CLOSED history stays on the litestream replica (doctrine) ──
  // PERF-02 (2026-06-02): single-flight + SWR (15s), keyed by closed:limit so
  // each distinct view collapses concurrent requests to ONE Python child per
  // window. The try/catch preserves the fail-safe (200 + fallback shape).
  try {
    // B2: vary the SWR key by range so TODAY and 1W (etc.) never serve each
    // other's cached result within the 15s TTL — the highest-probability bug in
    // this change. Keyed on the VALIDATED start/end, so a dropped-malformed param
    // keys identically to no-range (`closed:${limit}::`).
    const { value } = await cache.swr(
      `closed:${limit}:${start ?? ""}:${end ?? ""}`,
      async () => {
        // Pass start/end as argv[3]/argv[4] ONLY when both are valid; else the
        // default cutover-floored view. argv array => no shell => injection-safe;
        // the Python re-validates + parameterizes the bounds.
        const args =
          start !== null && end !== null
            ? ["closed", String(limit), start, end]
            : ["closed", String(limit)];
        const raw = await runPython("query_auto_trades.py", args, {
          timeout: 5_000,
        });
        // B2: close the error-vs-empty gap — a parse failure now carries an
        // `error` field (was a silent {trades:[]}), so the client can tell "fetch
        // broke" from "no trades this day". The Python's own error payloads
        // already carry `error`, and the runPython-throw catch below does too — so
        // EVERY failure path is now distinguishable from a genuine empty day.
        return safeJsonParse<TradesResponse>(raw, {
          ...fallback,
          error: "unparseable closed-trades response",
        });
      },
    );
    return NextResponse.json(value);
  } catch (err) {
    return NextResponse.json(
      { ...fallback, error: String(err) },
      { status: 200 },
    );
  }
}
