import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";
import { fetchHeartbeatOpenSet } from "@/lib/heartbeat-open-set";

export const dynamic = "force-dynamic";

// RM-DASH 2026-05-29: single-flight + SWR (30s) so a cold-cache burst spawns ONE
// Python child per window, not N. The route's existing try/catch around swr()
// preserves the exact cold-failure fallback contract.
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 30_000, concurrency: 2 });

const PY = `
import sqlite3, json, os
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()
active = cur.execute("SELECT COUNT(*) FROM auto_trades WHERE status='open' AND trade_mode='live'").fetchone()[0]
signals = cur.execute("SELECT COUNT(*) FROM trade_insights WHERE created_at > datetime('now', '-30 minutes')").fetchone()[0]
filters = []
try:
    rows = cur.execute("SELECT id, rule_type, ticker, direction, value, reason FROM signal_filter_rules WHERE enabled = 1").fetchall()
    for r in rows:
        filters.append({"id": r[0], "rule_type": r[1], "ticker": r[2], "direction": r[3], "value": r[4], "reason": r[5]})
except:
    pass
streak = 0
lastPnl = 0
outcomes = cur.execute("SELECT pnl_pct FROM trade_outcomes ORDER BY created_at DESC LIMIT 20").fetchall()
if outcomes:
    lastPnl = round(outcomes[0][0], 2)
    d = 'win' if outcomes[0][0] > 0 else 'loss'
    for o in outcomes:
        if (d == 'win' and o[0] > 0) or (d == 'loss' and o[0] <= 0):
            streak += 1
        else:
            break
    if d == 'loss': streak = -streak
activeDetails = [{"ticker": r[0], "direction": r[1]} for r in cur.execute("SELECT ticker, direction FROM auto_trades WHERE status='open' AND trade_mode='live'").fetchall()]
conn.close()
print(json.dumps({"activeTrades": active, "recentSignals": signals, "filters": filters, "filterCount": len(filters), "streak": streak, "lastPnl": lastPnl, "activeTradeDetails": activeDetails}))
`;

export async function GET() {
  try {
    const { value } = await cache.swr("nav-badges", async () => {
      const raw = await runPythonInline(PY, { timeout: 5000 });
      const py = JSON.parse(raw) as Record<string, unknown>;
      // Live-truth open positions from the Observatory heartbeat (same source the
      // AUTO CAPITAL header reads); the replica auto_trades values (PY above) are
      // the fallback when the heartbeat is unreachable. Never the frozen
      // active_trades.
      const liveSet = await fetchHeartbeatOpenSet();
      if (liveSet) {
        py.activeTrades = liveSet.length;
        py.activeTradeDetails = liveSet.map((h) => ({
          ticker: h.ticker,
          direction: h.direction,
        }));
      }
      return py;
    });
    return NextResponse.json(value);
  } catch {
    return NextResponse.json({ activeTrades: 0, recentSignals: 0, filters: [], filterCount: 0 });
  }
}
