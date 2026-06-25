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

interface HeartbeatServiceItem {
  name?: string;
  active?: boolean;
  pid?: string;
}
interface StatusHeartbeat {
  timestamp?: string;
  categories?: { services?: { items?: HeartbeatServiceItem[] } };
}

// Fresh heartbeat + the trevor.service entry active → running:true. Unreachable /
// non-200 / timeout / stale (>3h) / missing-or-inactive entry → running:false (honest
// OFFLINE — the Hub genuinely can't confirm the bot). Never keys off overall_status
// (a separate, independently-flapping health axis). Catches internally → never throws.
async function resolveBotRunning(
  serviceName: string,
): Promise<{ running: boolean; pid: number }> {
  try {
    const res = await fetch(OBSERVATORY_HEARTBEAT_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { running: false, pid: 0 };
    const hb = (await res.json()) as StatusHeartbeat;

    // Freshness: the snapshot must be within the cadence-derived staleness window.
    const ts = hb?.timestamp ? Date.parse(hb.timestamp) : NaN;
    if (!Number.isFinite(ts) || Date.now() - ts > HEARTBEAT_STALE_MS) {
      return { running: false, pid: 0 };
    }

    // Bot/service field: the trevor.service entry's `active` flag mirrors the VM's
    // `systemctl is-active`. Strip a trailing `.service` so env "trevor" matches the
    // heartbeat's "trevor.service".
    const want = serviceName.replace(/\.service$/, "");
    const item = (hb?.categories?.services?.items ?? []).find(
      (i) => (i?.name ?? "").replace(/\.service$/, "") === want,
    );
    if (!item || item.active !== true) return { running: false, pid: 0 };

    return { running: true, pid: parseInt(item.pid ?? "", 10) || 0 };
  } catch {
    return { running: false, pid: 0 };
  }
}

async function computeStatus(): Promise<Record<string, unknown>> {
  const trevorService = process.env.TREVOR_SERVICE_NAME || "trevor.service";
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  let trevorPid = 0;
  let trevorRunning = false;
  let signalStats = { total: 0, wins: 0, losses: 0, pending: 0 };
  let recentSignals: Array<{ ticker: string; direction: string; confidence: number; timestamp: string }> = [];

  // Derive running from the Observatory heartbeat the Hub already proxies (W-F-P3) —
  // the bot runs on the VM, so the old LOCAL `systemctl show trevor` resolved
  // running:false permanently. resolveBotRunning() reads the heartbeat's
  // services entry; any failure/staleness → { running:false, pid:0 } (honest OFFLINE).
  const bot = await resolveBotRunning(trevorService);
  trevorPid = bot.pid;
  trevorRunning = bot.running;

    // Query DB via Python — the Hub has no Node SQLite binding, so every DB read
    // goes through the Python bridge (QUAL-06 2026-06-03: corrected a stale comment
    // that claimed the sqlite3 CLI wasn't installed — it is; that was never the reason).
    try {
      const pyScript = `
import sqlite3, json
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

conn.close()
print(json.dumps(result))
`;
      const pyResult = await runPythonInline(pyScript, { timeout: 8000 });
      const dbData = JSON.parse(pyResult);
      signalStats.total = dbData.total || 0;
      recentSignals = dbData.recent || [];
    } catch { /* DB query failed — graceful */ }

  const responseData = {
    ok: true,
    trevor: { running: trevorRunning, pid: trevorPid },
    signals: signalStats,
    recentSignals,
    timestamp: new Date().toISOString(),
    latencyMs: 0,
  };
  return responseData;
}
