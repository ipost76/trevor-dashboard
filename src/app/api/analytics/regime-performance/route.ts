import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Regime data is not currently stored per trade.
  // active_trades.regime_at_entry exists but is NULL for all closed trades.
  // trade_insights.regime exists but is empty for all 729 signals.
  // This endpoint returns a stub until regime data is populated by the engine.

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json

DB = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

# Check if any closed trades have regime data
row = conn.execute("""
    SELECT COUNT(*) as total,
           SUM(CASE WHEN regime_at_entry IS NOT NULL AND regime_at_entry <> '' THEN 1 ELSE 0 END) as has_regime
    FROM active_trades WHERE status='closed'
""").fetchone()
conn.close()

total = row["total"]
has_regime = row["has_regime"]

if has_regime == 0:
    print(json.dumps({
        "available": False,
        "reason": "Regime data is not stored per trade. The regime_at_entry column exists on active_trades but is NULL for all " + str(total) + " closed trades. Recommend wiring regime detection into trade entry flow.",
        "total_trades_with_regime": 0,
        "total_trades_without_regime": total,
        "regimes": [],
        "recommendation": None,
    }))
else:
    # Future: full regime analysis when data exists
    print(json.dumps({
        "available": True,
        "total_trades_with_regime": has_regime,
        "total_trades_without_regime": total - has_regime,
        "regimes": [],
        "recommendation": None,
    }))
`;

    const pyResult = execSync(
      `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 10000, cwd: "/home/trevor/trevor" }
    ).trim();
    return NextResponse.json(JSON.parse(pyResult));
  } catch (error) {
    console.error("[Analytics Regime] Error:", error);
    return NextResponse.json({ available: false, reason: "Query failed", regimes: [] }, { status: 500 });
  }
}
