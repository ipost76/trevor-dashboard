import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const start = Date.now();
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "list";

  try {
    const { execSync } = await import("child_process");

    // ── scope=summary: aggregated stats only, no individual signals ──
    if (scope === "summary") {
      const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
out = {}

# Summary counts
try:
    r = conn.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN date(created_at)=date('now') THEN 1 ELSE 0 END) as today,
               SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) as this_week,
               AVG(confidence) as avg_conf,
               SUM(CASE WHEN signal_type='LONG' THEN 1 ELSE 0 END) as long_ct,
               SUM(CASE WHEN signal_type='SHORT' THEN 1 ELSE 0 END) as short_ct,
               MIN(created_at) as first_dt,
               MAX(created_at) as latest_dt
        FROM trade_insights
    """).fetchone()
    avg_c = r[3]
    if avg_c and avg_c <= 1:
        avg_c = round(avg_c * 100, 1)
    else:
        avg_c = round(float(avg_c or 0), 1)
    out["summary"] = {
        "total_signals": r[0] or 0,
        "signals_today": r[1] or 0,
        "signals_this_week": r[2] or 0,
        "avg_confidence": avg_c,
        "long_count": r[4] or 0,
        "short_count": r[5] or 0,
        "date_range": {"first": r[6], "latest": r[7]}
    }
except:
    out["summary"] = {"total_signals":0,"signals_today":0,"signals_this_week":0,"avg_confidence":0,"long_count":0,"short_count":0,"date_range":{"first":None,"latest":None}}

# By ticker (normalized)
try:
    rows = conn.execute("""
        SELECT REPLACE(REPLACE(ticker,'-PERP',''),'/USD','') as tk,
               COUNT(*) as total,
               SUM(CASE WHEN signal_type='LONG' THEN 1 ELSE 0 END) as lng,
               SUM(CASE WHEN signal_type='SHORT' THEN 1 ELSE 0 END) as sht,
               AVG(confidence) as avg_c
        FROM trade_insights GROUP BY tk ORDER BY total DESC
    """).fetchall()
    out["by_ticker"] = [
        {"ticker": r[0], "total": r[1], "long": r[2], "short": r[3],
         "avg_confidence": round(float(r[4] or 0)*100,1) if r[4] and r[4]<=1 else round(float(r[4] or 0),1)}
        for r in rows
    ]
except:
    out["by_ticker"] = []

# Confidence distribution
try:
    rows = conn.execute("""
        SELECT CASE
            WHEN confidence*100<45 THEN '35_44'
            WHEN confidence*100<55 THEN '45_54'
            WHEN confidence*100<65 THEN '55_64'
            ELSE '65_plus' END as bucket,
            COUNT(*) as ct
        FROM trade_insights
        WHERE confidence IS NOT NULL AND confidence*100 >= 35
        GROUP BY bucket ORDER BY bucket
    """).fetchall()
    out["confidence_distribution"] = {r[0]: r[1] for r in rows}
except:
    out["confidence_distribution"] = {}

# Direction over time (last 14 days)
try:
    rows = conn.execute("""
        SELECT date(created_at) as dt,
               SUM(CASE WHEN signal_type='LONG' THEN 1 ELSE 0 END) as lng,
               SUM(CASE WHEN signal_type='SHORT' THEN 1 ELSE 0 END) as sht
        FROM trade_insights
        WHERE created_at >= datetime('now','-14 days')
        GROUP BY dt ORDER BY dt
    """).fetchall()
    out["direction_over_time"] = [{"date": r[0], "long": r[1], "short": r[2]} for r in rows]
except:
    out["direction_over_time"] = []

conn.close()
print(json.dumps(out))
`;
      const pyResult = execSync(
        `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 8000, cwd: "/home/trevor/trevor" }
      ).trim();
      const summaryData = JSON.parse(pyResult);

      // Also get quality metrics from query_signal_quality.py
      let quality: { overall: unknown; calibration: Record<string, unknown>; tickerPerformance: unknown[]; tradePerformance: unknown } = { overall: null, calibration: {}, tickerPerformance: [], tradePerformance: null };
      try {
        const qResult = execSync(
          `/home/trevor/trevor/venv/bin/python3 /home/trevor/trevor-dashboard/query_signal_quality.py`,
          { encoding: "utf-8", timeout: 15000, cwd: "/home/trevor/trevor" }
        ).trim();
        quality = JSON.parse(qResult);
      } catch { /* quality data optional */ }

      return NextResponse.json({
        ...summaryData,
        quality: {
          overall: quality.overall || null,
          calibration: quality.calibration || {},
          ticker_performance: quality.tickerPerformance || [],
        },
        trade_performance: quality.tradePerformance || null,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      });
    }

    // ── scope=list (default): paginated individual signals ──
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50") || 50));
    const direction = (searchParams.get("direction") || "").replace(/[^A-Z]/g, "");
    const ticker = (searchParams.get("ticker") || "").replace(/[^A-Za-z0-9-]/g, "");
    const offset = (page - 1) * limit;

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
      { ok: false, error: String(err), timestamp: new Date().toISOString(), latencyMs: Date.now() - start },
      { status: 500 }
    );
  }
}
