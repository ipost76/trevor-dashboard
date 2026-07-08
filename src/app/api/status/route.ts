import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// In-memory cache (60s TTL).
// PERF-02 (2026-06-02): single-flight + SWR so a concurrent poller burst on this
// high-traffic route collapses to ONE compute (systemctl + Python child) per
// window. The per-request `cached` flag + `latencyMs` are preserved; the catch
// keeps the prior cold-failure error shape (ok:false). A warm failure now serves
// stale instead of the error shape (strictly better).
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 60_000, concurrency: 2 });

export async function GET() {
  const start = Date.now();
  const servedFromCache = cache.peek("status") !== undefined;

  try {
    const { value } = await cache.swr("status", computeStatus);
    const resp: Record<string, unknown> = { ...value, latencyMs: Date.now() - start };
    if (servedFromCache) resp.cached = true;
    return NextResponse.json(resp);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      trevor: { running: false, pid: 0 },
      signals: { total: 0, wins: 0, losses: 0, pending: 0 },
      recentSignals: [],
      error: String(err),
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  }
}

// W-F-P3: the bot (trevor.service) runs on the VM, not on this WSL Hub box, so a
// LOCAL `systemctl show trevor` can never see it → the old check resolved
// running:false permanently (the OFFLINE-banner bug). Instead derive running from
// the Observatory heartbeat the Hub already proxies for account_value_usd (same VM
// endpoint as src/app/api/auto/state/route.ts — no new VM dependency).
const OBSERVATORY_HEARTBEAT_URL =
  "https://trevor-prime-2.tail2bf7a3.ts.net:8443/api/heartbeat";

// The heartbeat republishes on a 2h cadence (HEARTBEAT_CADENCE_SECONDS=7200), so a
// fresh snapshot is anything younger than that window. 3h (1.5× cadence) gives a
// full window + 1h grace before we treat the heartbeat as stale — tighter than the
// cadence would false-OFFLINE between beats (the very bug we're fixing).
const HEARTBEAT_STALE_MS = 3 * 60 * 60 * 1000;

// RM-DECOM B5 (2026-07-08): the bot-running fallback when the Observatory is
// decommissioned (B3). A replica newer than this ⇒ the VM litestream/restore
// pipeline is alive, so the bot box is up — don't cry a false OFFLINE just
// because the Observatory heartbeat is gone. The restore timer runs ~15min (full
// restore ~8-14min ⇒ effective freshness ~20-30min); 60min is well above that
// variance, so exceeding it means even the restore pipeline has stopped → a
// legitimate OFFLINE. Only consulted when the heartbeat probe is 'unavailable'.
const REPLICA_ALIVE_MAX_S = 60 * 60;

interface HeartbeatServiceItem {
  name?: string;
  active?: boolean;
  pid?: string;
}
interface StatusHeartbeat {
  timestamp?: string;
  categories?: { services?: { items?: HeartbeatServiceItem[] } };
}

// RM-DECOM B5 (2026-07-08): heartbeat probe with three DEFINITE-vs-INDETERMINATE
// verdicts, so the bot-running signal doesn't false-OFFLINE once B3 kills the
// Observatory. Never keys off overall_status. Catches internally → never throws.
//   • 'active'      — heartbeat fresh + trevor.service entry active → definitely up.
//   • 'inactive'    — heartbeat fresh + entry INACTIVE → definitely down (a REAL
//                     bot death; the caller must still surface OFFLINE, NOT mask it).
//   • 'unavailable' — heartbeat unreachable / non-200 / timeout / stale, OR the
//                     entry is absent → the Hub can't confirm via Observatory; the
//                     caller falls back to replica freshness instead of OFFLINE.
type BotProbe = { state: "active" | "inactive" | "unavailable"; pid: number };

