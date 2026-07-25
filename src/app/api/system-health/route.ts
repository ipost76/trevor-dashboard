import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// In-memory cache (5 min TTL) — avoids 500ms Hyperliquid API ping on every call.
// PERF-02 (2026-06-02): single-flight + SWR so a concurrent burst collapses to
// ONE compute (subprocess-spawning Python child + HL ping) per window — this is
// the route whose synchronous subprocess fan-out triggered the original wedge.
// The per-request `cached` flag + `latencyMs` are preserved; the catch keeps the
// prior cold-failure 500. A warm failure now serves stale (strictly better).
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 300_000, concurrency: 2 });

// INFRA-05 (2026-06-03): the killswitch readout is a SAFETY field — it must
// NEVER serve a stale all-clear from the 300s body cache (QUAL-01). It is read
// on a separate VERY SHORT (2s) single-flight cache so a real engagement shows
// within ~2s, while the expensive HL-ping/collector body stays cached at 300s.
// Concurrent bursts still collapse to one tiny auto_config read per 2s window.
const ksCache = createSwrCache<Record<string, unknown>>({ defaultTtl: 2_000, concurrency: 2 });

export async function GET() {
  const start = Date.now();
  const servedFromCache = cache.peek("system-health") !== undefined;

  try {
    // Body (300s) + killswitch (2s, always-fresh safety field) in parallel.
    const [{ value }, { value: ks }] = await Promise.all([
      cache.swr("system-health", computeHealth),
      ksCache.swr("kill_switch", computeKillswitch),
    ]);
    const resp: Record<string, unknown> = {
      ...value,
      kill_switch: ks,
      latencyMs: Date.now() - start,
    };
    if (servedFromCache) resp.cached = true;
    return NextResponse.json(resp);
  } catch (e) {
    return NextResponse.json(
      { error: String(e), timestamp: new Date().toISOString(), latencyMs: Date.now() - start },
      { status: 500 }
    );
  }
}

// Fresh killswitch read (fail-SAFE, QUAL-01 semantics): engaged → {active:true,
// [reason]}, not engaged → {active:false}, ANY DB/spawn error → {active:null,
// status:"unknown"} — NEVER a false "inactive" all-clear. Never throws (so it
// can't 500 the whole route or poison the 2s cache).
async function computeKillswitch(): Promise<Record<string, unknown>> {
  const ksScript = `
import sqlite3, json
DB_PATH = '/home/trevor/trevor/trevor.db'
try:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5)
    rows = conn.execute(
        "SELECT key, value FROM auto_config WHERE key LIKE 'EMERGENCY_KILLSWITCH%'"
    ).fetchall()
    conn.close()
    d = dict(rows)
    active = str(d.get("EMERGENCY_KILLSWITCH", "false")).lower() == "true"
    out = {"active": active}
    if active:
        reason = d.get("EMERGENCY_KILLSWITCH_LAST_REASON", "")
        if reason:
            out["reason"] = reason
    print(json.dumps(out))
except Exception as e:
    print(json.dumps({"active": None, "status": "unknown", "error": str(e)}))
`;
  try {
    const out = await runPythonInline(ksScript, { timeout: 5000 });
    return JSON.parse(out) as Record<string, unknown>;
  } catch (e) {
    return { active: null, status: "unknown", error: String(e) };
  }
}

