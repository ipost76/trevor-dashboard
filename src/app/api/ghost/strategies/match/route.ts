import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ticker = searchParams.get("ticker")?.toUpperCase();
  const direction = searchParams.get("direction")?.toUpperCase();
  const confidence = searchParams.get("confidence") ? parseInt(searchParams.get("confidence")!) : null;

  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  try {
    const { execSync } = await import("child_process");
    const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT * FROM ghost_strategies WHERE status='active'").fetchall()
results = []
for r in rows:
    d = dict(r)
    # Filter by ticker
    assets = d.get("assets") or ""
    if ${ticker ? `True` : `False`} and assets:
        asset_list = [a.strip().upper() for a in assets.split(",")]
        if "${ticker || ""}" not in asset_list:
            continue
    # Filter by direction
    strat_dir = (d.get("direction") or "BOTH").upper()
    if ${direction ? `True` : `False`} and strat_dir not in ("BOTH", "${direction || ""}"):
        continue
    # Filter by min_confidence
    mc = d.get("min_confidence")
    if mc is not None and ${confidence !== null ? `True` : `False`} and ${confidence ?? 0} < mc:
        continue
    results.append(d)
conn.close()
print(json.dumps(results, default=str))
`;
    const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
    const raw = execSync(`${trevorDir}/venv/bin/python3 -`, {
      input: pyScript,
      encoding: "utf-8",
      timeout: 10000,
      env: { ...process.env, HOME: "/home/trevor" },
    }).trim();

    return NextResponse.json({ matches: JSON.parse(raw) }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), matches: [] }, { status: 500 });
  }
}
