import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// PERF-02 (2026-06-02): single-flight + SWR (5min) so a cold-cache burst spawns
// ONE Python child per window, not N. The try/catch around swr() preserves the
// cold-failure contract (500); a transient warm failure now serves stale instead.
const cache = createSwrCache<unknown>({ defaultTtl: 300_000, concurrency: 2 });

export async function GET() {
  try {
    const pyScript = `
import sqlite3, json, statistics
from collections import defaultdict

DB = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

rows = conn.execute("""
    SELECT id, ticker, direction, pnl_pct, opened_at, closed_at, confidence
    FROM auto_trades
    WHERE status='closed' AND opened_at IS NOT NULL AND closed_at IS NOT NULL
    ORDER BY id
""").fetchall()
conn.close()

if not rows:
    print(json.dumps({"available": False, "reason": "No closed trades with timestamps found."}))
    exit()

trades = []
for r in rows:
    try:
        from datetime import datetime
        opened = datetime.fromisoformat(r["opened_at"].replace("Z",""))
        closed = datetime.fromisoformat(r["closed_at"].replace("Z",""))
        mins = round((closed - opened).total_seconds() / 60)
        if mins < 0:
            continue
        trades.append({
            "id": r["id"], "ticker": r["ticker"], "direction": r["direction"],
            "pnl_pct": round(float(r["pnl_pct"] or 0), 2),
            "hold_minutes": mins, "is_winner": (r["pnl_pct"] or 0) > 0,
            "entry_time": r["opened_at"], "exit_time": r["closed_at"],
        })
    except:
        continue

if not trades:
    print(json.dumps({"available": False, "reason": "Could not compute hold duration from timestamps."}))
    exit()

winners = [t for t in trades if t["is_winner"]]
losers = [t for t in trades if not t["is_winner"]]

w_mins = [t["hold_minutes"] for t in winners] if winners else [0]
l_mins = [t["hold_minutes"] for t in losers] if losers else [0]

avg_w = round(sum(w_mins)/len(w_mins)) if w_mins else 0
avg_l = round(sum(l_mins)/len(l_mins)) if l_mins else 0
med_w = round(statistics.median(w_mins)) if w_mins else 0
med_l = round(statistics.median(l_mins)) if l_mins else 0
ratio = round(avg_l / avg_w, 1) if avg_w > 0 else 0

# Insight
if avg_w > 0 and avg_l > avg_w * 1.5:
    rec_max = avg_w * 2
    hrs = round(rec_max / 60, 1)
    insight = f"You hold losers {ratio}x longer than winners. Consider a max hold time of {hrs}h for losing positions."
elif avg_l > 0 and avg_w > avg_l * 1.5:
    insight = f"Good discipline — you cut losers {round(avg_w/avg_l,1)}x faster than you exit winners."
else:
    insight = f"Hold times are similar for winners ({avg_w}m) and losers ({avg_l}m). Consider tightening time stops on losers."

# Buckets
bucket_defs = [(0,30,"0-30m"),(30,60,"30m-1h"),(60,120,"1-2h"),(120,240,"2-4h"),(240,480,"4-8h"),(480,99999,"8h+")]
def bucket_dist(trade_list):
    result = []
    for lo, hi, label in bucket_defs:
        in_bucket = [t for t in trade_list if lo <= t["hold_minutes"] < hi]
        cnt = len(in_bucket)
        avg_pnl = round(sum(t["pnl_pct"] for t in in_bucket)/cnt, 2) if cnt else 0
        result.append({"bucket": label, "count": cnt, "avg_pnl_pct": avg_pnl})
    return result

# Optimal window — best (wr * avg_pnl) with >= 3 trades
best_bucket = None
best_score = -999
for lo, hi, label in bucket_defs:
    in_b = [t for t in trades if lo <= t["hold_minutes"] < hi]
    if len(in_b) < 2:
        continue
    wr = sum(1 for t in in_b if t["is_winner"]) / len(in_b) * 100
    avg_p = sum(t["pnl_pct"] for t in in_b) / len(in_b)
    score = wr * max(avg_p, 0.01)
    if score > best_score:
        best_score = score
        best_bucket = {"best_bucket": label, "best_win_rate": round(wr, 1), "best_avg_pnl": round(avg_p, 2), "trade_count": len(in_b)}

optimal = best_bucket or {"best_bucket": "N/A", "best_win_rate": 0, "best_avg_pnl": 0, "trade_count": 0}
if best_bucket:
    optimal["note"] = f"Trades held {best_bucket['best_bucket']} have {best_bucket['best_win_rate']}% win rate and {best_bucket['best_avg_pnl']:+.1f}% avg P&L"

result = {
    "available": True,
    "summary": {
        "avg_hold_minutes_winners": avg_w,
        "avg_hold_minutes_losers": avg_l,
        "median_hold_minutes_winners": med_w,
        "median_hold_minutes_losers": med_l,
        "ratio": ratio,
        "insight": insight,
        "total_trades": len(trades),
    },
    "distribution": {
        "winners": bucket_dist(winners),
        "losers": bucket_dist(losers),
    },
    "optimal_window": optimal,
    "trades_with_duration": sorted(trades, key=lambda t: t["id"], reverse=True)[:20],
}

print(json.dumps(result, default=str))
`;

    const { value } = await cache.swr("duration", async () => {
      const pyResult = await runPythonInline(pyScript, { timeout: 15000 });
      return JSON.parse(pyResult);
    });
    return NextResponse.json(value);
  } catch (error) {
    console.error("[Analytics Duration] Error:", error);
    return NextResponse.json({ available: false, reason: "Query failed" }, { status: 500 });
  }
}
