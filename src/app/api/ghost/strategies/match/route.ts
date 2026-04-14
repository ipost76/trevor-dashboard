import { NextRequest, NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ticker = searchParams.get("ticker")?.toUpperCase() || "";
  const direction = searchParams.get("direction")?.toUpperCase() || "";
  const confidenceRaw = searchParams.get("confidence");
  const confidence = confidenceRaw !== null ? parseInt(confidenceRaw) : NaN;

  const pyScript = `
import sqlite3, json, os
db_path = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

ticker = os.environ.get("MATCH_TICKER", "")
direction = os.environ.get("MATCH_DIRECTION", "")
conf_raw = os.environ.get("MATCH_CONFIDENCE", "")
confidence = int(conf_raw) if conf_raw.lstrip("-").isdigit() else None

rows = conn.execute("SELECT * FROM ghost_strategies WHERE status='active'").fetchall()
results = []
for r in rows:
    d = dict(r)
    if ticker:
        assets = d.get("assets") or ""
        if assets:
            asset_list = [a.strip().upper() for a in assets.split(",")]
            if ticker not in asset_list:
                continue
    if direction:
        strat_dir = (d.get("direction") or "BOTH").upper()
        if strat_dir not in ("BOTH", direction):
            continue
    if confidence is not None:
        mc = d.get("min_confidence")
        if mc is not None and confidence < mc:
            continue
    results.append(d)
conn.close()
print(json.dumps(results, default=str))
`;

  try {
    const raw = runPythonInline(pyScript, {
      timeout: 10000,
      env: {
        MATCH_TICKER: ticker,
        MATCH_DIRECTION: direction,
        MATCH_CONFIDENCE: Number.isFinite(confidence) ? String(confidence) : "",
      },
    });
    return NextResponse.json({ matches: JSON.parse(raw) }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), matches: [] }, { status: 500 });
  }
}
