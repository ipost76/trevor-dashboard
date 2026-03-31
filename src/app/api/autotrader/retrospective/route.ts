import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Cache 5 min — this data changes rarely (autotrader is paused)
let _cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 300_000;

export async function GET() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return NextResponse.json(_cache.data);
  }

  const dbPath = "/home/trevor/trevor/autotrader/autotrader.db";

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json, os
from datetime import datetime, timedelta
from collections import defaultdict

db = "${dbPath}"
if not os.path.exists(db):
    print(json.dumps({"error": "no_db"}))
    exit()

conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
result = {}

# --- Summary stats ---
trades = conn.execute("""
    SELECT id, ticker, side, entry_price, exit_price, qty, pnl, pnl_pct,
           exit_reason, entry_time, exit_time, signal_score, regime
    FROM trades WHERE exit_price IS NOT NULL
    ORDER BY id
""").fetchall()
trades = [dict(r) for r in trades]

# Filter out CIRCUIT_RESET
real_trades = [t for t in trades if t["ticker"] != "CIRCUIT_RESET"]

total = len(real_trades)
wins = [t for t in real_trades if (t["pnl"] or 0) > 0]
losses = [t for t in real_trades if (t["pnl"] or 0) <= 0]
total_pnl = sum(t["pnl"] or 0 for t in real_trades)
total_won = sum(t["pnl"] for t in wins) if wins else 0
total_lost = abs(sum(t["pnl"] for t in losses)) if losses else 0
pf = round(total_won / total_lost, 2) if total_lost > 0 else 0

# Hold duration
def hold_minutes(t):
    try:
        entry = datetime.fromisoformat(t["entry_time"].replace("Z",""))
        exit_ = datetime.fromisoformat(t["exit_time"].replace("Z",""))
        return (exit_ - entry).total_seconds() / 60
    except:
        return 0

holds = [hold_minutes(t) for t in real_trades]

# Equity curve from Alpaca
try:
    import sys
    sys.path.insert(0, '/home/trevor/trevor')
    from dotenv import load_dotenv
    load_dotenv('/home/trevor/trevor/.env')
    from alpaca.trading.client import TradingClient
    key = os.environ.get('ALPACA_PAPER_API_KEY', '')
    secret = os.environ.get('ALPACA_PAPER_SECRET_KEY', '')
    if key and secret:
        client = TradingClient(key, secret, paper=True)
        acct = client.get_account()
        current_equity = round(float(acct.equity), 2)
    else:
        current_equity = 10000 + total_pnl
except:
    current_equity = 10000 + total_pnl

starting_equity = 10000.0
max_dd = 0
peak = starting_equity
running = starting_equity
for t in real_trades:
    running += (t["pnl"] or 0)
    if running > peak:
        peak = running
    dd = (running - peak) / peak * 100 if peak > 0 else 0
    if dd < max_dd:
        max_dd = dd

result["summary"] = {
    "total_trades": total,
    "wins": len(wins),
    "losses": len(losses),
    "win_rate": round(len(wins) / total * 100, 1) if total else 0,
    "total_pnl": round(total_pnl, 2),
    "profit_factor": pf,
    "avg_win": round(sum(t["pnl"] for t in wins) / len(wins), 2) if wins else 0,
    "avg_loss": round(sum(t["pnl"] for t in losses) / len(losses), 2) if losses else 0,
    "largest_win": round(max((t["pnl"] for t in wins), default=0), 2),
    "largest_loss": round(min((t["pnl"] for t in losses), default=0), 2),
    "avg_hold_minutes": round(sum(holds) / len(holds)) if holds else 0,
    "starting_equity": starting_equity,
    "current_equity": current_equity,
    "max_drawdown_pct": round(max_dd, 1),
}

# --- Pause status ---
pause_file = "/home/trevor/trevor/.autotrader_paused"
if os.path.exists(pause_file):
    result["status"] = "paused"
    try:
        with open(pause_file) as f:
            result["paused_reason"] = f.read().strip()
        result["paused_at"] = datetime.fromtimestamp(os.path.getmtime(pause_file)).isoformat()
    except:
        result["paused_reason"] = ""
        result["paused_at"] = None
else:
    result["status"] = "active"

# --- Time analysis ---
hour_stats = defaultdict(lambda: {"trades": 0, "wins": 0})
day_stats = defaultdict(lambda: {"trades": 0, "wins": 0})
heatmap = {}  # "day_hour" -> {trades, wins, pnl}

days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

