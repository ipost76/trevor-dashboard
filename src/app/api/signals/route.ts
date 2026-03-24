import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const start = Date.now();
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50") || 50));
  const direction = (searchParams.get("direction") || "").replace(/[^A-Z]/g, "");
  const ticker = (searchParams.get("ticker") || "").replace(/[^A-Za-z0-9-]/g, "");
  const offset = (page - 1) * limit;

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
result = {}

direction_filter = "${direction}"
ticker_filter = "${ticker}"

conditions = []
params = []
if direction_filter:
    conditions.append("signal_type = ?")
    params.append(direction_filter)
if ticker_filter:
    conditions.append("ticker LIKE ?")
    params.append("%" + ticker_filter + "%")

where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

try:
    total = conn.execute("SELECT COUNT(*) FROM trade_insights " + where_clause, params).fetchone()[0]
    result["total"] = total
except:
    result["total"] = 0

try:
    rows = conn.execute(
        "SELECT id, ticker, signal_type, confidence, entry_price, target_price, "
        "stop_price, reasoning, strategy, timeframe, multi_tf_confirmed, "
        "outcome, actual_result_pct, exit_reason, created_at, "
        "score_momentum, score_trend, score_volume, score_volatility, "
        "score_microstructure, regime, quality_tier, rr_ratio, groups_confirmed "
        "FROM trade_insights " + where_clause + " ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [${limit}, ${offset}]
    ).fetchall()
    result["signals"] = [
        {"id": r[0], "ticker": r[1], "direction": r[2],
         "confidence": round(r[3]*100) if r[3] and r[3] <= 1 else int(r[3] or 0),
         "entry_price": r[4], "target_price": r[5], "stop_price": r[6],
         "reasoning": r[7], "strategy": r[8], "timeframe": r[9],
         "multi_tf": bool(r[10]), "outcome": r[11],
         "result_pct": r[12], "exit_reason": r[13], "created_at": r[14],
         "breakdown": {"momentum": r[15] or 0, "trend": r[16] or 0,
                        "volume": r[17] or 0, "volatility": r[18] or 0,
                        "microstructure": r[19] or 0},
         "regime": r[20] or "", "quality_tier": r[21] or "",
         "rr_ratio": r[22] or 0, "groups_confirmed": r[23] or 0}
        for r in rows
    ]
except:
    result["signals"] = []

conn.close()
print(json.dumps(result))
`;
    const pyResult = execSync(
      `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 8000, cwd: "/home/trevor/trevor" }
    ).trim();
    const dbData = JSON.parse(pyResult);

    return NextResponse.json({
      ok: true,
      signals: dbData.signals || [],
      total: dbData.total || 0,
      page,
      limit,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, signals: [], total: 0, page, limit, error: String(err), timestamp: new Date().toISOString(), latencyMs: Date.now() - start },
      { status: 500 }
    );
  }
}
