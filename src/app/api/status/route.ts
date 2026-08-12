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

// [B9] 2026-08-11 — how stale the BOT's own newest heartbeat may be, measured at the
// replica snapshot (see the decision block below for why that framing matters).
// 🚨 DELIBERATELY NOT `max(3600, cadence*2)`, the project's per-loop stale rule. That
//   rule is correct for judging ONE loop; this is a MAX across 23 of them, and the
//   slowest carries cadence_seconds=86400, which would yield a 48-hour "bound" — a
//   number that reads like a threshold and functions like the absence of one. When the
//   bot dies EVERY loop stops, so the signal is governed by the FASTEST loop (30s), and
//   the only real question is how much jitter to absorb. 3600s is 120x that cadence and
//   is the same hour REPLICA_ALIVE_MAX_S already spends, so this makes the hour the code
//   always claimed into the hour it actually enforces, rather than minting a fourth
//   definition of stale beside the three that already agree.
const BOT_HEARTBEAT_MAX_S = 60 * 60;

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
  let botHeartbeatLagSeconds: number | null = null;

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

# [B9] 2026-08-11 — THE BOT-AUTHORED SIGNAL. See the TS note on BOT_HEARTBEAT_MAX_S.
# Measured against the REPLICA FILE'S OWN MTIME, not wall clock: both terms then come
# from the SAME snapshot, so the replica's sync lag cancels exactly. Measured live at
# build time: age-at-snapshot 79.4s vs a naive wall-clock 182.2s on the same row, the
# difference being the 102.8s the file had been sitting there. That cancellation is
# what makes a replica read legitimate here — B6's "never staleness-check the replica"
# rule stands, and this does not break it, because this is not a wall-clock check.
# trainer_search_loop is EXCLUDED: it is written from WSL over the ssh pipe by
# trevor-trainer-observe, so it keeps advancing while trevor.service is dead — using
# it would rebuild the very false-green this replaces, one layer down.
try:
    hb = conn.execute(
        "SELECT MAX(last_iteration_at) FROM loop_heartbeat "
        "WHERE loop_name <> 'trainer_search_loop' AND last_iteration_at IS NOT NULL"
    ).fetchone()
    if hb and hb[0]:
        newest = datetime.fromisoformat(str(hb[0]).replace("Z", "+00:00"))
        if newest.tzinfo is None:
            newest = newest.replace(tzinfo=timezone.utc)
        st2 = os.stat(os.path.realpath("${dbPath}"))
        result["bot_heartbeat_lag_seconds"] = int(st2.st_mtime - newest.timestamp())
    else:
        result["bot_heartbeat_lag_seconds"] = None
except Exception:
    result["bot_heartbeat_lag_seconds"] = None

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
      if (typeof dbData.bot_heartbeat_lag_seconds === "number") {
        botHeartbeatLagSeconds = dbData.bot_heartbeat_lag_seconds;
      }
    } catch { /* DB query failed — graceful */ }

  // RM-DECOM B5: decide running. 'active'/'inactive' are DEFINITE heartbeat
  // verdicts (a real bot death still surfaces OFFLINE). 'unavailable' (Observatory
  // decommissioned) falls back to REPLICA FRESHNESS: a replica newer than
  // REPLICA_ALIVE_MAX_S ⇒ the VM litestream/restore pipeline is alive, so don't
  // false-OFFLINE just because the Observatory is gone. A genuinely stale replica
  // (whole pipeline dead) legitimately reports OFFLINE.
  // 🚨 [B9] 2026-08-11 — THE 60-MINUTE BOUND WAS NOT A BOUND. (A5 F-4 / master B-29.)
  //   `replica_age_seconds` is the age of a FILE, and `trevor-tailsync` republishes that
  //   file by atomic mv every ~21 minutes knowing NOTHING about the bot — it contains
  //   zero references to trevor.service, is-active or any heartbeat. So if the bot died
  //   while the VM and the sync pipeline stayed up, the age never approached 3600 and
  //   this asserted running:true INDEFINITELY. The constant said one hour; the mechanism
  //   said forever. The bound only ever bound the SYNC PIPELINE, never the bot.
  //
  //   Fixed by gating on a signal the BOT ITSELF writes — loop_heartbeat, 23 bot-owned
  //   rows — and measuring it against the replica file's own mtime so the sync lag
  //   cancels. When the bot dies, tailsync keeps advancing the mtime while the newest
  //   heartbeat freezes, so this delta grows without bound and crosses the threshold.
  //   That is the same event that used to be invisible.
  //
  //   A read failure yields null and is reported as UNVERIFIED, never as OK and never as
  //   a false OFFLINE: `running` keeps its old replica-freshness answer, but the source
  //   says the bot signal could not be read, and the screen renders that. An absent
  //   signal is not a negative signal.
  let trevorRunning: boolean;
  const trevorPid = probe.pid;
  let runningSource:
    | "heartbeat"
    | "replica-fresh"
    | "replica-stale"
    | "bot-heartbeat-stale"
    | "replica-fresh-bot-unverified";
  if (probe.state === "active") {
    trevorRunning = true;
    runningSource = "heartbeat";
  } else if (probe.state === "inactive") {
    trevorRunning = false;
    runningSource = "heartbeat";
  } else {
    const fresh =
      replicaAgeSeconds !== null && replicaAgeSeconds < REPLICA_ALIVE_MAX_S;
    if (!fresh) {
      trevorRunning = false;
      runningSource = "replica-stale";
    } else if (botHeartbeatLagSeconds === null) {
      trevorRunning = true;
      runningSource = "replica-fresh-bot-unverified";
    } else if (botHeartbeatLagSeconds >= BOT_HEARTBEAT_MAX_S) {
      trevorRunning = false;
      runningSource = "bot-heartbeat-stale";
    } else {
      trevorRunning = true;
      runningSource = "replica-fresh";
    }
  }

  const responseData = {
    ok: true,
    // `source` is additive (honesty): heartbeat = confirmed; replica-fresh =
    // inferred from a live restore pipeline once the Observatory is gone;
    // replica-stale = the pipeline itself looks dead. Consumers read only
    // `running`/`pid` (header, status-bar) — the new field is non-breaking.
    // [B9] botHeartbeatLagSeconds / replicaAgeSeconds are additive and are what let the
    // screen show the REAL age instead of a bare ONLINE. Both may be null (unreadable),
    // and null must render as "unverified", never as 0 and never as a clean state.
    trevor: {
      running: trevorRunning,
      pid: trevorPid,
      source: runningSource,
      botHeartbeatLagSeconds,
      replicaAgeSeconds,
    },
    signals: signalStats,
    recentSignals,
    timestamp: new Date().toISOString(),
    latencyMs: 0,
  };
  return responseData;
}
