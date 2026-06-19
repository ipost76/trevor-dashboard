import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// B4 — Data-Freshness & Drift state (READ-ONLY).
//
// Surfaces the live-heartbeat open-count vs the lagging-replica open-count, the
// delta between them, and the replica file age — so the "2 open vs 3" confusion
// reads as *lagging-and-expected*, not *wrong*. The W-H-P4-HUB doctrine is that
// LIVE/open numbers come from the Observatory heartbeat and CLOSED history from
// the litestream replica; this endpoint makes the gap between the two legible.
//
// Both ingredients already reach the Hub (no new VM probe for the freshness
// half): LIVE = the Observatory heartbeat `categories.autotrader.open_count`;
// REPLICA = `COUNT(*) FROM active_trades WHERE status='open'` over the local
// litestream replica (the `/api/nav-badges` pattern). The replica file age is
// `os.stat(realpath(trevor.db)).st_mtime` (trevor.db is a symlink → the
// continuously-restored replica), mirroring `query_shadow_registry._replica_age`.
//
// Both reads are independent + error-handled: a failure in either half degrades
// THAT half to null, never a 500.
const OBSERVATORY_URL =
  "https://trevor-prime.tail2bf7a3.ts.net:8443/api/heartbeat";

// Replica half: open-position count + the file age. mode=ro, read-only.
const REPLICA_PY = `
import sqlite3, json, os
from datetime import datetime, timezone
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
out = {}
try:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT id, ticker, direction FROM active_trades WHERE status='open'"
    ).fetchall()
    conn.close()
    out["replica_count"] = len(rows)
    out["replica_positions"] = [
        {"id": r[0], "ticker": r[1], "direction": r[2]} for r in rows
    ]
except Exception as e:
    out["replica_error"] = str(e)
try:
    target = os.path.realpath(db)
    st = os.stat(target)
    out["replica_age_seconds"] = int(
        datetime.now(timezone.utc).timestamp() - st.st_mtime
    )
    out["replica_mtime"] = datetime.fromtimestamp(
        st.st_mtime, tz=timezone.utc
    ).strftime("%Y-%m-%d %H:%M:%S")
except Exception as e:
    out["replica_age_error"] = str(e)
print(json.dumps(out))
`;

interface LiveHalf {
  live_count: number | null;
  live_positions: unknown[];
  live_source: "heartbeat" | "unavailable";
  live_error?: string;
}

async function fetchLive(): Promise<LiveHalf> {
  try {
    const res = await fetch(OBSERVATORY_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        live_count: null,
        live_positions: [],
        live_source: "unavailable",
        live_error: `Observatory returned ${res.status}`,
      };
    }
    const data = await res.json();
    const at = data?.categories?.autotrader ?? {};
    const count = typeof at.open_count === "number" ? at.open_count : null;
    const positions = Array.isArray(at.open_positions) ? at.open_positions : [];
    return { live_count: count, live_positions: positions, live_source: "heartbeat" };
  } catch (error) {
    return {
      live_count: null,
      live_positions: [],
      live_source: "unavailable",
      live_error: String(error),
    };
  }
}

export async function GET() {
  const [live, replica] = await Promise.all([
    fetchLive(),
    (async (): Promise<Record<string, unknown>> => {
      try {
        const raw = await runPythonInline(REPLICA_PY, { timeout: 5000 });
        return JSON.parse(raw) as Record<string, unknown>;
      } catch (error) {
        return { replica_error: String(error) };
      }
    })(),
  ]);

  const liveCount = live.live_count;
  const replicaCount =
    typeof replica.replica_count === "number"
      ? (replica.replica_count as number)
      : null;
  const driftDelta =
    liveCount !== null && replicaCount !== null ? liveCount - replicaCount : null;

  return NextResponse.json({
    live_count: liveCount,
    replica_count: replicaCount,
    drift_delta: driftDelta,
    drift: driftDelta !== null ? driftDelta !== 0 : null,
    replica_age_seconds: replica.replica_age_seconds ?? null,
    replica_mtime: replica.replica_mtime ?? null,
    live_positions: live.live_positions,
    replica_positions: replica.replica_positions ?? [],
    live_source: live.live_source,
    errors: {
      live: live.live_error ?? null,
      replica: replica.replica_error ?? null,
      replica_age: replica.replica_age_error ?? null,
    },
  });
}
