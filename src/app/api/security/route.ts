import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = `${trevorDir}/venv/bin/python3`;

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
result = {"events": [], "total": 0}
try:
    total = conn.execute("SELECT COUNT(*) FROM security_events").fetchone()[0]
    result["total"] = total
    rows = conn.execute("""
        SELECT id, event_type, severity, description, file_path, created_at
        FROM security_events ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    """).fetchall()
    result["events"] = [dict(r) for r in rows]
except Exception as e:
    result["error"] = str(e)
conn.close()
print(json.dumps(result))
`;
    const raw = execSync(
      `${pythonPath} -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 10000, cwd: trevorDir }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ events: [], total: 0, error: String(err) });
  }
}
