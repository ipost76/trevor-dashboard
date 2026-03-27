import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const since = request.nextUrl.searchParams.get("since") || "";
    const code = `
import sqlite3, json, os, sys
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
since = sys.argv[1] if len(sys.argv) > 1 else ""
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
if since:
    row = conn.execute("SELECT COUNT(*) as cnt FROM trade_insights WHERE created_at > ?", (since,)).fetchone()
else:
    row = conn.execute("SELECT COUNT(*) as cnt FROM trade_insights WHERE created_at > datetime('now', '-1 hour')").fetchone()
conn.close()
print(json.dumps({"count": row[0] if row else 0}))
`;
    const { execSync } = require("child_process");
    const raw = execSync(
      `${process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor"}/venv/bin/python3 - ${since}`,
      { input: code, encoding: "utf-8", timeout: 5000, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
