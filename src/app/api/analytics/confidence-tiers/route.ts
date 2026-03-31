import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

let _cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 300_000;

export async function GET() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return NextResponse.json(_cache.data);
  }

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json

DB = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

# Total signals
total_signals = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()[0]

# Closed trades with confidence
trades = conn.execute("""
    SELECT id, ticker, direction, pnl_pct, confidence
    FROM active_trades
    WHERE status='closed' AND confidence IS NOT NULL
    ORDER BY id
""").fetchall()

if not trades:
    print(json.dumps({"available": False, "reason": "No closed trades with confidence data."}))
    conn.close()
    exit()

# Tier definitions (confidence is 0-100 scale on active_trades)
tier_defs = [
    (0, 45, "<45", "Low"),
    (45, 55, "45-54", "Medium"),
    (55, 65, "55-64", "High"),
    (65, 100, "65+", "Very High"),
]

tiers = []
for lo, hi, label, name in tier_defs:
    in_tier = [t for t in trades if lo <= (t["confidence"] or 0) < hi]
    if not in_tier:
        tiers.append({
            "confidence_range": label, "label": f"{label} ({name})",
            "trade_count": 0, "wins": 0, "losses": 0,
            "win_rate": 0, "avg_pnl_pct": 0, "total_pnl_pct": 0,
            "profit_factor": None, "recommendation": "No trades at this level",
        })
        continue

    wins = sum(1 for t in in_tier if (t["pnl_pct"] or 0) > 0)
    losses = len(in_tier) - wins
    pnls = [float(t["pnl_pct"] or 0) for t in in_tier]
    win_pnls = [p for p in pnls if p > 0]
    loss_pnls = [p for p in pnls if p < 0]
    total_pnl = sum(pnls)
    wr = round(wins / len(in_tier) * 100, 1)
    pf = round(abs(sum(win_pnls)) / abs(sum(loss_pnls)), 2) if loss_pnls and sum(loss_pnls) != 0 else (999 if win_pnls else 0)

    if wr >= 55 and pf >= 1.2:
        rec = "Positive edge — prioritize these signals."
    elif wr >= 45:
        rec = "Marginal — monitor closely."
    else:
        rec = "Below breakeven — consider filtering."

    if len(in_tier) < 5:
        rec += " (low sample)"

    tiers.append({
        "confidence_range": label, "label": f"{label} ({name})",
        "trade_count": len(in_tier), "wins": wins, "losses": losses,
        "win_rate": wr, "avg_pnl_pct": round(total_pnl / len(in_tier), 2),
        "total_pnl_pct": round(total_pnl, 2),
        "profit_factor": pf if pf < 999 else None,
        "recommendation": rec,
    })

# Signal confidence distribution (from trade_insights)
sig_tiers = []
for lo, hi, label, name in tier_defs:
    lo_dec, hi_dec = lo / 100, hi / 100
    cnt = conn.execute(
        "SELECT COUNT(*) FROM trade_insights WHERE confidence >= ? AND confidence < ?",
        (lo_dec, hi_dec)
    ).fetchone()[0]
    sig_tiers.append({"range": label, "signal_count": cnt})

# Overall recommendation
# Find threshold where WR > 50%
active_tiers = [t for t in tiers if t["trade_count"] >= 3]
rec_threshold = None
for t in sorted(active_tiers, key=lambda x: x["confidence_range"]):
    if t["win_rate"] >= 50:
        rec_threshold = t["confidence_range"]
        break

total_taken = len(trades)
take_rate = round(total_taken / total_signals * 100, 1) if total_signals > 0 else 0

overall_rec = None
if rec_threshold:
    # Calculate impact of filtering below threshold
    threshold_lo = next((lo for lo, hi, label, _ in tier_defs if label == rec_threshold), 0)
    kept = [t for t in trades if (t["confidence"] or 0) >= threshold_lo]
    filtered = [t for t in trades if (t["confidence"] or 0) < threshold_lo]
    if kept and filtered:
        kept_wr = round(sum(1 for t in kept if (t["pnl_pct"] or 0) > 0) / len(kept) * 100, 1)
        kept_avg = round(sum(float(t["pnl_pct"] or 0) for t in kept) / len(kept), 2)
        filtered_pnl = round(sum(float(t["pnl_pct"] or 0) for t in filtered), 2)
        overall_rec = {
            "current_threshold": "none",
            "recommended_threshold": rec_threshold,
            "projected_win_rate": kept_wr,
            "projected_avg_pnl": kept_avg,
            "trades_filtered": len(filtered),
            "pnl_saved": round(-filtered_pnl, 2) if filtered_pnl < 0 else 0,
            "impact": f"Filtering below {rec_threshold} confidence would remove {len(filtered)} trades. Projected WR: {kept_wr}%, Avg P&L: {kept_avg:+.2f}%.",
        }

conn.close()

result = {
    "available": True,
    "total_signals": total_signals,
    "signals_taken": total_taken,
    "take_rate": take_rate,
    "tiers": tiers,
    "signal_distribution": sig_tiers,
    "overall_recommendation": overall_rec,
}
print(json.dumps(result, default=str))
`;

    const pyResult = execSync(
      `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 15000, cwd: "/home/trevor/trevor" }
    ).trim();
    const data = JSON.parse(pyResult);
    _cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Analytics Confidence Tiers] Error:", error);
    return NextResponse.json({ available: false, reason: "Query failed", tiers: [] }, { status: 500 });
  }
}
