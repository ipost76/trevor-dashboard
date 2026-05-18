import { NextRequest, NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const since = request.nextUrl.searchParams.get("since") || "";
    // Rule 26 — `since` crosses to Python via the env map (SINCE), never a shell string.
    const code = `
import sqlite3, json, os
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
since = os.environ.get("SINCE", "")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
if since:
    row = conn.execute("SELECT COUNT(*) as cnt FROM trade_insights WHERE created_at > ?", (since,)).fetchone()
else:
    row = conn.execute("SELECT COUNT(*) as cnt FROM trade_insights WHERE created_at > datetime('now', '-1 hour')").fetchone()
conn.close()
print(json.dumps({"count": row[0] if row else 0}))
`;
    const raw = runPythonInline(code, { env: { SINCE: since }, timeout: 5000 });
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