async function probeBotViaHeartbeat(serviceName: string): Promise<BotProbe> {
  try {
    const res = await fetch(OBSERVATORY_HEARTBEAT_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { state: "unavailable", pid: 0 };
    const hb = (await res.json()) as StatusHeartbeat;

    // Freshness: the snapshot must be within the cadence-derived staleness window.
    const ts = hb?.timestamp ? Date.parse(hb.timestamp) : NaN;
    if (!Number.isFinite(ts) || Date.now() - ts > HEARTBEAT_STALE_MS) {
      return { state: "unavailable", pid: 0 };
    }

    // Bot/service field: the trevor.service entry's `active` flag mirrors the VM's
    // `systemctl is-active`. Strip a trailing `.service` so env "trevor" matches the
    // heartbeat's "trevor.service".
    const want = serviceName.replace(/\.service$/, "");
    const item = (hb?.categories?.services?.items ?? []).find(
      (i) => (i?.name ?? "").replace(/\.service$/, "") === want,
    );
    // Missing entry ⇒ Observatory can't report the bot ⇒ unavailable (fall back).
    // A PRESENT entry is a definite verdict — a real death here must still show
    // OFFLINE, so do NOT mask it with the replica fallback.
    if (!item) return { state: "unavailable", pid: 0 };
    if (item.active === true) {
      return { state: "active", pid: parseInt(item.pid ?? "", 10) || 0 };
    }
    return { state: "inactive", pid: 0 };
  } catch {
    return { state: "unavailable", pid: 0 };
  }
}

async function computeStatus(): Promise<Record<string, unknown>> {
  const trevorService = process.env.TREVOR_SERVICE_NAME || "trevor.service";
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  let signalStats = { total: 0, wins: 0, losses: 0, pending: 0 };
  let recentSignals: Array<{ ticker: string; direction: string; confidence: number; timestamp: string }> = [];
  let replicaAgeSeconds: number | null = null;

  // RM-DECOM B5: probe the bot via the heartbeat (fresh + trevor.service active).
  // Post-B3 the Observatory is decommissioned → 'unavailable' → the replica-
  // freshness fallback below decides, so the header doesn't show a false OFFLINE.
  const probe = await probeBotViaHeartbeat(trevorService);

    // Query DB via Python — the Hub has no Node SQLite binding, so every DB read
    // goes through the Python bridge (QUAL-06 2026-06-03: corrected a stale comment
    // that claimed the sqlite3 CLI wasn't installed — it is; that was never the reason).
    try {
      const pyScript = `
import sqlite3, json, os
from datetime import datetime, timezone
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
result = {}

# Trade insights as signal proxy
try:
    rows = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()
    result["total"] = rows[0] if rows else 0
except: result["total"] = 0

# Recent trade insights
try:
    rows = conn.execute("SELECT ticker, signal_type, confidence, created_at FROM trade_insights ORDER BY created_at DESC LIMIT 5").fetchall()
    result["recent"] = [{"ticker": r[0], "direction": r[1] or "?", "confidence": int(r[2]*100) if r[2] and r[2] <= 1 else int(r[2] or 0), "timestamp": r[3] or ""} for r in rows]
except: result["recent"] = []

# RM-DECOM B5: replica file age — the bot-running fallback signal once the
# Observatory heartbeat is decommissioned (a fresh replica ⇒ VM pipeline alive).
try:
    st = os.stat(os.path.realpath("${dbPath}"))
    result["replica_age_seconds"] = int(datetime.now(timezone.utc).timestamp() - st.st_mtime)
except: result["replica_age_seconds"] = None

conn.close()
print(json.dumps(result))
`;
      const pyResult = await runPythonInline(pyScript, { timeout: 8000 });
      const dbData = JSON.parse(pyResult);
      signalStats.total = dbData.total || 0;
      recentSignals = dbData.recent || [];
      if (typeof dbData.replica_age_seconds === "number") {
        replicaAgeSeconds = dbData.replica_age_seconds;
      }
    } catch { /* DB query failed — graceful */ }

  // RM-DECOM B5: decide running. 'active'/'inactive' are DEFINITE heartbeat
  // verdicts (a real bot death still surfaces OFFLINE). 'unavailable' (Observatory
  // decommissioned) falls back to REPLICA FRESHNESS: a replica newer than
  // REPLICA_ALIVE_MAX_S ⇒ the VM litestream/restore pipeline is alive, so don't
  // false-OFFLINE just because the Observatory is gone. A genuinely stale replica
  // (whole pipeline dead) legitimately reports OFFLINE.
  let trevorRunning: boolean;
  const trevorPid = probe.pid;
  let runningSource: "heartbeat" | "replica-fresh" | "replica-stale";
  if (probe.state === "active") {
    trevorRunning = true;
    runningSource = "heartbeat";
  } else if (probe.state === "inactive") {
    trevorRunning = false;
    runningSource = "heartbeat";
  } else {
    const fresh =
      replicaAgeSeconds !== null && replicaAgeSeconds < REPLICA_ALIVE_MAX_S;
    trevorRunning = fresh;
    runningSource = fresh ? "replica-fresh" : "replica-stale";
  }

  const responseData = {
    ok: true,
    // `source` is additive (honesty): heartbeat = confirmed; replica-fresh =
    // inferred from a live restore pipeline once the Observatory is gone;
    // replica-stale = the pipeline itself looks dead. Consumers read only
    // `running`/`pid` (header, status-bar) — the new field is non-breaking.
    trevor: { running: trevorRunning, pid: trevorPid, source: runningSource },
    signals: signalStats,
    recentSignals,
    timestamp: new Date().toISOString(),
    latencyMs: 0,
  };
  return responseData;
}