for t in real_trades:
    try:
        entry = datetime.fromisoformat(t["entry_time"].replace("Z",""))
        h = entry.hour
        d = entry.weekday()
        hour_stats[h]["trades"] += 1
        day_stats[d]["trades"] += 1
        if (t["pnl"] or 0) > 0:
            hour_stats[h]["wins"] += 1
            day_stats[d]["wins"] += 1
        # Heatmap: 4-hour blocks
        block = (h // 4) * 4
        key = f"{d}_{block}"
        if key not in heatmap:
            heatmap[key] = {"trades": 0, "wins": 0, "pnl": 0}
        heatmap[key]["trades"] += 1
        heatmap[key]["pnl"] += (t["pnl"] or 0)
        if (t["pnl"] or 0) > 0:
            heatmap[key]["wins"] += 1
    except:
        pass

# Best/worst hour
best_hour = max(hour_stats.items(), key=lambda x: x[1]["wins"]/max(x[1]["trades"],1)) if hour_stats else (0, {"trades":0,"wins":0})
worst_hour = min(hour_stats.items(), key=lambda x: x[1]["wins"]/max(x[1]["trades"],1)) if hour_stats else (0, {"trades":0,"wins":0})
best_day = max(day_stats.items(), key=lambda x: x[1]["wins"]/max(x[1]["trades"],1)) if day_stats else (0, {"trades":0,"wins":0})
worst_day = min(day_stats.items(), key=lambda x: x[1]["wins"]/max(x[1]["trades"],1)) if day_stats else (0, {"trades":0,"wins":0})

result["time_analysis"] = {
    "best_hour": {"hour": best_hour[0], "win_rate": round(best_hour[1]["wins"]/max(best_hour[1]["trades"],1)*100,1), "trade_count": best_hour[1]["trades"]},
    "worst_hour": {"hour": worst_hour[0], "win_rate": round(worst_hour[1]["wins"]/max(worst_hour[1]["trades"],1)*100,1), "trade_count": worst_hour[1]["trades"]},
    "best_day": {"day": days[best_day[0]] if isinstance(best_day[0], int) else "?", "win_rate": round(best_day[1]["wins"]/max(best_day[1]["trades"],1)*100,1), "trade_count": best_day[1]["trades"]},
    "worst_day": {"day": days[worst_day[0]] if isinstance(worst_day[0], int) else "?", "win_rate": round(worst_day[1]["wins"]/max(worst_day[1]["trades"],1)*100,1), "trade_count": worst_day[1]["trades"]},
    "heatmap": [
        {"day": d, "block": b, "day_label": days[d], "hour_label": f"{b:02d}-{b+3:02d}",
         "trades": heatmap.get(f"{d}_{b}", {}).get("trades", 0),
         "wins": heatmap.get(f"{d}_{b}", {}).get("wins", 0),
         "pnl": round(heatmap.get(f"{d}_{b}", {}).get("pnl", 0), 2)}
        for d in range(7) for b in range(0, 24, 4)
    ],
}

# --- Asset breakdown ---
ticker_stats = defaultdict(lambda: {"trades": 0, "wins": 0, "pnl": 0, "losses": 0})
for t in real_trades:
    tk = t["ticker"]
    ticker_stats[tk]["trades"] += 1
    ticker_stats[tk]["pnl"] += (t["pnl"] or 0)
    if (t["pnl"] or 0) > 0:
        ticker_stats[tk]["wins"] += 1
    else:
        ticker_stats[tk]["losses"] += 1

result["asset_breakdown"] = sorted([
    {"ticker": tk, "trades": s["trades"], "wins": s["wins"], "losses": s["losses"],
     "win_rate": round(s["wins"]/s["trades"]*100, 1) if s["trades"] else 0,
     "pnl": round(s["pnl"], 2)}
    for tk, s in ticker_stats.items()
], key=lambda x: x["pnl"])

# --- Exit reason breakdown ---
exit_stats = defaultdict(lambda: {"trades": 0, "wins": 0, "pnl": 0})
for t in real_trades:
    er = t["exit_reason"] or "unknown"
    exit_stats[er]["trades"] += 1
    exit_stats[er]["pnl"] += (t["pnl"] or 0)
    if (t["pnl"] or 0) > 0:
        exit_stats[er]["wins"] += 1

result["exit_analysis"] = [
    {"reason": r, "trades": s["trades"], "wins": s["wins"],
     "win_rate": round(s["wins"]/s["trades"]*100, 1), "pnl": round(s["pnl"], 2)}
    for r, s in exit_stats.items()
]

# --- Loss streaks ---
streaks = []
current_streak = []
for t in real_trades:
    if (t["pnl"] or 0) <= 0 and t["exit_reason"] != "manual_reset":
        current_streak.append(t)
    else:
        if len(current_streak) >= 3:
            streaks.append({
                "start_date": current_streak[0]["entry_time"][:10],
                "end_date": current_streak[-1]["exit_time"][:10] if current_streak[-1]["exit_time"] else current_streak[-1]["entry_time"][:10],
                "consecutive_losses": len(current_streak),
                "total_pnl": round(sum(s["pnl"] or 0 for s in current_streak), 2),
                "tickers": list(set(s["ticker"] for s in current_streak)),
            })
        current_streak = []
# Don't forget trailing streak
if len(current_streak) >= 3:
    streaks.append({
        "start_date": current_streak[0]["entry_time"][:10],
        "end_date": current_streak[-1]["exit_time"][:10] if current_streak[-1]["exit_time"] else current_streak[-1]["entry_time"][:10],
        "consecutive_losses": len(current_streak),
        "total_pnl": round(sum(s["pnl"] or 0 for s in current_streak), 2),
        "tickers": list(set(s["ticker"] for s in current_streak)),
    })

result["loss_streaks"] = sorted(streaks, key=lambda x: x["consecutive_losses"], reverse=True)

# --- Equity curve ---
running_eq = starting_equity
eq_points = [{"date": "Start", "equity": starting_equity, "trade_count": 0}]
daily = defaultdict(lambda: {"pnl": 0, "count": 0})
for t in real_trades:
    d = (t["exit_time"] or t["entry_time"])[:10]
    daily[d]["pnl"] += (t["pnl"] or 0)
    daily[d]["count"] += 1

for d in sorted(daily.keys()):
    running_eq += daily[d]["pnl"]
    eq_points.append({"date": d, "equity": round(running_eq, 2), "trade_count": daily[d]["count"]})

result["equity_curve"] = eq_points

# --- Recent trades (enriched) ---
result["recent_trades"] = []
for t in reversed(real_trades[-20:]):
    hm = hold_minutes(t)
    result["recent_trades"].append({
        "ticker": t["ticker"], "side": t["side"],
        "entry_price": t["entry_price"], "exit_price": t["exit_price"],
        "pnl": round(t["pnl"] or 0, 2), "pnl_pct": round(t["pnl_pct"] or 0, 2),
        "exit_reason": t["exit_reason"],
        "entry_time": t["entry_time"], "exit_time": t["exit_time"],
        "signal_score": t["signal_score"],
        "hold_minutes": round(hm),
        "regime": t["regime"],
    })

# --- Insights (auto-generated) ---
insights = []
# Exit reason insight
stop_losses = sum(1 for t in real_trades if t["exit_reason"] == "stop_loss" and (t["pnl"] or 0) < 0)
if total > 0 and stop_losses / total > 0.5:
    insights.append(f"{round(stop_losses/total*100)}% of trades hit stop loss. Stops may be too tight or entries too late.")
# All-long bias
long_only = all(t["side"] == "BUY" for t in real_trades)
if long_only:
    insights.append("100% LONG bias — no short trades taken. Consider adding short signals for bear/volatile regimes.")
# Worst ticker
if ticker_stats:
    worst_tk = min(ticker_stats.items(), key=lambda x: x[1]["pnl"])
    if worst_tk[1]["pnl"] < -50:
        pnl_str = "$" + str(round(worst_tk[1]["pnl"], 2))
        insights.append(f"{worst_tk[0]} is worst performer ({pnl_str}, {worst_tk[1]['trades']} trades). Consider removing from universe.")
# Win rate vs score
high_score = [t for t in real_trades if (t["signal_score"] or 0) >= 70]
low_score = [t for t in real_trades if (t["signal_score"] or 0) < 70 and (t["signal_score"] or 0) > 0]
if high_score and low_score:
    high_wr = sum(1 for t in high_score if (t["pnl"] or 0) > 0) / len(high_score) * 100
    low_wr = sum(1 for t in low_score if (t["pnl"] or 0) > 0) / len(low_score) * 100
    insights.append(f"Score >=70: {round(high_wr)}% WR ({len(high_score)} trades) vs <70: {round(low_wr)}% WR ({len(low_score)} trades)")

result["insights"] = insights

# --- Lessons from DB ---
lessons = conn.execute("SELECT ticker, lesson_type, lesson_text, pnl_pct, created_at FROM lessons ORDER BY id DESC LIMIT 10").fetchall()
result["lessons"] = [dict(r) for r in lessons]

conn.close()
print(json.dumps(result, default=str))
`;

    const pyResult = execSync(
      `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 20000, cwd: "/home/trevor/trevor", env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    const data = JSON.parse(pyResult);

    _cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (error) {
    console.error("[AutoTrader Retrospective] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate retrospective", status: "error" },
      { status: 500 }
    );
  }
}
