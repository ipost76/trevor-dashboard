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
  thin?: boolean;
  [k: string]: unknown;
}

// PERF-02: 15s SWR cache, keyed by `${type}:${limit}` so open/closed and each
// limit hold independent entries. concurrency:2 per spec.
const cache = createSwrCache<TradesResponse>({ defaultTtl: 15_000, concurrency: 2 });

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
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 10));

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
            trade_mode: "live",
            thin: true,
          };
        });
        // Newest-first (id is monotonic with opened_at), then clamp to the limit.
        merged.sort((a, b) => b.id - a.id);
        const positions = merged.slice(0, limit);
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
    const { value } = await cache.swr(`closed:${limit}`, async () => {
      const raw = await runPython("query_auto_trades.py", ["closed", String(limit)], {
        timeout: 5_000,
      });
      return safeJsonParse<TradesResponse>(raw, fallback);
    });
    return NextResponse.json(value);
  } catch (err) {
    return NextResponse.json(
      { ...fallback, error: String(err) },
      { status: 200 },
    );
  }
}