async function computeHealth(): Promise<Record<string, unknown>> {
  const pyScript = `
import sqlite3, json, time, os

DB_PATH = '/home/trevor/trevor/trevor.db'
result = {}

conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)

# Scanner status — last signal time, AGE-BOUNDED (RD-B7, 2026-07-25).
#
# This previously read: "running" if last_signal else "unknown" — a liveness claim
# asserted from mere EXISTENCE, with no age bound at all. Any row in trade_insights,
# of any age, yielded "running". A scanner dead for a week looked identical to a
# healthy one. Now "running" is claimed only when a signal is recent enough to
# vouch for; otherwise "unknown" (the enum's existing third value) — never "down".
#
# THRESHOLD (14400s / 4h) is the SAME bound and the SAME derivation as
# query_profit_risk.BREAKER_EVAL_STALE_S, because it is the same underlying event:
# RISK_BREAKERS_LAST_EVAL and this last_signal_at are written from the same signal
# arriving at the manager (observed identical to the second). Measured over 14 days
# of trade_insights (n=870 gaps): p50 718s, p90 3422s, p95 4861s, p99 9720s. 4h is
# ~3x p95; UNKNOWN wall-clock rate 3.0%.
#
# NOT derived from the ~3-min scan-loop cycle: trade_insights records signal
# EMISSIONS, not cycles — a cycle that finds nothing writes no row — and no
# scan-cycle heartbeat is readable from the replica. A 15-min (5x cycle) bound
# would read "unknown" 59% of wall-clock. So the honest claim narrows from "the
# scanner is running" to "a signal arrived recently enough to vouch for this".
#
# Age is UTC-vs-UTC (trade_insights.created_at is real UTC, matching auto_config).
# Fail-safe: no row / unparseable / read error -> stale, status "unknown", never a
# silent "running".
SIGNAL_STALE_S = 14400
try:
    row = conn.execute("SELECT created_at FROM trade_insights ORDER BY id DESC LIMIT 1").fetchone()
    last_signal = row[0] if row else None
    age_s = None
    if last_signal:
        try:
            from datetime import datetime, timezone
            _parsed = datetime.strptime(str(last_signal).strip(), "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
            age_s = int((datetime.now(timezone.utc) - _parsed).total_seconds())
        except Exception:
            age_s = None  # present but undatable -> cannot prove freshness
    stale = age_s is None or age_s > SIGNAL_STALE_S
    result["scanner"] = {
        "last_signal_at": last_signal,
        "last_signal_age_s": age_s,
        "last_signal_stale": stale,
        "last_signal_stale_after_s": SIGNAL_STALE_S,
        "status": "unknown" if stale else "running",
    }
except:
    result["scanner"] = {
        "status": "unknown", "last_signal_at": None, "last_signal_age_s": None,
        "last_signal_stale": True, "last_signal_stale_after_s": SIGNAL_STALE_S,
    }

# Signal volume
try:
    today = conn.execute("SELECT COUNT(*) FROM trade_insights WHERE DATE(created_at) = DATE('now')").fetchone()[0]
    avg_row = conn.execute("""
        SELECT AVG(daily_count) FROM (
            SELECT COUNT(*) as daily_count FROM trade_insights
            WHERE created_at > datetime('now', '-7 days') AND DATE(created_at) < DATE('now')
            GROUP BY DATE(created_at)
        )
    """).fetchone()
    seven_day_avg = round(float(avg_row[0] or 0), 1)
    change_pct = round(((today - seven_day_avg) / seven_day_avg) * 100, 1) if seven_day_avg > 0 else 0
    result["signals"] = {"today": today, "seven_day_avg": seven_day_avg, "change_pct": change_pct}
except:
    result["signals"] = {"today": 0, "seven_day_avg": 0, "change_pct": 0}

conn.close()

# Hyperliquid API health
try:
    import requests
    t0 = time.time()
    resp = requests.post('https://api.hyperliquid.xyz/info', json={"type": "allMids"}, timeout=5)
    latency_ms = int((time.time() - t0) * 1000)
    result["api"] = {"hyperliquid": {"healthy": resp.status_code == 200, "latency_ms": latency_ms}}
except Exception as e:
    result["api"] = {"hyperliquid": {"healthy": False, "latency_ms": 0, "error": str(e)}}

# Circuit breakers
try:
    import sys
    sys.path.insert(0, '/home/trevor/trevor')
    from confidence_calibrator import get_circuit_breaker_status
    result["circuit_breakers"] = get_circuit_breaker_status()
except:
    result["circuit_breakers"] = []

# Kill switch is INTENTIONALLY NOT read here (INFRA-05): it is a safety field
# read fresh on every request via a separate 2s cache (computeKillswitch) so the
# 300s body cache can never serve a stale all-clear. The GET handler merges
# result["kill_switch"] from that fresh read.

print(json.dumps(result, default=str))
`;

  const pyResult = await runPythonInline(pyScript, { timeout: 10000 });
  const data = JSON.parse(pyResult);

  return {
    ...data,
    timestamp: new Date().toISOString(),
    latencyMs: 0,
  };
}
